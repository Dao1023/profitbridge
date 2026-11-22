// verify_metrics.mjs — 指标明细数据层 + 第三视图（headless CDP + 逐位对源）
//   ① 结构：schema/字段/年份/nulls/sources/无比率落库
//   ② data/metrics.json ↔ data/metrics.json.js deepEqual
//   ③ 逐字段对源：JSON 里每个数字都能用 sources 里的原始值 × 换算规则复现，
//      且该原始值仍能在上游 API 响应里原样找到（SEC companyfacts / 东财 F10 / Naver）
//   ④ 比率现算抽查：页面渲染值 == 原始数现算值（毛利率/ROE/分红率）
//   ⑤ 无 metrics 的公司：空态 + 无 console 报错；fetch 失败时 .json.js 兜底仍能渲染
// 用法：node tests/verify_metrics.mjs        （BASE 可覆盖服务地址，NO_LIVE=1 跳过联网复取）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const LIVE = process.env.NO_LIVE !== '1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const SHOTS = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(SHOTS, { recursive: true });

const GROUPS = {
  income: ['revenue', 'cogs', 'gross', 'opInc', 'rd', 'sga', 'pbt', 'tax', 'netInc'],
  balance: ['cash', 'receivables', 'inventory', 'currentAssets', 'ppe', 'totalAssets',
    'debtShort', 'debtLong', 'liabilities', 'equityParent', 'equity'],
  cashflow: ['ocf', 'capex', 'icf', 'dividendsPaid', 'buyback'],
  perShare: ['eps', 'dps'],
};
const ALL = Object.values(GROUPS).flat();
const RATIO_KEYS = ['grossMargin', 'opMargin', 'netMargin', 'roe', 'roa', 'debtRatio', 'payout', 'fcf'];
const MAIN = ['MSFT', 'KO', '600887.SS', '00700.HK', '005930.KS'];

let pass = 0; const fails = [];
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else fails.push(name + (detail == null ? '' : ' :: ' + detail));
};
const r2 = (v) => Math.round(v * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ ① 结构 ---- */
const MET = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'metrics.json'), 'utf8'));
ok('schema=metrics-v1', MET.schema === 'metrics-v1', MET.schema);
ok('updated 是 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(MET.updated || ''), MET.updated);
for (const tk of MAIN) ok(`${tk} 存在`, !!(MET.companies || {})[tk]);

for (const [tk, c] of Object.entries(MET.companies || {})) {
  ok(`${tk} asReported:true`, c.asReported === true);
  ok(`${tk} frequency=annual`, c.frequency === 'annual');
  ok(`${tk} 币种`, /^(USD|CNY|KRW)-M$/.test(c.currency || ''), c.currency);
  ok(`${tk} years 非空`, Array.isArray(c.years) && c.years.length >= 3, c.years && c.years.length);
  ok(`${tk} years 按期末升序`, c.years.every((y, i) => i === 0 || c.years[i - 1].end < y.end));
  for (const y of c.years) {
    const tag = `${tk} ${y.end}`;
    ok(`${tag} periodType=FY`, y.periodType === 'FY');
    ok(`${tag} fiscalYear 与期末一致`, y.fiscalYear === Number(y.end.slice(0, 4)), String(y.fiscalYear));
    ok(`${tag} sources 非空`, Array.isArray(y.sources) && y.sources.length >= 2, y.sources && y.sources.length);
    for (const g of Object.keys(GROUPS)) {
      ok(`${tag} ${g} 是对象`, y[g] && typeof y[g] === 'object' && !Array.isArray(y[g]));
      for (const f of GROUPS[g]) {
        const v = (y[g] || {})[f];
        ok(`${tag} ${g}.${f} 存在（可 null）`, f in (y[g] || {}), 'missing key');
        ok(`${tag} ${g}.${f} 最多两位小数`, v == null || r2(v) === v, String(v));
        ok(`${tag} ${g}.${f} 不是字符串`, v == null || typeof v === 'number', typeof v);
      }
      for (const rk of RATIO_KEYS) ok(`${tag} ${g} 不含派生比率 ${rk}`, !(rk in (y[g] || {})));
    }
    const computed = ALL.filter((f) => (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) == null);
    ok(`${tag} nulls 与显式 null 完全一致`,
      JSON.stringify([...y.nulls].sort()) === JSON.stringify([...computed].sort()),
      `json=${JSON.stringify(y.nulls)} computed=${JSON.stringify(computed)}`);
    ok(`${tag} 每个 null 都在 sources 里解释过`,
      computed.every((f) => y.sources.some((s) => s.includes(f))), computed.join(','));
  }
  // fields 组：只列真实取到的字段
  for (const g of Object.keys(GROUPS)) {
    const got = GROUPS[g].filter((f) => c.years.some((y) => (y[g] || {})[f] != null));
    const listed = (c.fields || {})[g] || [];
    ok(`${tk} fields.${g} == 实际有值字段`, JSON.stringify([...listed].sort()) === JSON.stringify([...got].sort()),
      `listed=${JSON.stringify(listed)} got=${JSON.stringify(got)}`);
  }
}
// key 必须与 data/profit.json 的 ticker 完全一致，否则 switchCompany 后取不到数据
{
  const PROFIT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'profit.json'), 'utf8'));
  const tickers = Object.keys(PROFIT.companies || {});
  ok('profit.json 有 93 家（回归锚点）', tickers.length >= 90, String(tickers.length));
  for (const tk of Object.keys(MET.companies)) ok(`metrics key ${tk} 与 profit.json 一致`, tickers.includes(tk), 'not in profit.json');
  for (const tk of MAIN) ok(`metrics 覆盖 ${tk}`, Object.keys(MET.companies).includes(tk));
  ok('metrics 无多余 key', Object.keys(MET.companies).length === MAIN.length, Object.keys(MET.companies).join(','));
}

/* ------------------------------------------------------- ② 镜像一致 ---- */
{
  const src = fs.readFileSync(path.join(ROOT, 'data', 'metrics.json.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  const mir = sandbox.window.METRICS_DATA;
  ok('metrics.json.js 挂了 window.METRICS_DATA', !!mir);
  ok('metrics.json ↔ metrics.json.js deepEqual',
    JSON.stringify(mir) === JSON.stringify(MET),
    mir ? 'keys=' + Object.keys(mir.companies || {}).length : 'missing');
}

/* --------------------------------------------------------- ③ 逐位对源 ---- */
const EM = {
  Referer: 'https://emweb.securities.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) profitbridge-verify/1.0',
};
const SEC = { 'User-Agent': 'profitbridge-verify dao1023@example.com' };
function emUrl(reportName, filter, size = 5000) {
  const q = new URLSearchParams({
    reportName, columns: 'ALL', filter, pageNumber: '1', pageSize: String(size),
    sortColumns: 'REPORT_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB',
  });
  return `https://datacenter-web.eastmoney.com/api/data/v1/get?${q}`;
}
async function getJSON(url, headers) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
// one source segment → { field, name?, parts?, raw }
// the last segment of every line carries a trailing 全角 parenthetical （÷1e6 → CNY-M）
const stripSuffix = (seg) => seg.replace(/（[^）]*）\s*$/, '').trim();
// fields whose JSON value is an aggregate of several source lines (checked separately)
const SKIP_JSON = new Set(['sga', 'debtShort', 'debtLong']);
function parseSeg(seg) {
  const m = seg.match(/^([A-Za-z][A-Za-z0-9]*): (.+) (-?[\d.]+)$/);
  if (!m) return null;
  const field = m[1]; let mid = m[2].trim(); const raw = Number(m[3]);
  if (!Number.isFinite(raw)) return null;
  if (mid.includes(' + ') || mid.endsWith(' =')) {
    mid = mid.replace(/\s*=$/, '');
    const parts = mid.split(' + ').map((p) => {
      const mm = p.match(/^(.+) (-?[\d.]+)$/);
      return mm ? { name: mm[1], val: Number(mm[2]) } : null;
    });
    if (parts.some((p) => !p)) return null;
    return { field, parts, raw };
  }
  return { field, name: mid, raw };
}

if (!LIVE) console.log('（NO_LIVE=1：跳过联网复取）');

async function verifyUS(tk, cik) {
  const facts = (await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC)).facts['us-gaap'];
  const has = (tag, end, val) => {
    const u = facts[tag] && facts[tag].units;
    const units = (u && (u.USD || u['USD/shares'])) || [];
    return units.some((e) => e.end === end && Number(e.val) === val);
  };
  const hk = MET.companies[tk];
  for (const y of hk.years) {
    const covered = new Set();
    for (const stmt of ['income', 'balance', 'cashflow', 'perShare']) {
      const line = y.sources.find((s) => s.includes(
        stmt === 'income' ? '合并利润表' : stmt === 'balance' ? '合并资产负债表'
          : stmt === 'cashflow' ? '合并现金流量表' : '每股数据'));
      if (!line) { ok(`${tk} ${y.end} 有 ${stmt} 出处行`, false); continue; }
      const segs = line.split(' · ').pop().split(' | ').map(stripSuffix);
      for (const seg of segs) {
        const p = parseSeg(seg);
        if (!p) continue;
        covered.add(p.field);
        const val = (y[stmt] || {})[p.field];
        const isPerShare = !!GROUPS.perShare.includes(p.field);
        const exp = isPerShare ? p.raw : r2(p.raw / 1e6);
        ok(`${tk} ${y.end} ${p.field} == 出处原始值换算`,
          val != null && Math.abs(val - exp) < 0.005, `json=${val} src=${p.raw}`);
        if (p.parts) {
          ok(`${tk} ${y.end} ${p.field} 合计数 == 各分项之和`,
            Math.abs(p.raw - p.parts.reduce((a, x) => a + x.val, 0)) < 1e-6, JSON.stringify(p.parts));
          for (const part of p.parts) ok(`${tk} ${y.end} ${p.field} 分项 ${part.name} 在源码里`, has(part.name, y.end, part.val));
        } else {
          ok(`${tk} ${y.end} ${p.field} 原始值可在 companyfacts 复现`, has(p.name, y.end, p.raw), `${p.name}@${y.end}`);
        }
      }
    }
    const missing = ALL.filter((f) => (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) != null && !covered.has(f));
    ok(`${tk} ${y.end} 每个非空字段都有出处`, missing.length === 0, missing.join(','));
  }
}

async function verifyA() {
  const tk = '600887.SS';
  const c = MET.companies[tk];
  const inc = (await getJSON(emUrl('RPT_F10_FINANCE_GINCOME', '(SECUCODE="600887.SH")'), EM)).result.data;
  const bal = (await getJSON(emUrl('RPT_F10_FINANCE_GBALANCE', '(SECUCODE="600887.SH")'), EM)).result.data;
  const cf = (await getJSON(emUrl('RPT_F10_FINANCE_GCASHFLOW', '(SECUCODE="600887.SH")'), EM)).result.data;
  const row = (rows, end) => rows.filter((r) => r.REPORT_TYPE === '年报' && String(r.REPORT_DATE).startsWith(end))
    .sort((a, b) => String(b.UPDATE_DATE).localeCompare(String(a.UPDATE_DATE)))[0] || null;
  for (const y of c.years) {
    const r = { income: row(inc, y.end), balance: row(bal, y.end), cashflow: row(cf, y.end) };
    ok(`${tk} ${y.end} 利润表行存在`, !!r.income);
    const covered = new Set(); const rawByField = {};
    for (const stmt of ['income', 'balance', 'cashflow', 'perShare']) {
      const line = y.sources.find((s) => s.includes('RPT_F10_FINANCE_'
        + (stmt === 'income' || stmt === 'perShare' ? 'GINCOME' : stmt === 'balance' ? 'GBALANCE' : 'GCASHFLOW'))
        && (stmt === 'perShare' ? s.includes('每股数据') : !s.includes('每股数据')));
      if (!line) { ok(`${tk} ${y.end} 有 ${stmt} 出处行`, false); continue; }
      // perShare line: "…每股数据（元/股，不换算）：eps: DILUTED_EPS 1.83"
      const body = stmt === 'perShare' ? line.split('：').pop() : line.split(' · ').pop();
      for (const seg of body.split(' | ').map(stripSuffix)) {
        const p = parseSeg(seg);
        if (!p) continue;
        covered.add(p.field);
        const srcRow = stmt === 'perShare' ? r.income : r[stmt];
        rawByField[p.field] = (stmt === 'perShare') ? p.raw : (srcRow ? srcRow[p.name] : null);
        ok(`${tk} ${y.end} ${p.field} 原始列命中`,
          srcRow != null && Number(srcRow[p.name]) === p.raw, `${p.name} live=${srcRow && srcRow[p.name]} src=${p.raw}`);
        // helper columns (sale/admin/bond/…) only feed the aggregates checked below
        if (!ALL.includes(p.field) || SKIP_JSON.has(p.field)) continue;
        const val = (y[stmt] || {})[p.field];
        const exp = stmt === 'perShare' ? p.raw : r2(p.raw / 1e6);
        ok(`${tk} ${y.end} ${p.field} == 原始值÷1e6`, val != null && Math.abs(val - exp) < 0.005, `json=${val} src=${p.raw}`);
      }
    }
    const sga = r2((rawByField.sale + rawByField.admin) / 1e6);
    ok(`${tk} ${y.end} sga = 销售费用+管理费用`, Math.abs((y.income.sga ?? NaN) - sga) < 0.005, `${y.income.sga} vs ${sga}`);
    const ds = r2((rawByField.debtShort + rawByField.debtShort1y) / 1e6);
    ok(`${tk} ${y.end} debtShort = 短期借款+一年内到期`, Math.abs((y.balance.debtShort ?? NaN) - ds) < 0.005, `${y.balance.debtShort} vs ${ds}`);
    const dl = r2((rawByField.debtLong + (rawByField.bond || 0)) / 1e6);
    ok(`${tk} ${y.end} debtLong = 长期借款+应付债券`, Math.abs((y.balance.debtLong ?? NaN) - dl) < 0.005, `${y.balance.debtLong} vs ${dl}`);
    covered.add('sga').add('debtShort').add('debtLong');
    if (y.perShare.dps != null) covered.add('dps');
    const missing = ALL.filter((f) => (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) != null && !covered.has(f));
    ok(`${tk} ${y.end} 每个非空字段都有出处`, missing.length === 0, missing.join(','));
    ok(`${tk} ${y.end} dps 出现在分红出处里`,
      y.perShare.dps == null || y.sources.some((s) => s.includes('每股') && s.includes(String(y.perShare.dps))));
  }
}

async function verifyHK() {
  const tk = '00700.HK';
  const c = MET.companies[tk];
  const inc = (await getJSON(emUrl('RPT_HKF10_FN_INCOME_PC', '(SECUCODE="00700.HK")'), EM)).result.data;
  const bal = (await getJSON(emUrl('RPT_HKF10_FN_BALANCE_PC', '(SECUCODE="00700.HK")'), EM)).result.data;
  const cf = (await getJSON(emUrl('RPT_HKF10_FN_CASHFLOW_PC', '(SECUCODE="00700.HK")'), EM)).result.data;
  const lookup = (rows, end, name) => {
    const hit = rows.find((r) => r.DATE_TYPE_CODE === '001' && String(r.REPORT_DATE).startsWith(end) && r.STD_ITEM_NAME === name);
    return hit ? Number(hit.AMOUNT) : null;
  };
  for (const y of c.years) {
    const covered = new Set(); const rawByField = {};
    for (const stmt of ['income', 'balance', 'cashflow']) {
      const report = stmt === 'income' ? 'RPT_HKF10_FN_INCOME_PC' : stmt === 'balance' ? 'RPT_HKF10_FN_BALANCE_PC' : 'RPT_HKF10_FN_CASHFLOW_PC';
      const rows = stmt === 'income' ? inc : stmt === 'balance' ? bal : cf;
      const line = y.sources.find((s) => s.includes(report) && !s.includes('每股数据'));
      if (!line) { ok(`${tk} ${y.end} 有 ${stmt} 出处行`, false); continue; }
      for (const seg of line.split(' · ').pop().split(' | ').map(stripSuffix)) {
        const p = parseSeg(seg);
        if (!p) continue;
        covered.add(p.field);
        rawByField[p.field] = lookup(rows, y.end, p.name);
        ok(`${tk} ${y.end} ${p.field} 原始科目「${p.name}」命中`,
          rawByField[p.field] === p.raw, `live=${rawByField[p.field]} src=${p.raw}`);
        if (!ALL.includes(p.field) || SKIP_JSON.has(p.field)) continue;
        const exp = r2(p.raw / 1e6);
        const val = (y[stmt] || {})[p.field];
        ok(`${tk} ${y.end} ${p.field} == 原始值÷1e6`, val != null && Math.abs(val - exp) < 0.005, `json=${val} src=${p.raw}`);
      }
    }
    const epsLine = y.sources.find((s) => s.includes('每股数据'));
    const epsSeg = epsLine && stripSuffix(epsLine).split('：').pop();
    const epsP = epsSeg && parseSeg(epsSeg);
    ok(`${tk} ${y.end} eps 出处可解析`, !!epsP, epsSeg);
    if (epsP) {
      covered.add('eps');
      ok(`${tk} ${y.end} eps 原始值命中`, lookup(inc, y.end, epsP.name) === epsP.raw, `${epsP.name} src=${epsP.raw}`);
      ok(`${tk} ${y.end} eps == 原始值（两位）`, Math.abs(y.perShare.eps - r2(epsP.raw)) < 1e-6, `${y.perShare.eps} vs ${epsP.raw}`);
    }
    const sga = r2((rawByField.sale + rawByField.admin) / 1e6);
    ok(`${tk} ${y.end} sga = 销售及分销费用+行政开支`, Math.abs((y.income.sga ?? NaN) - sga) < 0.005, `${y.income.sga} vs ${sga}`);
    const dl = r2((rawByField.debtLong + (rawByField.notesNC || 0)) / 1e6);
    ok(`${tk} ${y.end} debtLong = 长期贷款+非流动应付票据`, Math.abs((y.balance.debtLong ?? NaN) - dl) < 0.005, `${y.balance.debtLong} vs ${dl}`);
    covered.add('sga').add('debtLong');
    if (y.perShare.dps != null) covered.add('dps');
    ok(`${tk} ${y.end} dps 出现在分红出处里`,
      y.perShare.dps == null || y.sources.some((s) => s.includes('每股派') && s.includes(String(y.perShare.dps))));
    const missing = ALL.filter((f) => (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) != null && !covered.has(f));
    ok(`${tk} ${y.end} 每个非空字段都有出处`, missing.length === 0, missing.join(','));
  }
}

async function verifyKR() {
  const tk = '005930.KS';
  const c = MET.companies[tk];
  const j = await getJSON('https://m.stock.naver.com/api/stock/005930/finance/annual',
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124' });
  const keys = (j.financeInfo && j.financeInfo.trTitleList || []).map((t) => String(t.key));
  const rows = (j.financeInfo && j.financeInfo.rowList) || [];
  const cell = (title, key) => {
    const row = rows.find((r) => r.title === title);
    if (!row || !row.columns || !row.columns[key]) return null;
    return Number(String(row.columns[key].value).replace(/,/g, ''));
  };
  for (const y of c.years) {
    const key = String(y.fiscalYear) + '12';
    ok(`${tk} ${y.end} Naver 有该年度列`, keys.includes(key), keys.join(','));
    const map = { '매출액': ['revenue', 100], '영업이익': ['opInc', 100], '지배주주순이익': ['netInc', 100] };
    for (const [title, [field, unitMul]] of Object.entries(map)) {
      const raw = cell(title, key);
      ok(`${tk} ${y.end} ${field} 上游有值`, raw != null, title);
      const exp = r2(raw * unitMul); // 1 억 = 1e8 KRW = 100 KRW-M
      ok(`${tk} ${y.end} ${field} == 上游 억원×100`,
        Math.abs((y.income[field] ?? NaN) - exp) < 0.005, `json=${y.income[field]} exp=${exp} raw=${raw}`);
    }
    for (const [title, field, mul] of [['EPS', 'eps', 1], ['주당배당금', 'dps', 1]]) {
      const raw = cell(title, key);
      ok(`${tk} ${y.end} ${field} == 上游`,
        Math.abs((y.perShare[field] ?? NaN) - raw * mul) < 1e-6, `json=${y.perShare[field]} raw=${raw}`);
    }
    ok(`${tk} ${y.end} 缺字段有出处说明`, y.nulls.length > 0 && y.sources.some((s) => s.includes('DART')));
  }
}

if (LIVE) {
  try {
    await verifyUS('MSFT', '0000789019');
    await verifyUS('KO', '0000021344');
    await verifyA();
    await verifyHK();
    await verifyKR();
  } catch (e) {
    ok('联网复取（SEC/东财/Naver）可用', false, String(e && e.message));
  }
}

/* ------------------------------------------------- ④⑤ 浏览器渲染 ---- */
const errs = [];
const chrome = execFile(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--hide-scrollbars',
  '--window-size=1440,1050', '--user-data-dir=' + path.join(ROOT, 'tests', 'out', 'metrics-profile'), 'about:blank',
]);
await sleep(1600);
let ws = null;
try {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find((x) => x.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); let sendRef = null;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Fetch.requestPaused') sendRef('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' });
    if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('ERR ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  sendRef = send;
  const evl = async (ex) => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Page.navigate', { url: BASE + '/index.html' });
  await sleep(3500);

  ok('页面加载了 METRICS', await evl('!!(typeof METRICS !== "undefined" && METRICS && METRICS.companies)'));
  ok('视图组里出现第三个按钮', await evl('!!document.getElementById("btnViewMetrics")'));
  await evl('document.getElementById("btnViewMetrics").click(); true');
  await sleep(700);
  const view = await evl(`({ view: state.view, hash: location.hash,
    sankey: getComputedStyle(document.getElementById('sankey')).display,
    timeline: getComputedStyle(document.getElementById('timeline')).display,
    mode: getComputedStyle(document.getElementById('modeGroup')).display,
    wrap: getComputedStyle(document.getElementById('metricsWrap')).display })`);
  ok('点击后 state.view=metrics', view.view === 'metrics');
  ok('hash 记住 v=metrics', /v=metrics/.test(view.hash), view.hash);
  ok('metrics 视图隐藏 sankey', view.sankey === 'none', view.sankey);
  ok('metrics 视图隐藏 timeline', view.timeline === 'none', view.timeline);
  ok('metrics 视图隐藏 modeGroup', view.mode === 'none', view.mode);
  ok('metricsWrap 显示', view.wrap !== 'none', view.wrap);

  // 每家：行数 + 数字单元格不得出现 0 代替 null
  for (const tk of MAIN) {
    await evl(`state.company=${JSON.stringify(tk)}; state.view='metrics'; render(); true`);
    await sleep(450);
    const info = await evl(`(() => {
      const w = document.getElementById('metricsWrap');
      const tbl = w.querySelector('table');
      const nulls = [...w.querySelectorAll('td.mv-null')];
      return { rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0,
        cols: tbl ? tbl.querySelectorAll('thead th').length : 0,
        nulls: nulls.length,
        nullText: nulls.length ? nulls[0].textContent : '',
        nullTitle: nulls.length ? nulls[0].title : '',
        title: document.getElementById('chartTitle').textContent,
        firstRow: tbl ? [...tbl.querySelectorAll('tbody tr')].map(r => [...r.children].map(c => c.textContent)).find(a => a[0] && !/表|表$|每股|比率/.test(a[0])) : null };
    })()`);
    ok(`${tk} 表格有数据行`, info.rows > 5, String(info.rows));
    ok(`${tk} 列数 = 年数+1`, info.cols === MET.companies[tk].years.length + 1, `${info.cols} vs ${MET.companies[tk].years.length + 1}`);
    ok(`${tk} 缺失单元格渲染成 —`, info.nulls === 0 || info.nullText === '—', info.nullText);
    ok(`${tk} 缺失单元格带未披露 tooltip`, info.nulls === 0 || info.nullTitle.length > 0, info.nullTitle);
    ok(`${tk} 无 0 冒充缺失`, info.nulls === 0 || !/^\s*0(\.0+)?\s*$/.test(info.nullText), info.nullText);
  }

  // 比率现算抽查 3 个
  const checkRatio = async (tk, label, expectPct, years) => {
    await evl(`state.company=${JSON.stringify(tk)}; state.view='metrics'; render(); true`);
    await sleep(400);
    const got = await evl(`(() => {
      const tr = [...document.querySelectorAll('#metricsWrap tbody tr')]
        .find(r => r.children[0] && r.children[0].textContent === ${JSON.stringify(label)});
      return tr ? [...tr.children].slice(1).map(c => c.textContent) : null;
    })()`);
    ok(`${tk} 比率行「${label}」存在`, !!got);
    if (!got) return;
    ok(`${tk} 比率「${label}」现算一致`, got[got.length - 1] === expectPct, `page=${got[got.length - 1]} calc=${expectPct}`);
  };
  const RL = await evl('I18N.zh.mvRatios');
  ok('I18N 里有 8 个比率标签', RL && Object.keys(RL).length === 8, JSON.stringify(RL && Object.keys(RL)));
  const msft = MET.companies.MSFT; const my = msft.years[msft.years.length - 1];
  await checkRatio('MSFT', RL.grossMargin, (my.income.gross / my.income.revenue * 100).toFixed(2) + '%');
  const ko = MET.companies.KO; const ky = ko.years[ko.years.length - 1];
  await checkRatio('KO', RL.roe, (ky.income.netInc / ky.balance.equityParent * 100).toFixed(2) + '%');
  const tx = MET.companies['00700.HK']; const ty = tx.years[tx.years.length - 1];
  await checkRatio('00700.HK', RL.payout, (ty.perShare.dps / ty.perShare.eps * 100).toFixed(2) + '%');

  // 空态：没有 metrics 的公司
  await evl(`state.company='NVDA'; state.view='metrics'; render(); true`);
  await sleep(400);
  const empty = await evl(`({ text: (document.querySelector('#metricsWrap .mv-empty')||{}).textContent || '',
    rows: document.querySelectorAll('#metricsWrap tbody tr').length,
    table: !!document.querySelector('#metricsWrap table') })`);
  ok('无数据公司显示空态文案', empty.text.length > 0 && empty.rows === 0 && !empty.table, JSON.stringify(empty));

  // 语言切换
  await evl(`state.company='MSFT'; state.view='metrics'; lang='en'; render(); true`);
  await sleep(400);
  const en = await evl(`({ btn: document.getElementById('btnViewMetrics').textContent,
    col: document.querySelector('#metricsWrap thead th').textContent })`);
  ok('English 下按钮与表头有译文', en.btn === 'Metrics' && en.col === 'Item', JSON.stringify(en));
  await evl(`lang='zh'; render(); true`);

  // hash 直达
  await evl(`location.hash='#c=KO&v=metrics'; applyHash(); render(); true`);
  await sleep(500);
  const viaHash = await evl(`({ company: state.company, view: state.view, rows: document.querySelectorAll('#metricsWrap tbody tr').length })`);
  ok('hash 直达 KO 的 metrics 视图', viaHash.company === 'KO' && viaHash.view === 'metrics' && viaHash.rows > 5, JSON.stringify(viaHash));

  // 切回 bridge 要还原
  await evl(`state.company='MSFT'; state.view='bridge'; render(); true`);
  await sleep(400);
  const back = await evl(`({ sankey: getComputedStyle(document.getElementById('sankey')).display,
    wrap: getComputedStyle(document.getElementById('metricsWrap')).display,
    timeline: getComputedStyle(document.getElementById('timeline')).display,
    mode: getComputedStyle(document.getElementById('modeGroup')).display })`);
  ok('切回桑基图恢复 sankey/timeline/modeGroup',
    back.sankey !== 'none' && back.wrap === 'none' && back.timeline !== 'none' && back.mode !== 'none', JSON.stringify(back));

  // fetch 失败 → data/metrics.json.js 兜底
  // 只让 data/metrics.json 这一个请求失败（Network.setBlockedURLs 是前缀匹配，会连 .json.js 一起挡掉）
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/metrics.json', requestStage: 'Request' }] });
  await send('Page.reload', { ignoreCache: true });
  await sleep(3500);
  await evl(`document.getElementById('btnViewMetrics').click(); true`);
  await sleep(600);
  const fb = await evl(`({ hasData: !!(typeof METRICS !== 'undefined' && METRICS && METRICS.companies),
    rows: document.querySelectorAll('#metricsWrap tbody tr').length })`);
  ok('metrics.json 取不到时用 .json.js 兜底', fb.hasData && fb.rows > 5, JSON.stringify(fb));
  await send('Fetch.disable');

  ok('metrics 视图无 console 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  ok('浏览器阶段执行完成', false, String(e && e.stack || e).slice(0, 300));
} finally {
  try { chrome.kill(); } catch { /* ignore */ }
}

/* ------------------------------------------------------------ 汇总 ---- */
console.log(`\nverify_metrics: ${pass} 通过, ${fails.length} 失败`);
if (fails.length) {
  console.log('失败项：');
  for (const f of fails.slice(0, 40)) console.log(' ✗', f);
  if (fails.length > 40) console.log(` … 另有 ${fails.length - 40} 条`);
  process.exit(1);
}
console.log('OK — 数据层逐位对源、镜像一致、比率现算、空态与兜底均通过');
