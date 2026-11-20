> 来源：profitbridge-anom/tmp-fix-anomaly/REPORT.md（2026-11-20 归档）

# 两条口径异常调查报告与修复方案（v2·已按父指令更新）

工作树：`C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge-anom`（分支 `fix/anomaly-03968-600887`，基于 main c8b0349）。
产出均在 `tmp-fix-anomaly/`（未跟踪）。**未提交任何 commit、未 push。** 600887 的修复已落 worktree `data/` 用于看 diff（未提交）。

> 相对 v1 的变化：父指令（m00212）否决了 03968 的「方案 B（豁免）」；改为**补 2012 Q1/Q2 真实单季，使 2012 成完整四季**。本版按此重做并做了两阶段管线沙箱验证 + headless 实测截图。

---

## 1) 两条异常现状表

### 异常 1：03968.HK（招商银行）2012-12-31 单位比值 2.01

profit 序列 `hk-mixed` 自 **2012-09-30 起才有数据**，2012 年只有 q3、q4 两个单季（缺 Q1/Q2，因 H1 累计无 Q1 可差分）；segments 只有 12-31 各年（periodType=annual）。

| end | periodType | revenue(百万) | fxToUsd | segSum(USD-M) | 硬门 ratio | 判定 |
|---|---|---|---|---|---|---|
| 2012-09-30 | q3 | 28,235 | 0.15912 | —（无该期分部） | — | — |
| 2012-12-31 | q4 | 28,285 | 0.1605 | 18,257.518 | **2.01263**（分母取 q3+q4=56,520 → 仅半年） | **FAIL** |
| 2013-12-31 | q4 | 133,030 | 0.16518 | — | 1.00000 | PASS |
| …2014–2025 | q4 | 见注 | 见注 | — | 1.00000 | PASS ×13 |

- 全 14 期中**仅 2012-12-31 一期 FAIL**，其余 13 期 ratio 均 1.00000。
- 根因：`verify_units_guard` 对 annual 分部期用「最后 4 个单季之和」重建全年营收；2012 只有 q3+q4 → 重建基数 = 仅下半年 = 全年一半 → 比值翻倍。

### 异常 2：600887.SS（伊利股份）12-31 期型误标 'half'

profit 为真实单季（periodType 全 'q'）；segments 33 期（2010-06-30 … 2026-06-30），`periodTypes` **全部 'half'**，顶层 `periodType='half'`。单位 USD-M。

| end | periodType | 分母(profit 累计) | segSum(USD-M) | ratio | 含义 |
|---|---|---|---|---|---|
| 2012-06-30 | half | H1=21,180.98(百万) | 3,333.0 | 1.00003 | 半年累计 ✓ |
| 2012-12-31 | **half(误标)** | FY=41,990.7(百万) | 6,698.5 | 0.99393 | **实为全年累计** |
| 2026-06-30 | half | H1 | 9,480.6 | ~1.00 | 半年累计 ✓ |

- 结论：06-30 = 半年累计、12-31 = 全年累计；两者都被标 `half`，12-31 全年值被按「半年」渲染。修法：16 个 12-31 的 `periodTypes` half→annual（06-30 keep half）。

---

## 2) 回源证据（URL + 原文数值 + 抓取时间）

**03968.HK 2012 全年营业收入 = 113,754,000,000 CNY（国际会计准则 / HKEX 口径）** — 与 profit 序列、staging batch3 的 annual revenueLocal 完全一致。
- 抓取时间 **2026-11-02T01:27:08Z（09:27 +08）**
- API：`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_FN_INCOME&columns=ALL&filter=(SECUCODE%3D%2203968.HK%22)&pageNumber=1&pageSize=3000&source=HSF10&client=PC`
- 页面：`https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/Index?type=web&code=03968.HK`
- 命中：经营收入总额（STD_ITEM_CODE 001003999）= **113,754,000,000**；股东应占溢利 45,268,000,000；净利息收入 88,374,000,000；除税后溢利 45,272,000,000。

**H1 2012（中报）= 57,234,000,000 CNY（IFRS）**（batch3 2012-06-30 interim revenueLocal 亦为 57,234,000,000）
- 抓取时间 **2026-11-02T01:34:09Z**；同一 `RPT_HKF10_FN_INCOME` API，2012-06-30 行 001003999=57,234,000,000。
- 注：港股 F10 **无 2012-03-31 单季**（仅中报/年报），故 Q1 取 A股：

**Q1 2012（A股 600036.SH 一季报，CAS 口径）= 28,385,000,000 CNY**；归母净利 11,643,000,000；NOTICE_DATE 2012-04-28
- 抓取时间 **2026-11-02T01:34:09Z**
- API：`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_GINCOME&columns=ALL&filter=(SECUCODE%3D%22600036.SH%22)(REPORT_DATE%3D%272012-03-31%27)&pageNumber=1&pageSize=200&source=HSF10&client=PC`
- 命中：TOTAL_OPERATE_INCOME = OPERATE_INCOME = **28,385,000,000**；PARENT_NETPROFIT 11,643,000,000；NETPROFIT 11,642,000,000。

**口径说明**：港股 IFRS 全年 113,754M vs A股 CAS 全年 113,367M，差 387M 属列报差异（其他经营收入 5,641M vs 其他业务收入 414M）。取 **Q1(CAS)=28,385 + H1(IFRS)=57,234 → Q2=28,849**；四季合计 = 28,385+28,849+28,235+28,285 = **113,754M = IFRS 全年**，内部自洽。（若坚持全 CAS：Q1 28,385 + Q2=H1CAS 57,119−28,385=28,734 + q3 28,235 + q4 28,285 = 113,639 ≈ CAS 113,367，亦在允许带内，但会与现有 IFRS q3/q4 混口径，故不采用。）

---

## 3) 03968 修复：补 2012 Q1/Q2 单季（推荐=写入 batch3 原始 Q1 行，由 diffHK 派生 Q2）

> 已否决 v1 的「方案 B（豁免）」——按父指令补真实单季，使 2012 成完整四季，从根上消除翻倍。

**做法（staging 文件：`tmp-fix-anomaly/staging_03968_2012H1.json`）**：往 `data/staging/batch3.json` 的 `results[ticker=="03968.HK"].profit` **追加一条原始 Q1 行**：
```
{ "periodEnd":"2012-03-31", "label":"2012年一季报", "periodType":"q1", "cumulative":true,
  "revenueLocal":28385000000, "netProfitLocal":11643000000,
  "revenueUsdM":4508.3, "netProfitUsdM":1849.3, "fxLocalToUsd":0.15883 }
```
fx 0.15883 取同币种(CNY)、同日(2012-03-31)的 USD/CNY（600887.SS 2012-03-31 fxToUsd=0.158831 可直接引用）；只影响单季 USD 展示，不影响年度比值（年度比值按 q4 的 fx 0.1605 计）。

**diffHK 安全性确认（关键，含文件:行号）**：
- 新增行 periodType=`q1`、是**单季值**，被 `scripts/merge_batches.mjs` 的 `diffHK`（:250-312）按 q1 分支 `pushQ(q1, revenueLocal)` 直接转单季，**不会被再次差分**；
- `q2 = interim(H1 57,234) − q1(28,385) = 28,849`（interim 分支 `q2 = interim − q1`，findPrev 取 60–130 天内的 q1）；
- q3=9M−H1、q4=FY−9M 与既有单季完全一致，**不变**；
- annual 2012-12-31 原始行在 `scripts/merge_batches.mjs:309` `const noAnn = out.filter(q => q.periodType !== 'annual')` 被**显式丢弃** → **不与派生 Q4 双计、不与 annual 行冲突**。

**真实两阶段管线沙箱验证（`tmp-fix-anomaly/sb03968_batch3/`，脚本 `run_03968_sandbox.sh`）**：
- `node scripts/merge_batches.mjs --force` → exit 0；`node scripts/merge_fundamentals.mjs` → exit 0；`profit.json.js` 镜像 deepEqual = **true**。
- **2012 四季合计**：revenue = 113,754M、netInc = 45,268M ✓。
- **硬门**：`2012-12-31 rev=113,754 fx=0.1605 segSum=18,257.518 ratio=1.00000 PASS`；全 14 期 fails=0。
- **其他公司/期零差异**：`cmp_profit.mjs` 输出 **TOTAL DIFF ITEMS=5**，分布 `{03968.HK:3, 00762.HK:1, 601360.SS:1}`：
  - 03968：新增 `2012-03-31|q1`、`2012-06-30|q2` 两行 + notes 的 cut `from 2012-09-30`→`from 2012-03-31`；
  - 00762.HK / 601360.SS：**仅 notes 一项**（`quarters` 完全相同，value/row 差异=0）——这是「人工批注未回写 staging、merge_batches 用模板重写 notes」的**既存现象**，与本次改动无关（见 `scripts/PIPELINE.md`）。
  - **其余 89 家公司 0 行差异、0 值差异。**
- **headless 实测「占营收%」**（`shoot_03968.mjs`，CDP 读真实 echarts option）：
  - 修复前（原始磁盘）：2012 只有 q3/q4，2012-12-31 各分部占营收% = 批发 120.60 / 零售 84.02 / 金融 −3.73 / 其他 0.38 → **合计 201.27%**（复现异常）。
  - 修复后（batch3 结果）：批发 59.92 / 零售 41.75 / 金融 −1.85 / 其他 0.19 → **合计 100.01%** ✓。截图：`tmp-fix-anomaly/shots/03968_after_seg_pct.png`（before：`03968_before_seg_pct.png`）。

**副作用 / 注意事项**：
- 改动利润历史：新增 2 个真实单季（Q1/Q2），2012 从「半年起点」变为「完整四季」，增速连续性反而更完整；无删除、无改既有行。
- **首跑需一次性 `--force` 或 truncations 豁免**：新增 2012-03-31 早于磁盘最早 2012-09-30，触发 `merge_batches.mjs:768-773` 的 earlier-period regression guard。
- 在已 enrich 的磁盘上单跑 stage1 会报 ~2190 预期 regression（stage1 剥掉 stage2 的 gross/opInc），须 `--force` 后立即 stage2；正常全量管线勿随意 `--force`（见 `scripts/PIPELINE.md`）。
- 重跑会用模板重写所有 staging 覆盖 ticker 的 notes，会抹掉 00762/601360 的人工批注——建议把批注回写 staging 或 merge 后补回（本次未改这些批注）。

**备选（数据等价）**：也可往 `data/staging/batch7.json` 的 `03968.newQuarters` 直接追加最终单季 `q1{2012-03-31,28385,11643,q1,0.15883}`、`q2{2012-06-30,28849,11731,q2,0.15735}` 绕过 diffHK；diff=4 项、数据相同，但 notes 的 cut 仍停在 2012-09-30（较陈旧）。**推荐 batch3-raw**：架构正确、由 diffHK 派生 Q2 是其设计行为、notes 自动更正。

---

## 4) 600887 前端影响面 + 需同步修改的测试断言清单

**已落盘修复**：写 `scripts/fix_segments_2026-11-02.mjs`（仿 `scripts/fix_segments_2026-11-01.mjs` 先例，helpers J/W/norm/deepEqual）：把 600887.SS 全部 12-31 的 `periodTypes` half→annual（06-30 保持 half），不改任何数值/quarters 结构/顶层 `periodType`。实跑**幂等**：ends=33、dec31=16 changed→annual、jun30=17；二次运行 changed=0。`data/segments.json.js` 镜像 deepEqual=true。`git diff --stat`：`data/segments.json` 32 行（16 对 half→annual）、`data/segments.json.js` 1 insert/1 delete（单行镜像）、新增未跟踪脚本 `scripts/fix_segments_2026-11-02.mjs`。

**前端代码影响（逐行核对 app.js），half→annual 后**：
- `segGranularityLabel`（app.js:960-967）：pts 由 `{half}`→`{half,annual}`，图表标题由「**仅半年披露**」变「**年度+半年披露**」（order 中 annual 在 half 前）。**这是唯一可观察变化。**
- `segPeriodLabel`（app.js:948-958）：12-31 无论 half(cm=12→`FY`) 还是 annual(→`FY`)，轴标签都 `FY`，**不变**。
- `periodIsCumulative`（app.js:365-369）：half 与 annual 都 `!=='quarter'` → 都算累计；增速判据 `growth`(:1136-1145) 与 legend **不变**。
- `barBasisInfo`（app.js:444-449）：`annualRow` 用 `qv.periodType`（600887 底表是 'q'，恒 false）；斜纹 decal 仍只在 06-30(months=6)，**不变**。
- `cumulativeView`（app.js:468-489，CUM_SEG_TYPES 含 half/annual，:483 `isFY=…||month===12`）：12-31 仍「FY…全年累计」，**不变**。
- **净：仅图表标题 granularity 文案变化；轴标签/斜纹/增速/累计视图全部不变。**

**需要同步修改的测试断言清单（限 tests/*.mjs，逐文件核对）**：现有断言**无一处**硬编码 600887 12-31 的分部期型或 granularity 文案，因此**没有必须修改的旧断言**（旧断言 → 新断言：无）。
- `tests/verify_bar_basis_labels.mjs`：用例仅 09633.HK/00700.HK/00151.HK/00941.HK，无 600887；expectedLabel 模型由 profit.json 推导 → 不受影响。
- `tests/verify_seg_axis.mjs`：TWENTY_EIGHT 年度-only 清单 + BIDU/MSFT，无 600887 → 不受影响。
- `tests/verify_bar.mjs`：无 half/annual/600887（仅 :115 该子项无披露数据）→ 不受影响。
- `tests/verify_cum_seg.mjs:150-154`：600887 只测 2026-06-30（06-30 keep half，H1 revenue 与 title `/上半年累计/` 均不变）→ 不受影响。
- `tests/verify_pct_fix.mjs:108`（revenue 占营收抑制）/`:137-143`（2026-06-30 分部）→ 不涉 12-31 期型 → 不受影响。
- `tests/verify_export.mjs:45-76`、`tests/verify_header_layout.mjs:80/94`：动态取标题/仅渲染截图、无文本断言 → 不受影响。
- （可选）若要为新行为加回归：新增断言「`600887.SS` 12-31 期 `segGranularityLabel === '年度+半年披露'`，06-30 期仍 `H1`」。目前无此断言。

**全部 20 个测试（BASE=worktree 服务 8470）零回归**：verify_bar 34/34、bar_basis_labels 26/26、bar_cum_growth 31/31、bar_lines 15/15、cum_seg 27/27、currency 6/6、export 11/11、filter_jitter 19/19、header_layout 183/183、layout_refactor 23/23、modes 31/31、new ALL PASS、pct_fix 32/32、scan（--run：83 filings，0 errors，全部 ok）、seg_annual_quarters 16/16、seg_axis 11/11、state_memory 11/11、timeline2 21/21、timeline_click 15/15、units_guard ALL PASS。（`verify_scan.mjs` 需输入：直接 `node` 无参时因 stdin 为空报「输入无法解析为 JSON」属调用方式问题，用 `--run` 即全部通过。）

---

## 5) 产出文件路径（均在 `tmp-fix-anomaly/`，未提交）

**03968**
- `staging_03968_2012H1.json` — 补 2012 Q1 单季的 staging patch + diffHK 安全说明 + 回源证据 + 期望结果。
- `sb03968_batch3/` — 两阶段沙箱验证结果（`data/profit.json` 与 `.js` 均含 2012 四季，deepEqual=true）。
- `sb03968_batch7/` — 备选 append 变体结果。
- `run_03968_sandbox.sh`、`cmp_profit.mjs`、`guard_03968.mjs`、`repro_sandbox.sh`、`analyze.mjs`。
- `shoot_03968.mjs`、`shots/03968_after_seg_pct.png`、`shots/03968_before_seg_pct.png`。

**600887**
- `scripts/fix_segments_2026-11-02.mjs` — 已落 worktree scripts/（half→annual + 重生成镜像 + deepEqual 断言）。
- `staging_600887.json` — 16 个 12-31→annual、17 个 06-30 keep half 的 staging 描述（含直改 segments.json 说明）。
- `gen_staging_600887.mjs` — 只读 data/ 生成上述 staging 的脚本。
- worktree `data/segments.json`（M，32 行）、`data/segments.json.js`（M，镜像 1 行）——用于看 diff，**未提交**。

**测试**：`tests_out/summary.txt` 与各 `verify_*.log`（全部通过）。

**报告**：`REPORT.md`（本文件）。

> 遗留/需父决策：① 00762.HK、601360.SS 的 notes-only 漂移源于「人工批注未回写 staging」，若正式落地会丢失这些批注，需先把批注合入 staging 或 merge 后补回；② 03968 上线需一次性 `--force`（earlier-period）或 truncations 显式豁免。
