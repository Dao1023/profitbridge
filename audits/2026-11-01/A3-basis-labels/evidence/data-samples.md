# 证据 · 实测数据样本（probe_canon.js 回放，数据源 data/profit.json + data/segments.json）

> 完整回放见 `evidence/probe_canon.output.txt`。下表摘取各问题类别的代表公司（axis=bar 轴标签，head=tooltip 头部，basis.cum/decal=斜纹依据，share=分部占营收，denom=占比分母口径，grow=增速及口径）。数据单位：利润=本币百万，分部=USD $M。

## Class A · A 股半年分部（14 家，P1 增速跨期 + P2 标签）
`600887.SS`（伊利）seg=奶粉及奶制品，FYE=12：
```
2024-12-31 segPT=half rowPT=q | axis="FY 2024" head="Q4 2024" | basis.cum=false decal=false | share=25.6% denom=CUM | grow=qoq 104.5
2025-06-30 segPT=half rowPT=q | axis="H1'25"  head="Q2 2025" | basis.cum=false decal=false | share=26.8% denom=CUM | grow=qoq -44.1
2025-12-31 segPT=half rowPT=q | axis="FY 2025" head="Q4 2025" | basis.cum=false decal=false | share=28.3% denom=CUM | grow=qoq 97.7
2026-06-30 segPT=half rowPT=q | axis="H1'26"  head="Q2 2026" | basis.cum=false decal=false | share=26.1% denom=CUM | grow=qoq -48.6
```
`300750.SZ`（宁德时代）seg=动力电池系统：FY2024 +124.6 / H1'25 -48 / FY2025 +140.6 / H1'26 -39.3（share 69.9/73.6/74.7/69.4%）。
`002594.SZ`（比亚迪）seg=其他：+257.6 / -72.4 / +168.1 / -16.2。
`600519.SS`（茅台）seg=其他：+32.4 / -87.3 / +74.4 / -29.7（该分部占比≈0%）。
> 观察：轴（H1/FY）正确、占比分母（CUM）正确；唯独 grow 用 qoq 对相邻柱（另一半期/全年）→ 跨期错配。basis.cum=false → 无斜纹。

## Class B · 年度分部且 profit 行=annual（23 家，P2 head 标签）
`BIDU` seg=Baidu Core-Online marketing services，FYE=12：
```
2021-12-31 segPT=annual rowPT=annual | axis="FY 2021" head="Q4 2021" | cum=false | share=59.4% denom=single | grow=yoy 11.5
2024-12-31 segPT=annual rowPT=annual | axis="FY 2024" head="Q4 2024" | cum=false | share=54.8% denom=single | grow=yoy -2.8
```
`SONY` seg=Pictures，FYE=3：
```
2026-03-31 segPT=annual rowPT=annual | axis="FY 2026" head="Q1 2026" | cum=false | share=12% denom=single | grow=yoy -6.7
```
`09633.HK`（农夫山泉）seg=水类产品：2024-12-31 axis="FY 2024" head="Q4 2024" share=37.2% grow=yoy -21.3。
> 观察：轴 FY、分母=全年、grow=yoy 均正确；仅 head 用日历季（Q4/Q1）。数值无误。

## Class C · 年度分部且 profit 行=q4（11 家 HK，P2 增速标 qoq 实为同比）
`00700.HK`（腾讯）seg=其他：
```
2024-12-31 segPT=annual rowPT=q4 | axis="FY 2024" head="Q4 2024" | cum=true | share=1.2% denom=CUM | grow=qoq 43.8
```
`03690.HK`（美团）seg=餐饮外卖：2021-12-31 grow=qoq 45.3；`01398.HK`（工行）2021 qoq 14.3。
> 观察：分母=CUM（FY ytd）正确；grow 的数值是同比幅值，但 basis 标 qoq → 标签「环比」错。

## 三星 / LG · 12-31 全年值标 Q4（P2 视觉+标签，占比正确）
`005930.KS`（三星）seg=DS：
```
2025-09-30 segPT=quarter rowPT=q3     | axis="Q3'25" head="Q3 2025" | share=38.5% denom=single | grow=qoq 14.5
2025-12-31 segPT=quarter rowPT=annual | axis="Q4'25" head="Q4 2025" | share=39.0% denom=single | grow=yoy 19.6
2026-03-31 segPT=quarter rowPT=q1     | axis="Q1'26" head="Q1 2026" | share=61.0% denom=single | grow=null
2026-06-30 segPT=quarter rowPT=q2     | axis="Q2'26" head="Q2 2026" | share=74.3% denom=single | grow=qoq 53.4
```
原始量级：2025 Q1/Q2/Q3 = 17,022 / 20,589 / 23,581（$M），2025-12-31 = 90,084（$M，≈全年 4 季合计）；profit 2025-12-31 行 periodType=annual，revenue=333,605,938（KRW 百万）。
`066570.KS`（LG）seg=VS：12-31 share=12.5%（与季度 ~12.x% 一致）。
> 观察：12-31 点是全年值（绝对柱约 4 倍高）却出「Q4'25」轴；share 因分母也是全年营收而仍正确。2026 各季 revenue 异常偏大（133,873,444 / 171,499,470 KRW 百万）疑数据侧。

## Lenovo · 分部 bar 缺失（P3）
`00992.HK`（FYE=3，USD-M）：`segments.quarters={}` 空、数据在 `annualQuarters`（2023/2024/2025-03-31）。
probe_canon：`seg="null" pts=0`（bar 分部项 0 点）；桑基 `fiscalCumulativeView` 走 annualQuarters 能正常画。

## 00151.HK · interim 财年标签（P2）
`00151.HK`（旺旺，FYE=3）profit 行：`2025-09-30:interim`、`2026-03-31:annual`；2025-09-30 interim revenue=11,107.792（CNY 百万）。
`quarterLabel('interim')` → 「H1 2025」，但该期 Apr–Sep 2025 = FY2026 上半年（财年错）。桑基 title 直接显示「H1 2025」。

## 分母口径总验证（任务 3）
对全部 92 家，bar 分部占比分母均=同期同口径营收（详见 REPORT 第七节）；dup-end=0、orphan-end=0，`segPeriods` 的 `byEnd` 只取**同一 ticker** 的 profit 行 → 不存在「A 公司期错配到 B 公司营收」。`segFactor` 单位一致（segments 确为 USD $M）。
