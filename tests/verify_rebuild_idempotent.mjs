#!/usr/bin/env node
/**
 * verify_rebuild_idempotent.mjs — 全量重建必须与磁盘 data/profit.json 逐字节一致（幂等 / 不丢数）
 *
 * 背景（本测试锁死的两个缺陷）:
 *   1. scripts/merge_batches.mjs 曾硬编码 batch1-8，库里已有 batch9-12，于是「全量重建」会静默丢掉
 *      batch9-12 追加的 7 个 2026-09-30 期（BIDU/CRWV/00700.HK/00992.HK/00981.HK/01024.HK/688981.SS）。
 *   2. stage1 整条重建只写 revenue/netInc(+fx)，会抹掉 stage2 补进去的 gross/opInc/rd/sga；
 *      scripts/merge_fundamentals.mjs 再按固定 FIELDS 顺序追加，使 00981.HK 三个负 gross 期的键序
 *      从 ...,opInc,rd,sga,gross 变成 ...,gross,opInc,rd,sga（91 家不再逐字节不变）。
 *
 * 断言:
 *   A. stage1（merge_batches --out-dir）输出与磁盘 profit.json 逐字节相同（CRLF/LF 归一后，含 updated），
 *      profit.json.js 镜像与该输出 deepEqual。
 *   B. stage2（merge_fundamentals --in --out-dir）再跑一遍仍逐字节相同（需要 tmp-backfill/，缺失则 SKIP）。
 *   C. 合成用例：负 gross 期缺 gross/opInc/rd/sga 时，stage2 补写后的键序必须与磁盘一致
 *      （负 gross 排最后、正 gross 排最前），锁死键序回归。
 *   D. 全程不修改 data/**（前后 sha256 + size 比对）。
 *
 * 用法: node tests/verify_rebuild_idempotent.mjs [--keep]
 * 退出码: 0 = 全部通过；1 = 有断言失败
 *
 * 依赖: 非 USD 条目需要 fx 汇率。仓库内 tmp-merge/fx_cache.json 存在时离线可用；否则会请求
 *       frankfurter.app（ECB），无网络时 A/B 断言会失败——这是真实信号，不是测试缺陷。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KEEP = process.argv.includes('--keep');

let fails = 0;
const ok = (cond, msg, detail) => {
  if (cond) console.log('ok  ', msg);
  else { console.error('FAIL', msg); if (detail) console.error(String(detail).slice(0, 4000)); fails++; }
};
const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function run(args, label) {
  try {
    return execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (e) {
    console.error(`\n--- ${label} FAILED (exit ${e.status}) ---`);
    console.error(String(e.stdout || '').slice(-4000));
    console.error(String(e.stderr || '').slice(-8000));
    return null;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-rebuild-'));
console.log('tmp dir:', tmp);

// ---------- 0) data/** 基线快照 ----------
const watch = ['data/profit.json', 'data/profit.json.js', 'data/companies.json', 'data/segments.json'];
const baseline = new Map();
for (const rel of watch) {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) baseline.set(rel, { sha: sha(p), size: fs.statSync(p).size });
}

const diskPath = path.join(ROOT, 'data', 'profit.json');
const diskTxt = norm(fs.readFileSync(diskPath));
const disk = JSON.parse(diskTxt);
const diskPeriods = Object.values(disk.companies || {}).reduce((s, e) => s + (e.quarters || []).length, 0);
console.log(`disk: companies=${Object.keys(disk.companies || {}).length} periods=${diskPeriods} updated=${disk.updated}`);

// ---------- A) stage1 全量重建到临时目录 ----------
const stage1Dir = path.join(tmp, 'stage1');
console.log('\n[A] stage1: node scripts/merge_batches.mjs --out-dir=<tmp>/stage1');
const s1 = run([path.join(ROOT, 'scripts', 'merge_batches.mjs'), `--out-dir=${stage1Dir}`], 'stage1');
if (s1 === null) {
  ok(false, 'A: stage1 重建应成功退出（guard/regression 拦截视为失败：全量重建必须无需 --force）');
} else {
  const outPath = path.join(stage1Dir, 'profit.json');
  const mirrorPath = path.join(stage1Dir, 'profit.json.js');
  ok(fs.existsSync(outPath), 'A1: stage1 产出 profit.json');
  const outTxt = fs.existsSync(outPath) ? norm(fs.readFileSync(outPath)) : '';
  ok(outTxt === diskTxt, `A2: stage1 输出与磁盘逐字节一致（${Buffer.byteLength(diskTxt)} B）`, outTxt.slice(0, 400));

  const out = JSON.parse(outTxt || '{}');
  const outPeriods = Object.values(out.companies || {}).reduce((s, e) => s + (e.quarters || []).length, 0);
  ok(outPeriods === diskPeriods, `A3: 期数不丢（${diskPeriods} -> ${outPeriods}）`);

  // 丢期回归：磁盘每个 (ticker,end) 都必须出现在重建结果里
  const missing = [];
  for (const [tk, e] of Object.entries(disk.companies || {})) {
    const have = new Set(((out.companies || {})[tk]?.quarters || []).map(q => q.end));
    for (const q of e.quarters || []) if (!have.has(q.end)) missing.push(`${tk} ${q.end}`);
  }
  ok(missing.length === 0, 'A4: 磁盘所有期点都在重建结果中（batch9-12 未丢）', missing.slice(0, 40).join('\n'));

  // 键序回归：同 (ticker,end) 的 key 顺序必须一致
  const orderDiff = [];
  for (const [tk, e] of Object.entries(disk.companies || {})) {
    const m = new Map(((out.companies || {})[tk]?.quarters || []).map(q => [q.end, q]));
    for (const q of e.quarters || []) {
      const o = m.get(q.end);
      if (!o) continue;
      const kb = Object.keys(q).join(','), kn = Object.keys(o).join(',');
      if (kb !== kn) orderDiff.push(`${tk} ${q.end}: ${kb} -> ${kn}`);
    }
  }
  ok(orderDiff.length === 0, 'A5: 所有期点键序与磁盘一致', orderDiff.slice(0, 40).join('\n'));

  ok(fs.existsSync(mirrorPath), 'A6: stage1 产出 profit.json.js 镜像');
  if (fs.existsSync(mirrorPath)) {
    const raw = fs.readFileSync(mirrorPath, 'utf8');
    const m = raw.match(/^window\.__PROFIT_DATA\s*=\s*([\s\S]*);\s*$/);
    ok(!!m, 'A7: 镜像 payload 形状 window.__PROFIT_DATA = ...;');
    let parsed = null;
    try { parsed = m ? JSON.parse(m[1]) : null; } catch { parsed = null; }
    ok(parsed !== null && JSON.stringify(parsed) === JSON.stringify(out), 'A8: 镜像与 profit.json deepEqual');
  }
}

// ---------- B) stage2 补数层再跑一遍 ----------
const backfillDir = path.join(ROOT, 'tmp-backfill');
console.log('\n[B] stage2: node scripts/merge_fundamentals.mjs --in=<stage1>/profit.json');
if (!fs.existsSync(backfillDir)) {
  console.log('SKIP B: tmp-backfill/ 不存在（补数 staging 未随仓库分发），stage1 单跑已完成 A 组逐字节断言');
} else if (s1 === null) {
  ok(false, 'B: stage1 失败，无法继续 stage2');
} else {
  const stage2Dir = path.join(tmp, 'stage2');
  const s2 = run([
    path.join(ROOT, 'scripts', 'merge_fundamentals.mjs'),
    `--in=${path.join(stage1Dir, 'profit.json')}`,
    `--out-dir=${stage2Dir}`,
  ], 'stage2');
  ok(s2 !== null, 'B1: stage2 成功退出', s2 === null ? '见上方 stderr' : '');
  if (s2 !== null) {
    const outTxt = norm(fs.readFileSync(path.join(stage2Dir, 'profit.json')));
    ok(outTxt === diskTxt, `B2: stage1+stage2 与磁盘逐字节一致（${Buffer.byteLength(diskTxt)} B）`, outTxt.slice(0, 400));
    const mirrorRaw = fs.readFileSync(path.join(stage2Dir, 'profit.json.js'), 'utf8');
    const m = mirrorRaw.match(/^window\.__PROFIT_DATA\s*=\s*([\s\S]*);\s*$/);
    let parsed = null;
    try { parsed = m ? JSON.parse(m[1]) : null; } catch { parsed = null; }
    ok(parsed !== null && JSON.stringify(parsed) === JSON.stringify(JSON.parse(outTxt)), 'B3: stage2 镜像与输出 deepEqual');
    // stage2 在完整重建上应当是幂等的空操作（stage1 的 reconcile 已保留全部补数字段）
    const written = /periods written:\s+(\d+)/.exec(s2);
    ok(!!written && written[1] === '0', `B4: stage2 无重复写入（periods written=${written ? written[1] : '?'}）`, s2.slice(-1500));
  }
}

// ---------- C) 键序回归：负 gross 期的补写顺序 ----------
// 合成最小数据集：00981.HK 的负 gross 期（磁盘键序 ...,opInc,rd,sga,gross）+ 一个正 gross 期。
// stage2 只能 append，追加顺序决定键序；负 gross 历史上被护栏拒绝、白名单后补写，故必须排在最后。
{
  console.log('\n[C] 键序回归: 负 gross 期补写后键序必须与磁盘一致');
  const src = disk.companies['00981.HK'];
  if (!src) { ok(false, 'C0: 磁盘缺少 00981.HK，无法构造键序用例'); }
  else {
    const neg = (src.quarters || []).filter(q => typeof q.gross === 'number' && q.gross < 0);
    const pos = (src.quarters || []).filter(q => typeof q.gross === 'number' && q.gross > 0);
    ok(neg.length > 0 && pos.length > 0, `C1: 找到负/正 gross 样本（neg=${neg.length} pos=${pos.length}）`);
    const picks = [...neg.slice(0, 3), pos[0]].filter(Boolean);
    const baseKeys = ['end', 'revenue', 'netInc', 'periodType', 'fxToUsd'];
    const synthDir = path.join(tmp, 'keyorder');
    const bfDir = path.join(synthDir, 'backfill');
    fs.mkdirSync(bfDir, { recursive: true });
    const slim = {
      updated: '2026-01-01',
      companies: {
        '00981.HK': {
          name: src.name, currency: src.currency, frequency: src.frequency || 'q',
          quarters: picks.map(q => Object.fromEntries(baseKeys.filter(k => k in q).map(k => [k, q[k]]))),
        },
      },
    };
    fs.writeFileSync(path.join(synthDir, 'profit.json'), JSON.stringify(slim, null, 2) + '\n');
    const patched = {};
    for (const q of picks) patched[q.end] = { gross: q.gross, opInc: q.opInc, rd: q.rd, sga: q.sga };
    fs.writeFileSync(path.join(bfDir, 'backfill_HKB.json'), JSON.stringify({ companies: { '00981.HK': { patched } } }, null, 2) + '\n');
    fs.writeFileSync(path.join(bfDir, 'backfill_A.json'), JSON.stringify({ companies: {} }, null, 2) + '\n');
    fs.writeFileSync(path.join(bfDir, 'backfill_FX.json'), JSON.stringify({ companies: {} }, null, 2) + '\n');
    fs.writeFileSync(path.join(bfDir, 'backfill_HKC.json'), JSON.stringify({ companies: {} }, null, 2) + '\n');

    const outDir = path.join(synthDir, 'out');
    const r = run([
      path.join(ROOT, 'scripts', 'merge_fundamentals.mjs'),
      `--in=${path.join(synthDir, 'profit.json')}`,
      `--out-dir=${outDir}`,
      `--backfill-dir=${bfDir}`,
    ], 'keyorder');
    ok(r !== null, 'C2: 合成 stage2 成功退出', r === null ? '见上方 stderr' : '');
    if (r !== null) {
      const outp = readJson(path.join(outDir, 'profit.json'));
      const got = new Map((outp.companies['00981.HK'].quarters || []).map(q => [q.end, Object.keys(q).join(',')]));
      for (const q of picks) {
        const expect = Object.keys(q).join(',');
        ok(got.get(q.end) === expect, `C3 ${q.end}${q.gross < 0 ? ' (负 gross)' : ' (正 gross)'} 键序 = ${expect}`, `got: ${got.get(q.end)}`);
      }
    }
  }
}

// ---------- D) data/** 未被修改 ----------
{
  console.log('\n[D] data/** 未被修改');
  const changed = [];
  for (const [rel, b] of baseline) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { changed.push(`${rel}: DELETED`); continue; }
    const s = sha(p);
    if (s !== b.sha) changed.push(`${rel}: sha256 ${b.sha.slice(0, 12)} -> ${s.slice(0, 12)}`);
  }
  ok(changed.length === 0, 'D1: data/profit.json / profit.json.js / companies.json / segments.json 未变', changed.join('\n'));
}

if (!KEEP) fs.rmSync(tmp, { recursive: true, force: true });
else console.log('\n--keep: 保留', tmp);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
