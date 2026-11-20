// verify_responsive.mjs — responsive/mobile acceptance for the audit fixes.
//  - no horizontal page overflow at 390 / 768 / 1280
//  - sankey plot width (host − series left − right) is positive, and >=100px on phones
//  - every visible timeline tick, clicked with a real mouse event at 390 / 768 / 1280,
//    selects exactly its own quarter (qIndex == data-i) and that quarter is the last
//    period of the year printed on the tick
//  - at 390×844 the chart starts in the first screen, the 92-logo wall is collapsed by
//    default behind a count button, and opening it is a horizontal strip without page overflow
//  - the contrast tokens shipped in P1-C still compute to WCAG AA (>= 4.5:1) on their real
//    backgrounds, including the meta line, inactive year labels and industry counts
import fs from 'fs';
import { execFile } from 'child_process';

const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9359;
const PROFILE = new URL('./.chrome/verify-responsive-' + Date.now() + '/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.mkdirSync(PROFILE, { recursive: true });

const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1400,1000', '--user-data-dir=' + PROFILE, 'about:blank',
]);
await new Promise(r => setTimeout(r, 1500));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async ex => {
  const r = await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  return r.result?.result?.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
await send('Page.enable');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(ok ? 'PASS' : 'FAIL', name, detail == null ? '' : detail);
};
const clickAt = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};

async function open(width, height, hash = '#c=AAPL&v=bridge') {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await send('Page.navigate', { url: `${BASE}/index.html?cb=${Date.now()}${hash}` });
  await sleep(3200);
}

const overflow = () => evl(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
const plot = () => evl(`(() => {
  const host = document.getElementById('sankey');
  const opt = window.__lastOption || {};
  const s = (opt.series || [])[0] || {};
  const left = Number(s.left) || 0, right = Number(s.right) || 0;
  return { host: host.clientWidth, left, right, width: host.clientWidth - left - right, height: host.clientHeight };
})()`);

const CONTRAST_JS = `(() => {
  const rgb = s => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = el => { for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\\([^)]*,\\s*0\\)/.test(c) && c !== 'transparent') return rgb(c);
    } return [255, 255, 255]; };
  const row = el => {
    if (!el) return null;
    const fg = rgb(getComputedStyle(el).color);
    return { color: getComputedStyle(el).color, bg: bgOf(el).join(','), ratio: +ratio(fg, bgOf(el)).toFixed(2) };
  };
  return {
    token: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(),
    meta: row(document.getElementById('metaLine')),
    year: row(document.querySelector('.tl-tick:not(.active) .q')),
    count: row(document.querySelector('.indBtn:not(.active) .cnt')),
  };
})()`;

try {
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    await open(w, h);
    const tag = `${w}x${h}`;

    // 1. no horizontal overflow
    let o = await overflow();
    check(`${tag} no horizontal overflow`, o.sw <= o.cw + 1, `scrollW=${o.sw} clientW=${o.cw}`);

    // 2. plot area positive
    const p = await plot();
    check(`${tag} sankey plot width > 0`, p.width > 0, `host=${p.host} left=${p.left} right=${p.right} plot=${p.width}`);
    if (w === 390) check(`${tag} sankey plot width >= 100`, p.width >= 100, `plot=${p.width}`);
    if (w === 1280) check('1280 sankey canvas height unchanged (660)', p.height === 660, `h=${p.height}`);

    // 3. phone first screen + folded company wall
    if (w === 390) {
      const fs = await evl(`(() => {
        const r = document.getElementById('sankey').getBoundingClientRect();
        const rail = document.getElementById('logoRail');
        const tg = document.getElementById('logoToggle');
        return { top: +r.top.toFixed(1), vh: innerHeight, toggle: getComputedStyle(tg).display !== 'none',
          text: tg.textContent.replace(/\\s+/g, ' ').trim(), railShown: getComputedStyle(rail).display !== 'none',
          toggleH: tg.getBoundingClientRect().height, count: Object.keys(DATA.companies).length };
      })()`);
      check('390 sankey top <= 700 (first screen)', fs.top <= 700, `top=${fs.top}`);
      check('390 company count chip visible', fs.toggle && fs.toggleH >= 28, `h=${fs.toggleH}`);
      check('390 company chip count matches data', fs.text.startsWith(`${fs.count} 家公司`), `${fs.text} vs ${fs.count}`);
      check('390 company wall collapsed by default', !fs.railShown);

      const opened = await evl(`(() => { const b = document.getElementById('logoToggle'); b.click();
        const rail = document.getElementById('logoRail'); const r = rail.getBoundingClientRect();
        return { open: rail.classList.contains('open'), shown: getComputedStyle(rail).display !== 'none',
          expanded: b.getAttribute('aria-expanded'), h: r.height, caret: b.querySelector('.caret').textContent }; })()`);
      await sleep(250);
      check('390 company wall opens into a strip', opened.open && opened.shown && opened.expanded === 'true' && opened.h > 40 && opened.h < 200,
        `open=${opened.open} h=${opened.h} caret=${opened.caret}`);
      o = await overflow();
      check('390 expanded wall still no page overflow', o.sw <= o.cw + 1, `scrollW=${o.sw}`);
      await evl(`document.getElementById('logoToggle').click()`);
      await sleep(200);
    }

    // 4. click every visible tick with a real mouse event
    const n = await evl(`document.querySelectorAll('.tl-tick').length`);
    let pass = 0, lastPeriod = 0, bad = [];
    for (let i = 0; i < n; i++) {
      const info = await evl(`(() => {
        const el = document.querySelectorAll('.tl-tick')[${i}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { i: Number(el.dataset.i), year: el.querySelector('.q').textContent.trim(),
          x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
      })()`);
      if (!info || info.w < 1) continue;
      await sleep(60);
      await clickAt(info.x, info.y);
      await sleep(180);
      const got = await evl(`(() => {
        const qs = DATA.companies[state.company].quarters;
        const i = state.qIndex == null ? qs.length - 1 : state.qIndex;
        return { idx: i, end: qs[i].end, active: Number(document.querySelector('.tl-tick.active')?.dataset.i) };
      })()`);
      if (got.idx === info.i) pass++; else bad.push(`${info.year}@${i}->${got.idx}`);
      if (got.end.slice(0, 4) === info.year) lastPeriod++; else bad.push(`${info.year} end=${got.end}`);
    }
    check(`${tag} every visible tick selects its own year (qIndex)`, pass === n, `${pass}/${n}${bad.length ? ' bad:' + bad.slice(0, 6).join(',') : ''}`);
    check(`${tag} selected period is that year's last quarter`, lastPeriod === n, `${lastPeriod}/${n}`);

    // 5. contrast tokens on their real backgrounds
    if (w === 390) {
      const c = await evl(CONTRAST_JS);
      check('contrast token --muted is #52607a', c.token.toLowerCase() === '#52607a', c.token);
      for (const [name, row] of [['meta', c.meta], ['timeline year', c.year], ['industry count', c.count]]) {
        check(`contrast ${name} >= 4.5`, row && row.ratio >= 4.5, row ? `${row.color} on ${row.bg} = ${row.ratio}` : 'missing');
      }
    }
  }
} finally {
  const failed = results.filter(r => !r.ok);
  console.log(`\nverify_responsive: ${results.length - failed.length}/${results.length} passed`);
  ws.close(); chrome.kill();
  process.exit(failed.length ? 1 : 0);
}
