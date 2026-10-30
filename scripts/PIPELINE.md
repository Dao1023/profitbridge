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
