/* opInc 口径 / 利润桥缺口回归 (2026-11-26).
 *
 * 背景: opInc 是公司 as-reported 经营利润 (income/(loss) from operations)，含减值、资产处置、商誉
 * 减值等**经营内**其他项；而 gross − rd − sga 只覆盖三项成本。两者之差（桥缺口 gap）本身不是错，
 * 但「口径被悄悄改回聚合站标准化值」或「补数引入新的口径差」必须被抓住。
 *
 * 两层断言:
 *   A. 精确层 — 已改 as-reported 的门户 (LI/BIDU/BABA/ZH) 逐期白名单，gap 必须等于登记值 ±0.01；
 *      白名单外的门户缺口也算失败（防止悄悄新增）。
 *   B. 基线层 — data/bridge_gap_baseline.json 是全站快照 (769 期 / 42 家，|gap|>1%×revenue)。
 *      已有期允许 gap 变化（修数本来就会变），但**基线外的新期** → 红；提示先确证口径再重跑
 *      `node scripts/gen_bridge_gap_baseline.mjs`，并把基线更新与数据修正放同一 commit。
 *
 * SONY 5 期 (−608,126 … −943,105，FY2017–FY2021) 的 FS 分部口径差尚未逐格回一手 20-F，按 parent
 * 要求标 pending，不进入精确白名单；它们仍在基线里，不会被本测试当成新缺口。
 *
 * Run: node tests/verify_opinc_bridge_gap.mjs   (pure data assertions, no browser, no server)
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const P = JSON.parse(fs.readFileSync(new URL('../data/profit.json', import.meta.url), 'utf8'));
const BASELINE = JSON.parse(fs.readFileSync(new URL('../data/bridge_gap_baseline.json', import.meta.url), 'utf8'));
const PATCH = JSON.parse(fs.readFileSync(new URL('../data/staging/patches/2026-11-26_opinc.json', import.meta.url), 'utf8'));

const THRESHOLD = 0.01;      // 1% × revenue
const TOL = 0.01;            // 精确层容差 (CNY-M)
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL', msg); fails++; } else console.log('ok  ', msg); };

const rowOf = (tk, end) => (P.companies[tk]?.quarters || []).find(q => q.end === end);
const gapOf = (q) => q.opInc - (q.gross - q.rd - q.sga);
const hasAll = (q) => [q.opInc, q.gross, q.rd, q.sga, q.revenue].every(v => typeof v === 'number' && Number.isFinite(v)) && q.revenue !== 0;

// ---------- A. 精确层：门户逐期白名单 ----------
// 每期一句话理由。LI 的 10 个唯一期覆盖 12 格 patch（8 格 opInc + 2021 两期 rd/sga 重分类，后者 gap=0）。
const EXACT = [
  // LI (12 格 patch → 10 个唯一期；audits/2026-11-26-li/README.md)
  { ticker: 'LI', end: '2021-09-30', gap: 0, reason: '2021Q3 rd/sga 第三方重分类（总额不变），gap 0；登记以防未来重算弄脏' },
  { ticker: 'LI', end: '2021-12-31', gap: 0, reason: 'FY2021 rd/sga 重分类（总额不变），gap 0' },
  { ticker: 'LI', end: '2022-12-31', gap: 0, reason: 'FY2022 opInc 与三项恰好闭合（gap 0），属 LI 12 格修正期' },
  { ticker: 'LI', end: '2023-06-30', gap: 125.402, reason: 'SA 剔除资产处置收益，as-reported 含之 → gap 125.402' },
  { ticker: 'LI', end: '2023-12-31', gap: 264.21, reason: 'FY2023 资产处置收益 264.210 在经营利润内' },
  { ticker: 'LI', end: '2024-06-30', gap: 133.773, reason: '2024Q2 资产处置收益 133.773 在经营利润内' },
  { ticker: 'LI', end: '2024-12-31', gap: 663.657, reason: 'FY2024 资产处置收益 663.657 在经营利润内' },
  { ticker: 'LI', end: '2025-06-30', gap: 287.98, reason: '2025Q2 资产处置收益 287.980 在经营利润内' },
  { ticker: 'LI', end: '2025-12-31', gap: 473.631, reason: 'FY2025 资产处置收益 473.631 在经营利润内' },
  { ticker: 'LI', end: '2026-06-30', gap: -83.228, reason: '2026Q2 资产处置损失 −83.228 在经营利润内' },
  // BIDU（本次 patch: Q3 + 同源减值的 FY2025）
  { ticker: 'BIDU', end: '2025-09-30', gap: -16190, reason: '6-K 0001193125-25-285391: Impairment of long-lived assets 16,190 在 opex 内' },
  { ticker: 'BIDU', end: '2025-12-31', gap: -16190, reason: 'FY2025 20-F 同一长期资产减值 16,190；该行 opInc 本来就 as-reported（−5,823）' },
  // BABA（本次 2 格 + 2021Q3–2023Q3 既有 7 期小缺口）
  { ticker: 'BABA', end: '2021-09-30', gap: -2906, reason: '三项之外的其他经营费用（SBC/重组等），SA 口径与 as-reported 差异' },
  { ticker: 'BABA', end: '2021-12-31', gap: -2837, reason: '同上，连续小缺口（见 BABA company notes）' },
  { ticker: 'BABA', end: '2022-06-30', gap: -2751, reason: '同上，连续小缺口' },
  { ticker: 'BABA', end: '2022-09-30', gap: -2729, reason: '同上，连续小缺口' },
  { ticker: 'BABA', end: '2022-12-31', gap: -2719, reason: '同上，连续小缺口' },
  { ticker: 'BABA', end: '2023-06-30', gap: -2479, reason: '同上，连续小缺口' },
  { ticker: 'BABA', end: '2023-09-30', gap: -2431, reason: '同上，连续小缺口' },
  { ticker: 'BABA', end: '2023-12-31', gap: -23091, reason: '6-K 0001104659-24-011604: 无形资产减值 12,084 + 商誉减值 8,490，另 2,517 其他经营费用' },
  { ticker: 'BABA', end: '2025-12-31', gap: -8895, reason: '6-K 0001104659-26-032060: 商誉减值 9,515，减 620 其他经营费用净额' },
  // ZH（本次 patch）
  { ticker: 'ZH', end: '2025-12-31', gap: -126.344, reason: 'FY2025 20-F XBRL: GoodwillImpairmentLoss 126.344 在经营费用内' },
];
const PORTALS = ['LI', 'BIDU', 'BABA', 'ZH'];

const exactKeys = new Set();
for (const e of EXACT) {
  const key = `${e.ticker}|${e.end}`;
  ok(!exactKeys.has(key), `whitelist key unique: ${key}`);
  exactKeys.add(key);
  const q = rowOf(e.ticker, e.end);
  ok(!!q, `${e.ticker} ${e.end} exists`);
  if (!q) continue;
  ok(hasAll(q), `${e.ticker} ${e.end} has opInc/gross/rd/sga/revenue`);
  const g = gapOf(q);
  ok(Math.abs(g - e.gap) <= TOL, `${e.ticker} ${e.end} gap = ${e.gap} ±${TOL} (got ${g.toFixed(3)}) — ${e.reason}`);
}

// 门户公司所有超过阈值的缺口都必须在白名单里（不允许悄悄新增/漂移出白名单）
for (const tk of PORTALS) {
  for (const q of (P.companies[tk]?.quarters || [])) {
    if (!hasAll(q)) continue;
    if (Math.abs(gapOf(q)) <= THRESHOLD * Math.abs(q.revenue)) continue;
    ok(exactKeys.has(`${tk}|${q.end}`), `${tk} ${q.end} 缺口 ${gapOf(q).toFixed(3)} 已在精确白名单（门户不允许白名单外缺口）`);
  }
}

// 4 格 patch 值必须已经落在磁盘上，且 gap 与上面登记一致
ok(PATCH.patches.length === 4, `patch file has 4 patches (got ${PATCH.patches.length})`);
for (const p of PATCH.patches) {
  const q = rowOf(p.ticker, p.end);
  ok(!!q && q[p.field] === p.new, `${p.ticker} ${p.end} ${p.field} == patch new ${p.new} (got ${q?.[p.field]})`);
}

// ---------- B. 基线层：全站只断增 ----------
const baseMap = new Map();
let dupBase = 0;
for (const b of BASELINE.entries || []) {
  const key = `${b.ticker}|${b.end}`;
  if (baseMap.has(key)) dupBase++;
  baseMap.set(key, b);
}
ok(dupBase === 0, `baseline keys unique (${dupBase} duplicates)`);
ok(BASELINE.thresholdPct === 1, `baseline thresholdPct == 1 (got ${BASELINE.thresholdPct})`);
ok(BASELINE.count === (BASELINE.entries || []).length, `baseline count field == entries.length (${BASELINE.count})`);

let current = 0, changed = 0;
const newGaps = [];
for (const [ticker, co] of Object.entries(P.companies)) {
  for (const q of co.quarters || []) {
    if (!hasAll(q)) continue;
    const gap = gapOf(q);
    if (Math.abs(gap) <= THRESHOLD * Math.abs(q.revenue)) continue;
    current++;
    const key = `${ticker}|${q.end}`;
    const b = baseMap.get(key);
    if (!b) { newGaps.push({ ticker, end: q.end, gap, revenue: q.revenue, pct: gap / q.revenue * 100 }); continue; }
    if (Math.abs(b.gap - gap) > TOL) changed++;
  }
}
if (newGaps.length) {
  console.error(`FAIL 出现基线外的新口径缺口 ${newGaps.length} 期（请先确证 as-reported 口径 vs 取数错误，再重跑 node scripts/gen_bridge_gap_baseline.mjs 并把基线更新与数据修正同一 commit）：`);
  for (const g of newGaps) console.error(`  ${g.ticker} ${g.end} gap=${g.gap.toFixed(3)} revenue=${g.revenue} gap%=${g.pct.toFixed(2)}%`);
  fails += newGaps.length;
} else {
  console.log(`ok   基线层：当前 ${current} 期缺口全部在基线内（无新增期；${changed} 期 gap 值变化，允许）`);
}
// 只断增不删：基线内的期即使 gap 降到阈值以下（不再出现在 current 里）也不报错，只有新期才红。

console.log(JSON.stringify({ exactWhitelist: EXACT.length, portals: PORTALS, baselineEntries: BASELINE.entries.length, currentGapPeriods: current, changedGapValues: changed, newGapPeriods: newGaps.length, fails }, null, 2));
if (fails) { console.error(`FAIL ${fails} assertion(s)`); process.exit(1); }
console.log('PASS opInc bridge-gap: exact whitelist + baseline no-new-period');
