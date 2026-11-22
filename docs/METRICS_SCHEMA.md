# 指标明细数据层 schema（`data/metrics.json` · `metrics-v1`）

> 一句话：**一家公司 = 若干财年 × 5 个字段组**，金额一律「报告币种 × 百万」两位小数，缺失写 `null` 并解释，
> 比率一律由前端现算、不入库。字段清单的机器可读真源是 `scripts/metrics_schema.mjs`（`CORE` / `EXTENDED`），
> 本文件是给人看的登记簿，两者必须同步。

## 1. 文件结构

```jsonc
{
  "updated": "2026-11-22",
  "schema": "metrics-v1",
  "companies": {
    "SGCC": {
      "name": "State Grid Corporation of China 国家电网有限公司",
      "currency": "CNY-M",          // 报告币种 + 单位（M = 百万）
      "asReported": true,           // 只取原报告数，不做任何口径调整
      "frequency": "annual",
      "dividendBasis": "declared",  // declared | cash | null（见 KNOWN_CAVEATS 第十三节）
      "dividendBasisNote": "…",     // 中文口径说明（前端表尾展示）
      "dividendBasisNoteEn": "…",   // 英文口径说明
      "stateOwnership": 1,          // 1 = 国务院国资委 100% 持股（利润上缴口径成立）
      "stateStake": {                // 第一大国有股东持股比例（下限代理口径；查不到就整个字段省略）
        "ratio": 0.544,              // 0–1，四位小数；A 股 = HOLD_NUM_RATIO ÷ 100，SGCC 用 stateOwnership=1 视为 1
        "holder": "中国贵州茅台酒厂(集团)有限责任公司",
        "layer": "local-soe",        // central-soe | local-soe
        "asOf": "2025-12-31",        // 该比例的披露基准日
        "source": "东财 RPT_F10_EH_HOLDERS 2025-12-31 第 1 名 54.40%（681,282,935 股）"
      },
      "stateStakeNote": "民营/无实际控制人时写清理由（有 stateStake 时写口径补充）",
      "sourceUrl": "…",
      "sourceNote": "…",
      "fields": { "income": ["…"], "shareholder": ["…"], "balance": ["…"], "cashflow": ["…"], "perShare": [] },
      "years": [ {
        "end": "2025-12-31", "periodType": "FY", "fiscalYear": 2025,
        "income": { … }, "shareholder": { … }, "balance": { … }, "cashflow": { … }, "perShare": { … },
        "sources": ["P2025.pdf p47 … · 合并所有者权益变动表 · dividendsTotal: …"],
        "nulls": ["gross", "dividendsPaid", "buyback", "eps", "dps"],
        "restated": { "dividendsTotal": 8098.24, "dividendsToParent": 4582.18, "source": "P2022.pdf p38 …" },
        "notes": [ { "id": "fy2021-restated", "fields": ["…"], "text": "…" } ]
      } ]
    }
  }
}
```

**硬约束**（`tests/verify_metrics.mjs` 逐条断言、`node scripts/derive_dividends.mjs --check` 可离线复查）：

1. `fields.<组>` 只登记「至少有一年有值」的字段，且必须等于实际非 null 字段集合；
2. 每年 `nulls` 必须与「该字段在它所属组内为 `null`」的集合**完全相等**（字段只属于一个组）；
3. `nulls` 里每个字段都要在某条 `sources` 字符串里出现（写清为什么没有）；
4. 金额最多两位小数、不是字符串；比率（`grossMargin` / `payout` …）**不得**出现在任何组里；
5. `years` 按 `end` 升序；`metrics.json.js` 必须是同一份 JSON 的 `window.METRICS_DATA = {…};` 镜像（deepEqual）；
6. `stateStake` 只能来自**可追溯的原始股东表**（接口行 / 年报页码 + 原始数字），`ratio` 必须 4 位小数；
   没有国有控股股东的公司省略该字段，但**必须**写 `stateStakeNote` 说明原因；派生值（利润上缴）只在前端现算、不入库。

## 2. 字段登记簿

### 2.1 `income`（合并利润表）

| 字段 | 中文 | 说明 |
| --- | --- | --- |
| `revenue` | 营业收入 | SGCC 取「营业收入」（**不含**营业总收入口径）；A 股 `TOTAL_OPERATE_INCOME`；港股「营运收入」 |
| `totalRevenue` | 营业总收入 | 扩展字段。仅 SGCC（营业总收入 = 营业收入 + 利息/已赚保费/手续费等） |
| `cogs` | 营业成本 | A 股 `OPERATE_COST`；港股「营运支出」 |
| `gross` | 毛利 | **A 股利润表不单列毛利** → SGCC / 600887 记 `null`，毛利率由 营收−营业成本 现算 |
| `opInc` | 营业利润 | |
| `rd` | 研发费用 | 港股腾讯只在附注披露 → 00700 记 `null` |
| `sga` | 销售 + 管理费用 | 聚合字段：`sellingExpenses + adminExpenses`（SGCC）/ `sale + admin`（A 股）/ 销售及分销 + 行政开支（港股） |
| `pbt` | 利润总额 | |
| `tax` | 所得税费用 | **不含**「税金及附加」 |
| `netInc` | 净利润（归母） | 全部 6 家统一为**归母**口径（SGCC = 归属于母公司所有者的净利润；600887 `PARENT_NETPROFIT`；00700 `HOLDER_PROFIT`；005930 `지배주주순이익`）。分红率的分母就是它 |
| `taxAndSurcharges` | 税金及附加 | 扩展字段。仅 SGCC；FY2022 起原表重分类，跨期不可比（见 KNOWN_CAVEATS 第十二节） |
| `finExpense` | 财务费用 | 扩展字段。仅 SGCC |
| `investmentIncome` | 投资收益 | 扩展字段。仅 SGCC |
| `interestExpense` | 其中：利息费用 | 扩展字段。仅 SGCC；FY2021 / FY2022 原表无该明细行 → `null` |

### 2.2 `shareholder`（股东回报 · 2026-11 新增组）

| 字段 | 中文 | 说明 |
| --- | --- | --- |
| `dividendsTotal` | 现金分红总额 | **当年宣告/分配**（`dividendBasis = declared`）或**当年已付现金**（`cash`）。SGCC/600887 = 宣告；MSFT/KO = 已付现金；00700/005930 = `null`（不可得，不估算）。A 股 = `每 10 股派息 ÷ 10 × 股本`（只计「实施分配」，含送转年度用年末实收资本）；港股 = `DPS × 逐期股本`（无逐期股本则 `null`，不估算） |
| `dividendsToParent` | 其中：归属母公司股东 | 利润上缴的分子。SGCC 取权益变动表归母列（FY2021 空白 → `null`）；其余 18 家分红全部归属母公司股东 ⇒ = `dividendsTotal`（不拆少数股东） |

**派生（不入库，前端现算）**

| 行 | 公式 | 说明 |
| --- | --- | --- |
| `payout` 分红率 | `dividendsToParent ÷ income.netInc` | 两者同为 as reported；无总额来源回退 `dps ÷ eps`（脚注标口径） |
| `stateDividend` 利润上缴 | `dividendsToParent × ratio`，其中 `ratio = stateStake.ratio ?? (stateOwnership === 1 ? 1 : null)` | **代理口径（下限）**：企业报表无「上缴」科目；有 `stateStake` 就用第一大国有股东比例折算，SGCC（`stateOwnership = 1`）视为 1；未登记国有股东的公司显示 `—`。为何是下限、为何不可外推见 KNOWN_CAVEATS 第十四节 |

### 2.3 `balance`（合并资产负债表）

| 字段 | 中文 | 说明 |
| --- | --- | --- |
| `cash` | 货币资金 | |
| `receivables` | 应收账款 | |
| `inventory` | 存货 | |
| `currentAssets` | 流动资产合计 | |
| `ppe` | 固定资产 | |
| `totalAssets` | 资产总计 | |
| `debtShort` | 短期有息负债 | 聚合：短期借款 + 一年内到期的非流动负债 |
| `debtLong` | 长期有息负债 | 聚合：长期借款 + 应付债券 |
| `liabilities` | 负债合计 | |
| `equityParent` | 归母所有者权益 | ROE 分母 |
| `equity` | 所有者权益合计 | |
| `cip` | 在建工程 | 扩展字段。仅 SGCC（电网资本开支在建规模） |
| `paidInCapital` | 实收资本 | 扩展字段。仅 SGCC |
| `retainedEarnings` | 未分配利润 | 扩展字段。仅 SGCC |
| `minorityInterests` | 少数股东权益 | 扩展字段。仅 SGCC |

### 2.4 `cashflow`（合并现金流量表）

| 字段 | 中文 | 说明 |
| --- | --- | --- |
| `ocf` | 经营活动现金流净额 | |
| `capex` | 资本开支 | 购建固定资产等支付的现金 |
| `icf` | 投资活动现金流净额 | |
| `finCashFlow` | 筹资活动现金流净额 | 扩展字段。仅 SGCC |
| `dividendsPaid` | 已付现金股利 | 收付实现制。SGCC 的对应行含利息（混合口径）→ `null`，见 KNOWN_CAVEATS 第十三节 |
| `buyback` | 回购股份 | 无该科目的来源记 `null` |

### 2.5 `perShare`（每股数据，不换算币种单位）

| 字段 | 中文 | 说明 |
| --- | --- | --- |
| `eps` | 每股收益 | 稀释口径；港股/韩股按来源原值 |
| `dps` | 每股股利 | 一律**两位小数**（舍入误差用 `0.005 × 股本` 作容差校验）。600887 与 A 股 13 家 = `Σ(每10股派息) ÷ 10`；00700 与 00941 的港币宣派 = 港元 × 除净日 ECB 汇率折人民币；其余港股直接用「每股派人民币 X 元」 |

### 2.6 公司级元数据：`stateStake` / `stateStakeNote`（2026-11 新增）

**利润上缴没有报表科目**，所以只能给代理口径：取**第一大国有股东（或国有控股集团）的持股比例**。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `stateStake.ratio` | number | 0–1，四位小数。A 股 = 东财 `RPT_F10_EH_HOLDERS` 的 `HOLD_NUM_RATIO ÷ 100`；港股无股东接口，用**同一发行人的 A 股十大股东**（总股本口径）或港股年报「主要股东」章节 |
| `stateStake.holder` | string | 持股方**原始名称**（必须与接口 `HOLDER_NAME` / 年报原文逐字一致） |
| `stateStake.layer` | `central-soe` \| `local-soe` | 央企 / 地方国企 |
| `stateStake.asOf` | `YYYY-MM-DD` | 该比例的披露基准日（目前统一 2025-12-31） |
| `stateStake.source` | string | 接口名 + 基准日 + 排名 + 原始比例与股数；港股给 PDF 页码 |
| `stateStakeNote` | string | 国有控股时写口径补充（同系其他国有股东未计入）；非国有控股时写清原因（民营/无实际控制人/无控股股东） |

规则：

1. **名义持有人不算**：`HKSCC NOMINEES` / `香港中央结算(代理人)` 是托管口径，取第一个**实益**国有股东；
2. **不同发行人不能互相借用**：`00762.HK` 用自己年报 p.79，不能借 `600050.SH` 的 36.46%；
3. 查不到逐期/准确比例就记 `null`（整个 `stateStake` 省略），**不估算**；
4. 派生值 `利润上缴 = dividendsToParent × ratio` **只在前端现算、不入库**；`stateOwnership === 1` 视为 `ratio = 1`。

## 3. 新增字段 / 新增公司的做法

1. 在 `scripts/metrics_schema.mjs` 里登记：必备字段进 `CORE`，只有部分公司能取到的进 `EXTENDED`；
   同步更新 `GROUPS` 的顺序（决定表格行序），并按需补 `app.js` 的 `MV_GROUPS` 行描述符 + `I18N.mvFields`（中英）。
   国有持股比例按上面 2.6 的规则补 `stateStake`/`stateStakeNote`。
2. 数据进 `data/metrics.json` 后重新生成镜像：`data/metrics.json.js` = `'window.METRICS_DATA = ' + JSON.stringify(json) + ';\n'`。
3. 每个新数字都要有一条 `sources`：**页级/表级出处 + 科目原始名 + 原始值 + 换算规则**；取不到的写 `null` 并在
   `sources` 写明原因（哪个来源、缺哪个科目、为什么不可推算）。
4. 跑 `node scripts/derive_dividends.mjs --check`（离线一致性）+ `BASE=http://127.0.0.1:8451 node tests/verify_metrics.mjs`（逐位对源）。
5. 跨年重述用 `years[].restated`，需要脚注时用通用的 `years[].notes[{id, fields, text}]`（前端渲染成上标 + 脚注列表），
   **不要**覆盖 as-reported 主值。
