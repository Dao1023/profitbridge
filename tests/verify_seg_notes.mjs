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

// ---------- 0. data-level: batch "N 季无分部披露" notes are recomputed, not hand-typed ----------
// These rows are intentionally filtered out of the meta row by isUsefulSegNote, so
// they are asserted against data/profit.json ∖ data/segments.json here instead.
const DATA_DIR = new URL('../data/', import.meta.url);
const segData = JSON.parse(fs.readFileSync(new URL('segments.json', DATA_DIR), 'utf8'));
const profitData = JSON.parse(fs.readFileSync(new URL('profit.json', DATA_DIR), 'utf8'));
const mirrorData = JSON.parse(fs.readFileSync(new URL('segments.json.js', DATA_DIR), 'utf8')
  .replace(/^window\.__SEGMENT_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
check('segments.json.js mirror deep-equals segments.json', JSON.stringify(mirrorData) === JSON.stringify(segData));
for (const tk of ['MSFT', 'NVDA']) {
  const pends = profitData.companies[tk].quarters.map(q => q.end);
  const sends = new Set(Object.keys(segData.companies[tk].quarters));
  const miss = pends.filter(e => !sends.has(e)).sort();
  const note = segData.notes.find(n => n.startsWith(tk + ':') && n.includes('无分部披露'));
  const m = note && note.match(/^([A-Za-z0-9.\-]+):\s*(\d+)\s*季无分部披露（源上无分部表，非抓取失败）\s*[:：]\s*(.*)$/);
  check(`${tk}: batch-note count == profit∖segments (${miss.length})`, !!m && Number(m[2]) === miss.length, note?.slice(0, 80));
  const dates = m ? m[3].split(',').map(x => x.trim()) : [];
  check(`${tk}: batch-note dates == computed list (ascending)`, JSON.stringify(dates) === JSON.stringify(miss),
    `${dates.length} note / ${miss.length} computed`);
}

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

// ---------- 9. MSFT 2026-09-30: 3→2 报告分部口径变更备注 ----------
// notes[] 里「MSFT: 2026-09-30 起披露口径变更…」是唯一对 MSFT 生效的备注
// （warning/「N 季无分部披露」两类会被 isUsefulSegNote 过滤，故此处是单条）。
const noteFit = () => evl(`(()=>{const n=document.getElementById('segNotesLine'); if(!n) return null;
  return {clip: n.scrollHeight <= n.clientHeight + 1, h: n.clientHeight, sh: n.scrollHeight};})()`);
const pickQuarter = (tk, end) => evl(`(()=>{const i=DATA.companies['${tk}'].quarters.findIndex(q=>q.end==='${end}');
  if(i<0) return false; state.company='${tk}'; state.qIndex=i; state.view='bridge'; render(); return true;})()`);
await setW(1680);
await sleep(200);
check('MSFT 2026-09-30: quarter selectable', await pickQuarter('MSFT', '2026-09-30') === true);
await sleep(400);
const nMSFT = await noteInfo();
check('MSFT 2026-09-30: notes row exists', nMSFT !== null);
check('MSFT 2026-09-30: note says 3→2 分部', !!nMSFT && nMSFT.text.includes('3 个调整为 2 个'), nMSFT?.text);
check('MSFT 2026-09-30: note names Agents and Infra 76,795',
  !!nMSFT && nMSFT.text.includes('Agents and Infra 76,795'), nMSFT?.text);
check('MSFT 2026-09-30: note names Devices and Consumer 15,484',
  !!nMSFT && nMSFT.text.includes('Devices and Consumer 15,484'), nMSFT?.text);
check('MSFT 2026-09-30: note says 跨期不可直接比较', !!nMSFT && nMSFT.text.includes('不可直接比较'));
check('MSFT 2026-09-30: note not clipped at 1680', (await noteFit())?.clip === true, JSON.stringify(await noteFit()));
check('MSFT 2026-09-30: no overlap with #chartTitle', (await overlap())?.overlap === false, JSON.stringify(await overlap()));
await shot('MSFT_notes_2026-09-30_1680.png', SHOTS_REQ);
await setW(1280);
await sleep(350);
check('MSFT 2026-09-30 @1280: note still full (not clipped)', (await noteFit())?.clip === true, JSON.stringify(await noteFit()));
check('MSFT 2026-09-30 @1280: no overlap with #chartTitle', (await overlap())?.overlap === false);
await shot('MSFT_notes_2026-09-30_1280.png', SHOTS_REQ);

// ---------- 10. NVDA 2026-04-26: 备注分部名与数据标签一致 ----------
check('NVDA 2026-04-26: quarter selectable', await pickQuarter('NVDA', '2026-04-26') === true);
await sleep(400);
const nNVDA = await noteInfo();
check('NVDA 2026-04-26: notes row exists', nNVDA !== null);
check('NVDA 2026-04-26: note names Data Center 75,246', !!nNVDA && nNVDA.text.includes('Data Center 75,246'), nNVDA?.text);
check('NVDA 2026-04-26: note names Edge Computing 6,369', !!nNVDA && nNVDA.text.includes('Edge Computing 6,369'));
check('NVDA 2026-04-26: note lists historical 5 platform labels',
  !!nNVDA && nNVDA.text.includes('Gaming') && nNVDA.text.includes('Professional Visualization') &&
  nNVDA.text.includes('Automotive') && nNVDA.text.includes('OEM & Other'));
check('NVDA 2026-04-26: 旧文案 Compute & Networking 已消失', !!nNVDA && !nNVDA.text.includes('Compute & Networking'));
check('NVDA 2026-04-26: 旧文案 Graphics 已消失', !!nNVDA && !/\bGraphics\b/.test(nNVDA.text));
check('NVDA 2026-04-26 @1280: note not clipped', (await noteFit())?.clip === true, JSON.stringify(await noteFit()));
check('NVDA 2026-04-26 @1280: no overlap with #chartTitle', (await overlap())?.overlap === false);
await shot('NVDA_notes_2026-04-26_1280.png', SHOTS_REQ);
await setW(1680);
await sleep(300);
await shot('NVDA_notes_2026-04-26_1680.png', SHOTS_REQ);

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log('required shots:', SHOTS_REQ);
chrome.kill();
process.exit(fails.length ? 1 : 0);
