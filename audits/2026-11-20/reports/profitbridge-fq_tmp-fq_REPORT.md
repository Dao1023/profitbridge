> 来源：profitbridge-fq/tmp-fq/REPORT.md（2026-11-20 归档）

# 财季标签修复报告（分支 `fix/fiscal-quarter`）

## 1. 结论

桑基图大标题与柱状图轴标签原先用**日历季度**（`Q3 2026`），对非 12 月财年公司系统性错位：财年跨年时年份错、季度序号也错。
现在改为按公司真实财年推导的**财季**：`<公司名> FY<财年> Q<财季>`（如 `苹果 FY2026 Q4`），柱轴同步为 `Q4'26` 形式，meta 行保留真实期末日期（`2026-09-26 季度末`）。

- 92 家公司全部补上 `data/companies.json` 的 `fiscalYearEndMonth`（1–12）。
- 其中 18 家非 12 月财年，**16 家**给出了 10-K/20-F 封面原文作为依据，含被旧兜底算法认错的 MU/CSCO/ADBE/ORCL/AVGO/HPQ **六家全部**（MU 封面写 September 3, 2026，按 9 月财年末处理，理由见 §6）。
- 新旧标签差异：18 家里 **15 家季度或财年被实际纠正**，ADBE/AVGO/HPQ 三家的当期期末恰好与日历季末重合，只有格式变化（`Q3 2026` → `FY2026 Q3`）。

## 2. 改动范围

| 文件 | 改动 |
|---|---|
| `app.js` | 新增 `fiscalQuarterOf()`/`FQ_DRIFT_DAYS`；`quarterLabel()`、`barPeriodLabel()`、`segPeriodLabel()`、`fiscalYearOf()` 改走财季；`fiscalYearEndMonth()` 优先读公司元数据，旧推断逻辑整体保留为降级路径 |
| `data/companies.json` | 92 家各追加一行 `fiscalYearEndMonth` |
| `tests/verify_fiscal_quarter.mjs` | **新增** 67 条断言 |
| `tests/verify_bar.mjs` | NVDA 末根柱 `Q3'26` → `Q2'27` |
| `tests/verify_bar_basis_labels.mjs` | 期望模型改为财季；00151.HK 06-30 由 Q2 改 Q1 |
| `tests/verify_timeline_click.mjs` | 标题断言改为财季 |

未触碰：`data/profit.json`、`data/segments.json`、任何 staging 文件、node value、配色、导出逻辑（仅标题文本随动）。

Commit：

```
7d360dd test(财报季度): 新增 verify_fiscal_quarter 并同步 3 个既有断言
80cafff feat(财报季度): 按公司真实财年计算财季标签，标题/柱轴改用 FYn Qn
```

## 3. FYE 核实方法

1. **SEC 申报公司（50 家）**：先读 `https://data.sec.gov/submissions/CIK##########.json` 取 `fiscalYearEnd`（MMDD）与最新 10-K/20-F 的 accession + primaryDocument，再下载该文件、去标签后正则抓封面句 `(For the) fiscal year ended <Month DD, YYYY>`。
   - **49/50 抓到封面原文**，且月份与 EDGAR 元数据 `fiscalYearEnd` **零冲突**（脚本 `tmp-fq/fetch_covers.mjs`，结果 `tmp-fq/cover_evidence.json`）。
   - CHA（中国电信）封面年份被行内 XBRL 标签拆成 `202 5`，合并数字后提取。
   - **IBM**：EDGAR 的 primary document `ibm-20251231.htm` 只有 inline-XBRL 包装、没有封面正文，抓不到原句；改用 `submissions.fiscalYearEnd=1231` + 归档索引佐证，标为 `A*`。IBM 是 12 月财年，对结果无影响。
2. **非 SEC 公司（40 家，A 股/港股/日股/台股/韩股等）**：无 10-K/20-F 可抓，取数据中每年该月月末的期末日期作为财年末（例：00992.HK 联想 `2026-03-31` 在原始数据里被标为 `q4`；00151.HK 旺旺年报期末 `2026-03-31`）。证据等级记 `B`。
3. **查不到（2 家）**：SPCX、CBRS 在 EDGAR 无 10-K/20-F、数据里也只有 12-31 期末 → 默认 12，记 `C`。

> 注：任务里点名的 TGT / WMT / COST 不在本仓库 92 家 universe 内，因此未新增。

## 4. 非 12 月财年（18 家）与依据

| ticker | 公司 | FYE 月 | 依据 | 来源 |
|---|---|---|---|---|
| 00151.HK | 中国旺旺 | 3 | 非 SEC 申报；年报期末 2026-03-31 | — |
| 00992.HK | 联想集团 | 3 | 非 SEC 申报；数据内每个 3 月末为财年末（最后 2026-03-31，标记 q4） | — |
| AAPL | 苹果 | 9 | 10-K/20-F 封面 “fiscal year ended September 26, 2026” | https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm |
| ADBE | 奥多比 | 11 | 10-K/20-F 封面 “fiscal year ended November 28, 2025” | https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm |
| ARM | 安谋 | 3 | 10-K/20-F 封面 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm |
| AVGO | 博通 | 11 | 10-K/20-F 封面 “fiscal year ended November 2, 2025” | https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm |
| BABA | 阿里巴巴 | 3 | 10-K/20-F 封面 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/1577552/000119312526231755/baba-20260331.htm |
| CSCO | 思科 | 7 | 10-K/20-F 封面 “fiscal year ended July 25, 2026” | https://www.sec.gov/Archives/edgar/data/858877/000085887726000132/csco-20260725.htm |
| DELL | 戴尔科技 | 1 | 10-K/20-F 封面 “fiscal year ended January 30, 2026” | https://www.sec.gov/Archives/edgar/data/1571996/000157199626000008/dell-20260130.htm |
| HPQ | 惠普 | 10 | 10-K/20-F 封面 “fiscal year ended October 31, 2025” | https://www.sec.gov/Archives/edgar/data/47217/000004721725000071/hpq-20251031.htm |
| MSFT | 微软 | 6 | 10-K/20-F 封面 “fiscal year ended June 30, 2026” | https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm |
| MU | 美光科技 | 9 | 10-K/20-F 封面 “fiscal year ended September 3, 2026” | https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm |
| NVDA | 英伟达 | 1 | 10-K/20-F 封面 “fiscal year ended January 25, 2026” | https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm |
| ORCL | 甲骨文 | 5 | 10-K/20-F 封面 “fiscal year ended May 31, 2026” | https://www.sec.gov/Archives/edgar/data/1341439/000119312526277521/orcl-20260531.htm |
| QCOM | 高通 | 9 | 10-K/20-F 封面 “fiscal year ended September 27, 2026” | https://www.sec.gov/Archives/edgar/data/804328/000080432826000128/qcom-20260927.htm |
| SBUX | 星巴克 | 9 | 10-K/20-F 封面 “fiscal year ended September 27, 2026” | https://www.sec.gov/Archives/edgar/data/829224/000082922426000162/sbux-20260927.htm |
| SONY | 索尼 | 3 | 10-K/20-F 封面 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/313838/000119312526274893/d28719d20f.htm |
| V | 维萨 | 9 | 10-K/20-F 封面 “fiscal year ended September 30, 2026” | https://www.sec.gov/Archives/edgar/data/1403161/000140316126000134/v-20260930.htm |

其余 74 家均为 12 月财年（其中 34 家 SEC 封面原文写明 `December 31`，其余为非 SEC 公司按 12-31 期末）。全部 92 家的逐家依据见 §9 附录 A。

## 5. 新旧标签映射（每家取数据中最后一期）

| ticker | 期末 | 旧标签（日历） | 新标签（财季） | 柱轴 | 变化 |
|---|---|---|---|---|---|
| AAPL | 2026-09-26 | Q3 2026 | FY2026 Q4 | Q4'26 | **季/年被纠正** |
| MSFT | 2026-09-30 | Q3 2026 | FY2027 Q1 | Q1'27 | **季/年被纠正** |
| ORCL | 2026-08-31 | Q3 2026 | FY2027 Q1 | Q1'27 | **季/年被纠正** |
| CSCO | 2026-10-24 | Q4 2026 | FY2027 Q1 | Q1'27 | **季/年被纠正** |
| ADBE | 2026-08-28 | Q3 2026 | FY2026 Q3 | Q3'26 | 年-季相同，仅格式变 |
| AVGO | 2026-08-02 | Q3 2026 | FY2026 Q3 | Q3'26 | 年-季相同，仅格式变 |
| HPQ | 2026-07-31 | Q3 2026 | FY2026 Q3 | Q3'26 | 年-季相同，仅格式变 |
| MU | 2026-09-03 | Q3 2026 | FY2026 Q4 | Q4'26 | **季/年被纠正** |
| NVDA | 2026-07-26 | Q3 2026 | FY2027 Q2 | Q2'27 | **季/年被纠正** |
| DELL | 2026-07-31 | Q3 2026 | FY2027 Q2 | Q2'27 | **季/年被纠正** |
| ARM | 2026-06-30 | Q2 2026 | FY2027 Q1 | Q1'27 | **季/年被纠正** |
| BABA | 2026-06-30 | Q2 2026 | FY2027 Q1 | Q1'27 | **季/年被纠正** |
| SONY | 2026-09-30 | Q3 2026 | FY2027 Q2 | Q2'27 | **季/年被纠正** |
| QCOM | 2026-09-27 | Q3 2026 | FY2026 Q4 | Q4'26 | **季/年被纠正** |
| SBUX | 2026-09-27 | Q3 2026 | FY2026 Q4 | Q4'26 | **季/年被纠正** |
| V | 2026-09-30 | Q3 2026 | FY2026 Q4 | Q4'26 | **季/年被纠正** |
| 00992.HK | 2026-09-30 | Q3 2026 | FY2027 Q2 | Q2'27 | **季/年被纠正** |
| 00151.HK | 2025-09-30 | Q3 2025 | FY2026 Q2 | Q2'26 | **季/年被纠正** |

## 6. 实现要点

```js
function fiscalQuarterOf(endDate, fyeMonth)  // → { fy, q, label: 'FY2026 Q4' }
```

- **财年归属**：先算「有效月份」`m`（见下条漂移规则），`fy = m > fyeMonth ? year + 1 : year`（财年按结束年份命名：`FY2027` = 2027-06-30 结束，与旧 `fiscalYearOf` 的约定一致）。
- **财季**：财年首月 `start = fyeMonth % 12 + 1`，`mfs = ((m - start) % 12 + 12) % 12`，`q = floor(mfs / 3) + 1`。
- **52/53 周漂移（`FQ_DRIFT_DAYS = 7`）**：财年末是「某月最后一个周六/周五」时，实际期末会漂到次月头几天（Dell `2024-11-01` 属 10 月财年末、Micron `2026-09-03` 属 8/9 月财年末、NVDA `2026-01-25` 属 1 月财年末）。因此当 `end` 的**日 ≤ 7** 时，把有效月份回退一个月（1 月回退到上一年 12 月）再参与运算。没有这条，Dell 的 11-01 会被判成 Q4、Micron 的 09-03 会被判成 FY2027 Q1。
- **降级**：`fyeMonth` 非法/缺失 → 按 12 月；`fiscalYearEndMonth(tk)` 先读 `companies.json` 的 `fiscalYearEndMonth`，读不到再走原来的三步推断（年报行月份 → `SEG.periodTypes` → 近 8 个季度末众数）。元数据整个缺失时行为与改动前一致，不会崩。
- **为什么 MU 记 9 而不是 8**：MU 财年末定义为「8 月 31 日最近的周四」，落在 8-28～9-03。若记 8，2026-09-03 会被算成 FY2027 Q1（错）；记 9 配合漂移规则，8 月末与 9-03 两种形态都能归到 FY2026 Q4。ADBE（11-28）、AVGO（11-02）、HPQ（10-31）、CSCO（07-25/26）同理按封面月份记。

## 7. 测试结果

新增 `tests/verify_fiscal_quarter.mjs` 覆盖：10 家公司的标题 + meta 真实期末日期 + 柱轴标签；12 月财年非漂移端与旧日历结果一致；`fiscalYearEndMonth` 缺失/非法时降级不崩（页面内以无 FYE 的临时 REGISTRY 重跑）。

```
OK   tests/verify_bar.mjs                     34/34 passed                               08:10:20
OK   tests/verify_bar_basis_labels.mjs        SUMMARY 26/26 checks passed                08:10:26
OK   tests/verify_bar_cum_growth.mjs          SUMMARY 31/31 checks passed                08:10:32
OK   tests/verify_bar_lines.mjs               15 checks, 15 passed, 0 failed             08:10:48
OK   tests/verify_cum_seg.mjs                 27/27 passed                               08:10:54
OK   tests/verify_currency.mjs                SUMMARY 6/6 checks passed                  08:10:59
OK   tests/verify_export.mjs                  SUMMARY 11/11 checks passed                08:11:05
OK   tests/verify_filter_jitter.mjs           19/19 checks passed                        08:11:21
OK   tests/verify_fiscal_quarter.mjs          SUMMARY 67/67 checks passed                08:11:29
OK   tests/verify_graph_coverage.mjs          SUMMARY 31/31 checks passed                08:11:38
OK   tests/verify_header_layout.mjs           SUMMARY 183/183 checks passed              08:11:50
OK   tests/verify_layout_refactor.mjs         23/23 checks passed                        08:12:00
OK   tests/verify_loss_branch.mjs             SUMMARY 91/91 checks passed                08:12:13
OK   tests/verify_modes.mjs                   31/31 passed                               08:12:26
OK   tests/verify_new.mjs                     ALL PASS                                   08:12:26
OK   tests/verify_pct_fix.mjs                 32/32 passed                               08:12:37
OK   tests/verify_seg_annual_quarters.mjs     SUMMARY 16/16 checks passed                08:12:43
OK   tests/verify_seg_axis.mjs                11/11 passed                               08:12:51
OK   tests/verify_seg_notes.mjs               27/27 passed                               08:13:03
OK   tests/verify_state_memory.mjs            11/11 checks passed                        08:13:17
OK   tests/verify_timeline2.mjs               21/21 passed                               08:13:24
OK   tests/verify_timeline_click.mjs          15/15 checks passed                        08:13:37
OK   tests/verify_units_guard.mjs             SUMMARY ALL PASS                           08:13:38

TOTAL pass=23 fail=0
```

`verify_scan --run`：

```
ok   输出是 JSON 对象
ok   scannedAt 可解析为时间
ok   counts 是对象
ok   newPeriods 是数组
ok   fillCandidates 是数组
ok   filingAlerts 是数组
ok   skipped 是数组
ok   errors 是数组
ok   counts.total 是数字
ok   counts.scanned 是数字
ok   counts.newPeriods 是数字
ok   counts.fillCandidates 是数字
ok   counts.filingAlerts 是数字
ok   counts.errors 是数字
ok   counts.skipped 是数字
ok   扫描数 >= 80（实际 83）
ok   errors === 0（实际 0）
ok   errors 数量自洽
ok   newPeriods 数量自洽
ok   filingAlerts 数量自洽
ok   newPeriods 中不含 6-K（reportDate≠期末）

verify_scan: 全部通过
```

## 8. 截图（`tmp-fq/shots/`）

before = 旧代码（另一个 worktree 的 8440 端口，`app.js` 里 grep 不到 `fiscalQuarterOf`）；after = 本分支（8793 端口）。

| 公司 | before | after |
|---|---|---|
| AAPL | `tmp-fq/shots/before_AAPL.png` — 苹果 Q3 2026 | `tmp-fq/shots/after_AAPL.png` — 苹果 FY2026 Q4 |
| MSFT | `tmp-fq/shots/before_MSFT.png` — 微软 Q3 2026 | `tmp-fq/shots/after_MSFT.png` — 微软 FY2027 Q1 |
| ORCL | `tmp-fq/shots/before_ORCL.png` — 甲骨文 Q3 2026 | `tmp-fq/shots/after_ORCL.png` — 甲骨文 FY2027 Q1 |
| CSCO（旧算法认错） | `tmp-fq/shots/before_CSCO.png` — 思科 Q4 2026 | `tmp-fq/shots/after_CSCO.png` — 思科 FY2027 Q1 |

截图脚本 `tmp-fq/shots.mjs`（CDP 9371），meta 行在 after 图里仍显示真实期末（如 `2026-09-26 季度末`）。

## 9. 附录 A：92 家 FYE 逐家依据

| # | ticker | 公司 | FYE 月 | 证据等级 | 核实依据 | 来源 URL |
|---|---|---|---|---|---|---|
| 1 | DELL | 戴尔科技 | 1 | A | 10-K/20-F 封面原文 “fiscal year ended January 30, 2026” | https://www.sec.gov/Archives/edgar/data/1571996/000157199626000008/dell-20260130.htm |
| 2 | NVDA | 英伟达 | 1 | A | 10-K/20-F 封面原文 “fiscal year ended January 25, 2026” | https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm |
| 3 | 00151.HK | 中国旺旺 | 3 | B | 无 SEC 申报；数据内每个财年末均落在 3 月（最后 2026-03-31） | — |
| 4 | 00992.HK | 联想集团 | 3 | B | 无 SEC 申报；数据内每个财年末均落在 3 月（最后 2026-03-31） | — |
| 5 | ARM | 安谋 | 3 | A | 10-K/20-F 封面原文 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm |
| 6 | BABA | 阿里巴巴 | 3 | A | 10-K/20-F 封面原文 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/1577552/000119312526231755/baba-20260331.htm |
| 7 | SONY | 索尼 | 3 | A | 10-K/20-F 封面原文 “fiscal year ended March 31, 2026” | https://www.sec.gov/Archives/edgar/data/313838/000119312526274893/d28719d20f.htm |
| 8 | ORCL | 甲骨文 | 5 | A | 10-K/20-F 封面原文 “fiscal year ended May 31, 2026” | https://www.sec.gov/Archives/edgar/data/1341439/000119312526277521/orcl-20260531.htm |
| 9 | MSFT | 微软 | 6 | A | 10-K/20-F 封面原文 “Fiscal Year Ended June 30, 2026” | https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm |
| 10 | CSCO | 思科 | 7 | A | 10-K/20-F 封面原文 “fiscal year ended July 25, 2026” | https://www.sec.gov/Archives/edgar/data/858877/000085887726000132/csco-20260725.htm |
| 11 | AAPL | 苹果 | 9 | A | 10-K/20-F 封面原文 “fiscal year ended September 26, 2026” | https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm |
| 12 | MU | 美光科技 | 9 | A | 10-K/20-F 封面原文 “fiscal year ended September 3, 2026” | https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm |
| 13 | QCOM | 高通 | 9 | A | 10-K/20-F 封面原文 “fiscal year ended September 27, 2026” | https://www.sec.gov/Archives/edgar/data/804328/000080432826000128/qcom-20260927.htm |
| 14 | SBUX | 星巴克 | 9 | A | 10-K/20-F 封面原文 “Fiscal Year Ended September 27, 2026” | https://www.sec.gov/Archives/edgar/data/829224/000082922426000162/sbux-20260927.htm |
| 15 | V | 维萨 | 9 | A | 10-K/20-F 封面原文 “fiscal year ended September 30, 2026” | https://www.sec.gov/Archives/edgar/data/1403161/000140316126000134/v-20260930.htm |
| 16 | HPQ | 惠普 | 10 | A | 10-K/20-F 封面原文 “fiscal year ended October 31, 2025” | https://www.sec.gov/Archives/edgar/data/47217/000004721725000071/hpq-20251031.htm |
| 17 | ADBE | 奥多比 | 11 | A | 10-K/20-F 封面原文 “fiscal year ended November 28, 2025” | https://www.sec.gov/Archives/edgar/data/796343/000079634326000003/adbe-20251128.htm |
| 18 | AVGO | 博通 | 11 | A | 10-K/20-F 封面原文 “fiscal year ended November 2, 2025” | https://www.sec.gov/Archives/edgar/data/1730168/000173016825000121/avgo-20251102.htm |
| 19 | 000063.SZ | 中兴通讯 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 20 | 000100.SZ | TCL科技 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 21 | 000333.SZ | 美的集团 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 22 | 000660.KS | SK海力士 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 23 | 00100.HK | MiniMax | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 24 | 002415.SZ | 海康威视 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 25 | 002594.SZ | 比亚迪 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 26 | 005930.KS | 三星电子 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 27 | 00700.HK | 腾讯控股 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 28 | 00728.HK | 中国电信 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 29 | 00762.HK | 中国联通 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 30 | 00941.HK | 中国移动 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 31 | 00981.HK | 中芯国际 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 32 | 01024.HK | 快手 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 33 | 01398.HK | 工商银行 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 34 | 01810.HK | 小米集团 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 35 | 02097.HK | 蜜雪集团 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 36 | 02513.HK | 智谱 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 37 | 03690.HK | 美团 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 38 | 03888.HK | 金山软件 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 39 | 03968.HK | 招商银行 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 40 | 066570.KS | LG电子 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 41 | 09633.HK | 农夫山泉 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 42 | 2330.TW | 台积电 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 43 | 2454.TW | 联发科 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 44 | 300750.SZ | 宁德时代 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 45 | 600519.SS | 贵州茅台 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 46 | 600887.SS | 伊利股份 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 47 | 601360.SS | 三六零(360安全) | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 48 | 603866.SH | 桃李面包 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 49 | 688256.SS | 寒武纪 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 50 | 688795.SS | 摩尔线程 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 51 | 688825.SS | 长鑫存储 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 52 | 688981.SS | 中芯国际A股 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 53 | AMD | 超威半导体 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 27, 2025” | https://www.sec.gov/Archives/edgar/data/2488/000000248826000018/amd-20251227.htm |
| 54 | AMZN | 亚马逊 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm |
| 55 | ASML | 阿斯麦 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/937966/000162828026011378/asml-20251231.htm |
| 56 | BIDU | 百度 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1329099/000119312526109289/d38065d20f.htm |
| 57 | BILI | 哔哩哔哩 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1723690/000119312526157842/d91984d20f.htm |
| 58 | CBRS | Cerebras | 12 | C | 无可核实申报文件，默认 12 月 | — |
| 59 | CHA | 霸王茶姬 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/2013649/000110465926050766/cha-20251231x20f.htm |
| 60 | CRWV | CoreWeave | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1769628/000176962826000104/crwv-20251231.htm |
| 61 | DIDIY | 滴滴 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1764757/000110465926042350/didi-20251231x20f.htm |
| 62 | DUOL | 多邻国 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm |
| 63 | GOOGL | 谷歌 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm |
| 64 | HUAWEI | 华为 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 65 | IBM | 国际商业机器 | 12 | A* | EDGAR primary document 仅为 inline-XBRL 包装（无封面正文）；以 submissions.fiscalYearEnd=1231 与 EDGAR 归档索引为准，FYE 为 12 月 | https://www.sec.gov/Archives/edgar/data/51143/000005114326000010/ibm-20251231.htm |
| 66 | INTC | 英特尔 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 27, 2025” | https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm |
| 67 | JD | 京东 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1549802/000119312526157870/d53690d20f.htm |
| 68 | KO | 可口可乐 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/21344/000162828026010047/ko-20251231.htm |
| 69 | LEGO | 乐高 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 70 | LI | 理想汽车 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1791706/000110465926041705/li-20251231x20f.htm |
| 71 | LKNCY | 瑞幸咖啡 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1767582/000110465926035712/lk-20251231x20f.htm |
| 72 | MC.PA | LVMH | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 73 | MCD | 麦当劳 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/63908/000006390826000035/mcd-20251231.htm |
| 74 | META | Meta | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm |
| 75 | MSI | 摩托罗拉解决方案 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/68505/000006850526000010/msi-20251231.htm |
| 76 | NESN.SW | 雀巢 | 12 | B | 无 SEC 申报；数据内每个财年末均落在 12 月（最后 2025-12-31） | — |
| 77 | NFLX | 奈飞 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1065280/000106528026000034/nflx-20251231.htm |
| 78 | NTES | 网易 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1110646/000110465926043468/ntes-20251231x20f.htm |
| 79 | NXPI | 恩智浦 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1413447/000141344726000008/nxpi-20251231.htm |
| 80 | PDD | 拼多多 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1737806/000110465926050727/pdd-20251231x20f.htm |
| 81 | PLTR | 帕兰提尔 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1321655/000132165526000011/pltr-20251231.htm |
| 82 | SPCX | SpaceX | 12 | C | 无可核实申报文件，默认 12 月 | — |
| 83 | SPOT | 声田 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1639920/000162828026006874/ck0001639920-20251231.htm |
| 84 | STM | 意法半导体 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/932787/000093278726000009/stm-20251231.htm |
| 85 | TCOM | 携程 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1269238/000119312526183379/d27369d20f.htm |
| 86 | TME | 腾讯音乐 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1744676/000119312526160257/tme-20251231.htm |
| 87 | TSLA | 特斯拉 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1318605/000162828026003952/tsla-20251231.htm |
| 88 | TSM | 台积电 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm |
| 89 | U | Unity | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1810806/000181080626000011/unity-20251231.htm |
| 90 | WB | 微博 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1595761/000110465926047217/wb-20251231x20f.htm |
| 91 | XNET | 迅雷 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1510593/000110465926050304/xnet-20251231x20f.htm |
| 92 | ZH | 知乎 | 12 | A | 10-K/20-F 封面原文 “fiscal year ended December 31, 2025” | https://www.sec.gov/Archives/edgar/data/1835724/000110465926044557/zh-20251231x20f.htm |

## 10. 剩余风险

1. **漂移阈值是经验值**：`FQ_DRIFT_DAYS = 7` 覆盖了「月末最后一个周五/周六」跨到次月的情况。若某公司财年末定义成「最近周日」而跨了 8 天以上（例如 1 月末财年落在 2 月 8 日），仍会错一季。当前 92 家里已逐家用真实期末验证过（`tmp-fq/validate.mjs` 遍历所有季度 → `ALL SEQUENCES OK`）。
2. **B/C 级证据强度弱于 A 级**：40 家非 SEC 公司（含 00992.HK/00151.HK 两家 3 月财年）靠「数据里每年该月月末」反推，没有去抓当地交易所年报 PDF；若某家实际财年与数据期末习惯不一致，会跟着错。报告已标出等级，后续可用港交所/巨潮年报封面替换。
3. **半年报公司**：00151.HK 只有 `interim`/`annual`（3 月末、9 月末），财季算术把 9 月末算成 `FY2026 Q2`；这类公司本来就没有「Q1–Q4」概念，标签新意仅在于财年归属。
4. **IBM 无封面原文（A*）**：仅影响 12 月财年公司，结果无风险。
5. **导出文件头**：`exportHeaderData` 复用 `quarterLabel`，导出 CSV/PNG 的表头随之变成 `FY2026 Q4` —— 属于「标题文本」范畴，未改导出结构。
6. **财年命名约定**：统一按「财年结束年份」（FY2027 = 2027-06-30 结束），与旧 `fiscalYearOf` 一致；如果以后要改成「起始年份」口径，只需改 `fiscalQuarterOf` 里 `fy` 的算法，测试里的期望值需同步。
7. **测试服务**：验证用 `node scripts/serve.mjs 8793` 自起端口，验证后已停；未 push、未 rebase。
