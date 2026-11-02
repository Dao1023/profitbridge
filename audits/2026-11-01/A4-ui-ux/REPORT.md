交付路径（最终）：`profitbridge/audits/2026-11-01/A4-ui-ux/`（本文件所在目录；全部截图在同目录 `shots/`，可独立打开）

# profitbridge 前端 UI/UX 与鲁棒性审计报告（A4）


- 审计日期：2026-11-01（+08:00）
- 审计范围：单页财报可视化前端（`index.html` + `app.js`）在真实浏览器中的交互、显示与导出正确性；覆盖 92 家公司、桑基/柱状两种视图、占比/环比、PNG/SVG 导出、English/US$ 切换、URL 深链、窄窗口自适应；不含 `data/` 数据真实性（见 A1/A2）。
- 审计方法：本机 `node scripts/serve.mjs 8448` 起服务，headless Chrome（`--headless=new`，CDP 端口 9364，`--user-data-dir=tmp-audit/a4/.chrome`，默认窗口 1680×1050，另用 CDP `Emulation.setDeviceMetricsOverride` 复测 1280×720 / 1024×768 / 900×700），通过 CDP `Runtime.evaluate` 驱动点击与取值、`Page.captureScreenshot` 截屏、`Page.addScriptToEvaluateOnNewDocument` 注入 `window.__errs/__cerr` 收集 error / unhandledrejection / console.error；导出文件通过改写 `HTMLAnchorElement.prototype.click` 与 `URL.revokeObjectURL` 捕获真实下载字节后另行打开核验。
- 结论（一句话）：功能整体可用、92 家公司全点一遍与全部切换/导出**控制台零报错**，但**导出文件与画面不一致（缺标题/公司/期间）**为 P1，另有英文漏翻、空状态提示溢出、密集标签粘连、窄屏时间轴下沉、深链仅首载生效等 4 项 P2 与 2 项 P3，**无 P0**。

---

## 一、前置假设核对（与任务描述不符之处，先说明）

1. **“只有 1 期数据的公司”不存在**：全库最少期的公司是 `SPCX`（2 期），其次 `CBRS` 4 期、`HUAWEI`/`LEGO`/`02513.HK` 各 7 期。因此“1 期数据公司”无法按原假设实测，只测了最少期公司（SPCX/CBRS）。
2. **“财务数据全空的公司”不存在**：92 家每家都有可用财务数据。
3. **“分部全空/无可用分部”确有 6 家**：`00992.HK`、`SPCX`、`CBRS`、`LEGO`、`02513.HK`、`00100.HK`（`degraded:true`，有原因文案），已逐一实测（见 A4-02）。
4. 分部合计与营收偏差 >0.02B 的仅 6 家（QCOM、GOOGL、600519.SS、000333.SZ、000100.SZ、600887.SS，均 ≤1.6B，属口径/四舍五入残差），属 A1/A2 数据范畴，本报告只记录、不计为 UI 缺陷。

## 二、分级发现汇总

| 编号 | 严重度 | 问题 | 截图 |
|---|---|---|---|
| A4-01 | **P1** | 导出 PNG/SVG 只有图形本体，缺标题/公司名/期间/元信息/时间轴，且无水印，与画面不一致 | `shots/export-bridge.png`、`shots/export-bridge.svg`、`shots/00-initial.png` |
| A4-02 | P2 | 分部不可用提示文本超出左侧留白、尾部压在节点色块上，中文“累计”被拆行（00992.HK / SPCX） | `shots/crop-00992-notice.png`、`shots/crop-SPCX-notice.png`、`shots/co-00992_HK.png`、`shots/co-SPCX.png` |
| A4-03 | P2 | 桑基成本分支标签密集粘连、几何包围盒重叠，且近零节点显示 `$0.0B`（TSLA） | `shots/co-TSLA.png`、`shots/crop-TSLA-right.png` |
| A4-04 | P2 | English 模式漏翻：公司显示名、中文分部名、degraded 原因仍为中文（600519.SS / LEGO / 00992.HK） | `shots/en-600519_SS.png`、`shots/en-LEGO.png`、`shots/en-00992_HK.png`、`shots/en-NVDA.png` |
| A4-05 | P2 | 窄屏 1280×720 / 1024×768 时间轴落在首屏之下、工具栏非吸顶；滚动看时间轴时标题/工具栏不可见 | `shots/narrow-fresh-1280x720.png`、`shots/narrow-fresh-1024x768.png`、`shots/narrow-fresh-900x700.png` |
| A4-06 | P2 | URL 深链只在首次加载生效；页面打开后修改 `location.hash` 不切换视图（无 hashchange 监听）；`#ind` 仅恢复单选首个行业 | `shots/deep-link-hashchange.png`、`shots/deep-link-fresh-TSLA.png` |
| A4-07 | P3 | 时间轴刻度只显示年份，点击某年跳到该年第一季度，粒度不明确 | `shots/tl-drag-30pct.png`、`shots/tl-tick-2015.png` |
| A4-08 | P3 | 近零金额显示 `$0.0B`（00992.HK「税费及其他」等），易被误读为 0 | `shots/co-00992_HK.png`、`shots/co-TSLA.png` |

**P0：无**（所有视图、公司、按钮、导出、切换均可用，无白屏/崩溃）。

## 三、逐条详情

### A4-01（P1）导出 PNG/SVG 缺失标题、公司、期间、元信息与时间轴

- 复现步骤：打开 NVDA 桑基视图 → 点工具栏「导出 PNG」→ 保存文件 → 打开；再点「导出 SVG」→ 保存 → 打开。导出即 `shots/export-bridge.png`（3200×1800，2× 于 1600×900）与 `shots/export-bridge.svg`（约 29KB）。
- 期望：导出的图片/矢量图应复现屏幕所见——顶部标题“英伟达 Q3 2026”、公司名、期间、右上角“数据更新/数据来源”元信息，以及底部时间轴（或至少有品牌/期间水印）。
- 实际：**只有 ECharts 图形本体**。`export-bridge.svg` 文本检索：含 `营收`×6、`Hyperscale`×1，**不含“英伟达/NVIDIA”**；PNG 顶部无标题、无公司、无期间、无时间轴。背景色经像素核验为 (242,239,233)=#f2efe9，**与画面一致（此项正常）**。
- 根因：标题是 HTML 的 `#chartTitle`，不在 ECharts option 里；`exportPNG()`（`app.js:1488-1502`）把 `window.__lastOption`（`app.js:837-848`，无 `title`）重绘到离屏 canvas，`exportSVG()`（`app.js:1503-1512`）用 `chart.renderToSVGString()`，两者都不带 HTML 头部/时间轴。文件名 `profit_bridge_NVDA_2026-07-26.png/.svg`（柱状图为 `bar_<item>_...`）。
- 影响：把图发给他人时无法辨识是哪家公司、哪一期、什么口径，属交付物正确性问题。

### A4-02（P2）分部不可用提示文本溢出、压节点、拆词

- 复现步骤：打开 `00992.HK`（2026-06-30 期）或 `SPCX` → 观察桑基左侧灰色提示块。
- 期望：提示文本完全落在左侧留白内、可读、不遮挡节点色块。
- 实际：提示第二行起超出 176px 留白，尾部字符压到深色节点条/红色节点上；中文“累计”被拆成“累/计”两行，英文 `quarterly view unavailable.` 越界落到色块上。见 `shots/crop-00992-notice.png`、`shots/crop-SPCX-notice.png`。
- 根因：`segmentNoticeGraphic()`（`app.js:289-312`）用单个 ECharts `graphic.type:'text'`，`style.width:176, overflow:'break'`，`text = title + '\n' + hint`；degraded 公司的 `reason` 是长句/双语（如 00992.HK 的 `"该期仅有年度分部数据（FY 累计），季度视图不可用。/ Annual-only segment data; quarterly view unavailable."`），在 176px 内换行后实际宽度仍溢出留白。
- 影响：6 家无分部公司里有 2 家的空状态说明读不全。

### A4-03（P2）TSLA 桑基成本分支标签密集粘连 + `$0.0B`

- 复现步骤：点 `TSLA`（2026-06-30 期，桑基视图）→ 看右侧成本分支标签。
- 期望：各节点标签互不重叠、清晰可读；近乎为 0 的节点用 `<0.1B` 或省略。
- 实际：`非经营性收益 $0.7B` / `研发费用 $2.4B` / `营业利润 $4.8B` / `销售与管理费用 $2.0B` / `营业费用 $0.0B` 在约 120px 高度内挤作一团，行距约 20px 视觉粘连；自动几何检测在该视图检出 2 处文本包围盒重叠（`$0.4B`↔`销售与管理费用` 396px²，`研发费用`↔`$0.7B` 96px²，不同期/状态截图）。见 `shots/crop-TSLA-right.png`。
- 影响：关键成本分支名称/金额难以对应，误导阅读。

### A4-04（P2）English 模式数据层文案未翻译

- 复现步骤：点 `#btnLang` 切 English → 打开 `600519.SS`、`LEGO`、`00992.HK`。
- 期望：英文界面下公司名、分部名、空状态原因也应为英文（至少英文主文案）。
- 实际：
  - **600519.SS 标题仍为中文**：`贵州茅台 Q2 2026 · H1 2026 cumulative`，meta 前缀 `贵州茅台 ·`，桑基节点名 `茅台酒 / 其他系列酒 / 其他` 仍中文（节点数据：`{"name":"茅台酒","value":77.7245}` 等）。见 `shots/en-600519_SS.png`。
  - **LEGO** 空状态提示：标题英文、hint 仍中文 `"乐高集团年报仅披露集团整体与极少地区粒度，无产品/业务分部"`（`shots/en-LEGO.png`）。
  - **00992.HK** 空状态 hint 仍含中文（`shots/en-00992_HK.png`）。
  - 对照：工具栏、标题模板、meta 标签、时间轴刻度均已翻译（`shots/en-NVDA.png` 全英文，按钮变“中文”）。
- 根因：`c.name` 与 segments 的分部名、以及 `degraded.reason` 都来自数据层，`render()` 只按 `lang` 翻译 UI 字符串（`I18N`，`app.js:8-69`），数据层中文字段未提供英文字段/映射。
- 影响：英文用户看到中英混杂标题与节点名，专业性受损。

### A4-05（P2）窄窗口时间轴下沉、工具栏非吸顶

- 复现步骤：用 CDP 视口 1280×720、1024×768、900×700 打开 NVDA（在导航前设置视口，确保图表按该宽度初始化）。
- 期望：时间轴与工具栏在首屏可见，或滚动时工具栏/标题吸顶。
- 实际：`#sankey` 固定高 660px + 头部 ⇒ 文档高 936px（1280×720）/975px（1024×768）/1822px（900×700 列式布局），**时间轴 y≈841/880/1727，均在首屏之下**；滚到时间轴时标题/工具栏滚出视野（非 sticky）。**横向无滚动条**（docWidth 1265/1009/885 ≤ 视口），标签在按该宽度正确初始化时无裁剪（此点正常，见下“已核实修复”）。
- 截图：`shots/narrow-fresh-1280x720.png`、`shots/narrow-fresh-1024x768.png`、`shots/narrow-fresh-900x700.png`。
- 影响：笔记本 720/768 高度下用户看不到期序列滑块，需盲滚。

### A4-06（P2）深链仅首载生效；页内 hashchange 无效；ind 单选

- 复现步骤：打开页面后执行 `location.hash='c=TSLA&q=2026-06-30&v=bar&m=net'`，再读取标题。
- 期望：视图切换到特斯拉柱状净利润。
- 实际：标题仍 `英伟达 Q3 2026`、仍为桑基（`shots/deep-link-hashchange.png`）。而**全新加载**同一 hash 能正确复现：`特斯拉 · 净利润 · 全历史季度`、`barActive:true`、`item:net`（`shots/deep-link-fresh-TSLA.png`）。`#c=AAPL&q=2026-03-31&v=bridge&ind=semi` 新载可复现（哈希规范化为 `#c=AAPL&q=2026-03-28&ind=semi`）。
- 根因：`applyHash()`（`app.js:1318-1344`）只在启动时（`app.js:1573`）调用一次；没有 `hashchange` 监听；`syncHash()` 用 `history.replaceState`（`app.js:1316`）。`#ind` 只取 `ind.split(',')[0]`（`app.js:1343`），多选行业无法还原。
- 影响：在同一标签页粘贴/修改深链不生效，需手动刷新；多行业筛选共享链接丢失。

### A4-07（P3）时间轴刻度仅年份、点击年=该年 Q1

- 复现：拖时间轴到 30% → 标题“英伟达 Q2 2015”、thumb/fill 29.6875%（=19/64）、激活刻度“2015 / 2015-04-26”，同步正确；点击刻度“2015” → 跳到 2015-04-26（该年首个季度）。见 `shots/tl-drag-30pct.png`、`shots/tl-tick-2015.png`。
- 期望：刻度能表达季度粒度（如 2015Q1），点击定位可预期。
- 实际：刻度只写“2015”，用户不知点击会落到该年哪个季度。
- 根因：`renderTimeline()`（`app.js:1356-1383`）按年去重只渲染年份 `yearOf`，激活态才附完整日期；刻度 `data-i` 指向该年第一个季度索引。

### A4-08（P3）近零金额显示 `$0.0B`

- 复现：`00992.HK` 桑基右侧“税费及其他 $0.0B”；`TSLA` “营业费用 $0.0B”。
- 期望：用 `<0.1B` 或“—”表示非零极小值，避免误读为 0。
- 实际：tooltip/节点标签统一 `value.toFixed(1)`（`app.js:811-818`），极小值被四舍五入成 `$0.0B`。

## 四、已核实的历史修复（回归通过）

1. **布局抖动**：`.meta`/`.barBasisNote` 绝对定位、logo `aspect-ratio`——切换公司时未见工具栏/侧栏重排抖动（多张 `co-*.png` 对比）。
2. **面板 checkbox 被 `.side input{width:100%}` 误伤**：源码已无该规则；侧栏为按钮式筛选，未见 checkbox 被拉宽。
3. **时间轴滑块拖不动/数值振荡**：`initTimelineDrag()`（`app.js:1400-1433`）pointer capture + 像素比例定位实测正常，拖动单调、无振荡、与图表/标题同步（A4-07 截图）。

## 五、通过项与限制

- **通过**：两种视图切换；92/92 家公司逐一点击（每家有非空标题、`window.__errs=0`、`__cerr=0`）；占比/环比；柱状图例与系列名一致（`Gaming` / `净利润` 含“占营收%”与“QoQ%”）；tooltip 单位正确（NVDA `$48.7B`；HUAWEI `¥375.0B` → US$ `$56.2B`，880.941→131.928，比值 0.14976≈6.68 CNY/USD）；US$ 切换数值/符号正确；导出背景色 #f2efe9 正确；状态残留（柱状分部项切到无该分部的公司会自动回落到 `revenue`，无残留）；公司切换缺期有 toast 提示。
- **限制**：①“1 期数据公司”无样本（见前置核对）；②控制台错误收集依赖注入钩子，仅覆盖页面脚本层，不含浏览器扩展；③窄屏标签裁剪在纯 CDP 改视口时会出现“图表未 resize 的假象”，本报告以导航前设定视口的 fresh load 为准，**不将标签裁剪列为缺陷**（应用 `resize` 监听 `app.js:1574` 生效）。

## 六、附件清单

- `findings.json`：机读发现（8 条，含 angle/area/symptom/steps/screenshot/expected/actual/severity/consoleErrors/status）。
- `shots/`：全部截图与导出样本（可独立打开）；关键：`export-bridge.png/.svg`、`co-*.png`、`crop-*-notice.png`、`crop-TSLA-right.png`、`en-*.png`、`narrow-fresh-*.png`、`deep-link-*.png`、`tl-*.png`。
- `evidence/full_sweep.json`：92 家公司逐一点击的标题/nodeCount/segSum/rev 与错误计数。
- `evidence/sweep.json`：18 家代表性公司（含各行业/港A欧/最少期/无分部）的截图期次与节点统计。
- `checklist.md`：逐项实测清单与结论。
