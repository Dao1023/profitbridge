# 入库审计 · 2026-11-26 · batch18（ZH 知乎 + LI 理想汽车 2026Q3）

基线 `5e4b943`（main）· 分支 `data/batch18` · 数据提交 `c550756` + 本文档提交 · **未 push**

## 0. 结论

ZH（知乎，CIK 1835724）与 LI（理想汽车，CIK 1791706）各自 **2026-09-30 单季**按 6-K 业绩稿 ex99-1 报表入库；全站 93 家公司不变，期数 **3,783 → 3,785**。ZH 同期补 3 个分部（USD-M）；`segments.json` 92 家公司、期数 +1 期。既有 91 家公司逐家 `JSON.stringify` 与 `HEAD` **0 处差异**。

## 1. 来源与口径

| | ZH | LI |
| --- | --- | --- |
| 表单 / 披露日 | 6-K，2026-11-25（业绩稿 2026-11-24） | 6-K，2026-11-25 |
| accession | `0001104659-26-131753` | `0001104659-26-131768` |
| 附件 | `tm2630593d1_ex99-1.htm` | `tm2630657d1_ex99-1.htm` |
| 报表 | condensed consolidated statements of operations（3M/9M，含 US$ 便利换算列） | 单季表（**无 9M 累计表**） |

- 单位：报表为人民币千元，除以 1,000 得 **CNY-M**；`periodType = q`；键序 `end,periodType,revenue,gross,opInc,netInc,rd,sga,tax,fxToUsd,fxDate`，**未新增 cogs/pbt**。
- `gross` = 毛利（ZH 报表 Cost of revenues 281.829 用 `gross=376.780` 表达，遵循站内不设 cogs 的约定）。
- `netInc` = **归母 / 普通股股东**口径：ZH −49.583（含少数股东总净亏损 −48.558，NCI +1.025）；LI −314.097（总净亏损 −309.705）。
- `sga` = 销售及营销 + 管理（ZH 319.111 + 43.612 = 362.723）；`tax` 正数 = 费用（ZH +6.483；LI −44.244 为所得税收益）。`rd`/`sga` 取费用绝对额。
- 汇率：`fxToUsd` = USD per CNY，2026-09-30 USD/CNY 6.7045（frankfurter/ECB，与业绩稿 H.10 便利汇率一致）→ ZH 0.14915355、LI 0.14915。

| ticker | revenue | gross | opInc | netInc | rd | sga | tax | fxToUsd |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ZH | 658.609 | 376.780 | −110.972 | −49.583 | 125.029 | 362.723 | 6.483 | 0.14915355 |
| LI | 28,834.429 | 4,816.047 | −699.612 | −314.097 | 3,116.677 | 2,361.284 | −44.244 | 0.14915 |

ZH 的 9M 累计块（revenue 2,000.296 / gross 1,158.543 / opInc −249.775 / netInc −95.509）仅用于交叉核对，**不写入**——站内 ZH 无 `periodType=9m` 行。LI 业绩稿无 9M 表。

## 2. 分部（ZH，USD-M）

| end | Marketing services | Paid content and IP operations | Others | 合计 |
| --- | --- | --- | --- | --- |
| 2026-09-30 | 29.529 | 58.698 | 10.007 | 98.234 |

- `itemsCnyM` = 197.977 / 393.541 / 67.091，合计 658.609 = 本期 revenue；按 0.14915355 折回 USD-M 得 29.529 / 58.698 / 10.007，闭合。
- **只有 3 段**：公司自 2026Q1 起把 paid membership 与 IP operations 合并为 “Paid content and IP operations”，并对历史期追溯重述；站内 `companies.ZH` 历史 7 期仍按原口径，本期按新口径 3 段，口径断层已记录于此。
- 走 staging 机制：`data/staging/segments_2026q3.json` 加 `companies.ZH` 并把 `_meta.updated` 提到 2026-11-26，再跑 `scripts/merge_segments.mjs`（`added: 1 skipped: 319`，镜像 deepEqual=true）。未初始化新公司、未改任何历史期。

## 3. 自检

- **期数**：3,783 → 3,785（单季 3,405 → 3,407）；公司数 93；`updated` 2026-11-22 → 2026-11-26。
- **既有公司不变**：91 家（除 ZH/LI）逐家 `JSON.stringify` 对比 `HEAD:data/profit.json` → **0 差异**；顺序不变；`skipped/units/notes/failures/source/sourceUrl` 顶层字段无差异。
- **新行**：ZH/LI 各 20 → 21 期，末期为 2026-09-30，逐字段与已审 staging 一致（含 LI `opInc -699.612`）。
- **LI 2026-06-30 opInc 未动**：仍为 −2,182.152（与公司报 −2,300.850 差 118.698，DATA-QUALITY FLAG，本任务范围外，另行处理）。
- **镜像**：`data/profit.json.js` 剥 `window.__PROFIT_DATA = ` 前缀后与 json `deepEqual` = true；`data/segments.json.js` 同理。
- **整链重建**：`node scripts/merge_batches.mjs --out-dir=tmp-reb` → 93 / 3,785、`guardFails={}`；重建的 `profit.json` 与 `profit.json.js` 与磁盘**逐字节相等**。
  - `companies.json` 字节不同但语义 0 差异：`core.autocrlf=true` 下 checkout 为 CRLF、脚本输出 LF；归一后 `cmp` 一致，且该文件本任务未改。
- **守卫未放松**：`NEG_GROSS_OK`（MU/TSLA/PDD/00100.HK/00981.HK）、`MISSING_REV_OK`、`additivityErrs` 均为原样，未改一行。
- **stage 2**：`node scripts/merge_fundamentals.mjs` 未执行成功——本机缺 `tmp-backfill/`（未纳入 git）：
  `Error: staging backfill dir not found: …\profitbridge-b18\tmp-backfill (pass --backfill-dir=DIR)`。
  该 stage 只填空槽，ZH/LI 新行字段齐全、无 null，无需 enrich；强行造目录反而可能触及其它公司，故跳过。

## 4. 测试

`node scripts/serve.mjs 8971`（先确认 8971 空闲）→ `BASE=http://127.0.0.1:8971` 跑全部 32 个 `tests/verify_*.mjs`：

- 32 / 32 通过，0 失败。首轮 `verify_historical_netinc` 因硬编码期数 3,783 失败，已在本分支同步为 3,785（另一提交）。
- `verify_scan` 需以 `node tests/verify_scan.mjs --run` 调用（否则无输入 → “输入无法解析为 JSON”）：扫描 83 家、`errors === 0`、全部断言 PASS。
- 通过项含 `verify_metrics`、`verify_rebuild_idempotent`、`verify_units_guard`、`verify_seg_*`、`verify_timeline*`、`verify_bar*` 等。

## 5. 遗留 / 注意

1. LI 2026-06-30 `opInc` 与公司报表差 118.698（前述 flag），本任务明确不动。
2. `data/companies.json` 的 CRLF/LF 差异是既有 checkout 产物，非本次改动。
3. ZH 分部口径断层（2026Q1 合并 + 重述）只影响分部序列，不影响 `profit.json`。
