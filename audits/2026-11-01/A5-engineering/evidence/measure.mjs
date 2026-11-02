// A5 perf harness: self-contained. Spawns serve.mjs on 8449 + headless chrome CDP 9365,
// drives CDP via Node 24 global WebSocket, collects load + render + switch metrics.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';

const ROOT = process.cwd();
const PORT_HTTP = 8449;
const PORT_CDP = 9365;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = `http://127.0.0.1:${PORT_HTTP}/index.html`;

function log(...a){ console.error('[harness]', ...a); }

async function waitHttp(url, tries=100){
  for(let i=0;i<tries;i++){
    try { const r = await fetch(url); if(r.ok) return true; } catch {}
    await sleep(100);
  }
  throw new Error('timeout waiting '+url);
}

class CDP {
  constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map(); this.handlers=[]; }
  static async connect(port){
    await waitHttp(`http://127.0.0.1:${port}/json/version`);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find(t=>t.type==='page') || list[0];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev)=>{ const m=JSON.parse(ev.data); if(m.id && c.pending.has(m.id)){ const {res,rej}=c.pending.get(m.id); c.pending.delete(m.id); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); } else if(m.method){ c.handlers.forEach(h=>h(m)); } };
    return c;
  }
  send(method, params={}){ const id=++this.id; return new Promise((res,rej)=>{ this.pending.set(id,{res,rej}); this.ws.send(JSON.stringify({id,method,params})); }); }
  on(fn){ this.handlers.push(fn); }
  waitEvent(method, timeout=20000){ return new Promise((res,rej)=>{ const t=setTimeout(()=>rej(new Error('event timeout '+method)), timeout); const h=(m)=>{ if(m.method===method){ clearTimeout(t); this.handlers=this.handlers.filter(x=>x!==h); res(m.params); } }; this.handlers.push(h); }); }
  async eval(expr, awaitPromise=false){ const r = await this.send('Runtime.evaluate',{expression:expr, awaitPromise, returnByValue:true}); if(r.exceptionDetails) throw new Error('eval error: '+JSON.stringify(r.exceptionDetails)); return r.result.value; }
}

let server, chrome;
async function main(){
  log('spawning server on', PORT_HTTP);
  server = spawn(process.execPath, ['scripts/serve.mjs', String(PORT_HTTP)], {cwd:ROOT, stdio:['ignore','ignore','inherit']});
  await waitHttp(`http://127.0.0.1:${PORT_HTTP}/index.html`).catch(async e=>{ throw new Error('server not up: '+e.message); });
  log('spawning chrome');
  fs.mkdirSync('tmp-audit/a5/.chrome',{recursive:true});
  chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${PORT_CDP}`,`--user-data-dir=${ROOT}/tmp-audit/a5/.chrome`,'about:blank'], {stdio:'ignore'});
  const cdp = await CDP.connect(PORT_CDP);
  log('cdp connected');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__navStart=performance.now();'});

  const net = [];
  cdp.on(m=>{ if(m.method==='Network.responseReceived'){ const r=m.params.response; net.push({url:r.url, status:r.status, mimeType:r.mimeType, fromDiskCache:r.fromDiskCache}); } });

  const loadP = cdp.waitEvent('Page.loadEventFired', 30000);
  await cdp.send('Page.navigate',{url:URL});
  await loadP;
  log('load event fired');

  // Wait until app rendered sankey (window.__sankeyMeta populated) or timeout
  let renderAt = null;
  for(let i=0;i<300;i++){
    const ready = await cdp.eval('!!(window.__sankeyMeta && window.__sankeyMeta.nodes)');
    if(ready){ renderAt = await cdp.eval('performance.now()'); break; }
    await sleep(50);
  }
  log('sankey ready at', renderAt);

  // Navigation timing
  const nav = await cdp.eval(`(()=>{const t=performance.timing;const n=t.navigationStart;return JSON.stringify({
    navigationStart:n,
    domContentLoaded: t.domContentLoadedEventEnd-n,
    domInteractive: t.domInteractive-n,
    loadEventEnd: t.loadEventEnd-n,
    responseEnd: t.responseEnd-n,
    firstPaint: (performance.getEntriesByType('paint').find(p=>p.name==='first-paint')||{}).startTime||null,
    firstContentfulPaint: (performance.getEntriesByType('paint').find(p=>p.name==='first-contentful-paint')||{}).startTime||null
  });})()`).then(JSON.parse);

  // Resource timing
  const resources = await cdp.eval(`JSON.stringify(performance.getEntriesByType('resource').map(e=>({name:e.name.split('/').pop(), transferSize:e.transferSize, encodedBodySize:e.encodedBodySize, decodedBodySize:e.decodedBodySize, duration:Math.round(e.duration)})))`).then(JSON.parse);

  // Performance.getMetrics
  const perf = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(perf.metrics.map(m=>[m.name, m.value]));

  // JSON fetch+parse cost of the big data file
  const parseCost = await cdp.eval(`(async()=>{const t0=performance.now();const r=await fetch('data/profit.json');const txt=await r.text();const t1=performance.now();const o=JSON.parse(txt);const t2=performance.now();return JSON.stringify({fetchMs:Math.round((t1-t0)*100)/100, parseMs:Math.round((t2-t1)*100)/100, bytes:txt.length, keys:Object.keys(o).length});})()`, true).then(JSON.parse);

  // Company switch latency (sankey view) and bar view
  const switchLat = await cdp.eval(`(()=>{
    const pick=(arr)=>{arr=arr.slice().sort((a,b)=>a-b);return arr[Math.floor(arr.length/2)];};
    const tks=[]; for(const k of Object.keys(DATA.companies||{})){ tks.push(k); if(tks.length>=8) break; }
    const run=(view)=>{ if(view&&state) state.view=view; if(typeof render==='function') render(); const ds=[]; for(const tk of tks){ const t0=performance.now(); switchCompany(tk); const t1=performance.now(); ds.push(t1-t0);} return {runs:ds.map(x=>Math.round(x*100)/100), median:Math.round(pick(ds)*100)/100}; };
    const sankey=run('sankey');
    const bar=run('bar');
    if(state) state.view='sankey'; if(typeof render==='function') render();
    return JSON.stringify({tickers:tks, sankey, bar});
  })()`).then(JSON.parse);

  const heap = metrics.JSHeapUsedSize ? Math.round(metrics.JSHeapUsedSize/1048576*10)/10 : null;

  const out = { url:URL, capturedAt:new Date().toISOString(),
    timing_nav_ms:nav, sankeyReadyAtMs: renderAt!=null?Math.round(renderAt*10)/10:null,
    jsHeapUsedMB: heap,
    performance_metrics: metrics,
    resources,
    jsonFetchParse: parseCost,
    switchLatency: switchLat,
    networkRequests: net.length
  };
  fs.writeFileSync('tmp-audit/a5/perf.json', JSON.stringify(out,null,2));
  console.log(JSON.stringify(out,null,2));

  try{ await cdp.send('Browser.close'); }catch{}
}

main().catch(e=>{ console.error('FATAL', e.stack||e); }).finally(async ()=>{
  if(chrome && chrome.exitCode===null){ try{chrome.kill('SIGKILL');}catch{} }
  if(server && server.exitCode===null){ try{server.kill('SIGKILL');}catch{} }
  await sleep(300);
  process.exit(0);
});
