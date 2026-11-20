> 来源：profitbridge-nesn/tmp-nesn/REPORT.md（2026-11-20 归档）

# NESN.SW 年度营收口径修复报告

- 分支：`fix/nesn-revenue`（worktree `C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-nesn`）
- 基线：`e496eab`（最新 main，`Merge branch 'chore/degraded-form'`）
- 修复提交：`3624375`（数据 + fixup + 定向应用模式）
- 文档提交：`19aea97`（仅改 `docs/KNOWN_CAVEATS.md` 的 NESN 行）
- 未 push、未 rebase。

---

## 一、结论

`data/profit.json` 的 NESN.SW **5 个 12-31 年度行**把利润表里 Gross profit 之下的 `Other revenue` 并进了 top line；雀巢年报的 `Sales` 不含该行，因此旧 revenue 每年高 0.377%–0.441%（CHF 353.3–394.8m）。6 个 H1 行（2021–2026）经逐期核对，revenue 与官方 `Sales` **完全相等（0 差）**，本来就不含 `Other revenue`，不需要改。

修复只动 5 个年度行的 `revenue` / `gross`：revenue 改为官方 `Sales`，gross 同额下调，`revenue − gross = COGS` 保持不变；COGS、opInc、netInc、rd、sga、periodType、fxToUsd 全部未动。修复后 NESN 年度分部 ratio = **1.00000006 / 0.99999995 / 1.00000004**，均在 ±0.0005 内。

其余 **91 家公司逐字节不变**，`data/segments.json` / `segments.json.js` / `data/companies.json` 相对基线 **零改动**。

---

## 二、逐期自查（11 期，含 H1）

金额单位 CHF m。`官方 gross = 官方 Sales − COGS`；H1 的 COGS 直接取半年报利润表 `Cost of goods sold`。

| 期末 | 类型 | 站内 revenue | 官方 Sales | 差 | 差 % | 站内 gross | COGS | 官方 gross | gross 差 | 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2021-06-30 | H1 | 41,755 | 41,755 | 0 | 0.000% | 20,356 | 21,399 | 20,356 | 0 | 不受影响 |
| 2021-12-31 | 年度 | 87,470.4 | 87,088 | +382.4 | +0.439% | 42,002.4 | 45,468.0 | 41,620.0 | +382.4 | **含 Other revenue** |
| 2022-06-30 | H1 | 45,580 | 45,580 | 0 | 0.000% | 20,947 | 24,633 | 20,947 | 0 | 不受影响 |
| 2022-12-31 | 年度 | 94,780.3 | 94,424 | +356.3 | +0.377% | 43,034.7 | 51,745.6 | 42,678.4 | +356.3 | **含 Other revenue** |
| 2023-06-30 | H1 | 46,293 | 46,293 | 0 | 0.000% | 21,121 | 25,172 | 21,121 | 0 | 不受影响 |
| 2023-12-31 | 年度 | 93,351.3 | 92,998 | +353.3 | +0.380% | 43,023.2 | 50,328.1 | 42,669.9 | +353.3 | **含 Other revenue** |
| 2024-06-30 | H1 | 45,045 | 45,045 | 0 | 0.000% | 21,255 | 23,790 | 21,255 | 0 | 不受影响 |
| 2024-12-31 | 年度 | 91,720.3 | 91,354 | +366.3 | +0.401% | 43,050.4 | 48,669.9 | 42,684.1 | +366.3 | **含 Other revenue** |
| 2025-06-30 | H1 | 44,228 | 44,228 | 0 | 0.000% | 20,619 | 23,609 | 20,619 | 0 | 不受影响 |
| 2025-12-31 | 年度 | 89,884.8 | 89,490 | +394.8 | +0.441% | 41,191.0 | 48,693.8 | 40,796.2 | +394.8 | **含 Other revenue** |
| 2026-06-30 | H1 | 43,109 | 43,109 | 0 | 0.000% | 19,991 | 23,118 | 19,991 | 0 | 不受影响 |

> 结论不是「想当然只有年度行」：11 期逐期核对后，5 个年度行全部有正差且差值 = 当年 `Other revenue`；6 个 H1 行全部 0 差，包括最新 2026-06-30。未发现 H1 或其他期受影响。

---

## 三、官方出处（URL + 页码/表名）

### 3.1 年度 Sales

| 年份 | 官方 Sales | 出处（印刷页 / 表名） |
|---|---:|---|
| 2021 | 87,088 | *Nestlé Annual Review 2022*，**p.44**，「Key figures (consolidated)」Sales 行（当年 87 088 / 上年 94 424）<br>`https://www.annualreports.com/HostedData/AnnualReportArchive/n/OTC_NSRGY_2022.pdf` |
| 2022 | 94,424 | 同上 **p.44**；并由 *Annual Review 2023* **p.44** Sales 行二次印证<br>`https://www.annualreports.com/HostedData/AnnualReportArchive/n/OTC_NSRGY_2023.pdf` |
| 2023 | 92,998 | *Annual Review 2023* **p.44**；*Annual Review 2024* **p.30**「Key figures (consolidated)」比较列 |
| 2024 | 91,354 | *Annual Review 2024* **p.30**；FY2025 业绩稿（Vevey, 2026-02-19）**p.1**「Sales 89,490 / 91,354」<br>`https://www.nestle.com/sites/default/files/2026-02/full-year-results-press-release-2025-en.pdf` |
| 2025 | 89,490 | 同上业绩稿 **p.1**；*Annual Review 2025* **p.35**「Key figures (consolidated)」 |

2024/2025 的官方 PDF 本地缓存（`nestle.com` 在本沙箱 403，以下为已缓存的原件）：

- `profitbridge/tmp-seg-plan/cache_D2/nestle_ar2024.pdf` p.30
- `profitbridge/tmp-seg-plan/cache_D2/nestle_ar2025.pdf` p.35

本地文本核验（pdftotext，行号为文件内行号）：

- `/tmp/nesn/ar2022.txt:1844`：`Sales 87 088 94 424 95 212 98 772 80 564 94 010`
- `/tmp/nesn/ar2023.txt:1140`：`Sales 94 424 92 998 98 772 103 584 94 010 95 730`
- `/tmp/ar2024.txt:1020`：`Sales 92 998 91 354 103 584 103 754 95 730 95 914`
- `/tmp/ar2025.txt:996`：`Sales 91 354 89 490 103 754 107 631 95 914 95 494`

### 3.2 H1 Sales（6 期，均与站内 revenue 完全一致）

| 期 | 官方 Sales | 出处（印刷页 / PDF 页） |
|---|---:|---|
| 2021-06-30 | 41,755 | *2021 Half-Year Report*，Consolidated income statement，印刷 **p.10 / PDF p.11**<br>`https://www.nestle.com/sites/default/files/2021-07/2021-half-year-report-en.pdf` |
| 2022-06-30 | 45,580 | *2022 Half-Year Report*，印刷 **p.12 / PDF p.13**<br>`https://www.nestle.com/sites/default/files/2022-07/2022-half-year-report-en.pdf` |
| 2023-06-30 | 46,293 | *2023 Half-Year Report*，印刷 **p.12 / PDF p.13**<br>`https://www.nestle.com/sites/default/files/2023-07/2023-half-year-report-en.pdf` |
| 2024-06-30 | 45,045 | *2024 Half-Year Report*，印刷 **p.10 / PDF p.11**<br>`https://www.nestle.com/sites/default/files/2024-07/2024-half-year-report-en.pdf` |
| 2025-06-30 | 44,228 | *2025 Half-Year Report*，印刷 **p.8 / PDF p.9**<br>`https://www.nestle.com/sites/default/files/2025-07/half-year-report-2025-en.pdf` |
| 2026-06-30 | 43,109 | *Half-Year Report January–June 2026*，Consolidated income statement **p.10**（p.1「Total reported sales in H1-26 were CHF 43.1 billion」）<br>`https://www.nestle.com/sites/default/files/2026-07/half-year-report-2026-en.pdf`（2026-07-23 发布） |

本地文本行（`profitbridge/tmp-season-eu/evidence_h1/Nestle_YYYY_H1.txt`）：2021:418、2022:503、2023:504、2024:366、2025:311；2026 原件 `profitbridge/tmp-season-eu/evidence/Nestle_2026HalfYearReport.pdf`。

### 3.3 根因证据

1. **毛利率复算残差 ≤0.05pp**：旧 revenue 与旧 gross 各减同一个差值、COGS 不动后，毛利率 = 47.80 / 45.19 / 45.88 / 46.72 / 45.59%，与年报/业绩稿口径吻合。
2. **FY2025 业绩稿 p.8 瀑布表**：`Other revenue` 一行位于 Gross profit margin 与 Distribution expenses 之间，2025 为 **+0.5%**、2024 为 **+0.4%**；45.6 + 0.5 − 8.2 − 20.0 − 1.8 = 16.1%（UTOP）只有加上该行才成立。文本见 `profitbridge/tmp-audit-currency/pdf/nestle.txt:321` 附近。
3. **分部合计 ÷ fx = 官方 Sales**：2023/24/25 的 `segSum / fxToUsd` = 92,998.01 / 91,354.00 / 89,490.00；旧 ratio 0.99622 / 0.99601 / 0.99561 正好等于 `Sales / (Sales + OtherRev)`。

---

## 四、修复实现

### 4.1 fixup

在 `data/staging/fixups.json` 追加第 18 条 `NESN.SW` 整票 fixup（沿用既有结构：`ticker` + `sourceCommit` + `entry`）。`entry` 是原 NESN 条目的精确克隆，只改 10 个数字；11 期全部保留，H1 行原样带入，避免整票替换时丢期。

| 期末 | revenue 旧 → 新 | gross 旧 → 新 | COGS（未动） | 恒等式 |
|---|---:|---:|---:|---|
| 2021-12-31 | 87,470.4 → 87,088 | 42,002.4 → 41,620 | 45,468.0 | 87,088 − 41,620 = 45,468 |
| 2022-12-31 | 94,780.3 → 94,424 | 43,034.7 → 42,678.4 | 51,745.6 | 94,424 − 42,678.4 = 51,745.6 |
| 2023-12-31 | 93,351.3 → 92,998 | 43,023.2 → 42,669.9 | 50,328.1 | 92,998 − 42,669.9 = 50,328.1 |
| 2024-12-31 | 91,720.3 → 91,354 | 43,050.4 → 42,684.1 | 48,669.9 | 91,354 − 42,684.1 = 48,669.9 |
| 2025-12-31 | 89,884.8 → 89,490 | 41,191.0 → 40,796.2 | 48,693.8 | 89,490 − 40,796.2 = 48,693.8 |

其它字段（opInc / netInc / rd / sga / periodType / fxToUsd）零改动。

### 4.2 定向应用模式（为什么没有直接跑完整重建）

`scripts/merge_batches.mjs` 新增 `--fixup-ticker=XXXX` 模式：读取磁盘 `profit.json`，只取该 ticker 的**最后一条** fixup（与主流程「后者覆盖前者」一致），深拷贝覆盖该票；若任何变化字段不在 `{revenue, gross}` 内直接拒绝；并校验 revenue>0、gross≥0、gross≤revenue、revenue−gross>0。写入 `data/profit.json` + `data/profit.json.js`，写 `tmp-merge/fixup_report.json`，**不写 `data/companies.json`**。

实测完整重建路径当前不是零差的，不能用于本次验收：

- `node scripts/merge_batches.mjs --force` → 写 3,724 期（基线 3,731），丢掉 BIDU / CRWV / 00700.HK / 00992.HK / 00981.HK / 01024.HK / 688981.SS 的 2026-09-30 期。原因：脚本只加载 `batch1`–`batch8`，未加载 `data/staging/batch9.json`–`batch12.json`。
- 临时把 batch9–12 接进加载器后，期数恢复 3,731，但 `merge_fundamentals.mjs` 会重排 `00981.HK` 的 quarter 键序（`opInc,rd,sga,gross` → `gross,opInc,rd,sga`），逐字节零差仍不成立；该临时接线已回退。
- 结论：在现有管线修好「batch9–12 加载 + 稳定键序」之前，单票修复只能走定向模式。这是本次唯一偏离「完整重建」的地方，已作为风险记录在第九节。

命令与输出：

```bash
node scripts/merge_batches.mjs --fixup-ticker=NESN.SW
# FIXUP-TICKER WROTE profit.json; ticker=NESN.SW fieldsChanged=10 companies=92 periods=3731
```

模式只允许 `revenue`/`gross`，所以 10 个变化就是 5 期 × 2 字段；若 fixup 带进任何其它字段差异会直接拒绝。

---

## 五、零差证明

方法：以 `tmp-nesn-work/baseline/profit.json` 为基线，对每个公司对象做 `JSON.stringify(company)` 的 sha256（保留键序，能同时抓到值变化和键序变化）；再对 91 家（排除 NESN）的 `ticker + hash` 排序拼接做聚合 sha256。

| 指标 | 结果 |
|---|---|
| 公司数 | 92 → 92 |
| 期数 | 3,731 → 3,731 |
| 发生变化的公司 | **仅 `NESN.SW`** |
| 其它 91 家聚合 sha256（前） | `6b531d14b3b5b9cba10b6bcf8b6a552a13d617d1c6a74052a51b65bdd1544936` |
| 其它 91 家聚合 sha256（后） | `6b531d14b3b5b9cba10b6bcf8b6a552a13d617d1c6a74052a51b65bdd1544936` |
| NESN.SW sha256（前 / 后） | `99c0110a…f576962` / `3d521401…bd414e` |
| 字段级变化 | 10 个，恰为 5 期 revenue + gross |
| 顶层 `updated` | 2026-11-19 → 2026-11-20 |
| 镜像 `profit.json.js` | 与 `'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n'` **逐字节相等** |
| 受保护文件 | `segments.json` / `segments.json.js` / `companies.json` 相对 `e496eab` **SAME** |

机器可读证据：`tmp-nesn/evidence.json`（含全部 10 条 before/after、hash、ratio、镜像字节数）。逐字节比对脚本的中间快照在 `tmp-nesn-work/`。

---

## 六、NESN 年度 ratio（分部合计 ÷ (revenue × fxToUsd)）

`segments.json` 中 NESN 只有 2023/2024/2025 三个年度期；segSum 为分部 value 直接求和（USD m）。

| 期末 | segSum (USD m) | 修复前 revenue (CHF m) | 修复前 ratio | 修复后 revenue | fxToUsd | 修复后 revenue×fx (USD m) | 修复后 ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2023-12-31 | 110,974.52 | 93,351.3 | 0.99621543 | 92,998 | 1.1933 | 110,974.51 | **1.00000006** |
| 2024-12-31 | 100,836.54 | 91,720.3 | 0.99600629 | 91,354 | 1.1038 | 100,836.55 | **0.99999995** |
| 2025-12-31 | 112,891.64 | 89,884.8 | 0.99560776 | 89,490 | 1.2615 | 112,891.64 | **1.00000004** |

三个期全部落在 1.00000 ± 0.0005；残留 ±6e-8 是浮点求和误差。

---

## 七、测试

服务：`node scripts/serve.mjs 8796`（测试完已停）。所有浏览器测试以 `BASE=http://127.0.0.1:8796` 运行。

- **22/22 个 `tests/verify_*.mjs` 浏览器测试文件通过，0 失败，合计 896 条断言**。
- 各文件断言数：bar 34、bar_basis_labels 26、bar_cum_growth 31、bar_lines 15、cum_seg 27、currency 6、export 11、filter_jitter 19、graph_coverage 31、header_layout 183、layout_refactor 23、loss_branch 91、modes 31、new 140、pct_fix 32、seg_annual_quarters 16、seg_axis 11、seg_notes 27、state_memory 11、timeline2 21、timeline_click 15、units_guard 95。
- **`node tests/verify_scan.mjs --run`：21/21 通过**，`scanned=83`、`errors=0`、`skipped=9`（NESN 属 EU 无 CIK，被 skip；扫描不读取 `profit.json`）。
  - 第一次 `--run` 出现 1 条外部数据源瞬时错误（`scanned=82`、`errors=1`），同一命令立即重跑为 `scanned=83`、`errors=0`。两次均为只读扫描，不写数据；该错误与本次改动无关，但说明该测试依赖外部源、存在偶发抖动。
- 测试日志：`tmp-nesn/testlogs/`（含 `results.txt`、每个测试的完整输出、`verify_scan2.log`）。

---

## 八、截图

Nestlé FY2025（2025-12-31）桑基图，路径 `tmp-nesn/shots/nesn-2025-12-31-sankey.png`（1680×1050，168,119 bytes）。

![NESN FY2025 桑基图](shots/nesn-2025-12-31-sankey.png)

图中读数与修复值一致：

- 营收 **$112.9B** = 89,490 × 1.2615 = 112,891.6 $M（官方 Sales 折本站期末汇率；不是雀巢加权平均汇率下的 107,631）
- 营收成本 **$61.4B** = 48,693.8 × 1.2615
- 毛利润 **$51.5B** = 40,796.2 × 1.2615
- 营业利润 **$17.5B**、净利润 **$11.4B**

分部输入合计 $112,891.64M 与营收侧完全对齐，所以图不再出现输入/输出缺口。

---

## 九、风险与遗留

1. **完整重建路径仍是坏的**：`merge_batches.mjs` 未加载 `batch9`–`batch12`，完整重建会丢 7 个 2026-09-30 期；接上后又会被 `merge_fundamentals` 重排 `00981.HK` 键序。本次用新增的 `--fixup-ticker` 定向模式绕开，但下一次「全量重建」仍会踩同一个坑，建议另开任务修加载器与键序稳定性。
2. **定向模式是新代码路径**：只允许 `revenue`/`gross` 变化，护栏会拒绝其它字段；但它不重建 staging，只适用于「单票、少量字段」修正。已在脚本内注释用途。
3. **`updated` 变了**：2026-11-19 → 2026-11-20，这是管线写盘行为；公司数据本身除 NESN 外零变化。
4. **H1 口径**：H1 gross 是 `Sales − COGS` 推导值（雀巢利润表没有单独 Gross profit 行），与仓库既有 H1 口径一致；6 期全部与官方 Sales 0 差，未改。
5. **截图汇率**：截图按站内期末 `fxToUsd` 折算，和雀巢年报的全年加权平均 USD 不同（后者 2025 为 107,631）。这是全站既有设计，不是本次修复引入。
6. **文档**：只改了 `docs/KNOWN_CAVEATS.md` 第五节 NESN 那一行，写入了两次修复的 commit（`61d347d` / merge `e76d51a`、`3624375`）；未动修订记录或其它段落。
7. **未 push / 未 rebase**；分支仅本地。

---

## 十、复现

```bash
cd C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-nesn
git log --oneline -3                 # 19aea97 / 3624375 / e496eab
node scripts/merge_batches.mjs --fixup-ticker=NESN.SW
node scripts/serve.mjs 8796 &
BASE=http://127.0.0.1:8796 node tests/verify_bar.mjs   # 其余 verify_*.mjs 同理
node tests/verify_scan.mjs --run
node tmp-nesn/shot.mjs               # 重新生成截图
```
