# Data pipeline: how `data/profit.json` is reproduced

`data/profit.json` (and its JS mirror `data/profit.json.js`) is produced by a **two-stage**
pipeline. Running only the first stage is `NOT` a valid reproduction — this is by design, not
bad data. Read this before regenerating.

## Correct order (canonical)

```bash
node scripts/merge_batches.mjs        # stage 1: batch1-6 staging + fixups -> base series
node scripts/merge_fundamentals.mjs   # stage 2: enrich gross/opInc/rd/sga from tmp-backfill/
```

- **Stage 1 `merge_batches.mjs`** — *not a full rebuild*. It loads the on-disk
  `data/profit.json`, overwrites only the tickers covered by the staging batches, then applies
  `data/staging/fixups.json` (highest priority, whole-ticker replace). It writes only
  `revenue` + `netInc` (+ `periodType`/`fx`), and it will refuse to write (exit 1) if the merge
  would roll back any existing field.
- **Stage 2 `merge_fundamentals.mjs`** — adds `gross` / `opInc` / `rd` / `sga` from
  `tmp-backfill/backfill_{A,HKB,HKC,FX}.json`. It only *enriches* existing periods; it never
  changes `end` / `revenue` / `netInc` / `periodType` / `currency` / `fxToUsd` (idempotent,
  conflict → keeps old value). It also rebuilds `profit.json.js` and asserts it deep-equals the
  JSON.

## Why standalone `merge_batches.mjs` reports `REFUSING 2189 semantic regressions` — EXPECTED

Because stage-1 staging (`diffHK` / batch4) carries only `revenue` + `netInc`, it drops the
`gross` / `opInc` / `rd` / `sga` that were added later by stage 2. With a fully-enriched disk
image, the regression guard therefore sees e.g. `00700.HK 2003-03-31/q1: gross 88.65 -> undefined`
across the 25 HK/A-share tickers that stage 2 enriches, and refuses. **This is the expected,
healthy refusal** — it protects the enrichment layer from being wiped. It disappears after
stage 2 runs; it is not a data error and does not require `--force`.

> Do **not** "fix" it with `--force` in the normal pipeline; `--force` is only for deliberately
> re-generating a fresh BASE image (then stage 2 must be run immediately after).

## Verification used (0-difference reproduction)

From a base image, the two-stage pipeline reproduces the committed `data/profit.json` exactly
(92 companies / 3679 periods, per-field 0 diff), confirming stage 1 + stage 2 is the real
regenerator:

```bash
# sandbox check that stage1(base) + stage2 == target, per-company / per-field 0 diff
node scripts/merge_batches.mjs && node scripts/merge_fundamentals.mjs
node -e 'const a=require("./data/profit.json").companies,b=require("./tmp-fix-currency/target_profit.json").companies;/* deep-equal */'
```

(An earlier audit left a base copy at `tmp-fix-currency/base_profit.json`.) The only fields that
can drift between a re-run and the committed file are a few hand-edited human `notes`
(IBM / 00762.HK / 601360.SS) that were never back-written into staging — those are descriptive
text only, never data values.

## Fixup layer (durable manual corrections)

Manual per-company fixes live in `data/staging/fixups.json` `fixups[]` as
`{ ticker, sourceCommit, entry: { ...complete company object including full quarters... } }`.
`merge_batches.mjs` applies each entry as a **whole-ticker replace** (not a field patch), so the
`entry` must contain the complete `quarters` array. This is how the NESN.SW / MC.PA local-currency
restoration + H1-2026 interim and the 00151.HK per-period-fx correction survive a re-merge.

---

## 每日新财报扫描（`scripts/scan_filings.mjs`）

**用途**：每天检查 `data/profit.json` 已收录的 92 家公司，是否已有「站内还没有的新报告期」披露出来，产出一份**只读**待办清单，供人或 Agent 判断要不要补数。它**不写 `data/` 下任何文件**，跑完 `git status` 应保持干净。

```bash
node scripts/scan_filings.mjs                    # 人读摘要（stdout）
node scripts/scan_filings.mjs --json             # 机器可读 JSON（stdout）
node scripts/scan_filings.mjs --out out.json     # 同时落盘（自动建目录）
```

退出码：`0` = 扫描完成（无论有无新披露）；`1` = 扫描本身失败（读文件/结构异常）。

**定时**：无人值守、无交互；失败重试，单家失败只记 `errors` 并继续。建议 cron / 计划任务每天 07:00 运行：
`0 7 * * * cd <repo> && node scripts/scan_filings.mjs --json --out tmp-scan/scan-$(date +\%F).json`
（并发默认 ≤6、每请求间隔 ~120ms，礼貌限速；可用 `SCAN_CONCURRENCY` / `SCAN_GAP_MS` 覆盖。）

### 输出字段

| 字段 | 含义 |
| --- | --- |
| `scannedAt` / `siteUpdated` | 本次扫描时间 / 站内数据 `updated` 日期 |
| `counts` | `total` 总数、`scanned` 成功探测数、`newPeriods`、`fillCandidates`、`filingAlerts`、`longTermMissing`、`errors`、`skipped` 计数 |
| `newPeriods[]` | **有新报告期**：`{ticker,name,market,currency,siteMaxEnd,latestEnd,latestNotice,reportType}`；`latestEnd > siteMaxEnd` 才算 |
| `fillCandidates[]` | **最新期可补字段**（仅 A 股）：`{ticker,end,missing[],latestNotice}`；只报「最新期新出现的缺失」 |
| `longTermMissing[]` | **长期缺失**（仅 A 股）：最近 3 期同样缺该字段 = 结构性不上报，只统计不逐条待办 |
| `filingAlerts[]` | **6-K 公告提醒**：`{ticker,latestSixK,count,recent[≤3]}`，近 21 天内提交的 6-K，按 ticker 聚合 |
| `errors[]` | 探测失败的公司 `{ticker,market,error}`（网络/结构异常，不中断整体） |
| `skipped[]` | 未扫描公司 `{ticker,market,reason}`（KR 未接源、无 CIK 私有公司等，摘要按原因聚合计数） |

### 各市场数据源与口径

- **A 股（`.SS/.SH/.SZ`，14 家）**：东财 `RPT_F10_FINANCE_GINCOME`（filter `(SECUCODE="600519.SH")`，站内 `.SS` 需换成 `.SH`；`source=F10&client=PC` + 浏览器 UA）。口径：`revenue=TOTAL_OPERATE_INCOME`、`gross=revenue−OPERATE_COST`、`opInc=OPERATE_PROFIT`、`netInc=PARENT_NETPROFIT`、`rd=RESEARCH_EXPENSE`、`sga=SALE_EXPENSE+MANAGE_EXPENSE`（**两者之和**）。A 股字段齐全，故只有 A 股做「补空字段」判定，并按最近 3 期做长期缺失降噪。
- **港股（`NNNNN.HK`，17 家）**：东财 `RPT_HKF10_FN_MAININDICATOR`。只判「新期」，不做字段补齐（`rd` 等多为结构性缺报）。
- **美股 / 欧股 / 台股（有 `cik` 的公司，52 家）**：SEC EDGAR `https://data.sec.gov/submissions/CIK##########.json`。**必须分两类**：
  - `10-Q / 10-K / 20-F / 40-F` 的 `reportDate` 是真报告期末 → 用于判「新期」。
  - `6-K` 的 `reportDate` 恒等于 `filingDate`，**绝不能当期末**（否则 BIDU/NTES/BILI 等会被全部误报成新期），只能作 `filingAlerts` 公告提醒。
- **KR（3 家）/ 无 CIK 的欧股台股 / 私有公司（HUAWEI、LEGO 等）**：归入 `skipped`，按原因聚合计数，靠人工关注。

### 自检与测试

```bash
node scripts/scan_filings.mjs --json --out tmp-scan/scan.json
node tests/verify_scan.mjs tmp-scan/scan.json   # 或：node tests/verify_scan.mjs --run
```
`tests/verify_scan.mjs` 校验 `counts/newPeriods/fillCandidates/filingAlerts/skipped` 结构合法、`scanned ≥ 80`、`errors === 0`、6-K 不混入新期。

### 已知局限（诚实版）

- **6-K 只能提醒、不能定期末**：reportDate 恒等于 filingDate，无法据此判定新报告期，仅作公告线索。
- **KR 未接免费数据源**：3 家韩股直接 skip。
- **私有公司（HUAWEI/LEGO）与无 CIK 的欧股/台股**：无 SEC submissions，靠人工关注。
- **SEC `filings.recent` 只覆盖近若干次提交**（约 1000 条），极少数公司若长期未提交定期报告可能落在窗口外。
- **港股只判新期、不补字段**；美股/欧股缺失多为结构性不上报，不做每日补字段。
- 网络波动会记入 `errors` 并重试；若某天 `errors>0` 请人工复核当日结果。
