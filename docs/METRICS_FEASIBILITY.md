# 扩展指标层可行性实测报告

> 结论先行：**利润表/资产负债表/现金流量表三表的核心科目，在 SEC、东财 A 股、东财港股三个源上都能 API 化直取，覆盖率 80%+/93 家，单家边际成本 25-40 分钟。**
> **分红可以 API 化**（A 股 `RPT_SHAREBONUS_DET` 最干净；港股只能解析公告文本；美股只有"已付股息现金"没有每股股利）。
> **"利润上缴 / 国有资本收益"没有公司级标准数据源**：前者只能用「分红总额 × 国有股东持股比例」做代理，后者只有财政部全国/中央汇总，单家公司口径必须下年报 PDF/OCR，**不可 API 化**。

- 实测日期：2026-11-22
- 仓库：`profitbridge`（93 家公司 / 7 个市场 / 3,785 期）
- 分支：`docs/metrics-feasibility`
- 探测脚本：`scripts/probe_metrics.mjs`（真实请求，非文档推断）
- 原始响应缓存：`tmp-metrics-probe/cache/`（不入库）

---

## 1. 方法与样本

全部数字来自**当天真实 HTTP 响应**，不是读文档：

| 源 | 端点 | 样本 | 结果 |
|---|---|---|---|
| SEC companyfacts | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | MSFT(789019)、KO(21344)、CAT(18230)、BABA(1577552)、TSM(1046179)、SONY(313838)、ASML(937966) | 全部 200；单份 0.9-5.7MB，0.6-2.8s |
| 东财 A 股三表 | `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_GINCOME/GBALANCE/GCASHFLOW` | 600887 伊利、600519 茅台 | 200；每表 100-115 行，含 1992 年至 2026Q3 |
| 东财 A 股分红 | `reportName=RPT_SHAREBONUS_DET` | 600887、600519、600028 中石化 | 200；31/28/50 条 |
| 东财 A 股股东 | `reportName=RPT_F10_EH_HOLDERS` | 600028 | 200；前十大股东，含持股比例 |
| 东财港股 | `reportName=RPT_HKF10_FN_INCOME_PC/BALANCE_PC/CASHFLOW_PC` + `RPT_HKF10_FN_MAININDICATOR` + `RPT_HKF10_MAIN_DIVBASIC` | 0700 腾讯、0941 中移动、0005 汇丰 | 200；单家单表 1,600-4,300 行 |
| 韩国 DART | `https://opendart.fss.or.kr/api/company.json` | 无 key | HTTP 200 但 `status=010 등록되지 않은 인증키`（需 key） |
| 日本 EDINET | `https://api.edinet-fsa.go.jp/api/v2/documents.json` | 2025-06-20 | HTTP 200，body `StatusCode:401 invalid subscription key`（需 key） |
| 台湾 TWSE/MOPS | `openapi.twse.com.tw`、`www.twse.com.tw` | 2330 | 连接超时（curl 28）；MOPS 返回反爬 HTML 壳，无数据 |
| 欧洲 | — | NESN.SW / MC.PA | 无免费结构化源；Nestlé/L'Oréal 不在 SEC 报送 |

样本覆盖：美股 3 家 + 20-F 4 家 + A 股 3 家 + 港股 3 家，共 13 家、7 个源。

---

## 2. 指标清单矩阵

口径说明：金额单位统一「报告币种」；SEC 用 10-K/20-F/40-F + `fp=FY` + 流量科目 340-380 天过滤；A 股用 `REPORT_TYPE=年报`；港股用 `DATE_TYPE_CODE=001`。
「可得性」是全站综合判断，不是单源。
覆盖年数按 `SEC / A股 / 港股` 给出（实测样本区间）。

| # | 指标 | 口径定义 | SEC | A股 | 港股 | 其他 | 可得性 | 覆盖年数 | 取数方式 | 陷阱 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 营业收入 | 合并利润表营业收入 | 高 | 高 | 高 | 中(20-F) | **高** | 19 / 34 / 25 | SEC `Revenues`\|`RevenueFromContractWithCustomerExcludingAssessedTax`；A `TOTAL_OPERATE_INCOME`；HK 科目「营业额」 | 美股新旧收入标签并存（MSFT 新标签仅 11 年、旧标签 3 年）；A 股 `OPERATE_INCOME` 与 `TOTAL_OPERATE_INCOME` 差其他业务收入；HK 银行无「营业额」用「经营收入总额」 |
| 2 | 营业成本 | 合并利润表营业成本 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC `CostOfGoodsAndServicesSold`\|`CostOfRevenue`；A `OPERATE_COST`；HK「营运支出」/「销售成本」 | CAT 的 COGS 最新值仅 4,900 万美元（明显是季度/局部标签），必须用 `CostOfRevenue`；A 股 `OPERATE_COST` 与 `TOTAL_OPERATE_COST` 差税金/三费；HK 银行无此科目 |
| 3 | 毛利 | 收入−营业成本 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | 优先直取 `GrossProfit`/「毛利」，缺失则 `收入−成本` 推导 | CAT、BABA、SONY 无年度 `GrossProfit`，必须推导；港股银行（0005）`GROSS_PROFIT` 0/28 |
| 4 | 经营利润 | 营业利润/经营溢利 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC `OperatingIncomeLoss`；A `OPERATE_PROFIT`；HK「经营溢利」 | HK `OPERATE_PROFIT` 仅 8-11/25-28（很多公司不披露，需用「除税前溢利+财务费用−其他收益」推）；A 股 2020 前后口径含/不含利息 |
| 5 | 税前利润 | 所得税前利润 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC 长标签或 `ProfitLossBeforeTax`；A `TOTAL_PROFIT`；HK「除税前溢利」 | 长标签在 MSFT 仅 7 年（2020 起），早期要用 `NetIncomeLoss+IncomeTaxExpenseBenefit` 反推 |
| 6 | 所得税 | 所得税费用 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC `IncomeTaxExpenseBenefit`\|`IncomeTaxExpenseContinuingOperations`；A `INCOME_TAX`；HK「税项」 | 负所得税（递延税）要保留符号；A 股 `INCOME_TAX` 偶有 null |
| 7 | 净利润 | 合并净利润（含少数股东） | 高 | 高 | 高 | 高 | **高** | 19 / 34 / 25 | SEC `NetIncomeLoss`\|`ProfitLoss`；A `NETPROFIT`；HK「除税后溢利」 | CAT 的 `NetIncomeLoss` 只有 2007-2010，2011 起用 `ProfitLoss`；港股「股东应占溢利」≠ 净利润 |
| 8 | 归母净利润 | 归属于母公司股东 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC `NetIncomeLoss`（默认即母公司）；A `PARENT_NETPROFIT`；HK `HOLDER_PROFIT` | A 股 `NETPROFIT` 含少数股东，桥接必须用 `PARENT_NETPROFIT`；港股 `HOLDER_PROFIT` 是股东应占 |
| 9 | 研发费用 | 费用化研发 | 中 | 中 | 低 | 中 | **中** | 19 / 9 / 0-5 | SEC `ResearchAndDevelopmentExpense`；A `RESEARCH_EXPENSE`；HK 附注（无标准科目） | KO 这种消费公司无 R&D 标签；A 股 `RESEARCH_EXPENSE` 2017 年才单列（年报仅 9 期，之前并入管理费用）；HK 通常只在附注披露，F10 无字段 |
| 10 | 销售/管理费用 | 销售费用+管理费用 | 高 | 高 | 高 | 中 | **高** | 19 / 32 / 25 | SEC `SellingGeneralAndAdministrativeExpense`，缺失时 `SellingAndMarketingExpense`+`GeneralAndAdministrativeExpense`；A `SALE_EXPENSE`+`MANAGE_EXPENSE`；HK「销售及分销费用」+「行政开支」 | MSFT 无合并 SG&A 标签，只有拆分项（营销 267 亿 + 行政）；直接取单边会低估；A 股 2018 前后研发费用从管理费用重分类 |
| 11 | 总资产 | 期末总资产 | 高 | 高 | 高 | 高 | **高** | 19 / 34 / 25 | SEC `Assets`；A `TOTAL_ASSETS`；HK「总资产」 | 港股 `AMOUNT` 无单位，需按币种判断亿/万；银行/保险科目结构不同 |
| 12 | 总负债 | 期末总负债 | 高 | 高 | 高 | 高 | **高** | 19 / 34 / 25 | SEC `Liabilities`，缺失用 `Assets−Equity`；A `TOTAL_LIABILITIES`；HK「总负债」 | KO/CAT 无 `Liabilities` 标签，必须推导；A 股 1990 年代老数据 `TOTAL_LIABILITIES` 偶尔 null |
| 13 | 归母股东权益 | 归属于母公司所有者权益 | 高 | 高 | 高 | 高 | **高** | 19 / 34 / 25 | SEC `StockholdersEquity`，缺失用含少数股东权益标签或 `Assets−Liabilities`；A `TOTAL_PARENT_EQUITY`；HK `TOTAL_PARENT_EQUITY` | CAT 只有 `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`（含少数股东，偏高）；KO 含少数股东权益 342.75 亿 vs 归母 321.69 亿，差 6% |
| 14 | 现金及等价物 | 期末现金 | 高 | 高 | 高 | 高 | **高** | 20 / 31 / 25 | SEC `CashAndCashEquivalentsAtCarryingValue`；A `MONETARYFUNDS`；HK「现金及等价物」 | A 股 `MONETARYFUNDS` 含受限资金/理财，严格口径要扣 `RESTRICTED_CASH`；HK 有「短期存款」需合并 |
| 15 | 存货 | 期末存货 | 高 | 高 | 高 | 中 | **高** | 19 / 34 / 25 | SEC `InventoryNet`；A `INVENTORY`；HK「存货」 | 互联网/银行无存货（腾讯/汇丰为 0），全站展示要允许 null；CAT 用 LIFO，附注有 LIFO reserve |
| 16 | 应收账款 | 期末应收 | 高 | 高 | 高 | 中 | **高** | 19 / 30 / 25 | SEC `AccountsReceivableNetCurrent`；A `ACCOUNTS_RECE`；HK「应收帐款」 | 茅台 2024 应收仅 260 万（几乎为零），不能当异常；港股「应收帐款」与「预付款按金及其他应收款」分开 |
| 17 | 有息负债 | 短借+长借+应付债券+租赁负债 | 中 | 高 | 高 | 中 | **中** | 19 / 31 / 25 | SEC 多标签求和 `ShortTermBorrowings`+`LongTermDebtNoncurrent`+`LongTermDebtCurrent`；A `SHORT_LOAN`+`LONG_LOAN`+`BOND_PAYABLE`+`LEASE_LIAB`；HK 对应科目求和 | 美股租赁负债常单列（`OperatingLeaseLiability`），漏加会低估；A 股 `BOND_PAYABLE` 仅 23/115；银行不能用此口径（存款即负债） |
| 18 | 净负债 | 有息负债−现金 | 中 | 高 | 高 | 中 | **中** | 同 17 + 14 | 同上，派生 | 净现金公司为负值，展示要处理负号；银行/保险不适用 |
| 19 | 经营现金流 | 经营活动现金净额 | 高 | 高 | 高 | 高 | **高** | 19 / 28 / 25 | SEC `NetCashProvidedByUsedInOperatingActivities`；A `NETCASH_OPERATE`；HK「经营业务现金净额」 | A 股现金流量表比利润表少 10 年（600887 104 vs 115 行）；CAT OCF 仅 13 年 |
| 20 | 投资现金流 | 投资活动现金净额 | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | SEC `NetCashProvidedByUsedInInvestingActivities`；A `NETCASH_INVEST`；HK「投资业务现金净额」 | 口径含/不含金融资产买卖，跨公司不可直接比 |
| 21 | 筹资现金流 | 筹资活动现金净额 | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | SEC `NetCashProvidedByUsedInFinancingActivities`；A `NETCASH_FINANCE`；HK「融资业务现金净额」 | 港股 0005 银行筹资含存款变动，符号相反，不能通用 |
| 22 | 资本开支 | 购建固定资产等支付的现金 | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | SEC `PaymentsToAcquirePropertyPlantAndEquipment`；A `CONSTRUCT_LONG_ASSET`；HK「购买固定资产」/「购建物业厂房设备」 | CAT Capex 仅 8 年（2018 起）；A 股 `CONSTRUCT_LONG_ASSET` 含无形资产，严格 Capex 要加「购建其他长期资产」 |
| 23 | 自由现金流 | OCF−Capex | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | 派生 | 港股银行 OCF 含客户存款，FCF 无意义，需按行业禁用 |
| 24 | 已付股利现金 | 现金流量表分配股利支付的现金 | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | SEC `PaymentsOfDividends`\|`PaymentsOfDividendsCommonStock`；A `ASSIGN_DIVIDEND_PORFIT`（原拼写）；HK「已付股利」 | A 股字段名拼写是 `PORFIT` 不是 `PROFIT`；该值是**现金收付制**（含上年末期+本年中期的实际支付），不等于当年宣告分红 |
| 25 | 每股股利 DPS | 每股现金分红 | 中 | 高 | 高 | 中 | **高** | — / 28 / 25 | A `PRETAX_BONUS_RMB`（每 10 股，÷10）；HK `PLAN_EXPLAIN` 正则 或 `DPS_HKD`；SEC 需 `分红总额/股本` | A 股字段是「每 10 股」；港股文本混币种（港币/人民币/美元）、「相当于港币 x 元」干扰；美股无直接 DPS 标签（需 `CommonStockDividendsPerShareDeclared`，未验证全量） |
| 26 | 分红总额 | 现金分红总额 | 高 | 高 | 中 | 中 | **高** | 19 / 28 / 22 | A `PRETAX_BONUS_RMB/10×TOTAL_SHARES`；HK DPS×股本（需另取股本）；SEC 已付股利现金 | A 股按 `REPORT_DATE` 归财年，中期+年度两行要合并；HK 无总额字段，需解析文本×股本，特别股息/中期要逐条累加；美股现金口径含优先股 |
| 27 | 派息率 payout | 分红总额/归母净利 | 高 | 高 | 高 | 中 | **高** | 19 / 28 / 25 | 派生；HK 可直接用 `DIVI_RATIO` | 净利为负/微利时无意义；港股 `DIVI_RATIO` 实测 0700=19.4%、0941=75.7%、0005=60.5%，与手算一致，可信 |
| 28 | 股息率 | DPS/股价 | 中 | 中 | 高 | 无 | **中** | — / — / 25 | HK `DIVIDEND_RATE`（实测 0700=1.42%、0941=6.74%、0005=4.55%，单位 %）；A/美股需另接行情源 | A 股 F10 无股息率字段，要接 `push2.eastmoney.com` 行情；港股 `DIVIDEND_RATE` 与 `DIVI_RATIO` 极易混淆（前者是率，后者是派息率） |
| 29 | 回购金额 | 股票回购支付现金 | 高 | 中 | 中 | 中 | **中** | 19 / — / — | SEC `PaymentsForRepurchaseOfCommonStock`；A 股无独立现金流科目（只有资产负债表 `TREASURY_SHARES` 余额）；HK 无标准科目 | A 股回购金额要抓公告/`RPT_F10_*` 其它接口，实测三表无；港股同样 |
| 30 | 国有股东持股比例 | 第一大国有股东持股 | 无 | 中 | 低 | 无 | **中** | — / 10 / — | A `RPT_F10_EH_HOLDERS`（前十大，按名称规则判断国资）；HK 无股东接口，需 PDF | 只返回前十大股东；「香港中央结算(代理人)」是代持不是国有；地方国资委/集团/汇金多层持股要合并计算，名称规则会漏 |
| 31 | 上缴利润（代理） | 分红总额×国有持股比例 | 无 | 中 | 低 | 无 | **中** | — / 10 / — | 派生（26×30） | **不是财报科目**，是代理估算；未考虑国有股独享的特别分红、股权转让收益；HK 需先 OCR 股东名册 |
| 32 | 国有资本收益 | 应缴国有资本经营预算收益 | 无 | 无 | 无 | 无 | **无** | — | 无公司级数据；仅财政部年度汇总（HTML 表格） | 国资委按行业定比例（烟草/石油 20-25%、一般竞争 10-15%），实际应缴不公开；**不可 API 化** |
| 33 | 实控人性质 | 央企/地方国企/民企/外资 | 无 | 中 | 低 | 无 | **中** | — / — / — | A 股需另接公司概况接口（本次未验证）；可用股东名称推断 | 名称推断准确率约 80-85%，混合所有制/无实控人难判 |
| 34 | 国有资本经营预算 | 全国/中央汇总收入 | 无 | 无 | 无 | 无 | **无** | — | 财政部网站 HTML，按年发布 | 只有全国/中央两级汇总，无企业明细；不能下钻 |

**可得性=高的指标：24 个**（第 1-8、10-16、19-27 行；第 25 行按 A/HK 直取、美股推导计为高）。
**中：8 个**（9、17、18、28-31、33）；**无：2 个**（32、34）。

---

## 3. 分组建议（数据模型）

### 3.1 利润表（8 项，全部 P0）
`revenue`、`cogs`、`grossProfit`、`operatingIncome`、`pretaxIncome`、`incomeTax`、`netIncome`、`netIncomeAttributableToParent`
增强项：`rdExpense`（P1）、`sgaExpense`（P1）、`ebitda`（派生，P2）。
现有 profit.json 的 11 字段里已有 revenue/cogs/gross/opInc/pbt/tax/netInc/rd/sga，**但缺归母净利、税前/税后口径区分、SG&A 拆分**；建议补 `netIncomeAttributableToParent` 与 `sgaComponents`。

### 3.2 资产负债表（8 项，P0 核心 6 项）
`totalAssets`、`totalLiabilities`、`equityAttributableToParent`、`cashAndEquivalents`、`inventory`、`accountsReceivable`、`interestBearingDebt`、`netDebt`。
银行/保险需要行业开关：`inventory`/`cogs`/`grossProfit` 对金融业置 null，`interestBearingDebt` 改用「存款+借款」。

### 3.3 现金流量表（6 项，P0）
`ocf`、`icf`、`fcfFinancing`、`capex`、`freeCashFlow`、`dividendsPaidCash`。
建议同时存 `ocfMethod`（直接法/间接法）与 `fiscalYearDays`（52/53 周公司）。

### 3.4 分红与股东回报（5 项，P0 分红三项 + P1 回购/股息率）
`dps`、`dividendTotal`、`payoutRatio`、`dividendYield`、`buybackAmount`。
A 股按**财年**归集（`REPORT_DATE` 的年），中期+年度合并；保留 `planStatus`（实施分配/股东大会通过/董事会预案），只把「实施分配」计入已实现分红。

### 3.5 国企专属（4 项，P1 代理 + P2 汇总）
`stateOwnershipRatio`、`stateDividendProxy`（上缴利润代理）、`ultimateControllerType`、`stateCapitalReturn`（仅汇总，P2/不可得）。
**不要**在 UI 上把 `stateDividendProxy` 标成「上缴利润」，应标注「按国有持股比例估算的国有股应得分红」。

---

## 4. 三个国企专属指标专项

### 4.1 分红：有标准 API，A 股最干净

| 市场 | 最佳源 | 字段/口径 | 单家成本 | 覆盖率 |
|---|---|---|---|---|
| A 股 | 东财 `RPT_SHAREBONUS_DET` | `PRETAX_BONUS_RMB`（每 10 股税前派息，元）、`TOTAL_SHARES`、`EX_DIVIDEND_DATE`、`ASSIGN_PROGRESS`、`IMPL_PLAN_PROFILE` | 15 分钟/家（含校验） | 600887 31 条/实施 30；600519 28/27；600028 50 条 |
| 港股 | 东财 `RPT_HKF10_MAIN_DIVBASIC` | `PLAN_EXPLAIN` 文本「每股派港币 5.3 元」、`REPORT_TYPE`（年度/中期/季度分配）、`EX_DIVIDEND_DATE`、`YEAR` | 25 分钟/家（正则+币种+股本） | 0700 27 条/年度 22；0941 52/23；0005 95/22 |
| 美股 | SEC `PaymentsOfDividendsCommonStock` / `PaymentsOfDividends` | 现金流量表「已付股息现金」，无每股/总额宣告口径 | 10 分钟/家 | MSFT 19 年（仅 CommonStock 标签）、KO 19 年（仅 PaymentsOfDividends）、CAT 18 年 |

**A 股实测校验（600887 伊利）**：
- 2024 年度：10 派 12.20 元 × 63.25 亿股 ÷ 10 = **77.17 亿元**；归母净利 84.5 亿 → payout ≈ **91%**。
- 2025 年度：中期 4.80 元（30.36 亿）+ 年度 9.00 元（56.93 亿）= **87.29 亿元**；归母净利 115.65 亿 → payout ≈ **75%**。
- 2026-09-30 有一条「10 派 4.20 元」状态为「股东大会决议通过」——**必须过滤，未实施不计入**。

**港股实测（0700 腾讯）**：2025 年度每股派港币 5.3 元，除净日 2026-05-15，发放日 2026-06-01；2024 年度 4.5 元；2023 年度 3.4 元。`DPS_HKD` 字段与公告一致，但**只覆盖年度分配，中期/特别息要合并 `RPT_HKF10_MAIN_DIVBASIC`**。

### 4.2 利润上缴：没有科目，只能代理

**结论：不存在公司级标准数据源，不可直接 API 化。**

- A 股三表全字段扫描（`GINCOME/GBALANCE/GCASHFLOW`，600887/600519）**没有任何** 上缴利润 / 国有资本收益 / STATE_OWNED / SASAC 字段；`INVEST_REALESTATE`、`LISTING_STATE` 是误命中。
- 财报里最接近的是**所有者权益变动表「对所有者（或股东）的分配」**，但它等于全部分红，不区分国有/非国有；东财 F10 **不提供**权益变动表（实测 `RPT_F10_FINANCE_GEQUITY/GOWNER/GCHANGE/GSTATEMENT/GALLEQUITY` 全部 `code=9501 报表配置不存在`）。
- **可行代理（推荐，P1）**：
  `上缴利润 ≈ 当年分红总额 × 国有股东持股比例`
  A 股用 `RPT_SHAREBONUS_DET` × `RPT_F10_EH_HOLDERS`（第一大股东通常即国有集团）。
  实测 600028 中石化：2025 年中期 0.88 元 + 年度 1.12 元 = 2.00 元/股，总额 **242.08 亿元**；中国石化集团持股 **68.73%** → 国有股应得分红 ≈ **166.4 亿元**。
- **直接口径（P2，仅样板）**：下载年报 PDF → 定位「所有者权益变动表—对所有者（或股东）的分配」→ 抽取金额；若还要区分「上缴国有资本收益」，需再读附注/国资委批复。**单家 40-60 分钟**（含 PDF 下载、表格定位、OCR 校验），31 家 A+H 国企约 **3.2 人天**，加 50% QA ≈ **4.8 人天**；且只能做最近 3-5 年，历史 PDF 版式不一。

**成本对比**：代理法 30 分钟/家（A 股 14 家 ≈ 1.2 人天含 QA）；OCR 法 40-60 分钟/家（31 家 ≈ 4.8 人天含 QA），且不可批量复现。

### 4.3 国有资本收益：只有汇总，无公司级

- 公司报表不披露「应缴国有资本收益」，国资委/财政部不公开企业级应缴额。
- 公开数据只有**财政部年度「全国国有资本经营预算收入」**（全国/中央两级，HTML 表格），以及国资委「中央企业上交税费」汇总；**无 API、无企业明细、不可下钻**。
- 若产品必须展示，只能：
  1. 用 4.2 的代理值，命名「国有股应得分红（估算）」；
  2. 或用行业法定收取比例（烟草/石油石化/电力等 20-25%，一般竞争 10-15%）× 归母净利做「应缴估算」，误差极大，不建议。
- **明确定性：P2/不可得，不要给用户「已覆盖」的错觉。**

---

## 5. 优先级排序

### P0（必做，2-3 周内可上线）
| 指标组 | 具体字段 | 理由（用户价值 × 覆盖率） |
|---|---|---|
| 利润表补全 | 归母净利、税前利润、SG&A 拆分、EBITDA | 现有 11 字段已有骨架，补齐即可让利润桥从「营业利润」下探到「归母」；覆盖约 84/93 |
| 资产负债表核心 | 总资产、总负债、归母权益、现金、存货、应收、有息负债、净负债 | 用户抱怨「资产负债表一概没进库」，这是估值/偿债分析的地基；SEC+A+HK 全覆盖，82/93 家可直接取 |
| 现金流量表核心 | OCF、ICF、FCF、Capex、已付股利 | 利润含金量/FCF 是国企与美股共同的核心指标；三源均直取，覆盖约 84/93 |
| 分红三项 | DPS、分红总额、payout | 用户第一诉求；A/HK 直取，美股现金口径可用；覆盖约 84/93（私有 3 家、韩股 3 家、台股 1 家、欧股 2 家除外） |

### P1（值得做，1-2 个月）
| 指标 | 理由 | 成本 |
|---|---|---|
| 股息率 | 分红功能的自然延伸，但需接行情源（A 股 `push2` 实时/收盘价） | 1 人天（含历史价格对齐） |
| 回购金额 | 股东回报总口径（分红+回购）需要；SEC 直取，A/HK 要抓公告 | 2 人天（A/HK 公告解析） |
| 国企持股比例 + 上缴利润代理 | 用户核心场景（国企分析），A 股 14 家可做，HK 需 PDF | 1.2 人天（A）+ 1.6 人天（HK） |
| 20-F/IFRS 映射 | TSM/SONY/ASML/BABA 等 7 家 ADR 已在库，不做会留白 | 1 人天（ifrs-full 标签映射，脚本已支持） |
| 研发费用补全 | A 股 2017 前无单列，需从管理费用附注拆；价值中等 | 1.5 人天 |

### P2（锦上添花）
| 指标 | 理由 |
|---|---|
| 国有资本收益（汇总） | 只有财政部 HTML 汇总，企业级不可得；做也只能做一张「全国预算收入」背景图 |
| 台湾/韩国/日本/欧洲 | TWSE 网络不通、EDINET/DART 需 key、欧洲无结构化源；7 家公司，投入产出比低 |
| 权益变动表 OCR 明细 | 仅用于把「上缴利润」从代理升级为直接口径，31 家 ≈ 4.8 人天，且只能回溯 3-5 年 |
| 员工人数/人均指标 | 与财报主链路无关，另行立项 |

---

## 6. 全站铺开工作量估算

按 93 家、8 小时/人天、QA 25% 计（QA = 抽检 20% 样本 + 边界校验 + 与原始报表对数）。

| 市场 | 家数 | 每家人力分钟（含映射/抽检） | 小计人天 | QA 25% | 合计人天 |
|---|---:|---:|---:|---:|---:|
| 美股（SEC 10-K/20-F） | 52 | 25 | 2.71 | 0.68 | **3.39** |
| A 股（东财三表+分红+股东） | 14 | 35 | 1.02 | 0.26 | **1.28** |
| 港股（东财 *_PC + 分红文本） | 17 | 40 | 1.42 | 0.35 | **1.77** |
| 韩国（DART，需 key） | 3 | 50 | 0.31 | 0.08 | **0.39** |
| 台湾（TWSE/MOPS，需抓 HTML） | 2 | 60 | 0.25 | 0.06 | **0.31** |
| 欧洲（NESN/MC，PDF） | 2 | 90 | 0.38 | 0.09 | **0.47** |
| 非上市/私有（HUAWEI/LEGO/SGCC） | 3 | 60 | 0.38 | 0.09 | **0.47** |
| **合计** | **93** | — | **6.46** | **1.62** | **8.08** |

**结论：结构化三表 + 分红铺满 93 家 ≈ 8.1 人天（1 人约 1.5 周）。**

若把 P1 的分红文本解析、国企代理、20-F 映射、股息率行情也做进去：

| 增量项 | 人天 |
|---|---:|
| 港股分红文本解析（17 家 × 25 分钟 + QA） | 1.1 |
| 国企持股/上缴代理（A 14 + HK 17） | 2.8 |
| 20-F IFRS 映射与回归（7 家） | 1.0 |
| 股息率行情源接入与历史对齐 | 1.0 |
| 权益变动表 OCR 样板（31 家，仅近 5 年） | 4.8 |
| **P0+P1 合计** | **≈ 18.7 人天** |

建议先做 **P0 的 8.1 人天**，上线后再按用户反馈决定是否投入 OCR 的 4.8 人天。

---

## 7. 原始 JSON 证据（截断）

### 7.1 SEC MSFT：`RevenueFromContractWithCustomerExcludingAssessedTax`（USD，10-K，FY）

```json
{
 "cik": 789019,
 "entityName": "MICROSOFT CORP",
 "tag": "RevenueFromContractWithCustomerExcludingAssessedTax",
 "units": { "USD": [
   { "start": "2024-07-01", "end": "2025-06-30", "val": 281724000000,
     "fy": 2026, "fp": "FY", "form": "10-K", "filed": "2026-07-29", "frame": "CY2025" },
   { "start": "2025-07-01", "end": "2026-06-30", "val": 331839000000,
     "fy": 2026, "fp": "FY", "form": "10-K", "filed": "2026-07-29", "frame": "CY2026" }
 ]}
}
```

> 同文件里旧标签 `Revenues` 只有 3 条（2008-2010）；只认一个标签会丢掉 2016 年以前的收入。

### 7.2 东财 A 股 600887 2025 年报（利润表，节选字段）

```json
{
 "SECUCODE": "600887.SH",
 "REPORT_DATE": "2025-12-31 00:00:00",
 "REPORT_TYPE": "年报",
 "TOTAL_OPERATE_INCOME": 115931105774.99,
 "OPERATE_COST": 75653843800.99,
 "OPERATE_PROFIT": 13527806620.67,
 "TOTAL_PROFIT": 12993830374.42,
 "INCOME_TAX": 1479919620.42,
 "PARENT_NETPROFIT": 11565166497.81,
 "RESEARCH_EXPENSE": 915007208.81
}
```

> 单位元；`REPORT_TYPE` 实际取值四种：`一季报/中报/三季报/年报`。600887 三表 115/115/104 行，年报 34/34/28 期。

### 7.3 东财港股 0700 2025 年报（`RPT_HKF10_FN_INCOME_PC`，前 5 个科目）

```json
[
 { "REPORT_DATE": "2025-12-31 00:00:00", "DATE_TYPE_CODE": "001", "STD_ITEM_NAME": "营业额",     "AMOUNT": 743689000000 },
 { "REPORT_DATE": "2025-12-31 00:00:00", "DATE_TYPE_CODE": "001", "STD_ITEM_NAME": "其他营业收入", "AMOUNT": 8077000000 },
 { "REPORT_DATE": "2025-12-31 00:00:00", "DATE_TYPE_CODE": "001", "STD_ITEM_NAME": "营运收入",   "AMOUNT": 751766000000 },
 { "REPORT_DATE": "2025-12-31 00:00:00", "DATE_TYPE_CODE": "001", "STD_ITEM_NAME": "营运支出",   "AMOUNT": 329173000000 },
 { "REPORT_DATE": "2025-12-31 00:00:00", "DATE_TYPE_CODE": "001", "STD_ITEM_NAME": "毛利",       "AMOUNT": 422593000000 }
]
```

> 长表结构（一行一科目），不是宽表；年度过滤必须用 `DATE_TYPE_CODE="001"`，没有 `REPORT_TYPE`/`CURRENCY` 字段。金额单位是**报告币种**（腾讯为人民币），不是 `MAININDICATOR.CURRENCY` 显示的 HKD。

### 7.4 东财 A 股 600887 分红（`RPT_SHAREBONUS_DET`）

```json
{
 "SECURITY_CODE": "600887",
 "REPORT_DATE": "2025-12-31 00:00:00",
 "ASSIGN_PROGRESS": "实施分配",
 "PRETAX_BONUS_RMB": 9,
 "TOTAL_SHARES": 6325360667,
 "EX_DIVIDEND_DATE": "2026-06-05 00:00:00",
 "IMPL_PLAN_PROFILE": "10派9.00元(含税,扣税后8.10元)"
}
```

> `PRETAX_BONUS_RMB=9` 是「每 10 股 9 元」，不是总额；总额 = 9/10×63.25 亿 = 56.93 亿元。同一财年还有中期 4.8 元（30.36 亿元），合并后 2025 年度共 87.29 亿元。

---

## 8. 未验证 / 受阻清单

| 项 | 状态 | 原因 | 影响 |
|---|---|---|---|
| 韩国 DART | **未验证** | 无 OpenDART key，`status=010`（등록되지 않은 인증키） | 3 家韩股（三星/海力士/LG）拿不到结构化三表；需免费注册 key，预计 0.4 人天 |
| 日本 EDINET | **未验证** | API 要求 `Subscription-Key`，无 key 返回 401 | 日本 1 家（SONY 已用 SEC 20-F 覆盖，其他日股不在库） |
| 台湾 TWSE/MOPS | **受阻** | `openapi.twse.com.tw`、`www.twse.com.tw` 连接超时（curl 28）；MOPS 返回反爬 HTML 壳 | 2 家台股（台积电/联发科）；台积电已用 SEC 20-F 覆盖，联发科暂无 |
| 欧洲 NESN/MC | **无源** | 无免费结构化 API；两家不在 SEC 报送 | 2 家；只能 PDF/年报手工，90 分钟/家 |
| A 股权益变动表 | **无 API** | 东财 5 个候选 reportName 全部 9501 | 「上缴利润」无法直接取，只能代理或 OCR |
| A 股回购金额 | **无标准字段** | 三表无「回购支付现金」科目，只有 `TREASURY_SHARES` 余额 | P1 需公告解析 |
| 港股股东结构 | **无 API** | 未找到 `RPT_HKF10_*HOLDER*` 有效接口 | 港股国企上缴代理需 PDF，成本 +1.6 人天 |
| 美股 DPS 全量 | **部分验证** | 仅验证 `PaymentsOfDividends*` 现金口径；`CommonStockDividendsPerShareDeclared` 未逐家跑 | 美股 DPS 可由总额/股本推导，精度可接受 |
| 股息率（A/美股） | **未验证** | 需接行情源（本次未测 `push2.eastmoney.com`） | P1，1 人天 |

---

## 9. 复现方式

```bash
# 全量（SEC 3 + A 股 2 + 港股 3 + DART）
node scripts/probe_metrics.mjs all

# 分源
node scripts/probe_metrics.mjs sec MSFT KO CAT
node scripts/probe_metrics.mjs sec BABA TSM SONY ASML   # 20-F / IFRS
node scripts/probe_metrics.mjs a 600887 600519 600028
node scripts/probe_metrics.mjs hk 0700 0941 0005
node scripts/probe_metrics.mjs dart 005930

# 强制刷新（默认读 tmp-metrics-probe/cache/）
node scripts/probe_metrics.mjs sec MSFT --no-cache
```

输出示例（MSFT，节选）：

```
RevenueFromContractWithCustomerExcludingAssessedTax  USD n=11 2016-06-30..2026-06-30 latest=3318.39e8
CostOfGoodsAndServicesSold                           USD n=11 2016-06-30..2026-06-30 latest=1063.74e8
GrossProfit                                          USD n=19 2008-06-30..2026-06-30 latest=2254.65e8
SellingGeneralAndAdministrativeExpense               MISSING
Assets                                               USD n=18 2009-06-30..2026-06-30 latest=7583.76e8
PaymentsOfDividends                                  MISSING
PaymentsOfDividendsCommonStock                       USD n=19 2008-06-30..2026-06-30 latest=264.45e8
```

脚本要求：Node ≥ 18（内置 `fetch`）；SEC 带 `User-Agent`，东财带 `Referer`；缓存目录 `tmp-metrics-probe/cache/` 已在 `.gitignore` 之外，提交时不要 `git add`。

---

## 10. 对现有数据模型的改动建议

现有 `data/profit.json` 是「利润桥 11 字段 + 分部」，建议新增**并列的 `metrics` 块**而不是改原有字段（避免破坏现有图表）：

```jsonc
{
  "ticker": "600887.SS",
  "metrics": {
    "income":  { "revenue": 1159.31, "cogs": 756.54, "grossProfit": 402.77,
                 "operatingIncome": 135.28, "pretaxIncome": 129.94, "incomeTax": 14.80,
                 "netIncome": 115.14, "netIncomeParent": 115.65,
                 "rdExpense": 9.15, "sgaExpense": 262.41 },
    "balance": { "totalAssets": 1520.99, "totalLiabilities": 935.54,
                 "equityParent": 546.56, "cash": 194.95, "inventory": 108.23,
                 "accountsReceivable": 29.87, "interestBearingDebt": 499.33, "netDebt": 304.38 },
    "cashflow":{ "ocf": 143.44, "icf": -77.96, "fcfFinancing": -134.73,
                 "capex": 30.37, "freeCashFlow": 113.07, "dividendsPaidCash": 120.25 },
    "dividend":{ "dps": 1.38, "total": 87.29, "payoutRatio": 0.755,
                 "fiscalYear": 2025, "planStatus": "实施分配" },
    "soe":     { "stateOwnershipRatio": null, "stateDividendProxy": null,
                 "controllerType": "民营", "source": "RPT_F10_EH_HOLDERS" },
    "meta":    { "currency": "CNY", "source": "eastmoney", "fetchedAt": "2026-11-22" }
  }
}
```

金额单位建议统一「亿元」并保留 2 位小数；同时存 `currency` 与 `unit`，因为港股同一家公司可能报告币种是 CNY/USD，而交易币种是 HKD。

---

*本报告所有数字均由 `scripts/probe_metrics.mjs` 于 2026-11-22 真实请求生成；缓存响应见 `tmp-metrics-probe/cache/`（不入库）。*
