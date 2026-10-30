// validate_profit.mjs — post-fix audit: coverage matrix, value stability vs backup, gross identity,
// additivity. Acts as a REGRESSION gate: it tolerates known pre-existing anomalies (those already
// present in git HEAD) and fails (exit 1) only on NEW anomalies introduced by the working tree.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const neu = JSON.parse(fs.readFileSync('data/profit.json', 'utf8'));
const backupPath = 'archive/profit.pre_fix_backup.json';
const alt = fs.existsSync(backupPath) ? JSON.parse(fs.readFileSync(backupPath, 'utf8')) : null;

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
if (alt) {
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
} else {
  console.log(`  (skipped: ${backupPath} not present — value-stability comparison needs a pre-fix snapshot)`);
}

// ---- audit rules (return a list of anomaly signatures; identical inputs -> identical list) ----
const NEG_GROSS_OK = new Set(['MU', 'TSLA', 'PDD', '00100.HK']);
const MISSING_REV_OK = new Set(['00762.HK|2008-09-30', '00100.HK|2022-12-31']);
const DAYms = 864e5;
const isSQ = (q) => q.cumulative !== true && (q.periodType == null || ['q', 'q1', 'q2', 'q3', 'q4'].includes(q.periodType));

function audit(profit) {
  const bad = [];
  // gross identity (sanity only)
  for (const [tk, c] of Object.entries(profit.companies)) {
    for (const q of c.quarters) {
      if (q.revenue == null) { if (!MISSING_REV_OK.has(`${tk}|${q.end}`)) bad.push(`BAD ${tk} ${q.end} revenue null`); }
      else if (q.revenue <= 0) { bad.push(`BAD ${tk} ${q.end} revenue<=0 (${q.revenue})`); }
      if (q.gross != null && q.gross < 0 && !NEG_GROSS_OK.has(tk)) bad.push(`BAD ${tk} ${q.end} gross<0 (${q.gross})`);
      if (q.gross != null && (q.gross > q.revenue * 1.005)) bad.push(`BAD ${tk} ${q.end} gross ${q.gross} > rev ${q.revenue}`);
      if (q.gross != null && q.opInc != null && q.opInc > q.gross * 1.005) bad.push(`BAD ${tk} ${q.end} opInc ${q.opInc} > gross ${q.gross}`);
    }
  }
  // additivity: FY vs sum of single quarters
  for (const [tk, c] of Object.entries(profit.companies)) {
    const qs = c.quarters.slice().sort((a, b) => a.end < b.end ? -1 : 1);
    const anns = qs.filter(q => q.periodType === 'annual').sort((a, b) => a.end < b.end ? -1 : 1);
    for (let i = 0; i < anns.length; i++) {
      const A = anns[i]; if (A.revenue == null) continue;
      const backstop = new Date(new Date(A.end).getTime() - 300 * DAYms).toISOString().slice(0, 10);
      const lo = i > 0 && anns[i - 1].end > backstop ? anns[i - 1].end : backstop;
      const within = qs.filter(q => isSQ(q) && q.revenue != null && q.end > lo && q.end <= A.end);
      if (!within.length) continue;
      for (const q of within) if (Math.abs(q.revenue - A.revenue) / Math.abs(A.revenue) < 0.02) bad.push(`BAD ${tk} ${q.end} single≈annual ${A.end}`);
      const sum = within.reduce((s, q) => s + q.revenue, 0), tol = Math.abs(A.revenue) * 0.01;
      if (sum > A.revenue + tol) { bad.push(`BAD ${tk} ${A.end} Σ${within.length}=${Math.round(sum)} > FY=${Math.round(A.revenue)}`); continue; }
      if (within.length === 4 && Math.abs(sum - A.revenue) > tol) { bad.push(`BAD ${tk} ${A.end} Σ4=${Math.round(sum)} vs FY=${Math.round(A.revenue)}`); }
      if (within.length === 3) { const imp = A.revenue - sum; if (imp <= 0) bad.push(`BAD ${tk} ${A.end} impliedQ4=${Math.round(imp)} <= 0`); }
    }
  }
  return bad;
}

console.log('\n== gross identity + additivity (regression vs git HEAD baseline) ==');
const badNow = audit(neu);
// baseline = same rules applied to the committed HEAD file, so pre-existing quirks are tolerated
let headProfit = null;
try { headProfit = JSON.parse(execSync('git show HEAD:data/profit.json', { encoding: 'utf8', maxBuffer: 1 << 28 })); } catch { /* no git */ }
const baseline = headProfit ? new Set(audit(headProfit)) : new Set();
const fresh = badNow.filter(x => !baseline.has(x));
console.log(`total flagged now: ${badNow.length}; known (already in HEAD): ${badNow.length - fresh.length}; NEW: ${fresh.length}`);
for (const x of fresh) console.log('  NEW ' + x);
if (headProfit == null) console.log('  (no git HEAD available — running in absolute mode, all flags count as failures)');
const gateBad = headProfit == null ? badNow.length : fresh.length;
console.log('new violations:', gateBad);
if (gateBad) process.exitCode = 1;
console.log('\nskipped:', JSON.stringify(neu.skipped));
