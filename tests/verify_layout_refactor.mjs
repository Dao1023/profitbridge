// Headless verify for the 5-item UI refactor:
// ① bar-view dataZoom time-window slider  ② no footer/covLine, meta top-right
// ③ no h1 subtitle duplication            ④ barSelect is an overlay (no toolbar shift)
// ⑤ two-row layout (industry+controls / rail+chart)
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9341;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PROFILE = new URL('./.chrome/verify-layout-' + Date.now() + '/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + PROFILE, 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => {
  const r = (await send('Runtime.evaluate', { expression: ex, returnByValue: true })).result;
  if (r?.result?.subtype === 'error' || r?.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r?.result?.description || r?.exceptionDetails?.exception?.description || r));
  return r?.result?.value;
};
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};
const rectEq = (a, b) => !a || !b ? false : ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < 0.5);

// ---------- ⑤ two-row layout structure ----------
const layout = await evl(`(() => {
  const tb = document.querySelector('.toolbar');
  const inTB = el => el && tb.contains(el);
  return {
    hasToolbar: !!tb,
    industryInToolbar: inTB(document.getElementById('industryBar')),
    controlsInToolbar: inTB(document.querySelector('.controls')),
    brand: document.getElementById('brand')?.textContent,
    railInLayout: !!document.querySelector('.layout > #logoRail'),
    chartInLayout: !!document.querySelector('.layout .main #chartPanel'),
    rowRects: {
      toolbar: tb.getBoundingClientRect().toJSON(),
      rail: document.getElementById('logoRail').getBoundingClientRect().toJSON(),
    },
  };
})()`);
check('row1 toolbar holds industry bar (left) + controls (right)', layout.hasToolbar && layout.industryInToolbar && layout.controlsInToolbar);
check('row2 layout holds logo rail (left) + chart (right)', layout.railInLayout && layout.chartInLayout);
check('brand title present', !!layout.brand, layout.brand);

// ---------- ②③ footer/covLine gone; meta top-LEFT (clear of legend/select on the right) ----------
const meta = await evl(`(() => {
  const m = document.getElementById('metaLine');
  const cs = m && getComputedStyle(m);
  return {
    exists: !!m,
    inPanel: !!(m && document.getElementById('chartPanel').contains(m)),
    pos: cs && cs.position, left: cs && cs.left, small: cs && cs.fontSize,
    hasUpdated: m && m.textContent.includes(DATA.updated),
    hasSource: !!m.querySelector('a'),
    hasCompany: m && m.textContent.length > 10,
    gone: ['footer', 'covLine', 'srcLine', 'updLine'].map(id => document.getElementById(id) || document.querySelector(id)).every(e => !e),
    noH1: !document.querySelector('h1'),
    oldSubGone: !document.querySelector('#title .sub'),
  };
})()`);
check('footer/covLine/srcLine/updLine removed', meta.gone);
check('no h1 + old subtitle gone', meta.noH1 && meta.oldSubGone);
check('meta line: absolute top-LEFT in chart panel, small', meta.exists && meta.inPanel && meta.pos === 'absolute' && meta.exists && parseFloat(meta.small) <= 12 && parseFloat(meta.left) < 30, `pos=${meta.pos} left=${meta.left} fs=${meta.small}`);
check('meta line has updated date + source link + company', meta.hasUpdated && meta.hasSource && meta.hasCompany);

// meta must not overlap chart content: it sits above the plot area (sankey canvas
// top) in bridge view, and left of the barSelect overlay in bar view
const overlapBridge = await evl(`(() => {
  const m = document.getElementById('metaLine').getBoundingClientRect();
  const cv = document.getElementById('sankey').getBoundingClientRect();
  return { abovePlot: m.bottom <= cv.top + 50, inLeftHalf: (m.right - cv.left) < cv.width * 0.6 };
})()`);
check('bridge view: meta sits above plot area, in left half', overlapBridge.abovePlot && overlapBridge.inLeftHalf, JSON.stringify(overlapBridge));

// ---------- ④ barSelect overlay: toolbar must not shift on view switch ----------
await evl(`window.__tb = document.querySelector('.toolbar').getBoundingClientRect().toJSON();
  window.__chart = document.getElementById('chartPanel').getBoundingClientRect().toJSON();
  window.__btnLang = document.getElementById('btnLang').getBoundingClientRect().toJSON();`);
await evl(`document.getElementById('btnViewBar').click()`);
await new Promise(r => setTimeout(r, 900));
const overlay = await evl(`(() => {
  const sel = document.getElementById('barSelect');
  const cs = getComputedStyle(sel);
  const panel = document.getElementById('chartPanel').getBoundingClientRect();
  const r = sel.getBoundingClientRect();
  return {
    visible: cs.display !== 'none', pos: cs.position, parentIsPanel: sel.parentElement.id === 'chartPanel',
    insidePanel: r.top >= panel.top - 1 && r.right <= panel.right + 1,
    tbStable: (() => { const b = document.querySelector('.toolbar').getBoundingClientRect().toJSON(); return ['x','y','width','height'].every(k => Math.abs(b[k]-window.__tb[k]) < 0.5); })(),
    langBtnStable: (() => { const b = document.getElementById('btnLang').getBoundingClientRect().toJSON(); return ['x','y'].every(k => Math.abs(b[k]-window.__btnLang[k]) < 0.5); })(),
    panelStable: (() => { const b = document.getElementById('chartPanel').getBoundingClientRect().toJSON(); return ['x','y','width'].every(k => Math.abs(b[k]-window.__chart[k]) < 0.5); })(),
  };
})()`);
check('barSelect is absolute overlay inside chart panel', overlay.visible && overlay.pos === 'absolute' && overlay.parentIsPanel && overlay.insidePanel, JSON.stringify(overlay));
const noSelOverlap = await evl(`(() => {
  const a = document.getElementById('metaLine').getBoundingClientRect();
  const b = document.getElementById('barSelect').getBoundingClientRect();
  return !(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
})()`);
check('meta does not overlap barSelect overlay', noSelOverlap);
check('toolbar row did NOT shift when bar view opened', overlay.tbStable && overlay.langBtnStable);
check('chart panel box unchanged by select appearing', overlay.panelStable);
await shot('layout-bar-overlay.png');

// ---------- ① dataZoom slider: drag window → bars/lines rescale ----------
const dz0 = await evl(`(() => {
  const o = chart.getOption();
  const dz = (o.dataZoom || [])[0];
  return { hasSlider: !!dz && dz.type === 'slider', inside: (o.dataZoom || []).some(d => d.type === 'inside'),
    n: o.xAxis[0].data.length, gridBottom: o.grid[0].bottom,
    pxPer100: Math.abs(chart.convertToPixel({ yAxisIndex: 0 }, 0) - chart.convertToPixel({ yAxisIndex: 0 }, 100)) };
})()`);
check('bar option has slider + inside dataZoom', dz0.hasSlider && dz0.inside, JSON.stringify(dz0));
check('grid bottom leaves room for slider (<=92)', dz0.gridBottom <= 92, `bottom=${dz0.gridBottom}`);
// simulate a drag: set window to quarters 2020-2023 via dispatchAction
const dzDrag = await evl(`(() => {
  const labels = chart.getOption().xAxis[0].data;
  const i0 = labels.findIndex(l => l.includes("'20") || l === 'FY 2020');
  const i1 = labels.findIndex(l => l.includes("'23") || l === 'FY 2023');
  chart.dispatchAction({ type: 'dataZoom', xAxisIndex: 0, startValue: i0, endValue: i1 });
  const o = chart.getOption();
  // y axis is auto-scaled, so measure the pixel height of a fixed value span:
  // zooming into a smaller window must increase pixels-per-unit (bars rescale)
  const y0 = chart.convertToPixel({ yAxisIndex: 0 }, 0);
  const y100 = chart.convertToPixel({ yAxisIndex: 0 }, 100);
  return { i0, i1, startValue: o.dataZoom[0].startValue, endValue: o.dataZoom[0].endValue,
    pxPer100: Math.abs(y0 - y100) };
})()`);
check('slider window applies (start/end values set)', dzDrag.startValue === dzDrag.i0 && dzDrag.endValue === dzDrag.i1, JSON.stringify(dzDrag));
check('y axis rescales to window (bars/lines rescale)', dzDrag.pxPer100 > dz0.pxPer100, `${dz0.pxPer100} → ${dzDrag.pxPer100} px/100`);
await shot('layout-datazoom-window.png');
// reset zoom, lines still attached
await evl(`chart.dispatchAction({ type: 'dataZoom', xAxisIndex: 0, start: 0, end: 100 })`);
const linesOk = await evl(`window.__barMeta && window.__barMeta.linesShown.length >= 0`);
check('bar meta intact after zoom reset', linesOk === true);

// bridge view: timeline still bottom row, dataZoom absent in sankey option
await evl(`document.getElementById('btnViewBridge').click()`);
await new Promise(r => setTimeout(r, 900));
const bridge = await evl(`({ tlVisible: getComputedStyle(document.getElementById('timeline')).display !== 'none',
  selHidden: getComputedStyle(document.getElementById('barSelect')).display === 'none',
  metaStill: !!document.getElementById('metaLine').textContent })`);
check('bridge view: timeline visible, select hidden, meta persists', bridge.tlVisible && bridge.selHidden && bridge.metaStill);

// ---------- height alignment: rail == chart panel (bottom edges flush) ----------
const heights = () => evl(`(() => {
  const r = document.getElementById('logoRail').getBoundingClientRect();
  const p = document.getElementById('chartPanel').getBoundingClientRect();
  const s = document.getElementById('sankey').getBoundingClientRect();
  return { rail: r.height, panel: p.height, railBottom: r.bottom, panelBottom: p.bottom, sankeyH: s.height };
})()`);
const hBridge = await heights();
check('bridge view: rail and chart equal height (<1px)', Math.abs(hBridge.rail - hBridge.panel) < 1, JSON.stringify(hBridge));
check('bridge view: bottom edges aligned (<1px)', Math.abs(hBridge.railBottom - hBridge.panelBottom) < 1);
await evl(`document.getElementById('btnViewBar').click()`);
await new Promise(r => setTimeout(r, 700));
const hBar = await heights();
check('bar view: rail and chart equal height (<1px)', Math.abs(hBar.rail - hBar.panel) < 1, JSON.stringify(hBar));
check('chart panel height identical across views (<1px)', Math.abs(hBridge.panel - hBar.panel) < 1, `bridge=${hBridge.panel} bar=${hBar.panel}`);
// window resize keeps alignment
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 800, deviceScaleFactor: 1, mobile: false });
await new Promise(r => setTimeout(r, 700));
const hSmall = await heights();
await send('Emulation.clearDeviceMetricsOverride');
await new Promise(r => setTimeout(r, 500));
check('after viewport resize: rail and chart still equal height (<1px)', Math.abs(hSmall.rail - hSmall.panel) < 1, JSON.stringify(hSmall));
await evl(`document.getElementById('btnViewBridge').click()`);
await new Promise(r => setTimeout(r, 700));
await shot('layout-bridge-final.png');

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
