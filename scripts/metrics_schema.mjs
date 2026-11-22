/* metrics schema 的唯一真源：canonical 字段表。
 *
 *  CORE     —— 5 家样本 + SGCC 都必须提供这些键（值可为 null；null 必须登记进 years[].nulls，
 *              并在 years[].sources 里用一句「为什么没有」解释）。结构断言按 CORE 走。
 *  EXTENDED —— 2026-11 分红主线新增的扩展字段（SGCC 三表映射 / A 股利润表附注行）。按公司可选：
 *              有就写，没有就不必造 null 行（否则 5 家 × 4 年 × 10 字段 = 200 条无信息量的 null）。
 *              一旦某年出现该键，就必须是数字或 null，且 null 同样要登记进 nulls + sources。
 *
 *  `fields.<组>` 始终只登记「至少有一年有值」的字段，与实际非 null 集合严格相等。
 *  scripts/derive_dividends.mjs 与 tests/verify_metrics.mjs 都从这里读，避免两处漂移。
 *  新增字段时只改这一个文件，然后跑 `node scripts/derive_dividends.mjs --check`。 */

export const CORE = {
  income: ['revenue', 'cogs', 'gross', 'opInc', 'rd', 'sga', 'pbt', 'tax', 'netInc'],
  // 股东回报：现金分红（宣告/已付，口径见公司级 dividendBasis）、其中归母（利润上缴的分子）
  shareholder: ['dividendsTotal', 'dividendsToParent'],
  balance: ['cash', 'receivables', 'inventory', 'currentAssets', 'ppe', 'totalAssets',
    'debtShort', 'debtLong', 'liabilities', 'equityParent', 'equity'],
  cashflow: ['ocf', 'capex', 'icf', 'dividendsPaid', 'buyback'],
  perShare: ['eps', 'dps'],
};

export const EXTENDED = {
  income: ['totalRevenue', 'taxAndSurcharges', 'finExpense', 'investmentIncome', 'interestExpense'],
  balance: ['cip', 'paidInCapital', 'retainedEarnings', 'minorityInterests'],
  cashflow: ['finCashFlow'],
};

/* 渲染 / 覆盖表用的全量顺序：按会计科目顺序（利润表 = 营收 → 成本 → 毛利 → 费用 → 营业利润
   → 税前 → 所得税 → 净利），与 app.js 的 MV_GROUPS 行序逐项一致。 */
export const GROUPS = {
  income: ['revenue', 'totalRevenue', 'cogs', 'gross', 'taxAndSurcharges', 'sga', 'rd',
    'finExpense', 'interestExpense', 'investmentIncome', 'opInc', 'pbt', 'tax', 'netInc'],
  shareholder: [...CORE.shareholder],
  balance: [...CORE.balance, ...EXTENDED.balance],
  cashflow: ['ocf', 'capex', 'icf', ...EXTENDED.cashflow, 'dividendsPaid', 'buyback'],
  perShare: [...CORE.perShare],
};

export const ALL = Object.values(GROUPS).flat();
export const ALL_CORE = Object.values(CORE).flat();

/* 前端现算的比率（不入库）。payout 不在此列：它是股东回报组里的一行，口径见 app.js mvPayout。 */
export const RATIO_KEYS = ['grossMargin', 'opMargin', 'netMargin', 'roe', 'roa', 'debtRatio', 'fcf'];

/* 公司级可选元数据：stateOwnership=1 表示国务院国资委 100% 持股（利润上缴口径成立）；
   dividendBasis: 'declared' 宣告口径 / 'cash' 收付实现制已付现金 / null 无数据。 */
export const COMPANY_META = ['stateOwnership', 'dividendBasis', 'dividendBasisNote', 'dividendBasisNoteEn',
  'stateStake', 'stateStakeNote'];

/* 国有持股比例（利润上缴代理口径的乘数）：{ratio, holder, layer, asOf, source}。
   layer: 'central-soe' | 'local-soe' | null。ratio 为 0–1 小数、4 位小数；只有查得到原始
   股东表（东财十大股东 / 港股年报「主要股东」）的公司才登记，查不到写 null + stateStakeNote，
   绝不估算。前端现算：利润上缴 = 归母分红 × ratio（下限口径，见 app.js mvStateRatio）。 */
export const STATE_LAYERS = ['central-soe', 'local-soe'];

/* 哪个组拥有某个字段（字段在 schema 里只属于一个组）。 */
export const OWNER = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, fs]) => fs.map((f) => [f, g])));

/* 一律两位小数（原表 ÷1e6 后保留 2 位）。 */
export const money2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
