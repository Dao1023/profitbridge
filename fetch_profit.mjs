// fetch_profit.mjs — pull real GAAP quarterly data from SEC EDGAR XBRL companyfacts API.
// Output: data/profit.json
// Usage: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=... node fetch_profit.mjs
import fs from 'node:fs';
import path from 'node:path';

const UA = 'ProfitBridgeDashboard research contact@example.com';
// registry: ticker/cik/names come from data/companies.json; extra fetch-only companies stay inline
const REGISTRY = JSON.parse(fs.readFileSync(path.join('data', 'companies.json'), 'utf8'));
const EXTRA = [
  { ticker: 'TSM', cik: 1046179, name: 'Taiwan Semiconductor Manufacturing Co., Ltd.' },
  { ticker: 'AVGO', cik: 1730168, name: 'Broadcom Inc.' },
];
const COMPANIES = [...REGISTRY.map(c => ({ ticker: c.ticker, cik: c.cik, name: c.nameEn })), ...EXTRA];

// tag candidates, first that exists wins, per metric
const TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  gross: ['GrossProfit'],
  opInc: ['OperatingIncomeLoss'],
  netInc: ['NetIncomeLoss'],
  rd: ['ResearchAndDevelopmentExpense'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  tax: ['IncomeTaxExpenseBenefit'],
};

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

function days(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

// Extract quarterly (duration 85–100 days) USD facts for a list of tags; choose the tag whose
// coverage extends to the latest period end (stale legacy tags stop being filed), tie-break by count.
function pickQuarterly(facts, tagList) {
  let best = null;
  for (const tag of tagList) {
    const node = facts?.facts?.['us-gaap']?.[tag];
    if (!node) continue;
    const units = node.units?.USD;
    if (!Array.isArray(units)) continue;
    const byEnd = new Map();
    for (const f of units) {
      if (!f.start || !f.end) continue;
      const d = days(f.start, f.end);
      if (d < 85 || d > 100) continue; // quarterly periods only
      const prev = byEnd.get(f.end);
      // prefer facts from 10-Q/10-K forms, then most recently filed
      const score = x => (x.form === '10-Q' ? 2 : x.form === '10-K' ? 1 : 0) + (x.fp === 'Q' ? 0.5 : 0);
      if (!prev || score(f) > score(prev) || (score(f) === score(prev) && f.fy > prev.fy)) byEnd.set(f.end, f);
    }
    if (!byEnd.size) continue;
    const maxEnd = [...byEnd.keys()].sort().at(-1);
    if (!best || maxEnd > best.maxEnd || (maxEnd === best.maxEnd && byEnd.size > best.map.size)) {
      best = { tag, map: byEnd, maxEnd };
    }
  }
  return best;
}

function dedupeCalendar(quarters) {
  // A 10-K annual period is filtered by day window already; but overlapping quarter ends can
  // only be duplicates of the same fiscal quarter — keep unique by end date.
  return quarters;
}

async function fetchCompany(c) {
  const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(c.cik).padStart(10, '0')}.json`);
  const entityName = facts.entityName || c.name;
  const picked = {};
  for (const [key, tags] of Object.entries(TAGS)) {
    picked[key] = pickQuarterly(facts, tags);
  }
  if (!picked.revenue || !picked.netInc) return { ...c, status: 'skipped', reason: 'missing revenue/net income XBRL data' };

  // union of all period ends having revenue
  const ends = [...picked.revenue.map.keys()].sort();
  const quarters = [];
  for (const end of ends) {
    const q = { end };
    for (const [k, p] of Object.entries(picked)) {
      if (p?.map.has(end)) q[k] = Math.round(p.map.get(end).val / 1e6 * 10) / 10; // USD → $M
    }
    if (q.revenue == null || q.netInc == null) continue;
    quarters.push(q);
  }
  // require core metrics on the quarter; keep last 12, require >=8
  const keep = quarters.slice(-12);
  if (keep.length < 8) return { ...c, status: 'skipped', reason: `only ${keep.length} quarterly periods found` };
  return { ticker: c.ticker, cik: c.cik, name: entityName, status: 'ok', quarters: keep };
}

const results = [];
for (const c of COMPANIES) {
  process.stdout.write(`fetching ${c.ticker} ... `);
  try {
    const r = await fetchCompany(c);
    console.log(r.status === 'ok' ? `${r.quarters.length} quarters` : `SKIPPED (${r.reason})`);
    results.push(r);
  } catch (e) {
    console.log('ERROR ' + e.message);
    results.push({ ticker: c.ticker, cik: c.cik, name: c.name, status: 'error', reason: e.message });
  }
  await new Promise(r => setTimeout(r, 350)); // SEC rate limit ~10 req/s, be polite
}

const ok = results.filter(r => r.status === 'ok');
const companies = {};
for (const r of ok) {
  companies[r.ticker] = { name: r.name, cik: r.cik, currency: 'USD-M', quarters: r.quarters };
}
const out = {
  updated: new Date().toISOString(),
  source: 'SEC EDGAR XBRL companyfacts API (US-GAAP tags, quarterly periods 85-100 days)',
  sourceUrl: 'https://data.sec.gov/api/xbrl/companyfacts/',
  companies,
  skipped: results.filter(r => r.status !== 'ok').map(r => ({ ticker: r.ticker, status: r.status, reason: r.reason })),
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'profit.json'), JSON.stringify(out, null, 2));
// file:// fallback payload: double-clicking index.html without a server still works
fs.writeFileSync(path.join('data', 'profit.json.js'),
  'window.__PROFIT_DATA = ' + JSON.stringify(out) + ';\n');
console.log(`\nwrote data/profit.json: ${ok.length} companies, skipped: ${out.skipped.map(s => s.ticker + '(' + s.status + ')').join(', ') || 'none'}`);
