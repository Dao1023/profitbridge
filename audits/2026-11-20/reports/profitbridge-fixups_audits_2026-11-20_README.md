> 来源：profitbridge-fixups/audits/2026-11-20/README.md（2026-11-20 归档）

# 口径复核 · 2026-11-20（KNOWN_CAVEATS 全量复算）

基线 `47d8df0`（main）· 分支 `docs/caveats-fix` · 复核对象：`docs/KNOWN_CAVEATS.md` 全文 + 调研报告 `tmp-research-backlog/REPORT.md` 第 3 节的 9 条候选

边界：只读 `data/` 复核；只改 `docs/**`、`audits/**`、`tmp-doc/**`；未改 app.js / data / scripts / tests；未 push。

## 0. 结论

调研报告的 9 条候选里，**真数据错只有 2 条：NESN.SW、MC.PA**，已由数据管线于 2026-11-20 修复（`61d347d`，merge `e76d51a`），本次只做文档收尾与归档。文档层另有 **3 处错误/不准确**：

| # | 条目 | 性质 | 处置 |
| --- | --- | --- | --- |
| 1 | 00992.HK 4.07× | **文档测量错误**（拿全年分部比 Q4 单季） | 第三节原地改写，保留历史说明 |
| 2 | BILI 分部残差 | **旧误报**（20/20 期为 0） | 从第二节移入第五节 |
| 3 | STM「系统性负残差」 | **描述方向错**（实测 10 负 / 25 正） | 第二节改为「双向残差」 |

其余 JD / NTES / ARM / ASML / 00981 的记载复算一致（00981 差分侧仅部分可复算，见 §6）。

## 1. 复算方法与命令

```bash
cd profitbridge-doc
node tmp-doc/verify_caveats.mjs          # 全量复算，末行 SUMMARY ALL PASS
node tests/verify_units_guard.mjs        # 单位守卫回归，末行 SUMMARY ALL PASS
```

- 脚本只读 `data/segments.json` 与 `data/profit.json`，不写任何文件。
- 残差口径：`residual = 营业利润 − (毛利 − 研发 − 销售管理)`，与文档一致（负值 = 三项反推高于实际营业利润）。
- 营收匹配复用 `tests/verify_units_guard.mjs` 的 `matchRev()`：年度分部对「最近 4 个单季营收之和 × 该期 fx」，季度对单季行。
- `tests/verify_units_guard.mjs` 覆盖 00992 四期，全部 `PASS`、`ratio=1.00000/1.00000/1.00000/0.99999`，`SUMMARY ALL PASS`。

## 2. 00992.HK —— 文档错误（非数据错）

| end | 分部合计 | 年内 4 季营收之和 | ratio | 误比 Q4 单季 | 误比 |
| --- | --- | --- | --- | --- | --- |
| 2023-03-31 | 61,946.854 | 61,947（16,956+17,090+15,267+12,634） | **1.00000** | 12,634 | 4.90× |
| 2024-03-31 | 56,863.784 | 56,864（12,900+14,410+15,721+13,833） | **1.00000** | 13,833 | 4.11× |
| 2025-03-31 | 69,076.968 | 69,077（15,447+17,850+18,796+16,984） | **1.00000** | 16,984 | 4.07× |
| 2026-03-31 | 83,074.555 | 83,075（18,830+20,452+22,204+21,589） | **0.99999** | 21,589 | 3.85× |

- `profit.json` 的 00992.HK 只有 **18 行单季**（`q1:5 q2:5 q3:4 q4:4`），**没有 annual / cumulative 行**；年度分部在 `segments.json` 的 `annualQuarters`。调研报告称「同一 end 存 annual + Q4 双行」与当前数据不符（疑似把 segments 的年度行与 profit 的单季行当成同表），但结论不变。
- 前端 `fiscalCumulativeView()` 位于 **app.js:514**（文档原引 515），且确实做了累计视图处理；原条目「不做累计→单季校正」的断言不成立。
- 处置：第三节原地改写并加「2026-11-20 复核修正」历史说明；第五节登记；旧数字只在修订说明里保留，不再作为结论。

## 3. NESN.SW / MC.PA —— 真数据错，已修复

| 公司 | 期 | 修复前 ratio | 修复后 ratio | 修复后 segSum / rev×fx |
| --- | --- | --- | --- | --- |
| NESN.SW | 2023-12-31 | 1.2278 | **0.99622** | 110,974.5 / 111,396.1（rev 93,351.3 CHF-M × 1.1933） |
| NESN.SW | 2024-12-31 | 1.3271 | **0.99601** | 100,836.5 / 101,240.9（91,720.3 × 1.1038） |
| NESN.SW | 2025-12-31 | 1.1607 | **0.99561** | 112,891.6 / 113,389.7（89,884.8 × 1.2615） |
| MC.PA | 2022-12-31 | 1.1780 | **1.00000** | 84,457.6 / 84,457.3（79,183.7 EUR-M × 1.0666） |
| MC.PA | 2023-12-31 | 1.1371 | **1.00000** | 95,199.1 / 95,199.1（86,153.0 × 1.105） |
| MC.PA | 2024-12-31 | 1.2094 | **1.00000** | 87,977.2 / 87,977.0（84,682.8 × 1.0389） |
| MC.PA | 2025-12-31 | 1.0693 | **1.00000** | 94,948.2 / 94,948.7（80,807.4 × 1.175） |

- 根因（修复 commit `61d347d` 说明）：D2 staging 的 `value` 已是 USD（native × 2025 快照 fx），`c20be5d` 又乘了一次快照 fx（NESN 1.21274155、MC 1.12091287）→ **双重换算**；修复改为按 native × 各期利润表 `fxToUsd` 重算并更新 `currencyNote`。
- NESN 修复后残留 −0.38% ~ −0.44%，与利润表分项四舍五入/分部汇总差同量级；MC 逐位相等。
- **旧文档「同币种仅差 −0.4% / 0.0%」是测量假象**：109,007 = 89,884.8 × 1.21274、90,578 = 80,807.4 × 1.12091，两侧被同一条错误 fx 同乘，比值自然≈1，掩盖了双重换算。

## 4. BILI —— 旧误报

- 20 个全字段期，`gross − rd − sga − opInc` 全部为 0，最大绝对残差 **0.0000**。
- 样本 2026-06-30：2,954.956 − 1,008.646 − 1,573.44 = **372.870** = `opInc` 372.87。
- 判定：旧标记为误报，非口径差异；已从第二节表格移除，移入第五节。

## 5. 其余条目

| 条目 | 文档断言 | 实测 | 判定 |
| --- | --- | --- | --- |
| JD | 2025 +6.40%、2022/23/24 +4.87/+4.97/+5.10% | 198,951.4 / 186,989.7 = +6.40%；其余同 | 一致 |
| NTES | 季度全平、年度缺 sga、2025 差 18,847.9、netEq −2,650 | 15/15 季度平，18/18 年度不平；2025：72,401.9−17,719.1−35,834.9=18,847.9；2026-06-30 netEq −2,650.0 | 一致 |
| ARM | 2022-03-31 −47（−1.83%），其余 −0.2%~−0.3% | −47.0（−1.83%）；其余 −0.17%~−0.27%，季度行 0 | 一致（区间微调为 −0.17~−0.27） |
| ASML | +80.9/+213.7、2013/2017 +2.4~3.0%、近年 0 | 64.3/80.9/95.8/213.7（2.95/3.12/2.38/2.18%）；2024 起全部 0；2007/2015/2016 rd=null | 一致 |
| STM | 系统性负残差、中位 2.65%、−148、−1,285 | 中位 2.65%、−148（−3.70%）、−1,285（−46.17%）均对；但 35 期 **10 负 / 25 正**，无系统性方向 | 数字一致，方向性描述已改「双向」 |
| 00981.HK | 站内 5,111.85/3,589.93 vs 差分 5,126.00/3,611.35；20 个 q3 行 | 站内值与 `profit.json` 一致；差分侧来自 MAIN 累计差分（主仓 `tmp-verify-20261113/REPORT.md` §5），本仓无法复算；q3 实际 **21 行**（2026-09-30 新增） | 部分可复算，已加注 |
| 补充清单 | MSI 5.7/最差 −211%、HPQ 4.7、AVGO 11.2、AMD 5.4、NXPI 7.0、SONY 18.8 | 5.69%（最差 −210.73%）、4.69、11.21、5.33、**6.56**、18.80 | NXPI 7.0→6.6、AMD 5.4→5.3，其余一致 |

## 6. 未决 / 待确认（本次未改）

1. **00981.HK 差分侧不可站内复算**：本仓无 9M 累计行，`gross/opInc` 的「差分」值只能引用主仓 MAIN 原始报表；文档已注明来源并保留原记录。
2. **README.md:60 已过时**：仍写「NESN / LVMH 分部以本位币存储、前端按 USD 折算，图上假差 11–18%」。真因是双重换算且已修复；README 不在本次允许改动范围（只允许 docs/audits/tmp-doc），留给文档 owner 后续处理。
3. **STM 逐期外部解释未取证**：重组/减值明细未逐期对原始财报，本次只按数据符号分布修正「系统性」表述，不新增因果断言。
4. **00992 无 annual 行**：与调研报告「同 end 双行」描述不符，已按当前数据落笔，差异记录于 §2。

## 7. 归档清单

| 文件 | 说明 | 是否入库 |
| --- | --- | --- |
| `docs/KNOWN_CAVEATS.md` | 三处改写 + 新增第五节 + 修订记录 | 是 |
| `audits/2026-11-20/README.md` | 本记录 | 是 |
| `tmp-doc/verify_caveats.mjs` | 复算脚本（只读 data/） | 否（`.gitignore` 忽略根目录 `/*` 白名单外的 tmp-doc） |
| `tmp-doc/REPORT.md` | 本次工作报告 | 否（同上） |

## 8. 追加：ECharts 版本实测定案（5.5.1）与同源错误清单

背景：`vendor/echarts.min.js` 被仓库多处记为 5.6.0，实测为 5.5.1。2026-11-20 在 worktree `docs/audit-echarts-fix`（基线 `c02adb4`）实测并订正审计文档；只改 `audits/**` 与 `tmp-audfix/**`。

### 8.1 实测结论

| 检查 | 结果 | 命令 / 证据 |
|---|---|---|
| 运行时自报版本 | **5.5.1** | `node -e "require('./vendor/echarts.min.js').version"` → `5.5.1` |
| bundle 内 ECharts 版本赋值 | `t.version="5.5.1"`，唯一 1 处 | `grep -o '5\.5\.1' vendor/echarts.min.js \| wc -l` → 1 |
| `version:"5.6.0"` 归属 | 随包 **zrender**：`t.zrender.version=5.6.0`、`t.dependencies={zrender:"5.6.0"}` | `grep -o '.\{60\}5\.6\.0.\{60\}'` → 2 处，均非 `t.version=` |
| 5.6.0 特征 matrix 坐标系 | 不存在（旁证 bundle 非 5.6.0） | `grep -c 'coordinateSystem:"matrix"'` → 0 |

### 8.2 同源错误记录清单

| # | 位置 | 原文 | 性质 | 处置 |
|---|---|---|---|---|
| 1 | `app.js:3` | `Sankey rendered with the ECharts (v5.6.0)` | ECharts 版本声明（错） | **未改**（app.js 由另一 Agent 在改），登记待改 |
| 2 | commit `26db8a2` 提交信息 | `... rewrite profit bridge sankey with echarts 5.6 ...` | 历史提交信息（错） | **不改写历史**，仅登记 |
| 3 | `audits/2026-11-01/A5-engineering/findings.json`（A5-LIC-01 evidence） | `version:"5.6.0"` | ECharts 版本声明（错） | **已订正**：原文保留，新增 `correction` 字段（date/basis/see） |
| 4 | `audits/2026-11-01/A5-engineering/metrics.json`（file_sizes_bytes） | `"version": "5.6.0"` | ECharts 版本声明（错） | **已订正**：`version` 改 `5.5.1`，原值存入 `version_original_recorded`，另有 `version_correction` |
| 5 | `audits/2026-11-01/A5-engineering/REPORT.md:21,164` | `v5.6.0` / `version:"5.6.0"` | ECharts 版本声明（错） | **已订正**：原地加订正标注 + 文末「版本订正」小节 |
| 6 | `README.md:117,127` | `5.5.1` + 版本注记 | 正确记录 | 已由 `4b9ef41` 修正，本次不动（docs 不属本 worktree 范围） |

### 8.3 扫描口径

- 脚本 `tmp-audfix/scan-versions.js`（未入库，`.gitignore` 根级白名单不含 tmp-*），扫描 254 个文本文件，排除 `vendor/`、`node_modules/`、`tmp-*`、`.git`。
- `5.6.0` 命中 6 行：`app.js:3`、`A5-engineering/findings.json:248`、`A5-engineering/metrics.json:21`、`A5-engineering/REPORT.md:21`、`A5-engineering/REPORT.md:164`、`README.md:127`（该处本身是正确注记）。
- `5.5.1` 命中 2 行：`README.md:117`、`README.md:127`（均为正确记录）。
- `vendor/echarts.min.js` 内 `5.6.0` 2 处、`5.5.1` 1 处（按任务口径排除在清单外，只作为判定依据）。

### 8.4 未决

1. `app.js:3` 注释仍写 v5.6.0，需前端 owner 改为 5.5.1（本 worktree 严禁改 app.js）。
2. `26db8a2` 提交信息保持原样（不改写历史、不 rebase/amend）。
3. `audits/2026-11-01/SUMMARY.md:65` 只写「echarts Apache-2.0 未声明」，未带版本号，无需订正。

## 9. 追加：A5-LIC-01 许可实质项已闭合（2026-11-20）

`audits/2026-11-01/A5-engineering/findings.json` 的 A5-LIC-01 指出：`vendor/echarts.min.js` 以 Apache-2.0 随包分发，但 `vendor/` 下无 LICENSE / NOTICE，README 的 License 段只写「代码 MIT」，未声明第三方组件（Apache-2.0 §4(a) 附许可副本、§4(c) 保留 NOTICE）。本次在 worktree `chore/license-notice`（基线 `5628f48`）补齐：

| 新增文件 | 内容 | 字节 | sha256 |
| --- | --- | --- | --- |
| `vendor/echarts.LICENSE.txt` | Apache-2.0 全文，逐字取自 `https://www.apache.org/licenses/LICENSE-2.0.txt`，未改写未截断 | 11,358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `vendor/NOTICE` | ECharts 5.5.1 / Apache-2.0 / 版权行 / `Unmodified`；随包 ZRender 5.6.0（BSD-3-Clause，附全文）、d3.js 派生代码（BSD-3-Clause，指向 `vendor/licenses/`）、tslib（0BSD） | 9,312 | `97387a333af617ea55f038d84f0d1a7707d08129530d09ca2a83dd519eb3f49e` |
| `vendor/licenses/LICENSE-d3.txt` | d3.js BSD-3-Clause 全文（`Copyright 2010-2016 Mike Bostock`），逐字取自 ECharts 5.5.1 随包 `licenses/LICENSE-d3` | 1,475 | `e1211892da0b0e0585b7aebe8f98c1274fba15bafe47fa1f4ee8a7a502c06304` |

其它改动：`README.md` 末尾追加「第三方许可 / Third-party licenses」一节（只追加，既有内容未动）。

**判定**：

- §4(a) 许可副本：`vendor/echarts.LICENSE.txt` 提供；校验首行 `Apache License`（首个非空行）、末行 `limitations under the License.`，与官方文件同源同字节。
- §4(b) 标注修改：`vendor/NOTICE` 明确写 `Unmodified`。
- §4(c) 保留声明：`vendor/NOTICE` 逐字引用文件头原始 ASF 声明，并记录上游 5.5.1 NOTICE 的版权行 `Copyright 2017-2024 The Apache Software Foundation`。
- 版本口径沿用第 8 节实测 **5.5.1**，未把随包 zrender 的 `version:"5.6.0"` 误记为 ECharts 版本。

附带发现（不影响本项闭合）：bundle 内 ZRender 为 BSD-3-Clause、tslib 为 0BSD，已在 `vendor/NOTICE` 一并声明。

BSD-3 补强（2026-11-20 追加）：ECharts 官方 LICENSE 附录所称 d3.js 派生代码（treemap / tree / force / number，BSD-3-Clause）此前只登记为待确认，现已随附 `vendor/licenses/LICENSE-d3.txt` 并在 `vendor/NOTICE` §2.2 声明。文本取自 ECharts 5.5.1 随包 `licenses/LICENSE-d3`（`Copyright 2010-2016 Mike Bostock`）；未采用 d3/d3 仓库现行 LICENSE，因其为 ISC 许可（`Copyright 2010-2023 Mike Bostock`），与上游对这段 v3 时代派生代码的 BSD-3 声明不一致。

引入提交：`7c7afb4`（分支 `chore/license-notice`，2026-11-20，4 files changed / +406）；本行 sha 由紧随其后的补记提交补入；d3 声明由同一分支的后续提交补齐（`git log --oneline -- vendor/licenses`）。

sha256 口径：按仓库内 blob（LF 行尾）计算，命令 `git cat-file -p :vendor/NOTICE | sha256sum`；工作区在 `core.autocrlf=true` 下检出为 CRLF，直接对工作区文件求 sha256 会因行尾不同而得到不同值。
