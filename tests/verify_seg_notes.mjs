// verify_seg_notes.mjs — 「分部口径备注」row in the meta area (headless CDP).
//  - 00941.HK shows a note containing 客群 (top-level notes[] → disclosure basis)
//  - 00992.HK shows a note containing 财年 or 抵销 (companies[ticker].notes)
//  - AAPL shows no notes row at all (no empty line)
//  - the notes row never intersects #chartTitle at 1280 / 1440 / 1920
//  - both sankey (bridge) and bar views show it; switch updates it; EN label works
import fs from 'fs';
import { execFile } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9367;
const SHOTS = new URL('./.shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHOTS_REQ = new URL('../tmp-notes/shots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SHOTS_REQ, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--window-size=1680,1050',
  '--user-data-dir=' + new URL('./.chrome/verify-profile-segnotes/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'about:blank',
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

const errors = [];
await send('Runtime.enable');
ws.onmessage = addHandler();
function addHandler() {
  const prev = ws.onmessage;
  return e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args).slice(0, 300));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, dir) => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  if (m.result?.data) fs.writeFileSync(`${dir || SHOTS}/${name}`, Buffer.from(m.result.data, 'base64'));
};
const setW = w => send('Emulation.setDeviceMetricsOverride', { width: w, height: 1050, deviceScaleFactor: 1, mobile: false });
const noteInfo = () => evl(`(()=>{const n=document.getElementById('segNotesLine'); if(!n) return null;
  return {text:n.textContent, title:n.getAttribute('title')||'', clamp:getComputedStyle(n).webkitLineClamp};})()`);
const overlap = () => evl(`(()=>{const n=document.getElementById('segNotesLine'), t=document.getElementById('chartTitle');
  if(!n||!t) return null; const a=n.getBoundingClientRect(), b=t.getBoundingClientRect();
  const ov=!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
  return {overlap:ov, noteBottom:a.bottom, titleTop:b.top};})()`);

// ---------- 1. default view is sankey; 00941.HK note with 客群 ----------
check('default view is bridge (sankey)', await evl(`state.view==='bridge'`));
await evlA(`state.company='00941.HK'; render(); true`);
await sleep(400);
const n941 = await noteInfo();
check('00941.HK: notes row exists', n941 !== null);
check('00941.HK: note contains 客群', !!n941 && n941.text.includes('客群'), n941?.text);
check('00941.HK: title carries full text (incl 客群)', !!n941 && n941.title.includes('客群'), n941?.title);
check('00941.HK: label 口径备注 shown', !!n941 && n941.text.includes('口径备注'));
check('00941.HK: clamped to 2 lines (webkit-line-clamp=2)', !!n941 && String(n941.clamp) === '2', n941?.clamp);
check('00941.HK: no overlap with #chartTitle (bridge)', (await overlap())?.overlap === false, JSON.stringify(await overlap()));

// ---------- 2. 00941.HK bar view still shows the note; required bar screenshot ----------
await evl(`document.getElementById('btnViewBar').click(); true`);
await sleep(500);
const n941bar = await noteInfo();
check('00941.HK bar view: notes row still present with 客群', !!n941bar && n941bar.text.includes('客群'), n941bar?.text);
check('00941.HK bar view: no overlap with #chartTitle', (await overlap())?.overlap === false);
await shot('00941_bar.png', SHOTS_REQ);

// ---------- 3. 00992.HK note from companies[ticker].notes (财年 / 抵销) ----------
await evl(`document.getElementById('btnViewBridge').click(); true`);
await sleep(300);
await evlA(`state.company='00992.HK'; render(); true`);
await sleep(400);
const n992 = await noteInfo();
check('00992.HK: notes row exists', n992 !== null);
check('00992.HK: note contains 财年 or 抵销', !!n992 && (n992.text.includes('财年') || n992.text.includes('抵销')), n992?.text);
check('00992.HK: no overlap with #chartTitle (bridge)', (await overlap())?.overlap === false);

// ---------- 4. AAPL has NO notes row (no empty line) ----------
await evlA(`state.company='AAPL'; render(); true`);
await sleep(400);
const nAAPL = await noteInfo();
check('AAPL: no notes row (#segNotesLine absent)', nAAPL === null);
check('AAPL: meta has no .segNote child', await evl(`document.querySelectorAll('#metaLine .segNote').length===0`));
await shot('AAPL_no_notes.png', SHOTS_REQ);

// ---------- 5. switching back re-shows 00941 note (state follows company) ----------
await evlA(`state.company='00941.HK'; render(); true`);
await sleep(300);
check('switch back to 00941.HK: note returns', (await noteInfo())?.text.includes('客群') === true);

// ---------- 6. notes row vs title do not intersect at 1280/1440/1920 ----------
for (const w of [1280, 1440, 1920]) {
  await setW(w);
  await sleep(250);
  // 00941 bridge
  const o1 = await overlap();
  check(`00941.HK @${w}: notes row ∩ #chartTitle = false`, o1?.overlap === false, JSON.stringify(o1));
  // 00992 bridge
  await evlA(`state.company='00992.HK'; render(); true`);
  await sleep(200);
  const o2 = await overlap();
  check(`00992.HK @${w}: notes row ∩ #chartTitle = false`, o2?.overlap === false, JSON.stringify(o2));
  // 00992 bar
  await evl(`document.getElementById('btnViewBar').click(); true`);
  await sleep(250);
  const o3 = await overlap();
  check(`00992.HK bar @${w}: notes row ∩ #chartTitle = false`, o3?.overlap === false, JSON.stringify(o3));
  await evl(`document.getElementById('btnViewBridge').click(); true`);
  await sleep(150);
}
await setW(1680);
await sleep(200);

// ---------- 7. required 00992 sankey screenshot ----------
await evlA(`state.company='00992.HK'; state.view='bridge'; render(); true`);
await sleep(400);
await shot('00992_sankey.png', SHOTS_REQ);

// ---------- 8. i18n: English label ----------
await evlA(`state.company='00941.HK'; render(); true`);
await sleep(200);
await evl(`document.getElementById('btnLang').click(); true`);
await sleep(500);
const en = await noteInfo();
check('EN: label switched to "Segment notes"', !!en && /Segment notes/i.test(en.text), en?.text);
check('EN: note still contains 客群 (data unchanged)', !!en && en.text.includes('客群'));
// restore zh
await evl(`document.getElementById('btnLang').click(); true`);
await sleep(300);

check('no console/exception errors during run', errors.length === 0, JSON.stringify(errors).slice(0, 300));

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log('required shots:', SHOTS_REQ);
chrome.kill();
process.exit(fails.length ? 1 : 0);
