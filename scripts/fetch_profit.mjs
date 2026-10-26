// fetch_profit.mjs — pull real GAAP quarterly data from SEC EDGAR XBRL companyfacts API.
// Output: data/profit.json  ($M, currency USD-M)
//
// Root causes fixed vs the original version (audit 2026-10-26):
//  1. Tag switch mid-history: single-tag "pick one winner" dropped every quarter covered only
//     by the older tag (GOOGL 2021-09..2024-03 gap: Revenues stops 2021-06, resumes 2024-06,
//     while RevenueFromContractWithCustomer* covers the gap). FIX: UNION all candidate tags
//     per period end, earlier tag in the list wins on overlap (keeps prior values stable).
//  2. Fiscal Q4 never filed as a quarterly fact (calendar-year filers GOOGL/META/AMZN Dec-Q,
//     NVDA/AVGO Jan/Nov-Q appear in the 10-K only as a ~365-day annual period).
//     FIX: derive Q4 = FY(annual fact) − Q1 − Q2 − Q3 for every metric, per fiscal year.
//  3. TSM files under ifrs-full with ANNUAL facts only (20-F) — no quarterly XBRL exists on
//     EDGAR; cannot be included without fabricating numbers → stays in skipped[] (documented).
// Usage: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node fetch_profit.mjs
import fs from 'node:fs';
import path from 'node:path';

const UA = 'ProfitBridgeDashboard research contact@example.com';
// registry: ticker/cik/names come from data/companies.json; extra fetch-only companies stay inline
const REGISTRY = JSON.parse(fs.readFileSync(path.join('data', 'companies.json'), 'utf8'));
const EXTRA = [
  { ticker: 'AVGO', cik: 1730168, name: 'Broadcom Inc.' },
];
const COMPANIES = [...REGISTRY.map(c => ({ ticker: c.ticker, cik: c.cik, name: c.nameEn, frequency: c.frequency || 'q' })), ...EXTRA];

// metric → ordered tag candidates (union; earlier tag wins an overlapping period end).
// `gross` falls back to revenue − cost when no GrossProfit fact exists for a period
// (GOOGL files CostOfRevenue, AMZN CostOfSales — real filed data, not fabricated).
const TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  gross: ['GrossProfit'],
  cost: ['CostOfRevenue', 'CostOfRevenues', 'CostOfSales', 'CostOfGoodsAndServicesSold'],
  opInc: ['OperatingIncomeLoss'],
  netInc: ['NetIncomeLoss', 'ProfitLoss'],
  rd: ['ResearchAndDevelopmentExpense', 'TechnologyAndContentExpense'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  tax: ['IncomeTaxExpenseBenefit', 'IncomeTaxExpense'],
};
// IFRS-only filers (ifrs-full taxonomy: TSM/SPOT/TME) don't use us-gaap tags — also try
// these aliases under 'ifrs-full' (union; us-gaap facts still win on overlapping ends
// because collectTag returns us-gaap first and collectMetric keeps the first tag hit).
const IFRS_TAGS = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  gross: ['GrossProfit'],
  cost: ['CostOfSales'],
  opInc: ['OperatingIncomeLoss'],
  netInc: ['ProfitLoss'],
  rd: ['ResearchAndDevelopmentExpense'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  tax: ['IncomeTaxExpense'],
};
const DERIVED_KEYS = ['revenue', 'gross', 'cost', 'opInc', 'netInc', 'rd', 'sga', 'tax'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url) {
  let err;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return await res.json();
    } catch (e) {
      err = e;
      if (attempt === 6) throw e;
      await sleep(1200 * attempt);
    }
  }
  throw err;
}

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// For one XBRL tag: map of period-end → best fact, split into quarterly (85–100d) and
// annual (330–400d, 10-K full-year periods used for Q4 derivation).
function collectTag(facts, tag, cur) {
  const units = ['us-gaap', 'ifrs-full'].flatMap(tax => {
    const node = facts?.facts?.[tax]?.[tag];
    return node?.units && Array.isArray(node.units[cur]) ? [node.units[cur]] : [];
  }).flat();
  if (!units.length) return null;
  const q = new Map(), a = new Map();
  const score = x => (x.form === '10-Q' ? 2 : x.form === '10-K' ? 1 : 0) + (x.fp === 'Q' ? 0.5 : 0);
  for (const f of units) {
    if (!f.start || !f.end) continue;
    const d = days(f.start, f.end);
    const tgt = d >= 85 && d <= 100 ? q : (d >= 330 && d <= 400 ? a : null);
    if (!tgt) continue;
    const prev = tgt.get(f.end);
    if (!prev || score(f) > score(prev) || (score(f) === score(prev) && f.fy > prev.fy)) tgt.set(f.end, f);
  }
  return { q, a };
}

// Union across candidate tags for one metric: { q: end→val, a: end→val }.
// Earlier tag in the list wins on overlapping ends (keeps previously published values stable).
// Company reporting currency: foreign private issuers file in their reporting currency
// (SPOT EUR, SONY JPY, TME CNY, TSM TWD+USD). Prefer USD when the company reports in both
// (TSM), else use the currency of its primary revenue tags — values are stored as filed.
function pickCurrency(facts) {
  const cands = ['us-gaap', 'ifrs-full'].flatMap(tax =>
    ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenue', 'RevenueFromContractsWithCustomers']
      .map(t => facts?.facts?.[tax]?.[t]?.units).filter(Boolean));
  const keys = [...new Set(cands.flatMap(u => Object.keys(u)))].filter(k => /^[A-Z]{3}$/.test(k));
  if (keys.includes('USD')) return 'USD';
  return keys[0] || 'USD';
}

function collectMetric(facts, tagList, cur) {
  const out = { q: new Map(), a: new Map(), used: [] };
  for (const tag of tagList) {
    const c = collectTag(facts, tag, cur);
    if (!c) continue;
    out.used.push(tag);
    for (const [end, f] of c.q) if (!out.q.has(end)) out.q.set(end, f.val);
    for (const [end, f] of c.a) if (!out.a.has(end)) out.a.set(end, f.val);
  }
  return out.used.length ? out : null;
}

// Derive the fiscal Q4 (annual period minus the 3 quarters inside it) for one metric.
// Returns { end, val } for annual ends that have no quarterly fact but do have the three
// intra-year quarterly ends (within 290 days before the FY end).
function deriveQ4(metric) {
  if (!metric) return [];
  const out = [];
  for (const [fyEnd, aval] of metric.a) {
    if (metric.q.has(fyEnd)) continue;
    const intra = [...metric.q.keys()].filter(e => {
      const d = days(e, fyEnd);
      return d > 0 && d < 290;
    }).sort();
    if (intra.length !== 3) continue;
    const sum = intra.reduce((s, e) => s + metric.q.get(e), 0);
    const v = aval - sum;
    if (Number.isFinite(v)) out.push({ end: fyEnd, val: v });
  }
  return out;
}

async function fetchCompany(c) {
  const freq = c.frequency === 'annual' ? 'annual' : 'q';
  const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, '0')}.json`);
  const entityName = facts.entityName || c.name;
  const cur = pickCurrency(facts);
  const picked = {}, failures = [];
  for (const [key, tags] of Object.entries(TAGS)) {
    const tagList = [...tags, ...(IFRS_TAGS[key] || [])];
    picked[key] = collectMetric(facts, tagList, cur);
    if (!picked[key] && (key === 'revenue' || key === 'netInc')) {
      failures.push({ ticker: c.ticker, kind: 'metric-missing', reason: `no XBRL facts for ${key} (tags: ${tags.join(', ')})` });
    }
  }
  if (!picked.revenue || !picked.netInc) return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'skipped', reason: 'missing revenue/net income XBRL data', failures };

  if (freq === 'q') {
    // merge derived Q4s into the quarterly maps
    for (const key of DERIVED_KEYS) {
      for (const { end, val } of deriveQ4(picked[key])) picked[key].q.set(end, val);
    }
  }
  // gross fallback: revenue − cost where GrossProfit absent (both cadences)
  const seriesMap = freq === 'annual' ? 'a' : 'q';
  for (const [end, rev] of picked.revenue[seriesMap]) {
    if (picked.gross?.[seriesMap].has(end)) continue;
    const cost = picked.cost?.[seriesMap].get(end);
    if (cost != null) {
      if (!picked.gross) picked.gross = { q: new Map(), a: new Map(), used: ['derived: revenue − cost'] };
      picked.gross[seriesMap].set(end, rev - cost);
    }
  }

  const ends = [...picked.revenue[seriesMap].keys()].sort();
  const quarters = [];
  for (const end of ends) {
    const q = { end };
    for (const key of DERIVED_KEYS) {
      const v = picked[key]?.[seriesMap].get(end);
      if (v != null) q[key] = Math.round(v / 1e6 * 10) / 10; // USD → $M
    }
    delete q.cost;
    if (q.revenue == null || q.netInc == null) continue;
    quarters.push(q);
  }
  // full continuous history: keep the longest consecutive run whose period ends are all
  // inside the cadence window (q: 80–100d; annual: 300–400d), strict suffix. No cap —
  // full history is kept (user directive: no truncation); EDGAR XBRL coverage is what it is.
  const [loD, hiD] = freq === 'annual' ? [300, 400] : [80, 100];
  let start = quarters.length - 1;
  while (start > 0) {
    const d = days(quarters[start - 1].end, quarters[start].end);
    if (d < loD || d > hiD) break;
    start--;
  }
  const keep = quarters.slice(start);
  const minKeep = freq === 'annual' ? 5 : 12;
  if (keep.length < minKeep) return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'skipped', reason: `only ${keep.length} continuous ${freq === 'annual' ? 'annual' : 'quarterly'} periods found (EDGAR XBRL)`, failures };
  return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'ok', frequency: freq, currency: cur, quarters: keep, failures };
}

// ---- internal consistency checks (per quarter, on the fetched values) ----
function checkCompany(tk, quarters) {
  const issues = [];
  for (const q of quarters) {
    if (q.gross != null && q.gross > q.revenue * 1.005) issues.push(`${q.end}: gross ${q.gross} > revenue ${q.revenue}`);
    if (q.gross != null && q.opInc != null && q.opInc > q.gross * 1.005) issues.push(`${q.end}: opInc ${q.opInc} > gross ${q.gross}`);
    if (q.opInc != null && q.netInc != null && q.tax != null) {
      // netInc should not wildly exceed opInc − tax (>20% slack) unless extra line items exist — record, don't drop
      const resid = q.opInc - q.tax - q.netInc;
      if (Math.abs(resid) > Math.max(1, Math.abs(q.netInc)) * 0.2) issues.push(`${q.end}: netInc chain resid ${resid.toFixed(1)} (opInc ${q.opInc} − tax ${q.tax} − netInc ${q.netInc})`);
    }
    // consecutive-quarter sanity: gaps larger than 100 days are reported by the caller
  }
  return issues;
}
function checkCoverage(tk, quarters, freq = 'q') {
  const [loD, hiD] = freq === 'annual' ? [300, 400] : [80, 105];
  const issues = [];
  for (let i = 1; i < quarters.length; i++) {
    const d = days(quarters[i - 1].end, quarters[i].end);
    if (d < loD || d > hiD) issues.push(`${tk}: gap ${quarters[i - 1].end} → ${quarters[i].end} (${d}d)`);
  }
  return issues;
}

// ---- write guard: never let a partial run overwrite a fuller file ----
function guard(prev, companies, failures, validateTks = null) {
  const prevCount = prev ? Object.keys(prev.companies || {}).length : null;
  const newCount = Object.keys(companies).length;
  const floor = Math.max(prevCount ?? 0, 10);
  if (newCount < floor) {
    throw new Error(`write guard: refusing to write profit.json with ${newCount} companies (floor=${floor}` +
      (prevCount != null ? `, previous file had ${prevCount}` : '') + '). A partial run would destroy full data.');
  }
  for (const [tk, c] of Object.entries(companies)) {
    if (validateTks && !validateTks.has(tk)) continue; // pre-existing entry carried through a merge — already validated when written
    if (c.frequency === 'hk-mixed' || c.frequency === 'mixed') {
      // mixed-frequency entries: validate continuity per periodType group
      // (annual group 300–400d; interim/q1/q3 single-quarter group 70–250d), not one-size-fits-all
      const groups = {};
      for (const q of c.quarters) (groups[q.periodType || 'q'] ||= []).push(q);
      for (const [pt, g] of Object.entries(groups)) {
        const real = g.filter(q => q.revenue != null).sort((a, b) => a.end < b.end ? -1 : 1);
        const annual = pt === 'annual';
        const loD = annual ? 300 : 70, hiD = annual ? 400 : 250;
        for (let i = 1; i < real.length; i++) {
          const d = days(real[i - 1].end, real[i].end);
          if (d < loD || d > hiD) {
            console.log(`GUARD-NOTE ${tk}: ${pt} group gap ${real[i - 1].end} → ${real[i].end} (${d}d, expected ${loD}–${hiD}) — kept (mixed-frequency as-disclosed).`);
          }
        }
      }
      continue;
    }
    const annual = c.frequency === 'annual';
    const minKeep = annual ? 5 : 12, loD = annual ? 300 : 80, hiD = annual ? 400 : 100;
    if (!c.quarters || c.quarters.length < minKeep) {
      throw new Error(`write guard: ${tk} has only ${c.quarters?.length ?? 0} ${annual ? 'annual' : 'quarterly'} periods (<${minKeep}) — refusing to write.`);
    }
    // calendar continuity: consecutive period ends must be inside the cadence window; any
    // gap outside it is a hole (q: 80–100d; annual: 300–400d per task spec)
    for (let i = 1; i < c.quarters.length; i++) {
      const d = days(c.quarters[i - 1].end, c.quarters[i].end);
      if (d < loD || d > hiD) {
        throw new Error(`write guard: ${tk} calendar gap ${c.quarters[i - 1].end} → ${c.quarters[i].end} (${d}d, allowed ${loD}–${hiD}) — refusing to write a holed file.`);
      }
    }
  }
  if (failures.length && process.env.ALLOW_FAILURES !== '1') {
    // metric-missing failures mean a company was dropped — surface but allow (skipped[] carries them)
    for (const f of failures) console.log('GUARD-NOTE failure recorded: ' + JSON.stringify(f));
  }
}

const results = [];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
for (const c of COMPANIES) {
  if (ONLY && !ONLY.has(c.ticker)) continue;
  process.stdout.write(`fetching ${c.ticker} ... `);
  try {
    const r = await fetchCompany(c);
    console.log(r.status === 'ok' ? `${r.quarters.length} quarters (${r.quarters[0].end}..${r.quarters.at(-1).end})` : `SKIPPED (${r.reason})`);
    results.push(r);
  } catch (e) {
    console.log('ERROR ' + e.message);
    results.push({ ticker: c.ticker, cik: c.cik, name: c.name, status: 'error', reason: e.message, failures: [{ ticker: c.ticker, kind: 'fetch', reason: e.message }] });
  }
  await sleep(350); // SEC rate limit ~10 req/s, be polite
}

const companies = {}, notes = [], failures = [];
for (const r of results) {
  if (r.failures) failures.push(...r.failures);
  if (r.status === 'ok') {
    companies[r.ticker] = { name: r.name, cik: r.cik, currency: `${r.currency}-M`, quarters: r.quarters };
    if (r.currency !== 'USD') notes.push(`${r.ticker}: reported in ${r.currency}, values stored as filed (millions of ${r.currency})`);
    if (r.frequency === 'annual') companies[r.ticker].frequency = 'annual';
    for (const i of checkCompany(r.ticker, r.quarters)) notes.push(`${r.ticker}: consistency — ${i}`);
    for (const i of checkCoverage(r.ticker, r.quarters, r.frequency)) notes.push(`${r.ticker}: coverage — ${i}`);
  } else {
    failures.push({ ticker: r.ticker, kind: r.status, reason: r.reason });
  }
}
const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join('data', 'profit.json'), 'utf8')); } catch { return null; } })();
if (!ONLY) guard(prev, companies, failures); // full run: protect against partial overwrite (ONLY runs merge instead, guarded below)

// MERGE=1 (with ONLY): targeted backfill — update just the fetched tickers inside the
// existing profit.json, preserving batch-merged entries (hk-mixed/mixed etc.) that EDGAR
// cannot regenerate. Stale notes about merged tickers are dropped, guard re-runs on the
// merged whole.
if (process.env.MERGE === '1' && ONLY && prev) {
  const fetchedTks = new Set(Object.keys(companies)); // freshly fetched only, before carrying prev entries
  for (const [tk, c] of Object.entries(prev.companies)) {
    if (companies[tk]) continue; // freshly fetched wins
    companies[tk] = c;
  }
  const keepNotes = prev.notes.filter(n => !(n.includes(': ') && fetchedTks.has(n.split(':')[0])));
  notes.unshift(...keepNotes);
  guard(null, companies, failures, fetchedTks);
}

const out = {
  ...(process.env.MERGE === '1' && prev ? {
    // merge mode: carry prev-only fields (skipped[], profitPreview, …) that this ONLY run
    // could not regenerate instead of dropping them
    skipped: prev.skipped, profitPreview: prev.profitPreview,
  } : {}),
  updated: new Date().toISOString(),
  source: 'SEC EDGAR XBRL companyfacts API (US-GAAP and ifrs-full tags; quarterly periods 85-100d, fiscal Q4 derived as FY minus Q1-Q3 where the 10-K has no quarterly facts; 20-F foreign private issuers use annual periods 300-400d with frequency:"annual"; foreign filers stored in their reporting currency — currency field is <ISO>-M)',
  sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/',
  companies,
  skipped: results.filter(r => r.status !== 'ok').map(r => ({ ticker: r.ticker, status: r.status, reason: r.reason })),
  units: '$M',
  notes,
  failures,
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'profit.json'), JSON.stringify(out, null, 2));
// file:// fallback payload: double-clicking index.html without a server still works
fs.writeFileSync(path.join('data', 'profit.json.js'),
  'window.__PROFIT_DATA = ' + JSON.stringify(out) + ';\n');
console.log(`\nwrote data/profit.json: ${Object.keys(companies).length} companies, skipped: ${out.skipped.map(s => s.ticker).join(', ') || 'none'}, ${notes.length} notes`);
for (const n of notes) console.log('NOTE ' + n);
for (const f of failures) console.log('FAIL ' + JSON.stringify(f));
