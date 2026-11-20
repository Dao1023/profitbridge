> 来源：profitbridge-lic/tmp-lic/REPORT.md（2026-11-20 归档）

# A5-LIC-01 许可声明补齐 — 工作报告

日期：2026-11-20
仓库：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge`
Worktree：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-lic`
分支：`chore/license-notice`（基于 main `5628f48`）
状态：已提交，**未 push**

---

## 1. 结论

A5-LIC-01 的实质项（Apache-2.0 §4(a) 附许可副本、§4(b) 标注修改、§4(c) 保留 NOTICE）**已闭合**。

| 提交 | 说明 |
| --- | --- |
| `7c7afb4` | `chore(license): 补齐 ECharts 5.5.1 的 Apache-2.0 许可副本与 NOTICE`（4 files, +406） |
| `6393347` | `docs(audits): 补记 A5-LIC-01 许可声明的引入提交 sha 与哈希口径`（1 file, +2） |
| `8db8315` | `docs(license): 补充 d3.js BSD-3-Clause 许可声明与随附许可文本`（4 files, +70/−15） |

`git diff --stat 5628f48..HEAD` → 5 个文件、463 行新增、**0 行删除**（相对 main 纯追加；`8db8315` 内部的 −15 是对 §2.2/§3 重编号的改写，重编号后正文未减）。

d3 派生代码（BSD-3-Clause）已随附 `vendor/licenses/LICENSE-d3.txt`，NOTICE §2.2 声明，原「需人工确认①」闭合。

---

## 2. 交付物

| 文件 | 字节 | sha256（仓库 blob，LF） | 说明 |
| --- | --- | --- | --- |
| `vendor/echarts.LICENSE.txt` | 11,358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | Apache-2.0 全文，逐字取自官方 |
| `vendor/NOTICE` | 9,312 | `97387a333af617ea55f038d84f0d1a7707d08129530d09ca2a83dd519eb3f49e` | ECharts 5.5.1 声明 + 随包子组件（ZRender / d3 / tslib） |
| `vendor/licenses/LICENSE-d3.txt` | 1,475 | `e1211892da0b0e0585b7aebe8f98c1274fba15bafe47fa1f4ee8a7a502c06304` | d3.js BSD-3-Clause 全文，逐字取自 ECharts 5.5.1 随包副本 |
| `README.md` | +10 行 | — | 末尾追加「第三方许可 / Third-party licenses」 |
| `audits/2026-11-20/README.md` | +27 行 | — | 追加第 9 节（含 d3 补强记录） |

sha256 计算口径：对 git blob 计算（LF 行尾），`git cat-file -p :vendor/NOTICE | sha256sum`；工作区因 `core.autocrlf=true` 检出为 CRLF，对工作区文件直接算会得到不同值（`git ls-files --eol` 显示 `i/lf w/crlf`）。

### 2.1 许可全文来源与校验

- 来源：`https://www.apache.org/licenses/LICENSE-2.0.txt`（经 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897`，Node 原生 `fetch`，HTTP 200，`text/plain`）。
- 落盘为原始字节（`Buffer` 直写），未改写、未截断、无 BOM；11358 字节与官方文件一致。
- 校验脚本 `tmp-lic/verify-license.mjs` 输出：

```
bytes: 11358
sha256: cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
firstNonEmptyLine: "Apache License"
versionLineOk: true   (Version 2.0, January 2004)
endsOk: true          (… limitations under the License.)
sections: true        (1–9 全部标题齐全)
bom: false
LICENSE VALIDATION: PASS
```

注：官方文件首字节即换行（第 1 个物理行为空行），故「首行 = Apache License」按**首个非空行**判定；这是官方原文形态，未做修整。

### 2.2 NOTICE 内容要点

- 组件：Apache ECharts；版本 **5.5.1**；许可 Apache-2.0；文件 `vendor/echarts.min.js`。
- 版权：文件头**没有带年份的版权行**（全文无 `Copyright 20xx`），故逐字引用文件头原始 ASF 许可头，并记录上游 5.5.1 tag 自带 NOTICE 的版权行：

  ```
  Apache ECharts
  Copyright 2017-2024 The Apache Software Foundation
  ```

  依据 `https://github.com/apache/echarts/blob/5.5.1/NOTICE`；上游 master 现已改为 `2017-2026`，与 5.5.1 不符，故不采用 master。
- 修改状态：`Unmodified`（官方 dist 原样，无 patch / 无重压缩 / 未删头注释）。
- 版本依据：`node -e "require('./vendor/echarts.min.js').version"` → `5.5.1`；bundle 内 `t.version="5.5.1"` 唯一一处；2 处 `5.6.0` 均属随包 ZRender（`zrender.version` 与 `dependencies={zrender:"5.6.0"}`）。
- 随包子组件（bundle 内，一并再分发，已在 NOTICE 声明）：
  - **ZRender 5.6.0** — **BSD-3-Clause**，上游 LICENSE 为 `Copyright (c) 2017, Baidu Inc.`；bundle 内 banner 写 `Copyright (c) 2013, Baidu Inc.`，两处均如实保留；BSD-3 全文已随 NOTICE 重现（满足 BSD-3 第 2 条）。
  - **tslib** — **0BSD**，`Copyright (c) Microsoft Corporation.`；bundle 内嵌声明已逐字引用。
  - **d3.js（派生代码）** — **BSD-3-Clause**，`Copyright 2010-2016 Mike Bostock / All rights reserved.`；ECharts 的 treemap / tree / force / number 布局由 d3 v3 时代代码派生并改写为 TypeScript，已编译进 `vendor/echarts.min.js`，bundle 内无独立 d3 banner。许可全文随附 `vendor/licenses/LICENSE-d3.txt`（1,475 字节，逐字取自 `apache/echarts@5.5.1/licenses/LICENSE-d3`，URL 与抓取日期见 NOTICE §2.2.1），NOTICE §2.2 说明派生关系与 4 个源文件路径。

  > 取证说明：`d3/d3` 仓库现行 LICENSE（v7+）是 **ISC** 许可、版权行 `Copyright 2010-2023 Mike Bostock`（main 已更新为 2010-2026），并非 BSD-3；ECharts 内嵌的是 d3 v3 时代布局代码，上游按 BSD-3 声明并附 2010-2016 版权行。故 d3 许可文本以 **ECharts 5.5.1 随包的 `licenses/LICENSE-d3`** 为准，未把 d3/d3 现行的 ISC 文本当作 BSD-3 使用。
  - 依据：`zrender@5.6.0/package.json` `license: "BSD-3-Clause"`，`tslib/package.json` `license: "0BSD"`（raw.githubusercontent.com 实取）。

---

## 3. README 追加位置

- 追加在 `README.md` **文件末尾**，即原第 133 行 `## License` 段之后；新增内容占第 134–143 行（10 行），节标题「## 第三方许可 / Third-party licenses」位于第 **135** 行（134 行为分隔空行）。
- `git diff --unified=0` 显示只有 `@@ -133,0 +134,10 @@` 一个 hunk，**全是 `+` 行，无任何既存行被修改或删除**。
- 既有「## License（代码 MIT）」段落保持原样，新节标题为「## 第三方许可 / Third-party licenses」。

## 4. audits 追加位置

- `audits/2026-11-20/README.md`：新增「## 9. 追加：A5-LIC-01 许可实质项已闭合（2026-11-20）」，位于原第 8 节之后（第 132 行起），随 d3 补强增至 27 行；相对基线 `5628f48` 的 diff 删除行数为 **0**。
- 冲突检查：该文件在基线 `5628f48` 为干净状态，最近提交 `e150a41`（本次任务之前），worktree 隔离，无并发修改，无需降级方案。

---

## 5. `vendor/` 全量清单与许可判定

仓库 tracked 的 `vendor/` 文件共 4 个（`git ls-tree -r --name-only HEAD vendor/`）：

| # | 文件 | 类型 | 版本 | 许可 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 1 | `vendor/echarts.min.js` | 第三方 JS 库（Apache ECharts 官方 dist，内含 ZRender 5.6.0 + tslib + d3 派生算法） | 5.5.1（zrender 5.6.0） | Apache-2.0（随包 ZRender BSD-3-Clause、d3 派生代码 BSD-3-Clause、tslib 0BSD） | ✅ 本次已声明（LICENSE + NOTICE） |
| 2 | `vendor/echarts.LICENSE.txt` | 本次新增的许可文本 | — | Apache-2.0 原文 | ✅ 新增 |
| 3 | `vendor/NOTICE` | 本次新增的声明文件 | — | — | ✅ 新增 |
| 4 | `vendor/licenses/LICENSE-d3.txt` | 本次新增的许可文本（d3 派生代码） | — | BSD-3-Clause 原文 | ✅ 新增 |

**结论：`vendor/` 下没有第二个第三方库**，不存在 jQuery / noUiSlider / D3 / Chart.js / Bootstrap / lodash 等随包库。

排查方法与证据：

- `index.html` 的全部外链标签只有两条：`<script src="vendor/echarts.min.js">`（191 行）与 `<script src="app.js">`（195 行）；`grep -nE '<script|<link' index.html` 无其它 `<link>`/`<script>`。
- 全仓（排除 `vendor/echarts.min.js` 本体）`grep -riE 'jquery|nouislider|d3\.|chart\.js|bootstrap|lodash|moment|dayjs|cdn\.'` → **0 命中**。
- `index.html` 内 `https?://` 提取 → **0 条**，无 CDN 运行时依赖。
- 仓库无 `package.json` / `node_modules`（README 亦称「纯前端零构建」），`scripts/*.mjs` 为 Node 内置模块零依赖脚本，不随站点分发。
- `docs/screenshots/` 为自有截图；`audits/` 为文档；`.github/` 为 CI 配置，均非再分发的第三方代码。

### 5.1 d3 派生代码：已补齐（原「需人工确认①」）

ECharts 官方 LICENSE 的 "Apache ECharts Subcomponents" 附录声明 `treemapLayout.ts` / `layoutHelper.ts` / `forceHelper.ts` / `number.ts` 含 d3.js（BSD-3-Clause）派生代码，并指向 `/licenses/LICENSE-d3`。本次已：

- 新增 `vendor/licenses/LICENSE-d3.txt`（1,475 字节，逐字取自 `apache/echarts@5.5.1/licenses/LICENSE-d3`，`Copyright 2010-2016 Mike Bostock`）；
- `vendor/NOTICE` §2.2 增补 d3 派生说明（列出 4 个源文件、指向上述许可文本、标注「派生并改写」），原 §2.2 tslib 顺延为 §2.3，原第 3 节「备注」并入 §2.2 后删除；
- `README.md` 第三方许可节内补一句指向 `vendor/licenses/LICENSE-d3.txt`（未另起节）；
- `audits/2026-11-20/README.md` 第 9 节补登该文件 sha256 与「BSD-3 补强」判定。

### 5.2 仍需关注（不影响闭合）

1. **ZRender 版权年份不一致**：bundle banner 为 `2013`，上游 5.6.0 LICENSE 为 `2017`。已在 NOTICE 中同时如实记录，最终以哪一年为准可向上游确认（不影响 BSD-3 声明的实质）。
2. **NOTICE 版权行来源**：ECharts bundle 头本身不带年份版权行，`Copyright 2017-2024` 取自 5.5.1 tag 的 NOTICE；若未来升级 ECharts，需同步更新该年份、`vendor/echarts.LICENSE.txt` 与 d3 文本。
3. **d3 文本版本口径**：本仓库附的是 ECharts 随包 BSD-3 文本（2010-2016 版权行）；若将来直接引入 d3 v7+ 代码，需改附其 ISC 文本（`Copyright 2010-2023 Mike Bostock`），两者不可混用。

---

## 6. 硬约束遵守情况

| 约束 | 状态 |
| --- | --- |
| 只改 `vendor/**`（`vendor/echarts.LICENSE.txt`、`vendor/NOTICE`、`vendor/licenses/LICENSE-d3.txt`）、`README.md`（追加）、`audits/2026-11-20/README.md`（追加）、`tmp-lic/**` | ✅ `git diff --stat 5628f48..HEAD` 仅 5 个文件、0 删除；`tmp-lic/` 被根 `.gitignore` 的 `/*` 忽略，未入库 |
| 不动 `app.js` / `data` / `scripts` / `tests` | ✅ 无改动（`vendor/echarts.min.js` 本身也未改） |
| 不 push | ✅ 仅本地提交 |
| 中文 conventional commit | ✅ `chore(license): …` / `docs(audits): …` |

`git status --short` → 干净。

---

## 7. 复现命令

```bash
cd profitbridge-lic
node tmp-lic/verify-license.mjs                 # LICENSE VALIDATION: PASS
git cat-file -p :vendor/NOTICE | sha256sum      # 97387a33…
git cat-file -p :vendor/echarts.LICENSE.txt | sha256sum   # cfc7749b…
git cat-file -p :vendor/licenses/LICENSE-d3.txt | sha256sum  # e1211892…
head -2 vendor/licenses/LICENSE-d3.txt          # Copyright 2010-2016 Mike Bostock / All rights reserved.
git diff --stat 5628f48..HEAD                    # 5 files, +463
git log --oneline -4
```

`tmp-lic/` 内文件：

- `append.mjs` — 幂等追加脚本（写 README 与 audits 两节，注入 NOTICE 字节数与 sha256）
- `verify-license.mjs` — 许可文本完整性校验（首行/版本行/末行/1–9 节/BOM）
- `REPORT.md` — 本报告
