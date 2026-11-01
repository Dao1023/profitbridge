// verify_units_guard.mjs — 防回归断言：交叉校验 data/segments.json 与 data/profit.json。
//
// 目的：对「本次被触碰公司」的最近 4 个报告期（按该公司 segments 期末升序取后 4 个），
// 断言 segSum_usd / (revenue_native × fxToUsd) ∈ [0.98, 1.02]。
//   分子 segSum_usd = segments 顶层分部值之和（USD-M，children 不计入父值）。
//   分母 revenue_native × fxToUsd = 该期本币营收折算美元：季度期用当季 profit 行；
//   年度/半年度期，若 profit 有 annual/cumulative 行则直取，否则取该期末前最后 4 个"单季" profit 行之和
//   （避免 5 季窗口多算 1 季的旧 bug）。
// 本文件的 matchRev/ratioFor 逻辑直接沿用 tmp-integrate/analyze.js（单位硬门同一套），未另立新口径。
//
// 纯 node，无需浏览器/服务。退出码：0 全通过；1 有越界。
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJ = (p) => JSON.parse(fs.readFileSync(join(ROOT, p), 'utf8'));
const SEG = readJ('data/segments.json');
const PROF = readJ('data/profit.json');

// 本次被触碰的 24 家公司（与 tmp-integrate/verify_units.js 的 TOUCHED 一致）
const TOUCHED = ['MU', 'V', 'IBM', 'MCD', 'SBUX', 'ADBE', 'PLTR', 'DELL', 'HPQ', 'BABA',
  '00700.HK', '03690.HK', '09633.HK', '02097.HK', '01398.HK', '03968.HK', '00981.HK',
  '01024.HK', '03888.HK', '00941.HK', '00728.HK', '01810.HK', '00151.HK', '00992.HK'];

const segSum = (list) => list.reduce((a, it) => a + (it.value || 0), 0);
const isQ = (p) => /^q/.test(p.periodType || '');

function matchRev(tk, end, pt) {
  const rs = (PROF.companies[tk] || {}).quarters || [];
  const E = new Date(end).getTime();
  const direct = rs.find((x) => x.end === end);
  if (pt === 'quarter' || pt === 'q') {
    if (!direct) return null;
    return { rev: direct.revenue, fx: direct.fxToUsd == null ? 1 : direct.fxToUsd };
  }
  if (direct && (direct.periodType === 'annual' || direct.cumulative === true)) {
    return { rev: direct.revenue, fx: direct.fxToUsd == null ? 1 : direct.fxToUsd };
  }
  let qs = rs.filter((x) => new Date(x.end).getTime() <= E && isQ(x));
  qs.sort((a, b) => new Date(a.end) - new Date(b.end));
  qs = qs.slice(-4);
  if (!qs.length) return null;
  const rev = qs.reduce((a, x) => a + x.revenue, 0);
  const fxRow = direct || qs[qs.length - 1];
  return { rev, fx: fxRow.fxToUsd == null ? 1 : fxRow.fxToUsd };
}
function ratioFor(tk, end, list, pt) {
  const m = matchRev(tk, end, pt);
  const s = segSum(list);
  if (!m || m.rev == null) return { segSum: s, rev: null, fx: null, ratio: null };
  return { segSum: s, rev: m.rev, fx: m.fx, ratio: s / (m.rev * m.fx) };
}
function periodsFor(tk) {
  const co = SEG.companies[tk] || {};
  const rows = [];
  for (const end of Object.keys(co.quarters || {})) rows.push({ end, pt: (co.periodTypes || {})[end] || 'quarter', list: co.quarters[end] });
  for (const end of Object.keys(co.annualQuarters || {})) rows.push({ end, pt: (co.periodTypes || {})[end] || 'annual', list: co.annualQuarters[end] });
  rows.sort((a, b) => (a.end < b.end ? -1 : 1));
  return rows;
}

let fails = 0;
const LO = 0.98, HI = 1.02;
console.log(`# 单位一致性防回归（最近4期 / ${TOUCHED.length} 家被触碰公司，阈值 [${LO},${HI}]）`);
for (const tk of TOUCHED) {
  const rows = periodsFor(tk).slice(-4); // 最近 4 个报告期
  if (!rows.length) { console.log(`FAIL ${tk} 无分部期`); fails++; continue; }
  for (const r of rows) {
    const res = ratioFor(tk, r.end, r.list, r.pt);
    const ok = res.ratio != null && res.ratio >= LO && res.ratio <= HI;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${tk} ${r.end} ${r.pt} ratio=${res.ratio == null ? 'NA' : res.ratio.toFixed(5)} segSum=${res.segSum.toFixed(3)} rev=${res.rev} fx=${res.fx}`);
  }
}
console.log(`\nSUMMARY ${fails === 0 ? 'ALL PASS' : fails + ' 处越界'}`);
process.exit(fails === 0 ? 0 : 1);
