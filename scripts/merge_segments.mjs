// Segment-layer merge: staging 2026Q3 segment periods -> data/segments.json + data/segments.json.js
//
// 契约 (READ BEFORE RUNNING):
//   - 只追加新期 end 键：历史季逐字保留，绝不删除任何历史季、绝不改动既有季的值。
//   - 同日期同值 -> 跳过（幂等）；同日期不同值 -> 报错 exit 1（不允许静默覆盖）。
//   - 同时重建 data/segments.json.js 镜像，并断言与 data/segments.json 深度相等。
//   - 输入: data/staging/segments_2026q3.json ({_meta, companies:{TK:{quarters:{end:[{name,value[,children]}]}}}})
//
// 用法: node scripts/merge_segments.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const R = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const W = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const clone = o => JSON.parse(JSON.stringify(o));

// 深度相等：对象键顺序无关，数组顺序有关（分部顺序有意义）
function norm(o) {
  if (Array.isArray(o)) return o.map(norm);
  if (o && typeof o === 'object') {
    const r = {};
    for (const k of Object.keys(o).sort()) r[k] = norm(o[k]);
    return r;
  }
  return o;
}
const deepEqual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

const SEG = R('data/segments.json');
const STAGING = R('data/staging/segments_2026q3.json');
const DRY = process.argv.includes('--dry');

const report = { added: [], skipped: [], conflicts: [], initialized: [] };
let fatal = false;

for (const [ticker, sc] of Object.entries(STAGING.companies || {})) {
  let co = SEG.companies[ticker];
  if (!co) {
    console.error(`ERROR: company ${ticker} not found in data/segments.json`);
    process.exit(1);
  }
  // degraded 占位（无 quarters）-> 升级为真实 quarters 结构
  if (!co.quarters) {
    co = SEG.companies[ticker] = { quarters: {}, periodTypes: {}, periodType: sc.periodType || 'quarter' };
    report.initialized.push(ticker);
  }
  if (!co.quarters) co.quarters = {};
  if (!co.periodTypes) co.periodTypes = {};

  const ends = Object.keys(sc.quarters || {});
  for (const end of ends) {
    const incoming = sc.quarters[end];
    if (Object.prototype.hasOwnProperty.call(co.quarters, end)) {
      if (deepEqual(co.quarters[end], incoming)) {
        report.skipped.push({ ticker, end });
      } else {
        report.conflicts.push({ ticker, end });
        console.error(`CONFLICT ${ticker} ${end}: existing segment data differs from staging (refusing to overwrite).`);
        fatal = true;
      }
    } else {
      // periodType 优先取 staging 该项自带口径（annual/half/quarter），缺省才回退 quarter。
      // 原因：港股/年度-only 公司的年度期若被硬编码成 quarter，前端柱轴会按季度展开，
      // 把年度柱误当季度柱渲染（同时公司级 periodType 也会错标）。故按 staging 声明口径写入。
      const pt = (sc.periodTypes && sc.periodTypes[end]) || sc.periodType || 'quarter';
      co.quarters[end] = clone(incoming);
      co.periodTypes[end] = pt;
      report.added.push({ ticker, end });
    }
  }

  // 公司级 periodType：以该公司各期口径的多数为准（annual 为主时同步为 'annual'）。
  // 避免年度-only 公司公司级 periodType 仍停留在 'quarter'，导致轴/视图口径与期级 periodTypes 不一致。
  {
    const vals = Object.values(co.periodTypes || {});
    const nAnnual = vals.filter(v => v === 'annual').length;
    const nQuarter = vals.filter(v => v === 'quarter').length;
    if (nAnnual > nQuarter) co.periodType = 'annual';
    else if (!co.periodType) co.periodType = 'quarter';
  }
}

if (fatal) {
  console.error('REFUSING TO WRITE: segmentation conflicts detected. No changes written.');
  process.exit(1);
}

// 顶层元数据（确定性：取 staging 的 updated 日期，便于删库重跑复现）
SEG.updated = STAGING._meta && STAGING._meta.updated ? STAGING._meta.updated : SEG.updated;

const segJson = JSON.stringify(SEG, null, 2) + '\n';
const segJs = 'window.__SEGMENT_DATA = ' + JSON.stringify(SEG) + ';\n';

console.log(`added: ${report.added.length}  skipped: ${report.skipped.length}  initialized(degraded->quarters): ${report.initialized.join(',') || 'none'}`);
for (const a of report.added) console.log(`  + ${a.ticker} ${a.end}`);
if (DRY) {
  console.log('DRY: no files written.');
  process.exit(0);
}
W('data/segments.json', segJson);
W('data/segments.json.js', segJs);

// 断言镜像与源数据深度相等
const mirror = fs.readFileSync(path.join(ROOT, 'data/segments.json.js'), 'utf8');
const m = mirror.match(/^window\.__SEGMENT_DATA\s*=\s*([\s\S]*);\s*$/);
if (!m) throw new Error('segments.json.js mirror format unexpected');
const parsed = JSON.parse(m[1]);
if (!deepEqual(parsed, SEG)) throw new Error('segments.json.js mirror != segments.json (deepStrictEqual failed)');
console.log('mirror deepEqual=true');
console.log('WROTE data/segments.json + data/segments.json.js');
