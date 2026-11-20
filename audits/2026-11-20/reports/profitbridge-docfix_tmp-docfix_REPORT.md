> 来源：profitbridge-docfix/tmp-docfix/REPORT.md（2026-11-20 归档）

# 文档与备注准确性修复报告（fix/notes-counts-docs）

- 仓库：`C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge-docfix`（worktree，分支 `fix/notes-counts-docs`）
- 基线：`434fcdb Merge branch 'fix/seg-notes-msft-nvda'`（已 `git log --oneline -1` 确认）
- 未 push / 未 rebase；仅改动允许的 5 个文件。

## 1. 现算（脚本，非手抄）

脚本 `tmp-docfix/compute_notes.py`（未入库，tmp 目录被 .gitignore 忽略）：

```
missing(tk) = sorted(end for end in profit[tk].quarters if end not in segments[tk].quarters)
note      = "{tk}: {n} 季无分部披露（源上无分部表，非抓取失败）: " + ", ".join(missing)
```

| 公司 | profit 期数 | segments 期数 | 现算缺期 | 原备注日期数 | 新增日期 |
|---|---|---|---|---|---|
| MSFT | 77 | 40 | **37** | 22 | 2007-09-30, 2007-12-31, 2008-03-31, 2008-06-30, 2008-09-30, 2008-12-31, 2009-03-31, 2009-06-30, 2009-09-30, 2009-12-31, 2010-03-31, 2010-06-30, 2015-09-30, 2015-12-31, 2016-03-31 |
| NVDA | 65 | 30 | **35** | 33 | 2010-08-01, 2017-10-29 |

现算输出摘要（脚本实际 stdout）：

```
tk    profit  seg missing  old_dates  added
MSFT      77   40      37         22  15 added
NVDA      65   30      35         33  2 added
[OK] MSFT: note dates == computed missing (37)
[OK] NVDA: note dates == computed missing (35)
mirror deep-equal: OK
```

说明：MSFT 原文案未覆盖 2010-09-30 之前 12 期（2007-09-30 … 2010-06-30）+ 2015-09-30 / 2015-12-31 / 2016-03-31 共 15 期；NVDA 漏 2010-08-01、2017-10-29。

## 2. 改前 / 改后文案

### MSFT（37 期）

- 改前：`MSFT: 22 季无分部披露（源上无分部表，非抓取失败）: 2010-09-30, 2010-12-31, 2011-03-31, 2011-06-30, 2011-09-30, 2011-12-31, 2012-03-31, 2012-06-30, 2012-09-30, 2012-12-31, 2013-03-31, 2013-06-30, 2013-09-30, 2013-12-31, 2014-03-31, 2014-06-30, 2016-06-30, 2018-06-30, 2020-06-30, 2022-06-30, 2024-06-30, 2026-06-30`

- 改后：`MSFT: 37 季无分部披露（源上无分部表，非抓取失败）: 2007-09-30, 2007-12-31, 2008-03-31, 2008-06-30, 2008-09-30, 2008-12-31, 2009-03-31, 2009-06-30, 2009-09-30, 2009-12-31, 2010-03-31, 2010-06-30, 2010-09-30, 2010-12-31, 2011-03-31, 2011-06-30, 2011-09-30, 2011-12-31, 2012-03-31, 2012-06-30, 2012-09-30, 2012-12-31, 2013-03-31, 2013-06-30, 2013-09-30, 2013-12-31, 2014-03-31, 2014-06-30, 2015-09-30, 2015-12-31, 2016-03-31, 2016-06-30, 2018-06-30, 2020-06-30, 2022-06-30, 2024-06-30, 2026-06-30`

### NVDA（35 期）

- 改前：`NVDA: 33 季无分部披露（源上无分部表，非抓取失败）: 2010-10-31, 2011-01-30, 2011-05-01, 2011-07-31, 2011-10-30, 2012-01-29, 2012-04-29, 2012-07-29, 2012-10-28, 2013-01-27, 2013-04-28, 2013-07-28, 2013-10-27, 2014-01-26, 2014-04-27, 2014-07-27, 2014-10-26, 2015-01-25, 2015-04-26, 2015-07-26, 2015-10-25, 2016-01-31, 2016-05-01, 2016-07-31, 2016-10-30, 2017-01-29, 2017-04-30, 2017-07-30, 2018-01-28, 2020-01-26, 2022-01-30, 2024-01-28, 2026-01-25`

- 改后：`NVDA: 35 季无分部披露（源上无分部表，非抓取失败）: 2010-08-01, 2010-10-31, 2011-01-30, 2011-05-01, 2011-07-31, 2011-10-30, 2012-01-29, 2012-04-29, 2012-07-29, 2012-10-28, 2013-01-27, 2013-04-28, 2013-07-28, 2013-10-27, 2014-01-26, 2014-04-27, 2014-07-27, 2014-10-26, 2015-01-25, 2015-04-26, 2015-07-26, 2015-10-25, 2016-01-31, 2016-05-01, 2016-07-31, 2016-10-30, 2017-01-29, 2017-04-30, 2017-07-30, 2017-10-29, 2018-01-28, 2020-01-26, 2022-01-30, 2024-01-28, 2026-01-25`

措辞保持与 `data/segments.json` 其余 20+ 条 `N 季无分部披露（源上无分部表，非抓取失败）: …` 完全同构（保留「季」而非改成「个期间」，以维持文件内一致口径）。

## 3. 前端展示与 `isUsefulSegNote`（重要核对）

`app.js:1800-1809` 的 `SEG_NOTE_DROP_PATTERNS` **按设计丢弃** `N 季无分部披露（源上无分部表，非抓取失败）:` 这类批量行（注释：「Most top-level notes are noise … we drop them」）。因此这两条批量备注**改前改后都不会出现在「口径备注」行**，不是本次改动造成的回归；`segNotesFor("MSFT")` 实测只返回 1 条（3→2 口径变更），`segNotesFor("NVDA")` 也只返回 1 条。

页面上 MSFT 2026-09-30 / NVDA 2026-04-26 实际显示的备注（公司级口径变更文案）已实测仍在、未被截断：

- `MSFT_2026-09-30_1680`：exists=True, clip=True (clientH=33/scrollH=33), overlapTitle=False
- `MSFT_2026-09-30_1280`：exists=True, clip=True (clientH=33/scrollH=33), overlapTitle=False
- `NVDA_2026-04-26_1680`：exists=True, clip=True (clientH=17/scrollH=17), overlapTitle=False
- `NVDA_2026-04-26_1280`：exists=True, clip=True (clientH=33/scrollH=33), overlapTitle=False

> 若后续希望把「缺 N 期」也展示给用户，需要改 `app.js`（放行/新增 keep hint），不在本任务允许的文件范围内。

## 4. README / KNOWN_CAVEATS

- `README.md:122`：`tests/verify_*.mjs（23 个…` → **25 个**（`ls tests/verify_*.mjs | wc -l` = 25，含 `verify_scan.mjs`）。
- `docs/KNOWN_CAVEATS.md:106`：原「MSFT 现有 3 条 notes…1 条「22 季无分部披露」…尚无 3→2 口径调整提示，需要补」→ 改为「4 条 notes…1 条「37 季无分部披露」…1 条 2026-09-30 起 3→2 口径变更提示，已补」。

## 5. 测试

- 端口：`netstat -ano | grep -E ":88(2[0-9])"` 确认 8820–8829 全空，自起 `node scripts/serve.mjs 8821`，`BASE=http://127.0.0.1:8821`；未使用 8440/8799/8801。
- `tests/verify_*.mjs`：**25/25 文件全部 exit 0**（含 `verify_scan --run`，输出「verify_scan: 全部通过」）。
- `tests/verify_seg_notes.mjs`：**51/51 passed**（新增 5 条数据级断言：镜像 deep-equal、MSFT/NVDA 备注计数与日期 == 现算缺期清单）。
  - `verify_bar`：`34/34 passed`
  - `verify_bar_basis_labels`：`SUMMARY 26/26 checks passed`
  - `verify_bar_cum_growth`：`SUMMARY 31/31 checks passed`
  - `verify_bar_lines`：`15 checks, 15 passed, 0 failed`
  - `verify_cum_seg`：`27/27 passed`
  - `verify_currency`：`SUMMARY 6/6 checks passed`
  - `verify_export`：`SUMMARY 11/11 checks passed`
  - `verify_filter_jitter`：`19/19 checks passed`
  - `verify_fiscal_quarter`：`SUMMARY 67/67 checks passed`
  - `verify_graph_coverage`：`SUMMARY 31/31 checks passed`
  - `verify_header_layout`：`SUMMARY 183/183 checks passed`
  - `verify_layout_refactor`：`23/23 checks passed`
  - `verify_loss_branch`：`SUMMARY 91/91 checks passed`
  - `verify_modes`：`31/31 passed`
  - `verify_new`：`ALL PASS`
  - `verify_pct_fix`：`32/32 passed`
  - `verify_rebuild_idempotent`：`ALL PASS`
  - `verify_scan`：`verify_scan: 全部通过`
  - `verify_seg_annual_quarters`：`SUMMARY 16/16 checks passed`
  - `verify_seg_axis`：`11/11 passed`
  - `verify_seg_notes`：`51/51 passed`（截图写到 tmp-notes/shots 后退出）
  - `verify_state_memory`：`11/11 checks passed`
  - `verify_timeline2`：`21/21 passed`
  - `verify_timeline_click`：`15/15 checks passed`
  - `verify_units_guard`：`SUMMARY ALL PASS`

`tests/verify_seg_notes.mjs` 改动：在测试主体前新增 `---------- 0. data-level ----------` 段（新增 ~21 行，未改任何既有断言）；原测试没有断言旧数字/旧文案，故无需改旧断言。

## 6. 截图（1680 / 1280）

`tmp-docfix/shots/`（`BASE=… node tmp-docfix/shots.mjs` 生成；每档另有 `_page.png` 全页图）：

- `tmp-docfix/shots/MSFT_2026-09-30_1680_note.png`
- `tmp-docfix/shots/MSFT_2026-09-30_1280_note.png`
- `tmp-docfix/shots/NVDA_2026-04-26_1680_note.png`
- `tmp-docfix/shots/NVDA_2026-04-26_1280_note.png`

裁剪图实测：MSFT 1680/1280 为 2 行、NVDA 1680 为 1 行 / 1280 为 2 行；`scrollHeight == clientHeight`（无 line-clamp 截断），与 `#chartTitle` 无重叠，全页图中备注行在标题上方、未压图。

## 7. 提交（3 个独立 commit）

| # | commit | 内容 |
|---|---|---|
| ① | `3fa4c60` | `data/segments.json` + `data/segments.json.js`（37/35 期，镜像同步） |
| ② | `09df5f3` | `README.md` + `docs/KNOWN_CAVEATS.md` |
| ③ | `2b4d37e` | `tests/verify_seg_notes.mjs`（数据级断言） |

文件范围检查：`git status --porcelain` 仅上述 5 个文件；未触碰 `app.js` / `scripts/` / 其它 data / 其它测试。

