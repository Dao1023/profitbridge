#!/usr/bin/env node
// fetch_cmc_variants.mjs — resolve the 18 misses via alternate CMC keys.
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const DIR = 'data/logos/_cmc';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function buf(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://companiesmarketcap.com/' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length >= 300 ? b : null;
  } catch { return null; }
}
const VARIANTS = {
  'GOOGL': ['GOOG'],
  '00700.HK': ['0700.HK', 'TENCENT', 'TCEHY', '700.HK'],
  '00941.HK': ['0941.HK', 'CHINA-MOBILE', 'CHL', '941.HK'],
  '01398.HK': ['1398.HK', 'IDCBY', '398.HK'],
  '03968.HK': ['3968.HK', 'CIHKY', '968.HK'],
  '00992.HK': ['0992.HK', 'LNVGY', 'LENOVO', '992.HK'],
  '03690.HK': ['3690.HK', 'MEITUAN', '690.HK'],
  '00728.HK': ['0728.HK', 'CHINA-TELECOM', 'CHA', '728.HK'],
  '00981.HK': ['0981.HK', 'SMIC', '981.HK'],
  '00762.HK': ['0762.HK', 'CHINA-UNICOM', 'CHU', '762.HK'],
  '01024.HK': ['1024.HK', 'KUAISHOU', '24.HK'],
  '02097.HK': ['2097.HK', 'MIXUE', '97.HK'],
  '03888.HK': ['3888.HK', 'KINGSOFT', '888.HK'],
  '00151.HK': ['0151.HK', 'WANT-WANT', 'WANT-WANT-CHINA', '151.HK'],
  '688981.SS': ['SMIC', '0981.HK'],
  '2330.TW': ['TSM', '2330.TW'],
  'HUAWEI': ['HUAWEI'],
  'LEGO': ['LEGO', 'LEGO-GROUP'],
};
for (const [tk, vs] of Object.entries(VARIANTS)) {
  let ok = null;
  for (const v of vs) {
    const b = await buf(`https://companiesmarketcap.com/img/company-logos/256/${encodeURIComponent(v)}.webp`);
    if (b) { fs.writeFileSync(`${DIR}/${tk}.webp`, b); ok = v + ' ' + b.length; break; }
    await sleep(120);
  }
  console.log(tk, ok ? 'OK ' + ok : 'STILL-MISS');
}
