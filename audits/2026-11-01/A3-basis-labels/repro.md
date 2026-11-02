# repro.md · 复现步骤（A3 计算口径/单位/标签审计）

审计为**只读**，未修改仓库代码、未 git add/commit/push。以下步骤可在任意机器复现全部结论。

## 1. 纯函数回放（无需起服务，最快）
`probe_canon.js` 将 `app.js` 的相关纯函数**逐字复制**（quarterLabel / profitRowIsCumulative /
fiscalYearEndMonth / periodCoveredMonths / barBasisInfo / barBasisTag / cumulativeView /
segPeriodType / segPeriods / segPeriodLabel / ytdSum 等），直接读 `data/profit.json` 与
`data/segments.json`，对每家公司最常披露的分部逐点打印 `axis / head / basis / share / denom / grow`。

```bash
cd profitbridge/audits/2026-11-01/A3-basis-labels
node probe_canon.js            # 输出见 evidence/probe_canon.output.txt
```
预期可见（关键行）：
- `600887.SS … axis="H1'25" head="Q2 2025" … basis.cum=false decal=false … grow=qoq -44.1`（Class A：轴对、head 错、无斜纹、增速跨期）
- `SONY … axis="FY 2026" head="Q1 2026" … grow=yoy -6.7`（Class B：轴 FY / head 日历季）
- `00700.HK … axis="FY 2024" head="Q4 2024" … grow=qoq 43.8`（Class C：值=同比、标 qoq）
- `005930.KS … 2025-12-31 axis="Q4'25" head="Q4 2025" … grow=yoy 19.6`（三星：全年值标 Q4）
- `00992.HK … seg="null" pts=0`（Lenovo 分部 bar 缺失）

## 2. 数据级核对（可选，node 单文件）
```bash
node -e '
const D=require("./data/profit.json").companies, S=require("./data/segments.json").companies;
// 粒度分类
const cnt={};
for(const tk in S){const p=S[tk].periodTypes||{};const vals=Object.values(p);const last=vals[vals.length-1]||"none";cnt[last]=(cnt[last]||0)+1;}
console.log("seg 粒度分布",cnt);
// 00151.FYE / interim
const c=D["00151.HK"];console.log("00151 interim ends",c.quarters.filter(q=>q.periodType==="interim").map(q=>q.end).slice(-3));
// 00992 quarters 空
console.log("00992 SEG.quarters keys",Object.keys(S["00992.HK"].quarters||{}).length,"annualQuarters",Object.keys(S["00992.HK"].annualQuarters||{}));
'
```

## 3. 页面级验证（可选；铁律：服务 8447+、chrome CDP 9363+、独立 user-data-dir、只 Node）
> 本环境 .NET TLS 坏，仅用 Node；出网需 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897`。**不碰 8440**。
```bash
# 起静态服务（另起端口，避免 8440）
npx --yes http-server ./profitbridge -p 8447 &
# 用 chrome CDP 9363 + 独立 profile 打开 http://127.0.0.1:8447/index.html，
# 切到 bar 视图，选 600887.SS 的『奶粉及奶制品』分部，观察：
#   - 轴 H1'25 / FY 2025；tooltip 头部却显示 Q2 2025 / Q4 2025，且追加"· 上半年累计"
#   - 半年累计柱无斜纹（图例称"斜纹柱=半年/9M 累计"）
#   - 环比折线出现 FY vs H1 跨期百分比
```
现有自动化脚本可复用（会自起浏览器）：`tests/verify_bar_basis_labels.mjs`、`tests/verify_seg_axis.mjs`、
`tests/verify_bar_cum_growth.mjs`、`tests/verify_cum_seg.mjs`。修复 F3/F2 后应把它们纳入回归。

## 4. 结论复算的关键口径（便于复核）
- 轴：`segPeriodLabel` 按 `qv.__segPT`（app.js:910-919）→ 正确。
- 占比分母：`pctLine`（app.js:1037-1055）；分部用 `cumulativeView(qv).values.revenue*dispFactor` 否则 `rawMetrics(qv).revenue`。
- 累计判定：`cumulativeView` 的 `pt` 取自 **segments**（app.js:450），非 profit 行 → 分母正确。
- 增速：`growthLine`（app.js:1079）用 **profit 行** periodType 判累计，未用 `__segPT` → Class A/B/C 增速口径错（F3/F4）。
