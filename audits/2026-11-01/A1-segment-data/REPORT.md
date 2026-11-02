成品路径：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge\audits\2026-11-01\A1-segment-data\`

# A1 分部（segment）数据真实性审计报告

审计日期：2026-11-01
审计范围：`data/segments.json` 全部 92 家公司的全部分部季度序列（交叉核对 `data/profit.json` 营收与 `data/segments.json` notes 口径），重点核查 TSLA、MSFT、005930.KS、066570.KS。
方法：自建 `detect.mjs`（规则 R1 合计vs营收偏离 / R2 同比异常 / R2b 相邻包络离群 / R5 份额结构断裂 / R6 年度值混入季度 / R3 名称断裂新增 / R4 非正值）扫描得 492 条命中 → 对结构性高置信命中回**原始披露**（美股 SEC XBRL R 页 / 8-K exhibit）逐值核对真值；韩股/A 股取不到免费分部源者标注"无免费源，无法证实"，绝不猜数。
结论一句话：**确认 2 家公司共 5 个分部数值错误（TSLA 2022Q1 两分部对调；MSFT 2023Q4 三分部全错、且被构造成合计=总营收以掩盖），均已用 SEC 原文证实（P0）；其余命中为韩国 Q4"年度值放入季度槽"的口径缺陷、2026 模拟未来期、名称重分类与小基数同比波动，属待确认/命名类，无其它 P0/P1 错数。**

严重度定义：P0=错数影响结论；P1=单点错数；P2=可疑待确认；P3=命名/口径不一致。**未取得外部真值与来源的条目一律标 unconfirmed 且不高于 P2。**

---

## 一、TSLA（Tesla, Inc.，CIK 0001318605）— 确认对调，P0

期末 2022-03-31（10-Q，accession 0000950170-22-006034，filed 2022-04-25）。

| 分部名 | 现值(USD-$M) | 真值 | 验证方式 | 严重度 |
|---|---|---|---|---|
| Automotive | 616 | **18,140** | SEC 10-Q R75 分部营收表 | P0 |
| Energy generation and storage | 18,140 | **616** | SEC 10-Q R75 分部营收表 | P0 |

来源：https://www.sec.gov/Archives/edgar/data/1318605/000095017022006034/R75.htm
原文（Schedule of Total Revenues and Gross Profit by Reportable Segment, USD $M, 3 Months Ended Mar.31 2022 / 2021）：
- `Total Revenues 18,756 / 10,389`
- `Automotive Segment [Member] Revenues 18,140 / 9,895；Gross profit 5,532 / 2,316`
- `Energy Generation and Storage [Member] Revenues 616 / 494；Gross profit (72) / (101)`

判定：两个值本身都对，**只是被互换**。校验 `18,140 + 616 = 18,756 = Total Revenues`，完全对账。
口径说明（重要）：利润表（R4）中 `Total automotive revenues = 16,861`（Automotive sales 15,514 + regulatory credits 679 + leasing 668），不含 `services and other 1,279`；而分部披露的 Automotive **segment** 含 services = 16,861+1,279 = **18,140**。数据集采用分部口径（两分部，缺 Services 单列），故真值取 **18,140**，而非 16,861。
证据文件：`evidence/TSLA_2022-03-31_R75_segment_revenue.html`、`evidence/TSLA_2022-03-31_R4_income_statement.html`、`evidence/TSLA_2022-03-31_evidence.txt`、`evidence/TSLA_2022-03-31_R4_excerpt.txt`

---

## 二、MSFT（Microsoft Corp，CIK 0000789019）— 三分部全错，P0

期末 2023-06-30（=MSFT FY2023 的 Q4，单季总营收 56,189 $M）。数据集三个分部值互不匹配，但**被刻意构造成 `43,168+9,030+3,991 = 56,189`，与总营收精确相等**，从而骗过"合计=营收"类校验并掩盖错配。

| 分部名 | 现值(USD-$M) | 真值 | 验证方式 | 严重度 |
|---|---|---|---|---|
| Productivity and Business Processes | 43,168 | **18,291** | SEC 8-K Q4FY23 exhibit 99.1 | P0 |
| Intelligent Cloud | 9,030 | **23,993** | SEC 8-K Q4FY23 exhibit 99.1 | P0 |
| More Personal Computing | 3,991 | **13,905** | SEC 8-K Q4FY23 exhibit 99.1 | P0 |

来源：https://www.sec.gov/Archives/edgar/data/789019/000095017023034400/msft-ex99_1.htm （8-K，filed 2023-07-25，exhibit `msft-ex99_1.htm`，财报发布稿）
原文（`SEGMENT REVENUE AND OPERATING INCOME (In millions) (Unaudited)`，Three Months Ended June 30, 2023 / 2022）：
- `Productivity and Business Processes $18,291 $16,600`
- `Intelligent Cloud 23,993 20,804`
- `More Personal Computing 13,905 14,461`
- `Total $56,189 $51,865`
校验：`18,291 + 23,993 + 13,905 = 56,189 = Total`，精确吻合；对比数据集现值显然错配（IC/MPC 被压低、PBP 被抬高）。
注：10-K 的 R109 `Segment Revenue (Detail)` 为 12 个月全年口径（PBP 69,274 / IC 87,907 / MPC 54,734 / Total 211,915），与本期末单季口径不同，不能直接用作本期末真值；已据此选用 8-K 季度数。R109 原文存 `evidence/MSFT_2023-06-30_R109_segment_revenue.html` 供对照。
证据文件：`evidence/MSFT_2023-06-30_Q4FY23_earnings_8K_ex99_1.htm`、`evidence/MSFT_2023-06-30_evidence.txt`

---

## 三、005930.KS（三星电子，KRW-M）

**3.1 Q4 行存"年度累计"而非单季（结构性，P2/待确认）**
2021~2025 各 `12-31` 行在 `profit.json` 与 `segments.json` 中均为 **FY 全年累计**值（非单季）。例：2025-12-31 营收 230,995 KRW-M ≈ 当年前三季单季之和(≈170,009)的 1.36×，单季不可能达到；2022-12-31=239,836、2023-12-31=199,575、2024-12-31=204,012 同理。`profit.json` 中这些行 `periodType='annual'`，但 `segments.json` 的 `periodTypes` 却标 `quarter` → 季度序列每年出现约 4× 尖峰。属"年度值放进季度槽"的**口径/粒度不一致**，非单值错；无外部免费分部单季真值可证，标 **unconfirmed / P2**，建议统一样口径（要么按 annual 展示、要么拆出 Q4 单季）。R6 命中 2022–2025 共 4 条（2021-12-31 因缺前 3 季未命中）。

**3.2 DS 分部 2026 同比极端（P2/待确认）**
DS（Device Solutions）：Q1'26 = 53,580.49 vs Q1'25 = 17,022.32（3.15×）；Q2'26 = 82,210.73 vs Q2'25 = 20,588.53（3.99×）。同期总营收 Q1'26=87,797 vs 53,672（1.64×）、Q2'26=110,581 vs 55,025（2.01×）；DS 份额由 36.9%→61%→74%。分部经"内部抵销（推导）"精确加总=营收，内部自洽。**2026 为模拟未来期，无任何外部披露可核**，标 **unconfirmed / P2**（不能确认为真值，也不能据此判错）。

## 四、066570.KS（LG 电子，KRW-M）

**4.1 Q4 行存"年度累计"（结构性，P2/待确认）** — 同 005930：2022-12-31=66,235（≈前三季和 1.41×）、2023-12-31=63,404、2024-12-31=59,486、2025-12-31=61,765，均为 FY 累计放入 Q4 槽；segments 标 quarter、profit 标 annual 不一致。R6 命中 4 条。unconfirmed / P2。

**4.2 Others 分部 2023-03-31 同比 0.36×（P2/待确认）** — LG 分部门不含 LG Innotek，另有"合并调整（推导）"补齐；Others 小基数波动，LG 分部无免费明细源可证，标 unconfirmed / P2。

## 五、NTES（NetEase，P3/非错误）

R5 命中 NTES 2019-12-31 份额突变（Youdao 5.2%→2.2%、Innovative businesses 7.7%→15.5%）：实为**真实重分类**——2019 年 `Others`→`Innovative businesses and others`、新增 `Cloud Music`、`Youdao` 独立列示，2020 延续。属命名/口径演进，**非数据错误**，归 P3。注：NTES 分部值以 USD-$M、profit 营收以 CNY-M 存储，二者不可直接相除（故 R1 不触发）。

---

## 六、检测器覆盖与假阳性归类

`detect.mjs`（同目录，可重跑；输出见 `evidence/detect_run.log`）共命中 492 条：

| 规则 | 命中 | 定性 |
|---|---|---|
| R1 分部合计 vs 营收偏离>±8% | 0 | 无（构造上加总都对得上） |
| R2 同比<0.4×/>2.5× 且相邻正常 | 129 | 绝大多数为**真实业务变化或小基数噪声**：AMD Embedded 23.3×（收购 Xilinx）、PDD Merchandise 0.027×（业务模式转服务）、NVDA OEM 0.256×、DUOL/STM/V/PDD 的 Other 小基数项；中国公司多为"其他"这一汇集行的极小基数抖动。**非系统错数**，多数 unconfirmed。 |
| R2b 相邻包络单点离群 | 62 | 含 MSFT MPC、TSLA 两条（真错，已并入第二/一节）；其余多为波动/口径跳变。 |
| R5 份额结构断裂 | 3 | MSFT、TSLA（真错=P0，已证实）；NTES（真重分类=P3）。**精确命中率最高**。 |
| R6 年度值混入季度 | 8 | 全部为 005930/066570 的 Q4（见三/四节）。 |
| R3 名称新增/断裂 | 193 / 87 | A/H 股产品线/分部改名与"其他/其他主营业务"汇集行（如 688981 中芯、00700 腾讯、01398 工行、00981 中芯国际），**命名不一致（P3）**，非数值错误。 |
| R4 ≤0 值 | 10 | 600519/688256 的"其他=0"、03968.HK 金融市场业务负值（银行金融分部可负，属口径）——**合理，P2 噪声**。 |

归纳：**真正影响结论的错数只有 TSLA、MSFT（P0，已证实）**；R2/R3 的大量命中是"看起来跳但业务真实波动/改名"，报告不将其列为错数，仅作线索归档。

## 七、待确认清单（无免费源，未证实，不得据此改数）
1. 005930.KS 2021–2025 各 Q4 行 = FY 累计（口径缺陷，非单值错）。
2. 066570.KS 2022–2025 各 Q4 行 = FY 累计。
3. 005930.KS DS 2026Q1/Q2 同比 3.15×/3.99×（模拟未来期）。
4. 066570.KS Others 2023-03-31 同比 0.36×。

## 八、可证实修正清单
见 `fix-candidates.json`（仅 5 条，全部有 SEC 原文）：TSLA 2 条对调、MSFT 3 条重映射。
