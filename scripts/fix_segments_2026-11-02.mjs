// 显式修复脚本（幂等 / 只改期型标注，不改任何数值）：
//   600887.SS（伊利股份）segments 的 12-31 期点实际是「全年累计」值，但 periodTypes 全被标成 'half'，
//   导致前端按「半年累计」渲染/做增速判据。本脚本把该公司所有 12-31 期的 periodTypes 由 'half' 改为 'annual'，
//   06-30 各期保持 'half'（确实是半年累计）。不改动任何分部数值、不改 quarters 结构、不改顶层 periodType。
//   幂等：已是 'annual' 的跳过；重复执行零变化。
// 结束后同时重生成 data/segments.json.js（前缀 window.__SEGMENT_DATA = ）并断言与 .json 深度相等。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const W = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const norm = o => {
  if (Array.isArray(o)) return o.map(norm);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).sort()) r[k] = norm(o[k]); return r; }
  return o;
};
const deepEqual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

const TK = '600887.SS';
const SEG = J('data/segments.json');
const co = SEG.companies[TK];
if (!co) throw new Error(TK + ' not found in segments.json');
if (!co.periodTypes) throw new Error(TK + ' has no periodTypes map');

const ends = Object.keys(co.quarters || {}).sort();
const rows = [];
let changed = 0, skipped = 0, jun = 0;
for (const end of ends) {
  if (end.slice(5) !== '12-31') { if (end.slice(5) === '06-30') jun++; continue; }
  const before = co.periodTypes[end];
  if (before === 'annual') { rows.push({ end, before, after: 'annual', action: 'skip:already-annual' }); skipped++; continue; }
  if (before !== 'half') throw new Error(`${TK} ${end} unexpected periodType '${before}' (expected half)`);
  co.periodTypes[end] = 'annual';
  rows.push({ end, before, after: 'annual', action: 'half->annual' });
  changed++;
}
// ---------- 写盘 + 镜像断言 ----------
W('data/segments.json', JSON.stringify(SEG, null, 2) + '\n');
W('data/segments.json.js', 'window.__SEGMENT_DATA = ' + JSON.stringify(SEG) + ';\n');
const mirror = fs.readFileSync(path.join(ROOT, 'data/segments.json.js'), 'utf8');
const m = mirror.match(/^window\.__SEGMENT_DATA\s*=\s*([\s\S]*);\s*$/);
if (!m) throw new Error('segments.json.js mirror format unexpected');
if (!deepEqual(JSON.parse(m[1]), SEG)) throw new Error('segments.json.js mirror != segments.json');

console.log(`==== ${TK} 12-31 periodTypes half->annual ====`);
console.log(`  ends=${ends.length}  dec31=${rows.length}  changed=${changed}  skipped=${skipped}  jun30(kept half)=${jun}`);
for (const r of rows) console.log(`  ${r.end}  ${r.before} -> ${r.after}  [${r.action}]`);
console.log('WROTE data/segments.json + data/segments.json.js ; mirror deepEqual=true');
