# profitbridge 审计记录 · 2026-11-01

审计触发：用户要求"多来几个 Agent 从各个角度审计项目可能的问题"，并要求每个 Agent 留下报告存档以便日后查证。
基线提交：`32ee861`（bar view: plot a segment sub-item on its OWN disclosed period axis）
审计基线时间：2026-11-01 22:40 (+08:00)

## 六个审计角度与交付位置

| 代号 | 角度 | 交付目录 | 状态 |
|---|---|---|---|
| A1 | 分部（segment）数据真实性与可疑点回源核对 | `audits/2026-11-01/A1-segment-data/` | 已交付（10 条：P0×5 / P2×4 / P3×1） |
| A2 | 利润表主数据（profit.json）正确性与缺口 | `audits/2026-11-01/A2-financials/` | 已交付（10 条：P2×4 / P3×6；190/190 回源一致） |
| A3 | 计算口径、单位换算、标签诚实性（代码级） | `audits/2026-11-01/A3-basis-labels/` | 已交付（10 条：P1×1 / P2×6 / P3×3） |
| A4 | 前端 UI/UX 与鲁棒性（真实浏览器实测） | `audits/2026-11-01/A4-ui-ux/` | 已交付（8 条：P1×1 / P2×5 / P3×2） |
| A5 | 工程质量、性能、测试盲区、仓库卫生 | `audits/2026-11-01/A5-engineering/` | 已交付（23 条：P1×1 / P2×13 / P3×9） |
| A6 | 数据覆盖度、完整性、可信度标注诚实性 | `audits/2026-11-01/A6-coverage/` | 已交付（13 条：high×4 / medium×5 / low×4） |

每个目录统一要求包含：`REPORT.md`（日期/范围/方法/一句话结论 + 分级发现）、`findings.json`（机读，含 verified/source，未证实项必须标 unconfirmed 且不得为 P0/P1）、`evidence/`（原始证据）。

## 审计纪律（对全体 Agent 生效）

- 只读：不改 `data/` 任何文件，不 git add/commit/push，只写自己的 `audits/...` 与 `tmp-audit/...` 草稿区。
- 端口隔离：8440 归主会话，审计各用 8445–8450；chrome CDP 9361–9366，各自独立 `--user-data-dir`。
- 每条发现必须有 `path:line` 或「公司/期/字段」+ 可核验来源；拿不到免费源写"无法证实"，禁止凭记忆填数。
- 严重度定义：P0 错数影响结论 / P1 功能不可用或明显错数 / P2 误导性标签或体验明显劣化 / P3 细节。

## 汇总（待填写）

- 去重合并后的总清单：见 `SUMMARY.md`（六路已全部回收，2026-11-01 23:20 生成；共 74 条 finding）
- 已确认并修复：无（修正候选尚未落库，见 SUMMARY.md §1、§6 数据批）
- 需用户拍板：①`!/audits/` 是否进 git；②`git gc` 授权；③static.yml 只发布运行期子集；④9 家 unitfail 与 BABA/15 家港股分部是否回收
