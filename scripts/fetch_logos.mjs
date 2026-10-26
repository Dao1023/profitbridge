// fetch_logos.mjs — download logos (financialmodelingprep image-stock; clearbit is unreachable
// from this network); failures fall back to the existing onerror monogram in app.js.
// Note: FMP serves some tickers as white-on-transparent PNGs (IBM, V, LI were affected)
// which vanish on the app's light background. WHITE_LOGOS lists manual replacements
// (rasterized from Wikimedia via Special:FilePath) that must not be re-overwritten.
// HK/KS/SS/SZ/TW/SW/PA tickers are NOT fetched from FMP (it 404s on them); their logos
// were manually sourced (Wikimedia Commons / zh·en Wikipedia local files / icon.horse
// brand favicons), square-padded to 1:1, and committed as data/logos/<ticker>.png —
// same naming convention, so the existsSync guard below skips them.
//
// PRIMARY SOURCE (2026-10 rework, full watchlist replacement): companiesmarketcap.com
// watchlist-table logos — https://companiesmarketcap.com/img/company-logos/64/<KEY>.webp
// (the SAME 64px square icon art the site renders in its watchlist table; NOTE the
// /128//192//256/ sizes of the same key are DIFFERENT horizontal wordmark artwork, so
// always re-fetch from /64/). KEY = CMC symbol: US ticker; HK = 0700.HK style; Tencent =
// TCEHY; Xiaomi ADR = XIACF; 2330.TW -> TSM; SMIC-A 688981.SS -> 0981.HK. HUAWEI/LEGO are
// private (not on CMC) and keep their manual art. Future maintenance: fetch /64/ first.
import fs from 'node:fs';
import path from 'node:path';
const REGISTRY = JSON.parse(fs.readFileSync('data/companies.json', 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, fail = [];
const WHITE_LOGOS = new Set(['IBM', 'V', 'LI']); // manually fixed white-on-transparent FMP images
for (const c of Object.values(REGISTRY)) {
  const dest = path.join('data', 'logos', `${c.ticker}.png`);
  if (fs.existsSync(dest) || WHITE_LOGOS.has(c.ticker)) continue;
  try {
    const res = await fetch(`https://financialmodelingprep.com/image-stock/${c.ticker}.png`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) throw new Error('too small');
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (e) { fail.push(c.ticker + ': ' + e.message); }
  await sleep(200);
}
console.log('ok', ok, 'fail:', fail.join('; ') || 'none');
