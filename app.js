/* Profit Bridge dashboard — data-driven, all figures from data/profit.json (SEC EDGAR XBRL)
   and data/segments.json (SEC EDGAR XBRL segment R files).
   Sankey rendered with the ECharts (v5.6.0) sankey series, SVG renderer.
   Input side: segment inflows (blue) → Revenue (gray, center).
   Output side: profit waterfall (green) + cost branches (red) + non-operating inflow. */
'use strict';

const I18N = {
  en: {
    appTitle: 'Profit Bridge', langBtn: '中文',
    reset: '', exportPNG: 'Export PNG', exportSVG: 'Export SVG',
    nodes: {
      revenue: 'Revenue', cogs: 'Cost of revenue', gross: 'Gross profit', opex: 'Operating expenses',
      rd: 'R&D expenses', sga: 'Selling, general & admin',
      op: 'Operating income', taxOther: 'Tax & other', net: 'Net income', nonop: 'Non-operating income',
      loss: 'Operating loss', netLoss: 'Net loss',
    },
    source: 'Data source:', updated: 'Data updated:', asof: 'As of',
    coverage: 'Segment inflow (input side) available:', coverageNone: 'No segment data loaded — output waterfall only.',
    quartersWith: 'quarters with segments', ofQ: 'of', segSource: 'segments:',
    pctBtn: '% of revenue', qoqBtn: 'QoQ',
    pctNote: 'Shares are relative to this quarter\'s revenue; expense lines shown as % of revenue.',
    qoqNote: 'QoQ: flows/amounts = % change vs prior quarter; margins = percentage points (pp). “—” = no prior-quarter data.',
    margins: { gross: 'Gross margin', op: 'Operating margin', net: 'Net margin' },
    ofRev: '% of rev', qoqSuffix: 'QoQ',
  },
  zh: {
    appTitle: '利润析视', langBtn: 'English',
    reset: '', exportPNG: '导出 PNG', exportSVG: '导出 SVG',
    nodes: {
      revenue: '营收', cogs: '营收成本', gross: '毛利润', opex: '营业费用',
      rd: '研发费用', sga: '销售与管理费用',
      op: '营业利润', taxOther: '税费及其他', net: '净利润', nonop: '非经营性收益',
      loss: '经营亏损', netLoss: '净亏损',
    },
    source: '数据来源：', updated: '数据更新：', asof: '截至',
    coverage: '分部流入（input 侧）可用：', coverageNone: '未加载分部数据 —— 仅绘制利润瀑布。',
    quartersWith: '个季度有分部数据', ofQ: '/', segSource: '分部数据：',
    pctBtn: '占比', qoqBtn: '环比',
    pctNote: '占比口径：均相对本季营收；费用项显示占营收比。',
    qoqNote: '环比口径：金额/流量为环比 % 变化；利润率为百分点（pp）。“—”表示上季无数据。',
    margins: { gross: '毛利率', op: '营业利润率', net: '净利率' },
    ofRev: '占营收', qoqSuffix: 'QoQ',
  },
};

/* zh display names for chart title — from data/companies.json registry (built-in fallback) */
const ZH_NAMES_FALLBACK = {
  NVDA: '英伟达', AAPL: '苹果', MSFT: '微软', GOOGL: '谷歌', AMZN: '亚马逊',
  META: 'Meta', TSLA: '特斯拉', ORCL: '甲骨文', AMD: '超威半导体', INTC: '英特尔',
};
let REGISTRY = []; // data/companies.json — single source of company truth (see P4 governance)
const regOf = tk => REGISTRY.find(c => c.ticker === tk) || null;
function quarterLabel(end) {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
function shortName(ticker) {
  const c = DATA.companies[ticker];
  const stripped = (c.name || '').replace(/,? (Inc\.|Corporation|Co\.,? Ltd\.|Ltd\.|Platforms, Inc\.|com, Inc\.)$/, '');
  return lang === 'zh' ? (regOf(ticker)?.nameZh || ZH_NAMES_FALLBACK[ticker] || stripped) : stripped;
}
let lang = 'zh'; // 中文界面为默认，右上按钮切换 English
const t = k => I18N[lang][k];
const tn = k => I18N[lang].nodes[k] || k;

let DATA = null;      // profit.json (values in $M)
let SEG = null;       // segments.json (values in $M) — optional, degrade gracefully
let chart = null;     // echarts instance
let state = { company: 'NVDA', qIndex: null, mode: { pct: false, qoq: false } }; // qIndex null = latest

const MB = 1e3; // $M → $B display factor (all data is in $M)
const fmtPct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const fmtDelta = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
const fmtPP = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + 'pp';

/* ---- label-mode helpers (pct / QoQ); only change label display, never node values ---- */
const MARGIN_KEYS = ['gross', 'op', 'net'];
const KEY_ALIAS = { netLoss: 'net' };

/* Raw USD metrics for one quarter, mirroring the nodes buildGraph() actually creates
   (same guards: opex only when the waterfall branch emits it, etc.). */
function rawMetrics(qv) {
  if (!qv) return null;
  const B = MB;
  const m = {
    revenue: qv.revenue, gross: qv.gross != null ? qv.gross : null,
    cogs: qv.gross != null ? qv.revenue - qv.gross : null,
    rd: qv.rd != null ? qv.rd : null, sga: qv.sga != null ? qv.sga : null,
    op: qv.opInc != null ? qv.opInc : null, net: qv.netInc != null ? qv.netInc : null,
  };
  let opex = null;
  if (m.gross != null && m.op != null && m.op >= 0 && m.op <= m.gross) {
    const opexVal = m.gross - m.op;
    if (m.rd != null && m.sga != null && m.rd / B + m.sga / B <= opexVal / B * 1.001) {
      const other = opexVal - m.rd - m.sga;
      opex = other > 0 ? other : null;
    } else opex = opexVal;
  } else if (m.gross == null && m.op != null && m.op >= 0) {
    opex = m.revenue - m.op;
  }
  m.opex = opex;
  m.taxOther = (m.op != null && m.net != null) ? Math.max(m.op - m.net, 0) : null;
  m.nonop = (m.op != null && m.net != null) ? Math.max(m.net - m.op, 0) : null;
  return m;
}

/* amount QoQ (% change vs prior quarter); null when either side lacks data */
function qoqAmount(name) {
  const curM = rawMetrics(q()), prevQ = prev(1), prevM = rawMetrics(prevQ);
  if (!curM || !prevM) return null;
  const k = KEY_ALIAS[name] || name;
  const cv = curM[k], pv = prevM[k];
  return (cv != null && pv != null && pv !== 0) ? (cv - pv) / Math.abs(pv) : null;
}

/* segment-node amount QoQ; null if the prior quarter has no segment data or the segment is missing */
function qoqSegment(name) {
  const nm = name.slice(4), prevQ = prev(1);
  if (!prevQ) return null;
  const find = list => {
    if (!list) return null;
    const top = list.find(s => s.name === nm);
    if (top) return top.value;
    for (const s of list) if (s.children) { const ch = s.children.find(c => c.name === nm); if (ch) return ch.value; }
    return null;
  };
  const cv = find(segmentsFor(state.company, q().end));
  const pv = find(segmentsFor(state.company, prevQ.end));
  return (cv != null && pv != null && pv !== 0) ? (cv - pv) / Math.abs(pv) : null;
}

/* margin (pp) QoQ for gross/op/net — change of ratio vs prior quarter, in percentage points */
function qoqMarginPP(key) {
  const mg = m => (m && m.revenue && m[key] != null) ? m[key] / m.revenue : null;
  const a = mg(rawMetrics(q())), b = mg(rawMetrics(prev(1)));
  return (a != null && b != null) ? (a - b) : null;
}

/* QoQ line for a node label: flows/amounts → fmtDelta %, margins (only when pct mode shows them as ratios) → pp */
function qoqText(name) {
  if (state.mode.pct && MARGIN_KEYS.includes(name)) return fmtPP(qoqMarginPP(name));
  const v = name.startsWith('seg:') ? qoqSegment(name) : qoqAmount(name);
  return fmtDelta(v); // '—' when no prior data
}

function q() {
  const c = DATA.companies[state.company];
  const i = state.qIndex == null ? c.quarters.length - 1 : state.qIndex;
  return c.quarters[i];
}
function prev(offset) {
  const qs = DATA.companies[state.company].quarters;
  const i = (state.qIndex == null ? qs.length - 1 : state.qIndex) - offset;
  return i >= 0 ? qs[i] : null;
}
/* ---- palette (no gradients anywhere; ribbons are solid per-link colors) ---- */
const BLUE = '#3b82c4', GRAY = '#4b5563', GREEN = '#16a34a', RED = '#dc2626', GOLD = '#d4a017';
const NODE_COLORS = { revenue: GRAY, gross: GREEN, cogs: RED, opex: RED, rd: RED, sga: RED,
  op: GREEN, taxOther: RED, net: GREEN, nonop: GOLD, netLoss: RED };
const FLOW_OPACITY = 0.55;

/* segment inflow availability for a company+quarter (segments are $M) */
function segmentsFor(ticker, qEnd) {
  const c = SEG && SEG.companies && SEG.companies[ticker];
  return (c && c.quarters && c.quarters[qEnd]) || null;
}

/* Build the full echarts sankey graph ($B units) for the selected quarter.
   Columns: [segments(+children) 0] [aggregate parents 1] [revenue] [gross/cogs] [rd/sga/other/op] [net/tax].
   All values non-negative; out-slots of every node sum to its value. */
function buildGraph(qv, segList) {
  const B = MB, M = 1;
  const rev = qv.revenue / B, gross = qv.gross != null ? qv.gross / B : null,
        op = qv.opInc != null ? qv.opInc / B : null, net = qv.netInc != null ? qv.netInc / B : null;
  const nodes = [], links = [];
  const hasChildren = segList && segList.some(s => s.children && s.children.length);
  const revDepth = hasChildren ? 2 : (segList ? 1 : 0);
  const segName = n => 'seg:' + n; // namespace so segments can never collide with computed node ids

  // ---- input side ----
  if (segList && segList.length) {
    for (const s of segList) {
      if (s.children && s.children.length) {
        const parentVal = s.children.reduce((a, c) => a + c.value, 0) / 1000; // $M → $B
        for (const ch of s.children) {
          nodes.push({ name: segName(ch.name), value: ch.value / 1000, depth: 0, itemStyle: { color: BLUE } });
          links.push({ source: segName(ch.name), target: segName(s.name), value: ch.value / 1000 });
        }
        nodes.push({ name: segName(s.name), value: parentVal, depth: 1, itemStyle: { color: BLUE } });
        links.push({ source: segName(s.name), target: 'revenue', value: parentVal });
      } else {
        nodes.push({ name: segName(s.name), value: s.value / 1000, depth: 0, itemStyle: { color: BLUE } });
        links.push({ source: segName(s.name), target: 'revenue', value: s.value / 1000 });
      }
    }
  }

  // ---- revenue + output waterfall ----
  nodes.push({ name: 'revenue', value: rev, depth: revDepth, itemStyle: { color: GRAY } });
  const hasOpexSplit = qv.rd != null && qv.sga != null;
  if (gross != null) {
    nodes.push({ name: 'gross', value: gross, depth: revDepth + 1, itemStyle: { color: GREEN } });
    nodes.push({ name: 'cogs', value: rev - gross, depth: revDepth + 1, itemStyle: { color: RED } });
    links.push({ source: 'revenue', target: 'gross', value: gross });
    if (rev - gross > 0) links.push({ source: 'revenue', target: 'cogs', value: rev - gross });
    if (op != null && op >= 0 && op <= gross) {
      nodes.push({ name: 'op', value: op, depth: revDepth + 2, itemStyle: { color: GREEN } });
      const opexVal = gross - op;
      if (hasOpexSplit && qv.rd / B + qv.sga / B <= opexVal * 1.001) {
        nodes.push({ name: 'rd', value: qv.rd / B, depth: revDepth + 2, itemStyle: { color: RED } });
        nodes.push({ name: 'sga', value: qv.sga / B, depth: revDepth + 2, itemStyle: { color: RED } });
        const other = opexVal - qv.rd / B - qv.sga / B;
        if (other > 0) { nodes.push({ name: 'opex', value: other, depth: revDepth + 2, itemStyle: { color: RED } }); links.push({ source: 'gross', target: 'opex', value: other }); }
        links.push({ source: 'gross', target: 'rd', value: qv.rd / B });
        links.push({ source: 'gross', target: 'sga', value: qv.sga / B });
      } else {
        nodes.push({ name: 'opex', value: opexVal, depth: revDepth + 2, itemStyle: { color: RED } });
        links.push({ source: 'gross', target: 'opex', value: opexVal });
      }
      links.push({ source: 'gross', target: 'op', value: op });
    }
  } else if (op != null && op >= 0) {
    nodes.push({ name: 'op', value: op, depth: revDepth + 1, itemStyle: { color: GREEN } });
    nodes.push({ name: 'opex', value: rev - op, depth: revDepth + 1, itemStyle: { color: RED } });
    links.push({ source: 'revenue', target: 'op', value: op });
    links.push({ source: 'revenue', target: 'opex', value: rev - op });
  }
  if (op != null && op > 0 && net != null) {
    if (net >= 0) {
      nodes.push({ name: 'net', value: net, depth: revDepth + 3, itemStyle: { color: GREEN } });
      links.push({ source: 'op', target: 'net', value: Math.min(net, op) });
      if (op - net > 0) { nodes.push({ name: 'taxOther', value: op - net, depth: revDepth + 3, itemStyle: { color: RED } }); links.push({ source: 'op', target: 'taxOther', value: op - net }); }
      if (net > op) {
        nodes.push({ name: 'nonop', value: net - op, depth: revDepth + 2, itemStyle: { color: GOLD } });
        links.push({ source: 'nonop', target: 'net', value: net - op });
      }
    } else {
      nodes.push({ name: 'netLoss', value: -net, depth: revDepth + 3, itemStyle: { color: RED } });
      nodes.push({ name: 'taxOther', value: op, depth: revDepth + 3, itemStyle: { color: RED } });
      links.push({ source: 'op', target: 'taxOther', value: op });
      links.push({ source: 'taxOther', target: 'netLoss', value: -net });
    }
  }

  const cleanLinks = links.filter(l => l.value > 0 && l.source !== l.target)
    .map(l => ({ ...l, lineStyle: { color: linkColor(l), opacity: FLOW_OPACITY, curveness: 0.5 } }));
  return { nodes, links: cleanLinks };
}
function linkColor(l) {
  if (l.source.startsWith('seg:')) return BLUE; // all input-side ribbons (children→parent, parent/segment→revenue)
  if (l.source === 'nonop') return GOLD;
  if (l.target === 'gross' || l.target === 'op' || l.target === 'net') return GREEN;
  return RED; // cogs / rd / sga / opex / taxOther / netLoss branches
}
const displayName = n => n.name.startsWith('seg:') ? n.name.slice(4) : tn(n.name);

/* self-consistency check: input-side leaf inflows must equal revenue */
function checkConsistency(qv, g) {
  const out = { quarter: qv.end, inputSum: null, revenue: qv.revenue / MB, ok: null, waterfall: {} };
  const leafLinks = g.links.filter(l => l.source.startsWith('seg:') &&
    !g.nodes.some(n => n.name === l.source && n.depth === 1)); // leaves, not aggregate parents
  const inputSum = leafLinks.reduce((a, l) => a + l.value, 0);
  out.inputSum = inputSum;
  out.ok = Math.abs(inputSum - out.revenue) < 0.005;
  const byName = Object.fromEntries(g.nodes.map(n => [n.name, n.value]));
  out.waterfall = {
    gross: byName.gross, cogs: byName.cogs, op: byName.op, net: byName.net,
    grossEq: byName.gross == null || Math.abs(byName.gross + (byName.cogs || 0) - out.revenue) < 0.005,
    opEq: byName.op == null || qv.gross == null || Math.abs(byName.op + (byName.rd || 0) + (byName.sga || 0) + (byName.opex || 0) - byName.gross) < 0.01,
    netEq: byName.net == null || Math.abs(byName.net - qv.netInc / MB) < 0.005,
  };
  return out;
}

function renderChart() {
  const qv = q();
  const segList = segmentsFor(state.company, qv.end);
  const g = buildGraph(qv, segList);
  window.__bridgeCheck = checkConsistency(qv, g);
  window.__sankeyMeta = {
    company: state.company, quarter: qv.end,
    nodes: g.nodes.map(n => ({ name: displayName(n), value: +n.value.toFixed(4), depth: n.depth })),
    links: g.links.map(l => ({ source: displayName({ name: l.source }), target: displayName({ name: l.target }), value: +l.value.toFixed(4) })),
  };

  document.getElementById('chartTitle').textContent = `${shortName(state.company)} ${quarterLabel(qv.end)}`;
  document.getElementById('chartAsof').textContent = `${t('asof')} ${qv.end}`;

  const labelRich = {
    n: { fontSize: 16, fontWeight: 700, color: '#1e293b', lineHeight: 21 },
    v: { fontSize: 14, fontWeight: 600, color: '#64748b', lineHeight: 18 },
    p: { fontSize: 14, fontWeight: 700, color: '#2563eb', lineHeight: 18 },   // share of revenue
    m: { fontSize: 14, fontWeight: 700, color: '#1d55a5', lineHeight: 18 },   // margin ratios
    up: { fontSize: 13, fontWeight: 700, color: '#16a34a', lineHeight: 17 },
    down: { fontSize: 13, fontWeight: 700, color: '#dc2626', lineHeight: 17 },
    flat: { fontSize: 13, fontWeight: 600, color: '#94a3b8', lineHeight: 17 }, // '—' no prior data
  };

  /* label formatter with 4 modes: amount / pct / qoq / pct+qoq. Node values untouched. */
  function nodeLabel(p) {
    const revB = qv.revenue / MB;
    const isMargin = MARGIN_KEYS.includes(p.name);
    const amt = `$${p.value.toFixed(1)}B`;
    let body = `{n|${displayName(p)}}`;
    const parts = [];
    if (state.mode.pct) {
      if (isMargin) {
        const mg = rawMetrics(qv)[p.name] / qv.revenue;
        parts.push(`{m|${t('margins')[p.name]} ${fmtPct(mg)}}`);
      } else if (p.name === 'revenue') {
        parts.push('{p|100%}');
      } else {
        parts.push(p.name.startsWith('seg:')
          ? `{p|${fmtPct(p.value / revB)}}`
          : `{p|${fmtPct(p.value / revB)} ${t('ofRev')}}`);
      }
    }
    parts.push(`{v|${amt}}`);
    body += '\n' + parts.join(' · ');
    if (state.mode.qoq) {
      const qt = qoqText(p.name);
      if (qt === '—') body += `\n{flat|— QoQ}`;
      else {
        const neg = qt.startsWith('-');
        body += `\n{${neg ? 'down' : 'up'}|${qt} ${t('qoqSuffix')}}`;
      }
    }
    return body;
  }

  const data = g.nodes.map(n => {
    const d = { name: n.name, value: n.value, depth: n.depth, itemStyle: n.itemStyle };
    // per-node label placement to avoid overlaps (pitfall #3)
    if (n.name === 'revenue') {
      d.label = { position: 'top', distance: 6, formatter: nodeLabel };
    } else if (n.depth === 0 && (!segList || !segList.some(s => s.children && s.children.length))) {
      d.label = { position: 'right', distance: 6 };   // no aggregate column: safe right of node
    } else if (n.depth === (segList && segList.some(s => s.children && s.children.length) ? 2 : (segList ? 1 : 0)) + 3) {
      d.label = { position: 'right', distance: 8 };   // last column: label right, no conflicts
    } else {
      d.label = { position: 'top', distance: 5 };
    }
    return d;
  });
  const hasAgg = segList && segList.some(s => s.children && s.children.length);

  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item', confine: true,
      formatter: p => {
        const nm = displayName(p);
        return p.dataType === 'edge'
          ? `${displayName({ name: p.data.source })} → ${displayName({ name: p.data.target })}<br/><b>$${p.data.value.toFixed(1)}B</b>`
          : `<b>${nm}</b><br/>$${p.value.toFixed(1)}B`;
      },
    },
    series: [{
      type: 'sankey',
      layout: 'none',               // manual depth layout (pitfall #5)
      nodeAlign: 'justify',
      nodeWidth: 30, nodeGap: 22,
      left: hasAgg ? 210 : 170, right: 170, top: 60, bottom: 40,
      emphasis: { focus: 'adjacency' },
      label: {
        fontSize: 15,
        formatter: nodeLabel,
        rich: labelRich,
      },
      data,                          // FULL data + links every time (pitfall #1)
      links: g.links,
    }],
  }, true); // notMerge: full replacement on every company/quarter switch
  window.__lastOption = {
    backgroundColor: '#f2efe9',
    tooltip: undefined,
    series: [{
      type: 'sankey', layout: 'none', nodeAlign: 'justify',
      nodeWidth: 30, nodeGap: 22, left: hasAgg ? 210 : 170, right: 170, top: 60, bottom: 40,
      emphasis: { focus: 'adjacency' },
      label: { fontSize: 15, formatter: nodeLabel, rich: labelRich },
      data, links: g.links,
    }],
  };
}

/* ---- left logo rail ---- */
const MONO_COLORS = ['#1d55a5','#b91c1c','#0f766e','#7c3aed','#c2410c','#be185d','#15803d','#a16207','#1e40af','#4d7c0f'];
function renderLogoRail() {
  const rail = document.getElementById('logoRail');
  rail.innerHTML = Object.keys(DATA.companies).map((tk, i) =>
    `<div class="logo${tk === state.company ? ' active' : ''}" data-sym="${tk}" title="${tk} · ${regOf(tk)?.nameZh || ZH_NAMES_FALLBACK[tk] || ''}">
       <img src="data/logos/${tk}.png" alt="${tk}"
         onerror="this.outerHTML='<div class=\\'mono\\' style=\\'background:${regOf(tk)?.color || MONO_COLORS[i % MONO_COLORS.length]}\\'>${tk.slice(0,2)}</div>'">
     </div>`).join('');
  rail.querySelectorAll('.logo').forEach(el => el.addEventListener('click', () => {
    state.company = el.dataset.sym; state.qIndex = null; render();
  }));
}

/* ---- bottom timeline ---- */
/* Label by calendar quarter of the quarter's MID-point (end − 45d), so the whole
   covered interval drives the label: NVDA's FY-Q ending 2026-01-25 → "2025 Q4"
   (not "2026 Q1"), AAPL ending 2026-06-27 → "2026 Q2". Correct for non-calendar
   fiscal years without per-company FY tables. */
function fqLabel(end) {
  const mid = new Date(new Date(end + 'T00:00:00Z').getTime() - 45 * 86400000);
  const y = mid.getUTCFullYear(), m = mid.getUTCMonth() + 1;
  return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
}
function curQIndex() { return state.qIndex == null ? DATA.companies[state.company].quarters.length - 1 : state.qIndex; }
function setQuarter(i) {
  const n = DATA.companies[state.company].quarters.length;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === curQIndex()) { renderTimeline(); return; }
  state.qIndex = i;
  render(); // full setOption(data+links) via renderChart — never partial updates
}
function renderTimeline() {
  const qs = DATA.companies[state.company].quarters, n = qs.length, cur = curQIndex();
  const ticks = document.getElementById('tlTicks');
  ticks.innerHTML = qs.map((x, i) =>
    `<div class="tl-tick${i === cur ? ' active' : ''}" data-i="${i}">
       <div class="q">${fqLabel(x.end)}</div><div class="d">${x.end}</div></div>`).join('');
  ticks.querySelectorAll('.tl-tick').forEach(el =>
    el.addEventListener('click', () => setQuarter(Number(el.dataset.i))));
  const pct = n > 1 ? (cur / (n - 1)) * 100 : 0;
  document.getElementById('tlFill').style.width = pct + '%';
  document.getElementById('tlThumb').style.left = pct + '%';
}
function initTimelineDrag() {
  const thumb = document.getElementById('tlThumb');
  let dragging = false;
  thumb.addEventListener('pointerdown', e => { dragging = true; thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener('pointermove', e => {
    if (!dragging) return;
    const track = thumb.parentElement, r = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setQuarter(Math.round(frac * (DATA.companies[state.company].quarters.length - 1)));
  });
  thumb.addEventListener('pointerup', () => { dragging = false; });
}

function render() {
  const c = DATA.companies[state.company];
  const qv = q();
  document.getElementById('title').innerHTML =
    `${t('appTitle')}&nbsp;<span class="sub">${c.name} · ${qv.end}${lang === 'zh' ? ' 季度末' : ' (quarter end)'}</span>`;
  document.getElementById('btnExportPNG').querySelector('span').textContent = t('exportPNG');
  document.getElementById('btnExportSVG').querySelector('span').textContent = t('exportSVG');
  document.getElementById('btnLang').textContent = t('langBtn');

  // label-mode buttons: text + active state (stackable pct/qoq)
  document.getElementById('lblPct').textContent = t('pctBtn');
  document.getElementById('lblQoQ').textContent = t('qoqBtn');
  document.getElementById('btnPct').classList.toggle('active', state.mode.pct);
  document.getElementById('btnQoQ').classList.toggle('active', state.mode.qoq);
  const noteEl = document.getElementById('modeNote');
  const notes = [];
  if (state.mode.pct) notes.push(t('pctNote'));
  if (state.mode.qoq) notes.push(t('qoqNote'));
  noteEl.textContent = notes.join(' ');
  noteEl.style.display = notes.length ? '' : 'none';

  renderLogoRail();
  renderTimeline();
  renderChart();

  document.getElementById('srcLine').innerHTML =
    `${t('source')} <a href="${DATA.sourceUrl}" target="_blank">SEC EDGAR XBRL companyfacts</a> (US-GAAP)`;
  document.getElementById('updLine').textContent = `${t('updated')} ${DATA.updated}`;

  // coverage footnote: which companies have an input side, and segment sourceUrl
  const cov = document.getElementById('covLine');
  if (SEG && SEG.companies) {
    const withSeg = Object.keys(DATA.companies).filter(tk => {
      const s = SEG.companies[tk];
      return s && s.quarters && Object.keys(s.quarters).length > 0;
    });
    const detail = withSeg.map(tk => {
      const n = Object.keys(SEG.companies[tk].quarters).length;
      return `${tk} (${n}${lang === 'zh' ? '' : ''}/${DATA.companies[tk].quarters.length})`;
    }).join(' · ');
    cov.innerHTML = lang === 'zh'
      ? `${t('coverage')} ${detail}（括号内为有分部数据的季节数/总季节数；缺失季度仅绘制利润瀑布）　${t('segSource')} <a href="${SEG.sourceUrl}" target="_blank">SEC EDGAR XBRL segment R files</a>`
      : `${t('coverage')} ${detail} — quarters with segments vs total (quarters without segments render waterfall only). ${t('segSource')} <a href="${SEG.sourceUrl}" target="_blank">SEC EDGAR XBRL segment R files</a>`;
  } else {
    cov.textContent = t('coverageNone');
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

function exportPNG() {
  if (!chart) return;
  // SVG renderer's getDataURL cannot rasterize; re-render into an offscreen
  // canvas instance at 2x and export a real PNG from there.
  const opt = window.__lastOption || chart.getOption(); // full option incl. label formatters → current mode WYSIWYG
  opt.backgroundColor = '#f2efe9';
  const off = echarts.init(document.createElement('div'), null, { renderer: 'canvas', width: 1600, height: 900 });
  off.setOption(opt);
  const a = document.createElement('a');
  a.download = `profit_bridge_${state.company}_${q().end}.png`;
  a.href = off.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#f2efe9' });
  document.body.appendChild(a); a.click(); a.remove();
  off.dispose();
}
function exportSVG() {
  if (!chart) return;
  const svg = chart.renderToSVGString();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `profit_bridge_${state.company}_${q().end}.svg`;
  a.href = url; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function initControls() {
  initTimelineDrag();
  document.getElementById('btnLang').addEventListener('click', () => { lang = lang === 'en' ? 'zh' : 'en'; render(); });
  document.getElementById('btnExportPNG').addEventListener('click', exportPNG);
  document.getElementById('btnExportSVG').addEventListener('click', exportSVG);
  document.getElementById('btnPct').addEventListener('click', () => { state.mode.pct = !state.mode.pct; render(); });
  document.getElementById('btnQoQ').addEventListener('click', () => { state.mode.qoq = !state.mode.qoq; render(); });
}

(async function main() {
  // prefer fetch (http); fall back to inlined payload (file:// double-click)
  let loaded = null;
  try {
    const res = await fetch('data/profit.json');
    if (res.ok) loaded = await res.json();
  } catch (e) { /* file:// or offline */ }
  if (!loaded && window.__PROFIT_DATA) loaded = window.__PROFIT_DATA;
  if (!loaded) { document.getElementById('title').textContent = 'data/profit.json not found'; return; }
  DATA = loaded;
  try {
    const res = await fetch('data/segments.json');
    if (res.ok) SEG = await res.json();
  } catch (e) { /* segments optional — waterfall only */ }
  try {
    const res = await fetch('data/companies.json');
    if (res.ok) REGISTRY = await res.json();
  } catch (e) { /* registry optional — built-in fallbacks cover the 10 dashboard companies */ }

  chart = echarts.init(document.getElementById('sankey'), null, { renderer: 'svg' });
  window.addEventListener('resize', () => { chart.resize(); renderChart(); });
  initControls();
  render();
})();
