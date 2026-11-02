成品路径：`profitbridge/audits/2026-11-01/A3-basis-labels/REPORT.md`

# profitbridge A3 审计 · 计算口径 / 单位换算 / 标签诚实性

- 审计日期：2026-11-01
- 审计范围：`profitbridge/app.js`（1577 行）、`profitbridge/index.html`（182 行）、`profitbridge/data/profit.json` 与 `profitbridge/data/segments.json`（各 92 家公司，利润单位=本币百万，分部单位=USD $M）
- 审计方法：静态代码走查 + 用 `probe_canon.js`（逐字复制 app.js 纯函数）对全部 92 家公司真实数据回放「轴标签 / tooltip head / basis(decal) / 占比分母 / 增速口径」；`grep` 穷举所有 `% / ×100 / /MB / toFixed` 换算点；不存在页面渲染依赖（纯函数级复现，见 `evidence/probe_canon.output.txt`）。
- 结论一句话：**占比分母与单位换算整体正确、未发现跨公司/跨期营收错配；但 commit `32ee861`「分部子项按自身披露期画轴」只把「轴标签」按分部粒度修对了，`barBasisInfo`/斜纹/`growthLine` 仍按公司 profit 行判断 → 暴露 1 处 P1 真错数（A 股半年分部增速跨期、误标环比）与多处 P2 标签矛盾。最高风险 P1，无 P0。**

---

## 一、分级统计

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 严重错数 | 0 | — |
| P1 真错数 / 高风险的误导 | 1 | F3 |
| P2 误导标签 | 6 | F1, F2, F4, F5, F6, F9(潜在) |
| P3 体验 / 数据新鲜度 | 3 | F7, F8, F10 |
| 既有（单列，非本次新发现） | 4 | ORCL / CSCO / KO / MSFT 日历季度标签（见附录 A） |

findings 的结构化版本见同目录 `findings.json`；代码原文（带行号）见 `evidence/app.code.md`；实测回放见 `evidence/probe_canon.output.txt`；复现步骤见 `repro.md`。

---

## 二、P1 真错数

### F3 · A 股半年分部柱的「环比」跨期错配（14 家）— severity P1
- **位置**：`app.js:1069-1089`（`growthLine`），**根因在 `app.js:1079` `const cumCur = profitRowIsCumulative(state.company, rows[i]);`** —— 它读的是被 `segPeriods` 浅拷贝来的 **profit 行 periodType**，而不是 `row.__segPT`（分部自身粒度）。A 股 profit 行 periodType 一律 `'q'` → `profitRowIsCumulative` 返回 `false` → 走 `qoq`（对「上一根柱」，即另一半期）。
- **分母/口径**：`growthLine` 用 `(v - pv0)/|pv0|*100`，`pv0 = item.data[i-1]`，即**上一根柱 = 另一个半年/全年累计值**。6 个月 vs 12 个月互比，百分比无经济含义，且被 legend/tooltip 标为「环比」「QoQ」。
- **受影响**（segments periodTypes=half 的 14 家 A 股，FYE 12）：000063.SZ、000100.SZ、000333.SZ、002415.SZ、002594.SZ、300750.SZ、603866.SH、600519.SS、600887.SS、601360.SS、688256.SS、688981.SS、688795.SS、688825.SS。
- **真实数据实例**（probe_canon，轴已正确 `H1'yy / FY yyyy`，增速全错）：
  - `600887.SS`「奶粉及奶制品」：2024-12-31 FY `+104.5`、2025-06-30 H1 `-44.1`、2025-12-31 FY `+97.7`、2026-06-30 H1 `-48.6`（均为对上一半期/全年的 qoq）。
  - `300750.SZ`「动力电池系统」：FY2024 `+124.6`、FY2025 `+140.6`；`002594.SZ`「其他」：`+257.6 / +168.1`；`000063.SZ`「运营商网络」：`+88.6 / +79.3`；`600519.SS`「其他」：`+32.4 / +74.4`。
- **改法**：`growthLine`（及 `barBasisInfo`/`decal`，见 F2）改为以 `rows[i].__segPT` 判定累计口径：`const segPT = rows[i].__segPT; const cumCur = segPT ? (segPT!=='quarter') : profitRowIsCumulative(state.company, rows[i]);` 对累计分部点用 `yoyBaseIndex`（同 MM-DD 去年）走 YoY，绝不对相邻柱做 qoq。**波及测试**：`tests/verify_bar_cum_growth.mjs`、`tests/verify_seg_axis.mjs`、`tests/verify_bar.mjs`、`tests/verify_cum_seg.mjs`。`findings.json#F3`。

---

## 三、P2 误导标签

### F1 · 年度分部 tooltip head 显示「Qn」与轴「FY」自相矛盾（Class B，23 家）— P2
- **位置**：`app.js:78-82` `quarterLabel` 只特判 `periodType==='interim'`，**不识别 `periodType==='annual'`**；`app.js:1134-1136` tooltip head 对非累计点直接调 `quarterLabel(qv.end, qv.periodType)`。年度分部的 profit 行 periodType=`'annual'` → 落到 `Q${floor((m-1)/3)+1}` 分支。
- **实例**（轴由 `segPeriodLabel` 按 `__segPT` 正确给出「FY yyyy」，head 却按日历月）：`SONY 2026-03-31` 轴「FY 2026」/head「Q1 2026」；`00151.HK 2025-03-31` 轴「FY 2025」/head「Q1 2025」；`09633.HK 2024-12-31` 轴「FY 2024」/head「Q4 2024」；`BIDU 2024-12-31` 轴「FY 2024」/head「Q4 2024」。数值与分母正确（见第七节），仅标签错。
- **受影响 23 家**：HUAWEI、BABA、JD、PDD、BIDU、ZH、WB、LI、DIDIY、LKNCY、CHA、TSM、ARM、SONY、ASML、STM、SPOT、TCOM、09633.HK、02097.HK、00151.HK、NESN.SW、MC.PA。
- **改法**：`quarterLabel` 增加 `if (periodType==='annual') return \`FY ${y}\`;`（且与 `__segPT==='annual'` 一致）；或 tooltip head 对分部点统一改用 `segPeriodLabel(state.company,qv)`。**波及测试**：`tests/verify_seg_axis.mjs`、`tests/verify_bar_basis_labels.mjs`。

### F2 · A 股半年分部：tooltip「Q2/Q4」+ 累计柱无斜纹 + 标题却称「累计口径」三重矛盾（Class A，14 家）— P2
- **位置**：`app.js:419-424` `barBasisInfo`（`cumulative=!annualRow&&profitRowIsCumulative(tk,qv)&&months>3`）与 `app.js:991` `bases=rows.map(qv=>barBasisInfo(state.company,qv))` 只看**公司 profit 行**、不读 `__segPT`；`app.js:1109-1111` 斜纹用 `bases[i].decal`；`app.js:1137` 在 head 后追加 `cum.label`。而 `app.js:1026` 标题又追加「分部为半年/FY累计口径」（`hasCumSeg` 来自 `cumFor`，为真）。
- **实例**：`600887.SS 2025-06-30`「奶粉及奶制品」轴「H1'25」，tooltip head 走 `quarterLabel('q')`=「Q2 2025」，随后又 append「 · 2025 上半年累计」→ 单条 tooltip「Q2 2025 · 2025 上半年累计」自相矛盾；`basis.cumulative=false` → 该半年累计柱**不加斜纹**，图例「斜纹柱=半年/9M 累计」失效。12-31 点同理（「Q4 2025 · FY2025 全年累计」，无斜纹）。
- **改法**：`barBasisInfo` 增加可选参 `segPT`，累计判定优先用 `__segPT!=='quarter'`；`renderBarChart` 传 `qv.__segPT`。**波及测试**：`tests/verify_bar_basis_labels.mjs`、`tests/verify_cum_seg.mjs`、`tests/verify_seg_axis.mjs`。（与 F3 同源，建议一并改。）

### F4 · 港股年度分部（Class C，11 家）增速「标环比、实为同比」— P2（数值对、标签错）
- **位置**：同 `app.js:1079`。profit 行 periodType=`'q4'`，`profitRowIsCumulative` 对 `'q4'` 返回 false → `growthLine` 走 `qoq`；但相邻柱是**上一财年 12-31**，差值 `/|pv0|` 实际就是同比幅值，却标「环比」。
- **实例**（probe_canon）：`00700.HK 2024-12-31`「其他」标 `qoq 43.8`（实为同比）；`03690.HK 2021` `qoq 45.3`；`01398.HK 2021` `qoq 14.3`。
- **受影响 11 家**：00700.HK、03690.HK、01398.HK、03968.HK、00981.HK、01024.HK、03888.HK、00941.HK、00762.HK、00728.HK、01810.HK。
- **改法**：与 F3 同一处修复即可（用 `__segPT==='annual'` → YoY 且标「同比」）。**波及测试**：`tests/verify_bar_cum_growth.mjs`。

### F5 · 三星/LG 12-31 分部值为「全年」却标成「Q4」单季 — P2（视觉+标签，非错数）
- **位置**：`app.js:887-893` `segPeriodType` 对 12-31 返回 `'quarter'`（segments.periodTypes 标 quarter），`app.js:903` `segPeriods` 用同日期 profit 行（periodType=`'annual'`）浅拷贝作 base、不校验跨度；`app.js:910-919` `segPeriodLabel` 按 `__segPT='quarter'` 出「Q4'yy」。
- **事实**：`005930.KS` seg「DS」：2025 Q1=17,022 / Q2=20,589 / Q3=23,581（USD $M），2025-12-31=90,084 ≈ 全年（≈四季合计），而 profit 2025-12-31 行 periodType=`'annual'`、revenue=333,605,938（KRW 百万）。占比（probe_canon）12-31 share=39%（以全年营收为分母）**与 Q3 单季 38.5% 一致 → 占比正确**；`growth=yoy`（对上年 12-31）亦正确。真正问题：把一个**全年值**画在季度轴上、标成「Q4'25」，绝对柱高约为邻季 4 倍（DS 90,084 vs 23,581 $M），读者会误读为「Q4 单季暴涨 4 倍」。`066570.KS`「VS」同模式（12.5%）。
- **改法**：`segPeriodType`/`segPeriods` 在 12-31 且对应 profit 行为 annual、或分部值≈四季合计时，判为 `'annual'` 并出「FY」轴；或数据侧把 segments.periodTypes 的 12-31 改为 `'annual'`。**波及测试**：`tests/verify_seg_axis.mjs`、`tests/verify_bar_basis_labels.mjs`；并交数据组复核 2026 各季 revenue 偏大 2–3 倍（P3 数据异常：2026-03-31 rev=133,873,444 / 2026-06-30 rev=171,499,470 KRW 百万，疑累积/口径问题）。

### F6 · 00151.HK 中期（interim）标签用日历年，财年错 — P2
- **位置**：`app.js:80` `if (periodType === 'interim') return \`H1 ${y}\`` —— 用 `end` 的**日历年** `y`；对 FYE=3 的公司，09-30 interim 属「Apr–Sep」= 下一财年上半年。
- **实例**：`00151.HK` FYE=3（annual 03-31），2025-09-30 interim（Apr–Sep 2025）→ `quarterLabel` 显示「H1 2025」，实为 **FY2026 上半年**（rev=11,107.8 百万 CNY）。bar 轴 `barPeriodLabel`（`app.js:402-413`）用 `periodCoveredMonths` 得「H1'25」（时长对、年份仍日历）；**桑基标题**（`app.js:710-711`）直接 `quarterLabel` →「H1 2025」财年错。
- **受影响**：00151.HK 全部 2018–2025 的 09-30 interim（19 行）。同族 FYE≠12 且含 interim 者亦受影响。
- **改法**：interim 标签用财年：`H1 FY{endMonth<(fye)? y+1 : y}`（以 03-31 FYE、09-30 为例应显示 FY2026 H1）。**波及测试**：`tests/verify_new.mjs`、`tests/verify_bar_basis_labels.mjs`。

### F9 · 潜在：`cumulativeView` 的 `fiscalYearEndMonth!==12` 门会退化为单季分母（unconfirmed）— P2（潜在）
- **位置**：`app.js:453` `if (fiscalYearEndMonth(tk) !== 12) return null;`。
- **风险**：若出现「半年/annual 分部 + 单季 profit 行 + FYE≠12」组合，`cumulativeView` 返回 `null` → `pctLine`（`app.js:1037-1055`）分母回退 `rawMetrics(qv).revenue` = 单季营收，而分部值为累计 → 占比虚高（可 >100%）。**当前 92 家数据无此组合**（非 12 月 FYE 的 annual 分部公司 BABA/ARM/SONY/00151 其 profit 行本身是 annual，分母仍正确）→ status=unconfirmed / 潜在，建议保留监控与单测。
- **改法**：对该组合增加「用分部自身粒度做 YTD 切片」的兜底，或至少 UI 明确标注分母为单季。

---

## 四、P3 体验 / 数据新鲜度

### F7 · 00992.HK 分部在 bar 视图不可见（`quarters` 为空、bar 不支持 annualQuarters）— P3
- **位置**：`app.js:894-908` `segPeriods` 首行 `if(!s||!s.quarters) return [];`；`00992.HK`（Lenovo，USD-M，FYE=3）`segments.quarters` 为空对象、数据存于 `annualQuarters`（2023/2024/2025-03-31）。→ bar 分部子项 0 点、`buildBarItems` 判 hasData=false → 下拉被禁用/缺失。
- **对照**：桑基走 `fiscalCumulativeView`（`app.js:485-516`，annualQuarters 路径）能正常画分部 → 同一公司「桑基能看、bar 看不了」不一致。
- **改法**：`segPeriods`/`segValueFor` 回退读取 `s.annualQuarters`（类似 `segmentsFor` 已有分支），并让 bar 支持 annualQuarters 轴。**波及测试**：`tests/verify_seg_axis.mjs`、`tests/verify_bar.mjs`。

### F8 · A 股半年桑基标题「Q2 2026 · 2026 上半年累计」日历季误导 — P3
- **位置**：`app.js:710-711` 标题 `quarterLabel(qv.end, qv.periodType)`；`renderChart` 用 `qv={...qvRaw,...cum.values}` 覆盖了数值但**未覆盖 periodType**（`cum.values` 无 periodType），故 `periodType` 仍是 profit 行 `'q'` → Q 标签，再 append `cum.label`。
- **实例**：`600519.SS 2026-06-30`（半年累计）桑基标题「Q2 2026 · 2026 上半年累计」。
- **改法**：`cum` 存在时标题改用 `cum.label`（或 `H1/FY` 语义），不要叠 `quarterLabel('q')`。**波及测试**：`tests/verify_cum_seg.mjs`。

### F10 · segments 数据陈旧（14 家公司分部落后 profit >400 天）— P3（数据）
- **位置/事实**：`data/segments.json`；BABA 分部末 2022-03-31（落后 1552 天）；01398/03968/00941/00762/00728 末 2024-12-31（638 天）；00700/03690/09633/02097/00981/01024/03888/01810 末 2024-12-31（546 天）。分部柱/桑基只能画到旧期。
- **性质**：数据新鲜度问题，**非口径 bug**；交数据组补齐。**波及测试**：`tests/verify_new.mjs`（数据结构）/数据扫描器。

---

## 五、附录 A · 既有日历季度标签问题（单列，非本次新发现，不重复展开）

以下 4 例为**已知**的「用期末日期所在日历季度当财季标题」，本次仅确认数据、不重复发明（属 `quarterLabel` 的日历季逻辑，与 F1 同源但针对非 annual 的常规季度行）：

| 公司 | 期末 | 现标题（日历季） | 真实财季 | 依据 |
|---|---|---|---|---|
| ORCL | 2026-08-31 | Q3 2026 | FY27 Q1（FYE=5 月） | quarters 2025-05-31…2026-08-31，periodType 全空 |
| CSCO | 2026-07-25 | Q3 2026 | FY26 Q4（FYE≈7 月底） | quarters 末尾 2026-07-25 |
| KO | 2026-10-02 | Q4 2026 | FY26 Q3（FYE=12，Q3 窗口 Jul–Sep 实为财季口径） | 2026-10-02 periodType=q |
| MSFT | 2026-09-30 | Q3 2026 | FY27 Q1（FYE=6-30） | 2026-09-30 periodType=q |

（均 `frequency=undefined`/非 annual，`isAnnual()` 不成立，走 `Q${...}` 分支。）

---

## 六、复核结论：commit 32ee861「分部按自身披露轴」是否引入新口径问题

**修对的部分**：
1. **轴标签**：`segPeriodLabel`（`app.js:910-919`）按 `qv.__segPT` 出轴，annual→"FY yyyy"、half→按 `periodCoveredMonths`→"H1/9M/FY"，**正确**；避免了「用期末月当日历季」的老 bug。
2. **占比分母（任务第 3 条）**：对全部 92 家，bar 分部占比分母均为「同期同口径营收」，**无 A 公司期错配到 B 公司营收**（dup-end=0、orphan-end=0；`segPeriods` 的 byEnd 用**同一 ticker** 的 profit 行）。逐类见第七节。
3. **未新增 fx/单位错配**：segments 恒为 USD $M，`segFactor`/`dispFactor` 换算一致（probe5：多公司 `segSum*segFactor/MB ÷ revenue*dispFactor/MB ≈ 1.000`）。

**未改到、仍错的部分（本次新发现）**：
- `barBasisInfo`/斜纹 decal（`app.js:419-424`、`991`）仍只看公司 profit 行 → F2（A 股半年累计柱无斜纹、head 矛盾）。
- `growthLine`（`app.js:1079`）仍只看 profit 行 → F3（A 股跨期错配，P1）与 F4（港股标错环比）。
- `segPeriodType`/`segPeriods` 在 12-31 未校验 profit 行跨度 → F5（三星/LG 全年值标 Q4）。
- bar 不支持 `annualQuarters` → F7（Lenovo 分部不可见）。
结论一句话：**32ee861 只补了「轴」，没把「basis/斜纹/增速」三条同样依赖粒度的链路一起改，导致轴与内容不自洽；这是本次 P1/P2 的直接来源。**

---

## 七、占比分母逐类核对（任务 1 & 3 的核心表）

| 类别 | 覆盖 | bar 分部占比分母来自 | 口径 | 结论 |
|---|---|---|---|---|
| Class A 半年分部（14 家 A 股，FYE12） | 000063/000100/000333/002415/002594/300750/603866/600519/600887/601360/688256/688981/688795/688825 | `cumulativeView`（`pt` 取自 **segments 'half'**，`app.js:450`）→ `ytdSum` 半/全年营收 | 同期同口径 | ✅ 数值正确（F3 只错增速） |
| Class B 年度分部·profit 行=annual（23 家） | HUAWEI,BABA,JD,PDD,BIDU,ZH,WB,LI,DIDIY,LKNCY,CHA,TSM,ARM,SONY,ASML,STM,SPOT,TCOM,09633,02097,00151,NESN,MC | `rawMetrics(qv).revenue`（annual 行=全年营收） | 同期同口径 | ✅ |
| Class C 年度分部·profit 行=q4（11 家 HK） | 00700,03690,01398,03968,00981,01024,03888,00941,00762,00728,01810 | `cumulativeView`（`pt`=segments 'annual'∈CUM_SEG_TYPES）→ FY ytd 营收 | 同期同口径 | ✅（F4 只错增速标签） |
| 非 12 月 FYE 的 annual 分部（4 家） | BABA(FYE3)/ARM(3)/SONY(3)/00151(3) | `rawMetrics` 全年营收（`cumulativeView` 因 fye≠12 返 null） | 同期同口径 | ✅ |
| 三星/LG 12-31 | 005930.KS / 066570.KS | `rawMetrics(annual 行)` 全年营收 | 分子=全年分部、分母=全年营收 | ✅ 占比正确（F5 只错轴标签/视觉） |

**唯一隐患**：F9 的「半年/annual 分部 + 单季 profit 行 + FYE≠12」组合当前不存在，`cumulativeView` 会因 `fye≠12` 返 null → 分母退化单季 → 占比虚高；status=unconfirmed。

---

## 八、单位 / fx / 累计口径站点清单（任务 1）

| 站点 | path:line | 分母/口径 | 可能错配场景 | 现状 |
|---|---|---|---|---|
| `MB=1e3`（百万→十亿） | app.js:128 | 显示因子 | — | ✅ 统一 |
| `dispFactor` / `segFactor` / `dispSym` | app.js:144-150,151 | 非 CNY 自动折 USD（`dispInUsd`） | 外币标本币 | ✅ 已修（metaLine `app.js:1443-1446` 显示币种码 + `≈US$`） |
| `rawMetrics` revenue/各利润项 | app.js:164-187 | `×dispFactor` 同显示币 | 分子本币×因子、分母未× | ✅ 两者同因子 |
| 桑基 margin（pct 模式） | app.js:730-744 | 分子=rawMetrics（显示币）、分母=`rm.revenue`（显示币） | 分子分母不同币（历史 BUG-B） | ✅ 已修（注释明确） |
| 桑基 分部/普通 share | app.js:741-743, 776 | `p.value/revB`，`revB=qv.revenue*dispFactor/MB` | cum 期用单季 revenue | ✅ `renderChart` 用 cum.values 覆盖 qv，同口径 |
| `buildBarItems` 利润项 | app.js:937 | `rawMetrics[id]/MB`（$B） | — | ✅ |
| `buildBarItems` 分部项 | app.js:951 | `segValueFor*segFactor/MB`（$B） | fx 混杂 | ✅ |
| `buildBarItems` 利润率 | app.js:955 | `m[mk]/m.revenue*100` | 分子分母不同币 | ✅ 同 rawMetrics |
| `pctLine`（bar 占比） | app.js:1037-1055 | 见第七节 | cum 期退化单季（F9） | ⚠️ 除 F9 外正确 |
| `growthLine`（bar 环比/同比） | app.js:1069-1089 | `(v-pv0)/|pv0|` | 累计分部跨期（F3/F4） | ❌ 见 F3/F4 |
| `qoqText`/`qoqSegment`/`qoqMarginPP` | app.js:190-230 | 桑基节点 qoq；累计期→「累计期不可比」 | — | ✅ 诚实（annual 行对不上 class → '—'） |
| `profitRowIsCumulative` / `cumulativeView` / `fiscalCumulativeView` / `barBasisInfo` | app.js:339-345 / 443-467 / 485-516 / 419-424 | 累计判定 | 只看 profit 行、忽略 `__segPT`（F2/F3/F4）；fye≠12 退化（F9） | ⚠️ |
| 进度条 `n>1?cur/(n-1)*100` | app.js:1379-1392 | UI，非数据 | — | ✅ 无关 |

---

## 九、改法汇总（按优先级）与波及测试

1. **F3（P1）先修**：`growthLine` 用 `rows[i].__segPT` 判累计 → 累计分部点走 YoY、禁止对相邻柱 qoq。测试：`verify_bar_cum_growth.mjs`、`verify_cum_seg.mjs`、`verify_bar.mjs`。
2. **F2 + F4**：`barBasisInfo` 接受 `segPT`（`renderBarChart` 传 `qv.__segPT`），使斜纹/head 与轴一致；与 F3 同源，建议一并提交。测试：`verify_bar_basis_labels.mjs`、`verify_seg_axis.mjs`。
3. **F1**：`quarterLabel` 增 `periodType==='annual' → 'FY '+y`；或分部 tooltip head 改用 `segPeriodLabel`。测试：`verify_seg_axis.mjs`。
4. **F5**：`segPeriodType`/`segPeriods` 对「12-31 且 profit 行为 annual」判 `annual`（或数据侧正名）。测试：`verify_seg_axis.mjs`。
5. **F6**：interim 标签用财年。测试：`verify_new.mjs`。
6. **F7**：`segPeriods` 回退 `annualQuarters`。测试：`verify_seg_axis.mjs`、`verify_bar.mjs`。
7. **F8**：`cum` 期标题用 `cum.label`。测试：`verify_cum_seg.mjs`。
8. **F9**：为「分部累计 + 单季 profit 行 + FYE≠12」加兜底/单测（当前无数据，防回归）。
9. **F10**：数据组补 segments 陈旧数据。
10. **附录 A** 4 例：`quarterLabel` 是否引入「财年季度」需产品决策（会牵动 F1），不宜与本次 F1 混改；建议单独立项。

> 说明：本报告「只读」审计，未改动仓库任何代码/git；所有结论均由 `evidence/probe_canon.output.txt` 的真实数据回放与 `app.js` 原文（`evidence/app.code.md`）支撑。
