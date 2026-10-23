/* Profit Bridge dashboard — data-driven, all figures from data/profit.json (SEC EDGAR XBRL).
   Sankey rendered as hand-built SVG in the style of the original video: cream panel, solid
   node rects, bold bezier ribbons colored by profit/cost path, node labels with values. */
'use strict';

const I18N = {
  en: {
    appTitle: 'Profit Bridge', langBtn: '中文',
    revenue: 'Revenue', gross: 'Gross profit', opInc: 'Operating income', netInc: 'Net income',
    grossMargin: 'Gross margin', opMargin: 'Operating margin', netMargin: 'Net margin',
    qoq: 'QoQ', yoy: 'YoY', reset: 'Reset', export: 'Export PNG',
    nodes: {
      revenue: 'Revenue', cogs: 'Cost of revenue', gross: 'Gross profit', opex: 'Operating expenses',
      rd: 'R&D expenses', sga: 'Selling, general & admin',
      op: 'Operating income', taxOther: 'Tax & other', net: 'Net income', nonop: 'Non-operating income',
      loss: 'Operating loss', netLoss: 'Net loss',
    },
    source: 'Data source:', updated: 'Data updated:', asof: 'As of',
    marginOf: 'margin of revenue', pctOfRev: 'of revenue', na: 'N/A',
    unitNote: 'Unit: USD billion',
    nonopNote: 'Net contribution of non-operating items (gross non-operating income less tax effects)',
  },
  zh: {
    appTitle: '利润析视', langBtn: 'English',
    revenue: '营业收入', gross: '毛利润', opInc: '营业利润', netInc: '净利润',
    grossMargin: '毛利率', opMargin: '营业利润率', netMargin: '净利率',
    qoq: '环比', yoy: '同比', reset: '回到默认', export: '导出 PNG',
    nodes: {
      revenue: '营收', cogs: '营收成本', gross: '毛利润', opex: '营业费用',
      rd: '研发费用', sga: '销售与管理费用',
      op: '营业利润', taxOther: '税费及其他', net: '净利润', nonop: '非经营性收益',
      loss: '经营亏损', netLoss: '净亏损',
    },
    source: '数据来源：', updated: '数据更新：', asof: '截至',
    marginOf: '占营收比', pctOfRev: '占营收比重', na: '无数据',
    unitNote: '单位：十亿美元 (USD)',
    nonopNote: '非经营性项目的净贡献（税前非经营收益扣除税项影响后的净额）',
  },
};

/* zh display names for chart title (original video uses Chinese issuer names) */
const ZH_NAMES = {
  NVDA: '英伟达', AAPL: '苹果', MSFT: '微软', GOOGL: '谷歌', AMZN: '亚马逊',
  META: 'Meta', TSLA: '特斯拉', ORCL: '甲骨文', AMD: '超威半导体', INTC: '英特尔',
};
/* calendar quarter label, e.g. Q3 2026 — honest calendar-based naming (fiscal years differ
   per issuer; the exact fiscal period end is always shown next to it) */
function quarterLabel(end) {
  const y = Number(end.slice(0, 4)), m = Number(end.slice(5, 7));
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
function shortName(ticker) {
  const c = DATA.companies[ticker];
  const stripped = c.name.replace(/,? (Inc\.|Corporation|Co\.,? Ltd\.|Ltd\.|Platforms, Inc\.|com, Inc\.)$/, '');
  return lang === 'zh' ? (ZH_NAMES[ticker] || stripped) : stripped;
}
let lang = 'en';
const t = k => I18N[lang][k];
const tn = k => I18N[lang].nodes[k] || k;

let DATA = null;
let state = { company: 'NVDA', qIndex: null }; // qIndex null = latest

const fmtB = v => v == null ? '—' :
  (v / 1e9).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }) + 'B';
const fmtPct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
const fmtDelta = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

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
function delta(field) {
  const cur = q(), p1 = prev(1), p4 = prev(4);
  const d = (p) => (p && p[field] != null && cur[field] != null) ? (cur[field] - p[field]) / Math.abs(p[field]) : null;
  return { qoq: d(p1), yoy: d(p4) };
}

/* Build the profit-bridge structure strictly from the selected quarter's real values.
   Every link value is non-negative; each node's out-slots sum to its value where applicable,
   so ribbon widths are exactly proportional to dollar amounts. */
function buildSankey(qv) {
  const { revenue: rev, gross, opInc: op, netInc: net } = qv;
  const links = [], nodes = [];
  const addNode = (id, v) => nodes.push({ name: id, value: v });
  const hasOpexSplit = qv.rd != null && qv.sga != null;
  addNode('revenue', rev);
  if (gross != null) {
    addNode('gross', gross);
    addNode('cogs', rev - gross);
    links.push({ source: 'revenue', target: 'gross', value: gross });
    if (rev - gross > 0) links.push({ source: 'revenue', target: 'cogs', value: rev - gross });
    if (op != null && op >= 0 && op <= gross) {
      addNode('op', op);
      const opexVal = gross - op;
      if (hasOpexSplit && qv.rd + qv.sga <= opexVal * 1.001) {
        // issuer tags both R&D and SG&A: show the real split (original-video style)
        addNode('rd', qv.rd);
        addNode('sga', qv.sga);
        const other = opexVal - qv.rd - qv.sga;
        if (other > 0) { addNode('opex', other); links.push({ source: 'gross', target: 'opex', value: other }); }
        links.push({ source: 'gross', target: 'rd', value: qv.rd });
        links.push({ source: 'gross', target: 'sga', value: qv.sga });
      } else {
        addNode('opex', opexVal);
        links.push({ source: 'gross', target: 'opex', value: opexVal });
      }
      links.push({ source: 'gross', target: 'op', value: op });
    }
  } else if (op != null && op >= 0) {
    // issuer does not tag GrossProfit (GOOGL/AMZN/META/ORCL): revenue splits into op + costs
    addNode('op', op);
    addNode('opex', rev - op);
    links.push({ source: 'revenue', target: 'op', value: op });
    links.push({ source: 'revenue', target: 'opex', value: rev - op });
  }
  if (op != null && op > 0 && net != null) {
    if (!nodes.find(n => n.name === 'op')) addNode('op', op);
    if (net >= 0) {
      addNode('net', net);
      links.push({ source: 'op', target: 'net', value: Math.min(net, op) });
      if (op - net > 0) { addNode('taxOther', op - net); links.push({ source: 'op', target: 'taxOther', value: op - net }); }
      if (net > op) { addNode('nonop', net - op); links.push({ source: 'nonop', target: 'net', value: net - op }); }
    } else {
      addNode('netLoss', -net);
      addNode('taxOther', op);
      links.push({ source: 'op', target: 'taxOther', value: op });
      links.push({ source: 'taxOther', target: 'netLoss', value: -net });
    }
  }
  const cleanLinks = links.filter(l => l.value > 0 && l.source !== l.target);
  return { nodes, links: cleanLinks };
}

const NODE_COLORS = {
  revenue: '#4b5563', gross: '#16a34a', cogs: '#dc2626', opex: '#ef4444', rd: '#ef4444', sga: '#ef4444',
  op: '#16a34a', taxOther: '#dc2626', net: '#16a34a', nonop: '#22c55e', loss: '#dc2626', netLoss: '#dc2626',
};
const INK = '#1e293b', MUTED = '#64748b';
const FLOW_OPACITY = 0.62;
const NODE_W = 18;

/* Column layout (like the original: revenue → gross/cost → op/expenses → net/tax) */
function layoutSankey(struct, W, H) {
  const cols = [['revenue'], ['gross', 'cogs'], ['op', 'rd', 'sga', 'opex', 'nonop'], ['net', 'netLoss', 'taxOther']];
  const byName = Object.fromEntries(struct.nodes.map(n => [n.name, n]));
  const present = cols.map(col => col.filter(n => byName[n]));
  const maxSum = Math.max(...present.map(col => col.reduce((s, n) => s + byName[n].value, 0)));
  const top = 74, bottom = 28;
  const scale = (H - top - bottom) / maxSum;   // px per dollar — single common scale
  const gap = 72;  // room for a full label stack (or a flipped one) between stacked nodes
  const colX = present.map((_, i) => 70 + i * ((W - 320) / (present.length - 1)));
  present.forEach((col, ci) => {
    const colH = col.reduce((s, n) => s + byName[n].value * scale, 0) + gap * (col.length - 1);
    let y = top + (H - top - bottom - colH) / 2;
    col.forEach(name => {
      const n = byName[name];
      n.x = colX[ci]; n.y = y; n.h = n.value * scale; n.col = ci;
      y += n.h + gap;
    });
  });
  // assign link slots: outgoing top-to-bottom by target column, incoming likewise
  const outCursor = {}, inCursor = {};
  const orderKey = l => present.findIndex(c => c.includes(l.target)) * 1000 + byName[l.target].y;
  [...struct.links].sort((a, b) => orderKey(a) - orderKey(b)).forEach(l => {
    const s = byName[l.source], tg = byName[l.target];
    outCursor[s.name] = outCursor[s.name] ?? s.y;
    l.sy = outCursor[s.name]; outCursor[s.name] += l.value * scale;
    inCursor[tg.name] = inCursor[tg.name] ?? tg.y;
    l.ty = inCursor[tg.name]; inCursor[tg.name] += l.value * scale;
  });
  struct.byName = byName;
  struct.scale = scale;
  return struct;
}

function ribbonPath(l) {
  const x1 = l.x0 + NODE_W, x2 = l.x1;
  const y1t = l.sy, y1b = l.sy + l.value * l.scale;
  const y2t = l.ty, y2b = l.ty + l.value * l.scale;
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1t} C${cx},${y1t} ${cx},${y2t} ${x2},${y2t} L${x2},${y2b} C${cx},${y2b} ${cx},${y1b} ${x1},${y1b} Z`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function svgText(parent, x, y, str, attrs) {
  const e = el('text', { x, y, ...attrs }, parent);
  e.textContent = str;
  return e;
}

function renderChart() {
  const qv = q();
  const W = Math.max(document.getElementById('chartPanel').clientWidth, 900);
  const H = 600;
  const struct = layoutSankey(buildSankey(qv), W, H);
  const byName = struct.byName;

  const svg = document.getElementById('sankey');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);

  const tooltip = document.getElementById('tooltip');
  const showTip = (evt, html) => {
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    const panel = document.getElementById('chartPanel').getBoundingClientRect();
    let x = evt.clientX - panel.left + 14, y = evt.clientY - panel.top + 14;
    if (x > panel.width - 270) x -= 290;
    tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
  };
  const hideTip = () => { tooltip.style.display = 'none'; };

  // ribbons
  for (const l of struct.links) {
    const s = byName[l.source], tg = byName[l.target];
    l.x0 = s.x; l.x1 = tg.x; l.scale = struct.scale;
    const g = el('linearGradient', { id: `grad_${l.source}_${l.target}`, x1: '0%', y1: '0%', x2: '100%', y2: '0%' }, defs);
    el('stop', { offset: '0%', 'stop-color': NODE_COLORS[s.name], 'stop-opacity': 0.85 }, g);
    el('stop', { offset: '100%', 'stop-color': NODE_COLORS[tg.name], 'stop-opacity': 0.85 }, g);
    const p = el('path', {
      d: ribbonPath(l), fill: `url(#grad_${l.source}_${l.target})`,
      opacity: FLOW_OPACITY, stroke: 'none',
    }, svg);
    p.addEventListener('mousemove', e => showTip(e,
      `${tn(l.source)} → ${tn(l.target)}<br/><b>$${fmtB(l.value)}</b> (${fmtPct(l.value / qv.revenue)} ${t('pctOfRev')})`));
    p.addEventListener('mouseleave', hideTip);
  }

  // nodes + labels
  const TITLE_SAFE_Y = 48; // keep below the in-panel title / as-of line
  for (const n of struct.nodes) {
    const rect = el('rect', { x: n.x, y: n.y, width: NODE_W, height: n.h, fill: NODE_COLORS[n.name], rx: 1 }, svg);
    const note = n.name === 'nonop' ? `<br/><span style="color:#64748b">${t('nonopNote')}</span>` : '';
    rect.addEventListener('mousemove', e => showTip(e, `<b>${tn(n.name)}</b><br/>$${fmtB(n.value)}${qv.revenue ? `<br/>${fmtPct(n.value / qv.revenue)} ${t('pctOfRev')}` : ''}${note}`));
    rect.addEventListener('mouseleave', hideTip);
  }

  // label placement: per-column greedy layout. Each stack tries ABOVE the node first,
  // then BELOW; a placement is valid only if it clears the title zone, every node rect
  // in the column, and every already-placed label stack (prevents label↔label overlaps).
  const colNodes = {};
  for (const n of struct.nodes) (colNodes[n.col] ??= []).push(n);
  const placed = {}; // col -> [{y1,y2}]
  const boxHits = (col, y1, y2) =>
    (placed[col] || []).some(b => y1 < b.y2 - 2 && y2 > b.y1 + 2);
  for (const col of Object.keys(colNodes)) {
    const nodes = colNodes[col].slice().sort((a, b) => a.y - b.y);
    const nodeBoxes = nodes.map(n => ({ y1: n.y - 6, y2: n.y + n.h + 6 }));
    placed[col] = [];
    for (const n of nodes) {
      const cx = n.x + NODE_W / 2;
      const color = NODE_COLORS[n.name];
      const margin = n.name === 'gross' ? qv.gross / qv.revenue
        : n.name === 'op' ? qv.opInc / qv.revenue
        : n.name === 'net' || n.name === 'netLoss' ? qv.netInc / qv.revenue : null;
      const isCost = n.name === 'cogs' || n.name === 'opex' || n.name === 'rd' || n.name === 'sga' || n.name === 'taxOther';
      const valStr = isCost ? `($${fmtB(n.value)})` : `$${fmtB(n.value)}`;
      if (n.name === 'revenue') {
        svgText(svg, cx, n.y - 34, tn('revenue'), { 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: INK });
        svgText(svg, cx, n.y - 13, valStr.replace(/[()]/g, ''), { 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 800, fill: INK });
        continue;
      }
      if (n.name === 'net' || n.name === 'netLoss') {
        const lx = n.x + NODE_W + 12; // right-side label, no column conflicts
        svgText(svg, lx, n.y + 4, tn(n.name), { 'font-size': 17, 'font-weight': 700, fill: color });
        svgText(svg, lx, n.y + 25, valStr.replace(/[()]/g, ''), { 'font-size': 16, 'font-weight': 800, fill: color });
        if (margin != null) svgText(svg, lx, n.y + 42, fmtPct(margin) + ' ' + t('marginOf'), { 'font-size': 11, fill: MUTED });
        continue;
      }
      const nLines = margin != null ? 3 : 2;
      const stackH = nLines * 21;
      const others = nodeBoxes.filter((_, i) => nodes[i] !== n);
      const clear = (y1, y2) => y1 >= TITLE_SAFE_Y && !others.some(b => y1 < b.y2 && y2 > b.y1) && !boxHits(col, y1, y2) && y2 <= H - 30;
      const tryAbove = n.y - 16 - stackH, tryBelow = n.y + n.h + 16;
      let below = false, y0, side = false;
      if (clear(tryAbove, tryAbove + stackH)) y0 = tryAbove;
      else if (clear(tryBelow, tryBelow + stackH)) { y0 = tryBelow; below = true; }
      else { side = true; } // last resort: right of the node (like the net label)
      if (!side) placed[col].push({ y1: y0 - 4, y2: y0 + stackH + 4 });
      const lines = [
        [tn(n.name), { 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 700, fill: color }],
        [valStr, { 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800, fill: color }],
      ];
      if (margin != null) lines.push([fmtPct(margin) + ' ' + t('marginOf'), { 'text-anchor': 'middle', 'font-size': 11, fill: MUTED }]);
      if (side) {
        const lx = n.x + NODE_W + 12, yMid = n.y + n.h / 2 - (stackH - 16) / 2;
        lines.forEach(([str, attrs], i) => {
          const a = { ...attrs, 'text-anchor': 'start' };
          if (i === 0) a['font-size'] = 15;
          svgText(svg, lx, yMid + i * 21, str, a);
        });
      } else {
        lines.forEach(([str, attrs], i) => svgText(svg, cx, y0 + 16 + i * 21, str, attrs));
      }
    }
  }

  // unit note (bottom-left, like original)
  svgText(svg, 24, H - 12, t('unitNote'), { 'font-size': 11, fill: MUTED });

  // chart panel inner title + as-of
  document.getElementById('chartTitle').textContent = `${shortName(state.company)} ${quarterLabel(qv.end)}`;
  document.getElementById('chartAsof').textContent = `${t('asof')} ${qv.end}`;

  // test hook: pixel-accurate geometry + values
  window.__sankeyMeta = {
    company: state.company, quarter: qv.end, scale: struct.scale,
    nodes: struct.nodes.map(n => ({ name: n.name, value: n.value, x: n.x, y: n.y, h: n.h })),
    links: struct.links.map(l => ({ source: l.source, target: l.target, value: l.value, sy: l.sy, ty: l.ty, h: l.value * struct.scale })),
  };
}

function kpiCard(label, value, dv) {
  const cls = dv == null ? 'na' : dv >= 0 ? 'up' : 'down';
  return `<div class="kpi"><div class="label">${label.label}</div><div class="value">${value}</div>
    <div class="delta ${cls}">${label.qoq} ${fmtDelta(dv.qoq)} · ${label.yoy} ${fmtDelta(dv.yoy)}</div></div>`;
}

function render() {
  const c = DATA.companies[state.company];
  const qv = q();
  document.getElementById('title').innerHTML =
    `${t('appTitle')}&nbsp;<span class="sub">${c.name} · ${qv.end}${lang === 'zh' ? ' 季度末' : ' (quarter end)'}</span>`;
  document.getElementById('btnReset').textContent = t('reset');
  document.getElementById('btnExport').textContent = t('export');
  document.getElementById('btnLang').textContent = t('langBtn');

  const qs = document.getElementById('quarterSelect');
  qs.innerHTML = c.quarters.map((x, i) =>
    `<option value="${i}" ${i === (state.qIndex ?? c.quarters.length - 1) ? 'selected' : ''}>${x.end}</option>`).join('');
  document.getElementById('companySelect').value = state.company;

  const m = (a, b) => (a != null && b) ? a / b : null;
  const deltas = { revenue: delta('revenue'), opInc: delta('opInc'), netInc: delta('netInc') };
  const gm = m(qv.gross, qv.revenue), om = m(qv.opInc, qv.revenue), nm = m(qv.netInc, qv.revenue);
  const p1 = prev(1);
  const pDelta = (cur, pb, num, den) => (cur != null && pb != null && pb[num] != null && pb[den]) ? cur - pb[num] / pb[den] : null;
  document.getElementById('kpis').innerHTML =
    kpiCard({ label: t('revenue'), qoq: t('qoq'), yoy: t('yoy') }, '$' + fmtB(qv.revenue), deltas.revenue) +
    kpiCard({ label: t('grossMargin'), qoq: t('qoq'), yoy: t('yoy') }, fmtPct(gm), { qoq: pDelta(gm, p1, 'gross', 'revenue'), yoy: null }) +
    kpiCard({ label: t('opMargin'), qoq: t('qoq'), yoy: t('yoy') }, fmtPct(om), { qoq: pDelta(om, p1, 'opInc', 'revenue'), yoy: null }) +
    kpiCard({ label: t('netMargin'), qoq: t('qoq'), yoy: t('yoy') }, fmtPct(nm), { qoq: pDelta(nm, p1, 'netInc', 'revenue'), yoy: null });

  renderChart();

  document.getElementById('srcLine').innerHTML =
    `${t('source')} <a href="${DATA.sourceUrl}" target="_blank">SEC EDGAR XBRL companyfacts</a> (US-GAAP)`;
  document.getElementById('updLine').textContent = `${t('updated')} ${DATA.updated}`;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

function exportPNG() {
  const svg = document.getElementById('sankey');
  const panel = document.getElementById('chartPanel');
  // serialize the SVG with inlined text styles, draw onto cream canvas with title/as-of
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const W = panel.clientWidth, H = panel.clientHeight, ratio = 2;
    const topPad = 56; // headroom so in-chart node labels near y=0 are never clipped
    const canvas = document.createElement('canvas');
    canvas.width = W * ratio; canvas.height = (H + topPad) * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#f2efe9';
    ctx.fillRect(0, 0, W, H + topPad);
    const title = document.getElementById('chartTitle').textContent;
    ctx.fillStyle = '#1d55a5'; ctx.font = 'bold 26px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 40);
    ctx.fillStyle = INK; ctx.font = '13px "Segoe UI", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(document.getElementById('chartAsof').textContent, W - 24, 36);
    ctx.textAlign = 'left';
    ctx.drawImage(img, 0, topPad, W, svg.clientHeight);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.download = `profit_bridge_${state.company}_${q().end}.png`;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
  };
  img.src = url;
}

function initControls() {
  const cs = document.getElementById('companySelect');
  cs.innerHTML = Object.entries(DATA.companies)
    .map(([tk, c]) => `<option value="${tk}">${tk} — ${c.name}</option>`).join('');
  cs.addEventListener('change', () => { state.company = cs.value; state.qIndex = null; render(); });
  document.getElementById('quarterSelect').addEventListener('change', e => {
    state.qIndex = Number(e.target.value); render();
  });
  document.getElementById('btnReset').addEventListener('click', () => { state = { company: 'NVDA', qIndex: null }; render(); });
  document.getElementById('btnLang').addEventListener('click', () => { lang = lang === 'en' ? 'zh' : 'en'; render(); });
  document.getElementById('btnExport').addEventListener('click', exportPNG);
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
  window.addEventListener('resize', () => renderChart());
  initControls();
  render();
})();
