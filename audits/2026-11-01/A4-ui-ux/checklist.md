# A4 前端 UI/UX 实测清单（checklist）

审计日期 2026-11-01；环境：`node scripts/serve.mjs 8448` + headless Chrome CDP 9364（默认 1680×1050）。凡“已测”均为真实渲染 + 截图/取值，不是静态读码。

## A. 环境与基础
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| A1 | 服务 8448 可用 | GET /index.html、/data/profit.json.js | ✅ 200 | — |
| A2 | Chrome 9364 可连、默认 1680×1050 | CDP `Emulation`/`Page` | ✅ | `00-initial.png` |
| A3 | 首屏无控制台错误/未捕获异常 | `window.__errs/__cerr` 注入 | ✅ 0/0 | — |
| A4 | 不触碰 8440 端口他人进程 | 全程未操作 8440 | ✅ | — |

## B. 视图与按钮
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| B1 | 桑基 ↔ 柱状 切换 | 点 #btnViewBridge / #btnViewBar | ✅ 正常，标题/图随之切换 | `03-bar.png` |
| B2 | 占比按钮 | #btnPct（桑基） | ✅ 加“占营收 %” | `01-pct.png` |
| B3 | 环比按钮 | #btnQoQ（桑基） | ✅ 加 QoQ 线 | `02-pct-qoq.png` |
| B4 | 柱状图占比/环比（线条开关） | 柱状视图再点两按钮 | ✅ 可独立开关，关闭后无线 | `04-bar-nolines.png` |
| B5 | 柱状图例与系列名一致 | `window.__barMeta` 对比 series | ✅ `Gaming`/`净利润` 含 占营收%、QoQ%，图例相符 | `bar-seg-gaming.png`、`bar-net.png`、`bar-legend.png` |
| B6 | 点击反馈 | 公司 logo 高亮、按钮 active、切公司 toast | ✅ 有反馈 | `state-residue.png` 等 |
| B7 | 年报公司 环比→同比 | LEGO / HUAWEI | ✅ 按钮显示“同比/YoY” | `co-LEGO.png`、`co-HUAWEI.png` |

## C. 公司覆盖
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| C1 | 92 家公司逐一点击 | 分块点击全部 `.logo[data-sym]` | ✅ 92/92，均有非空标题，0 控制台错误 | `evidence/full_sweep.json` |
| C2 | ≥15 家不同行业截图 | 手动切换并截图 18 家 | ✅ 半导体/软件/汽车/航天/消费/金融/通信/港股/A股/欧洲 | `co-AAPL/MSFT/TSLA/GOOGL/600519.SS/300750.SZ/000063.SZ/00700.HK/00992.HK/LEGO/NESN.SW/MC.PA/ASML/TSM/SPCX/HUAWEI/005930.KS/NVDA.png` |
| C3 | “只有 1 期数据公司” | 统计 quarters 长度 | ⚠️ 无样本：最少 SPCX 2 期（CBRS 4、HUAWEI/LEGO/02513.HK 7），按最少期实测 | `evidence/full_sweep.json` |
| C4 | “分部全空公司” | 6 家 degraded | ✅ 均有点位提示，但提示文本溢出（见 A4-02） | `co-00992_HK.png`、`co-SPCX.png`、`co-LEGO.png` |
| C5 | 港股/A股/欧洲公司 | 00700.HK/00992.HK、600519.SS/300750.SZ/000063.SZ、NESN.SW/MC.PA/ASML | ✅ 均可渲染 | 对应 `co-*.png` |
| C6 | 切换公司状态残留 | 柱状设 seg:Gaming 后切到无该分部公司 | ✅ 自动回落 revenue，无残留 | `state-residue.png` |
| C7 | 切换缺期提示 | 切到不同财年公司 | ✅ 底部 toast 提示已对齐最近可用期 | — |

## D. 导出
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| D1 | 导出 PNG 能打开 | 捕获真实下载字节另存打开（3200×1800） | ✅ 可打开 | `export-bridge.png` |
| D2 | 导出 PNG 内容=画面 | 与屏幕对比 | ❌ 缺标题/公司/期间/元信息/时间轴 | A4-01 |
| D3 | 导出背景色 | 像素取样 (2,2)/(1600,40) | ✅ #f2efe9 正确 | `export-bridge.png` |
| D4 | 导出 SVG 能打开 | 捕获 blob 另存 | ✅ 合法 SVG（约 29KB） | `export-bridge.svg` |
| D5 | 导出 SVG 内容=画面 | 文本检索 | ❌ 无公司/标题（有‘营收’）；缺标题/时间轴 | A4-01 |
| D6 | 导出无水印 | 目检 | ❌ 无任何水印/期间标识 | A4-01 |
| D7 | 文件名规范 | 读 download 属性 | ✅ `profit_bridge_NVDA_2026-07-26.png/.svg`（柱状 `bar_<item>_...`） | — |

## E. 语言与货币
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| E1 | English 切换工具栏/标题/meta/按钮 | #btnLang | ✅ 全英文（NVDA：`NVIDIA CORP Q3 2026`、`Data updated/Source`） | `en-NVDA.png` |
| E2 | English 公司名/分部名 | 600519.SS | ❌ 仍中文 | A4-04 / `en-600519_SS.png` |
| E3 | English 空状态原因 | LEGO / 00992.HK | ❌ hint 仍中文 | A4-04 / `en-LEGO.png`、`en-00992_HK.png` |
| E4 | US$ 切换按钮出现条件 | 仅 CNY 公司显示 #btnCur | ✅ NVDA 隐藏、HUAWEI 显示“显示 US$” | `cur-native-HUAWEI.png` |
| E5 | US$ 数值换算 | HUAWEI 营收 880.941→131.928，比值 0.14976（≈6.68 CNY/USD） | ✅ 正确 | `cur-usd-HUAWEI.png` |
| E6 | US$ 单位符号 | tooltip | ✅ `¥375.0B` → `$56.2B` | `tip-HUAWEI-native.png`、`tip-HUAWEI-usd.png` |
| E7 | tooltip 单位（美股） | NVDA 节点 | ✅ `Hyperscale $48.7B`（数据 48.71） | `tip-NVDA.png` |

## F. 深链
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| F1 | #c&q&v&m 首载复现 | 新文档加载 TSLA bar net | ✅ 标题/视图/条目正确 | `deep-link-fresh-TSLA.png` |
| F2 | #c&q 首载复现 | 新加载 600519.SS q=2024-12-31 | ✅ ‘贵州茅台 Q4 2024 · FY2024 全年累计’ | — |
| F3 | #ind 首载复现 | AAPL ind=semi | ✅（哈希规范化 q→2026-03-28） | — |
| F4 | #z 缩放参数 | z=20-40 | ✅ 百分比区间生效（z 为 0-100，不是年份） | — |
| F5 | 页内 hashchange | 打开后改 location.hash | ❌ 不生效（无监听） | A4-06 / `deep-link-hashchange.png` |
| F6 | 多行业链接还原 | #ind 仅取首个 | ❌ 多选丢失 | A4-06 |

## G. 窄窗口
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| G1 | 1280×720 横向无滚动 | docSW vs clientW | ✅ 1265 ≤ 1280 | `narrow-fresh-1280x720.png` |
| G2 | 1280×720 标签完整 | 导航前设视口 fresh load | ✅ overlap 0、clipped 0（不报假裁剪） | 同上 |
| G3 | 1280×720 时间轴可见 | #timeline y | ❌ y≈841 在 720 视口之下 | A4-05 |
| G4 | 1024×768 横向无滚动 | docSW | ✅ 1009 ≤ 1024 | `narrow-fresh-1024x768.png` |
| G5 | 1024×768 时间轴可见 | y | ❌ y≈880 在 768 之下 | A4-05 |
| G6 | 900×700 列式布局 | @media max-width:900 | ⚠️ 列式生效但文档高 1822，时间轴 y≈1727 | `narrow-fresh-900x700.png` |
| G7 | 溢出/遮挡 | 目检 + 几何 | ✅ 无横向滚动；标签按正确宽度初始化时不裁剪 | 同上 |

## H. 时间轴
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| H1 | 滑块拖动 | 拖到 30% | ✅ 标题 Q2 2015、thumb 29.6875%、无振荡 | `tl-drag-30pct.png` |
| H2 | 滑块与图表同步 | 连续拖 2025→2015 | ✅ 单调同步 | 同上 |
| H3 | 点击刻度 | 点“2015” | ⚠️ 跳到 2015-04-26（该年 Q1），粒度不明确 | A4-07 / `tl-tick-2015.png` |
| H4 | 点击轨道 | 轨道 2% | ✅ 跳到 2010-10-31 | — |

## I. 视觉细节与鲁棒性
| # | 检查项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| I1 | 文字截断/重叠（桑基） | 几何 bbox 检测 + 目检 | ❌ TSLA 成本标签粘连重叠；空状态提示溢出 | A4-02 / A4-03 |
| I2 | 空状态是否有提示 | degraded 公司 | ✅ 有提示（但可读性差） | `co-SPCX.png` |
| I3 | 近零值显示 | 00992.HK/TSLA | ❌ `$0.0B` | A4-08 |
| I4 | 图例与数据是否一致 | __barMeta vs series | ✅ 一致 | `bar-legend.png` |
| I5 | 布局抖动（历史问题） | 切换公司观察 | ✅ 未见重排抖动 | 多张 `co-*.png` |
| I6 | 面板 checkbox 被拉宽（历史问题） | 源码 + UI | ✅ 已无 `.side input{width:100%}` | — |
| I7 | 控制台错误（全流程） | 92 家 + 切换 + 导出 + 语言 | ✅ 0 error / 0 uncaught | `evidence/full_sweep.json` |

## 复核备注（非 A4 缺陷，供其他角度参考）
- 分部合计 ≠ 营收（>0.02B）仅 6 家：QCOM −0.165、GOOGL −0.106、600519.SS −1.574、000333.SZ −1.01、000100.SZ −0.059、600887.SS −0.159（口径/四舍五入残差）→ A1/A2。
- 58 家公司当期无分部（`segSum` 为空）：多为美股/港股/A 股当期未披露或 degraded，属数据覆盖范畴 → A6。
