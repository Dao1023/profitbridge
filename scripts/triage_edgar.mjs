// triage_edgar.mjs — one-off: classify candidate tickers Q (10-Q quarterly XBRL) / A (20-F annual XBRL) / S (no EDGAR XBRL)
import fs from 'node:fs';

const UA = 'ProfitBridgeDashboard research contact@example.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url) {
  let err;
  for (let a = 1; a <= 5; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { err = e; if (a < 5) await sleep(1500 * a); }
  }
  throw err;
}

const TICKERS = ['MU','V','PLTR','CSCO','KO','DELL','NFLX','IBM','ARM','QCOM','MCD','SBUX','ADBE','MSI','SPOT','HPQ','CRWV','U','DUOL','NXPI','STM','TSM','ASML','SPCX','TCEHY','SONY','BABA','BIDU','TCOM','JD','PDD','LI','BILI','WB','ZH','XNET','TME','LKNCY','DIDIY','XIACF'];

const map = await getJSON('https://www.sec.gov/files/company_tickers.json');
const byTicker = {};
for (const e of Object.values(map)) byTicker[e.ticker.toUpperCase()] = { cik: e.cik_str, title: e.title };

const out = [];
for (const t of TICKERS) {
  const hit = byTicker[t];
  if (!hit) { out.push({ ticker: t, cls: 'S', reason: 'no ticker→CIK match in SEC company_tickers.json' }); console.log(t, 'S no-CIK'); continue; }
  try {
    const sub = await getJSON(`https://data.sec.gov/submissions/CIK${String(hit.cik).padStart(10, '0')}.json`);
    const forms = sub.filings.recent.form;
    const n10Q = forms.filter(f => f === '10-Q').length;
    const n10K = forms.filter(f => f === '10-K').length;
    const n20F = forms.filter(f => f === '20-F').length;
    // check XBRL taxonomy in companyfacts
    const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(hit.cik).padStart(10, '0')}.json`);
    const tax = Object.keys(facts.facts || {});
    const hasUS = tax.includes('us-gaap'), hasIFRS = tax.includes('ifrs-full');
    let cls, reason = '';
    if (hasUS && n10Q > 0) { cls = 'Q'; }
    else if ((hasIFRS || hasUS) && n20F > 0 && n10Q === 0) { cls = 'A'; reason = `${n20F} 20-F, taxonomy=${tax.join('+')}`; }
    else { cls = 'S'; reason = `forms 10-Q=${n10Q} 10-K=${n10K} 20-F=${n20F}, taxonomy=${tax.join('+') || 'none'}`; }
    out.push({ ticker: t, cls, cik: hit.cik, name: sub.name, reason, n10Q, n10K, n20F });
    console.log(t, cls, hit.cik, sub.name, reason || `10-Q x${n10Q}`);
  } catch (e) {
    out.push({ ticker: t, cls: 'ERR', cik: hit.cik, name: hit.title, reason: e.message });
    console.log(t, 'ERR', hit.cik, e.message);
  }
  await sleep(400);
}
fs.writeFileSync('scripts/triage_result.json', JSON.stringify(out, null, 1));
console.log('done', out.length);
