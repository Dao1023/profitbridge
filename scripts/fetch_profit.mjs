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
const COMPANIES = [...REGISTRY.map(c => ({ ticker: c.ticker, cik: c.cik, name: c.nameEn })), ...EXTRA];

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
  tax: ['IncomeTaxExpenseBenefit'],
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
function collectTag(facts, tag) {
  const node = facts?.facts?.['us-gaap']?.[tag];
  if (!node) return null;
  const units = node.units?.USD;
  if (!Array.isArray(units)) return null;
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
function collectMetric(facts, tagList) {
  const out = { q: new Map(), a: new Map(), used: [] };
  for (const tag of tagList) {
    const c = collectTag(facts, tag);
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
  const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, '0')}.json`);
  const entityName = facts.entityName || c.name;
  const picked = {}, failures = [];
  for (const [key, tags] of Object.entries(TAGS)) {
    picked[key] = collectMetric(facts, tags);
    if (!picked[key] && (key === 'revenue' || key === 'netInc')) {
      failures.push({ ticker: c.ticker, kind: 'metric-missing', reason: `no XBRL facts for ${key} (tags: ${tags.join(', ')})` });
    }
  }
  if (!picked.revenue || !picked.netInc) return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'skipped', reason: 'missing revenue/net income XBRL data', failures };

  // merge derived Q4s into the quarterly maps
  for (const key of DERIVED_KEYS) {
    for (const { end, val } of deriveQ4(picked[key])) picked[key].q.set(end, val);
  }
  // gross fallback: revenue − cost where GrossProfit absent
  for (const [end, rev] of picked.revenue.q) {
    if (picked.gross?.q.has(end)) continue;
    const cost = picked.cost?.q.get(end);
    if (cost != null) {
      if (!picked.gross) picked.gross = { q: new Map(), a: new Map(), used: ['derived: revenue − cost'] };
      picked.gross.q.set(end, rev - cost);
    }
  }

  const ends = [...picked.revenue.q.keys()].sort();
  const quarters = [];
  for (const end of ends) {
    const q = { end };
    for (const key of DERIVED_KEYS) {
      const v = picked[key]?.q.get(end);
      if (v != null) q[key] = Math.round(v / 1e6 * 10) / 10; // USD → $M
    }
    delete q.cost;
    if (q.revenue == null || q.netInc == null) continue;
    quarters.push(q);
  }
  // full continuous quarterly history: keep the longest consecutive run whose quarter ends
  // are all 80–100 days apart (strict suffix — the dashboard shows history up to the latest
  // quarter), capped at MAX_QTRS quarters (XBRL before the cap gets spotty; noted in output).
  const MAX_QTRS = 64;
  let start = quarters.length - 1;
  while (start > 0) {
    const d = days(quarters[start - 1].end, quarters[start].end);
    if (d < 80 || d > 100) break;
    start--;
  }
  let keep = quarters.slice(start);
  if (keep.length > MAX_QTRS) keep = keep.slice(-MAX_QTRS);
  const capNote = quarters.length - start > keep.length ? `history truncated to last ${MAX_QTRS} continuous quarters (full XBRL run: ${quarters.length - start})` : null;
  if (keep.length < 12) return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'skipped', reason: `only ${keep.length} continuous quarterly periods found (EDGAR XBRL)`, failures };
  return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'ok', quarters: keep, capNote, failures };
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
function checkCoverage(tk, quarters) {
  const issues = [];
  for (let i = 1; i < quarters.length; i++) {
    const d = days(quarters[i - 1].end, quarters[i].end);
    if (d < 80 || d > 105) issues.push(`${tk}: gap ${quarters[i - 1].end} → ${quarters[i].end} (${d}d)`);
  }
  return issues;
}

// ---- write guard: never let a partial run overwrite a fuller file ----
function guard(prev, companies, failures) {
  const prevCount = prev ? Object.keys(prev.companies || {}).length : null;
  const newCount = Object.keys(companies).length;
  const floor = Math.max(prevCount ?? 0, 10);
  if (newCount < floor) {
    throw new Error(`write guard: refusing to write profit.json with ${newCount} companies (floor=${floor}` +
      (prevCount != null ? `, previous file had ${prevCount}` : '') + '). A partial run would destroy full data.');
  }
  for (const [tk, c] of Object.entries(companies)) {
    if (!c.quarters || c.quarters.length < 12) {
      throw new Error(`write guard: ${tk} has only ${c.quarters?.length ?? 0} quarters (<12) — refusing to write.`);
    }
    // calendar continuity: sorted quarter ends must be 80–100 days apart; any gap >100d is a hole
    for (let i = 1; i < c.quarters.length; i++) {
      const d = days(c.quarters[i - 1].end, c.quarters[i].end);
      if (d < 80 || d > 100) {
        throw new Error(`write guard: ${tk} calendar gap ${c.quarters[i - 1].end} → ${c.quarters[i].end} (${d}d, allowed 80–100) — refusing to write a holed file.`);
      }
    }
  }
  if (failures.length && process.env.ALLOW_FAILURES !== '1') {
    // metric-missing failures mean a company was dropped — surface but allow (skipped[] carries them)
    for (const f of failures) console.log('GUARD-NOTE failure recorded: ' + JSON.stringify(f));
  }
}

const results = [];
for (const c of COMPANIES) {
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
    companies[r.ticker] = { name: r.name, cik: r.cik, currency: 'USD-M', quarters: r.quarters };
    if (r.capNote) notes.push(`${r.ticker}: ${r.capNote}`);
    for (const i of checkCompany(r.ticker, r.quarters)) notes.push(`${r.ticker}: consistency — ${i}`);
    for (const i of checkCoverage(r.ticker, r.quarters)) notes.push(`${r.ticker}: coverage — ${i}`);
  } else {
    failures.push({ ticker: r.ticker, kind: r.status, reason: r.reason });
  }
}
const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join('data', 'profit.json'), 'utf8')); } catch { return null; } })();
guard(prev, companies, failures);

const out = {
  updated: new Date().toISOString(),
  source: 'SEC EDGAR XBRL companyfacts API (US-GAAP tags; quarterly periods 85-100d; fiscal Q4 derived as FY minus Q1-Q3 where the 10-K has no quarterly facts)',
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
