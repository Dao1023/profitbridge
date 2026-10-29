// validate_profit.mjs — post-fix audit: coverage matrix, value stability vs backup, gross identity
import fs from 'node:fs';
const neu = JSON.parse(fs.readFileSync('data/profit.json', 'utf8'));
const alt = JSON.parse(fs.readFileSync('archive/profit.pre_fix_backup.json', 'utf8'));

console.log('== coverage matrix ==');
for (const [tk, c] of Object.entries(neu.companies)) {
  const ends = c.quarters.map(q => q.end);
  let gaps = 0;
  for (let i = 1; i < ends.length; i++) {
    const d = (new Date(ends[i]) - new Date(ends[i - 1])) / 86400000;
    if (d < 80 || d > 105) { gaps++; console.log(`  GAP ${tk} ${ends[i - 1]} -> ${ends[i]} (${Math.round(d)}d)`); }
  }
  console.log(`${tk}: ${c.quarters.length} q  ${ends[0]}..${ends.at(-1)}  gaps=${gaps}  keys=${[...new Set(c.quarters.flatMap(q => Object.keys(q)))].filter(k => k !== 'end').join(',')}`);
}

console.log('\n== stability: pre-fix quarters that survive must have identical values ==');
let mism = 0, same = 0;
for (const [tk, c] of Object.entries(alt.companies)) {
  const nm = neu.companies[tk];
  for (const q of c.quarters) {
    const nq = nm?.quarters.find(x => x.end === q.end);
    if (!nq) { console.log(`  DROPPED ${tk} ${q.end}`); mism++; continue; }
    for (const k of Object.keys(q)) {
      if (k === 'end') continue;
      if (nq[k] !== q[k]) { console.log(`  CHANGED ${tk} ${q.end} ${k}: ${q[k]} -> ${nq[k]}`); mism++; }
    }
    same++;
  }
}
console.log(`checked ${same} quarters, ${mism} mismatches/drops`);

console.log('\n== gross identity where GrossProfit tag exists (rev - gross vs rev-cost unknown) — sanity only ==');
// 与 merge_batches/fetch_profit 一致的白名单（REPORT §四）：真实毛亏 + 已记录的 null 行。
const NEG_GROSS_OK = new Set(['MU', 'TSLA', 'PDD']);
const MISSING_REV_OK = new Set(['00762.HK|2008-09-30', '00100.HK|2022-12-31']);
let bad = 0;
for (const [tk, c] of Object.entries(neu.companies)) {
  for (const q of c.quarters) {
    if (q.revenue == null) { if (!MISSING_REV_OK.has(`${tk}|${q.end}`)) { console.log(`  BAD ${tk} ${q.end} revenue null`); bad++; } }
    else if (q.revenue <= 0) { console.log(`  BAD ${tk} ${q.end} revenue<=0 (${q.revenue})`); bad++; }
    if (q.gross != null && q.gross < 0 && !NEG_GROSS_OK.has(tk)) { console.log(`  BAD ${tk} ${q.end} gross<0 (${q.gross})`); bad++; }
    if (q.gross != null && (q.gross > q.revenue * 1.005)) { console.log(`  BAD ${tk} ${q.end} gross ${q.gross} > rev ${q.revenue}`); bad++; }
    if (q.gross != null && q.opInc != null && q.opInc > q.gross * 1.005) { console.log(`  BAD ${tk} ${q.end} opInc ${q.opInc} > gross ${q.gross}`); bad++; }
  }
}

console.log('\n== additivity: FY vs Σ单季 (annual-bearing entries) — REPORT §四 C ==');
const DAYms = 864e5;
const isSQ = (q) => q.cumulative !== true && (q.periodType == null || ['q', 'q1', 'q2', 'q3', 'q4'].includes(q.periodType));
for (const [tk, c] of Object.entries(neu.companies)) {
  const qs = c.quarters.slice().sort((a, b) => a.end < b.end ? -1 : 1);
  const anns = qs.filter(q => q.periodType === 'annual').sort((a, b) => a.end < b.end ? -1 : 1);
  for (let i = 0; i < anns.length; i++) {
    const A = anns[i]; if (A.revenue == null) continue;
    const backstop = new Date(new Date(A.end).getTime() - 300 * DAYms).toISOString().slice(0, 10);
    const lo = i > 0 && anns[i - 1].end > backstop ? anns[i - 1].end : backstop;
    const within = qs.filter(q => isSQ(q) && q.revenue != null && q.end > lo && q.end <= A.end);
    if (!within.length) continue;
    for (const q of within) if (Math.abs(q.revenue - A.revenue) / Math.abs(A.revenue) < 0.02) { console.log(`  BAD ${tk} ${q.end} single≈annual ${A.end}`); bad++; }
    const sum = within.reduce((s, q) => s + q.revenue, 0), tol = Math.abs(A.revenue) * 0.01;
    if (sum > A.revenue + tol) { console.log(`  BAD ${tk} ${A.end} Σ${within.length}=${Math.round(sum)} > FY=${Math.round(A.revenue)}`); bad++; continue; }
    if (within.length === 4 && Math.abs(sum - A.revenue) > tol) { console.log(`  BAD ${tk} ${A.end} Σ4=${Math.round(sum)} vs FY=${Math.round(A.revenue)}`); bad++; }
    if (within.length === 3) { const imp = A.revenue - sum; if (imp <= 0) { console.log(`  BAD ${tk} ${A.end} impliedQ4=${Math.round(imp)} <= 0`); bad++; } }
  }
}
console.log('bad:', bad);
if (bad) process.exitCode = 1; // 有违规 -> 非零退出码（REPORT §四 C）
console.log('\nskipped:', JSON.stringify(neu.skipped));
