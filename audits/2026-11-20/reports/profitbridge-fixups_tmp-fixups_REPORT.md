> 来源：profitbridge-fixups/tmp-fixups/REPORT.md（2026-11-20 归档）

# fix/fixups-ibm-docs 实施报告

- 日期：2026-11-20
- worktree：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-fixups`
- 分支：`fix/fixups-ibm-docs`（基于 `main` HEAD `f0eb709`，未 push / 未 rebase）
- 范围：只改 `data/staging/fixups.json`（IBM 一条 notes）+ 管线文档（`scripts/PIPELINE.md`、`README.md` 的管线段）；未改 `data/profit.json`、`data/segments.json`、`app.js`、`tests/`、其它 staging 文件。

## 1. 差异清单

### 1.1 IBM（已修，唯一真正落后项）

| 项 | 内容 |
|---|---|
| 位置 | `data/staging/fixups.json` → `meta.notes[431]`（HEAD 第 5964 行）；对应 `data/profit.json` → `notes[431]`（第 38890 行） |
| staging 原文 | `IBM: consistency — 2020-12-31: gross 5813 > revenue 1925` |
| 磁盘现文 | `IBM: consistency — 2020-12-31 gross>revenue 已修复: revenue 1925→20366, gross 5813→10523（取 2020 10-K 原始口径 FY2020 revenue 73620 / gross 35575 减去 Q1–Q3 合计 53254 / 25052）；rd 1540→1611, sga 4711→7232, tax -471→25 同源订正；gross + 派生 cogs(rev−gross) = revenue 恒等成立` |
| 影响 | 旧文案是“发现问题”的告警，现文案是“已修复”的结论；若从 staging 全量重建，notes 会被回退成旧告警 |

- 全量比对 534 条 `meta.notes`：**只有 index 431 不一致**，其余 533 条逐字相同。
- `data/segments.json` 不相关：其 `notes[28]` 是 `IBM: degraded — could not reconcile segment units with revenue`，属于 segment 层；`data/staging/segment_fixups_2026-11-01.json` 里没有 IBM 行，`fixups.json` 也只承载 profit 层 notes，因此没有对应的 segment 修复快照可同步。

### 1.2 其它公司（只报告，未改，请你拍板）

> 结论先行：以下 3 项在“磁盘优先 reconcile + late batch append”语义下**都不影响重建输出**，最终重建仍 0 差异；它们只是 fixup 快照本身的冗余/滞后，是否清理属于数据治理决策。

| 公司 | 不一致 | 为什么不影响重建 |
|---|---|---|
| `603866.SH`（桃李面包） | fixup（idx 2，manual-fix）48 期里缺 `gross`/`opInc`/`sga`/`rd` 共 **180 个 period-field**（如 2014-12-31 gross=198.52、opInc=98.76、sga=93.01）；磁盘 48 期有这些值 | `merge_batches.mjs` 的 reconcile 会按磁盘原键序把 enrichment 字段补回；fixup 只覆盖 revenue/netInc 等自身字段 |
| `BIDU` | fixup（idx 4）只有 **34 期**，磁盘 **35 期**，缺 `2026-09-30` | 该期由 late batch（N≥7）在 fixups 之后 append-only 补回，不会被 fixup whole-ticker replace 丢掉 |
| `NESN.SW` | 两条 fixup：较早 idx 9（2026-10-30，restatement 前）与较晚 idx 17（2026-11-20）并存；idx 9 与磁盘有 **5 个字段值落后**（如 2021-12-31 revenue 87470.4 vs 87088、gross 42002.4 vs 41620；2022/2023 同类） | fixups 按数组顺序后者覆盖前者，idx 17 与磁盘一致；idx 9 只是历史快照 |

除以上外，没有发现其它“fixup 与磁盘不一致且会导致重建回退”的条目。

## 2. 修改内容

### 2.1 `data/staging/fixups.json`

- 仅替换 `meta.notes[431]` 一条，改为与磁盘逐字一致；JSON 结构、键序、缩进不变。
- 文件保持 CRLF：227,236 B → **227,498 B**；CRLF 行 6,070、裸 LF 0；`git diff` 为 **1 行**。
- 修改后 `meta.notes[431] === data/profit.json.notes[431]`，534 条 notes 全量 0 mismatch。

### 2.2 管线文档

`scripts/PIPELINE.md`（117 → 152 行）精准更新，未重写整篇：

- 开头改为“stage 1 磁盘锚定（非从零重建）；2026-11-20 glob + reconcile 重写后单跑 stage 1 即逐字节复现已提交文件；stage 2 仍是 `gross`/`opInc`/`rd`/`sga` 的 enrichment 层，在完整镜像上是 no-op”。
- 规范流程注释：`batch1-6` → **glob 全部 `data/staging/batch*.json`**；stage 1 四步明确为：① glob 按数字序加载，`1..max` 缺号 **FATAL**；② `fixups.json` whole-ticker 最高优先级；③ late batches（`N >= 7`）append-only 重放；④ 磁盘优先 **reconcile**（`gross`/`opInc`/`rd`/`sga`，按磁盘键序；同键不同值 → 硬 `RECONCILE CONFLICT`）。
- 删除旧的“`REFUSING 2189 semantic regressions` — EXPECTED”整节，改为“Full rebuild is idempotent — no `--force` needed”，写入 2026-11-20 的 92 companies / 3731 periods、CRLF 归一字节相同、sha256 与 git LF blob 一致。
- 新增 “Stage 1 options (current CLI)”：
  - `--dry` / `DRY=1`
  - `--out-dir=DIR`（**必须等号**；空格形式会被忽略）
  - `--batch-only=batchN`（兼容旧别名 `--b8-only` / `B8_ONLY=1`）
  - `--fixup-ticker=XXXX`（只应用该 ticker 最后一条 fixup；仅允许 revenue/gross，并过 integrity gate）
  - `--force` / `FORCE=1`
  - 明确 targeted 模式跳过常规 batch/fixups/meta 重建，其余 ticker/period 零改动。
- 验证段改为“单跑 stage 1 即逐字节一致”，给出沙盒命令与 CRLF/LF 说明；notes 漂移段更新为：IBM 已于 2026-11-20 回写，00762.HK / 601360.SS 已有 `notes-preserve` fixup，同 index 不一致时 stage 1 仍保留磁盘文案并打印 `stale staging note` 警告（安全网，非常规路径）。
- Fixup 层补充：late batches（N≥7）在 fixups 后重放（BIDU 2026-09-30 因此存活）；`meta.notes[]` 必须镜像磁盘 notes，IBM 已回写。

`README.md` 管线段（第 43–50 行，3 处）：

- `batch1-6` → glob 加载**全部** `batch*.json`（缺号 FATAL）+ `fixups.json` + 磁盘优先 reconcile。
- “不是全量重建” → “不是从零重建”，并说明 reconcile 按磁盘原键序补回 gross/opInc/rd/sga。
- 新增“定向/沙盒” bullet：`--out-dir=DIR`（必须等号）、`--batch-only=batchN`、`--fixup-ticker=XXXX`。

## 3. 全量重建幂等验证

命令与结果：

```bash
rm -rf tmp-fixups-test
node scripts/merge_batches.mjs --out-dir=tmp-fixups-test
# exit 0
# WROTE tmp-fixups-test\profit.json companies=92 quarters=3731 registry=92 updated=2026-11-20
# guardFails: {}
# 无 "stale staging note" 警告
```

对比（`tmp-fixups/compare_rebuild.mjs`，Buffer + 递归 JSON）：

| 项 | 结果 |
|---|---|
| 磁盘 `data/profit.json` | 1,045,820 B；CRLF 行 38,995（git `autocrlf=true` 检出为 CRLF） |
| 重建 `tmp-fixups-test/profit.json` | 1,006,825 B；脚本固定写 LF（CRLF 0） |
| raw Buffer 相等 | **false**，差异仅为每行 EOL 的 `\r`（38,995 B） |
| CRLF 归一后 Buffer | **完全相等**（均 1,006,825 B） |
| JSON 递归深比较 | **0 diff**：92 companies / 3,731 periods，全部 key order 与 value 一致 |
| 与 git HEAD 的 LF blob | **逐字节相同**：`git show HEAD:data/profit.json` 与重建输出均 1,006,825 B，`sha256=8c383db1cd7b12e8406094fb797df934be4366ba7b55ebf28837270185c37690` |

结论：**全量重建幂等成立**。说明：脚本硬编码 LF，工作区因 `autocrlf` 为 CRLF，所以“raw Buffer 逐字节”只在 HEAD 的 LF blob 层成立；语义与规范化字节层面 0 差异，且 sha256 与提交 blob 完全一致。

## 4. 测试结果

环境：自起服务 `node scripts/serve.mjs 8831`（先 `netstat` 确认 8831/9341/9390 空闲），`BASE=http://127.0.0.1:8831`，跑完已停。

**最终干净一轮（`tmp-fixups/test-logs3/`）：25/25 全绿**

- 24 个 `tests/verify_*.mjs` 直接运行全部 PASS（每个测试启动前等待其固定 CDP 端口释放）：
  `verify_bar, verify_bar_basis_labels, verify_bar_cum_growth, verify_bar_lines, verify_cum_seg, verify_currency, verify_export, verify_filter_jitter, verify_fiscal_quarter, verify_graph_coverage, verify_header_layout, verify_layout_refactor, verify_loss_branch, verify_modes, verify_new, verify_pct_fix, verify_rebuild_idempotent, verify_seg_annual_quarters, verify_seg_axis, verify_seg_notes, verify_state_memory, verify_timeline2, verify_timeline_click, verify_units_guard`
- `verify_scan --run`：**全部通过**，scanned=83、errors=0（无参非 TTY 会读空 stdin，故用 `--run`）。
- `TOTAL pass=25 fail=0`。

过程备注（诚实记录，非最终结果）：

- 第一轮（`test-logs/`）`verify_layout_refactor` 失败：另一个 agent 的无头 Chrome 占用固定 CDP 端口 9341（profile `profitbridge/tmp-audit-sweep/.chrome`），测试复用了对方页面，出现 `meta line` 断言失败与 line 132 `xAxis[0]` 未定义；单独重跑 23/23 通过。第二轮（`test-logs2/`）`verify_modes` 因同端口竞争（9333）出现 `unsettled top-level await`（Node exit 13），单独重跑 31/31 通过。第三轮在等待端口释放后一次跑完，25/25 通过。
- `verify_scan --run` 首轮遇到第三方数据源瞬时网络错误（scanned=5、errors=78），重跑即 83/0；属外部网络抖动，与本次改动无关。

## 5. 约束与提交

- `git status` 仅 3 个改动文件：`data/staging/fixups.json`、`scripts/PIPELINE.md`、`README.md`；`tmp-fixups/`、`tmp-fixups-test/`、`tests/.shots/`、`tests/.chrome/` 均为未跟踪临时产物，未提交。
- 两个 commit：
  1. `000484a` fix(staging): sync IBM consistency note with on-disk profit.json（`data/staging/fixups.json`，1 file / +1 −1）
  2. `79ac4ad` docs(pipeline): document glob loader, disk-first reconcile and targeted modes（`scripts/PIPELINE.md` + `README.md`，2 files / +65 −29）
- 未 push、未 rebase。
