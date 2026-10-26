// Headless verify: industry filter (states + hash sync) + logo-rail no-jitter on select.
// Asserts: same <img> element reference before/after click; rail rect unchanged.
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9340;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile2/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const t = list.find(t => t.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true })).result?.result?.value;
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};

// ---------- industry bar renders ----------
const barInfo = await evl(`(() => {
  const btns = [...document.querySelectorAll('#industryBar .indBtn')];
  return { n: btns.length, labels: btns.map(b => b.textContent), active: document.querySelector('#industryBar .indBtn.active')?.dataset.ind };
})()`);
check('industry bar renders with groups', barInfo.n >= 8, JSON.stringify(barInfo.labels));
check('default state = all active', barInfo.active === 'all');
const totalLogos = await evl(`document.querySelectorAll('#logoRail .logo').length`);
const allVisible = await evl(`[...document.querySelectorAll('#logoRail .logo')].filter(l => !l.classList.contains('hidden')).length`);
check('all logos visible initially', totalLogos === allVisible, `${allVisible}/${totalLogos}`);

// ---------- multi-select: semi + ai union ----------
await evl(`document.querySelector('#industryBar .indBtn[data-ind="semi"]').click()`);
await evl(`document.querySelector('#industryBar .indBtn[data-ind="ai"]').click()`);
await new Promise(r => setTimeout(r, 300));
const semi = await evl(`(() => ({
  visible: [...document.querySelectorAll('#logoRail .logo:not(.hidden)')].length,
  hash: location.hash,
  active: [...document.querySelectorAll('#industryBar .indBtn.active')].map(b => b.dataset.ind).sort().join(','),
  nvdaVisible: !document.querySelector('#logoRail .logo[data-sym="NVDA"]')?.classList.contains('hidden'),
  googlVisible: !document.querySelector('#logoRail .logo[data-sym="GOOGL"]')?.classList.contains('hidden'),
  tslaVisible: !document.querySelector('#logoRail .logo[data-sym="TSLA"]')?.classList.contains('hidden'),
  koHidden: document.querySelector('#logoRail .logo[data-sym="KO"]')?.classList.contains('hidden'),
}))()`);
check('semi+ai union shows members of both', semi.googlVisible && semi.tslaVisible && semi.koHidden, `visible=${semi.visible}`);
check('multi URL hash synced #ind=semi,ai', semi.hash === '#ind=semi,ai' && semi.active === 'ai,semi');

// deep-link: fresh load with multi-value hash (via about:blank so the hash change is not a same-document nav)
await send('Page.navigate', { url: 'about:blank' });
await new Promise(r => setTimeout(r, 500));
await send('Page.navigate', { url: BASE + '/index.html#ind=cons,space' });
await new Promise(r => setTimeout(r, 3000));
const deeplink = await evl(`(() => ({
  active: [...document.querySelectorAll('#industryBar .indBtn.active')].map(b => b.dataset.ind).sort().join(','),
  visible: [...document.querySelectorAll('#logoRail .logo:not(.hidden)')].length,
  koVisible: !document.querySelector('#logoRail .logo[data-sym="KO"]')?.classList.contains('hidden'),
  spcxVisible: !!document.querySelector('#logoRail .logo[data-sym="SPCX"]') && !document.querySelector('#logoRail .logo[data-sym="SPCX"]')?.classList.contains('hidden'),
  spcxPreviewBadge: !!document.querySelector('#logoRail .logo[data-sym="SPCX"] .pvBadge'),
}))()`);
check('multi-value hash deep-link applies union on load', deeplink.active === 'cons,space' && deeplink.koVisible && deeplink.spcxVisible, JSON.stringify(deeplink));
check('SPCX shown as normal company (no Preview badge)', !deeplink.spcxPreviewBadge);
await shot('filter-cons-space.png');

// ---------- SPCX spans 航天+AI: AI filter alone must show it ----------
await evl(`document.querySelector('#industryBar .indBtn[data-ind="ai"]').click()`);
await new Promise(r => setTimeout(r, 300));
const spcxAi = await evl(`!document.querySelector('#logoRail .logo[data-sym="SPCX"]')?.classList.contains('hidden')`);
check('SPCX tagged 航天+AI (AI filter shows it)', spcxAi === true, `spcxVisibleInAI=${spcxAi}`);

// ---------- reset: 全部 ----------
await evl(`document.querySelector('#industryBar .indBtn[data-ind="all"]').click()`);
await new Promise(r => setTimeout(r, 300));
const allBack = await evl(`(() => ({
  visible: [...document.querySelectorAll('#logoRail .logo:not(.hidden)')].length,
  hash: location.hash, url: location.pathname,
}))()`);
check('全部 resets filter + clears hash', allBack.visible === totalLogos && allBack.hash === '' , `visible=${allBack.visible} hash='${allBack.hash}'`);
await shot('filter-all.png');

// ---------- annual private companies (HUAWEI/LEGO): mapping + annual rendering ----------
// select HUAWEI explicitly and check FY label + bar view + telecom/hw filters
await evl(`[...document.querySelectorAll('#logoRail .logo')].find(l => l.dataset.sym === 'HUAWEI').click()`);
await new Promise(r => setTimeout(r, 1200));
const hwChk = await evl(`(() => ({
  title: document.getElementById('chartTitle').textContent,
  fyTick: !!document.querySelector('#tlTicks .tl-tick.active'),
  bridgeCheck: window.__bridgeCheck ? window.__bridgeCheck.ok : null,
  hasSegments: !!(window.__bridgeCheck && window.__bridgeCheck.inputSum > 0),
}))()`);
// bridgeCheck.ok is only meaningful for companies WITH segment inflows;
// HUAWEI has none (waterfall-only render) so ok=false there is expected, not an error
check('HUAWEI renders as annual (FY title, no error)',
  /华为|HUAWEI/i.test(hwChk.title) && hwChk.title.includes('FY') && (hwChk.bridgeCheck !== false || !hwChk.hasSegments), JSON.stringify(hwChk));
await evl(`document.getElementById('btnViewBar').click()`);
await new Promise(r => setTimeout(r, 800));
const hwBar = await evl(`({ meta: !!window.__barMeta, q: window.__barMeta && window.__barMeta.quarterCount, hasData: window.__barMeta && window.__barMeta.data.some(v => v != null) })`);
check('HUAWEI bar view works (annual series has data)', hwBar.meta && hwBar.q > 0 && hwBar.hasData, JSON.stringify(hwBar));
await evl(`document.getElementById('btnViewBridge').click()`);
await new Promise(r => setTimeout(r, 500));
const teleFilter = await evl(`(() => {
  document.querySelector('#industryBar .indBtn[data-ind="tele"]').click();
  return !document.querySelector('#logoRail .logo[data-sym="HUAWEI"]')?.classList.contains('hidden');
})()`);
check('HUAWEI in 通信 filter', teleFilter === true);
const legoCons = await evl(`(() => {
  document.querySelector('#industryBar .indBtn[data-ind="all"]').click();
  document.querySelector('#industryBar .indBtn[data-ind="cons"]').click();
  return !document.querySelector('#logoRail .logo[data-sym="LEGO"]')?.classList.contains('hidden');
})()`);
check('LEGO in 消费 filter', legoCons === true);
await evl(`document.querySelector('#industryBar .indBtn[data-ind="all"]').click()`);

// ---------- jitter: click company switch, DOM node identity + layout stability ----------
const railDom = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#logoRail img')];
  window.__imgRefs = new Set(imgs);
  window.__railRect = document.getElementById('logoRail').getBoundingClientRect().toJSON();
  window.__imgRects = imgs.map(i => i.getBoundingClientRect().toJSON());
  return imgs.length;
})()`);
await evl(`document.querySelector('#logoRail .logo[data-sym="AAPL"]').click()`);
await new Promise(r => setTimeout(r, 1200)); // allow any re-fetch/re-render to happen
const jitter = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#logoRail img')];
  const sameRefs = imgs.length === window.__imgRefs.size && imgs.every(i => window.__imgRefs.has(i));
  const railRect = document.getElementById('logoRail').getBoundingClientRect().toJSON();
  const rectEq = (a, b) => ['x','y','width','height','top','left'].every(k => Math.abs(a[k]-b[k]) < 0.5);
  const railStable = rectEq(railRect, window.__railRect);
  const imgStable = imgs.length === window.__imgRects.length && imgs.every((i, k) => rectEq(i.getBoundingClientRect().toJSON(), window.__imgRects[k]));
  return { sameRefs, railStable, imgStable,
    aaplActive: document.querySelector('#logoRail .logo[data-sym="AAPL"]')?.classList.contains('active'),
    chartTitle: document.getElementById('chartTitle').textContent };
})()`);
check('same img elements after company switch (no rebuild)', jitter.sameRefs);
check('rail rect unchanged (no layout shift)', jitter.railStable && jitter.imgStable);
check('active class moved to AAPL, chart switched', jitter.aaplActive && jitter.chartTitle.includes('苹果'), jitter.chartTitle);
await shot('after-switch-aapl.png');

// second switch for good measure (the reported scenario: repeated clicking)
await evl(`(() => { const r = document.getElementById('logoRail').getBoundingClientRect(); window.__railW2 = r.width; window.__railH2 = r.height; window.__imgs2 = new Set([...document.querySelectorAll('#logoRail img')]); })()`);
await evl(`document.querySelector('#logoRail .logo[data-sym="MSFT"]').click()`);
await new Promise(r => setTimeout(r, 1200));
const jitter2 = await evl(`(() => {
  const imgs = [...document.querySelectorAll('#logoRail img')];
  const r2 = document.getElementById('logoRail').getBoundingClientRect();
  return { same: imgs.length === window.__imgs2.size && imgs.every(i => window.__imgs2.has(i)),
    stable: Math.abs(window.__railW2 - r2.width) < 0.5 && Math.abs(window.__railH2 - r2.height) < 0.5 };
})()`);
check('second switch: same nodes, stable rail', jitter2.same && jitter2.stable);

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
