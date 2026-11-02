#!/usr/bin/env node
/**
 * verify.mjs — 抽样 20 家回源核对（只读，网络走代理）
 *   US/MIX(SEC 20-F)：data.sec.gov companyfacts XBRL
 *   A 股：东财 datacenter RPT_F10_FINANCE_GINCOME（累计值，单季=同财年差分）
 *   港股：东财 datacenter RPT_HKF10_FN_MAININDICATOR（累计值，单季=同财年差分）
 *
 * 输出：evidence/*.json 原始证据 + verify_result.json + stdout 对照表
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findRoot(d) { let cur = d; for (let i = 0; i < 10; i++) { if (fs.existsSync(path.join(cur, 'data', 'profit.json'))) return cur; cur = path.dirname(cur); } throw new Error('repo root not found above ' + d); }
const ROOT = findRoot(__dirname);
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'profit.json'), 'utf8'));
const EV = path.join(__dirname, 'evidence');
fs.mkdirSync(EV, { recursive: true });

const UA = 'profitbridge-audit admin@example.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) { last = 'HTTP ' + r.status; await sleep(800 * (i + 1)); continue; }
      return await r.json();
    } catch (e) { last = e.message; await sleep(800 * (i + 1)); }
  }
  throw new Error(last);
}
const m = (v) => (v == null ? null : Math.round(v / 1e6 * 1000) / 1000); // 元→百万, 3位

/* ============ 样本定义 ============ */
const SAMPLE = [
  // US SEC quarterly (10-Q/10-K)
  { tk: 'NVDA', mk: 'US', cik: 1045810 },
  { tk: 'AAPL', mk: 'US', cik: 320193 },
  { tk: 'MSFT', mk: 'US', cik: 789019 },
  { tk: 'TSLA', mk: 'US', cik: 1318605 },
  { tk: 'INTC', mk: 'US', cik: 50863 },
  { tk: 'XNET', mk: 'US', cik: 1510593, preferAnnual: true }, // 20-F 年度 + 季度
  // A 股 东财
  { tk: '002594.SZ', mk: 'A' },
  { tk: '000333.SZ', mk: 'A' },
  { tk: '600519.SS', mk: 'A' },
  { tk: '300750.SZ', mk: 'A' },
  { tk: '688256.SS', mk: 'A' },
  { tk: '688795.SS', mk: 'A' },
  // 港股 hk-mixed 东财
  { tk: '00700.HK', mk: 'HK' },
  { tk: '00941.HK', mk: 'HK' },
  { tk: '01810.HK', mk: 'HK' },
  { tk: '09633.HK', mk: 'HK' },
  { tk: '00151.HK', mk: 'HK' },
  { tk: '02097.HK', mk: 'HK' },
  // MIXED 外币申报（SEC 20-F, 报告币 CNY）
  { tk: 'BABA', mk: 'US', cik: 1577552, preferAnnual: true },
  { tk: 'PDD', mk: 'US', cik: 1737806, preferAnnual: true },
];

const TAGS = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  gross: ['GrossProfit'],
  opInc: ['OperatingIncomeLoss'],
  netInc: ['NetIncomeLoss', 'ProfitLoss'],
  rd: ['ResearchAndDevelopmentExpense'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
};

function secFactsAll(facts, tag, wantUnit) {
  const bags = [];
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const f = facts[ns] && facts[ns][tag];
    if (!f) continue;
    for (const [unit, arr] of Object.entries(f.units)) bags.push({ unit, arr });
  }
  if (!bags.length) return null;
  let bag = bags.find((b) => b.unit === wantUnit) || bags[0];
  return bag;
}
// 提取某 end 的单季值（优先直报季度 80-100d；否则 FY-9M；否则 9M-6M）
function secValueAt(facts, tags, endTarget, wantUnit, wantKind /* 'q' | 'annual' */) {
  for (const tag of tags) {
    const bag = secFactsAll(facts, tag, wantUnit);
    if (!bag) continue;
    const rows = bag.arr.filter((e) => e.end === endTarget).map((e) => ({ ...e, dur: (new Date(e.end) - new Date(e.start)) / 864e5 }));
    if (!rows.length) continue;
    if (wantKind === 'annual') {
      const fy = rows.filter((e) => e.dur >= 330 && e.dur <= 400).sort((a, b) => (a.filed < b.filed ? 1 : -1));
      if (fy.length) return { tag, unit: bag.unit, value: fy[0].val, raw: fy[0], kind: 'annual', dur: fy[0].dur };
      continue;
    }
    // quarter
    const q = rows.filter((e) => e.dur >= 75 && e.dur <= 105).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    if (q.length) return { tag, unit: bag.unit, value: q[0].val, raw: q[0], kind: 'q-direct', dur: q[0].dur };
    const nine = rows.filter((e) => e.dur >= 250 && e.dur <= 290).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    const fy = rows.filter((e) => e.dur >= 330 && e.dur <= 400).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    if (fy.length && nine.length) return { tag, unit: bag.unit, value: fy[0].val - nine[0].val, raw: { fy: fy[0], nine: nine[0] }, kind: 'q=fy-9m', dur: null };
    const six = rows.filter((e) => e.dur >= 160 && e.dur <= 200).sort((a, b) => (a.filed < b.filed ? 1 : -1));
    if (nine.length && six.length) return { tag, unit: bag.unit, value: nine[0].val - six[0].val, raw: { nine: nine[0], six: six[0] }, kind: 'q=9m-6m', dur: null };
  }
  return null;
}

/* ---------- 东财 ---------- */
function emStageA(name) {
  if (!name) return null;
  if (name.includes('一季')) return 1;
  if (name.includes('中报') || name.includes('半年')) return 2;
  if (name.includes('三季')) return 3;
  if (name.includes('年报')) return 4;
  return null;
}
function emStageHK(code) { return { '003': 1, '002': 2, '004': 3, '001': 4 }[code] || null; }

async function emFetchA(ticker) {
  const secu = ticker.replace(/\.SS$/, '.SH');
  const base = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
  const u = `${base}?reportName=RPT_F10_FINANCE_GINCOME&columns=ALL&filter=${encodeURIComponent(`(SECUCODE="${secu}")`)}&pageNumber=1&pageSize=200&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC`;
  const j = await getJSON(u);
  return (j.result && j.result.data) || [];
}
async function emFetchHK(ticker) {
  const base = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
  const u = `${base}?reportName=RPT_HKF10_FN_MAININDICATOR&columns=ALL&filter=${encodeURIComponent(`(SECUCODE="${ticker}")`)}&pageNumber=1&pageSize=200&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC`;
  const j = await getJSON(u);
  return (j.result && j.result.data) || [];
}

// A/HK：对目标 end 用累计差分求单季（or 年度直接取）
function emSingle(rows, endTarget, wantKind, stageFn) {
  // rows 已按 REPORT_DATE 降序
  const idx = rows.findIndex((r) => String(r.REPORT_DATE).slice(0, 10) === endTarget);
  if (idx < 0) return { error: 'end not found in source rows' };
  const cur = rows[idx];
  const st = stageFn(cur);
  if (wantKind === 'annual') return { stage: st, kind: 'annual-cumulative', row: cur };
  if (st === 1) return { stage: 1, kind: 'q1=cumulative', row: cur, prev: null };
  // 需要上一步累计
  const prev = rows[idx + 1];
  if (!prev) return { stage: st, kind: 'q=missing-prev', row: cur, prev: null };
  const pst = stageFn(prev);
  return { stage: st, prevStage: pst, kind: pst === 4 ? 'q=cumulative(first of FY)' : `q=cum(cur)-cum(prev stage${pst})`, row: cur, prev, stageMatch: pst === st - 1 };
}

const FIELD_SRC = {
  A: { revenue: 'TOTAL_OPERATE_INCOME', gross: ['TOTAL_OPERATE_INCOME', 'OPERATE_COST'], opInc: 'OPERATE_PROFIT', netInc: 'PARENT_NETPROFIT', rd: 'RESEARCH_EXPENSE', sga: ['SALE_EXPENSE', 'MANAGE_EXPENSE'] },
  HK: { revenue: 'OPERATE_INCOME', gross: 'GROSS_PROFIT', opInc: 'OPERATE_PROFIT', netInc: 'HOLDER_PROFIT' },
};

function emCum(field, rows, row, mk) {
  if (row == null) return null;
  const spec = FIELD_SRC[mk === 'A' ? 'A' : 'HK'];
  const f = spec[field];
  if (f == null) return null;
  const one = (k) => (typeof row[k] === 'number' ? row[k] : null);
  if (Array.isArray(f)) {
    if (field === 'gross') { const r = one(f[0]), c = one(f[1]); return r != null && c != null ? r - c : null; }
    if (field === 'sga') { const s = one(f[0]), g = one(f[1]); return s != null && g != null ? s + g : null; }
  }
  return one(f);
}
function emCompute(field, rows, pick) {
  const cur = emCum(field, rows, pick.row, pick.mk);
  if (cur == null) return null;
  const cumulative = pick.kind.startsWith('annual') || pick.kind.startsWith('q1') || pick.prevStage === 4;
  if (cumulative) return cur;
  if (!pick.prev) return null;
  const prev = emCum(field, rows, pick.prev, pick.mk);
  return prev == null ? null : cur - prev;
}

/* ============ 主流程 ============ */
const results = [];
const pickEnds = (c, preferAnnual) => {
  const qs = c.quarters.slice().sort((a, b) => (a.end < b.end ? -1 : 1));
  if (preferAnnual) {
    const anns = qs.filter((q) => q.periodType === 'annual');
    if (anns.length) {
      const latest = anns[anns.length - 1];
      const targetYear = Number(latest.end.slice(0, 4)) - 3;
      const hist = anns.filter((q) => Math.abs(Number(q.end.slice(0, 4)) - targetYear) <= 1).pop() || anns[Math.max(0, anns.length - 4)];
      return [latest, hist].filter(Boolean);
    }
  }
  const latest = qs[qs.length - 1];
  // 历史：距最新约 4 年、同 periodClass
  const cls = (q) => (q.periodType === 'annual' ? 'annual' : ['interim'].includes(q.periodType) ? 'interim' : 'q');
  const targetYear = Number(latest.end.slice(0, 4)) - 4;
  let hist = qs.filter((q) => cls(q) === cls(latest) && Math.abs(Number(q.end.slice(0, 4)) - targetYear) <= 1).pop();
  if (!hist || hist.end === latest.end) hist = qs.filter((q) => cls(q) === cls(latest))[Math.floor(qs.filter((q) => cls(q) === cls(latest)).length / 2)];
  return [latest, hist].filter(Boolean);
};

for (const s of SAMPLE) {
  const c = P.companies[s.tk];
  const ends = pickEnds(c, s.preferAnnual);
  const rec = { ticker: s.tk, market: s.mk, currency: c.currency, frequency: c.frequency || 'q', periods: [] };
  let sourceRowsForEvidence = null;
  try {
    if (s.mk === 'US') {
      const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(s.cik).padStart(10, '0')}.json`);
      const facts = j.facts;
      const wantUnit = c.currency.startsWith('CNY') ? 'CNY' : c.currency.startsWith('EUR') ? 'EUR' : c.currency.startsWith('JPY') ? 'JPY' : 'USD';
      for (const q of ends) {
        const wantKind = q.periodType === 'annual' ? 'annual' : 'q';
        const p = { end: q.end, periodType: q.periodType || null, db: {}, src: {} };
        for (const field of ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga']) {
          p.db[field] = q[field] == null ? null : q[field];
          const r = secValueAt(facts, TAGS[field], q.end, wantUnit, wantKind);
          p.src[field] = r ? { value: m(r.value), tag: r.tag, unit: r.unit, kind: r.kind, raw: r.raw } : null;
        }
        rec.periods.push(p);
      }
      // evidence
      const ev = { ticker: s.tk, cik: s.cik, entityName: j.entityName, fetchedFor: ends.map((q) => q.end), periods: rec.periods };
      fs.writeFileSync(path.join(EV, `${s.tk}_SEC.json`), JSON.stringify(ev, null, 1));
    } else {
      const rows = s.mk === 'A' ? await emFetchA(s.tk) : await emFetchHK(s.tk);
      const stageFn = s.mk === 'A' ? (r) => emStageA(r.REPORT_DATE_NAME) : (r) => emStageHK(r.DATE_TYPE_CODE);
      sourceRowsForEvidence = rows;
      for (const q of ends) {
        const wantKind = q.periodType === 'annual' ? 'annual' : 'q';
        const pick = { mk: s.mk, ...emSingle(rows, q.end, wantKind, stageFn) };
        const p = { end: q.end, periodType: q.periodType || null, db: {}, src: {}, pickKind: pick.kind, stageMatch: pick.stageMatch };
        for (const field of ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga']) {
          p.db[field] = q[field] == null ? null : q[field];
          const cv = pick.error ? null : emCompute(field, rows, pick);
          p.src[field] = cv == null ? null : { value: m(cv) };
        }
        if (pick.row) {
          const rawKeys = FIELD_SRC[s.mk === 'A' ? 'A' : 'HK'];
          p.rawCurrent = { REPORT_DATE: String(pick.row.REPORT_DATE).slice(0, 10), REPORT_NAME: pick.row.REPORT_DATE_NAME || pick.row.REPORT_TYPE, DATE_TYPE_CODE: pick.row.DATE_TYPE_CODE };
          p.rawFields = {};
          for (const field of ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga']) {
            const f = rawKeys[field]; if (!f) continue;
            if (Array.isArray(f)) p.rawFields[field] = f.map((k) => ({ [k]: pick.row[k] }));
            else p.rawFields[field] = { [f]: pick.row[f] };
          }
        }
        if (pick.prev) {
          p.rawPrev = { REPORT_DATE: String(pick.prev.REPORT_DATE).slice(0, 10), REPORT_NAME: pick.prev.REPORT_DATE_NAME || pick.prev.REPORT_TYPE };
          p.rawPrevFields = {};
          const rawKeys = FIELD_SRC[s.mk === 'A' ? 'A' : 'HK'];
          for (const field of ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga']) {
            const f = rawKeys[field]; if (!f) continue;
            if (Array.isArray(f)) p.rawPrevFields[field] = f.map((k) => ({ [k]: pick.prev[k] }));
            else p.rawPrevFields[field] = { [f]: pick.prev[f] };
          }
        }
        if (pick.error) p.error = pick.error;
        rec.periods.push(p);
      }
      fs.writeFileSync(path.join(EV, `${s.tk}_${s.mk}.json`), JSON.stringify({ ticker: s.tk, market: s.mk, fetchedFor: ends.map((q) => q.end), rows: rows.slice(0, 12) }, null, 1));
    }
  } catch (e) {
    rec.error = e.message;
  }
  results.push(rec);
  await sleep(250);
}

fs.writeFileSync(path.join(__dirname, 'verify_result.json'), JSON.stringify(results, null, 2));

// 对照表
const diffPct = (db, sv) => (db == null || sv == null || sv === 0 ? null : Math.round((db - sv) / sv * 10000) / 100);
for (const r of results) {
  console.log(`\n=== ${r.ticker} [${r.market}/${r.currency}/${r.frequency}] ${r.error ? 'ERR:' + r.error : ''}`);
  for (const p of r.periods) {
    console.log(`  -- ${p.end} (${p.periodType || 'q'}) pick=${p.pickKind || ''} ${p.error ? p.error : ''}`);
    for (const f of ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga']) {
      const db = p.db[f], sv = p.src[f] ? p.src[f].value : null;
      if (db == null && sv == null) continue;
      console.log(`     ${f}: db=${db} src=${sv} diff=${diffPct(db, sv)}% ${p.src[f] && p.src[f].tag ? '[' + p.src[f].tag + '/' + p.src[f].kind + ']' : ''}`);
    }
  }
}
console.log('\nverify_result.json + evidence/ written');
