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
// canonical 字段表的唯一真源（scripts/metrics_schema.mjs）：CORE 每家必备、EXTENDED 可选
import { CORE, EXTENDED, GROUPS, ALL, RATIO_KEYS, OWNER } from '../scripts/metrics_schema.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8440';
const LIVE = process.env.NO_LIVE !== '1';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const SHOTS = path.join(ROOT, 'tests', '.shots');   // 截图交付目录（.gitignore 已忽略）
fs.mkdirSync(SHOTS, { recursive: true });

const MAIN = ['MSFT', 'KO', '600887.SS', '00700.HK', '005930.KS'];
const ALL_TICKERS = [...MAIN, 'SGCC'];
const isShr = (f) => OWNER[f] === 'shareholder';
/* 分红率与前端 mvPayout 同一条公式；测试里独立重算，不读前端实现。 */
function payout(y) {
  const S = y.shareholder || {}, I = y.income || {}, P = y.perShare || {};
  if (S.dividendsToParent != null && I.netInc != null) return S.dividendsToParent / I.netInc;
  if (P.dps != null && P.eps != null) return P.dps / P.eps;
  return null;
}
const pct2 = (v) => (v == null ? null : (v * 100).toFixed(2) + '%');

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
    for (const g of Object.keys(CORE)) {
      ok(`${tag} ${g} 是对象`, y[g] && typeof y[g] === 'object' && !Array.isArray(y[g]));
      for (const f of CORE[g]) {
        const v = (y[g] || {})[f];
        ok(`${tag} ${g}.${f} 存在（可 null）`, f in (y[g] || {}), 'missing key');
        ok(`${tag} ${g}.${f} 最多两位小数`, v == null || r2(v) === v, String(v));
        ok(`${tag} ${g}.${f} 不是字符串`, v == null || typeof v === 'number', typeof v);
      }
      // 扩展字段按公司可选：出现即须为数字或 null（未出现的公司不必造 null 行）
      for (const f of (EXTENDED[g] || [])) {
        if (!(f in (y[g] || {}))) continue;
        const v = y[g][f];
        ok(`${tag} ${g}.${f}（扩展）最多两位小数`, v == null || (typeof v === 'number' && r2(v) === v), String(v));
      }
      // payout 不是入库字段：它是股东回报组里前端现算的一行；其余比率同理
      for (const rk of [...RATIO_KEYS, 'payout']) ok(`${tag} ${g} 不含派生比率 ${rk}`, !(rk in (y[g] || {})));
    }
    const computed = ALL.filter((f) => {
      const grp = y[OWNER[f]] || {};
      return f in grp && grp[f] == null;
    });
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
  for (const tk of ALL_TICKERS) ok(`metrics 覆盖 ${tk}`, Object.keys(MET.companies).includes(tk));
  ok('metrics 无多余 key', Object.keys(MET.companies).length === ALL_TICKERS.length, Object.keys(MET.companies).join(','));
  // SGCC 是国企分红的唯一深度样本：6 年、6 份年报，全部 as reported
  const sg = MET.companies.SGCC || {};
  ok('SGCC 6 个财年（FY2020–FY2025）', (sg.years || []).length === 6, String((sg.years || []).length));
  ok('SGCC 是国有独资（stateOwnership=1）', sg.stateOwnership === 1, String(sg.stateOwnership));
  ok('SGCC 分红为宣告口径', sg.dividendBasis === 'declared', sg.dividendBasis);
  ok('SGCC 有分红口径说明（中英）', !!(sg.dividendBasisNote && sg.dividendBasisNoteEn));
  // 毛利派生值只在前端现算：原表不单列毛利的公司，JSON 里必须始终是 null
  for (const tk of ['SGCC', '600887.SS']) {
    ok(`${tk} 各年 income.gross 均为 null（毛利派生值不入库）`,
      MET.companies[tk].years.every((y) => y.income.gross === null),
      JSON.stringify(MET.companies[tk].years.map((y) => y.income.gross)));
  }
  for (const tk of ALL_TICKERS) {
    const c = MET.companies[tk] || {};
    ok(`${tk} dividendBasis 合法`, [ 'cash', 'declared', null ].includes(c.dividendBasis === undefined ? null : c.dividendBasis), String(c.dividendBasis));
    ok(`${tk} 有 dividendBasis 就有说明`, !c.dividendBasis || !!(c.dividendBasisNote && c.dividendBasisNoteEn));
    ok(`${tk} shareholder 组存在`, (c.years || []).every((y) => y.shareholder && typeof y.shareholder === 'object'));
    for (const y of c.years || []) {
      const S = y.shareholder || {};
      if (S.dividendsToParent != null && S.dividendsTotal != null) {
        ok(`${tk} ${y.end} 归母分红 ≤ 分红总额`, S.dividendsToParent <= S.dividendsTotal + 1e-9, `${S.dividendsToParent} > ${S.dividendsTotal}`);
      }
      const p = payout(y), I = y.income || {}, P = y.perShare || {};
      if (S.dividendsToParent != null && I.netInc != null) {
        ok(`${tk} ${y.end} payout = 归母分红÷归母净利`, p === S.dividendsToParent / I.netInc, `${p}`);
      } else if (P.dps != null && P.eps != null) {
        ok(`${tk} ${y.end} payout 回退 dps÷eps`, p === P.dps / P.eps, `${p}`);
      } else {
        ok(`${tk} ${y.end} payout 无口径时必须是 null`, p === null, String(p));
      }
    }
  }
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
function emUrl(reportName, filter, size = 5000, sortKey = 'REPORT_DATE') {
  const q = new URLSearchParams({
    reportName, columns: 'ALL', filter, pageNumber: '1', pageSize: String(size),
    sortColumns: sortKey, sortTypes: '-1', source: 'WEB', client: 'WEB',
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
      const line = y.sources.find((s) => !s.includes('股东回报') && s.includes(
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
    const missing = ALL.filter((f) => !isShr(f) && (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) != null && !covered.has(f));
    ok(`${tk} ${y.end} 每个非空字段都有出处（股东回报另见 verifyDividends）`, missing.length === 0, missing.join(','));
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
    const missing = ALL.filter((f) => !isShr(f) && (y.income[f] ?? y.balance[f] ?? y.cashflow[f] ?? y.perShare[f]) != null && !covered.has(f));
    ok(`${tk} ${y.end} 每个非空字段都有出处（股东回报另见 verifyDividends）`, missing.length === 0, missing.join(','));
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

/* ------------------------------------- ③b SGCC：离线逐位对源 ---- */
/* 六份年报扫描件的 OCR 结果（公司已做过恒等式自检，主助手复核过与线上 12 个字段逐位一致）
   入库副本：docs/evidence/sgcc_full.json。metrics 里 SGCC 每一个数字都必须与它逐位相等，
   且每张报表都要有页级出处（P2025.pdf p41 形式）。 */
const SGCC_MAP = [
  ['income', 'revenue', 'revenue'], ['income', 'totalRevenue', 'totalRevenue'],
  ['income', 'cogs', 'costOfSales'], ['income', 'opInc', 'operatingProfit'],
  ['income', 'pbt', 'profitBeforeTax'], ['income', 'tax', 'incomeTaxExpense'],
  ['income', 'netInc', 'netProfitAttributableToParent'],
  ['income', 'rd', 'rdExpenses'], ['income', 'taxAndSurcharges', 'taxesAndSurcharges'],
  ['income', 'finExpense', 'financialExpenses'], ['income', 'investmentIncome', 'investmentIncome'],
  ['income', 'interestExpense', 'interestExpense'],
  ['balance', 'cash', 'cash'], ['balance', 'receivables', 'accountsReceivable'],
  ['balance', 'inventory', 'inventory'], ['balance', 'currentAssets', 'currentAssetsTotal'],
  ['balance', 'ppe', 'fixedAssets'], ['balance', 'totalAssets', 'totalAssets'],
  ['balance', 'liabilities', 'totalLiabilities'], ['balance', 'equityParent', 'equityAttributableToParent'],
  ['balance', 'equity', 'totalEquity'], ['balance', 'cip', 'constructionInProgress'],
  ['balance', 'paidInCapital', 'paidInCapital'], ['balance', 'retainedEarnings', 'retainedEarnings'],
  ['balance', 'minorityInterests', 'minorityInterests'],
  ['cashflow', 'ocf', 'operatingCashFlow'], ['cashflow', 'icf', 'investingCashFlow'],
  ['cashflow', 'finCashFlow', 'financingCashFlow'], ['cashflow', 'capex', 'capex'],
];

function verifySGCC() {
  const tk = 'SGCC';
  const c = MET.companies[tk];
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'evidence', 'sgcc_full.json'), 'utf8'));
  ok('SGCC 证据：6 个财年', Object.keys(ev.years).length === 6);
  ok('SGCC 证据：CNY-M 口径', ev.currency === 'CNY-M', ev.currency);
  ok('SGCC 证据：asReported', ev.asReported === true);
  for (const y of c.years) {
    const e = ev.years[y.end];
    ok(`SGCC ${y.end} 证据里有该年`, !!e);
    if (!e) continue;
    ok(`SGCC ${y.end} 原表恒等式自检无失败项`, Array.isArray(e.checkFail) && e.checkFail.length === 0, JSON.stringify(e.checkFail));
    for (const [g, f, ef] of SGCC_MAP) {
      const want = e[g][ef] == null ? null : r2(e[g][ef]);
      ok(`SGCC ${y.end} ${g}.${f} == 证据 ${ef}`, (y[g] || {})[f] === want, `json=${(y[g] || {})[f]} ev=${e[g][ef]}`);
    }
    // 聚合字段：原表不单列，入库时求和
    ok(`SGCC ${y.end} sga = 销售费用 + 管理费用`,
      y.income.sga === r2(e.income.sellingExpenses + e.income.adminExpenses),
      `${y.income.sga} vs ${r2(e.income.sellingExpenses + e.income.adminExpenses)}`);
    ok(`SGCC ${y.end} debtShort = 短期借款 + 一年内到期非流动负债`,
      y.balance.debtShort === r2(e.balance.shortTermBorrowings + e.balance.noncurrentLiabDueWithin1y),
      `${y.balance.debtShort}`);
    ok(`SGCC ${y.end} debtLong = 长期借款 + 应付债券`,
      y.balance.debtLong === r2(e.balance.longTermBorrowings + e.balance.bondsPayable),
      `${y.balance.debtLong}`);
    // 恒等式（容差来自原表四舍五入：证据里 a 差 −0.01、c 差 0.01）
    ok(`SGCC ${y.end} 资产 = 负债 + 所有者权益`,
      Math.abs(y.balance.totalAssets - (y.balance.liabilities + y.balance.equity)) < 0.03,
      `${y.balance.totalAssets} vs ${y.balance.liabilities + y.balance.equity}`);
    ok(`SGCC ${y.end} 利润总额 − 所得税 = 净利润`,
      Math.abs(y.income.pbt - y.income.tax - e.income.netProfit) < 0.06,
      `${y.income.pbt - y.income.tax} vs ${e.income.netProfit}`);
    ok(`SGCC ${y.end} 净利润 = 归母 + 少数股东`,
      Math.abs(e.income.netProfit - e.income.netProfitAttributableToParent - e.income.minorityInterestsProfit) < 0.02,
      `${e.income.netProfit}`);
    // 页级出处：每张表都要能翻到具体页码
    for (const stmt of ['合并资产负债表', '合并利润表', '合并现金流量表', '合并所有者权益变动表']) {
      const line = y.sources.find((x) => x.includes(stmt));
      ok(`SGCC ${y.end} ${stmt} 有页级出处`, !!line && /P20\d\d\.pdf p\d+/.test(line),
        line ? line.slice(0, 40) : 'missing');
    }
    // 分红：权益变动表「3.对所有者的分配」，原表以负数列示，入库取绝对值
    const d = e.equityChange.distributionsToOwners;
    ok(`SGCC ${y.end} dividendsTotal = |权益变动表合计|`,
      y.shareholder.dividendsTotal === r2(Math.abs(d.consolidated)), `${y.shareholder.dividendsTotal} vs ${d.consolidated}`);
    const par = d.attributableToParent == null ? null : r2(Math.abs(d.attributableToParent));
    ok(`SGCC ${y.end} dividendsToParent = |权益变动表归母列|`,
      y.shareholder.dividendsToParent === par, `${y.shareholder.dividendsToParent} vs ${par}`);
    coveredShr.add(shrKey(tk, y.end, 'dividendsTotal'));
    coveredShr.add(shrKey(tk, y.end, 'dividendsToParent'));
    if (d.restatedInNextYearReport) {
      const rr = d.restatedInNextYearReport;
      ok(`SGCC ${y.end} restated 合计 == 次年报表重述值`,
        y.restated && y.restated.dividendsTotal === r2(Math.abs(rr.consolidated)), JSON.stringify(y.restated));
      ok(`SGCC ${y.end} restated 归母 == 次年报表重述值`,
        y.restated && y.restated.dividendsToParent === r2(Math.abs(rr.attributableToParent)), JSON.stringify(y.restated));
      ok(`SGCC ${y.end} restated 有页级出处`, !!(y.restated && /P20\d\d\.pdf p\d+/.test(y.restated.source)), y.restated && y.restated.source);
    }
  }
  // 2021 双口径：as reported 归母空白（null，不是 0），次年重述 4,582.18 / 8,098.24
  const y21 = c.years.find((y) => y.end === '2021-12-31');
  ok('SGCC 2021 归母分红 as-reported 为 null（绝不写 0）', y21 && y21.shareholder.dividendsToParent === null, JSON.stringify(y21 && y21.shareholder));
  ok('SGCC 2021 合计分红 = 3,516.06（该年只列少数股东）', y21 && y21.shareholder.dividendsTotal === 3516.06, String(y21 && y21.shareholder.dividendsTotal));
  ok('SGCC 2021 restated = 8,098.24 / 4,582.18', !!y21.restated && y21.restated.dividendsTotal === 8098.24 && y21.restated.dividendsToParent === 4582.18, JSON.stringify(y21.restated));
  ok('SGCC 2021 payout 按 as-reported 无法计算（null）', payout(y21) === null, String(payout(y21)));
  const note21 = (y21.notes || []).find((n) => n.id === 'fy2021-restated');
  ok('SGCC 2021 有双口径脚注', !!note21);
  ok('SGCC 2021 脚注覆盖 dividendsTotal/dividendsToParent/stateDividend/payout',
    !!note21 && ['dividendsTotal', 'dividendsToParent', 'stateDividend', 'payout'].every((f) => note21.fields.includes(f)),
    JSON.stringify(note21 && note21.fields));
  ok('SGCC 2021 脚注写明重述数字 4,582.18 / 8,098.24',
    !!note21 && note21.text.includes('4,582.18') && note21.text.includes('8,098.24'), note21 && note21.text.slice(0, 80));
  // 重述口径的两个分红率：归母 9.95%、合并 17.59%（= 派单方所称 17.6%）
  const restatedParentPayout = pct2(y21.restated.dividendsToParent / y21.income.netInc);
  const restatedTotalPayout = pct2(y21.restated.dividendsTotal / y21.income.netInc);
  ok('SGCC 2021 重述归母分红率 = 9.95%', restatedParentPayout === '9.95%', String(restatedParentPayout));
  ok('SGCC 2021 重述合并分红率 = 17.59%', restatedTotalPayout === '17.59%', String(restatedTotalPayout));
  ok('SGCC 2021 脚注里写了这两个分红率', !!note21 && note21.text.includes('9.95%') && note21.text.includes('17.59%'));
  // 其余年份的 payout 与主助手核对过的口径一致（8.2% / — / 38.5% / 35.6% / 46.8% / 45.2%）
  const wantPayout = ['8.24%', null, '38.52%', '35.58%', '46.85%', '45.24%'];
  ok('SGCC 六年 payout 序列', JSON.stringify(c.years.map((y) => pct2(payout(y)))) === JSON.stringify(wantPayout),
    JSON.stringify(c.years.map((y) => pct2(payout(y)))));
  // 混合口径：现金流量表「分配股利、利润或偿付利息支付的现金」含利息，不入 dividendsPaid
  ok('SGCC dividendsPaid 为 null（混合口径含利息，不采用）', c.years.every((y) => y.cashflow.dividendsPaid === null));
  ok('SGCC dividendsPaid 的 null 有口径说明', c.years.every((y) => y.sources.some((x) => x.includes('dividendsPaid') && x.includes('利息'))));
  ok('SGCC buyback 为 null 且有说明', c.years.every((y) => y.cashflow.buyback === null && y.sources.some((x) => x.includes('buyback'))));
  ok('SGCC eps/dps 为 null（未上市）', c.years.every((y) => y.perShare.eps === null && y.perShare.dps === null));
  ok('SGCC gross 为 null（A 股利润表不单列毛利）', c.years.every((y) => y.income.gross === null));
  ok('SGCC 每份年报 5 条以上出处', c.years.every((y) => y.sources.length >= 5), String(c.years[0].sources.length));
}

/* ------------------------------- ③c 股东回报：联网逐位对源 ---- */
/* 分红有「宣告」与「已付现金」两种口径，每一家的 sources 都必须点明是哪种。
   MSFT/KO 用 SEC companyfacts（只有已付现金）；600887 用东财 RPT_SHAREBONUS_DET（宣告，每 10 股）；
   00700 只能取到每股派息（港元）+ 除净日汇率，宣告总额需要逐期股本而该源只给最新值 → null；
   005930 该源无总额行（需 DART key）→ null。 */
const coveredShr = new Set();
const shrKey = (tk, end, f) => `${tk}|${end}|${f}`;

async function verifyDividends() {
  // --- MSFT / KO：SEC companyfacts 的已付现金股利 ---
  for (const [tk, cik, tag, other] of [
    ['MSFT', '0000789019', 'PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
    ['KO', '0000021344', 'PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
  ]) {
    const facts = (await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, SEC)).facts['us-gaap'];
    ok(`${tk} companyfacts 有 ${tag}`, !!(facts[tag] && facts[tag].units.USD), tag);
    ok(`${tk} companyfacts 没有 ${other}（两个科目名不能互换）`, !(facts[other] && facts[other].units.USD), other);
    const units = (facts[tag] && facts[tag].units.USD) || [];
    for (const y of MET.companies[tk].years) {
      const S = y.shareholder;
      const want = Math.round(S.dividendsTotal * 1e6);
      const hit = units.some((e) => e.end === y.end && Number(e.val) === want);
      ok(`${tk} ${y.end} dividendsTotal 可在 ${tag} 复现（已付现金口径）`, hit, `want=${want}`);
      ok(`${tk} ${y.end} 已付现金 == 现金流 dividendsPaid`, S.dividendsTotal === y.cashflow.dividendsPaid,
        `${S.dividendsTotal} vs ${y.cashflow.dividendsPaid}`);
      ok(`${tk} ${y.end} dividendsToParent = dividendsTotal（发行人层面无少数股东）`, S.dividendsToParent === S.dividendsTotal);
      coveredShr.add(shrKey(tk, y.end, 'dividendsTotal'));
      coveredShr.add(shrKey(tk, y.end, 'dividendsToParent'));
    }
  }

  // --- 600887.SS：东财 RPT_SHAREBONUS_DET，每 10 股 → 总额 ---
  {
    const tk = '600887.SS';
    const rows = (await getJSON(emUrl('RPT_SHAREBONUS_DET', '(SECURITY_CODE="600887")'), EM)).result.data;
    ok('600887 分红明细行数 ≥ 20', rows.length >= 20, String(rows.length));
    const impl = rows.filter((r) => r.ASSIGN_PROGRESS === '实施分配');
    ok('600887 只把「实施分配」计入（其余进度不计）', impl.length < rows.length, `${impl.length}/${rows.length}`);
    const totalOf = (r) => (Number(r.PRETAX_BONUS_RMB) / 10) * Number(r.TOTAL_SHARES) / 1e6;
    const per10Of = (r) => Number(r.PRETAX_BONUS_RMB) / 10;
    for (const y of MET.companies[tk].years) {
      const yr = y.end.slice(0, 4);
      const mine = impl.filter((r) => String(r.REPORT_DATE).startsWith(yr));
      // 每次「实施分配」是独立的现金派发，先各自保留两位再相加（2025 = 3,036.17 + 5,692.82）
      const want = r2(mine.reduce((a, r) => a + r2(totalOf(r)), 0));
      ok(`600887 ${y.end} dividendsTotal 可复现（每10股÷10×股本）`,
        y.shareholder.dividendsTotal === want, `json=${y.shareholder.dividendsTotal} calc=${want}`);
      // 每股股利与分红明细自洽：同一年度各次「每 10 股派 X 元」之和 ÷ 10 == dps
      const dpsWant = r2(mine.reduce((a, r) => a + per10Of(r), 0));
      ok(`600887 ${y.end} dps == Σ(每10股派息)/10`, y.perShare.dps === dpsWant, `json=${y.perShare.dps} calc=${dpsWant}`);
      ok(`600887 ${y.end} dividendsToParent = dividendsTotal（无少数股东）`, y.shareholder.dividendsToParent === y.shareholder.dividendsTotal);
      coveredShr.add(shrKey(tk, y.end, 'dividendsTotal'));
      coveredShr.add(shrKey(tk, y.end, 'dividendsToParent'));
    }
    // 2026 年的分配（股东大会决议通过）绝不能计入 2025
    const future = rows.filter((r) => String(r.REPORT_DATE).slice(0, 10) > '2025-12-31');
    ok('600887 存在 2026 年分配记录（必须排除）', future.length > 0, String(future.length));
    ok('600887 2026 年分配未计入任何财年',
      !MET.companies[tk].years.some((y) => String(future.map((r) => r.REPORT_DATE)).includes(y.end.slice(0, 4))),
      future.map((r) => r.REPORT_DATE).join(','));
  }

  // --- 00700.HK：东财 RPT_HKF10_MAIN_DIVBASIC，只有每股派息，没有逐期股本 ---
  {
    const tk = '00700.HK';
    const rows = (await getJSON(emUrl('RPT_HKF10_MAIN_DIVBASIC', '(SECURITY_CODE="00700")(IS_BFP="0")', 5000, 'NOTICE_DATE'), EM)).result.data;
    ok('00700 分红明细行数 ≥ 20', rows.length >= 20, String(rows.length));
    const cash = rows.filter((r) => /^每股派港币/.test(r.PLAN_EXPLAIN || ''));
    ok('00700 有非现金「特别分配」（京东/美团实物股，不计入现金分红）',
      rows.some((r) => /特殊说明/.test(r.PLAN_EXPLAIN || '')), String(rows.length - cash.length));
    for (const y of MET.companies[tk].years) {
      const yr = y.end.slice(0, 4);
      const row = cash.find((r) => String(r.YEAR) === yr);
      ok(`00700 ${y.end} 有该年度的每股派息公告`, !!row, yr);
      if (!row) continue;
      const hkd = Number((row.PLAN_EXPLAIN.match(/([\d.]+)\s*元/) || [])[1]);
      ok(`00700 ${yr} 宣派港元/股可解析`, Number.isFinite(hkd), row.PLAN_EXPLAIN);
      // dps 的换算规则写在 sources 里：HKD/CNY=0.86964（除净日）
      const line = y.sources.find((x) => x.includes('RPT_HKF10_MAIN_DIVBASIC') && x.includes('每股派'));
      const fx = line && Number((line.match(/HKD\/CNY=([\d.]+)/) || [])[1]);
      ok(`00700 ${y.end} sources 里有除净日汇率`, Number.isFinite(fx), line && line.slice(-40));
      ok(`00700 ${y.end} dps = 宣派港元 × 汇率`,
        Math.abs(y.perShare.dps - r2(hkd * fx)) < 1e-9, `json=${y.perShare.dps} calc=${r2(hkd * fx)}`);
      // 宣告总额需要逐期已发行股本，该源只给最新值 → null（不估算）
      ok(`00700 ${y.end} dividendsTotal 为 null（无逐期股本，不估算）`, y.shareholder.dividendsTotal === null);
      ok(`00700 ${y.end} dividendsToParent 为 null`, y.shareholder.dividendsToParent === null);
      ok(`00700 ${y.end} null 原因写在 sources 里`,
        y.sources.some((x) => x.includes('dividendsTotal') && x.includes('股本')));
      coveredShr.add(shrKey(tk, y.end, 'dividendsTotal'));
      coveredShr.add(shrKey(tk, y.end, 'dividendsToParent'));
    }
  }

  // --- 005930.KS：Naver 只有每股股利，无总额；DART 需 key ---
  {
    const tk = '005930.KS';
    for (const y of MET.companies[tk].years) {
      ok(`005930 ${y.end} dividendsTotal 为 null（该源无总额，需 DART key）`, y.shareholder.dividendsTotal === null);
      ok(`005930 ${y.end} dividendsToParent 为 null`, y.shareholder.dividendsToParent === null);
      ok(`005930 ${y.end} null 原因写明 DART`, y.sources.some((x) => x.includes('DART') && x.includes('dividendsTotal')));
      coveredShr.add(shrKey(tk, y.end, 'dividendsTotal'));
      coveredShr.add(shrKey(tk, y.end, 'dividendsToParent'));
    }
    ok('005930 dividendBasis 为 null（既无宣告也无支付总额）', MET.companies[tk].dividendBasis === null);
  }

  // 每一个股东回报字段都必须被上面某条断言复现过
  for (const tk of ALL_TICKERS) {
    for (const y of MET.companies[tk].years) {
      for (const f of CORE.shareholder) {
        ok(`${tk} ${y.end} shareholder.${f} 已对源复现`, coveredShr.has(shrKey(tk, y.end, f)), f);
      }
    }
  }
}

verifySGCC();   // 离线：先跑，登记 coveredShr

if (LIVE) {
  try {
    await verifyUS('MSFT', '0000789019');
    await verifyUS('KO', '0000021344');
    await verifyA();
    await verifyHK();
    await verifyKR();
    await verifyDividends();
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

  // —— 股东回报组：SGCC（国企利润上缴）+ 2021 双口径脚注 + 00700/MSFT 口径差异 ——
  const F = await evl('I18N.zh.mvFields');
  ok('I18N 有股东回报字段标签',
    !!(F && F.dividendsTotal && F.dividendsToParent && F.stateDividend && F.dividendsPaid && F.buyback),
    JSON.stringify(Object.keys(F || {}).filter((k) => /dividends|state|buyback/.test(k))));
  const rowsOf = async (tk) => {
    await evl(`state.company=${JSON.stringify(tk)}; state.view='metrics'; render(); true`);
    await sleep(450);
    return evl(`(() => {
      const out = { groups: [], rows: {}, fns: (document.querySelector('#metricsWrap .mv-fn-list')||{}).textContent || '',
        note: (document.querySelector('#metricsWrap .mv-note')||{}).textContent || '' };
      for (const tr of document.querySelectorAll('#metricsWrap tbody tr')) {
        const c0 = tr.children[0];
        if (tr.classList.contains('mv-group')) { out.groups.push(c0.textContent); continue; }
        const label = c0.querySelector('sup') ? c0.childNodes[0].textContent : c0.textContent;
        out.rows[label] = { cells: [...tr.children].slice(1).map((c) => c.textContent),
          sups: [...tr.children].slice(1).map((c) => (c.querySelector('sup') || {}).textContent || ''),
          nameSup: (c0.querySelector('sup') || {}).textContent || '',
          title: c0.title || '' };
      }
      return out;
    })()`);
  };
  const G = await evl('I18N.zh.mvGroups');
  const sgccRows = await rowsOf('SGCC');
  ok('SGCC 有「股东回报」分组行', sgccRows.groups.includes(G.shareholder), JSON.stringify(sgccRows.groups));
  ok('SGCC 股东回报组在利润表之后、资产负债表之前',
    sgccRows.groups.indexOf(G.shareholder) > sgccRows.groups.indexOf(G.income)
    && sgccRows.groups.indexOf(G.shareholder) < sgccRows.groups.indexOf(G.balance), JSON.stringify(sgccRows.groups));
  ok('SGCC 现金分红总额行存在', !!sgccRows.rows[F.dividendsTotal]);
  ok('SGCC 2025 现金分红总额 = 42,986.32', (sgccRows.rows[F.dividendsTotal] || {}).cells?.[5] === '42,986.32',
    JSON.stringify((sgccRows.rows[F.dividendsTotal] || {}).cells));
  ok('SGCC 2025 其中归母 = 36,147.30', (sgccRows.rows[F.dividendsToParent] || {}).cells?.[5] === '36,147.30');
  ok('SGCC 2025 利润上缴 = 36,147.30（= 归母分红）', (sgccRows.rows[F.stateDividend] || {}).cells?.[5] === '36,147.30',
    JSON.stringify((sgccRows.rows[F.stateDividend] || {}).cells));
  // 毛利润：JSON 里 gross 必须是 null（派生值不入库），页面按 营收 − 营业成本 现算，行名带 ¹ 脚注
  {
    const sg25 = MET.companies.SGCC.years.at(-1).income;
    const wantGross = (sg25.revenue - sg25.cogs).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ok('SGCC 毛利润行在页面现算 = 营收 − 营业成本',
      (sgccRows.rows[F.gross] || {}).cells?.[5] === wantGross,
      `page=${(sgccRows.rows[F.gross] || {}).cells?.[5]} calc=${wantGross}`);
    ok('SGCC 毛利润行带行级脚注 ¹', (sgccRows.rows[F.gross] || {}).nameSup === '¹',
      JSON.stringify((sgccRows.rows[F.gross] || {}).nameSup));
    ok('SGCC 表尾脚注解释毛利现算口径',
      sgccRows.fns.includes('毛利 = 营业收入 − 营业成本'), sgccRows.fns.slice(0, 200));
    ok('SGCC 毛利润行显示的是精确值而非 —', !/^—/.test((sgccRows.rows[F.gross] || {}).cells?.[5] || '—'),
      (sgccRows.rows[F.gross] || {}).cells?.[5]);
  }
  // 2021：as-reported 归母空白 → 显示 —（不是 0），且带脚注上标；合计 3,516.06
  const c21 = sgccRows.rows[F.dividendsToParent].cells[1];
  ok('SGCC 2021 归母分红显示为 —（不显示 0）', /^—/.test(c21) && !/^0/.test(c21), c21);
  ok('SGCC 2021 归母分红带脚注上标', /^[0-9]/.test(sgccRows.rows[F.dividendsToParent].sups[1]),
    JSON.stringify(sgccRows.rows[F.dividendsToParent].sups));
  ok('SGCC 2021 分红合计仍显示 3,516.06', /^3,516\.06/.test(sgccRows.rows[F.dividendsTotal].cells[1]),
    sgccRows.rows[F.dividendsTotal].cells[1]);
  ok('SGCC 2021 利润上缴显示 —', /^—/.test(sgccRows.rows[F.stateDividend].cells[1]), sgccRows.rows[F.stateDividend].cells[1]);
  ok('SGCC 2021 脚注列出重述值 4,582.18 / 8,098.24',
    sgccRows.fns.includes('4,582.18') && sgccRows.fns.includes('8,098.24'), sgccRows.fns.slice(0, 120));
  ok('SGCC 2021 脚注给出重述口径两个分红率 9.95% / 17.59%',
    sgccRows.fns.includes('9.95%') && sgccRows.fns.includes('17.59%'), sgccRows.fns.slice(0, 120));
  ok('SGCC 表尾有分红口径声明', sgccRows.note.includes('分红口径') || sgccRows.note.includes('权益变动表'), sgccRows.note.slice(0, 100));
  ok('SGCC 表尾声明「国有资本收益」不入库', sgccRows.note.includes('国有资本收益'), sgccRows.note.slice(-200));
  ok('SGCC payout 2025 = 45.24%（前端现算）',
    /^45\.24%/.test((sgccRows.rows[(await evl('I18N.zh.mvRatios')).payout] || {}).cells?.[5] || ''), 'see payout row');
  const RL2 = await evl('I18N.zh.mvRatios');
  await checkRatio('SGCC', RL2.payout, '45.24%');
  await checkRatio('600887.SS', RL2.payout, '75.48%');
  await checkRatio('MSFT', RL2.payout, '19.77%');
  // 已付现金口径的公司不再显示「已付现金股利」行（避免同一概念两行）
  const msftRows = await rowsOf('MSFT');
  ok('MSFT 现金分红总额 = 26,445.00（已付现金口径）',
    msftRows.rows[F.dividendsTotal].cells[3] === '26,445.00', JSON.stringify(msftRows.rows[F.dividendsTotal].cells));
  ok('MSFT 不显示「已付现金股利」行（主行已是现金口径）', !msftRows.rows[F.dividendsPaid], Object.keys(msftRows.rows).join('|'));
  ok('MSFT 表尾注明分红口径', msftRows.note.includes('分红口径'), msftRows.note.slice(-120));
  // 00700：宣告总额取不到（null）但已付现金行要有，且 dps 折算来自港币
  const txRows = await rowsOf('00700.HK');
  ok('00700 显示「已付现金股利」行（宣告口径之外的另一口径）', !!txRows.rows[F.dividendsPaid], Object.keys(txRows.rows).join('|'));
  ok('00700 已付现金股利 2025 = 39,907.00', txRows.rows[F.dividendsPaid].cells[3] === '39,907.00',
    JSON.stringify(txRows.rows[F.dividendsPaid].cells));
  ok('00700 现金分红总额全部为 —（无逐期股本，不估算）',
    txRows.rows[F.dividendsTotal].cells.every((c) => /^—/.test(c)), JSON.stringify(txRows.rows[F.dividendsTotal].cells));

  // 截图（交付物，tests/.shots/ 已被 gitignore）
  const clipOf = async (sel) => evl(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left + window.scrollX - 8), y: Math.max(0, r.top + window.scrollY - 8),
      width: Math.min(1500, r.width + 16), height: r.height + 16 }; })()`);
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', clip
      ? { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } }
      : { format: 'png', captureBeyondViewport: true });
    const b = Buffer.from(r.result.data, 'base64');
    fs.writeFileSync(path.join(SHOTS, name), b);
    // 局部裁切图（脚注区块）天然比整表小，阈值分开定
    ok(`截图 ${name}（${Math.round(b.length / 1024)} KB）`, b.length > (clip ? 3000 : 8000), String(b.length));
  };
  await evl(`state.company='SGCC'; state.view='metrics'; render(); true`);
  await sleep(500);
  await shot('sgcc-metrics.png', await clipOf('#metricsWrap table'));
  const fnClip = await clipOf('#metricsWrap .mv-fn-list');
  ok('SGCC 2021 脚注区块可定位', !!fnClip, JSON.stringify(fnClip));
  if (fnClip) await shot('sgcc-2021-restated-footnote.png', fnClip);
  await evl(`state.company='00700.HK'; state.view='metrics'; render(); true`);
  await sleep(500);
  await shot('00700-dividends.png', await clipOf('#metricsWrap table'));
  // 移动端：390px，横滚而不是换行
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evl(`state.company='SGCC'; state.view='metrics'; render(); true`);
  await sleep(700);
  const mob = await evl(`(() => { const w = document.getElementById('metricsWrap');
    const t = w.querySelector('table');
    return { rows: t ? t.querySelectorAll('tbody tr').length : 0, scrollW: w.scrollWidth, clientW: w.clientWidth,
      firstColSticky: t ? getComputedStyle(t.querySelector('tbody td')).position : '' }; })()`);
  ok('移动端仍渲染完整表格', mob.rows > 20, JSON.stringify(mob));
  ok('移动端首列 sticky', mob.firstColSticky === 'sticky', mob.firstColSticky);
  ok('移动端表格横向滚动而不压缩', mob.scrollW > mob.clientW, `${mob.scrollW} vs ${mob.clientW}`);
  await shot('sgcc-metrics-mobile-390.png');
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

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

  // #c=SGCC&v=metrics 必须能直接打开且股东回报组完整（任务书 C 段硬性要求）
  await evl(`location.hash='#c=SGCC&v=metrics'; applyHash(); render(); true`);
  await sleep(600);
  const viaSgcc = await evl(`(() => {
    const rows = [...document.querySelectorAll('#metricsWrap tbody tr')];
    return { company: state.company, view: state.view, rows: rows.length,
      groups: rows.filter((r) => r.classList.contains('mv-group')).map((r) => r.children[0].textContent),
      sh: !!rows.find((r) => r.children[0].textContent === I18N.zh.mvGroups.shareholder),
      fn: ((document.querySelector('#metricsWrap .mv-fn-list') || {}).textContent || '').includes('4,582.18') }; })()`);
  ok('#c=SGCC&v=metrics 直达 SGCC 指标视图', viaSgcc.company === 'SGCC' && viaSgcc.view === 'metrics' && viaSgcc.rows > 25, JSON.stringify(viaSgcc));
  ok('#c=SGCC&v=metrics 里股东回报组与 2021 脚注都在', viaSgcc.sh && viaSgcc.fn, JSON.stringify(viaSgcc));


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
