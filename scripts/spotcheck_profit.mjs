// spotcheck_profit.mjs — one-off: spot-check profit.json quarters against raw companyfacts XBRL
import fs from 'node:fs';
const UA = { headers: { 'User-Agent': 'ProfitBridge research contact@example.com' } };
const p = JSON.parse(fs.readFileSync('data/profit.json', 'utf8'));
const checks = [['KO', '2026-04-03'], ['BABA', '2026-03-31'], ['MU', '2026-09-03'], ['ASML', '2025-12-31'], ['SPOT', '2025-12-31'], ['TME', '2024-12-31']];
for (const [tk, end] of checks) {
  const c = p.companies[tk]; const q = c.quarters.find(x => x.end === end);
  console.log('---', tk, end, 'filed:', JSON.stringify(q), c.currency);
  const f = await (await fetch('https://data.sec.gov/api/xbrl/companyfacts/CIK' + String(c.cik).padStart(10, '0') + '.json', UA)).json();
  const cur = (c.currency || 'USD-M').slice(0, 3);
  for (const tax of ['us-gaap', 'ifrs-full']) for (const tag of ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenue', 'RevenueFromContractsWithCustomers', 'NetIncomeLoss', 'ProfitLoss']) {
    const arr = f.facts[tax]?.[tag]?.units?.[cur]; if (!arr) continue;
    const hit = arr.filter(x => x.end === end && (new Date(x.end) - new Date(x.start)) / 864e5 >= (c.frequency === 'annual' ? 300 : 85));
    for (const h of hit.slice(0, 3)) console.log('  ', tax + ':' + tag, h.val / 1e6, h.form);
  }
  await new Promise(r => setTimeout(r, 600));
}
