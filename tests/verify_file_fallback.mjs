#!/usr/bin/env node
/**
 * verify_file_fallback.mjs — segments 的 file:// 兜底（与 data/profit.json.js 同一套懒加载）
 *
 * 断言：
 *   HTTP:  首屏请求里 **没有** data/segments.json.js（0 请求、0 字节），且 SEG 走 fetch 正常加载；
 *          桑基图在 http 下照常画分部节点（AAPL 截图）。
 *   file:  （--with-file 才跑）双击 index.html 时 SEG 非空、window.__SEGMENT_DATA 非空、
 *          桑基图出现 seg: 节点，且页面没有未捕获异常（失败只降级为“无分部”，不整页崩）。
 *
 * 用法：
 *   BASE=http://127.0.0.1:8851 node tests/verify_file_fallback.mjs
 *   BASE=http://127.0.0.1:8851 node tests/verify_file_fallback.mjs --with-file
 *
 * file:// 在 CI 上不一定可靠（需要本机 Chrome 允许 file 访问 + .json.js 存在），
 * 所以默认跳过，必须显式 --with-file。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const PORT = Number(process.env.PORT || 9393);   // 避开 tests 里已用的 9333-9391
const WITH_FILE = process.argv.includes('--with-file');
const NETLOG = (process.argv.find(a => a.startsWith('--netlog=')) || '').slice('--netlog='.length);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(__dirname, '.shots');
const PROFILE = path.join(__dirname, '.chrome', 'verify-file-fallback-profile');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };

/* ---------- headless chrome + CDP ---------- */
// NOTE: no --allow-file-access-from-files here — a real double-click blocks fetch() of a
// file:// sibling (CORS, origin "null"), which is exactly the branch this test must exercise.
const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-sandbox',
  '--window-size=1680,1050',
  `--user-data-dir=${PROFILE}`, 'about:blank',
]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets = null;
for (let i = 0; i < 40 && !targets; i++) {
  await sleep(300);
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch (e) { /* not up yet */ }
}
if (!targets) { console.error('FAIL chrome/CDP 未就绪'); chrome.kill(); process.exit(1); }
const t = targets.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const events = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method) events.push(m);
};
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const reqUrl = ev => ev.params?.request?.url || '';
const waitFor = async (expr, ms = 20000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evl(expr)) return true; await sleep(step); }
  return false;
};
const shot = async name => {
  const m = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(m.result.data, 'base64'));
  return path.join(SHOTS, name);
};
const navigate = async url => {
  events.length = 0;
  await send('Page.navigate', { url });
};
// SEG is a top-level `let` in app.js: a script-scoped binding, NOT a window property,
// so `window.SEG` is undefined by design — read the binding the app itself reads.
// NOTE: the whole thing is wrapped in !!(…) — returning the ECharts instance itself is not
// JSON-serialisable, so `&& chart` as the last operand makes Runtime.evaluate yield undefined.
const SEG_READY = `!!(typeof SEG !== 'undefined' && SEG && SEG.companies && Object.keys(SEG.companies).length > 0
  && typeof chart !== 'undefined' && chart)`;
const SEG_NODES = `(() => { const s = chart.getOption().series || [];
  const k = s.find(x => x.type === 'sankey'); if (!k) return 0;
  return (k.data || []).filter(n => String(n.name).startsWith('seg:')).length; })()`;

/* ---------- 1) HTTP: no segments.json.js request ---------- */
await navigate(BASE + '/index.html');
const httpReady = await waitFor(SEG_READY, 25000);
const httpReqs = events.filter(e => e.method === 'Network.requestWillBeSent').map(reqUrl);
const jsReqs = httpReqs.filter(u => /segments\.json\.js(\?|$)/.test(u));
check('http: segments.json.js 请求数 = 0', httpReqs.length > 0 && jsReqs.length === 0,
  `requests=${httpReqs.length} segments.json.js=${jsReqs.length}`);
check('http: data/segments.json 走 fetch', httpReqs.some(u => /\/data\/segments\.json(\?|$)/.test(u)));
// encoded bytes for the mirror must be 0 as well (Network.loadingFinished on the script)
const jsBytes = events.filter(e => e.method === 'Network.loadingFinished' && /segments\.json\.js(\?|$)/.test(e.params?.url || ''))
  .reduce((a, e) => a + (e.params.encodedDataLength || 0), 0);
check('http: segments.json.js 传输字节 = 0', jsBytes === 0, `${jsBytes}B`);
check('http: SEG 已加载', httpReady, `companies=${await evl(`SEG ? Object.keys(SEG.companies).length : 'null'`)}`);
check('http: window.__SEGMENT_DATA 未被注入', (await evl(`window.__SEGMENT_DATA === undefined`)) === true);

// AAPL 有分部：桑基画出 seg: 节点 + 截图
await navigate(BASE + '/index.html#c=AAPL');
await waitFor(`(typeof chart !== 'undefined' && chart && window.__sankeyMeta && window.__sankeyMeta.company === 'AAPL')`, 20000);
await sleep(800);
const httpSegNodes = await evl(SEG_NODES);
check('http: AAPL 桑基出现分部节点', httpSegNodes > 0, `segNodes=${httpSegNodes} status=${await evl(`window.__sankeyMeta && window.__sankeyMeta.segmentStatus`)}`);
const httpShot = await shot('file_fallback_http_aapl.png');
console.log('SHOT', httpShot);

/* ---------- 2) file://: SEG must be non-empty ---------- */
let fileReqs = null;
if (!WITH_FILE) {
  console.log('SKIP file:// 断言（默认跳过；加 --with-file 运行）');
} else {
  const fileUrl = pathToFileURL(path.join(ROOT, 'index.html')).href;
  await navigate(fileUrl);
  const fileReady = await waitFor(SEG_READY, 30000);
  fileReqs = events.filter(e => e.method === 'Network.requestWillBeSent').map(reqUrl);
  const payloadGlobal = await evl(`!!(window.__SEGMENT_DATA && window.__SEGMENT_DATA.companies)`);
  const segCount = await evl(`(typeof SEG !== 'undefined' && SEG && SEG.companies) ? Object.keys(SEG.companies).length : 0`);
  check('file: SEG 非空', fileReady && segCount > 0, `companies=${segCount} ready=${fileReady}`);
  check('file: window.__SEGMENT_DATA 非空', payloadGlobal === true);
  check('file: 注入了 segments.json.js', fileReqs.some(u => /segments\.json\.js(\?|$)/.test(u)));
  await sleep(800);
  const fileSegNodes = await evl(SEG_NODES);
  check('file: 桑基出现分部节点', fileSegNodes > 0, `segNodes=${fileSegNodes} status=${await evl(`window.__sankeyMeta && window.__sankeyMeta.segmentStatus`)}`);
  const exceptions = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  check('file: 无未捕获异常', exceptions === 0, `exceptions=${exceptions}`);
  const fileShot = await shot('file_fallback_file_nvda.png');
  console.log('SHOT', fileShot);
}

if (NETLOG) {
  fs.writeFileSync(NETLOG, JSON.stringify({
    base: BASE, withFile: WITH_FILE,
    http: { requestCount: httpReqs.length, segmentsJsonRequests: httpReqs.filter(u => /\/data\/segments\.json(\?|$)/.test(u)),
            segmentsJsonJsRequests: jsReqs, segmentsJsonJsBytes: jsBytes, requests: httpReqs },
    file: fileReqs,
    results,
  }, null, 2));
  console.log('NETLOG', NETLOG);
}

const fails = results.filter(r => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
chrome.kill();
process.exit(fails.length ? 1 : 0);
