// probe_profit.mjs — diagnose why fetch_profit.mjs drops quarters. Read-only.
import fs from 'node:fs';

const UA = 'ProfitBridgeDashboard research contact@example.com';
const COMPANIES = [
  { t: 'GOOGL', cik: 1652044 },
  { t: 'TSM', cik: 1046179 },
  { t: 'AVGO', cik: 1730168 },
  { t: 'NVDA', cik: 1045810 },
  { t: 'META', cik: 1326801 },
  { t: 'AMZN', cik: 1018724 },
];
const REV_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax'];

async function getJSON(url) {
  for (let a = 1; a <= 6; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (a === 6) throw e; await new Promise(r => setTimeout(r, 1200 * a)); }
  }
}
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

for (const { t, cik } of COMPANIES) {
  const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`);
  console.log(`\n=== ${t} namespaces: ${Object.keys(facts.facts).join(', ')}`);
  for (const ns of Object.keys(facts.facts)) {
    const tags = Object.keys(facts.facts[ns]);
    const revish = tags.filter(x => /revenue/i.test(x));
    console.log(`  ${ns}: ${tags.length} tags; revenue-ish: ${revish.join(', ')}`);
  }
  for (const ns of ['us-gaap', 'ifrs-full']) {
    for (const tag of REV_TAGS) {
      const node = facts.facts?.[ns]?.[tag];
      if (!node) continue;
      const units = Object.entries(node.units || {});
      for (const [unit, arr] of units) {
        const qs = arr.filter(f => f.start && f.end && days(f.start, f.end) >= 85 && days(f.end, f.end + '') >= 0 && days(f.start, f.end) <= 100);
        const ends = [...new Set(qs.map(f => f.end))].sort();
        const annual = arr.filter(f => f.start && f.end && days(f.start, f.end) > 300 && days(f.start, f.end) < 400);
        const aEnds = [...new Set(annual.map(f => f.end))].sort();
        console.log(`  ${ns}:${tag} [${unit}] q(${qs.length} facts, ${ends.length} ends): ${ends[0]}..${ends.at(-1)} => ${ends.join(' ')}`);
        console.log(`      annual ends: ${aEnds.join(' ')}`);
      }
    }
  }
  await new Promise(r => setTimeout(r, 400));
}
