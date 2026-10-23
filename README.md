# 利润析视 Profit Bridge

利润桥看板：营收 → 成本/毛利 → 营业费用/营业利润 → 税费/净利润，全部数字来自 SEC EDGAR XBRL 真实申报数据，桑基流宽与金额严格成比例。

## 数据来源

- **SEC EDGAR XBRL companyfacts API**：`https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`（免 key，需 User-Agent 头）
- US-GAAP tags：`Revenues` / `RevenueFromContractWithCustomerExcludingAssessedTax`（回退链）、`GrossProfit`、`OperatingIncomeLoss`、`NetIncomeLoss`、`ResearchAndDevelopmentExpense`、`SellingGeneralAndAdministrativeExpense`、`IncomeTaxExpenseBenefit`
- 只保留 85–100 天的季度区间，优先 10-Q/10-K 申报的 facts
- 输出：`data/profit.json`（fetch 用）+ `data/profit.json.js`（file:// 回退用，`window.__PROFIT_DATA`）
- 覆盖：10 家公司 × 12 个季度（NVDA / AAPL / MSFT / GOOGL / AMZN / META / TSLA / ORCL / AMD / INTC）。TSM（外国发行人，无季度 US-GAAP XBRL）与 AVGO（季度数不足）被诚实跳过。

## 更新数据

```powershell
$env:NODE_USE_ENV_PROXY="1"; $env:HTTPS_PROXY="http://127.0.0.1:7897"   # 如需代理
node fetch_profit.mjs      # 重新生成 data/profit.json 和 data/profit.json.js
```

## 运行

- **双击 `index.html` 即可用**（file:// 下自动回退到内联的 `data/profit.json.js`）
- 或起本地服务器：`node` 任意静态服务指向本目录，走 fetch 路径

## 功能

- 公司切换 / 季度下拉（全部真实联动，KPI + 桑基重算）
- 桑基图手写 SVG，单公共比例尺（px/$），流宽误差 <1%
- 有 R&D + SG&A 数据的公司拆分显示研发/销管红节点；缺失的公司保持合并（诚实显示）
- tooltip、导出 PNG（真下载）、中英切换（含图内标签）、回到默认
- 图内标题用日历季度命名（Q# YYYY）；各公司财年不同，精确期末日期始终显示在旁边

## 口径说明

- **非经营性收益节点**：当净利润 > 营业利润时出现，数值 = 净利润 − 营业利润，即非经营性项目扣税后的净贡献（XBRL 税前口径 `NonoperatingIncomeExpense` 会更大）。GOOGL 2026 Q2 实例：SEC 原文 NetIncomeLoss $112.19B、OperatingIncomeLoss $40.77B、NonoperatingIncomeExpense（税前）$97.98B、税 $26.56B；桥内显示 71.42 = 112.19 − 40.77，自洽。已核对 SEC companyfacts 原始 XBRL（10-Q, frame CY2026Q2），为申报原文而非解析错误。
- 部分公司（GOOGL/AMZN/META/ORCL）不申报 GrossProfit，桑基自动切换为 营收→(营业利润+成本费用) 结构。
