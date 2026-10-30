#!/usr/bin/env node
/**
 * merge_fundamentals.mjs — 把 4 份 staging 补数合入 data/profit.json，并重建镜像 data/profit.json.js
 *
 * 用法:
 *   node scripts/merge_fundamentals.mjs --check   # 干跑：只统计将写入多少期/多少字段、冲突列表，不写盘
 *   node scripts/merge_fundamentals.mjs           # 执行写盘（同时重建镜像并断言深等）
 *   node scripts/merge_fundamentals.mjs --force   # 冲突时用新值覆盖旧值（默认保留旧值）
 *
 * 规则（严格，见任务书）:
 *   - 只新增四个字段 gross / opInc / rd / sga；绝不改动 end/revenue/netInc/periodType/currency/
 *     fxToUsd/derivation/name/notes。
 *   - 只对 profit.json 中已存在的期点写字段；staging 有而 profit.json 没有的期点跳过并计数。
 *   - 值为 null 的字段不写入。
 *   - 护栏：gross 与 revenue 同号且 gross<=revenue*1.001（负 gross 仅白名单 MU/TSLA/PDD/00981.HK/00100.HK 允许）；
 *     |opInc|<=max(revenue*20, 500)（500M 绝对值兜底，覆盖极小营收期的真实大额亏损）；
 *     rd>=0、sga>=0；荒谬值检测：仅当 rd>gross*2 或 sga>gross*2 时跳过该单字段。
 *   - rd+sga>gross*1.05 依旧写入（真实披露值），仅在 stat.structTight 中登记「结构偏紧清单」供人工知情。
 *   - 幂等：旧值存在且不同则记冲突并保留旧值（--force 除外）。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const FORCE = ARGS.has('--force');

const PROFIT = path.join(ROOT, 'data', 'profit.json');
const MIRROR = path.join(ROOT, 'data', 'profit.json.js');
const FIELDS = ['gross', 'opInc', 'rd', 'sga'];
const NEG_GROSS_OK = new Set(['MU', 'TSLA', 'PDD', '00981.HK', '00100.HK']);
const RD_SGA_RATIO = 1.05;   // 结构偏紧告警阈值（> 则登记，不跳过）
const GROSS_REV_RATIO = 1.001;
const OPINC_REV_MULT = 20;   // |opInc| <= max(revenue*20, 500)
const OPINC_ABS_FLOOR = 500; // 绝对值兜底（百万）
const ABSURD_MULT = 2;       // rd/sga > gross*2 视为荒谬值，跳单字段

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- 载入 staging，统一成 patch 列表 ----------
function loadPatches() {
  const patches = []; // {ticker, end, src, fields:{gross,opInc,rd,sga}}
  const push = (ticker, end, obj, src) => {
    const f = {};
    for (const k of FIELDS) f[k] = obj && obj[k] != null ? obj[k] : null;
    patches.push({ ticker, end, src, fields: f });
  };

  // A / HKB / FX: companies[t].patched 是 OBJECT（key=end）
  for (const file of ['backfill_A.json', 'backfill_HKB.json', 'backfill_FX.json']) {
    const d = readJson(path.join(ROOT, 'tmp-backfill', file));
    const cos = d.companies || {};
    for (const [ticker, c] of Object.entries(cos)) {
      const patched = c.patched || {};
      for (const [end, obj] of Object.entries(patched)) push(ticker, end, obj, file);
    }
  }

  // HKC: companies[t].patched 是 ARRAY（每项含 end）
  {
    const d = readJson(path.join(ROOT, 'tmp-backfill', 'backfill_HKC.json'));
    const cos = d.companies || {};
    for (const [ticker, c] of Object.entries(cos)) {
      const arr = Array.isArray(c.patched) ? c.patched : [];
      for (const obj of arr) {
        if (obj && obj.end) push(ticker, obj.end, obj, 'backfill_HKC.json');
      }
    }
  }
  return patches;
}

// ---------- 载入 profit ----------
const profit = readJson(PROFIT);
const companies = profit.companies || {};

// 建索引 ticker -> Map(end -> quarter)
const qIndex = new Map();
for (const [ticker, c] of Object.entries(companies)) {
  const m = new Map();
  for (const q of c.quarters || []) m.set(q.end, q);
  qIndex.set(ticker, m);
}

const patches = loadPatches();

// ---------- 统计容器 ----------
const stat = {
  mode: CHECK ? 'check' : 'write',
  files: { backfill_A: 0, backfill_HKB: 0, backfill_HKC: 0, backfill_FX: 0 },
  periodsMatched: 0,
  periodSkippedStagingOnly: [],   // {ticker,end}
  companyMissing: [],             // ticker
  // per-field: written / unchanged / skippedGuard / skippedConflict / nullValue
  fields: Object.fromEntries(FIELDS.map(f => [f, { written: 0, unchanged: 0, skippedGuard: 0, skippedConflict: 0, nullValue: 0 }])),
  periodsWritten: 0,             // 至少写了一个字段的期数（write 模式）/ 计划写（check 模式）
  periodsTouched: 0,             // 匹配到的期数
  conflicts: [],                 // {ticker,end,field,old,new,action}
  guardrailSkips: [],            // {ticker,end,field,reason,value,revenue}
  structTight: [],               // {ticker,end,rd,sga,sum,gross,ratio}  rd+sga>gross*1.05（仍写入，仅报告）
  opIncGtGross: [],              // {ticker,end,opInc,gross}
  perCompany: {},                // ticker -> {name, patched, writtenPeriods, fields, skipped, conflicts}
};

const pc = ticker => {
  if (!stat.perCompany[ticker]) {
    stat.perCompany[ticker] = {
      name: (companies[ticker] && companies[ticker].name) || ticker,
      patched: 0, matched: 0, writtenPeriods: 0,
      fields: Object.fromEntries(FIELDS.map(f => [f, 0])),
      guardSkips: 0, conflicts: 0, stagingOnly: 0,
    };
  }
  return stat.perCompany[ticker];
};

// 每个 patch 处理
for (const p of patches) {
  stat.files[p.src.replace('.json', '')]++;
  const ci = pc(p.ticker);
  ci.patched++;
  if (!companies[p.ticker]) { stat.companyMissing.push(p.ticker); continue; }
  const qm = qIndex.get(p.ticker);
  const q = qm && qm.get(p.end);
  if (!q) { stat.periodSkippedStagingOnly.push({ ticker: p.ticker, end: p.end }); ci.stagingOnly++; continue; }

  stat.periodsMatched++; ci.matched++;
  const revenue = isNum(q.revenue) ? q.revenue : null;

  // --- 逐字段护栏 ---
  const cand = {}; // field -> {write:bool, value, reason?, eff}
  for (const f of FIELDS) {
    const v = p.fields[f];
    if (v == null) { stat.fields[f].nullValue++; cand[f] = { write: false, eff: null }; continue; }
    let skipReason = null;
    if (!isNum(v)) skipReason = 'not-number';
    else if (f === 'gross') {
      if (revenue == null) skipReason = 'no-revenue';
      else if (v < 0) {
        if (!NEG_GROSS_OK.has(p.ticker)) skipReason = 'negative-gross-not-whitelisted';
        else if (!(v <= revenue * GROSS_REV_RATIO)) skipReason = 'gross>revenue';
      } else {
        const sameSign = v === 0 ? revenue >= 0 : Math.sign(v) === Math.sign(revenue);
        if (!sameSign) skipReason = 'gross-sign-mismatch';
        else if (!(v <= revenue * GROSS_REV_RATIO)) skipReason = 'gross>revenue';
      }
    } else if (f === 'opInc') {
      if (revenue == null) skipReason = 'no-revenue';
      else if (!(Math.abs(v) <= Math.max(Math.abs(revenue) * OPINC_REV_MULT, OPINC_ABS_FLOOR))) skipReason = 'opInc-out-of-range';
    } else if (f === 'rd') {
      if (!(v >= 0)) skipReason = 'rd-negative';
    } else if (f === 'sga') {
      if (!(v >= 0)) skipReason = 'sga-negative';
    }
    if (skipReason) {
      stat.fields[f].skippedGuard++; ci.guardSkips++;
      stat.guardrailSkips.push({ ticker: p.ticker, end: p.end, field: f, reason: skipReason, value: v, revenue });
      cand[f] = { write: false, guardSkipped: true, eff: null };
      continue;
    }
    cand[f] = { write: true, value: v, eff: v };
  }

  // --- 冲突 / 幂等判定（对通过护栏的写候选） ---
  for (const f of FIELDS) {
    if (!cand[f].write) continue;
    const old = q[f];
    if (old == null) {
      // 待写
    } else if (isNum(old) && old === cand[f].value) {
      stat.fields[f].unchanged++;
      cand[f] = { write: false, unchanged: true, eff: old };
    } else {
      // 冲突
      const action = FORCE ? 'overwritten' : 'kept-old';
      stat.fields[f].skippedConflict++; ci.conflicts++;
      stat.conflicts.push({ ticker: p.ticker, end: p.end, field: f, old, new: cand[f].value, action });
      cand[f] = FORCE
        ? { write: true, value: cand[f].value, eff: cand[f].value, forced: true }
        : { write: false, conflict: true, eff: old };
    }
  }

  // --- 组合护栏：荒谬值检测（rd/sga 远超 gross 时跳单字段）+ 结构偏紧登记 ---
  // 有效 gross = 本期最终会有的 gross（写入值或已有旧值）
  const effGross = (cand.gross && cand.gross.write) ? cand.gross.value
    : (isNum(q.gross) ? q.gross : null);
  // 荒谬值：仅当 gross>0 时可判定；rd 或 sga 超过 gross*2 视为明显错误，跳该单字段
  if (effGross != null && effGross > 0) {
    for (const f of ['rd', 'sga']) {
      if (!(cand[f] && cand[f].write)) continue;
      const v = cand[f].value;
      if (v > effGross * ABSURD_MULT) {
        stat.fields[f].skippedGuard++; ci.guardSkips++;
        stat.guardrailSkips.push({ ticker: p.ticker, end: p.end, field: f, reason: f + '>gross*2', value: v, revenue, gross: effGross });
        cand[f] = { write: false, guardSkipped: true, eff: null };
      }
    }
  }
  // 结构偏紧清单：最终 rd+sga > gross*1.05 —— 真实披露值仍写入，仅登记供人工知情
  {
    const rdF = (cand.rd && cand.rd.write) ? cand.rd.value : (isNum(q.rd) ? q.rd : null);
    const sgaF = (cand.sga && cand.sga.write) ? cand.sga.value : (isNum(q.sga) ? q.sga : null);
    if (effGross != null && effGross > 0 && (rdF != null || sgaF != null)) {
      const sum = (rdF || 0) + (sgaF || 0);
      if (sum > effGross * RD_SGA_RATIO) {
        stat.structTight.push({ ticker: p.ticker, end: p.end, rd: rdF, sga: sgaF, sum, gross: effGross, ratio: +(sum / effGross).toFixed(4) });
      }
    }
  }

  // --- 写入（或计划写入） ---
  let wroteAny = false;
  for (const f of FIELDS) {
    if (!cand[f].write) continue;
    if (!CHECK) q[f] = cand[f].value;
    stat.fields[f].written++; ci.fields[f]++;
    wroteAny = true;
  }
  if (wroteAny) { stat.periodsWritten++; ci.writtenPeriods++; }
  stat.periodsTouched++;

  // --- 记录可疑：最终 effective gross / opInc 同时存在且 opInc>gross ---
  const effOp = (cand.opInc && cand.opInc.write) ? cand.opInc.value : (isNum(q.opInc) ? q.opInc : null);
  if (effGross != null && effOp != null && effOp > effGross) {
    stat.opIncGtGross.push({ ticker: p.ticker, end: p.end, opInc: effOp, gross: effGross, revenue });
  }
}

// ---------- 汇总 ----------
stat.totals = {
  companiesPatched: Object.keys(stat.perCompany).length,
  periodsMatched: stat.periodsMatched,
  periodsSkippedStagingOnly: stat.periodSkippedStagingOnly.length,
  companyMissing: stat.companyMissing.length,
  periodsWritten: stat.periodsWritten,
  fieldsWritten: FIELDS.reduce((s, f) => s + stat.fields[f].written, 0),
  fieldsUnchanged: FIELDS.reduce((s, f) => s + stat.fields[f].unchanged, 0),
  fieldsSkippedGuard: FIELDS.reduce((s, f) => s + stat.fields[f].skippedGuard, 0),
  fieldsSkippedConflict: FIELDS.reduce((s, f) => s + stat.fields[f].skippedConflict, 0),
  conflicts: stat.conflicts.length,
  opIncGtGross: stat.opIncGtGross.length,
  structTightPeriods: stat.structTight.length,
};

// ---------- 写盘 + 镜像 ----------
if (!CHECK) {
  fs.writeFileSync(PROFIT, JSON.stringify(profit, null, 2));
  const payload = 'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n';
  fs.writeFileSync(MIRROR, payload);
  // 断言镜像与 json 解析后深等
  const a = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
  const mirrorRaw = fs.readFileSync(MIRROR, 'utf8');
  const m = mirrorRaw.match(/^window\.__PROFIT_DATA\s*=\s*([\s\S]*);\s*$/);
  if (!m) throw new Error('mirror payload shape mismatch');
  const b = JSON.parse(m[1]);
  assert.deepStrictEqual(b, a, 'MIRROR MISMATCH: data/profit.json.js != data/profit.json');
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (!eq) throw new Error('MIRROR MISMATCH: data/profit.json.js != data/profit.json');
  stat.mirror = { written: MIRROR, deepEqual: true, bytes: mirrorRaw.length };
}

// ---------- 输出 ----------
const statsDir = path.join(ROOT, 'tmp-merge');
fs.mkdirSync(statsDir, { recursive: true });
fs.writeFileSync(path.join(statsDir, 'merge_stats.json'), JSON.stringify(stat, null, 1));

const fmt = (label, v) => console.log(String(label).padEnd(26), v);
console.log('=== merge_fundamentals ' + stat.mode.toUpperCase() + (FORCE ? ' --force' : '') + ' ===');
fmt('companies patched:', stat.totals.companiesPatched);
fmt('periods matched:', stat.totals.periodsMatched);
fmt('periods written:', stat.totals.periodsWritten);
fmt('fields written:', stat.totals.fieldsWritten);
for (const f of FIELDS) {
  const s = stat.fields[f];
  fmt('  ' + f + ' written:', s.written + '  (unchanged ' + s.unchanged + ', guard-skip ' + s.skippedGuard + ', conflict ' + s.skippedConflict + ', null ' + s.nullValue + ')');
}
fmt('staging-only periods:', stat.totals.periodsSkippedStagingOnly);
fmt('missing companies:', stat.totals.companyMissing);
fmt('conflicts:', stat.totals.conflicts);
fmt('guardrail skips:', stat.totals.fieldsSkippedGuard);
fmt('opInc>gross (suspect):', stat.totals.opIncGtGross);
fmt('rd+sga>gross*1.05 (struct-tight periods):', stat.totals.structTightPeriods);
if (stat.mirror) console.log('mirror:', stat.mirror.written, 'deepEqual=' + stat.mirror.deepEqual, 'bytes=' + stat.mirror.bytes);
console.log('\nstats -> tmp-merge/merge_stats.json');
