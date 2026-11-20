> 来源：profitbridge-deg/tmp-deg/REPORT.md（2026-11-20 归档）

# 分部数据 degraded 形态统一（2026-11-20）

- 仓库：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge`
- worktree：`../profitbridge-deg`，分支 `chore/degraded-form`（base `47d8df0`）
- 提交：
  - `000481a` data(segments): degraded 字符串 → 规范占位 {degraded:true,reason,quarters:{}}
  - `ba399ea` fix(segments): 抓取脚本不再写出字符串 degraded（根因修复，可单独 revert）
- 本地服务：`node scripts/serve.mjs 8794`（先 netstat 确认 8794 空闲；8440 已被另一个 server 占用）
- 硬约束遵守：`data/profit.json`、`data/profit.json.js`、`data/companies.json`、`data/staging/` **零改动**（见 §4 末尾 diff 证明）

---

## 1. 全量清点：`data/segments.json` 的 degraded 形态分布

92 家公司。改前 4 种形态并存：

| 形态 | 家数(改前) | 公司 | `segmentStatus()` 返回 | 图内提示 |
|---|---|---|---|---|
| **A. `degraded` 是字符串**（原因直接写在字段里，无 `quarters` 键） | **5** | AVGO、U、XNET、CRWV、000660.KS | `noData` | 通用「暂无可用分部数据」+ 通用 hint，**公司专属原因不显示** |
| B. 规范占位 `degraded:true` + `reason` + `quarters:{}` | 5 | SPCX、CBRS、LEGO、02513.HK、00100.HK | `unavailable` | 「该公司未公开分部数据」+ `reason` |
| C. `degraded:true` 但带真实年度分部数据（`annualQuarters` 4 期，`quarters:{}`、`annualOnly:true`） | 1 | 00992.HK | `unavailable`（仅当期口径提示） | 「该公司未公开分部数据」+ 年度-only 原因 |
| D. 无 `degraded` 字段（正常有 quarters） | 81 | 其余 | `ok` / `thisQuarter` | 视当期而定 |

改前的字面统计：`"degraded": true` **6** 处（B 5 + C 1）、`"degraded": "…"` **5** 处（A）；改后统一为 `"degraded": true` **11** 处、字符串形态 **0** 处。

### 与上一轮只读调研的结论核对

| 调研结论 | 复核 |
|---|---|
| AVGO、U、XNET、CRWV、000660.KS 五家 `degraded` 是字符串 | ✅ 完全属实，名单一个不差 |
| 「走 `noData` 分支导致前端拿不到文案」 | ⚠️ 现象属实，机制需纠正：**`noData` 不是数据里的字段**（`segments.json` 中 `"noData"` 出现 **0** 次），而是 `app.js:294 segmentStatus()` 的**兜底返回值**。字符串形态 `degraded !== true`、又没有 `quarters`，于是掉到 `return { kind:'noData' }`（app.js:300） |
| 「另有 5 家（SPCX、CBRS、LEGO、02513.HK、00100.HK）已是规范占位」 | ⚠️ 规范占位实际是 **6** 家：还要算上 **00992.HK**（`degraded:true` + `reason` + `quarters:{}`），但它同时保留真实 `annualQuarters`（FY2023–FY2026）与 `annualOnly:true`，语义是「仅年度披露」而非「无分部」，故单列 C 类 |
| 公司总数 | 92 家（`notes` 201 条、`failures` 386 条） |

### JSON 片段（改前 → 改后）

AVGO / U（两家原文完全相同）：

```json
"AVGO": { "degraded": "only 2 quarters with segment data" }
```
```json
"AVGO": { "degraded": true, "reason": "only 2 quarters with segment data", "quarters": {} }
```

XNET / CRWV / 000660.KS 同形（单键 `degraded` → 三键），例如：

```json
"CRWV": { "degraded": true, "reason": "No revenue-disaggregation R table exists in any EDGAR filing for this issuer (verified across all filings); CRWV is a single operating segment and its Revenue note contains only narrative/concentration/deferred-revenue/RPO details, so no segment split can be captured from XBRL.", "quarters": {} }
```

对照既有规范占位（未改）：

```json
"SPCX": { "degraded": true, "reason": "SpaceX 为私有公司，不披露经审计的合并分部数据", "quarters": {} }
```

---

## 2. app.js 只读分析：前端到底读 degraded 的什么形态

| 位置 | 函数 | 是否读 `degraded` | 行为 |
|---|---|---|---|
| `app.js:279-284` | `segmentsFor(ticker, qEnd)` | ❌ 不读 | 只返回 `quarters[qEnd]` / `annualQuarters[qEnd]` / `null`。这 5 家改前 `quarters` 不存在、改后 `{}`，**两次都返回 `null`，零行为变化** |
| `app.js:294-301` | `segmentStatus(ticker, qEnd)` | ✅ **唯一读取点** | `if (c.degraded === true) return { kind:'unavailable', reason: c.reason || '' }`（L298）；字符串形态不成立 → 落到 L300 `return { kind:'noData' }` |
| `app.js:306-329` | `segmentNoticeGraphic(plan)` | ❌ 不读（吃 `status`） | `unavailable` → 标题 `segUnavailableTitle`(L56/24) + `st.reason`；`noData` → `segNoDataTitle`+`segNoDataHint`(L57-58/25-26)。文本 `title + '\n' + hint`，`width:176, overflow:'break'`（L325） |
| `app.js:552-565` | `sankeySegPlan(ticker, qvRaw)` | ❌ 不读 | 把 `segmentStatus()` 结果放进 `plan.status`，供上面那个 graphic 用 |
| `app.js:1139-1156` | `segPeriods(ticker, name)` | ❌ 不读 | 只遍历 `quarters`/`annualQuarters` 的键；`if (s.quarters)` 对 `undefined` 和 `{}` 都跳过 → **改前 `[]`、改后 `[]`**，柱状图下拉零变化 |
| `app.js:1770-1787` | `segNotesFor(tk)` | ❌ 不读 | 只读 `SEG.notes` 与 `companies[tk].notes`；这 5 家都没有 `notes` 键，改前改后都为空 |
| `app.js:2064-2067` | 启动加载 | — | `fetch('data/segments.json')` —— **运行时真正生效的是 .json**；`.json.js` 只是 file:// 镜像 |
| `app.js:932` | 导出元数据 | ❌ 不读 | 把 `segmentStatus().kind` 写进 `window.__sankeyMeta.segmentStatus` |

**结论：只改数据就能让 5 家显示正确提示，`app.js` 不需要任何改动（0 行）。** 因为规范占位走的分支（`degraded === true` → `kind:'unavailable'` → 标题 + `reason`）与 SPCX 等 6 家完全相同，前端没有任何「字符串 degraded」的兼容代码。

浏览器实测（CDP 读 `segmentStatus()` 与 echarts `graphic` 文本，改后）：

| ticker | 最新期 | `kind` | 图内 graphic 文本 |
|---|---|---|---|
| AVGO | 2026-08-02 | `unavailable` | `该公司未公开分部数据\nonly 2 quarters with segment data` |
| U | 2026-09-30 | `unavailable` | 同上 |
| XNET | 2026-06-30 | `unavailable` | `该公司未公开分部数据\nSEC EDGAR 无分部数据：迅雷 20-F 全部为 "Single reportable segment"…` |
| CRWV | 2026-09-30 | `unavailable` | `该公司未公开分部数据\nNo revenue-disaggregation R table exists…` |
| 000660.KS | 2026-06-30 | `unavailable` | `该公司未公开分部数据\nSK hynix: earnings-release PDFs exist only via…` |
| SPCX（既有规范） | 2026-09-30 | `unavailable` | `该公司未公开分部数据\nSpaceX 为私有公司，不披露经审计的合并分部数据` |
| NVDA（对照） | 2026-07-26 | `ok` | 无提示 |

改前同一探针：5 家全为 `kind: 'noData'`，graphic 文本为 `暂无可用分部数据\n数据源未提供该公司的分部拆分，当前仅展示利润瀑布。`（见截图）。

---

## 3. 改法

### 3.1 数据侧（commit `000481a`）

新增幂等修复脚本 `scripts/fix_segments_2026-11-20_degraded.mjs`：

1. 遍历 `companies`，只处理 `typeof degraded === 'string'` 的条目（`degraded:true` 或无该字段的一律不动）；
2. 重建为 `{ degraded: true, reason: <原字符串按 trim 保留>, quarters: <原有则保留，否则 {}> }`，其余键按原顺序拷回；
3. 写入前先断言「`JSON.stringify(SEG,null,2)` + CRLF 与现有文件逐字节一致」，保证只产生目标差异、不重排格式；
4. 断言：`strip(degraded/reason/quarters)` 后新旧对象 `deepEqual`（其余字段零改动）、`quarters` sha256 相同、修复前后**逐公司** sha256 只有目标 5 家变、`notes`/`failures`/顶层键集合不变；
5. 写 `data/segments.json`（2 空格 + CRLF，与仓库现状一致）与 `data/segments.json.js`（`window.__SEGMENT_DATA = ` + 紧凑 JSON + `;\r\n`），随后**解析镜像做 `deepStrictEqual(parsed, SEG)` 断言**；
6. 重跑零变化（`changed=0`），幂等已验证。

### 3.2 根因侧（commit `ba399ea`，可单独 revert）

`scripts/fetch_segments.mjs` 的 `ONLY` 分支是这 5 家异常形态的来源：

- L517（抓取成功但判定 degraded）：`companies[tk] = { degraded: r.degraded }` → `{ degraded: true, reason: r.degraded, quarters: {} }`
- L533（抓取异常）：`{ degraded: 'fetch error: …' }` → `{ degraded: true, reason: 'fetch error: …', quarters: {} }`

不改这里的话，下次重跑抓取会再次制造字符串形态（本次数据修复会被覆盖）。**该提交不触碰数据、不影响任何测试**，若不希望扩大范围可直接 `git revert ba399ea`。

---

## 4. diff 摘要与校验

```
 data/segments.json                           | 20 +++++--     (+15 / -5，5 个 hunk，每 hunk 一家)
 data/segments.json.js                        |  2 +-          (单行，整行重写；内容 deepEqual 通过)
 scripts/fetch_segments.mjs                   |  7 ++-         (+5 / -2)
 scripts/fix_segments_2026-11-20_degraded.mjs | 89 ++++++++++++ (新脚本)
 4 files changed, 110 insertions(+), 8 deletions(-)
```

段实例（AVGO）：

```diff
     "AVGO": {
-      "degraded": "only 2 quarters with segment data"
+      "degraded": true,
+      "reason": "only 2 quarters with segment data",
+      "quarters": {}
     },
```

### 逐公司 sha256（92 家，仅 5 家变化，87 家逐字节相同）

| 公司 | 改前 sha256 | 改后 sha256 |
|---|---|---|
| AVGO | `8f8cbbfe851dac1f9cd8fe4b6426505b713d79a28aca7c8a3d13f813d7d061e3` | `22d6ce4749b314d15ea7f71ba561cf574f2a4df5948021c558584dc39e988b09` |
| U | `8f8cbbfe851dac1f9cd8fe4b6426505b713d79a28aca7c8a3d13f813d7d061e3` | `22d6ce4749b314d15ea7f71ba561cf574f2a4df5948021c558584dc39e988b09` |
| XNET | `ae68b1d6442626d803ec8de038afe825be3e615b378dc3331ac0426b9f4ae828` | `0631ac8e61b76a3437be25e1456bcfb6f8f7074ca16d52f61814479b9e380752` |
| CRWV | `48628aa681343c8a5cab6529e0768e96d15f332c0928499c2536ab997e760406` | `027af1c2403da53413411af1e5e0b34650414ec427f351ae89a1eb1a507ce63c` |
| 000660.KS | `035a4512ede3106e10dcae4d884af83fede62bb6f8ee6a2d370a3570156b7cf9` | `97ffc3ca20be48e2ed7ecf2c078c9e823ec2001d5c13c77a94dff0c159c4d462` |

（AVGO 与 U 改前同哈希，因为原始条目内容完全相同、都只有 `degraded` 一个键。全量 before/after 表在 `tmp-deg/sha-before.txt` / `tmp-deg/sha-after.json`。）

其余校验：
- `reason` 与旧 `degraded` 字符串**逐字节相等**（长度 33 / 33 / 141 / 278 / 384），未改写、未翻译、未截断；
- 5 家的键序统一为 `degraded, reason, quarters`（与 SPCX/CBRS/LEGO 一致）；
- 这 5 家原本没有 `periods`/`periodTypes`/`notes` 等字段，改后也没有新增，**periods/notes 零变化**；
- 顶层 `notes`(201)、`failures`(386)、`updated`、`source`、`sourceUrl`、`_conflicts` 全部 `deepEqual` 通过；
- `data/segments.json.js`：前缀 `window.__SEGMENT_DATA = ` 保留，`JSON.parse` 后 `deepStrictEqual` 于 `.json`；
- 禁止路径 diff 为空：
  ```
  git diff 47d8df0 --stat -- data/profit.json data/profit.json.js data/companies.json data/staging
  (empty)
  ```

---

## 5. 测试结果

`BASE=http://127.0.0.1:8794`，顺序跑 `tests/verify_*.mjs`（各自独立 CDP 端口；`verify_scan.mjs` 用其文档要求的 `--run` 模式）：

**最终一轮（HEAD=ba399ea）：23/23 PASS，0 FAIL**

```
PASS verify_bar / bar_basis_labels / bar_cum_growth / bar_lines / cum_seg / currency / export /
     filter_jitter / graph_coverage / header_layout / layout_refactor / loss_branch / modes / new /
     pct_fix / seg_annual_quarters / seg_axis / seg_notes / state_memory / timeline2 / timeline_click /
     units_guard   … 22 个
PASS verify_scan --run   （扫描数 83 / errors 0）
SUMMARY pass=23 fail=0
```

日志：`tmp-deg/tests-final.log`。

过程说明（两处与代码无关的环境噪声，均已证伪）：
- `verify_scan.mjs` **裸跑**时 exit 1 属用例设计——它必须吃 `--json` 输入（无 stdin 报 `输入无法解析为 JSON`，改前亦然），用 `--run` 即通过；
- 中途一轮 `verify_timeline_click.mjs` 报 `connect ECONNREFUSED 127.0.0.1:9347`（Chrome 起不来）。当时并发的另一个 worktree `profitbridge-fq/` 正跑同一套用例、共用同一批固定 CDP 端口（`Get-CimInstance` 可见其 14 个 chrome 进程）。单独重跑该用例 **15/15 PASS**，全套复跑亦 PASS —— 属并发端口争用，与本次改动无关。

截图（`tmp-deg/shots/`，1680×1050，clip = `#sankey` 面板）：

- `AVGO-before.png`：`暂无可用分部数据 / 数据源未提供该公司的分部拆分…`（通用文案，原因丢失）
- `AVGO-after.png`：`该公司未公开分部数据 / only 2 quarters with segment data`
- `CRWV-after.png`（附加）：长英文 reason 的渲染观感，见 §6-1

---

## 6. 结论与遗留

**结论**
1. 上一轮调研的名单准确（5 家字符串形态），但「noData 分支」是 `app.js:294 segmentStatus()` 的兜底返回，不是数据字段；规范占位实际 6 家（含 00992.HK）。
2. 5 家已统一为 `{degraded:true, reason, quarters:{}}`，原因文本逐字节保留，其余字段/数值零改动（87 家 sha256 不变）。
3. **前端无需配合**：`app.js` 0 行改动，5 家从 `noData` 变为 `unavailable`，提示 = 「该公司未公开分部数据」+ 公司专属原因，与既有规范占位完全同一路径。
4. 顺带堵住根因（`fetch_segments.mjs` 两处写盘点），避免下次抓取回退。

**遗留（本次按约束未做，建议后续单独立项）**
1. **长 reason 的提示排版拥挤**：`segmentNoticeGraphic()` 固定 `width:176`，CRWV（reason 278 字符）、000660.KS（384 字符）会把整条空带写满并紧贴营收列（见 `CRWV-after.png`）。属标题/布局类改动（需截断或按宽度自适应），按任务约定**停手未改**；若要改，落点在 `app.js:325`（`width: 176, overflow: 'break'`）与 `app.js:314`（`hint = st.reason || …`）。
2. **`segNotesFor()` 的 top-level notes 实际从未渲染**：`SEG.notes` 是对象（键 `"0"…"200"`，值形如 `"NVDA: …"`），而 `app.js:1773` 判的是 `Array.isArray(SEG.notes)` → 恒 false。与 degraded 无关，未在本任务范围，仅记录。
3. **00992.HK 的语义**：`reason` 写的是「仅年度披露」，被归入 `unavailable` 大类；若产品上要与「不披露分部」区分，需要新的 `kind`（前端改动，>10 行），本次不做。
