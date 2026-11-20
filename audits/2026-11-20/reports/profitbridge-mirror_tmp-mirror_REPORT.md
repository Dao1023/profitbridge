> 来源：profitbridge-mirror/tmp-mirror/REPORT.md（2026-11-20 归档）

# segments 的 file:// 兜底（fetch → 失败时按需注入 `data/segments.json.js`）

- 仓库 / worktree：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-mirror`（分支 `fix/segments-file-fallback`，基于 `main@23cfe0d`）
- 提交：
  - `45b6e28` `feat(app): file:// 下按需注入 segments.json.js 兜底分部数据`（app.js +14 行）
  - `905f3cb` `test(file-fallback): 断言 http 无 segments.json.js 请求、file:// 下 SEG 非空`（新增 tests/verify_file_fallback.mjs，157 行）
- 改动范围：只有 `app.js` 与 `tests/verify_file_fallback.mjs`；`data/`、`index.html`、脚本、文档均未改（`git diff --stat 23cfe0d..HEAD` = 2 files）。
- 证据文件：`tmp-mirror/netlog.json`（CDP 网络事件）、`tmp-mirror/shots/*.png`、`tmp-mirror/suite.log`、`tmp-mirror/shot.mjs`、`tmp-mirror/run_all.sh`

---

## 1. 改动

`app.js:2163-2176`（原来只有 `app.js:2159-2162` 的 fetch，失败后什么都不做）：

```js
  if (!SEG) {
    // Same on-demand pattern as data/profit.json.js above: the fetch is the normal path, so
    // HTTP visitors never pay for the 340KB mirror. Only file:// double-click / offline lands
    // here. Failure is non-fatal: SEG stays null and the views degrade to "no segments".
    if (!window.__SEGMENT_DATA) {
      await new Promise(resolve => {
        const s = document.createElement('script');
        s.src = 'data/segments.json.js';
        s.onload = resolve; s.onerror = resolve; // resolve either way; missing data handled below
        document.head.appendChild(s);
      });
    }
    if (window.__SEGMENT_DATA) SEG = window.__SEGMENT_DATA;
  }
```

与 profit 段（`app.js:2128-2146`）完全同构：
- 先 fetch，只有 `!SEG` 才注入；`window.__SEGMENT_DATA` 已存在则不重复注入；
- `onload` / `onerror` 都 resolve，注入失败不会抛异常，`SEG` 保持 `null`，后续 `segmentsFor()` 返回 `null` → 视图走“暂无可用分部数据”降级（截图 1 左侧即该降级态）；
- 位置仍在 `initControls()` / `render()` 之前，与 profit 相同的时序：不阻塞 DOM 解析、只延后首帧，HTTP 路径根本不会进入该分支（不写进 `index.html`，所以 HTTP 访客 0 请求）。
- `SEG` 是 `app.js:142` 的顶层 `let`（脚本作用域绑定，**不是** `window` 属性），所以 `window.SEG` 本来就是 `undefined`；测试断言的是应用真正读取的 `SEG` 绑定 + `window.__SEGMENT_DATA`（详见 §3.2 注）。

---

## 2. HTTP：0 请求、0 字节

命令（自起 `node scripts/serve.mjs 8851`，端口 8851 已用 `netstat -ano | grep -E ":88[0-9][0-9]"` 确认空闲）：

```bash
BASE=http://127.0.0.1:8851 node tests/verify_file_fallback.mjs --with-file --netlog=tmp-mirror/netlog.json
```

`tmp-mirror/netlog.json` 里首页加载（`Network.setCacheDisabled(true)`，99 个请求）的关键项：

```text
http.requestCount            = 99
data/segments.json           = 1 次   (http://127.0.0.1:8851/data/segments.json)
data/segments.json.js        = 0 次   ← 断言目标
segments.json.js 传输字节    = 0 B
data/ 目录请求                = profit.json, segments.json, companies.json, logos/*.png …
window.__SEGMENT_DATA        = undefined（未注入）
SEG                          = 92 家公司
```

对照基线（`tmp-research-mirror/http-local.json` 的 99 个请求）请求集合未变——新增分支在 HTTP 下永不执行。

HTTP 下 AAPL 分部渲染正常（`window.__sankeyMeta.segmentStatus === 'ok'`，桑基里 4 个 `seg:` 节点）：

![http AAPL](shots/http_aapl.png)

---

## 3. file:// 前后对比

用同一个 `tmp-mirror/shot.mjs`（headless Chrome，无 `--allow-file-access-from-files`，即真实双击语义：fetch 本地文件被 CORS 拒绝）分别打开主仓（未修改，HEAD 23cfe0d）和 mirror。

| | BEFORE `profitbridge/index.html` | AFTER `profitbridge-mirror/index.html` |
|---|---|---|
| `SEG` 公司数 | `null` | **92** |
| `window.__SEGMENT_DATA` | `false` | **`true`** |
| `__sankeyMeta.segmentStatus` | `noData` | **`ok`** |
| 桑基 `seg:` 节点 | `[]` | `["Hyperscale","AI Clouds, Industrial & Enterprise","Data Center","Edge Computing"]` |
| SVG 数 | 3 | 3（页面结构不变，只多了输入侧分部列） |
| `data/segments.json` 请求 | 1（fetch 失败） | 1（fetch 失败） |
| `data/segments.json.js` 请求 | **0** | **1**（唯一的按需注入） |

截图（同机、同窗口 1680×1050、NVDA FY2027 Q2）：

| BEFORE：左侧“暂无可用分部数据”，桑基从“营收”直接开始 | AFTER：左侧出现 Hyperscale / AI Clouds / Data Center / Edge Computing 四个分部节点 |
|---|---|
| ![before](shots/file_before_nvda.png) | ![after](shots/file_after_nvda.png) |

AFTER 截图里还能看到 `app.js` 的分部口径备注（“2026-04-26 起公司披露口径变为两个分部…”），说明 `segmentsFor()`/notes 整条链路都拿到了数据，不只是节点。

file:// 请求序列（`netlog.json` 的 `file` 数组，节选）：

```text
file:///…/vendor/echarts.min.js
file:///…/app.js
file:///…/data/profit.json          (fetch, CORS 失败)
file:///…/data/profit.json.js       (profit 兜底注入)
file:///…/data/segments.json        (fetch, CORS 失败)
file:///…/data/segments.json.js     (本次新增的 segments 兜底注入)
file:///…/data/companies.json       (fetch, CORS 失败 — 已有行为，未改)
file:///…/data/logos/*.png
```

---

## 4. 测试

### 4.1 新增 `tests/verify_file_fallback.mjs`

```bash
BASE=http://127.0.0.1:8851 node tests/verify_file_fallback.mjs            # 6/6，file:// 段 SKIP
BASE=http://127.0.0.1:8851 node tests/verify_file_fallback.mjs --with-file # 11/11
```

`--with-file` 结果：

```text
PASS http: segments.json.js 请求数 = 0 requests=99 segments.json.js=0
PASS http: data/segments.json 走 fetch
PASS http: segments.json.js 传输字节 = 0 0B
PASS http: SEG 已加载 companies=92
PASS http: window.__SEGMENT_DATA 未被注入
PASS http: AAPL 桑基出现分部节点 segNodes=4 status=ok
PASS file: SEG 非空 companies=92 ready=true
PASS file: window.__SEGMENT_DATA 非空
PASS file: 注入了 segments.json.js
PASS file: 桑基出现分部节点 segNodes=4 status=ok
PASS file: 无未捕获异常 exceptions=0

11/11 passed
```

设计说明：
- **file:// 段默认跳过**，必须 `--with-file`（CI/无本机 Chrome 的机器不可靠），符合“默认跳过、显式开启”的约定；本次已实跑并附上结果。
- 可用 `--netlog=<file>` 把网络事件落盘（本报告 §2/§3 的证据就是它）。
- 注：`window.SEG` 恒为 `undefined`（`SEG` 是 `let` 脚本绑定，不是 window 属性）。测试用 `typeof SEG !== 'undefined' && SEG.companies` 读取应用真正使用的绑定，外加 `window.__SEGMENT_DATA`；这两条合起来比只查 `window.SEG` 更强。若后续确实需要 `window.SEG`，要在 app.js 里显式 `window.SEG = SEG`，本次不做（超出最小改动）。
- 踩坑记录：`Runtime.evaluate` 的整串表达式若以 `&& chart`（ECharts 实例，不可序列化）结尾会返回 `undefined`，所以 READY 表达式外面套了 `!!(…)`。
- 不能用 `--allow-file-access-from-files`：加了它 fetch 会成功，就测不到兜底分支（第一版就是这么假绿的）。

### 4.2 全套 `tests/verify_*.mjs`

串行跑 27 个文件（26 个既有 + 1 个新增），`tmp-mirror/run_all.sh`：

```text
===== 26 passed, 1 failed: verify_modes.mjs
```

唯一失败是 **CDP 端口竞争**（并行 agent 同时占用 9333；报错 `connect ECONNREFUSED 127.0.0.1:9333`，1s 内退出），换不到口（脚本里 `PORT` 写死），等端口释放后单跑：

```text
BASE=http://127.0.0.1:8851 node tests/verify_modes.mjs
31/31 passed
```

`verify_scan --run`：`verify_scan: 全部通过`（scanned >= 80、errors === 0）。

其余计数（suite.log）：`verify_bar 35/35`、`verify_cum_seg 27/27`、`verify_pct_fix 32/32`、`verify_seg_axis 11/11`、`verify_seg_notes 55/55`、`verify_seg_notice 57/57`、`verify_timeline2 21/21`，其余脚本以 `OK` + 退出码 0 通过。

**结论：27/27 文件全绿（含 verify_modes 重跑）。**

---

## 5. 风险 / 回滚

| 风险 | 评估 |
|---|---|
| HTTP 首屏字节 | **0**。分支只在 `!SEG` 时进入；`window.__SEGMENT_DATA` 为 `true` 说明注入只发生在 file://。99 个请求、0 个 `segments.json.js`、0 字节已实测。 |
| file:// 首帧延后 | 多一次本地文件读取 + JS 解析（340,575B 未压缩磁盘读取）。与 profit 的 568,735B 兜底同一量级，属于该路径本来就要付的成本；页面仍能先用空 `SEG` 渲染前先 await，不阻塞 DOM 解析。 |
| 注入失败（文件缺失 / 损坏 / CSP） | `onerror` 也会 resolve → `SEG` 保持 `null` → 现有降级提示“暂无可用分部数据”，不抛异常、不整页崩。测试里有 `file: 无未捕获异常`。 |
| 重复注入 | `if (!window.__SEGMENT_DATA)` 幂等；同一页面只注入一次。 |
| `data/segments.json` 存在但内容为空（`{}`） | `fetch` 成功即 `SEG = {}`，不会进兜底；与既有行为一致（HTTP 下本就如此），不新增问题。 |
| 静态托管若对 `.json.js` 返回 404 | file:// 路径本地文件一直存在；HTTP 路径不请求它，无影响。 |
| 测试兼容 | 新增测试默认跳过 file:// 段，CI 只需 HTTP；`verify_seg_notes.mjs` 仍校验镜像与 JSON 相等，继续通过。 |
| 回滚 | `git revert 905f3cb 45b6e28`（或只 revert feat 那个 commit）；无数据/文档改动需要同步回滚。 |

附带发现（未改，供后续参考）：file:// 下 `data/companies.json` 的 fetch 同样失败且无兜底，`REGISTRY` 为 `null`，`app.js:2163-2166` 之后依赖内置 10 家公司兜底；这不影响本次分部修复，但若要让 file:// 完全等价，需要同样的第三个兜底或删除该请求。
