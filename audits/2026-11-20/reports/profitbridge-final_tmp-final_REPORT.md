> 来源：profitbridge-final/tmp-final/REPORT.md（2026-11-20 归档）

# profitbridge UI 收尾修复报告（fix/ui-polish2）

- 仓库/工作树：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-final`
- 分支：`fix/ui-polish2`，基于 `c02adb4`
- HEAD：`3c1aca7`（4 个提交，见文末）
- 未 push / 未 rebase；`git diff c02adb4..HEAD` 仅含 `app.js` 与 4 个测试文件，未触碰 `data/`。

## 0. 先纠正两个前提（重要）

1. **`data/segments.json` 的 `notes` 现在是数组，不是对象**：201 条 `"TICKER: 文本"` 形式，顶层备注命中的是 15 个 ticker（NVDA/HUAWEI/BIDU/XNET/00981.HK/D1/005930.KS/MC.PA/03968.HK/066570.KS/000660.KS/C1/00941.HK/BABA/00151.HK），公司级 `SEG.companies[*].notes` 只有 `00992.HK` 一条。所以「notes 永远不渲染」在 c02adb4 上并**不复现**（基线实测渲染 14 个 ticker）。真正的缺口只是 `segNotesFor()` 只认数组：对象形态会被整段丢弃。本次按需求把三种形态（string / array / object）都做了兼容，并用注入对象形态做了前后对比（见 §2）。
2. **`data/` 在 git 里是 CRLF 工作区文件（core.autocrlf）**，规范化后与 `c02adb4` blob 完全一致；`app.js` 同理。基线对比不能在主仓库工作区跑（主仓库工作区的 `data/*.json` 内容与 `c02adb4` 不同，会带出 16px 版面偏移的假 diff）。因此基线站 `tmp-final/base-site/` = `git show c02adb4:app.js`（sha256 `f3b5ae67…`）+ 工作树同一份 `data/`、`vendor/`、`index.html`，跑在 8800；改动站是工作树 8799。两侧数据、vendor 完全同源，diff 只反映 app.js。

## 1) 分部不可用提示框压到「营收」列

**落点**：`app.js:342` `segmentNoticeGraphic(plan)`，文本样式在 `app.js:372`。

**改法**
- `overflow: 'break'` → `'breakAll'`：英文无空格长词（`segment`）按字符断行。
- 宽度不再写死 176，而是跟 Sankey 输入带对齐：
  ```js
  const segList = p.segList;
  const hasAgg = !!(segList && segList.some(s => s.children && s.children.length));
  const padLeft = hasAgg ? 210 : 170;   // 与下方 sankey series 的 left 一致
  const width = Math.min(176, padLeft - 16 - 8);
  ```
  文本从 `left:16` 起排，留 8px 右边距：无聚合列时 146，有聚合列时仍是 176（不改变原布局）。聚合判断需要 plan 内部数据，故函数开头统一取 `const p = plan || sankeySegPlan(state.company, q())`，`st = p.status`。

**验证数据**（CDP 读 text graphic 每行 bbox；营收列左边界 `revLeft = 170`，即 Sankey 节点左沿）

| 公司 | reason 长度 | 宽度档 | 基线 rightEdge / styleW / overflow | 修复后 rightEdge / styleW / overflow | 结果 |
|---|---|---|---|---|---|
| AVGO | 33 | 1280/1440/1600 | 189 / 176 / break | 159.1 / 146 / breakAll | 越界 −10.9px |
| CRWV | 278 | 1280/1440/1600 | 191.8 / 176 / break | 161.9 / 146 / breakAll | 越界 −8.1px |
| 000660.KS | 384 | 1280/1440/1600 | 191.7 / 176 / break | 161.9 / 146 / breakAll | 越界 −8.1px |

- 三档宽度几何值一致（图表区宽度已封顶），三家公司 × 三档 = 9 组全部不再越过 170。
- 长文本可读性：000660.KS 384 字符排 18 行，top 152.8 / bottom 488.3，`canvasH 641`，完整不裁切；CRWV 13 行 bottom 450.3（canvasH 660）；AVGO 3 行。
- 中文提示（如 600887）也因为宽度 146 重新折行，仍在同一空白输入带内（diff 仅限 x 195–363 的提示文字区域），属于同一改动的预期外显。
- 新增测试 `tests/verify_seg_notice.mjs`：3 公司 × 3 宽度，逐行断言 `rightEdge < series.left`、`styleW === min(176, revLeft-16-8)`、`overflow === 'breakAll'`、全文（去空白）都渲染、`bottom <= canvasH`；并断言有分部的 NVDA 不产生提示 graphic。**57/57 通过，最差越界 −8.1px**。基线代码跑同一测试无法满足（基线 rightEdge 189/191.8）。

## 2) `SEG.notes` 对象形态兼容

**落点**：`app.js:1839 segNoteStrings(v)`、`app.js:1851 segNoteBucket(tk)`、`app.js:1860 segNotesFor(tk)`（调用点 `app.js:1936` 渲染逻辑未动，位置/样式/CSS 行数保持不变）。

**改法**
- `segNoteStrings` 统一 string / array / object 三种形态（object → `Object.values` 递归）。
- `segNoteBucket(tk)`：
  - 顶层是 string/array → 按原逻辑当作 `"TICKER: 文本"` 行池，`scoped:false`；
  - 顶层是对象且**键名等于 ticker**（大小写不敏感）→ 只取该 ticker 的值，`scoped:true`；
  - 对象但键是数字/行号 → 仍按行池处理，`scoped:false`。
- `segNotesFor` 保留原有前缀过滤与去重；`scoped:true` 时裸文本（无 `TICKER:` 前缀）也接受，避免「only 2 quarters…」这类对象值被前缀规则吞掉；最后继续合并公司级 `SEG.companies[tk].notes`（string/array/object 均可）。

**验证**
- 真实数据回归：对 14 个有备注的 ticker，基线/修复后 `segNotesFor()` 输出 JSON 完全一致（`tmp-final/notes_base.json` vs `notes_after.json`，`diff` 无输出）；`#segNotesLine` DOM 文本对 00941.HK / 00992.HK / NVDA / AAPL 逐字一致（`tmp-final/notesdom_base.json` vs `notesdom_after.json`）。
- 对象形态前后对比（注入 `SEG.notes = {'00941.HK': '对象形态备注：…', 'AAPL': '不属于本公司的文本'}`）：
  - 基线（c02adb4）：`#segNotesLine` 不存在（`NOTES_DOM null`）；
  - 修复后：`口径备注：对象形态备注：FY2025 起按客群披露（注入验证）`，且 AAPL 的键不会串到 00941；
  - 截图 `tmp-final/shots/{base,after}_notesdemo_00941_object.png`。
- 测试 `tests/verify_seg_notes.mjs` 新增 5b 段：对象按 ticker 取用、不得被其他 ticker 继承、数字键行池按前缀过滤、恢复真实数组后 00992 公司级备注仍在 → **31/31**（基线代码跑同一测试 29/31，失败的正是对象形态两条）。

## 3) 柱状图金额精度 + 导出单位

**落点**：`app.js:1314` `fmtVal`；`app.js:1993` `exportHeaderData()`（单位在 `app.js:2004`）；`app.js:2027` `exportWatermark()`。

**先确认了各显示层用的是哪个函数**
- 柱状图 **tooltip** 唯一使用 `fmtVal`（`lines.push('<b>' + fmtVal(val) + '</b>')`）。
- **y 轴刻度**是数值轴，轴名 `dispSym()+'B'`，刻度数字由 ECharts 生成，不经 `fmtVal` → 未改。
- 柱状图**没有数据标签**（无 label formatter）→ 无需改。
- 数值本身（`item.data`，单位 B）完全未动，只改打印层。

**改法**
```js
const fmtVal = v => isMargin ? v.toFixed(1) + '%' : (v < 0 ? '−' : '') + dispSym() + amtText(v);
```
与桑基共用 `amtText`：|v| ≥ 1 → `1.2B`，< 1 → `98.9M`（保留 1 位小数）；负数把负号放在货币符号前。
- 导出标题单位由「单位 $十亿 (B)」改为 `单位 $B/M（随数值自适应）`（英文 `unit $B/M (adaptive)`）；水印同步 `单位 $B/M（自适应）`。
- 无 i18n 资源文件，字符串内联在 `exportHeaderData/exportWatermark` 的 `lang` 分支，已同时改 zh/en。

**验证**
- 小额样例：NVDA 销售与管理费用 FY2011 Q2（2010-08-01）tooltip 由 `$0.1B` → `$98.9M`（真实值 0.0989B）；截图 `tmp-final/shots/{base,after}_bar_NVDA_sga_2010_tooltip.png`。
- 导出：基线 `… · 单位 $十亿 (B)` / 水印 `… · 单位 $十亿 (B)`；修复后 `… · 单位 $B/M（随数值自适应）` / `… · 单位 $B/M（自适应）`。
- `tests/verify_bar.mjs` 新增 4b：tooltip 必须含 `$98.9M` 且不含 `0.1B` → **35/35**（基线 34/35）。
- `tests/verify_export.mjs` 新增 2 条：header 单位匹配 `/B\/M/` 且不含「十亿」、水印匹配 `/B\/M/` → **13/13**（基线 11/13）。原有 title/company/period/watermark 断言未改、未破坏。

## 4) ECharts 版本注释

`app.js:3` 注释 `ECharts (v5.6.0)` → `ECharts (v5.5.1)`。实测：
```
node -e "console.log(require('./vendor/echarts.min.js').version)"  → 5.5.1
grep 'version:"5.6.0"' vendor/echarts.min.js                      → 仅一处，属 zrender 依赖声明
```

## 回归证明（基线 c02adb4 app.js vs 修复后，同一份 data/vendor）

1440 视口，页面稳定 3.2s 后整页截图；导出用页面内 `exportPNG()/exportSVG()`。

| 项目 | 结果 |
|---|---|
| NVDA 桑基 | 像素一致，sha256 前 16 位 `8195490f1692cd71`（两侧相同），0 px |
| NVDA 占比 | 像素一致，`6808c95157aff63d`，0 px |
| NVDA 环比 | 像素一致，`f7cc20dba9fd8e67`，0 px |
| 600887 桑基 | diff bbox `(195,494,363,582)`，9421 px，**仅提示框文字区**（任务 1 的折行变化） |
| 600887 占比/环比 | 同上，bbox `(195,494,363,582)`，各 9421 px，仅提示框 |
| NVDA 柱状（视口） | 274 px，bbox `(283,555,1345,695)`：细折线描边重绘噪声；**基线自比 base-vs-base2 = 707 px 同区域**，同代码两次截图亦有此噪声；`chart.getOption()` 的 series data/axis 完全一致（3.6KB JSON，`diff` 无输出） |
| 600887 柱状（视口） | 1507 px，噪声同源（基线自比 738 px，修复后自比 728 px） |
| 导出 PNG（NVDA/600887） | 3200×2072，**差异仅两行文字带** y=130–161（标题单位）与 y=2019–2042（水印）；y=162–2018 图表主体 0 px |
| 导出 SVG | 仅单位串差异：`十亿 (B)` → `B/M（随数值自适应）`，字形节点其余全等（长度 +7B，相似度 0.9997） |

结论：除 §1–§3 三处显示文本外，图表数值、几何、配色、导出图像主体均像素一致；柱状图视口截图存在与代码无关的加载期栅格噪声（基线自比同样存在，已量化）。

## 测试

- 全套 `BASE=http://127.0.0.1:8799 node tests/verify_*.mjs` 顺序跑：22 个带计数器的套件共 **792 项全部通过**（bar 35、basis 26、cum 31、bar_lines 15、cum_seg 27、currency 6、export 13、filter_jitter 19、fiscal 67、coverage 31、header 183、layout 23、loss_branch 91、modes 31、pct 32、seg_annual 16、seg_axis 11、seg_notes 31、seg_notice 57、state 11、timeline2 21、timeline_click 15），另有 `verify_new`、`verify_units_guard` ALL PASS。
- `verify_loss_branch` 在整串脚本里曾因 CDP 端口/配置目录竞争出现空输出退出 1，单独重跑 91/91、EXIT=0（非功能失败，报告保留此偏差）。
- `verify_scan`：不带参数时在非 TTY 下读空 stdin 会报 `Unexpected end of JSON input`；按验收口径 `node tests/verify_scan.mjs --run` → 扫描数 83 ≥ 80、错误 0、`verify_scan: 全部通过`、EXIT=0。
- 新增/修改测试文件：`tests/verify_seg_notice.mjs`（新）、`tests/verify_seg_notes.mjs`、`tests/verify_bar.mjs`、`tests/verify_export.mjs`。

## 提交

| # | sha | 内容 |
|---|---|---|
| 1 | `a0bbbea` | fix(ui): 分部不可用提示框按输入带宽限宽并按字符断行 |
| 2 | `8ce3edd` | fix(ui): 兼容对象形态的 SEG.notes 并渲染公司级备注 |
| 3 | `65ddb96` | fix(ui): 柱状图金额按 B/M 自适应显示并中性化导出单位 |
| 4 | `3c1aca7` | docs(app): 修正 echarts 版本注释为 5.5.1 |

`git status` 干净（`data/` 为 CRLF 工作区文件，规范化后无 diff）；4 个提交只含 `app.js` 与测试。

## 截图证据（`tmp-final/shots/`）

- 提示框：`{base,after}_notice_AVGO_{1280,1440,1600}.png`、`{base,after}_notice_CRWV_*.png`、`{base,after}_notice_000660_KS_*.png`
- 备注：`{base,after}_notes_00941_bridge_1280.png`、`{base,after}_notes_00992_bridge_1280.png`（真实数据文案一致）、`{base,after}_notesdemo_00941_object.png`（对象形态注入对比）
- 小额柱图：`{base,after}_bar_NVDA_sga_2010_tooltip.png`、`diff_bar_NVDA_sga_2010_tooltip.png`
- 回归：`{base,after,base2,after2}_reg_{NVDA,600887}_*`（4 视图 + export.png/svg）、`diff_*` 局部图、`diff_base_vs_base2_bar.png`（噪声对照）

## 风险

1. `breakAll` 对含空格文本会在空格处仍保留断点语义（ECharts 先按可断点断，超宽才逐字符），因此英文提示可能出现「单词中间换行」的观感；这是 146px 带内完整显示 384 字符的代价，已用 padding/8px gutter 保证不压列。
2. 提示框宽度依赖 `padLeft` 与 Sankey `series.left` 硬同步（170/210 两处常量）；未来若改 Sankey 左边距需同步 `segmentNoticeGraphic`，代码里已加注释提示。新增 `verify_seg_notice.mjs` 会在越界时失败。
3. 对象形态 notes 的「裸文本」只在键名精确等于 ticker（大小写不敏感）时才接受；若未来数据用 `{'00941.hk ': '…'}`（尾部空格）或嵌套更深的结构，会退回行池逻辑而不显示，需要再扩 `segNoteBucket`。
4. 导出单位文案变为「B/M 自适应」，依赖 `units_guard` 只校验数值/单位符号；若外部文档仍写「十亿(B)」需同步更新。
5. 柱状图视口截图的加载期栅格噪声（≈700 px，细折线描边）会让逐像素 gate 不稳定；建议像素回归 gate 对柱状视口使用容差或改用导出图/`getOption()` 比对。
