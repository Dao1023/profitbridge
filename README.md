# 利润析视 Profit Bridge

> **10 秒看清一家巨头怎么赚钱：分部收入 → 利润桥 → 净利润，15 年商业史一图流。**
>
> **English**: See how a tech giant actually makes money — segment revenue flowing through a proportional Sankey "profit bridge" down to net income.

**[🌐 在线体验 → https://dao1023.github.io/profitbridge/](https://dao1023.github.io/profitbridge/)**　·　无需安装，点开即用

![NVDA 占比+环比模式](docs/screenshots/nvda_pct_qoq.png)

## 为什么值得一看

- 🌉 **利润桥桑基图** — 营收 → 毛利 → 营业利润 → 净利润，钱从哪来、被谁吃掉、剩多少，流宽即金额，一眼看穿。
- 📊 **全历史柱状图** — 任选科目/分部，2010 → 2026 逐季时间序列，**无断季、无空洞**。
- 🎚️ **占比 / 环比一键切换** — 看结构（占营收 %）或看动能（QoQ 变化），不用碰 Excel。
- 🏛️ **每个数字可溯源** — 美股来自 SEC EDGAR XBRL 真实申报，港/A/韩/台/欧股来自交易所与权威聚合源，不是拍脑袋。
- 💱 **多币种多频次** — 80 家、7 个市场、申报本位币入库；年度看同比、港混频不跨期环比，口径不撒谎。
- 🫥 **缺数据就留白** — 不编数、不插值。没披露的季度诚实空着，这是工程诚信，不是缺陷。
- ⚡ **纯前端零构建** — 无框架、无 npm install，克隆或点开链接即可运行。

## 覆盖范围

**80 家公司 · 3,191 季/年度期 · 7 个市场**（实测统计自合并后 `data/profit.json`，2026-10-26）。美股条目无 64 季封顶，为 EDGAR XBRL 完整连续历史（AAPL 71 季、MSFT 76 季、CSCO 72 季等）；SPCX（SpaceX）IPO 后仅 2 季经豁免入主序列；7 期尾端缺口（V/KO/NXPI 10-Q、SONY/TSM/TME/DIDIY 20-F）已从 filing 内嵌 iXBRL 实抓补齐（SEC companyfacts 未收录该批申报财务 facts），覆盖审计缺失期=0。

| 市场 | 公司数 | 期数 | 口径 |
| --- | --- | --- | --- |
| 美股（EDGAR 季度 10-Q/10-K） | 45 | 2,472q | USD-M，Q4=FY−Q1..Q3；SPCX（SpaceX）2026-06 IPO 后仅披露 2 季，低于 minKeep=12 经豁免单独收录 |
| 年度申报（20-F/年报：阿里/百度/京东/拼多多/瑞幸/TSM/DIDIY/ASML/ARM/SPOT/STM/SONY/NESN/MC 等） | 21 | — | 申报本位币（CNY/TWD/EUR/CHF/JPY-M），frequency:'annual' |
| 港股（HKEX/东财，累计期差分为单季） | 11 | 313q | CNY-M，frequency:'hk-mixed'，联想为 USD 单季 17q |
| 韩股（stockanalysis/fnguide 独立单季） | 3 | 111q | KRW-M，frequency:'mixed' |
| A 股（东财，真单季） | 13 | 640q | CNY-M |
| 台股（TWSE 季度） | 2 | 30q | TWD-M（2330.TW 与 TSM 年度条目并存，口径互见、禁跨条目环比） |

界面支持中英切换、多币种显示（CNY-M 可切 ¥/US$，其余币种按各期末汇率自动折算 USD 展示）、年度序列「环比」自动改为「同比」、hk-mixed 序列环比不跨 periodType，图表可一键导出 SVG / PNG。

### 数据来源分层

- **SEC EDGAR XBRL**：美股季度（80–100 天连续性护栏）+ 外国发行人 20-F 年度（300–400 天）+ 分部 R 文件；
- **HKEX/东财**：港股利润表（仅营收+净利润，累计期差分为单季；差分后营收为负的期如实置 null 并在 notes 标注）；
- **东财**：A 股单季（CNY-M）；
- **stockanalysis / fnguide / TWSE**：韩股、台股、欧股（雀巢/开云年度、台积电 ADR 外的台股季度）。

### Skipped 名单（如实不收录）

- **TCEHY / XIACF**：非 SEC 注册主体（EDGAR 无对应申报，财务仅在港交所披露），不在 EDGAR 数据范围内；
- **02513.HK（Z.AI）/ 00100.HK（MiniMax）**：港股累计期可差分出的单季不足 8 季，达不到最低序列长度；

## 快速开始

1. **在线用**：直接打开 [https://dao1023.github.io/profitbridge/](https://dao1023.github.io/profitbridge/)；
2. **本地跑**：双击 `start.bat`（或 `node scripts/serve.mjs 8440`），浏览器打开 <http://127.0.0.1:8440/>；
3. **自托管**：本仓库是纯静态站点，GitHub Pages 选 `main / (root)` 即可，无任何构建步骤。

---

## 附录：数据口径与工程细节

<details>
<summary><b>数据来源与口径</b></summary>

- 来源：**SEC EDGAR XBRL companyfacts API**（美股利润表）+ **EDGAR 申报的分部 R 文件**（FilingSummary.xml → R\*.htm）+ **HKEX/东财/stockanalysis/TWSE**（港股、A股、韩股、台股、欧股，详见上方来源分层）。
- **Q4 由 FY − Q1..Q3 推导**（SEC 申报的是 YTD 累计值；港股累计期同理差分为单季）。
- 护栏按频次类适配：美股季度 **80–100 天**、年度 **300–400 天**、hk-mixed 按 periodType 分组各自校验（annual 300–400d、单季 70–250d）；并做利润链自洽校验（各桥节点可加合，有 gross 的家 gross≤revenue）。
- **缺失的科目/分部如实留空，不编造**：不申报毛利的公司（GOOGL/AMZN/META/ORCL）桑基自动切换结构；无分部披露的季度在数据 `notes` 中逐一列明；分部对不上营收的季度直接丢弃（`failures` 记录原因与原文出处）。
- **INTC**：Intel Foundry 模式下分部收入含内部销售，无干净的外部收入拆分 → 标记为 `degraded`，前端诚实降级展示。
- **TSM**：20-F 只有年度 ifrs-full 数据 → 以 TWD-M 10 财年条目收录（2020–2023 年 frankfurter 无 TWD 汇率，按邻近区间迭代逼近补齐，notes 标 `fxApprox`）；台股 2330.TW 季度条目独立并存，禁跨条目环比。
- **非经营性收益节点**：当净利润 > 营业利润时出现，数值 = 净利润 − 营业利润。GOOGL 2026 Q2 实例：NetIncomeLoss $112.19B、OperatingIncomeLoss $40.77B，桥内 71.42 自洽（已核对 10-Q frame CY2026Q2 原始 XBRL）。
- **多币种口径**：各条目 `currency` 为申报本位币（如 CNY-M/TWD-M/KRW-M）；前端默认按各期期末汇率折算 USD 显示（CNY-M 条目可手动切回 ¥ 原币）。批次内已带期末汇率；TSM 2020–2023 年汇率以邻近区间迭代逼近补齐（frankfurter 无 TWD 该区间数据），并在 notes 标注。
- 数值单位：百万（各条目申报本位币 -M；显示层按上条折算）。

</details>

<details>
<summary><b>利润桥实现</b></summary>

- 手写 SVG 桑基图，单一公共比例尺（px/$），流宽误差 < 1%；
- hover tooltip 显示精确金额与占比/环比。

</details>

<details>
<summary><b>更新数据</b></summary>

```powershell
$env:NODE_USE_ENV_PROXY="1"; $env:HTTPS_PROXY="http://127.0.0.1:7897"   # 如需代理
node scripts/fetch_profit.mjs    # 利润表 → data/profit.json + data/profit.json.js
node scripts/fetch_segments.mjs  # 分部 → data/segments.json
node scripts/validate_profit.mjs # 口径校验
```

`data/profit.json.js` 是 `profit.json` 的 JSONP 内联副本（`window.__PROFIT_DATA`），仅供 file:// 双击打开时兜底；正常走 HTTP 时前端 `fetch` 同目录 JSON。

</details>

<details>
<summary><b>目录结构与脚本</b></summary>

```
index.html / app.js    站点（原生 JS + vendor/echarts.min.js 5.6）
data/                  profit.json / segments.json / companies.json / logos/
scripts/               serve.mjs（零依赖静态服务器）、fetch_profit.mjs、
                       fetch_segments.mjs、validate_profit.mjs、
                       verify_profit_fix.mjs、verify_segments_hist.mjs（回归）
tests/                 verify_bar / verify_modes / verify_timeline2 / verify_new（无头 CDP + 数据回归，
                       需先起 :8440 服务；截图与浏览器 profile 落在 tests/.shots、tests/.chrome）
docs/screenshots/      README 配图
```

</details>

## License

数据来自 SEC EDGAR（公有领域）。代码 MIT。
