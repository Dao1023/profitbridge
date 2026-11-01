// 显式修复脚本（幂等 / append-only）：两处不能走 merge_segments.mjs 的“改既有值/特殊结构”修正
//   1) 00151.HK 历史汇率 bug：各期分部 USD 值 = 本币 × 固定 0.12083（错误常数），
//      需按真实逐期 fxToUsd 等比缩放 factor = fxToUsd(该期) / 0.12083。
//      幂等：某期 segSum/(revenue×fx) 已 ∈[0.98,1.02] 视为已修正，跳过不缩放。
//   2) 00992.HK(联想) annualOnly：把新财年 annualQuarters 追加进去（quarters 必须保持 {}），
//      periodTypes[end]='annual'，append-only + deepEqual 幂等。
// 结束后同时重生成 data/segments.json.js 并断言与 .json 深度相等。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const W = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const clone = o => JSON.parse(JSON.stringify(o));
const norm = o => {
  if (Array.isArray(o)) return o.map(norm);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).sort()) r[k] = norm(o[k]); return r; }
  return o;
};
const deepEqual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const r6 = v => Math.round(v * 1e6) / 1e6;

const FIXED_FX_WANTWANT = 0.12083; // 00151 历史误用的固定常数

const SEG = J('data/segments.json');
const PROF = J('data/profit.json');
const HKB = J('tmp-fix-hk-b/staging_seg.json');

const isQ = p => /^q/.test(p.periodType || '');
// annual 期对应“年度营收 + 当期 fx”：优先取直接 annual/cumulative 行，否则取该财年末最近 4 个季度 revenue 之和
function annualRevFx(tk, end) {
  const arr = (PROF.companies[tk] || {}).quarters || [];
  const direct = arr.find(x => x.end === end);
  if (direct && (direct.periodType === 'annual' || direct.cumulative === true)) {
    return { rev: direct.revenue, fx: direct.fxToUsd == null ? 1 : direct.fxToUsd, basis: 'annual-row@' + end };
  }
  let qs = arr.filter(x => new Date(x.end).getTime() <= new Date(end).getTime() && isQ(x));
  qs.sort((a, b) => new Date(a.end) - new Date(b.end));
  qs = qs.slice(-4);
  if (!qs.length) return null;
  const rev = qs.reduce((a, x) => a + x.revenue, 0);
  const fxRow = direct || qs[qs.length - 1];
  return { rev, fx: fxRow.fxToUsd == null ? 1 : fxRow.fxToUsd, basis: 'sum' + qs.length + 'q' };
}
const segSum = list => (list || []).reduce((a, s) => a + (s.value || 0), 0);
function scaleItems(list, factor) {
  for (const it of list) {
    if (typeof it.value === 'number') it.value = r6(it.value * factor);
    if (Array.isArray(it.children)) scaleItems(it.children, factor);
  }
}

// ---------- 1) 00151.HK 历史汇率修正 ----------
const f151 = SEG.companies['00151.HK'];
const wantRows = [];
let wantScaled = 0, wantSkipped = 0, wantNoFx = 0;
for (const end of Object.keys(f151.quarters || {})) {
  const m = annualRevFx('00151.HK', end);
  const list = f151.quarters[end];
  const pre = segSum(list);
  if (!m || m.fx == null) {
    wantRows.push({ end, segSum: pre, rev: m ? m.rev : null, fx: null, before: null, after: null, action: 'skip:no-fx' });
    wantNoFx++;
    continue;
  }
  const ratioBefore = pre / (m.rev * m.fx);
  if (ratioBefore >= 0.98 && ratioBefore <= 1.02) {
    wantRows.push({ end, segSum: pre, rev: m.rev, fx: m.fx, before: ratioBefore, after: ratioBefore, action: 'skip:already-ok' });
    wantSkipped++;
    continue;
  }
  const factor = m.fx / FIXED_FX_WANTWANT;
  scaleItems(list, factor);
  const post = segSum(list);
  const ratioAfter = post / (m.rev * m.fx);
  wantRows.push({ end, segSum_before: pre, segSum_after: post, rev: m.rev, fx: m.fx, factor, before: ratioBefore, after: ratioAfter, action: 'scaled' });
  wantScaled++;
}

// ---------- 2) 00992.HK annualQuarters 追加 ----------
const f992 = SEG.companies['00992.HK'];
if (!f992) throw new Error('00992.HK not found');
if (!f992.quarters) f992.quarters = {};
f992.annualQuarters = f992.annualQuarters || {};
const src992 = HKB.companies['00992.HK'].annualQuarters || {};
const rows992 = [];
let added992 = 0, skipped992 = 0;
for (const end of Object.keys(src992)) {
  if (Object.prototype.hasOwnProperty.call(f992.annualQuarters, end)) {
    if (!deepEqual(f992.annualQuarters[end], src992[end])) {
      throw new Error(`00992.HK annualQuarters ${end} exists but differs from staging — refusing to overwrite`);
    }
    rows992.push({ end, action: 'skip:deepEqual' });
    skipped992++;
  } else {
    f992.annualQuarters[end] = clone(src992[end]);
    rows992.push({ end, action: 'added', sum: segSum(src992[end]) });
    added992++;
  }
  f992.periodTypes = f992.periodTypes || {};
  f992.periodTypes[end] = 'annual';
}
f992.periodType = 'annual';
f992.annualOnly = true;
if (Object.keys(f992.quarters).length !== 0) throw new Error('00992.HK quarters must stay empty {}');

// ---------- 写盘 + 镜像断言 ----------
W('data/segments.json', JSON.stringify(SEG, null, 2) + '\n');
W('data/segments.json.js', 'window.__SEGMENT_DATA = ' + JSON.stringify(SEG) + ';\n');
const mirror = fs.readFileSync(path.join(ROOT, 'data/segments.json.js'), 'utf8');
const m = mirror.match(/^window\.__SEGMENT_DATA\s*=\s*([\s\S]*);\s*$/);
if (!m) throw new Error('segments.json.js mirror format unexpected');
if (!deepEqual(JSON.parse(m[1]), SEG)) throw new Error('segments.json.js mirror != segments.json');

console.log('==== 00151.HK fx fixup (' + wantRows.length + ' periods) ====');
console.log('  scaled=' + wantScaled + '  skip:already-ok=' + wantSkipped + '  skip:no-fx=' + wantNoFx);
for (const r of wantRows) {
  console.log(`  ${r.end}  before=${r.before == null ? 'NA' : r.before.toFixed(5)}  after=${r.after == null ? 'NA' : r.after.toFixed(5)}  factor=${r.factor ? r.factor.toFixed(6) : '-'}  rev=${r.rev}  fx=${r.fx}  [${r.action}]`);
}
console.log('==== 00992.HK annualQuarters (added=' + added992 + ' skipped=' + skipped992 + ') ====');
for (const r of rows992) console.log(`  ${r.end}  ${r.action}${r.sum != null ? ' sum=' + r.sum.toFixed(3) : ''}`);
console.log('WROTE data/segments.json + data/segments.json.js ; mirror deepEqual=true');
