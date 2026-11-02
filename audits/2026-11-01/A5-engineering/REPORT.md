# profitbridge 工程审计报告（A5：工程质量 / 可维护性 / 性能 / 仓库卫生）

交付路径：`profitbridge/audits/2026-11-01/A5-engineering/`（本报告、findings.json、metrics.json、evidence/）

- **审计日期**：2026-11-01（仓库 HEAD `32ee861`）
- **审计范围**：单页应用 `index.html` + `app.js`(1577 行) + `data/`(profit/segments/companies/logos) + `scripts/`(24) + `tests/`(15) + 构建/部署（`.github/workflows/static.yml`）与 Git 历史；只读，未改仓库任何文件、未 gc/prune、未 add/commit/push。
- **审计方法**：Node 统计文件大小与 gzip-9；自建 CDP harness（`tmp-audit/a5/measure.mjs`，headless Chrome 9365 + `scripts/serve.mjs 8449`，Performance.getMetrics / performance.timing / resource timing）；app.js 与 tests 逐行静态审阅 + grep 引用核对；`git ls-files` / `du -sh .git` / `git count-objects -vH` / 定向 secrets grep。
- **结论一句话**：**无 P0 阻断缺陷；1 条 P1（首屏无条件多下载 565KB 的 `data/profit.json.js` 镜像，生产 gzip 亦白耗 122KB/≈18%）；13 条 P2（渲染口径重复、测试固定端口、data/staging 与整仓部署、.git 16M 未 repack 等）与 9 条 P3 卫生项，均可最小改动修复。**

> 口径说明（重要）：项目**生产托管在 GitHub Pages**（`.github/workflows/static.yml`），GH Pages 的 CDN 默认对文本资源 gzip/brotli 压缩；而本地 `scripts/serve.mjs` **不压缩**。因此下文"首载 raw 3.15MB / 84 请求"是**本地 dev 上限口径**；生产实际线缆体积接近下表 gzip 列（约 660KB）。渲染/JS 本身不是瓶颈，瓶颈在"下载体积"。

---

## 量化总览（实测数字）

### 文件体积（字节 raw / gzip-9）

| 文件 | raw | gzip-9 | 说明 |
|---|---:|---:|---|
| index.html | 11,944 | 3,888 | 首屏外壳 |
| vendor/echarts.min.js | 1,030,855 | 333,290 | v5.6.0，Apache-2.0 |
| data/profit.json | 1,001,376 | 130,399 | 单体数据文件 |
| data/profit.json.js | 565,902 | 122,417 | **file:// 镜像，http 路径冗余** |
| data/segments.json | 568,664 | 50,447 | 瀑布图分段 |
| data/segments.json.js | 301,229 | 47,342 | file:// 镜像 |
| data/companies.json | 31,144 | 6,555 | |
| app.js | 89,763 | 29,215 | 1577 行 |

- **首载实际下发集合** raw = 3,299,648B（3.15MB）/ gzip = 676,211B（660KB）。
- **去掉冗余 `profit.json.js` 后** raw = 2,733,746B（2.61MB）/ gzip = 553,794B（541KB）。
- **echarts 单项占 gzip 后 60.2%**（333,290 / 553,794）——单一最大成本项。

### 实测首屏（localhost、无网络延迟、本地未压缩 = 上限口径）

| 指标 | 值 |
|---|---|
| FP / FCP | 48 ms |
| DOMContentLoaded / DOMInteractive | 116 ms |
| loadEventEnd | 117 ms |
| 桑基首绘就绪（navStart→`__sankeyMeta`） | 299.5 ms |
| ScriptDuration | 70.6 ms |
| TaskDuration | 257.5 ms |
| LayoutDuration | 55.6 ms |
| JSHeapUsed | 8.8 MB |
| LayoutObject / Node | 549 / 953 |
| 资源条目 / 请求 | 84 条（99 in metrics） |
| 其中 logo PNG | 77 张 / 171,184B |
| core 非 PNG 传输 | 3,289,504B |
| 总 transferSize | 3,460,990B（3.30MB） |

### 公司切换延迟（8 只样本，median）

- 桑基视图：**12.6 ms**（0–33.2ms）
- 柱状视图：**19.4 ms**（16.7–28.8ms）
- JSON.parse（994KB）：**1.8 ms**；fetch 本地 23.5 ms → **解析极廉价，非瓶颈**。

### 仓库

| 指标 | 值 |
|---|---|
| `du -sh .git` | 16M |
| `git count-objects -vH` | count 982 / size **12.85 MiB** / **packs 0**（从未 repack） |
| tracked 文件数 / commits | 160 / 114 |
| tracked 工作树合计 | 5,735,018B（5.5MB） |
| 其中 data/ | 3,807,393B（staging 1,127,789B + logos 211,289B(92张) + 数据） |
| 其中 vendor/ | 1,030,855B |
| docs/screenshots（4 张 PNG，已提交） | 396,929B |
| 历史最大 blob | echarts 1006.7KB + 约 13 份 profit.json（855–978KB each） |

---

## P0 — 阻断级

**无。** 未发现导致功能不可用、数据损坏、泄密或无法构建的缺陷。

---

## P1 — 高优先（1 条）

### A5-PERF-01 首屏无条件加载 `data/profit.json.js`（565KB 冗余）

- **证据**：`index.html:179` 有 `<script src="data/profit.json.js"></script>`（同步经典脚本，必然下载并解析）；但 `app.js:1536-1541` 的 `main()` 先 `fetch('data/profit.json')`，`res.ok` 即用，只有 file:// 才回退 `window.__PROFIT_DATA`。CDP resource timing 实测：`profit.json.js` transferSize = **566,202B**、`profit.json` = **1,001,676B**，**两者都下载**。生产 gzip 口径下该镜像仍白耗 **122,417B ≈ 18%** 首屏 gzip 预算。
- **影响**：每次页面加载、每个用户、http/https 环境下都多下 565KB（生产 gzip 122KB）+ 多一次解析。
- **最小改动**：删除静态 script 标签；在 `main()` 的 fetch 失败分支里（或 `location.protocol === 'file:'` 时）用 `document.createElement('script')` 动态注入 `data/profit.json.js` 再读 `window.__PROFIT_DATA`。**首屏 raw −566KB，生产 gzip −122KB。**

---

## P2 — 中优先（13 条）

### 性能

**A5-PERF-03 单体数据 + 77 张 logo 一次性加载**
- 证据：`data/profit.json` 单体 1,001,376B，但首屏只渲染当前公司（默认 NVDA）；实测首屏一次性请求 **77 张 logo PNG = 171,184B（77 请求）**，而 tracked logo 共 92 张/211,289B（`data/logos/`）。资源条目 84 条。
- 最小改动：logo 加 `loading="lazy"`（或只内联首屏 ~10 家）；`profit.json` 提供 slim 索引 + 按公司/按期加载。目标首屏 payload 从 3.3MB 降到 ~1MB 级。

### 可维护性

**A5-MAINT-01 "是否累计期"判断分散 8 处**
- 证据：`profitRowIsCumulative`(app.js:339)、`periodCoveredMonths`(:393)、`barPeriodLabel`(:402)、`barBasisInfo`(:419)、`barBasisTag`(:426)、`cumulativeView`(:443)、`fiscalCumulativeView`(:485)，以及 `renderBarChart` 内 `cumCur/cumPrev`(:1079-1080) 各自重算。
- 最小改动：抽出唯一权威 `isCumulative(tk,qv)`，所有展示层复用（必要时记忆化），杜绝口径漂移。

**A5-MAINT-02 金额/百分比格式化重复且精度不一**
- 证据：`"${dispSym()}${v.toFixed(1)}B"` 见 `nodeLabel`(:724-727)、`residualLabel`(:777)、`tooltip`(:816-817)、bar `fmtVal`(:995)；百分号精度 `fmtPct` 用 `toFixed(1)`(:154)，增长/占比用 `toFixed(2)`(:1039/:1054/:1073/:1084)。
- 最小改动：统一 `formatMoney(v,opts)` 与 `formatPct(v)`，全量替换调用点。

**A5-MAINT-03 ECharts option 近逐行重复**
- 证据：`chart.setOption({...})` 在 `app.js:808-836`，`window.__lastOption={...}` 在 `:837-848`，重复 `nodeWidth:30 / nodeGap:22 / left:hasAgg?210:170 / right:170 / top:sankeyTop / bottom:40 / label fontSize:15 / formatter:nodeLabel / rich / textBorderWidth:2.5`。
- 最小改动：构造一次 `sankeyOption(...)`，setOption 与 __lastOption 共用（导出只覆盖 `backgroundColor/animation`）。

**A5-MAINT-04 超长函数**
- 证据：`renderChart`(app.js:683-849 ~166 行，含嵌套 `nodeLabel`/`residualLabel`)、`renderBarChart`(:980-1208 ~228 行)、`buildGraph`(:565-655 ~90 行)。
- 最小改动：抽出 option 构造器与 label formatter，render* 仅负责取数与 setOption。

**A5-MAINT-06 全局污染（classic script 无封装）**
- 证据：仅 `app.js:6 'use strict'`，无 IIFE/模块；顶层 `let REGISTRY`(:76)/`lang`(:88)/`DATA`(:92)/`SEG`(:93)/`chart`(:94)/`state`(:124)/`hintTimer`(:1289) + 大量 function 声明进全局；9 处 `window.__*` 测试钩子(:684/:691/:698/:702/:837/:1205/:1207/:1339/:1569)。
- 最小改动：用 IIFE 或 `<script type="module">` 封装；测试钩子收敛到单一 `window.__bridge={...}`，生产构建剥离。

**A5-MAINT-07 错误处理缺失/静默**
- 证据：`main()` 三个 fetch 静默降级（profit :1540、segments :1557 注释 "optional"、companies :1561），失败无 UI 提示；`exportPNG`(:1488)/`exportSVG`(:1503) 无 try/catch，导出或数据形状异常会静默中断。
- 最小改动：fetch 失败在 UI 顶部提示；导出/渲染包 try/catch 并 toast 错误。

### 测试

**A5-TEST-01 固定端口 8440 + CDP 9341 冲突（并行冲突）**
- 证据：13 个浏览器测试均硬编码 `const BASE='http://127.0.0.1:8440'`（必须共享同一服务，无法并行/分片）；CDP `const PORT = 9341` 被 `verify_layout_refactor.mjs` 与 `verify_seg_axis.mjs` **两个文件重复占用**（其余 9333/9335/9336/9340/9342/9347/9349/9352/9356/9364/9388 各一）。
- 最小改动：BASE/PORT 改为环境变量（或起服务用临时端口 0），抽公共 harness；先修 9341 冲突。

**A5-TEST-02 关键控件未覆盖：SVG 导出、货币切换**
- 证据：`exportSVG()`/`btnExportSVG`(index.html:156, app.js:1503,:1518) **无任何 verify**（`verify_modes.mjs:112` 仅覆盖 PNG）；`btnCur` 货币切换(app.js:1529, index.html:158) **无测试点击**（测试只设 `state.curMode='native'`，未验 US$↔native）。语言仅 `verify_modes.mjs:119-125` 断言模式按钮文案，完整 i18n 未覆盖。深链/SPCX/preview 已覆盖（`verify_state_memory`、`verify_filter_jitter`、`verify_new`）。
- 最小改动：新增 `verify_export_svg`、`verify_currency_toggle`，并补 English 主要文案断言。

### 仓库卫生

**A5-HYG-01 `data/segments.json.bak`(565KB) 未被 ignore**
- 证据：`git status` 显示 `?? data/segments.json.bak`；`git check-ignore` 对其无输出——因 `.gitignore` 把 `/data/` 整体白名单，`.bak` 落在白名单内。一次 `git add data/` 即把 564,993B 备份入库。
- 最小改动：`.gitignore` 增加 `data/*.bak`（或全局 `*.bak`）并清理该文件。

**A5-HYG-02 `data/staging/` 中间产物被 tracked**
- 证据：`git ls-files data/staging` 命中 11 个文件（batch1-8、fixups、segments_2026q3、truncations），合计 **1,127,789B**。
- 最小改动：`data/staging/` 加入 .gitignore 并 `git rm --cached`（保留本地），仅保留最终 `profit.json/segments.json`。

**A5-HYG-03 `.git` 16M、packs=0 从未 repack**
- 证据：`du -sh .git`=16M；`git count-objects -vH`：count 982、size 12.85MiB、**in-pack 0 / packs 0**。历史含约 13 份 855–978KB 的 `data/profit.json` 大版本 + echarts 1006.7KB。
- 最小改动：经用户批准后执行一次 `git gc` / `git repack -adf` 可显著压缩；长期避免把生成物整文件反复提交（改增量/LFS）。**本次审计只读，未执行。**

**A5-HYG-06 部署上传整仓（`.github/workflows/static.yml:40` path '.'）**
- 证据：workflow `upload-pages-artifact` 用 `path: '.'` 上传**整个仓库**；于是公开站点含非运行期文件：`data/staging/` 1,127,789B、`docs/screenshots` 396,929B、`scripts/` 235,560B、`tests/` 144,109B，合计约 **1.90MB 被发布但 SPA 从不请求**；整个工件 5,735,018B(5.5MB)，运行时只用到少数文件。
- 最小改动：workflow 只上传运行期子集（先复制 `index.html/app.js/vendor/` 与 `data/{profit,segments,companies,logos}` 到 `dist/`，upload `dist/`），工件可从 5.5MB 降到 ~2.6MB，且不暴露 scripts/tests/staging。

---

## P3 — 低优先（9 条）

| ID | 类别 | 摘要 | 证据 | 最小改动 |
|---|---|---|---|---|
| A5-PERF-02 | perf | 本地 serve.mjs 不压缩，测量系统性高估 ~4.9× | `scripts/serve.mjs` 无 gzip/Content-Encoding；实测 transferSize==encodedBodySize==decodedBodySize；首载 raw 3,299,648B vs gzip 676,211B。**生产 GH Pages 已压缩**，故仅影响本地/测试口径 | serve.mjs 用内置 zlib 按 Accept-Encoding 压缩，使本地贴近生产 |
| A5-PERF-04 | perf | 渲染/JS 非瓶颈，无需虚拟化 | FP/FCP 48ms、ScriptDuration 70.6ms、切换 median 12.6/19.4ms | 优先做体积项（PERF-01/03），不做渲染优化 |
| A5-MAINT-05 | maintainability | 死代码 | `app.js:567 const B = MB, M = 1, ...` 的 `M` 无引用；I18N `reset:''`(:11 & :41) 无 `t('reset')` | 删除二者 |
| A5-MAINT-08 | maintainability | 魔法数字散落 | `MB=1e3`(:128)、`FLOW_OPACITY=0.55`(:260)、容差 `1.001`(:176/:604)、`0.005`(:672/:676/:678)、`0.01`(:677)、日窗 300-400/70-250(:249-250)、`100*864e5`(:1334)、`textBorderWidth:2.5` 重复 9 次 | 提为命名常量集中定义 |
| A5-TEST-03 | tests | 测试重叠、setup 重复、串行慢 | `verify_bar/basis/cum_growth/lines/modes/seg_axis` 各起 chrome + 依赖 :8440 | 抽共享启动/连接 helper 与 fixture |
| A5-HYG-04 | hygiene | 根目录物理残留 ~50 个 tmp-* 目录 + `tmp-serve-8440.log` | 均被 .gitignore 忽略、`git ls-files` 无命中（无入库风险），但占盘 | 加一次性清理脚本保持根目录干净 |
| A5-HYG-05 | hygiene | `audits/` 交付目录被 `.gitignore:2:/*` 根级忽略 | `git check-ignore audits/.../REPORT.md` 命中 `.gitignore:2:/*`，默认不入库 | 如需入库加 `!/audits/` 或对该目录 `git add -f` |
| A5-SEC-01 | security | 源码无密钥 | grep `api[_-]?key|secret|password|bearer|access_token` 覆盖 app.js/index.html/start.bat/README.md/scripts/*.mjs → **无命中**（仅 tmp-audit/**/.chrome 第三方扩展与 data/staging 审计日志噪声） | 保持；日后凭证走环境变量 |
| A5-LIC-01 | license | 第三方 echarts 许可证未声明 | `vendor/echarts.min.js` 内含 `version:"5.6.0"` 与 Apache-2.0 ASF 头；README.md:113 提 echarts 5.6，但 README.md:127-129 License 段仅写"代码 MIT"，未声明第三方 Apache-2.0；vendor/ 无独立 LICENSE/NOTICE | 补 `vendor/echarts.LICENSE`(Apache-2.0 全文) 与 NOTICE，README License 段注明第三方依赖 |

---

## 最小改动优先级建议（按性价比排序）

1. **A5-PERF-01**（一行删/动态注入）：首屏 raw −566KB、生产 gzip −122KB/≈18%，零风险，先做。
2. **A5-HYG-01 + HYG-02**（.gitignore + `git rm --cached`）：从历史/工作树剔除 565KB 备份与 1.1MB staging，避免误提交。
3. **A5-HYG-06**（workflow 只传 dist）：部署工件 5.5MB→~2.6MB，不暴露内部脚本/测试。
4. **A5-TEST-02 + TEST-01**（补 2 个 verify + 端口去冲突）：补住 SVG 导出/货币切换的盲区，恢复可并行。
5. **A5-MAINT-01/02**（抽 `isCumulative` / `formatMoney`/`formatPct`）：消除最易漂移的口径重复，改动局部。
6. **A5-HYG-03**（一次 `git gc`，需用户批准）：16M→可显著压缩。
7. 其余 P3 视排期处理（常量提取、死代码、license 声明、serve.mjs 压缩）。

---

## 证据索引（`evidence/`）

| 文件 | 内容 |
|---|---|
| `file-sizes.txt` | 各文件 raw / gzip-9 字节 |
| `git-state.txt` | `git ls-files` 全量 160 条 + staging 命中 + `git status --porcelain` |
| `repo-size.txt` | `du -sh .git`、`git count-objects -vH`、tracked 合计、历史 top15 blob |
| `perf.json` / `perf.stdout.json` / `perf-summary.json` | Performance.getMetrics / resource timing / 首屏与 logo 传输原文 |
| `coverage-probe.txt` | 测试端口分布（9341 冲突）、btnExportSVG/btnCur 引用、app.js 关键符号行号 |
| `secrets-scan.txt` | 源码 secrets grep 结果（无命中） |
| `harness.stderr.log` | 测量 harness 运行日志（空=无错误） |

> 备注：`A5-PERF-02` 与 `A5-HYG-06` 的结论基于 `scripts/serve.mjs` 与 `.github/workflows/static.yml` 的静态审阅 + resource timing 实测；GitHub Pages 的 CDN 压缩为平台既有行为，故本地未压缩测量为上限口径，已在正文显著标注。
