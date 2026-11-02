# 证据 · app.js 关键函数原文（带行号，快照 2026-11-01，1577 行）

> 以下为 `profitbridge/app.js` 相关函数的逐字原文，供 REPORT.md 引用核对。

## 1) quarterLabel —— app.js:78-82（不识别 'annual'，interim 用日历年）
```js
78|function quarterLabel(end, periodType) {
79|  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
80|  if (periodType === 'interim') return `H1 ${y}`;
81|  return isAnnual() ? `FY ${y}` : `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
82|}
```

## 2) profitRowIsCumulative / CUM_SEG_TYPES —— app.js:338-345
```js
338|const CUM_SEG_TYPES = new Set(['half', 'FY', 'annual', 'mixed']);
339|function profitRowIsCumulative(tk, qv) {
340|  const e = DATA.companies[tk];
341|  if (e.frequency === 'annual') return true; // 20-F rows are FY cumulative
342|  if ((e.frequency === 'hk-mixed' || e.frequency === 'mixed') &&
343|      (qv.periodType === 'annual' || qv.periodType === 'interim')) return true;
344|  return false;
345|}
```

## 3) fiscalYearEndMonth —— app.js:362-385（平票含 12 取 12）
```js
362|function fiscalYearEndMonth(tk) {
363|  const e = DATA.companies[tk] || {};
364|  const annual = (e.quarters || []).filter(o => o.periodType === 'annual');
365|  if (annual.length) return Number(annual[annual.length - 1].end.slice(5, 7));
366|  const s = SEG && SEG.companies[tk];
367|  if (s && s.periodTypes) {
368|    const cnt = {};
369|    for (const k in s.periodTypes) {
370|      const tp = s.periodTypes[k];
371|      if (tp === 'annual' || tp === 'FY') { const mm = Number(k.slice(5, 7)); cnt[mm] = (cnt[mm] || 0) + 1; }
372|    }
373|    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
374|    if (best) return Number(best[0]);
375|  }
376|  const cnt = {};
377|  (e.quarters || []).slice(-8).forEach(o => { const mm = Number(o.end.slice(5, 7)); cnt[mm] = (cnt[mm] || 0) + 1; });
378|  const entries = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
379|  if (entries.length) {
380|    const top = entries[0][1], tied = entries.filter(x => x[1] === top).map(x => Number(x[0]));
381|    return tied.includes(12) ? 12 : tied[0];
382|  }
383|  return 12;
384|}
```

## 4) periodCoveredMonths / barPeriodLabel / barBasisInfo / barBasisTag —— app.js:393-432
```js
393|function periodCoveredMonths(tk, qv) {
394|  const endMonth = Number(qv.end.slice(5, 7));
395|  const fye = fiscalYearEndMonth(tk);        // M, 1–12
396|  const startMonth = (fye % 12) + 1;         // fiscal-year start month = M+1 (12 → 1)
397|  return ((endMonth - startMonth + 12) % 12) + 1;
398|}
402|function barPeriodLabel(tk, qv) {
403|  const mm = Number(qv.end.slice(5, 7));
404|  const yy = qv.end.slice(2, 4), yr = qv.end.slice(0, 4);
405|  const qn = Math.floor((mm - 1) / 3) + 1;
406|  if (qv.periodType === 'annual' || isAnnual(tk)) return 'FY ' + yr; // annual row / series: unchanged
407|  if (!profitRowIsCumulative(tk, qv)) return `Q${qn}'${yy}`;         // true single quarter: unchanged
408|  const cm = periodCoveredMonths(tk, qv);
409|  if (cm <= 3) return `Q${qn}'${yy}`;
410|  if (cm <= 6) return `H1'${yy}`;
411|  if (cm <= 9) return `9M'${yy}`;
412|  return 'FY ' + yr;                                                // >=10 months → full-year cumulative
413|}
419|function barBasisInfo(tk, qv) {
420|  const annualRow = qv.periodType === 'annual' || isAnnual(tk);
421|  const months = periodCoveredMonths(tk, qv);
422|  const cumulative = !annualRow && profitRowIsCumulative(tk, qv) && months > 3;
423|  return { annualRow, months, cumulative, decal: cumulative && months <= 9 };
424|}
426|function barBasisTag(tk, qv) {
427|  const cm = periodCoveredMonths(tk, qv);
428|  if (cm <= 3) return '';
429|  if (cm <= 6) return 'H1';
430|  if (cm <= 9) return '9M';
431|  return 'FY';
432|}
```

## 5) cumulativeView —— app.js:443-470（第 450 行 pt 取自 SEGMENTS；453 行 fye≠12 门；454 ytd<2 门）
```js
443|function cumulativeView(tk, qv) {
444|  const s = SEG && SEG.companies[tk];
445|  if (!s) return null;
449|  if (!s.quarters || !s.quarters[qv.end]) return null;
450|  const pt = (s.periodTypes && s.periodTypes[qv.end]) || s.periodType;
451|  if (!CUM_SEG_TYPES.has(pt)) return null;       // segment is single-quarter → nothing to fix
452|  if (profitRowIsCumulative(tk, qv)) return null; // profit row already cumulative
453|  if (fiscalYearEndMonth(tk) !== 12) return null; // non-calendar FY → calendar YTD slice unsafe, skip
454|  if (ytdQuartersCount(tk, qv.end) < 2) return null; // YTD window == the row itself
455|  const sum = key => ytdSum(tk, qv.end, key);
458|  const isFY = pt === 'FY' || pt === 'annual' || Number(qv.end.slice(5, 7)) === 12;
459|  const label = isFY
460|    ? (lang === 'zh' ? `FY${qv.end.slice(0, 4)} 全年累计` : `FY${qv.end.slice(0, 4)} cumulative`)
461|    : (lang === 'zh' ? `${qv.end.slice(0, 4)} 上半年累计` : `H1 ${qv.end.slice(0, 4)} cumulative`);
462|  return {
463|    kind: isFY ? 'FY' : 'half', label,
464|    values: { revenue: sum('revenue'), gross: sum('gross'), opInc: sum('opInc'),
465|      netInc: sum('netInc'), rd: sum('rd'), sga: sum('sga') },
466|  };
467|}
```

## 6) segPeriodType / segPeriods / segPeriodLabel / segGranularityLabel —— app.js:887-928
```js
887|function segPeriodType(ticker, end) {
888|  const s = SEG && SEG.companies[ticker];
889|  const pt = s && s.periodTypes && s.periodTypes[end];
890|  if (pt === 'annual' || pt === 'FY') return 'annual';
891|  if (pt === 'half' || pt === 'H1' || pt === 'semiannual') return 'half';
892|  return 'quarter';
893|}
894|function segPeriods(ticker, name) {
895|  const s = SEG && SEG.companies[ticker];
896|  if (!s || !s.quarters) return [];
897|  const byEnd = new Map();
898|  for (const qv of (DATA.companies[ticker] ? DATA.companies[ticker].quarters : [])) byEnd.set(qv.end, qv);
899|  const ends = Object.keys(s.quarters).filter(en => segValueFor(ticker, en, name) != null).sort();
900|  return ends.map(en => {
901|    const base = byEnd.get(en);
902|    const pt = segPeriodType(ticker, en);
903|    const row = base ? { ...base } : { end: en, periodType: pt === 'annual' ? 'annual' : (pt === 'half' ? 'interim' : 'q') };
904|    row.end = en;
905|    row.__segPT = pt;
906|    return row;
907|  });
908|}
910|function segPeriodLabel(ticker, qv) {
911|  const pt = qv.__segPT || 'quarter';
912|  const yr = qv.end.slice(0, 4), yy = qv.end.slice(2, 4), mm = Number(qv.end.slice(5, 7));
913|  if (pt === 'annual') return 'FY ' + yr;
914|  if (pt === 'quarter') return `Q${Math.floor((mm - 1) / 3) + 1}'${yy}`;
915|  const cm = periodCoveredMonths(ticker, qv);
916|  if (cm <= 6) return `H1'${yy}`;
917|  if (cm <= 9) return `9M'${yy}`;
918|  return 'FY ' + yr;
919|}
```
> 注意 903 行：`base ? {...base}` 直接浅拷贝 profit 行 —— 保留 profit 行的 `periodType`；`__segPT` 单独挂在 `row.__segPT`（905 行）。`growthLine`/`barBasisInfo` 读的是 `row.periodType`，而不是 `row.__segPT`，即 Class A/B/C 三类口径错配的共同根因。

## 7) barBasisNote / 标题（斜纹说明 + 分部累计口径）—— app.js:1002-1026
```js
1005|      note.textContent = lang === 'zh'
1006|        ? '斜纹柱 = 半年/9M 累计，与单季柱不可直接相比'
1007|        : 'Hatched bars = H1/9M cumulative, not comparable to single quarters';
1024|  document.getElementById('chartTitle').textContent =
1025|    `${shortName(state.company)} · ${item.label}${titleBasis}`
1026|    + (hasCumSeg ? ' · ' + (lang === 'zh' ? '分部为半年/FY累计口径' : 'segments on half/FY cumulative basis') : '');
```

## 8) pctLine —— app.js:1037-1055（分部占比分母）
```js
1037|  const pctLine = isRevenue ? [] : item.data.map((v, i) => {
1038|    if (v == null) return null;
1039|    if (isMargin) return +v.toFixed(2);
1040|    const qv = rows[i];
1041|    let revDisp;
1042|    if (item.kind === 'segment') {
1043|      const cum = cumFor(qv);
1044|      revDisp = (cum && cum.values && cum.values.revenue != null) ? cum.values.revenue * dispFactor(qv) : (rawMetrics(qv) || {}).revenue;
1045|    } else {
1046|      revDisp = (rawMetrics(qv) || {}).revenue;
1047|    }
1048|    return revDisp ? +(v * MB / revDisp * 100).toFixed(2) : null;
1049|  });
```

## 9) growthLine —— app.js:1061-1089（**1079 行只用 profit 行判累计**）
```js
1061|  const yoyBaseIndex = i => {
1062|    const cur = rows[i]; if (!cur) return -1;
1063|    const md = cur.end.slice(5), yoy = String(Number(cur.end.slice(0, 4)) - 1);
1064|    for (let j = i - 1; j >= 0; j--) if (rows[j].end.slice(5) === md && rows[j].end.slice(0, 4) === yoy) return j;
1065|    return -1;
1066|  };
1068|  const growthBasis = [];
1069|  const growthLine = item.data.map((v, i) => {
1070|    const pv0 = item.data[i - 1];
1071|    if (isMargin) {
1072|      growthBasis[i] = (v == null || i === 0 || pv0 == null) ? null : 'qoq';
1073|      return (v == null || i === 0 || pv0 == null) ? null : +(v - pv0).toFixed(2);
1074|    }
1075|    if (isAnnual()) {
1076|      growthBasis[i] = (v == null || i === 0 || pv0 == null) ? null : 'yoy';
1077|      return (v == null || i === 0 || pv0 == null) ? null : +((v - pv0) / Math.abs(pv0) * 100).toFixed(2);
1078|    }
1079|    const cumCur = profitRowIsCumulative(state.company, rows[i]);
1080|    const cumPrev = i > 0 && profitRowIsCumulative(state.company, rows[i - 1]);
1081|    if (cumCur) {
1082|      const b = yoyBaseIndex(i), pv = b >= 0 ? item.data[b] : null;
1083|      growthBasis[i] = (v == null || pv == null) ? null : 'yoy';
1084|      return (v == null || pv == null) ? null : +((v - pv) / Math.abs(pv) * 100).toFixed(2);
1085|    }
1086|    if (cumPrev) { growthBasis[i] = null; return null; }
1087|    growthBasis[i] = (v == null || i === 0 || pv0 == null) ? null : 'qoq';
1088|    return (v == null || i === 0 || pv0 == null) ? null : +((v - pv0) / Math.abs(pv0) * 100).toFixed(2);
1089|  });
```

## 10) bar tooltip head + 增速 basis 标签 —— app.js:1129-1158
```js
1129|        const i = p.dataIndex, qv = rows[i], val = item.data[i];
1130|        const cum = cumFor(qv);
1131|        const b = bases[i];
1134|        const head = (b && b.cumulative)
1135|          ? `${barBasisTag(state.company, qv)} ${lang === 'zh' ? '累计' : 'cumulative'}`
1136|          : quarterLabel(qv.end, qv.periodType);
1137|        const lines = [`<b>${head}</b> <span style="color:#94a3b8">${qv.end}</span>${cum && !(b && b.cumulative) ? ' · ' + cum.label : ''}`];
1153|          } else if (s.seriesName === growthName) {
1154|            if (s.value == null) { lines.push(`${item.label} · —`); continue; }
1156|            const basisLbl = growthBasis[i] === 'yoy' ? (lang === 'zh' ? '同比' : 'YoY') : qoqSuffix();
1157|            lines.push(`${item.label} · ${basisLbl}: ${(s.value > 0 ? '+' : '') + s.value.toFixed(1) + (isMargin ? 'pp' : '%')}`);
```

## 11) renderChart（桑基 cum 覆盖 + 标题）—— app.js:683-711
```js
683|function renderChart() {
684|  if (state.view === 'bar') { window.__qvEff = null; renderBarChart(); return; }
685|  const qvRaw = q();
688|  const plan = sankeySegPlan(state.company, qvRaw);
689|  const cum = plan.cum;
690|  const qv = cum ? { ...qvRaw, ...cum.values, __cum: cum } : qvRaw;
691|  window.__qvEff = cum ? qv : null;
692|  const segList = plan.segList;
697|  const g = buildGraph(qv, segList);
698|  window.__bridgeCheck = checkConsistency(qv, g);
710|  document.getElementById('chartTitle').textContent =
711|    `${shortName(state.company)} ${quarterLabel(qv.end, qv.periodType)}${cum ? ` · ${cum.label}` : ''}`;
```

## 12) nodeLabel 利润率（pct 模式，分子分母同显示币 = BUG-B 已修）—— app.js:730-744
```js
730|    if (state.mode.pct) {
731|      if (isMargin) {
735|        const rm = rawMetrics(qv);
736|        const mg = (rm && rm[p.name] != null && rm.revenue) ? rm[p.name] / rm.revenue : null;
737|        parts.push(`{m|${t('margins')[p.name]} ${fmtPct(mg)}}`);
738|      } else if (p.name === 'revenue') {
739|        parts.push('{p|100%}');
740|      } else {
741|        parts.push(p.name.startsWith('seg:')
742|          ? `{p|${fmtPct(p.value / revB)}}`
743|          : `{p|${fmtPct(p.value / revB)} ${t('ofRev')}}`);
744|      }
```

## 附：`dispSym`（app.js:151）与非 CNY 处理
`dispInUsd()` 对所有非 CNY 公司为真 → `dispSym()='$'`（自动折美元）；`metaLine`（app.js:1443-1446）显示原始币种码并在折算时追加「≈US$」。历史「美元标本币」问题当前已解决，不作为现存 bug 列出。
