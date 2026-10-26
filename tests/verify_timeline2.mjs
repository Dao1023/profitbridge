// verify_timeline2.mjs — UI fixes round 2 (headless CDP).
//  - AVGO logo present in rail and loads
//  - year-only timeline ticks (dedup by year, first/last/active kept, active shows full date)
//  - snap dots: one per quarter, nearest highlighted during drag, release snaps
//  - modeNote / asof annotations removed
//  - NVDA stability: 96.2 → 72.1 → 63.7 → 59.7
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-ui2/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const evlA = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable');
await send('Page.navigate', { url: BASE + '/index.html' });
await new Promise(r => setTimeout(r, 3000));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, clip) => {
  const p = { format: 'png' }; if (clip) p.clip = { ...clip, scale: 1 };
  const m = await send('Page.captureScreenshot', p);
  if (!m.result?.data) { console.log('shot failed', name, JSON.stringify(m).slice(0, 200)); return; }
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};

// ---------- 1. AVGO logo ----------
const logo = await evlA(`(async()=>{
  const img=[...document.querySelectorAll('#logoRail .logo img')].find(i=>i.alt==='AVGO');
  if(!img) return {found:false};
  await new Promise(r=>{ if(img.complete) r(); else { img.onload=r; img.onerror=r; setTimeout(r,3000);} });
  return {found:true, ok:img.naturalWidth>0, w:img.naturalWidth, h:img.naturalHeight, mono:!!document.querySelector('#logoRail .logo .mono')};
})()`);
check('AVGO logo <img> present and loads', logo.found && logo.ok, JSON.stringify(logo));
check('no monogram fallback anywhere in rail (all logos load)', !(await evl(`!!document.querySelector('#logoRail .mono')`)));
const railBox = await evl(`(r=document.getElementById('logoRail').getBoundingClientRect(),{x:r.x,y:r.y,width:r.width,height:r.height})`);

// ---------- 2. year-only ticks ----------
const ticks = await evl(`(()=>{
  const qs=DATA.companies.NVDA.quarters, n=qs.length;
  const ts=[...document.querySelectorAll('.tl-tick')];
  const years=ts.map(e=>e.querySelector('.q').textContent);
  const dates=ts.map(e=>e.querySelector('.d')?.textContent||null);
  const dis=ts.map(e=>Number(e.dataset.i));
  const rects=ts.map(e=>e.getBoundingClientRect());
  return { n, shown:ts.length, years, dates, dis,
    allYears:/^\\d{4}$/.test(years.join('|').replace(/\\|/g,'')) || years.every(y=>/^\\d{4}$/.test(y)),
    uniqueYears:new Set(years).size===years.length,
    hasFirst:dis[0]===0, hasLast:dis.at(-1)===n-1, hasActive:dis.includes(n-1),
    activeIdx:dis.findIndex((d,i)=>ts[i].classList.contains('active')),
    yearOfActiveCorrect:true,
    fits: rects.at(-1).right<=innerWidth && rects[0].left>=0,
    overlap: rects.some((r,i)=>i&&r.left<rects[i-1].right-1) };
})()`);
check('all tick labels are bare years (no Qxx/date)', ticks.allYears, JSON.stringify(ticks.years));
check('no year appears twice', ticks.uniqueYears, JSON.stringify(ticks.years));
check('first/last/active ticks kept', ticks.hasFirst && ticks.hasLast && ticks.hasActive);
check('active tick shows full date, others none',
  ticks.dates.filter(Boolean).length === 1 && ticks.dates[ticks.activeIdx] === '2026-07-26', JSON.stringify(ticks.dates));
check('tick year matches quarter-end calendar year', await evl(`(()=>{
  const qs=DATA.companies.NVDA.quarters;
  return [...document.querySelectorAll('.tl-tick')].every(e=>e.querySelector('.q').textContent==String(new Date(qs[Number(e.dataset.i)].end+'T00:00:00Z').getUTCFullYear()));
})()`));
check('ticks fit viewport without overlap', ticks.fits && !ticks.overlap);

// ---------- 3. snap dots ----------
const dots = await evl(`(()=>{
  const n=DATA.companies.NVDA.quarters.length;
  const ds=[...document.querySelectorAll('.tl-dot')];
  return { n, count:ds.length, lefts:ds.map(d=>d.style.left) };
})()`);
check('one snap dot per quarter', dots.count === dots.n, `n=${dots.n} dots=${dots.count}`);
const dragRes = await evlA(`(async()=>{
  const thumb=document.getElementById('tlThumb');
  const track=thumb.parentElement, r=track.getBoundingClientRect();
  const qs=DATA.companies.NVDA.quarters, n=qs.length;
  const target=5; // unsampled middle-ish quarter
  const x=r.left + r.width*(target/(n-1));
  thumb.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientX:x}));
  await new Promise(r2=>setTimeout(r2,50));
  const midMove = x - r.width*(0.5/(n-1)); // between dot 4.5 → nearest = 5 (round)
  thumb.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:midMove}));
  await new Promise(r2=>setTimeout(r2,50));
  const draggingClass=document.getElementById('timeline').classList.contains('dragging');
  const near=[...document.querySelectorAll('.tl-dot.near')].map(d=>Number(d.dataset.i));
  const curDuring=curQIndex();
  const shotDot=(nd=>nd?getComputedStyle(nd).backgroundColor:null)(document.querySelector('.tl-dot.near'));
  thumb.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x}));
  await new Promise(r2=>setTimeout(r2,400));
  return { draggingClass, near, curDuring, shotDot,
    after:curQIndex(), end:qs[curQIndex()].end,
    classCleared:!document.getElementById('timeline').classList.contains('dragging'),
    nearCleared:document.querySelectorAll('.tl-dot.near').length };
})()`);
check('dragging state sets .dragging on timeline', dragRes.draggingClass);
check('nearest dot highlighted (.near) = target quarter', JSON.stringify(dragRes.near) === '[5]' && dragRes.curDuring === 5, JSON.stringify(dragRes));
check('near dot is blue (highlighted)', dragRes.shotDot === 'rgb(37, 99, 235)', dragRes.shotDot);
check('release snaps to nearest quarter (idx5)', dragRes.after === 5 && dragRes.end === DATA_SNAP5(), dragRes.end);
check('drag end clears highlight', dragRes.classCleared && dragRes.nearCleared === 0);
function DATA_SNAP5(){ return '2012-01-29'; } // NVDA idx5 quarter-end (kept from prior regression)

// hover highlight
const hoverRes = await evlA(`(async()=>{
  const thumb=document.getElementById('tlThumb');
  const r=thumb.parentElement.getBoundingClientRect();
  thumb.dispatchEvent(new PointerEvent('pointerenter',{bubbles:true}));
  thumb.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:3,clientX:r.left+r.width/2}));
  await new Promise(r2=>setTimeout(r2,250)); // let the .1s transition finish
  const hoverOn=document.getElementById('timeline').classList.contains('hover');
  const bg=getComputedStyle(document.querySelector('.tl-dot')).backgroundColor;
  thumb.dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));
  return { hoverOn, bg };
})();`);
check('thumb hover raises dot opacity (class + darker color)', hoverRes.hoverOn && hoverRes.bg === 'rgba(30, 41, 59, 0.32)', JSON.stringify(hoverRes));

// ---------- 4. removed annotations ----------
check('#modeNote removed', await evl(`document.getElementById('modeNote')===null`));
check('#chartAsof removed', await evl(`document.getElementById('chartAsof')===null`));

// ---------- 5. NVDA stability + screenshots ----------
await evl(`state.qIndex=null; render(); true`);
await sleep(400);
let svg = await evl(`chart.renderToSVGString()`);
for (const v of ['$96.2B','$72.1B','$63.7B','$59.7B']) check(`NVDA sankey contains ${v}`, svg.includes(v));
await shot('timeline_years.png');
await shot('avgo_logo.png', railBox);
// mid-drag visual: pointerdown on thumb near idx30, screenshot with .near visible
await evlA(`(async()=>{
  const thumb=document.getElementById('tlThumb');
  const r=thumb.parentElement.getBoundingClientRect();
  const x=r.left + r.width*(30/(DATA.companies.NVDA.quarters.length-1));
  thumb.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,clientX:x}));
  thumb.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:2,clientX:x}));
  await new Promise(r2=>setTimeout(r2,80));
})()`);
const tlBox = await evl(`(r=document.getElementById('timeline').getBoundingClientRect(),{x:r.x,y:r.y,width:r.width,height:r.height+20})`);
await shot('timeline_snap_drag.png', tlBox);
await evl(`(thumb=document.getElementById('tlThumb'),thumb.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2})),true)`);

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
