> 来源：profitbridge-lossbranch/tmp-lossbranch/REPORT.md（2026-11-20 归档）

# 桑基图「营业利润为负 → 图停在毛利」修复报告

分支 `fix/loss-branch` ・ worktree `C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge-lossbranch`
基线 `main` @ `16fcf69`（Merge branch 'data/batch11-20261119'）・交付 commit `4114745` + `00e603b`

---

## 0. TL;DR

| 项 | 结果 |
| --- | --- |
| 缺陷 | `op < 0` 时 `buildGraph()` 既不进 `op >= 0 && op <= gross` 分支、也不进 `else if (net != null)`（后者只在 gross 为 null 时可达），图**停在毛利**：只剩 营收→毛利 / 营收→营收成本 |
| 影响面（数据层） | **61 家公司 / 478 期**（`op<0`，或 `op` 缺失且 `net<0`） |
| 改法 | `gross != null && op < 0` 补「营业费用 → 营业亏损 → 净亏损/净利润」链路；`op` 缺失且 `net<0` 且 `gross` 有值时补「毛利 → 净亏损」。全部节点值取真实披露值，**不伪造、不摊派** |
| 数值自证 | 每期都有 `gross + |op| = opex`、`|op| + 税费差额 = |net|`、`net − op = 营业外收益` 恒等式（见 §2.4） |
| 回归 | 新增 `tests/verify_loss_branch.mjs`（**91 项断言**）；既有 20 个 `verify_*.mjs` + `verify_scan.mjs --run` 全绿 |
| op≥0 零改动 | 4 家健康公司（AAPL / MSFT / NVDA / 600887.SS）before/after **PNG 字节级完全相同**（sha256 一致，见 §3） |
| 批量扫描 | **0 期**同时缺 gross 与 net（无任何期会落到「连毛利都没有」的空图）；遗留 2 类**不在本次范围**的问题见 §7 |

---

## 1. 缺陷复现证据（before）

用未改动的主 checkout（`node scripts/serve.mjs 8441`）跑 headless CDP，读 `chart.getOption().series[0]`：

| 公司 / 期 | revenue | gross | opInc | netInc | before 节点数 | before 链路数 | 图上止于 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `01024.HK` 2026-09-30（快手 Q3 2026，CNY-M） | 31 592 | 15 216 | **−635** | −961 | **3** | **2** | 毛利 ¥15.2B |
| `00992.HK` 2026-09-30（联想 Q3 2026，USD-M） | 30 238 | 4 840.87 | **−117.08** | −639.86 | **3** | **2** | 毛利 $4.8B |
| `00100.HK` 2025-12-31（MiniMax FY2025，CNY-M） | 555.542 | 141.13 | **null** | −13 155.222 | **3** | **2** | 毛利 ¥0.1B |
| `01810.HK` 2018-06-30（小米 Q2 2018，CNY-M） | 45 235.473 | 5 651.81 | **−7 591.96** | **+14 651.318** | **3** | **2** | 毛利 ¥5.7B |

before 的节点集一律是 `["revenue","gross","cogs"]`，链路 `revenue→gross`、`revenue→cogs`（原始 dump 见 `tmp-lossbranch/probe-base.json`，截图 `tmp-lossbranch/shots/base-*.png`）。

**与工单描述的一处事实修正**：`00100.HK` 2025-12-31 的 `gross` 是**有值**的（141.13），所以它并**没有**走既有的 `else if (net != null)` 降级分支（那个分支只有在 `gross == null` 时才可达）。它和另外三家一样停在毛利。因此本次除了「op<0」链路，还必须补一支「op 缺失 + net<0 + gross 有值」，否则这家公司（以及同类 17 期）仍然看不到亏损。§6 的扫描给出了这一类的准确数量：**17 期**。

---

## 2. 改法

### 2.1 新增分支（`app.js:643-697`）

```js
} else if (op != null && op < 0 && gross > 0) {
  const loss = -op;                 // |op| > 0
  const opexVal = gross - op;       // = gross + |op|：真实的营业费用
  nodes.push({ name: 'opex', value: opexVal, depth: revDepth + 2, itemStyle: { color: RED } });
  links.push({ source: 'gross', target: 'opex', value: gross });        // 入流只有毛利
  nodes.push({ name: 'loss', value: loss, depth: revDepth + 2, itemStyle: { color: RED }, neg: true });
  links.push({ source: 'opex', target: 'loss', value: loss });          // 费用超出毛利的差额
  if (net != null) {
    if (net < 0) {                  // 亏损被税项/营业外进一步放大
      const netLossVal = -net, deeper = netLossVal - loss;              // = op - net
      nodes.push({ name: 'netLoss', value: netLossVal, depth: revDepth + 3, itemStyle: { color: RED }, neg: true });
      links.push({ source: 'loss', target: 'netLoss', value: Math.min(loss, netLossVal) });
      if (deeper > 0) {             // 差额单独画一条红入流
        nodes.push({ name: 'taxOther', value: deeper, depth: revDepth + 2, itemStyle: { color: RED }, neg: true });
        links.push({ source: 'taxOther', target: 'netLoss', value: deeper });
      } else if (deeper < 0) {      // 营业外收益缩小亏损但没转正 → 金色
        nodes.push({ name: 'nonop', value: -deeper, depth: revDepth + 2, itemStyle: { color: GOLD } });
        links.push({ source: 'loss', target: 'nonop', value: -deeper });
      }
    } else {                        // 亏损被营业外收益转正
      nodes.push({ name: 'nonop', value: net - op, depth: revDepth + 2, itemStyle: { color: GOLD } });
      nodes.push({ name: 'net', value: net, depth: revDepth + 3, itemStyle: { color: GREEN } });
      links.push({ source: 'loss', target: 'nonop', value: loss });
      links.push({ source: 'nonop', target: 'net', value: net });
    }
  }
} else if (op == null && net != null && net < 0 && gross > 0) {
  nodes.push({ name: 'netLoss', value: -net, depth: revDepth + 2, itemStyle: { color: RED }, neg: true });
  links.push({ source: 'gross', target: 'netLoss', value: Math.min(gross, -net) });
}
```

语义：

* `营业费用` 节点的高度 = `gross − op` = 真实披露的营业费用（**含超出毛利的部分**）；`gross → 营业费用` 的入流只给毛利（费用由毛利 + 亏损共同承担）。
* `营业亏损` 节点 = `|op|`，是「营业费用比毛利多出来的那一截」。
* 若 `net < 0`：`净亏损` = `|net|`，与营业亏损之间的差额（`|net| − |op|`，税项 / 营业外）如实画成一条独立入流，**不给净亏损节点注水**。
* 若 `net ≥ 0`：`非经营性收益` = `net − op`（>0），金色，把亏损翻正成绿色净利润——这正是「op 为负但靠营业外收益盈利」的公司（小米 2018Q2）。
* `op` 缺失且 `net<0`：`毛利 → 净亏损`，块高 = `|net|`，入流只有毛利；块比入流高出的那部分就是**未披露的营业费用 + 税项**，不编造任何中间数字。

### 2.2 为什么允许「入流 < 节点值」（关键机理）

ECharts 5.6 的 sankey 里，**节点块高 = max(显式 value, Σ入流, Σ出流)**，链路宽度只按 `link.value` 画，节点不会因为入流小而缩放，也不会报错。我做了三格实测页（`tmp-lossbranch/echarts-probe.html`，截图 `tmp-lossbranch/shots/echarts-probe.png`）：

| 情形 | 设置 | 渲染结果 | console error |
| --- | --- | --- | --- |
| A | `value=5`，入流 10 | 块被撑到 10 | 0 |
| B | `value=10`，入流 10、出流 3 | 块 10，底部空出一截（**入流=节点值、出流<节点值**） | 0 |
| C | `value=5`，出流 10 | 块被撑到 10 | 0 |

既有代码里的 `DEGRADED_RESIDUAL`（`undisclosedCost`）本来就依赖这个特性：`revenue → 未披露成本费用` 的块高取 `revenue`，入流也只有 `revenue`，而出流只有 `|net|`，底部同样是空的。

本次的用法**与之同构、方向相反**：节点值取真实披露值（`opex = gross − op`、`netLoss = |net|`），入流取真实流转量（毛利、营业亏损），差额（= 亏损本身）就由「块比入流高出的那截」表达。**没有为了让图好看而改任何数字**：每个 label 上的数字都等于数据里的真实值（÷1000 换成 $B）。反过来说，如果强行把 `|op|` 摊进 `cogs`/`opex` 让「入流=节点值」闭合，label 上的数字就与 `data/profit.json` 不符了——那才是伪造。

### 2.3 标签、颜色、其余 6 处改动

| 位置（改动后行号） | 改动 |
| --- | --- |
| `app.js:47` | I18N zh `loss: '经营亏损' → '营业亏损'`（en 仍是 `Operating loss`） |
| `app.js:171` | `KEY_ALIAS = { netLoss: 'net', loss: 'op' }`（QoQ 标签把 `loss` 映射回 `opInc`） |
| `app.js:643-697` | §2.1 的两条分支 |
| `app.js:741` | `linkColor()`：`if (l.target === 'nonop') return GOLD;`（亏损→营业外收益的入流用金色，和盈利侧一致） |
| `app.js:813-816` | `nodeLabel()`：`const neg = p.data && p.data.neg === true;`，金额变 `−¥B`（**只对 `neg:true` 的节点生效**，其余节点渲染字节不变） |
| `app.js:832` | 占比模式同样加 `−` 前缀（`−2.0% 占营收`） |
| `app.js:874` | `renderChart()` 数据映射：`if (n.neg) d.neg = true;` |

`neg` 是唯一新增的数据字段，未设置的节点走原来完全相同的代码路径——这是 §3 像素级等价的前提。

### 2.4 数值恒等式（每期自证，$B）

| 期 | 恒等式 1 | 恒等式 2 | 恒等式 3 |
| --- | --- | --- | --- |
| `01024.HK` 2026-09-30 | gross 15.216 + \|op\| 0.635 = opex **15.851** ✓ | \|op\| 0.635 + 税费 0.326 = \|net\| **0.961** ✓ | — |
| `00992.HK` 2026-09-30 | 4.841 + 0.117 = **4.958** ✓ | 0.117 + 0.523 = **0.640** ✓ | — |
| `01810.HK` 2018-06-30 | 5.652 + 7.592 = **13.244** ✓ | — | net 14.651 − op(−7.592) = nonop **22.243** ✓ |
| `00100.HK` 2025-12-31 | — | netLoss 13.155 = \|net\|（块高出毛利 0.141 的部分即未披露费用+税） | — |

---

## 3. before / after 截图对照（1600×1000，Chrome `--headless=new`）

before = 未改动的主 checkout（8441）；after = 本分支（8440）。同机、同 Chrome、同 profile 参数、动画 settle 后截图。

| 文件 | 节点/链路 | 字节 | sha256(12) |
| --- | --- | --- | --- |
| `shots/base-01024.HK-2026-09-30.png` | 3 / 2 | 115 448 | `9e847c6e69a9` |
| `shots/after-01024.HK-2026-09-30.png` | **7 / 6** | 131 972 | `c37e70c391ed` |
| `shots/base-00992.HK-2026-09-30.png` | 3 / 2 | 122 031 | `766e9f73a242` |
| `shots/after-00992.HK-2026-09-30.png` | **7 / 6** | 138 571 | `d2d559c64802` |
| `shots/base-00100.HK-2025-12-31.png` | 3 / 2 | 107 473 | `4fd021419b75` |
| `shots/after-00100.HK-2025-12-31.png` | **4 / 3** | 115 394 | `78b28d33788a` |
| `shots/base-01810.HK-2018-06-30.png` | 3 / 2 | 115 728 | `9a46e0c00c4a` |
| `shots/after-01810.HK-2018-06-30.png` | **7 / 6** | 133 901 | `76ea9a2f863e` |

健康对照（op ≥ 0，**必须一像素级等价**）：

| 公司 | 节点/链路（before = after） | before sha256 | after sha256 | 判定 |
| --- | --- | --- | --- | --- |
| `AAPL` 2026-09-26 | 8 / 7 | `f301b1ef4674` | `f301b1ef4674` | **字节相同** |
| `MSFT` 2026-09-30 | 9 / 8 | `b7fccd9dc87c` | `b7fccd9dc87c` | **字节相同** |
| `NVDA` 最新期 | 12 / 11 | `ba12b9845a1e` | `ba12b9845a1e` | **字节相同** |
| `600887.SS` 最新期 | 7 / 6 | `e5a5c1748d40` | `e5a5c1748d40` | **字节相同** |

> 像素对比方法说明：早期一次对比出现 MSFT 差异，定位为截图抢在 sankey 动画结束前（ECharts 默认 800–1000ms 动画），加 1.4s settle 后四家**全部字节一致**。即 op≥0 路径不仅「看起来一样」，canvas 输出完全相同。

---

## 4. 测试

见下节表格（本轮结果）。

新增回归 `tests/verify_loss_branch.mjs`（91 项断言，`node tests/verify_loss_branch.mjs`）：

* `01024.HK` / `00992.HK` / `01810.HK`（op<0 且有 gross）
  * 数据侧先自证 `opInc < 0`、`gross > 0`；
  * 存在 `loss`（显示名 **营业亏损**）节点，`|value×B/fx − |opInc|| / |opInc| < 1%`；
  * 该节点 label 文本含 `−¥0.6B` 形式（`neg` 生效，符号来自数据而非硬编码）；
  * 节点色 `#dc2626`（RED）；
  * `opex` 节点 = `gross − op`（<1% 误差），且 `opex > gross`；
  * 链路 `gross→opex` 只承载毛利、`opex→loss` 恰为 `|op|`；
  * `net<0` 时：`netLoss` 节点 = `|net|`（<1%），其所有入流之和 = 节点值，`taxOther` = `|net| − |op|` 且 label 带负号；
  * `net>0` 时（小米）：`nonop` = `net − op` 且为金色 `#d4a017`，`net` = `netInc`，`loss→nonop→net` 连通；
  * 无 NaN/Infinity；`series[0].data.length`、`links.length` 可读；console 无 error；每条链路端点都存在于节点集。
* `00100.HK` 2025-12-31（op 为 null、net<0、gross 有值）：`netLoss` 出现且 = `|net|`；**不**凭空造 `loss` 节点；`gross→netLoss` 入流 ≤ 毛利；无 NaN/console error。
* 对照（op≥0）：`AAPL` 节点集恰为 `["cogs","gross","net","op","rd","revenue","sga","taxOther"]`、7 条链路；`MSFT` 为 `["cogs","gross","net","op","opex","revenue","taxOther"]`、8 条链路；两者都**无** `loss`/`netLoss` 节点；`op` 节点仍为绿色。
* 标签模式回归：`01024` 在占比模式（`−2.0% 占营收 · −¥0.6B`）与 QoQ 模式下仍正常、无 NaN、无 error。

### 4.1 全套结果（`node tests/verify_*.mjs` + `verify_scan.mjs --run`，服务 `8440`）

| # | 测试 | 结果 |
| --- | --- | --- |
| 1 | `tests/verify_bar.mjs` | PASS 34/34 |
| 2 | `tests/verify_bar_basis_labels.mjs` | PASS 26/26 |
| 3 | `tests/verify_bar_cum_growth.mjs` | PASS 31/31 |
| 4 | `tests/verify_bar_lines.mjs` | PASS 15/15 |
| 5 | `tests/verify_cum_seg.mjs` | PASS 27/27 |
| 6 | `tests/verify_currency.mjs` | PASS 6/6 |
| 7 | `tests/verify_export.mjs` | PASS 11/11 |
| 8 | `tests/verify_filter_jitter.mjs` | PASS 19/19 |
| 9 | `tests/verify_header_layout.mjs` | PASS 183/183 |
| 10 | `tests/verify_layout_refactor.mjs` | PASS 23/23 |
| 11 | **`tests/verify_loss_branch.mjs`（新增）** | **PASS 91/91** |
| 12 | `tests/verify_modes.mjs` | PASS 31/31 |
| 13 | `tests/verify_new.mjs` | ALL PASS |
| 14 | `tests/verify_pct_fix.mjs` | PASS 32/32 |
| 15 | `tests/verify_seg_annual_quarters.mjs` | PASS 16/16 |
| 16 | `tests/verify_seg_axis.mjs` | PASS 11/11 |
| 17 | `tests/verify_seg_notes.mjs` | PASS 27/27 |
| 18 | `tests/verify_state_memory.mjs` | PASS 11/11 |
| 19 | `tests/verify_timeline2.mjs` | PASS 21/21 |
| 20 | `tests/verify_timeline_click.mjs` | PASS 15/15 |
| 21 | `tests/verify_units_guard.mjs` | ALL PASS |
| 22 | `node tests/verify_scan.mjs --run` | 全部通过（扫描 83 家，errors 0） |

**20 个既有测试一个都没改**（`git status` 只有 `app.js` 与新增测试文件），零 exit≠0、零 FAIL 行 —— 说明本次改动没有触碰任何既有断言所依赖的行为（包括 op≥0 的节点/链路集合、H1/FY 累计对账、导出、i18n 文案、布局快照）。

原始日志：`tmp-lossbranch/suite.log`。

---

## 5. 导出验证（点一次导出）

`tmp-lossbranch/export-check.mjs`：在亏损期 `01024.HK` 2026-09-30 上执行页面内真实导出函数。

| 检查 | 结果 |
| --- | --- |
| `exportSVG()` 返回字符串 | PASS，len = 9 678 |
| SVG 文件写入 `tmp-lossbranch/exports/01024.HK-2026-09-30.svg` | PASS，9 875 bytes |
| SVG 内含 `营业亏损` | PASS |
| SVG 内含 `净亏损` | PASS |
| SVG 内含公司名 `快手` | PASS |
| SVG 内含期间表头 `Q3 2026` | PASS |
| `exportPNG()` 解析出 PNG data URL | PASS，436 798 chars |
| PNG 文件 `tmp-lossbranch/exports/01024.HK-2026-09-30.png` | PASS，327 580 bytes，magic bytes = `PNG` |
| console error | 0 |

即：新增的亏损节点不仅上屏，也能被 SVG / PNG 导出正常带出（SVG 里就是文本节点，可直接检索）。

---

## 6. 批量扫描（全站 92 家 / 3 727 期）

方法：在页面里对**每一期**调用真实的 `sankeySegPlan()` + `buildGraph()`（与渲染同一条代码路径，但不渲染），按「图上实际画出了什么」分类。脚本 `tmp-lossbranch/scan.mjs`，原始结果 `tmp-lossbranch/scan.json`。

| 分类 | 期数 | 说明 |
| --- | --- | --- |
| `new_opLossBranch` | **412** | `op<0 && gross>0` → 本次新增链路（营业亏损 + 净亏损/净利润） |
| `new_netLossOnlyBranch` | **17** | `op` 缺失、`net<0`、`gross>0` → 本次新增的「毛利→净亏损」（含 `00100.HK` 2025-12-31） |
| `lossViaOtherBranch` | 29 | `gross == null` → 既有 `netLoss + undisclosedCost` 降级路径（未改动） |
| `lossNotPainted` | 12 | 见 §7（11 期 `gross ≤ 0` + LKNCY 1 期，都是**另一类**缺陷） |
| `has_lossNode` / `has_netLossNode` / `has_degradedResidual` | 412 / 465 / 156 | 全站出现这些节点的期数 |
| **`outsideAllBranches`（既没有 gross 也没有 net）** | **0** | ← 就是工单要的那个数：**没有任何一期会落到连毛利都没有的空图** |
| NaN / Infinity | **0** | 全部 3 727 期的节点值 + 链路值 |
| console error（扫描过程） | **0** | — |

数据层（直接读 `data/profit.json`，不看渲染）复算：`(opInc<0) || (opInc==null && netInc<0)` 共 **61 家公司 / 478 期**，与工单给出的数字一致（`tmp-lossbranch/datascan.json`）。

> 478（数据层）vs 470（渲染层 412+17+29+12）的差：8 期是「半年/FY 累计口径对账」（`sankeySegPlan` 的 `cum` 合并）把 `opInc/netInc` 改成了另一组值，因此按**有效期**不再是亏损期。两者都对，只是口径不同。

**结论**：改造后全站不存在「既无 gross 又无 net」的期；也不存在因本次改动而新出现的 NaN / 空图。

---

## 7. 未纳入本次范围（同一症状、不同病因，需要拍板）

批量扫描顺带挖出两类**仍然会停在毛利**的期，它们和本次修复的 bug 不同源，我没有擅自扩大改动面：

### 7.1 `op` 缺失、`net ≥ 0`、`gross` 有值 —— **101 期**

例：`MSFT` 2007-09-30（gross 11 087、net 4 289）、`IBM` 2009-2010 各季（gross 9 431 / net 2 295 …）。
这些期 `op` 为空，既不满足 `op>=0`、也不满足我新增的 `op<0` 与 `net<0` 两个条件，于是图停在 营收→毛利。**语义上不缺亏损，只是缺 净利润 与 费用**。

修法是 §2.1 第二条分支的镜像（`gross → net` + `gross → 未披露成本费用`），约 5 行，风险同样局限在 `op == null` 的期（不碰 op≥0 路径）。要不要做，请拍板。

### 7.2 `gross ≤ 0`（负毛利）—— **11 期**

`TSLA` 2012-09-30（gross −8.8）、`MU` 2023 年 5 期（−1 206 … −35）、`PDD` 2016-12-31（−73）、`00981.HK` 2008-2009 三期、`00100.HK` 2023-12-31（−6.05）。
这些期的 `gross` 节点本身就是**负值**，ECharts 里画出来是个 0 高度/异常块，`revenue→gross` 链路因 value<0 被 `cleanLinks` 过滤掉——before/after 完全一致（`shots/negbase-TSLA-2012-09-30.png` vs `shots/negafter-...png`，节点集都是 `["revenue","gross","cogs"]`，error 0），所以本次**没有**让它变差，但也**没有**治好：负毛利本身需要一套「毛利为负」的表达（例如把负毛利并入营收成本、再单独标红）。这属于另一个 bug。

旁证：数据管道本身早就知道「负毛利是真实数据」——`scripts/fetch_profit.mjs:54`、`scripts/merge_batches.mjs:114`、`scripts/merge_fundamentals.mjs:35` 都维护着 `NEG_GROSS_OK` 白名单（`MU` / `TSLA` / `PDD` / `00100.HK` / `00981.HK`），与我扫出来的 5 家公司**完全吻合**。也就是说：数据侧已确认合法，缺的只是前端的画法。

### 7.3 `LKNCY` 2021-12-31 —— 1 期

`op = −539.1` 但 `net = +578.7`、且 `gross == null`：走既有降级路径画 `revenue → net + undisclosedCost`，营业亏损未单列。属于「无 gross 时的亏损表达」，同样在本次范围外。

---

## 8. 复现命令

```bash
# 服务（worktree）
cd C:/Users/Dao/Code/dao1023/dsh-temp/profitbridge-lossbranch
node scripts/serve.mjs 8440 &

node tests/verify_loss_branch.mjs            # 新增回归（91 checks）
node tmp-lossbranch/scan.mjs                 # 全站 3727 期分类扫描
node tmp-lossbranch/export-check.mjs         # SVG/PNG 导出验证
node tmp-lossbranch/probe.mjs after          # 4 亏损 + 4 健康截图（BASE 默认 8440）
BASE=http://127.0.0.1:8441 PORT=9403 node tmp-lossbranch/probe.mjs base   # before 基线
```

`tmp-lossbranch/` 下所有脚本与产物**不入库**（`.gitignore` 只白名单 `tests/`、`vendor/`）。

---

## 9. 变更清单

两个 commit（未 push，未 rebase，未改 `data/`）：

```
4114745  fix(sankey): 营业利润为负时补营业亏损/净亏损链路
         app.js  +64 −4   （6 处：I18N / KEY_ALIAS / buildGraph 两条分支 /
                           linkColor / nodeLabel / d.neg 透传）
00e603b  test(sankey): 锁定营业亏损/净亏损链路（91 项断言）
         tests/verify_loss_branch.mjs  新增 227 行
```

`git diff --stat 16fcf69..HEAD`：

```
 app.js                       |  68 ++++++++++++-      (+64 −4)
 tests/verify_loss_branch.mjs | 227 +++++++++++++++++++   (新增)
 2 files changed, 291 insertions(+), 4 deletions(-)
```

app.js 的 6 处改动（行号为改后）：

| 位置 | 改动 |
| --- | --- |
| `app.js:47` | I18N zh `loss: '经营亏损'` → `'营业亏损'`（en 保持 `Operating loss`；该键此前闲置） |
| `app.js:171` | `KEY_ALIAS` 增加 `loss: 'op'`，使亏损节点在 QoQ 模式下复用 `opInc` 的环比 |
| `app.js:643-697` | `buildGraph()` 两条新分支（`op<0 && gross>0`、`op==null && net<0 && gross>0`），共 55 行 |
| `app.js:741` | `linkColor()`：`target === 'nonop'` → GOLD（亏损被营业外收益转正的那条入流） |
| `app.js:813-816`、`832` | `nodeLabel()`：`neg` 节点金额与占比前缀 `−` |
| `app.js:874` | `renderChart()`：`if (n.neg) d.neg = true;` 把标记透传给 ECharts 数据项 |

`op≥0` 的原有分支（`app.js:628` / `644` / `649` / `662`）**一行未动**。
