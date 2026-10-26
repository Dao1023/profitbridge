// probe_tsm.mjs — TSM ifrs-full coverage + units
const UA = 'ProfitBridgeDashboard research contact@example.com';
async function getJSON(url) {
  for (let a = 1; a <= 6; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (a === 6) throw e; await new Promise(r => setTimeout(r, 1200 * a)); }
  }
}
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const facts = await getJSON('https://data.sec.gov/api/xbrl/companyfacts/CIK0001046179.json');
for (const tag of ['Revenue', 'RevenueFromContractsWithCustomers', 'ProfitLossAttributableToOwnersOfParent', 'ProfitLoss', 'GrossProfit']) {
  const node = facts.facts?.['ifrs-full']?.[tag];
  if (!node) { console.log(tag, ': absent'); continue; }
  for (const [unit, arr] of Object.entries(node.units)) {
    const q = arr.filter(f => f.start && f.end && days(f.start, f.end) >= 80 && days(f.start, f.end) <= 100);
    const ann = arr.filter(f => f.start && f.end && days(f.start, f.end) > 300 && days(f.start, f.end) < 400);
    const ends = [...new Set(q.map(f => f.end))].sort();
    const aEnds = [...new Set(ann.map(f => f.end))].sort();
    console.log(`${tag} [${unit}] q:${q.length}f/${ends.length}ends ${ends.join(' ')}`);
    console.log(`   annual(${ann.length}): ${aEnds.join(' ')}`);
  }
}
