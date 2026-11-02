# 审计增补 · 2026-11-01 23:40（数据批落库后）

## 闸门记录
- 数据批 commit `571f15a`（父 `32ee861`），15 个测试文件全绿（filter_jitter 曾因汇率修正 18/19，改按 A 方案重算 HUAWEI 分部美元值后 19/19），已推送，`HEAD == origin/main`。
- 直接编辑而非走 staging+merge 的原因：`scripts/merge_segments.mjs` 为 append-only，历史期修正会 `CONFLICT ... refusing to overwrite`（exit 1）。修正记录落在 `data/staging/segment_fixups_2026-11-01.json`（TSLA/MSFT 逐值 + `huawei_segment_fx_rescale` 段）。

## 新增发现 HUAWEI-SEG-01：2022/2023 分部合计比合并营收高 4.4%

- 现象：重算后 `segSum` 与 `revenue × fxToUsd` 的偏差，2019/2020/2021/2024/2025 均 ≤0.0039%（两位小数舍入量级），唯 **2022-12-31 +4.4066%、2023-12-31 +4.3418%**；该偏差与原基线（旧汇率）下完全相同，与本次汇率修正无关。
- 复核方式（审计负责人独立反算）：以修正后的 fxToUsd 反推各分部人民币值，得到**整数级**数字：
  - 2022：ICT Infrastructure 353,978 / Consumer 214,463 / Cloud 45,342 / Digital Power 50,806 / Intelligent Automotive 2,077 / Other 3,978（CNY-M）
  - 2023：ICT Infrastructure 361,997 / Consumer 251,496 / Cloud 55,287 / Digital Power 52,607 / Intelligent Automotive 4,737 / Other 8,624（CNY-M）
  这些即华为年报披露的分部收入原值（2022 合计 670.6B vs 营收 642.3B；2023 合计 734.7B vs 营收 704.2B）。
- 结论：**不是我方错数**。华为 2022/2023 的分部收入表按未抵消内部交易的口径披露，故分部合计 > 合并营收；2024 年起其口径改为合计恰等于营收（2024 反算 369,903+339,006+38,523+68,678+26,353+19,609 = 862,072 = 营收，2025 同理）。
- 处理：**保留原始披露值，不做归一化**（归一化等于把公司口径改成我方口径，属篡改）。待办：在 `data/segments.json` 的 `notes` 为 HUAWEI 加一条口径说明（"2022/2023 分部合计含未抵消内部交易，高于合并营收约 4.4%；2024 起同口径"），并在 UI 侧对"分部合计≠营收"的公司不误报为数据错误。
- 严重度：P2（展示层口径说明缺失），非数值错误。
