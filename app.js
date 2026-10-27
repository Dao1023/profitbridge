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
    viewBridge: 'Sankey', viewBar: 'Bar chart',
    barGroups: { items: 'Income statement', segments: 'Segments', margins: 'Margins' },
    barNoData: 'No disclosed data for this item', barFullHistory: 'full history', barFullHistoryAnnual: 'full history (annual)',
    barNoDataTag: 'no data',
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
    viewBridge: '桑基图', viewBar: '柱状图',
    barGroups: { items: '利润科目', segments: '分部', margins: '利润率' },
    barNoData: '该子项无披露数据', barFullHistory: '全历史季度', barFullHistoryAnnual: '全历史年度',
    barNoDataTag: '无数据',
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
  return isAnnual() ? `FY ${y}` : `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
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
/* ---- industry filter: mapping table lives here (data/ untouched) ----
   A company may span MULTIPLE industries (e.g. Google = internet + AI):
   INDUSTRY_OF[tk] is an array; filtering is multi-select union. */
const INDUSTRY_GROUPS = [
  { id: 'semi', zh: '半导体', en: 'Semiconductors', tickers: [
    'NVDA','AMD','INTC','AVGO','MU','QCOM','NXPI','ARM','STM','TSM','ASML',
    '00981.HK','688981.SS','688825.SS','688256.SS','688795.SS','2454.TW','2330.TW','000660.KS','005930.KS'] },
  { id: 'ai', zh: 'AI', en: 'AI', tickers: [
    'NVDA','AMD','GOOGL','MSFT','META','AVGO','BIDU','CRWV','PLTR','TSLA','SPCX',
    '688256.SS','688795.SS'] },
  { id: 'soft', zh: '软件/互联网', en: 'Software / Internet', tickers: [
    'MSFT','GOOGL','AMZN','META','ORCL','PLTR','NFLX','ADBE','IBM','U','DUOL','SPOT','CRWV',
    'BABA','BIDU','TCOM','JD','PDD','BILI','WB','ZH','XNET','TME','DIDIY',
    '00700.HK','03690.HK','01024.HK','03888.HK','601360.SS'] },
  { id: 'hw', zh: '硬件/消费电子', en: 'Hardware / Devices', tickers: [
    'AAPL','DELL','HPQ','CSCO','MSI','SONY','005930.KS','066570.KS','00992.HK',
    '002415.SZ','000333.SZ','000100.SZ','HUAWEI'] },
  { id: 'auto', zh: '汽车/新能源', en: 'Auto / Energy', tickers: ['TSLA','LI','300750.SZ','002594.SZ'] },
  { id: 'space', zh: '航天', en: 'Aerospace', tickers: ['SPCX'] },
  { id: 'cons', zh: '消费', en: 'Consumer', tickers: [
    'KO','MCD','SBUX','LKNCY','02097.HK','00151.HK','600519.SS','600887.SS','NESN.SW','MC.PA',
    'AAPL','SONY','LEGO'] },
  { id: 'fin', zh: '金融', en: 'Financials', tickers: ['V','01398.HK','03968.HK'] },
  { id: 'tele', zh: '通信', en: 'Telecom', tickers: ['00941.HK','00728.HK','00762.HK','000063.SZ','HUAWEI'] },
];
const INDUSTRY_OF = {};
for (const g of INDUSTRY_GROUPS) g.tickers.forEach(tk => { (INDUSTRY_OF[tk] ||= []).push(g.id); });
const industriesOf = tk => INDUSTRY_OF[tk] || [];

let state = { company: 'NVDA', qIndex: null, mode: { pct: false, qoq: false }, view: 'bridge', barItem: 'revenue', curMode: 'native', industries: [] }; // qIndex null = latest; curMode: CNY companies 'native' ¥ | 'usd'
/* bar-view overlay lines (占比/环比 buttons control these in bar view; sankey keeps state.mode) */
const barLines = { pct: true, qoq: true };

const MB = 1e3; // millions → billions display factor (all data is in millions of the reporting currency)
/* reporting-currency symbol per company (currency field = <ISO>-M; foreign filers like
   SPOT/ASML EUR, SONY JPY, TME CNY store values as filed) */
const CUR_SYM = { USD: '$', EUR: '€', JPY: '¥', CNY: '¥', TWD: 'NT$', KRW: '₩', CHF: 'CHF ' };
const curSym = (tk = state.company) =>
  CUR_SYM[(DATA.companies[tk].currency || 'USD-M').slice(0, 3)] || (DATA.companies[tk].currency || 'USD-M').slice(0, 3) + ' ';
const isAnnual = (tk = state.company) => DATA.companies[tk].frequency === 'annual'; // 20-F annual series vs 10-Q quarterly
/* ---- multi-currency display layer ----
   Native values live in profit.json in the reporting currency (entry.currency).
   USD entries show as-is. CNY entries get a ¥/US$ toggle (per-period fxToUsd).
   Every other non-USD currency (EUR/JPY/TWD/KRW/CHF-M) auto-converts to USD for display. */
const curOf = (tk = state.company) => (DATA.companies[tk].currency || 'USD-M');
const isUsd = (tk = state.company) => curOf(tk) === 'USD-M';
const canToggleCur = (tk = state.company) => curOf(tk) === 'CNY-M';
const dispInUsd = (tk = state.company) => isUsd(tk) || !canToggleCur(tk) || state.curMode === 'usd';
/* native value → display-unit scale (unitless); per-period fxToUsd, 1 for USD/native */
function dispFactor(qv, tk = state.company) {
  return dispInUsd(tk) && qv && qv.fxToUsd != null ? qv.fxToUsd : 1;
}
/* scale for segments.json values (always USD $M): to USD display 1, to native CNY 1/fx */
function segFactor(qv, tk = state.company) {
  return dispInUsd(tk) ? 1 : 1 / (qv && qv.fxToUsd != null ? qv.fxToUsd : 1);
}
function dispSym(tk = state.company) { return dispInUsd(tk) ? '$' : '¥'; }
/* QoQ label — '同比/YoY' on annual series, '环比/QoQ' otherwise */
const qoqSuffix = () => isAnnual() ? (lang === 'zh' ? '同比' : 'YoY') : t('qoqSuffix');
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
  const B = MB, f = dispFactor(qv);
  const m = {
    revenue: qv.revenue * f, gross: qv.gross != null ? qv.gross * f : null,
    cogs: qv.gross != null ? (qv.revenue - qv.gross) * f : null,
    rd: qv.rd != null ? qv.rd * f : null, sga: qv.sga != null ? qv.sga * f : null,
    op: qv.opInc != null ? qv.opInc * f : null, net: qv.netInc != null ? qv.netInc * f : null,
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
  /* comparable prior period: same period class (annual row vs single quarter),
     sane day-gap (annual ↔ annual: 300–400d; quarter ↔ quarter: 70–250d).
     Prevents comparing across the annual/interim boundary in hk-mixed series. */
  const qs = DATA.companies[state.company].quarters;
  const curIdx = state.qIndex == null ? qs.length - 1 : state.qIndex;
  const i = curIdx - (offset || 0);
  if (i < 0 || i >= qs.length) return null;
  const cur = qs[curIdx], p = qs[i];
  const cls = qv => (isAnnual() || qv.periodType === 'annual') ? 'annual' : 'q';
  if (cls(p) !== cls(cur)) return null;
  const d = Math.abs((new Date(p.end) - new Date(cur.end)) / 864e5);
  if (cls(cur) === 'annual') return (d >= 300 && d <= 400) ? p : null;
  return (d >= 70 && d <= 250) ? p : null;
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
  const B = MB, M = 1, f = dispFactor(qv), sf = segFactor(qv);
  const rev = qv.revenue * f / B, gross = qv.gross != null ? qv.gross * f / B : null,
        op = qv.opInc != null ? qv.opInc * f / B : null, net = qv.netInc != null ? qv.netInc * f / B : null;
  const nodes = [], links = [];
  const hasChildren = segList && segList.some(s => s.children && s.children.length);
  const revDepth = hasChildren ? 2 : (segList ? 1 : 0);
  const segName = n => 'seg:' + n; // namespace so segments can never collide with computed node ids

  // ---- input side ----
  if (segList && segList.length) {
    for (const s of segList) {
      if (s.children && s.children.length) {
        const parentVal = s.children.reduce((a, c) => a + c.value, 0) * sf / 1000;
        for (const ch of s.children) {
          nodes.push({ name: segName(ch.name), value: ch.value * sf / 1000, depth: 0, itemStyle: { color: BLUE } });
          links.push({ source: segName(ch.name), target: segName(s.name), value: ch.value * sf / 1000 });
        }
        nodes.push({ name: segName(s.name), value: parentVal, depth: 1, itemStyle: { color: BLUE } });
        links.push({ source: segName(s.name), target: 'revenue', value: parentVal });
      } else {
        nodes.push({ name: segName(s.name), value: s.value * sf / 1000, depth: 0, itemStyle: { color: BLUE } });
        links.push({ source: segName(s.name), target: 'revenue', value: s.value * sf / 1000 });
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
      if (hasOpexSplit && qv.rd * f / B + qv.sga * f / B <= opexVal * 1.001) {
        nodes.push({ name: 'rd', value: qv.rd * f / B, depth: revDepth + 2, itemStyle: { color: RED } });
        nodes.push({ name: 'sga', value: qv.sga * f / B, depth: revDepth + 2, itemStyle: { color: RED } });
        const other = opexVal - qv.rd * f / B - qv.sga * f / B;
        if (other > 0) { nodes.push({ name: 'opex', value: other, depth: revDepth + 2, itemStyle: { color: RED } }); links.push({ source: 'gross', target: 'opex', value: other }); }
        links.push({ source: 'gross', target: 'rd', value: qv.rd * f / B });
        links.push({ source: 'gross', target: 'sga', value: qv.sga * f / B });
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
  } else if (net != null) {
    // no gross/op disclosed (HK-style revenue+netProfit only): pure waterfall revenue → net
    if (net >= 0) {
      nodes.push({ name: 'net', value: net, depth: revDepth + 1, itemStyle: { color: GREEN } });
      links.push({ source: 'revenue', target: 'net', value: Math.min(net, rev) });
      if (rev - net > 0) { nodes.push({ name: 'taxOther', value: rev - net, depth: revDepth + 1, itemStyle: { color: RED } }); links.push({ source: 'revenue', target: 'taxOther', value: rev - net }); }
    } else {
      nodes.push({ name: 'netLoss', value: -net, depth: revDepth + 1, itemStyle: { color: RED } });
      nodes.push({ name: 'taxOther', value: rev, depth: revDepth + 1, itemStyle: { color: RED } });
      links.push({ source: 'revenue', target: 'taxOther', value: rev });
      links.push({ source: 'taxOther', target: 'netLoss', value: -net });
    }
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
  const f = dispFactor(qv);
  const out = { quarter: qv.end, inputSum: null, revenue: qv.revenue * f / MB, ok: null, waterfall: {} };
  const leafLinks = g.links.filter(l => l.source.startsWith('seg:') &&
    !g.nodes.some(n => n.name === l.source && n.depth === 1)); // leaves, not aggregate parents
  const inputSum = leafLinks.reduce((a, l) => a + l.value, 0);
  out.inputSum = inputSum;
  out.ok = Math.abs(inputSum - out.revenue) < 0.005;
  const byName = Object.fromEntries(g.nodes.map(n => [n.name, n.value]));
  out.waterfall = {
    gross: byName.gross, cogs: byName.cogs, op: byName.op, net: byName.net,
    grossEq: byName.gross == null || Math.abs(byName.gross + (byName.cogs || 0) - out.revenue) < 0.005,
    opEq: byName.op == null || qv.gross == null || Math.abs(byName.op + (byName.rd || 0) * f / MB + (byName.sga || 0) * f / MB + (byName.opex || 0) - byName.gross) < 0.01,
    netEq: byName.net == null || Math.abs(byName.net - qv.netInc * f / MB) < 0.005,
  };
  return out;
}

function renderChart() {
  if (state.view === 'bar') { renderBarChart(); return; }
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
    const revB = qv.revenue * dispFactor(qv) / MB;
    const isMargin = MARGIN_KEYS.includes(p.name);
    const amt = `${dispSym()}${p.value.toFixed(1)}B`;
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
        body += `\n{${neg ? 'down' : 'up'}|${qt} ${qoqSuffix()}}`;
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
          ? `${displayName({ name: p.data.source })} → ${displayName({ name: p.data.target })}<br/><b>${dispSym()}${p.data.value.toFixed(1)}B</b>`
          : `<b>${nm}</b><br/>${dispSym()}${p.value.toFixed(1)}B`;
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

/* ---- bar (time-series) view: x = all quarters, y = one selectable sub-item ---- */
const BAR_PROFIT_ITEMS = ['revenue', 'gross', 'op', 'net', 'cogs', 'rd', 'sga', 'taxOther'];
const BAR_MARGIN_ITEMS = ['gross', 'op', 'net'];
const MARGIN_COLOR = '#1d55a5';

/* top-level OR child segment value for name in a given quarter; null when absent */
function segValueFor(ticker, qEnd, name) {
  const list = segmentsFor(ticker, qEnd);
  if (!list) return null;
  const top = list.find(s => s.name === name);
  if (top) return top.value;
  for (const s of list) { const ch = (s.children || []).find(c => c.name === name); if (ch) return ch.value; }
  return null;
}

/* disclosed single periods for the bar view — mixed-frequency entries (hk-mixed/mixed)
   draw only the actually disclosed single quarters; derived annual rows are excluded
   (no double counting, no fabricated equal-spacing axis) */
function barQuarters(ticker) {
  const e = DATA.companies[ticker];
  return (e.frequency === 'hk-mixed' || e.frequency === 'mixed')
    ? e.quarters.filter(qv => qv.periodType !== 'annual')
    : e.quarters;
}

/* Every selectable bar item for a company, with its full-history series precomputed.
   groups: items (income-statement lines, $B) / segments (from segments.json, $B) / margins (%). */
function buildBarItems(ticker) {
  const qs = barQuarters(ticker);
  const f0 = dispInUsd(ticker) ? 1 : 1 / (qs[qs.length - 1] && qs[qs.length - 1].fxToUsd != null ? qs[qs.length - 1].fxToUsd : 1); // segment scale (per-period fx differs; segments only exist on US cos anyway)
  const out = [];
  for (const id of BAR_PROFIT_ITEMS) {
    const data = qs.map(qv => { const m = rawMetrics(qv); return m && m[id] != null ? m[id] / MB : null; });
    out.push({ id, label: tn(id), group: 'items', kind: 'amount', color: NODE_COLORS[id], data, hasData: data.some(v => v != null) });
  }
  const segNames = [];
  if (SEG && SEG.companies[ticker] && SEG.companies[ticker].quarters) {
    const seen = new Set();
    for (const list of Object.values(SEG.companies[ticker].quarters))
      for (const s of list)
        for (const nm of [s.name, ...(s.children || []).map(c => c.name)])
          if (!seen.has(nm)) { seen.add(nm); segNames.push(nm); }
  }
  for (const nm of segNames) {
    const data = qs.map(qv => { const v = segValueFor(ticker, qv.end, nm); return v != null ? v * segFactor(qv, ticker) / MB : null; });
    out.push({ id: 'seg:' + nm, segName: nm, label: nm, group: 'segments', kind: 'segment', color: BLUE, data, hasData: data.some(v => v != null) });
  }
  for (const mk of BAR_MARGIN_ITEMS) {
    const data = qs.map(qv => { const m = rawMetrics(qv); return m && m.revenue && m[mk] != null ? m[mk] / m.revenue * 100 : null; });
    out.push({ id: 'margin:' + mk, mk, label: t('margins')[mk], group: 'margins', kind: 'margin', color: MARGIN_COLOR, data, hasData: data.some(v => v != null) });
  }
  return out;
}

/* dropdown in the header: grouped 利润科目/分部/利润率; no-data items disabled + tagged */
function renderBarSelect() {
  const sel = document.getElementById('barSelect');
  const items = buildBarItems(state.company);
  if (!items.some(i => i.id === state.barItem)) state.barItem = 'revenue'; // new company may lack the old pick
  sel.innerHTML = ['items', 'segments', 'margins'].map(g => {
    const gi = items.filter(i => i.group === g);
    if (!gi.length) return '';
    return `<optgroup label="${t('barGroups')[g]}">` + gi.map(i =>
      `<option value="${i.id}"${i.id === state.barItem ? ' selected' : ''}${i.hasData ? '' : ' disabled'}>${i.label}${i.hasData ? '' : ' (' + t('barNoDataTag') + ')'}</option>`
    ).join('') + '</optgroup>';
  }).join('');
  sel.style.display = state.view === 'bar' ? '' : 'none';
  sel.onchange = () => { state.barItem = sel.value; renderChart(); };
}

/* full echarts bar option: x = all quarters (no holes), y = selected item.
   pct/qoq modes annotate the tooltip (bar height always stays the raw amount —
   a 64-bar % -of-revenue chart would flatten the scale and lose the trend). */
function renderBarChart() {
  const qs = barQuarters(state.company);
  const items = buildBarItems(state.company);
  const item = items.find(i => i.id === state.barItem) || items[0];
  const perRowLabel = qv => (qv.periodType === 'annual' || isAnnual())
    ? 'FY ' + qv.end.slice(0, 4)
    : `Q${Math.floor((Number(qv.end.slice(5, 7)) - 1) / 3) + 1}'${qv.end.slice(2, 4)}`;
  const labels = qs.map(perRowLabel);
  const hasAny = item.data.some(v => v != null);
  const isMargin = item.kind === 'margin';
  const fmtVal = v => isMargin ? v.toFixed(1) + '%' : dispSym() + v.toFixed(1) + 'B';
  document.getElementById('chartTitle').textContent =
    `${shortName(state.company)} · ${item.label}${hasAny ? ' · ' + t(isAnnual() ? 'barFullHistoryAnnual' : 'barFullHistory') : ''}`;

  /* overlay lines follow the SELECTED item (占比/环比 buttons toggle each line):
     ① share-of-revenue % line (margin items are already % → line = the value itself)
     ② QoQ/YoY growth line (annual series → 同比; margin items → pp change)
     null (missing data / no prior period) breaks the line — no fake points. */
  const pctLine = item.data.map((v, i) => {
    if (v == null) return null;
    if (isMargin) return +v.toFixed(2);
    const m = rawMetrics(qs[i]);
    return (m && m.revenue) ? +(v / m.revenue * 100).toFixed(2) : null;
  });
  const growthLine = item.data.map((v, i) => {
    const pv = item.data[i - 1];
    if (v == null || i === 0 || pv == null) return null; // 占位季度断线
    return +(isMargin ? (v - pv) : (v - pv) / Math.abs(pv) * 100).toFixed(2);
  });
  const pctName = `${item.label} · ${t('ofRev')}${isMargin ? '' : ' %'}`;
  const growthName = `${item.label} · ${qoqSuffix()}${isMargin ? ' (pp)' : ' %'}`;
  const lineSeries = [
    ...(barLines.pct ? [{
      name: pctName, type: 'line', yAxisIndex: 1, data: pctLine,
      symbol: 'circle', symbolSize: 5, connectNulls: false,
      lineStyle: { color: '#b91c1c', width: 2 }, itemStyle: { color: '#b91c1c' },
    }] : []),
    ...(barLines.qoq ? [{
      name: growthName, type: 'line', yAxisIndex: 1, data: growthLine,
      symbol: 'circle', symbolSize: 5, connectNulls: false,
      lineStyle: { color: '#0f766e', width: 2 }, itemStyle: { color: '#0f766e' },
    }] : []),
  ];

  const opt = {
    backgroundColor: 'transparent',
    legend: lineSeries.length ? {
      top: 42, right: 254, itemWidth: 14, itemHeight: 8, // left of the barSelect overlay, below the meta line
      textStyle: { color: '#475569', fontSize: 12 },
    } : undefined,
    tooltip: {
      trigger: 'axis', confine: true,
      formatter: params => {
        const arr = Array.isArray(params) ? params : [params];
        const p = arr[0];
        const i = p.dataIndex, qv = qs[i], val = item.data[i];
        const lines = [`<b>${quarterLabel(qv.end)}</b> <span style="color:#94a3b8">${qv.end}</span>`];
        if (val == null) {
          lines.push('—');
        } else {
          lines.push(`<b>${fmtVal(val)}</b>`);
          if (state.mode.pct && !isMargin) { // share of that quarter's revenue
            const m = rawMetrics(qv);
            if (m && m.revenue) lines.push(`${t('ofRev')} ${fmtPct(val * MB / m.revenue)}`);
          }
        }
        if (state.mode.qoq && i > 0) { // margins → pp, amounts → % change
          const pv = item.data[i - 1];
          const d = (val != null && pv != null) ? (isMargin ? (val - pv) : (val - pv) / Math.abs(pv)) : null;
          lines.push(`${qoqSuffix()} ${isMargin ? fmtPP(d) : fmtDelta(d)}`);
        }
        for (const s of arr) { // overlay lines
          if (s.seriesName === pctName) {
            lines.push(`${pctName}: ${s.value == null ? '—' : s.value.toFixed(1) + (isMargin ? '%' : '%')}`);
          } else if (s.seriesName === growthName) {
            lines.push(`${growthName}: ${s.value == null ? '—' : (s.value > 0 ? '+' : '') + s.value.toFixed(1) + (isMargin ? 'pp' : '%')}`);
          }
        }
        return lines.join('<br/>');
      },
    },
    /* time-window slider (e.g. 2020–2023): drag/hover the bottom slider or
       scroll-zoom inside the chart; bars + lines rescale together */
    dataZoom: [
      {
        type: 'slider', xAxisIndex: 0, height: 20, bottom: 10, brushSelect: false,
        borderColor: '#d8dee9', backgroundColor: '#ffffff',
        fillerColor: 'rgba(37,99,235,.14)', handleStyle: { color: '#2563eb' },
        moveHandleStyle: { color: '#2563eb' }, emphasis: { handleStyle: { borderColor: '#2563eb' } },
        dataBackground: { lineStyle: { color: '#94a3b8' }, areaStyle: { color: 'rgba(148,163,184,.18)' } },
        selectedDataBackground: { lineStyle: { color: '#2563eb' }, areaStyle: { color: 'rgba(37,99,235,.15)' } },
        textStyle: { color: '#64748b', fontSize: 10 },
      },
      { type: 'inside', xAxisIndex: 0 },
    ],
    grid: { left: 64, right: lineSeries.length ? 56 : 24, top: 56, bottom: 92 }, // top:56 keeps y-axis name clear of the meta overlay
    xAxis: {
      type: 'category', data: labels,
      axisLabel: { rotate: 45, fontSize: 11, color: '#64748b', interval: 'auto', hideOverlap: true },
      axisLine: { lineStyle: { color: '#cbd5e1' } }, axisTick: { alignWithLabel: true },
    },
    yAxis: [
      {
        type: 'value', name: isMargin ? '%' : dispSym() + 'B', nameTextStyle: { color: '#64748b' },
        axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e6ee' } },
      },
      ...(lineSeries.length ? [{
        type: 'value', name: '%', position: 'right', nameTextStyle: { color: '#64748b' },
        axisLabel: { color: '#64748b', formatter: '{value}%' }, splitLine: { show: false },
      }] : []),
    ],
    graphic: hasAny ? [] : [{ type: 'text', left: 'center', top: 'middle',
      style: { text: t('barNoData'), fontSize: 20, fontWeight: 600, fill: '#94a3b8' } }],
    series: [
      { name: item.label, type: 'bar', data: item.data, barMaxWidth: 16,
        itemStyle: { color: item.color, borderRadius: [2, 2, 0, 0] } },
      ...lineSeries,
    ],
  };
  chart.setOption(opt, true); // notMerge: full replacement every time (pitfall #1)
  // re-apply the remembered time window (company switch / re-render must not
  // reset the user's zoom — see switchCompany state-memory)
  if (window.__barZoom) chart.dispatchAction({ type: 'dataZoom', xAxisIndex: 0, start: window.__barZoom.start, end: window.__barZoom.end });
  window.__barMeta = { company: state.company, item: item.id, kind: item.kind, labels, data: item.data, quarterCount: qs.length,
    pctLine, growthLine, linesShown: lineSeries.map(s => s.name) };
  window.__lastOption = { ...opt, backgroundColor: '#f2efe9', tooltip: undefined }; // WYSIWYG PNG export
}


/* ---- left logo rail ---- */
const MONO_COLORS = ['#1d55a5','#b91c1c','#0f766e','#7c3aed','#c2410c','#be185d','#15803d','#a16207','#1e40af','#4d7c0f'];
function renderLogoRail() {
  const rail = document.getElementById('logoRail');
  /* build DOM once; subsequent renders only toggle classes — re-creating <img>
     nodes on company switch re-fetched logos and made the rail visibly jitter */
  if (rail.dataset.built !== '1' || rail.dataset.lang !== lang) {
    rail.innerHTML = Object.keys(DATA.companies).map((tk, i) => {
      const c = DATA.companies[tk];
      return `<div class="logo${tk === state.company ? ' active' : ''}${c.preview ? ' preview' : ''}" data-sym="${tk}" title="${tk} · ${regOf(tk)?.nameZh || ZH_NAMES_FALLBACK[tk] || ''}">
         <img src="data/logos/${tk}.png" alt="${tk}"
           onerror="this.outerHTML='<div class=\\'mono\\' style=\\'background:${regOf(tk)?.color || MONO_COLORS[i % MONO_COLORS.length]}\\'>${tk.slice(0, 2)}</div>'">
         ${c.preview ? '<span class="pvBadge">Preview</span>' : ''}
       </div>`;
    }).join('');
    rail.querySelectorAll('.logo').forEach(el => el.addEventListener('click', () => switchCompany(el.dataset.sym)));
    rail.dataset.built = '1'; rail.dataset.lang = lang;
  }
  /* incremental update: active highlight + industry visibility, no DOM rebuild */
  rail.querySelectorAll('.logo').forEach(el => {
    const tk = el.dataset.sym;
    el.classList.toggle('active', tk === state.company);
    // union of selected industries; empty selection = all
    el.classList.toggle('hidden',
      state.industries.length > 0 && !industriesOf(tk).some(id => state.industries.includes(id)));
  });
}

/* ---- industry filter bar (top of page, above the logo rail) ----
   single-select: clicking a category selects it; clicking it again (or 全部/All)
   deselects → all logos visible */
function renderIndustryBar() {
  const bar = document.getElementById('industryBar');
  if (bar.dataset.built !== '1' || bar.dataset.lang !== lang) {
    const counts = {};
    Object.keys(DATA.companies).forEach(tk => industriesOf(tk).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
    const btn = (id, label, cnt) => `<button class="indBtn" data-ind="${id}">${label}<span class="cnt">${cnt}</span></button>`;
    const all = lang === 'zh' ? '全部' : 'All';
    bar.innerHTML = `<span class="lbl">${lang === 'zh' ? '行业' : 'Industry'}</span>`
      + btn('all', all, Object.keys(DATA.companies).length)
      + INDUSTRY_GROUPS.map(g => btn(g.id, lang === 'zh' ? g.zh : g.en, counts[g.id] || 0)).join('');
    bar.querySelectorAll('.indBtn').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.ind;
      if (id === 'all') state.industries = [];
      else state.industries = (state.industries[0] === id) ? [] : [id]; // single-select, click again to clear
      syncHash(); // URL hash sync (replaceState: no history spam)
      render();
    }));
    bar.dataset.built = '1'; bar.dataset.lang = lang;
  }
  bar.querySelectorAll('.indBtn').forEach(el => el.classList.toggle('active',
    el.dataset.ind === 'all' ? state.industries.length === 0 : state.industries.includes(el.dataset.ind)));
}

/* ---- company switch with view-state memory ----
   Keep everything the user has dialed in (view mode, pct/qoq toggles, bar item,
   dataZoom window, selected reporting date, currency) — only the date is
   re-aligned when the new company lacks that exact period (nearest quarter,
   with a soft hint). Never resets to defaults on switch. */
function switchCompany(tk) {
  if (!DATA.companies[tk] || tk === state.company) return;
  const prevEnd = curQIndex() != null ? DATA.companies[state.company].quarters[curQIndex()]?.end : null;
  state.company = tk;
  const qs = DATA.companies[tk].quarters;
  if (prevEnd && qs.length) {
    let best = -1, bestD = Infinity;
    qs.forEach((qv, i) => {
      const d = Math.abs(new Date(qv.end + 'T00:00:00Z') - new Date(prevEnd + 'T00:00:00Z'));
      if (d < bestD) { bestD = d; best = i; }
    });
    state.qIndex = best;
    if (qs[best].end !== prevEnd) // exact period missing → nearest, with a soft hint
      showHint(lang === 'zh' ? `该公司无 ${prevEnd} 期，已对齐至最近可用期 ${qs[best].end}` : `No ${prevEnd} period for this company — aligned to nearest: ${qs[best].end}`);
  } else state.qIndex = null; // "latest" stays latest
  if (!canToggleCur()) state.curMode = 'native'; // currency toggle only exists for CNY reporters
  render();
}

/* transient toast (bottom center): used for quarter realignment notices */
let hintTimer = null;
function showHint(msg) {
  let el = document.getElementById('hintToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hintToast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---- URL hash: full view state (shareable / refresh-stable) ----
   #c=<ticker>&q=<period-end>&v=bar&m=<barItem>&z=<start>-<end>&ind=<industryId> */
function syncHash() {
  const p = new URLSearchParams();
  if (state.company !== 'NVDA') p.set('c', state.company);
  const ci = curQIndex();
  if (ci != null) p.set('q', DATA.companies[state.company].quarters[ci].end);
  if (state.view !== 'bridge') p.set('v', state.view);
  if (state.view === 'bar' && state.barItem !== 'revenue') p.set('m', state.barItem);
  if (window.__barZoom) p.set('z', `${Math.round(window.__barZoom.start)}-${Math.round(window.__barZoom.end)}`);
  if (state.industries.length) p.set('ind', state.industries[0]);
  const h = p.toString();
  const url = location.pathname + location.search + (h ? '#' + h : '');
  history.replaceState ? history.replaceState(null, '', url) : (location.hash = h);
}
function applyHash() {
  const hp = new URLSearchParams(location.hash.slice(1));
  const tk = hp.get('c');
  if (tk && DATA.companies[tk]) state.company = tk;
  const v = hp.get('v');
  if (v === 'bar' || v === 'bridge') state.view = v;
  const mi = hp.get('m');
  if (mi) state.barItem = mi; // renderBarSelect falls back to 'revenue' if missing
  const q = hp.get('q');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const qs = DATA.companies[state.company].quarters;
    let best = -1, bestD = Infinity;
    qs.forEach((qv, i) => {
      const d = Math.abs(new Date(qv.end + 'T00:00:00Z') - new Date(q + 'T00:00:00Z'));
      if (d < bestD) { bestD = d; best = i; }
    });
    state.qIndex = best >= 0 && bestD < 100 * 864e5 ? best : null; // >100d off → ignore, use latest
  }
  const z = hp.get('z');
  if (z && /^\d{1,3}-\d{1,3}$/.test(z)) {
    const [a, b] = z.split('-').map(Number);
    if (a < b) window.__barZoom = { start: Math.max(0, a), end: Math.min(100, b) };
  }
  // industry deep-link: #ind=<id> (single-select; legacy comma lists → first value)
  const ind = hp.get('ind');
  if (ind) state.industries = [ind.split(',')[0]].filter(id => INDUSTRY_GROUPS.some(g => g.id === id));
}

/* ---- bottom timeline ---- */
function curQIndex() { return state.qIndex == null ? DATA.companies[state.company].quarters.length - 1 : state.qIndex; }
function setQuarter(i) {
  const n = DATA.companies[state.company].quarters.length;
  i = Math.max(0, Math.min(n - 1, i));
  if (i === curQIndex()) { renderTimeline(); return; }
  state.qIndex = i;
  render(); // full setOption(data+links) via renderChart — never partial updates
}
function yearOf(end) { return new Date(end + 'T00:00:00Z').getUTCFullYear(); }
function renderTimeline() {
  const qs = DATA.companies[state.company].quarters, n = qs.length, cur = curQIndex();
  const ticks = document.getElementById('tlTicks');
  // year-dedup sampling: always keep the first, last and active quarter, plus one
  // representative per calendar year — the same year never gets two ticks. The
  // active tick additionally shows the full quarter-end date; sampled ticks show
  // the bare year (with 64 quarters a "Y Qx + date" label set overflows the track).
  const order = [cur, n - 1, 0];
  const byYear = new Map();
  for (let i = 0; i < n; i++) { const y = yearOf(qs[i].end); if (!byYear.has(y)) byYear.set(y, i); }
  for (const i of [...byYear.values()].sort((a, b) => a - b)) order.push(i);
  const usedYears = new Set(), show = [];
  for (const i of order) {
    const y = yearOf(qs[i].end);
    if (usedYears.has(y)) continue;
    usedYears.add(y); show.push(i);
  }
  show.sort((a, b) => a - b);
  ticks.innerHTML = show.map(i =>
    `<div class="tl-tick${i === cur ? ' active' : ''}" data-i="${i}" title="${qs[i].end}">
       <div class="q">${yearOf(qs[i].end)}</div>${i === cur ? `<div class="d">${qs[i].end}</div>` : ''}</div>`).join('');
  ticks.querySelectorAll('.tl-tick').forEach(el =>
    el.addEventListener('click', () => setQuarter(Number(el.dataset.i))));
  const pct = n > 1 ? (cur / (n - 1)) * 100 : 0;
  document.getElementById('tlFill').style.width = pct + '%';
  document.getElementById('tlThumb').style.left = pct + '%';
  renderSnapDots(n);
}
/* one semi-transparent landing mark per quarter on the track; the nearest mark
   to the pointer lights up while dragging, and release snaps to it */
function renderSnapDots(n) {
  const track = document.querySelector('.tl-track');
  track.querySelectorAll('.tl-dot').forEach(d => d.remove());
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'tl-dot'; d.dataset.i = i;
    d.style.left = (n > 1 ? (i / (n - 1)) * 100 : 0) + '%';
    track.appendChild(d);
  }
}
function markNearDot(idx) {
  const tl = document.getElementById('timeline');
  tl.querySelectorAll('.tl-dot').forEach(d => d.classList.toggle('near', Number(d.dataset.i) === idx));
}
function initTimelineDrag() {
  const thumb = document.getElementById('tlThumb');
  const tl = document.getElementById('timeline');
  let dragging = false;
  const qIndexAt = e => {
    const track = thumb.parentElement, r = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return Math.round(frac * (DATA.companies[state.company].quarters.length - 1));
  };
  thumb.addEventListener('pointerenter', () => { if (!dragging) tl.classList.add('hover'); });
  thumb.addEventListener('pointerleave', () => { if (!dragging) tl.classList.remove('hover'); });
  thumb.addEventListener('pointerdown', e => { dragging = true; tl.classList.add('dragging'); const i = qIndexAt(e); setQuarter(i); markNearDot(i); thumb.setPointerCapture(e.pointerId); e.preventDefault(); });
  thumb.addEventListener('pointermove', e => {
    if (!dragging) { tl.classList.add('hover'); return; }
    const i = qIndexAt(e);
    setQuarter(i);      // render() rebuilds the dots, so mark near AFTER it
    markNearDot(i);
  });
  const endDrag = () => { dragging = false; tl.classList.remove('dragging', 'hover'); markNearDot(-1); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
}

function render() {
  const c = DATA.companies[state.company];
  const qv = q();
  document.getElementById('brand').textContent = t('appTitle');
  // company/period meta + source + updated merged into one small top-right line
  // (replaces the old h1 subtitle and the bottom footer/covLine rows)
  {
    const bits = [c.name, qv.end + (isAnnual() ? (lang === 'zh' ? ' 财年末' : ' (fiscal year end)') : (lang === 'zh' ? ' 季度末' : ' (quarter end)'))];
    if (c.currency && c.currency !== 'USD-M') bits.push(c.currency.replace('-M', ''));
    if (dispInUsd() && c.currency !== 'USD-M') bits.push('≈US$');
    if (c.preview) bits.push(lang === 'zh' ? 'Preview（未上市，预览数据）' : 'Preview (private)');
    document.getElementById('metaLine').innerHTML =
      `${bits.join(' · ')}<br/>${t('updated')} ${DATA.updated} · ${t('source')} <a href="${DATA.sourceUrl}" target="_blank">SEC EDGAR XBRL</a>`;
  }
  document.getElementById('btnExportPNG').querySelector('span').textContent = t('exportPNG');
  document.getElementById('btnExportSVG').querySelector('span').textContent = t('exportSVG');
  document.getElementById('btnLang').textContent = t('langBtn');

  // currency toggle: only CNY-reporting companies get a ¥/US$ switch
  const btnCur = document.getElementById('btnCur');
  btnCur.style.display = canToggleCur() ? '' : 'none';
  if (canToggleCur()) {
    btnCur.textContent = dispInUsd() ? (lang === 'zh' ? '显示 ¥' : 'Show ¥') : (lang === 'zh' ? '显示 US$' : 'Show US$');
    btnCur.classList.toggle('active', dispInUsd());
  }

  // label-mode buttons: text + active state (stackable pct/qoq; annual series → 同比/YoY)
  document.getElementById('lblPct').textContent = t('pctBtn');
  document.getElementById('lblQoQ').textContent = isAnnual() ? (lang === 'zh' ? '同比' : 'YoY') : t('qoqBtn');
  document.getElementById('btnPct').classList.toggle('active', state.view === 'bar' ? barLines.pct : state.mode.pct);
  document.getElementById('btnQoQ').classList.toggle('active', state.view === 'bar' ? barLines.qoq : state.mode.qoq);

  // view switcher: bridge (sankey + timeline) vs bar (full-history time series)
  document.getElementById('lblViewBridge').textContent = t('viewBridge');
  document.getElementById('lblViewBar').textContent = t('viewBar');
  document.getElementById('btnViewBridge').classList.toggle('active', state.view === 'bridge');
  document.getElementById('btnViewBar').classList.toggle('active', state.view === 'bar');
  document.getElementById('timeline').style.display = state.view === 'bar' ? 'none' : '';
  renderBarSelect(); // must run before renderChart — it fixes state.barItem for the new company

  renderIndustryBar();
  renderLogoRail();
  renderTimeline();
  renderChart();

  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  syncHash(); // keep the shareable view-state hash in step with every render
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
  a.download = `${state.view === 'bar' ? 'bar_' + state.barItem.slice(4) : 'profit_bridge'}_${state.company}_${q().end}.png`;
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
  a.download = `${state.view === 'bar' ? 'bar_' + state.barItem.slice(4) : 'profit_bridge'}_${state.company}_${q().end}.svg`;
  a.href = url; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function initControls() {
  initTimelineDrag();
  document.getElementById('btnLang').addEventListener('click', () => { lang = lang === 'en' ? 'zh' : 'en'; render(); });
  document.getElementById('btnExportPNG').addEventListener('click', exportPNG);
  document.getElementById('btnExportSVG').addEventListener('click', exportSVG);
  document.getElementById('btnPct').addEventListener('click', () => {
    if (state.view === 'bar') { barLines.pct = !barLines.pct; render(); } // bar view: toggle 占比 line
    else { state.mode.pct = !state.mode.pct; render(); }
  });
  document.getElementById('btnQoQ').addEventListener('click', () => {
    if (state.view === 'bar') { barLines.qoq = !barLines.qoq; render(); } // bar view: toggle 环比 line
    else { state.mode.qoq = !state.mode.qoq; render(); }
  });
  document.getElementById('btnViewBridge').addEventListener('click', () => { if (state.view !== 'bridge') { state.view = 'bridge'; render(); } });
  document.getElementById('btnViewBar').addEventListener('click', () => { if (state.view !== 'bar') { state.view = 'bar'; render(); } });
  document.getElementById('btnCur').addEventListener('click', () => {
    if (!canToggleCur()) return;
    state.curMode = dispInUsd() ? 'native' : 'usd';
    render();
  });
}

(async function main() {
  // prefer fetch (http); fall back to inlined payload (file:// double-click)
  let loaded = null;
  try {
    const res = await fetch('data/profit.json');
    if (res.ok) loaded = await res.json();
  } catch (e) { /* file:// or offline */ }
  if (!loaded && window.__PROFIT_DATA) loaded = window.__PROFIT_DATA;
  if (!loaded) { document.getElementById('brand').textContent = 'data/profit.json not found'; return; }
  DATA = loaded;
  // profitPreview (e.g. SPCX): injected as a NORMAL entry so the rail/bridge can
  // render it alongside the main series — no Preview special-casing in the UI
  // (data agent will move it into the main sequence; until then nothing breaks).
  if (DATA.profitPreview && !DATA.companies[DATA.profitPreview.ticker]) {
    const pv = DATA.profitPreview;
    DATA.companies[pv.ticker] = {
      name: pv.name, currency: pv.currency || 'USD-M', frequency: pv.frequency || 'q',
      quarters: pv.quarters,
    };
  }
  try {
    const res = await fetch('data/segments.json');
    if (res.ok) SEG = await res.json();
  } catch (e) { /* segments optional — waterfall only */ }
  try {
    const res = await fetch('data/companies.json');
    if (res.ok) REGISTRY = await res.json();
  } catch (e) { /* registry optional — built-in fallbacks cover the 10 dashboard companies */ }

  chart = echarts.init(document.getElementById('sankey'), null, { renderer: 'svg' });
  chart.on('datazoom', () => { // remember the user's time window (also synced to hash)
    const dz = (chart.getOption().dataZoom || [])[0];
    if (dz && dz.start != null && dz.end != null) {
      window.__barZoom = { start: dz.start, end: dz.end };
      syncHash();
    }
  });
  applyHash(); // deep-link: #c=&q=&v=&m=&z=&ind= (legacy #ind= still accepted)
  window.addEventListener('resize', () => { chart.resize(); renderChart(); });
  initControls();
  render();
})();
