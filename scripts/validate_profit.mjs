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
let bad = 0;
for (const [tk, c] of Object.entries(neu.companies)) {
  for (const q of c.quarters) {
    if (q.gross != null && (q.gross > q.revenue * 1.005)) { console.log(`  BAD ${tk} ${q.end} gross ${q.gross} > rev ${q.revenue}`); bad++; }
    if (q.gross != null && q.opInc != null && q.opInc > q.gross * 1.005) { console.log(`  BAD ${tk} ${q.end} opInc ${q.opInc} > gross ${q.gross}`); bad++; }
  }
}
console.log('bad:', bad);
console.log('\nskipped:', JSON.stringify(neu.skipped));
