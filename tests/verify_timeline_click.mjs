// verify_timeline_click.mjs — timeline tick click-to-jump (headless CDP).
//  - clicking a tick jumps to that quarter (state.qIndex = tick's data-i)
//  - generous hit area: a click offset from the label center still hits
//  - active highlight moves to the clicked tick (active shows full date)
//  - result identical to dragging the thumb to the same position (same index,
//    same title, same URL hash q=)
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-tlclick-' + Date.now() + '/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};
const click = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const snap = () => evl(`({ idx: state.qIndex == null ? DATA.companies[state.company].quarters.length - 1 : state.qIndex,
  qEnd: DATA.companies[state.company].quarters[state.qIndex == null ? DATA.companies[state.company].quarters.length - 1 : state.qIndex].end,
  title: document.getElementById('chartTitle').textContent,
  hash: location.hash,
  activeI: Number(document.querySelector('.tl-tick.active')?.dataset.i),
  activeDate: document.querySelector('.tl-tick.active .d')?.textContent })`);

// ---------- 1. click the 3rd tick ----------
const ticks0 = await evl(`[...document.querySelectorAll('.tl-tick')].map(e => ({
  i: Number(e.dataset.i), r: e.getBoundingClientRect().toJSON() }))`);
check('timeline has sampled ticks', ticks0.length >= 4, `n=${ticks0.length}`);
const target = ticks0[2];
const startX = Math.round(target.r.x + target.r.width / 2), startY = Math.round(target.r.y + target.r.height / 2);
await click(startX, startY);
await sleep(900);
let s = await snap();
check('click tick -> state.qIndex = tick index', s.idx === target.i, `idx=${s.idx} want=${target.i}`);
check('title shows clicked quarter label', await evl(`(() => {
  const e = DATA.companies[state.company].quarters[${target.i}].end, d = new Date(e + 'T00:00:00Z');
  const lbl = 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + d.getUTCFullYear();
  return document.getElementById('chartTitle').textContent.includes(lbl);
})()`), s.title);
check('hash q= synced', new URLSearchParams(s.hash.slice(1)).get('q') === s.qEnd, s.hash);
check('active highlight moved to clicked tick', s.activeI === target.i && s.activeDate === s.qEnd, JSON.stringify({ activeI: s.activeI, activeDate: s.activeDate }));
const afterClick = s;
await shot('timeline-click-jumped.png');

// ---------- 2. generous hit area: offset click (12px right, 6px up) ----------
await click(Math.round(ticks0[1].r.x + ticks0[1].r.width / 2) + 12, Math.round(ticks0[1].r.y + 6));
await sleep(900);
s = await snap();
check('offset click still hits the tick (hit area)', s.idx === ticks0[1].i, `idx=${s.idx} want=${ticks0[1].i}`);

// ---------- 3. equivalence with thumb drag to the same quarter ----------
// ticks are labels laid out with space-between (their text centers are not the
// exact quarter fractions on the track), so drag to the track position of the
// quarter the clicked tick represents
const dragX = await evl(`(() => {
  const track = document.querySelector('.tl-track'), r = track.getBoundingClientRect();
  const n = DATA.companies[state.company].quarters.length;
  return r.left + (${afterClick.idx} / (n - 1)) * r.width;
})()`);
const thumb = await evl(`document.getElementById('tlThumb').getBoundingClientRect().toJSON()`);
const tx = Math.round(dragX), ty = Math.round(thumb.y + thumb.height / 2);
const sx = Math.round(thumb.x + thumb.width / 2);
// press on the thumb where it is, drag horizontally to the target, release
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: ty, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
await sleep(900);
s = await snap();
check('drag to same x lands on same quarter as tick click', s.idx === afterClick.idx && s.qEnd === afterClick.qEnd, `drag=${s.idx}/${s.qEnd} click=${afterClick.idx}/${afterClick.qEnd}`);
check('hash identical after drag vs click', s.hash === afterClick.hash, `${s.hash} vs ${afterClick.hash}`);
check('thumb/fill position matches index', await evl(`(() => {
  const n = DATA.companies[state.company].quarters.length;
  const pct = (Number(document.getElementById('tlThumb').style.left.replace('%','')));
  const want = (state.qIndex / (n - 1)) * 100;
  return Math.abs(pct - want) < 0.5;
})()`));

// ---------- 4. whole track is clickable: arbitrary (non-tick) positions ----------
// click at fractional positions on the track (incl. between two ticks) ->
// nearest quarter wins
const trackClick = async frac => {
  const p = await evl(`(() => {
    const r = document.querySelector('.tl-track').getBoundingClientRect();
    return { x: r.left + ${frac} * r.width, y: r.y + r.height / 2 };
  })()`);
  await click(Math.round(p.x), Math.round(p.y));
  await sleep(800);
  return snap();
};
for (const frac of [0.333, 0.507, 0.72, 0.97]) {
  const s2 = await trackClick(frac);
  const want = await evl(`Math.round(${frac} * (DATA.companies[state.company].quarters.length - 1))`);
  check(`track click @${frac} -> nearest quarter`, s2.idx === want, `idx=${s2.idx} want=${want}`);
}
const mid = await trackClick(0.5);
const midIdx = await evl(`Math.round(0.5 * (DATA.companies[state.company].quarters.length - 1))`);
check('midway track click rounds to nearest quarter', mid.idx === midIdx, `idx=${mid.idx} want=${midIdx}`);
const far = await trackClick(0.02);
check('near-left track click -> early quarter', far.idx <= 2, `idx=${far.idx}`);
await shot('timeline-track-click.png');

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);
