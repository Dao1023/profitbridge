> 来源：profitbridge-skhy/tmp-skhy/REPORT.md（2026-11-20 归档）

# SK hynix 000660.KS — 补 opInc + 补 2026Q3 + 记录一次性收益

分支 `data/skhy-opinc-q3`（worktree `../profitbridge-skhy`，base `2caa897`）。全部改动只落在 data 与 tests，未触碰 `app.js` / `scripts/`。

commits（未 push）：

- `55a99ea` data(000660.KS): backfill opInc for FY25/1Q26/2Q26 and add 2026Q3 quarter —— `data/staging/batch13.json`(新) / `data/profit.json` / `data/profit.json.js` / `data/segments.json` / `data/segments.json.js`（+88/−6）
- `69d64b8` test(verify_new): guard 000660.KS Q3-26 row, opInc backfill and Kioxia note —— `tests/verify_new.mjs`（+18）

## 0. 结论速览

| 项 | 结果 |
| --- | --- |
| 补 opInc（3 期） | 47,206,300 / 37,610,300 / 60,542,600 KRW-M，走 `data/staging/batch13.json` 的 `enrich[]` |
| 补 2026-09-30 | rev 104,615,500 / op 83,333,800 / NI 39,775,600，`periodType:"q3"`，fxToUsd **0.00073779** |
| 两源核对 | SK hynix newsroom ⟷ stockanalysis，rev/op 差 ≤0.00002%；NI 差 0.61%（口径差，取官方值） |
| 期数 | 3731 → **3732**，companies **92** 不变 |
| 其它票变动 | **0**（3728 期逐期 sha256 完全不变） |
| 桑基节点 | **2 → 5**（营收 / 营业利润 / 营业费用 / 净利润 / 税费及其他 或 非经营性收益） |
| 测试 | 25 个 `verify_*.mjs` 全绿 + `verify_scan --run`（83 家扫描 0 error） |

## 1. 两源核对（写入前完成）

### 源 A：SK hynix 官方 newsroom（一手，公司自述）

| 期 | URL | Revenue | Operating Profit | Net Income |
| --- | --- | --- | --- | --- |
| FY2025 | https://news.skhynix.com/en/sk-hynix-announces-fy25-financial-results/ | 97,146.7 | **47,206.3** | 42,947.9 |
| 1Q26 | https://news.skhynix.com/en/q1-2026-business-results/ | 52,576.3 | **37,610.3** | 40,330.2 |
| 2Q26 | https://news.skhynix.com/en/q2-2026-business-results/ | 79,318.7 | **60,542.6** | 93,922.6 |
| 3Q26 | https://news.skhynix.com/en/q3-2026-business-results/ （2026-10-28） | 104,615.5 | 83,333.8 | 39,775.6 |

3Q26 正文原文（Billion KRW 表同数）：

> SK hynix announced today … 104.6155 trillion won in revenues, 83.3338 trillion won in operating profit (operating margin 80%), and 39.7756 trillion won in net profit (net margin 38%).

### 源 B：stockanalysis（站内既有上游）

https://stockanalysis.com/quote/krx/000660/financials/?p=quarterly

| 期 | Revenue | Gross | Operating Income | Net Income |
| --- | --- | --- | --- | --- |
| FY2025（四季合计） | 97,146,7xx | — | **47,206,319** | — |
| 1Q26 | 52,576,2xx | — | **37,610,283** | — |
| 2Q26 | 79,318,746 | 21,458,xxx | **60,542,608** | 93,820,236 |
| 3Q26 | 104,615,483 | 89,652,936 | **83,333,818** | 39,534,392 |

### 交叉结论

- **opInc 三期完全一致**（官方 47,206.3 / 37,610.3 / 60,542.6 vs 源 B 47,206,319 / 37,610,283 / 60,542,608，相对差 <0.0001%），故回填值取官方百万韩元整数。
- **3Q26 revenue** 差 −17（−0.00002%）、**opInc** 差 +18（+0.00002%），均为源 B 的舍入/改写，取官方 104,615,500 / 83,333,800。
- **3Q26 netInc 有实质分歧**：官方 39,775,600 vs 源 B 39,534,392，差 241,208（**0.61%**）。同口径回看 2Q26：源 B 93,820,236 vs 站内既有 93,820,236（0%），而 2Q26 官方新闻稿口径 93,922.6（+0.11%），说明源 B 与官方在 "net income attributable / total net income" 上的口径本来就漂移。**按任务指定取官方 39,775,600**，差异记入 `data/staging/batch13.json` 的 `_meta.netIncNote`，不改站内既有 2Q26 值（任务约束「不动 revenue/netInc」）。

## 2. fxToUsd 计算过程（自 fetch 验证）

算法（站内既有：`fxToUsd = round(1 / (USD→local 即期) , 8 位)`，见 `scripts/merge_batches.mjs` 的 fx 段与 `docs/KNOWN_CAVEATS.md`）：

```
fxToUsd = Math.round((1 / rate) * 1e8) / 1e8
```

实测（`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node -e "fetch(...)"`）：

```
GET https://api.frankfurter.app/2026-09-30?from=USD&to=KRW
→ {"amount":1,"base":"USD","date":"2026-09-30","rates":{"KRW":1355.4}}
```

2026-09-30 是**周三**（营业日），ECB 当日有报价；邻近日区间 `2026-09-28..2026-10-02` 返回 1357.93 / 1353.36 / **1355.40** / 1361.27 / 1348.28，序列平滑、无跳变，确认 1355.4 不是抓错日。

```
1 / 1355.4 = 0.0007377895824110963
round(..., 1e8) = 0.00073779
```

**算法自证**：用同一 API 回算站内既有 4 期，逐位复现：

| 期末 | API USD→KRW | 1/rate | round→8 | 站内既有值 | 一致 |
| --- | --- | --- | --- | --- | --- |
| 2025-09-30 | 1403.67 | 0.000712418… | 0.00071242 | 0.00071242 | ✅ |
| 2025-12-31 | 1444.20 | 0.000692424… | 0.00069242 | 0.00069242 | ✅ |
| 2026-03-31 | 1524.80 | 0.000655824… | 0.00065582 | 0.00065582 | ✅ |
| 2026-06-30 | 1550.89 | 0.000644790… | 0.00064479 | 0.00064479 | ✅ |

五期同一算式（`1/rate` → 8 位四舍五入）全部逐位命中站内既有值，证明本次 0.00073779 与既有序列同源同法。

## 3. 变更清单

### 3.1 新建 `data/staging/batch13.json`（唯一数据入口）

```json
{"_meta": {"batch": 13, ...}, 
 "results": [{"ticker":"000660.KS","name":"SK hynix","currency":"KRW-M","report_type":"earnings release",
              "notice_date":"2026-10-28",
              "newQuarters":[{"end":"2026-09-30","revenue":104615500,"netInc":39775600,
                              "periodType":"q3","fxToUsd":0.00073779,"opInc":83333800}]}],
 "enrich": [{"ticker":"000660.KS","end":"2025-12-31","expectRevenue":97146675,"set":{"opInc":47206300}},
            {"ticker":"000660.KS","end":"2026-03-31","expectRevenue":52576287,"set":{"opInc":37610300}},
            {"ticker":"000660.KS","end":"2026-06-30","expectRevenue":79318746,"set":{"opInc":60542600}}]}
```

`enrich[].expectRevenue` 与站内 revenue 完全相等（对账差 0%，门禁阈值 0.5%）。

### 3.2 `data/profit.json`（管线写入，`node scripts/merge_batches.mjs "--batch-only=batch13"`）

- `data/profit.json:27594` `"opInc": 47206300`（2025-12-31）
- `data/profit.json:27602` `"opInc": 37610300`（2026-03-31）
- `data/profit.json:27610` `"opInc": 60542600`（2026-06-30）
- `data/profit.json:27613-27618` 新增 2026-09-30 行，键序 `end,revenue,netInc,periodType,fxToUsd,opInc`（与既有最近一期一致）
- `data/profit.json:5` `updated` 戳 → `2026-11-20`（管线 `stampUpdated`）
- 未动：其它 91 家、000660.KS 的 revenue/netInc/periodType/fxToUsd 四列、`notes`、`skipped`、`failures`

diff：`+17 / −3` 行。管线非破坏模式（`--batch-only`）只 append 新期 + 补空字段，不重跑 fx/registry/fixups。

### 3.3 `data/profit.json.js`

`window.__PROFIT_DATA = <minified>;`，与 `data/profit.json` 剥前缀后 `JSON.stringify` **deepEqual = true**（562 KB）。

### 3.4 `data/segments.json` / `data/segments.json.js`

`notes` 数组由 202 → **203** 条，追加（`data/segments.json:24845`）：

```
000660.KS: 2026-06-30 净利率 118%（净利 93,820,236 > 营收 79,318,746 KRW-M）含约 33.4 万亿韩元一次性投资收益（Kioxia 股权处置），非数据错误
```

镜像 `data/segments.json.js` 同步（`window.__SEGMENT_DATA = …`），剥前缀 deepEqual = true。两文件工作副本是 CRLF，用 `(JSON.stringify(j,null,2)+'\n').replace(/\n/g,'\r\n')` 与 `'window.__SEGMENT_DATA = '+JSON.stringify(j)+';\r\n'` 精确重建，diff 仅 `+3/−2` 行。

### 3.5 `tests/verify_new.mjs`（唯一测试改动）

末尾新增第 15 节（`tests/verify_new.mjs:134-151`）数据回归：Q3 期值、键序、fx、三期 opInc 回填、segments.notes 存在性。**无既有断言过期**，未修改任何旧行。

## 4. 只允许 000660.KS 变化 —— 逐期 sha256 证明

脚本 `tmp-skhy/snap.mjs`：对 `profit.json` 每个 ticker 的每一期，取该行对象（去掉 `end` 键，保留其余全部键与顺序）的 `JSON.stringify` → sha256 前 16 位，跑前跑后各一次；`tmp-skhy/zero_diff.mjs` 逐键比对。

```
unchanged period rows: 3728
changed rows: 4
  000660.KS 2025-12-31: c4e93edc91f24748 -> 974c1bae7e813f7b
  000660.KS 2026-03-31: 53c3d6754f8de4db -> 22b69265f996d3ed
  000660.KS 2026-06-30: 391a0f5e0dfb4a7a -> 94c079f00f618667
  000660.KS 2026-09-30: (absent) -> 04dc7d713bef0546
```

- 3728 = 3731 − 3，即原有 3731 期里除被 enrich 的 3 期外**全部逐字节不变**；
- 新增 1 期 → 3732；companies 92 不变（快照键集合 92 → 92）；
- `git diff --stat` 亦只含 4 个 data 文件 + 1 个新 batch 文件，无其它 ticker 行。

管线幂等复核：`node scripts/merge_batches.mjs "--batch-only=batch13" --out-dir=tmp-skhy/rerun` → `added=0 guardFails={} skipped=[]`，输出 `profit.json` 与磁盘版本 CRLF 归一后**逐字节相同**。

## 5. 前端实测：桑基节点 2 → 5

自起静态服务 `node scripts/serve.mjs 8871`（`netstat` 确认 8870-8879 空闲），`BASE=http://127.0.0.1:8871`，headless Chrome 1600×1000：

| 期 | 节点数 | 节点 | 流 |
| --- | --- | --- | --- |
| 2026-09-30 | **5** | revenue / op / opex / net / taxOther | revenue→op, revenue→opex, op→net, op→taxOther |
| 2026-06-30 | **5** | revenue / op / opex / net / nonop | revenue→op, revenue→opex, op→net, nonop→net |

截图（`tmp-skhy/shots/`）：

- `000660.KS_2026-09-30_1600x1000.png` — 营收 $77.2B → 营业利润 $61.5B + 营业费用 $15.7B；营业利润 → 税费及其他 $32.1B + 净利润 $29.3B
- `000660.KS_2026-06-30_1600x1000.png` — 营收 $51.1B → 营业利润 $39.0B + 营业费用 $12.1B；营业利润 → 非经营性收益 $21.5B + 净利润 $60.5B（净利 > 营业利润，正是 Kioxia 一次性收益造成的形状）

**与「无 gross」的冲突**：不冲突。桑基的「营收→营业利润/营业费用」分支只依赖 `revenue` + `opInc`，`gross` 缺失时该层直接跳到 op 层（`cogs` 块不画），因此补上 opInc 后节点数 2→5。分部数据仍 degraded（`segments.json` 里 `000660.KS` 的 reason 未变：SK hynix board API 的 PDF CDN 403、无 DART key），所以**左下角文字提示仍在**，但只影响分部/DRAM-NAND 细分，不再把整张图降级成 2 节点。

控制台：两个期别 `Runtime.exceptionThrown` 与 `console.error` 均为 **0**。

## 6. 测试

`BASE=http://127.0.0.1:8871`，顺序执行（浏览器测试各自固定 CDP 端口，不能并行）：

| 测试 | 结果 |
| --- | --- |
| verify_bar | 35/35 |
| verify_bar_basis_labels | 26/26 |
| verify_bar_cum_growth | 31/31 |
| verify_bar_lines | 15/15 |
| verify_cum_seg | 27/27 |
| verify_currency | 6/6 |
| verify_export | 13/13 |
| verify_file_fallback | 6/6 |
| verify_filter_jitter | 19/19 |
| verify_fiscal_quarter | 67/67 |
| verify_graph_coverage | 31/31 |
| verify_header_layout | 183/183 |
| verify_layout_refactor | 23/23 |
| verify_loss_branch | 91/91 |
| verify_modes | 31/31 |
| verify_new（含新增第 15 节） | ALL PASS（+10 条） |
| verify_pct_fix | 32/32 |
| verify_rebuild_idempotent | ALL PASS（全量重建仍逐字节复现，说明 batch13 已被 glob 拾取且 reconcile 幂等） |
| verify_seg_annual_quarters | 16/16 |
| verify_seg_axis | 11/11 |
| verify_seg_notes | 55/55 |
| verify_seg_notice | 57/57（worst overrun −8.1px） |
| verify_state_memory | 11/11 |
| verify_timeline2 | 21/21 |
| verify_timeline_click | 15/15 |
| verify_units_guard | ALL PASS |
| verify_scan `--run`（真实联网，走代理） | **全部通过**：counts.total≥80（实际**83**）、errors=**0**、newPeriods/filingAlerts 自洽、无 6-K 误报 |

> 复跑说明：首轮 `verify_graph_coverage` 曾 exit=1 且无 FAIL 行（栈只余 `Node.js v24.18.0`），随即连续单跑 3 次均 31/31、exit=0 —— 属该脚本固定 CDP 端口 939x 在前一测试 Chrome 未完全退出时的启动竞态（flaky），**与本次数据改动无关，未改该测试**。

## 7. 备注 / 意外

1. 3Q26 `netInc` 两源差 0.61%（官方 39,775,600 vs stockanalysis 39,534,392）。按任务写入官方值；差异已写入 batch `_meta.netIncNote` 备查。
2. `scripts/PIPELINE.md:40,66` 仍写「92 companies / 3731 periods」等历史统计数字。按硬约束**未改 scripts**（这是文档中的历史快照，非断言），如需同步请另行授权。
3. `profit.json` 是 LF（管线输出），两个 `segments` 文件是 CRLF（工作副本），均已按各自格式写回，`git diff` 干净。
4. 一次性收益说明条目按任务给的文案原样写入 notes；同一事实**未**写进 `profit.json` 的 `notes`（该字段是全局说明数组，任务未要求）。
