> 来源：profitbridge-oneoff/tmp-oneoff/REPORT.md（2026-11-20 归档）

# 「净利润 > 营收」11 期登记（known_one_offs）实施报告

- 日期：2026-11-20
- 仓库：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge`
- 工作树：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-oneoff`（branch `docs/known-oneoffs`）
- 基线：`cd85f06`（Merge branch 'data/skhy-opinc-q3'）
- 约束：未修改 `data/profit.json`、`data/segments.json`、`app.js`、`tests/`；未 push/rebase。

## 1. 11 期逐条核对（任务清单 vs `data/profit.json`）

核对方法：`node` 读取 `data/profit.json`，按 `ticker + end` 取 `quarters[]`，与任务清单逐条比较，使用严格相等（`===`，不做容差）；另全站扫描 `netInc > revenue` 校验「恰好 11 期、无遗漏/无多余」。

金额单位＝各公司 `currency` 本位币 `-M`，未换汇。

| # | ticker | end | 任务清单 rev / netInc | profit.json rev / netInc | 差异 | 结论 |
|---|---|---|---|---|---|---|
| 1 | AVGO | 2018-02-04 | 5327 / 6230 | 5327 / 6230 | 0 / 0 | 一致 |
| 2 | DUOL | 2025-09-30 | 271.713 / 292.195 | 271.7 / 292.2 | −0.013 (−0.0048%) / +0.005 (+0.0017%) | 站内为 1 位小数入库，按 profit.json 登记 |
| 3 | TCOM | 2025-09-30 | 18338 / 19890 | 18338 / 19890 | 0 / 0 | 一致 |
| 4 | XNET | 2025-06-30 | 103.545 / 727.590 | 103.545 / 727.59 | 0 / 0 | 一致（末位 0 只是写法） |
| 5 | XNET | 2025-09-30 | 125.93 / 550.252 | 125.93 / 550.252 | 0 / 0 | 一致 |
| 6 | XNET | 2025-12-31 | 460.4 / 1048.265 | 460.4 / 1048.3 | 0 / +0.035 (+0.0033%) | 站内 1 位小数，按 profit.json 登记 |
| 7 | 03888.HK | 2017-12-31 | 1380.498 / 2474.863 | 1380.498 / 2474.863 | 0 / 0 | 一致 |
| 8 | 03888.HK | 2020-06-30 | 1420.118 / 9151.3 | 1420.118 / 9151.331 | 0 / +0.031 (+0.0003%) | 站内 3 位小数，按 profit.json 登记 |
| 9 | 601360.SS | 2019-06-30 | 3221.843 / 3405.048 | 3221.84 / 3405.05 | −0.003 (−0.0001%) / +0.002 (+0.0001%) | 站内 2 位小数，按 profit.json 登记 |
| 10 | CBRS | 2025-06-30 | 103.322 / 309.512 | 103.3 / 309.5 | −0.022 (−0.0213%) / −0.012 (−0.0039%) | 站内 1 位小数，按 profit.json 登记 |
| 11 | 000660.KS | 2026-06-30 | 79318746 / 93820236 | 79318746 / 93820236 | 0 / 0 | 一致 |

**结论：11/11 全部核对通过，0 条实质不一致。** 5 条存在末位四舍五入（DUOL、XNET 2025-12-31、03888.HK 2020-06-30、601360.SS、CBRS），最大相对差 **0.0213%**（CBRS revenue），远小于审计容差 0.5%；登记表一律采用 `profit.json` 的站内值，以保证与数据源逐位一致。

补充（000660.KS）：站内 `netInc` 93,820,236（KRW-M）与 SK hynix 2Q26 官方新闻稿的 93,922.6（十亿韩元）相差 **−0.11%**，属既有采集口径差（`data/staging/batch13.json` 已记录：站内取 stockanalysis 第二源），非本轮引入；任务清单给定的 93,820,236 与 `profit.json` 一致，本轮不改数。

全站集合校验：`data/profit.json` 中 `netInc > revenue` 的期次**恰好 11 条**，与登记表 11 条双向包含（无遗漏、无多余）。

## 2. `data/known_one_offs.json`

- 纯登记表，**app 不消费**；`generatedAt: "2026-11-20"`，`description` 说明「真实披露值、非数据错误、自动审计应跳过或标注」。
- `entries[]` 11 条，每条含 `ticker / end / revenue / netInc / reason / source`；`source` 带官方文件标识与 URL（SEC 10-K/10-Q/6-K/S-1/20-F、HKEXnews、东财/巨潮 PDF、SK hynix 新闻稿）。
- 数值由脚本从 `data/profit.json` 读取后写入（`tmp-oneoff/build_registry.mjs`），不是手工抄写，避免二次录入误差。

## 3. 文档更新

### `docs/KNOWN_CAVEATS.md`

新增两节（插在第七节之后、修订记录之前）：

- **第八节「净利润 > 营收的 11 期：一次性收益（2026-11-20 登记）」**：11 行表（ticker / 期 / 净利率 / 一次性来源），正文写明「审计已逐条回源核实，0 条数值错误；`data/known_one_offs.json` 为机器可读版本」，并附 601360.SS 营业利润含投资收益的口径提示、四舍五入说明、不改数结论。
- **第九节「口径澄清：`units` 只是展示标签，量纲必须读 `currency`」**：明确 `units`（如 `"$M"`）仅为展示标签，真实量纲读 `currency`（USD-M / CNY-M / KRW-M / JPY-M…）；港/A 股 CNY-M 未换汇，只看 `units` 会误判约 7 倍（附 03888.HK 实例）。
- 修订记录追加一条「新增登记 2」。

### `scripts/PIPELINE.md`

过时统计快照更新为现状：

| 位置 | 旧 | 新 |
|---|---|---|
| 第 40 行 | 92 companies / 3731 periods | 92 companies / **3732** periods |
| 第 66 行 | 92 companies / 3731 periods；1,006,825 B LF / 1,045,820 B CRLF | 92 companies / **3732** periods；**1,007,117 B** LF / **1,046,123 B** CRLF |

字节数按 `git cat-file -s HEAD:data/profit.json`（LF blob）与工作区 CRLF 文件重新实测；全文再无其它写死的旧期数（`grep 3731/1,006,825/1,045,820` 无残留）。该快照随后被 `verify_rebuild_idempotent.mjs` 实测证实：`disk: companies=92 periods=3732`、stage1 输出与磁盘逐字节一致（`1007117 B`）、`期数不丢（3732 -> 3732）`。

## 4. 验证

- 结构/数值断言：`node tmp-oneoff/verify_registry.mjs` → **ALL PASS**（11 条、六字段齐全、类型正确、去重、逐条 `===`、全站集合双向相等）。
- 任务要求的等价 `node -e` 断言 → `OK: 11 entries all exactly equal to profit.json`。
- 浏览器回归：`tests/verify_*.mjs`（除 `verify_scan` 外 26 个）全部通过，**26/26**。
- `node tests/verify_scan.mjs --run` → `verify_scan: 全部通过`（exit 0）。
- 服务：`node scripts/serve.mjs 8881`，`BASE=http://127.0.0.1:8881`；测试后已停止。

## 5. 提交

| commit | 内容 |
|---|---|
| `07b3833` | `data/known_one_offs.json`（11 条登记表） |
| `c832c0c` | `docs/KNOWN_CAVEATS.md`（第八/九节 + 修订记录）、`scripts/PIPELINE.md`（92/3732 统计） |

工作树 `git status` 干净；未 push、未 rebase。
