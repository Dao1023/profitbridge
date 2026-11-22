# 每日新财报扫描（automation）

每天 07:00（Asia/Shanghai）由 DSH 会话里的定时任务触发，执行：

```bash
cd profitbridge
git pull --ff-only
mkdir -p audits/daily
node scripts/scan_filings.mjs --out audits/daily/$(date +%F).json
```

## 契约

- 扫描**只读**：`scripts/scan_filings.mjs` 不修改 `data/` 下任何文件，其输出只是「待办清单」。
- 判定「新期」：源站最新可用报告期 `end` > 站内该公司最大 `end`。
- 判定「补字段候选」：同一期末，站内该期有字段为空而源站有值（仅 A 股；港股/美股结构性缺失太吵，降噪由脚本内 3 期规则处理）。
- SEC 6-K 的 `reportDate` 恒等于 `filingDate`，只作公告提醒，不判新期。
- **有增量才提交**：摘要写 `audits/daily/<YYYY-MM-DD>.md`，commit `chore(scan): 每日新财报扫描 <date>`；无增量只汇报、不提交。
- 本目录只放扫描产物与摘要；**补数一律走 `data/staging/` → `scripts/merge_batches.mjs`**，扫描任务本身不得改 `data/profit.json`。

## 已知盲区（脚本不覆盖）

| 类别 | 现状 | 影响 |
| --- | --- | --- |
| 国家电网 SGCC（上清所债券披露） | 不在扫描范围 | 季报/年报新增需人工或扩展脚本 |
| 韩股（KR，3 家） | 无免费源 | 需 DART key |
| 台股（TW，2 家） | 无 CIK、未接台股源 | 需 TWSE 接口 |
| 欧股（EU，2 家） | 无 CIK、未接欧股源 | 需交易所接口 |
| 私有/无 CIK（3 家） | 仅有公告页 | 人工关注 |

## 历史

- 2026-11-23：首次基线扫描，0 个新报告期；18 家美股/中概有近 21 天 6-K 提醒（BABA/NTES/PDD/JD/STM/SONY/TSM 等），见 `2026-11-23.json`。
