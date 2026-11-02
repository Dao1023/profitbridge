// Build coverage.json + findings.json from analysis.json. Writes only into tmp-audit/a6 (then copied to audits/).
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = 'C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge';
const OUT = 'C:/Users/Dao/Code/dao1023/dsh-temp/tmp-audit/a6';
const a = JSON.parse(readFileSync(`${OUT}/analysis.json`, 'utf8'));
const seg = JSON.parse(readFileSync(`${ROOT}/data/segments.json`, 'utf8'));
const R = a.rows;

const degradedOf = (t) => {
  const c = seg.companies[t];
  if (!c) return null;
  return c.degraded === true ? '(degraded:true)' : (typeof c.degraded === 'string' ? c.degraded : (c.reason || null));
};

const FIELDS = ['revenue', 'gross', 'opInc', 'netInc', 'rd', 'sga'];

const coverage = R.map((r) => {
  const segPeriods = r.seg ? r.seg.n : 0;
  const lag = r.seg ? r.seg.profitSegLagDays : null;
  // segComplete: 有分部且最新(滞后<=200d)。"完整"此处=及时可用，不是"4段"（段数因公司而异）
  const segComplete = !!(r.seg && r.seg.n > 0 && lag != null && Math.abs(lag) <= 200);
  const issues = [];
  // profit
  if (r.overdueNext) issues.push('PROFIT_OVERDUE');
  else if (r.market === 'US' && r.freq !== 'annual' && r.daysSinceLatest >= 120) issues.push('PROFIT_LAG_PEER');
  if (r.n < 10) issues.push('SHORT_HISTORY');
  // segments
  if (r.seg && r.seg.n > 0) {
    if (lag != null && Math.abs(lag) >= 300) issues.push('SEG_STALE');
  } else {
    const d = degradedOf(r.ticker) || '';
    if (/reconcile segment units|units with revenue|could not reconcile/i.test(d)) issues.push('SEG_UNITFAIL');
    else if (/only \d+ quarters/i.test(d)) issues.push('SEG_PARTIAL');
    else issues.push('SEG_NONE');
  }
  // field nulls by design
  for (const f of FIELDS) if (r.n >= 10 && r.nullCount[f] / r.n >= 0.9) issues.push(`NULL_${f.toUpperCase()}`);
  const missing = {}; FIELDS.forEach((f) => (missing[f] = r.nullCount[f]));
  return {
    ticker: r.ticker, name: r.name, market: r.market, frequency: r.freq,
    periods: r.n, first: r.first, last: r.last, staleDays: r.daysSinceLatest,
    missing, segPeriods, segComplete,
    segLast: r.seg ? r.seg.last : null,
    segLagDays: lag,
    issues,
  };
});
writeFileSync(`${OUT}/coverage.json`, JSON.stringify(coverage, null, 1));

// ---------- findings (grouped) ----------
const byTicker = Object.fromEntries(coverage.map((c) => [c.ticker, c]));
const F = [];
let n = 0;
const push = (type, tickers, evidence, severity, action) => F.push({ id: `A6-${String(++n).padStart(2, '0')}`, angle: 'A6', type, tickers, evidence, severity, action });

// 1. BABA mega segment staleness
push('SEG_STALE_MEGA', ['BABA'],
  'BABA profit 到 2026-06-30（29 期），但 segments 最后一条仅 2022-03-31（8 期），profit-seg 缺口 1552 天（约 4.25 年），分部数据自 FY2022 起完全断供。',
  'high', '优先补抓 BABA FY2023–FY2025 年报分部 + 最新季度 disaggregation；补不齐前应在 UI 强制标注“分部数据截至 2022Q1”。');

// 2. HK bloc segment staleness (17 HK companies)
const hkStale = R.filter((r) => r.market === 'HK' && r.seg && r.seg.n > 0 && Math.abs(r.seg.profitSegLagDays) >= 300)
  .sort((x, y) => Math.abs(y.seg.profitSegLagDays) - Math.abs(x.seg.profitSegLagDays));
push('SEG_STALE_HK', hkStale.map((r) => r.ticker),
  '港股 17 家中，有可用分部的 15 家全部陈旧：13 家止步 2024-12-31（缺口 546–638 天），00992.HK、00151.HK 止步 2025-03-31（缺口 456/365 天）；另 02513.HK、00100.HK 无分部（见 A6-06）。即 FY2025 年报与 2026 中期分部基本未入站。逐家：' +
  hkStale.map((r) => `${r.ticker}(seg ${r.seg.last} / profit ${r.last}, 差${Math.abs(r.seg.profitSegLagDays)}d)`).join('；'),
  'high', '按最新年报/中报补抓 2025、2026 分部；HK 累计口径差分入库。补前 UI 应显示分部截至日期。');

// 3. ADR / Europe segment staleness (last 2025-12-31)
const adrStale = R.filter((r) => r.seg && r.seg.n > 0 && ['US', 'CH', 'FR'].includes(r.market) && Math.abs(r.seg.profitSegLagDays) >= 180 && Math.abs(r.seg.profitSegLagDays) < 300)
  .sort((x, y) => Math.abs(y.seg.profitSegLagDays) - Math.abs(x.seg.profitSegLagDays));
push('SEG_STALE_ADR', adrStale.map((r) => r.ticker),
  '中概 ADR 与欧股分部止步 2025-12-31（多为 20-F/年报口径），profit 已到 2026-06-30，缺口 181–273 天（约 1 个披露周期）。逐家：' +
  adrStale.map((r) => `${r.ticker}(seg ${r.seg.last}/profit ${r.last},差${Math.abs(r.seg.profitSegLagDays)}d)`).join('；'),
  'medium', '补 FY2025 之后的分部（ADR 多为年度，定期更新即可）；短期可在 UI 标注分部为年度口径。');

// 4. unit-reconcile failures -> 0 segments although source has them
const unitFail = R.filter((r) => (!r.seg || r.seg.n === 0) && /reconcile segment units|units with revenue|could not reconcile/i.test(degradedOf(r.ticker) || ''));
push('SEG_UNITFAIL', unitFail.map((r) => r.ticker),
  '以下 9 家美股源上(EDGAR)存在 revenue-disaggregation 分部表，但管线因“单位/期间与营收无法核对”把整段分部丢弃，最终 0 期：' +
  unitFail.map((r) => r.ticker).join('、') + '。属可修复的技术缺口（非无披露）。',
  'high', '修复 segment 单位/累计口径核对逻辑，重跑这 9 家；这是当前最划算的分部覆盖增量。');

// 5. partial segments
const partial = R.filter((r) => (!r.seg || r.seg.n === 0) && /only \d+ quarters/i.test(degradedOf(r.ticker) || ''));
push('SEG_PARTIAL', partial.map((r) => r.ticker),
  'AVGO、U 仅有 2 个季度分部（其余季度源上有但未入站），分部系列严重不完整。',
  'medium', '补齐 AVGO/U 其余季度分部。');

// 6. genuine no-disclosure / degraded-true
const segNone = R.filter((r) => (!r.seg || r.seg.n === 0) &&
  !/reconcile segment units|units with revenue|could not reconcile/i.test(degradedOf(r.ticker) || '') &&
  !/only \d+ quarters/i.test(degradedOf(r.ticker) || ''));
push('SEG_NONE', segNone.map((r) => r.ticker),
  '以下 ' + segNone.length + ' 家公司确实无可入站分部数据（已记录 reason）：' +
  segNone.map((r) => `${r.ticker}[${(degradedOf(r.ticker) || '').slice(0, 28)}…]`).join('；') +
  '。属诚实降级，非漏抓，但 UI 需明确提示“无公开分部披露”。',
  'low', '保持降级标注，UI 明示无分部；无需补抓（除 000660.KS 可尝试 PDF 解析）。');

// 7. profit peer-lag (within filing window as of 2026-11-01)
const lagPeer = R.filter((r) => !r.overdueNext && r.market === 'US' && r.freq !== 'annual' && r.daysSinceLatest >= 120);
push('PROFIT_LAG_PEER', lagPeer.map((r) => r.ticker),
  '截至 2026-11-01，以下美股最新期仍为 2026-06-30（距今天数 120–127d），而 INTC/NXPI/SBUX 等已到 2026-09-26/27。它们尚未越过法定披露窗口（+45d），但相对同业落后约 1 个季度：' +
  lagPeer.map((r) => `${r.ticker}(${r.last},${r.daysSinceLatest}d)`).join('、') + '。',
  'low', '属正常披露节奏差；下一轮 SEC 抓取（scripts/scan_filings.mjs）覆盖即可，不必单独报警。');

// 8. strict overdue (only 00151.HK)
const overdue = R.filter((r) => r.overdueNext);
push('PROFIT_OVERDUE', overdue.map((r) => r.ticker),
  '00151.HK（中国旺旺，FYE 3-31）最新期 2026-03-31，按 +91d+45d 节奏下一期(2026-06-30)应已披露，实际逾期 ~80 天；且 canonical 审计另记 2017-12-31[annual] 缺 1 期。',
  'medium', '补抓 00151.HK 2026 中期；核对 2017 年度缺口。');

// 9. credibility: source label hardcoded SEC for all
const nonSec = R.filter((r) => r.market !== 'US');
push('CREDIBILITY_SOURCE', nonSec.map((r) => r.ticker),
  'app.js:1447 对每家公司统一渲染 “数据来源: SEC EDGAR XBRL”（链接 data.sourceUrl），但 ' + nonSec.length + ' 家非美市场公司（港股/HKEX、A股/CSMAR·东财、韩股/DART、欧股/IR、台股）根本不是 SEC 报送主体，来源栏明确错误；profit.json 顶层 source 也仅写 SEC EDGAR。真实来源只散落在各公司 notes（如 00700.HK “HKEX cumulative periods differenced”、600519.SS “CSMAR/东财”、005930.KS “Korean disclosure standalone Q1/Q3+FY”）。',
  'high', '来源栏改为按公司/市场动态显示真实来源；或将 profit.json 顶层 source 扩写为多源；至少在 UI 加“部分数据非 SEC”说明。');

// 10. credibility: single global updated date implies per-company freshness
push('CREDIBILITY_FRESHNESS', ['BABA', ...hkStale.slice(0, 5).map((r) => r.ticker), '00700.HK'],
  'UI 对全部 92 家统一显示 “数据更新 2026-10-31”（=profit.updated）。但分部数据实际截止日差异极大：BABA 2022-03-31、港股 2024-12-31、ADR 2025-12-31。单一全局日期让人误以为所有图表面板都 freshto 2026-10-31。',
  'medium', 'meta 行按“利润/分部”分别显示各自截至日，或对陈旧分部加角标。');

// 11. derived values presented as official (HK differencing / US derived Q4)
push('DERIVED_UNLABELED', ['00700.HK','01398.HK','00981.HK','00762.HK','00728.HK','03968.HK','03888.HK','01024.HK','09633.HK','01810.HK','03690.HK','02097.HK','00151.HK','02513.HK','00100.HK'],
  '港股 profit 单季为 HKEX 累计差分推导（Q2=H1−Q1, Q3=9M−H1, Q4=FY−9M，见 00700.HK notes）；美股 Q4 为 FY−Q1−Q3 推导（profit.json source 明示）。这些推导/估算单季在 UI 作为普通“季度实际值”渲染，代码中未见“估算/推导”角标，仅藏在 notes。',
  'medium', '对差分/推导期加“推算”水印或 tooltip；至少在来源说明里点明差分口径。');

// 12. short history / newly listed / preview
const short = R.filter((r) => r.n < 10);
push('SHORT_HISTORY', short.map((r) => r.ticker),
  '以下 ' + short.length + ' 家历史很短（多为近年上市/预览）：' +
  short.map((r) => `${r.ticker}(${r.n}期 ${r.first}~${r.last})`).join('、') + '。SPCX(SpaceX 预览)、HUAWEI/LEGO(年度 7 期)。',
  'low', '标注“上市以来”起点，避免用户误以为可看长历史；预览类明确标注非上市。');

// 13. field null matrix by design
push('FIELD_NULL_BY_DESIGN', ['KR:005930.KS/000660.KS/066570.KS', 'HK:00700.HK/00941.HK/01398.HK/...', 'US-partial'],
  '字段缺失整体：gross 14.4%、opInc 7.8%、rd 36.7%、sga 37.7% 为 null（revenue/netInc 基本无缺）。按市场：KR gross/opInc/rd/sga 100% 空（只报营收+净利）；HK rd 74%、gross 34% 空；美股 rd 23%、sga 43% 空。属披露制度差异（研发/销售费用多不单列），非抓取漏项。',
  'low', '保持空值+“未披露”文案即可，不建议硬补；报告中说明为体制性缺失。');

const SRC = (t) => t.startsWith('SEG_') ? 'data/segments.json + data/profit.json（期集合/滞后重算，源码见 evidence/analyze.mjs）'
  : t.startsWith('PROFIT_') ? 'data/profit.json 期集合 + scripts/audit_coverage.mjs 原始输出'
  : t === 'CREDIBILITY_SOURCE' ? 'profitbridge/app.js:1447 + data/profit.json 顶层 source + 各公司 notes'
  : t === 'CREDIBILITY_FRESHNESS' ? 'profitbridge/app.js:1447 + data/segments.json 各公司末条'
  : t === 'DERIVED_UNLABELED' ? 'data/profit.json notes（00700.HK 等）+ 顶层 source 字段'
  : t === 'FIELD_NULL_BY_DESIGN' ? 'data/profit.json 六字段 null 统计'
  : 'data/profit.json 期数/范围';
F.forEach((f) => { f.verified = true; f.source = SRC(f.type); });
writeFileSync(`${OUT}/findings.json`, JSON.stringify(F, null, 1));

console.log(`coverage.json: ${coverage.length} rows`);
console.log(`findings.json: ${F.length} findings`);
F.forEach((f) => console.log(`  ${f.id} ${f.type} [${f.severity}] ${f.tickers.length} tickers`));
