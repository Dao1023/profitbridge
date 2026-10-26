#!/usr/bin/env node
// fetch_cmc_all.mjs — full watchlist logo replacement from companiesmarketcap CDN (256px square webp).
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const DIR = 'data/logos/_cmc';
fs.mkdirSync(DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = JSON.parse(fs.readFileSync('data/companies.json', 'utf8'));
const rows = Array.isArray(list) ? list : (list.companies || Object.values(list));
const tickers = rows.map(c => c.ticker || c.symbol);
const REPORT = [];
async function buf(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://companiesmarketcap.com/' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length >= 300 ? b : null;
  } catch { return null; }
}
let hit = 0;
for (const t of tickers) {
  const b = await buf(`https://companiesmarketcap.com/img/company-logos/256/${encodeURIComponent(t)}.webp`);
  if (b) { fs.writeFileSync(`${DIR}/${t}.webp`, b); hit++; REPORT.push([t, 'OK', b.length]); }
  else REPORT.push([t, 'MISS', 0]);
  await sleep(150);
}
for (const [t, s, n] of REPORT) if (s === 'MISS') console.log(t, s);
console.log(`hit ${hit}/${tickers.length}`);
