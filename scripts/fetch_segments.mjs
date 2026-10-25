// fetch_segments.mjs — quarterly revenue-by-segment from SEC EDGAR "FilingSummary.xml → R files".
// For each company: list recent 10-Q/10-K filings (data.sec.gov submissions), fetch each filing's
// FilingSummary.xml (www.sec.gov), locate the segment/disaggregation report by ShortName regex,
// parse the R*.htm table (3-months columns; fall back to YTD-minus-prior-quarters), validate the
// segment sum against merged revenue from data/profit.json (warn if off by >0.5%).
// Output: data/segments.json — { updated, source, sourceUrl, companies: { TK: { quarters: { end: [ {name,value,children?} ] } }, degraded?: reason } }
// Usage: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=... node scripts/fetch_segments.mjs
import fs from 'node:fs';
import path from 'node:path';

const UA = 'ProfitBridgeDashboard research contact@example.com';
const profit = JSON.parse(fs.readFileSync(path.join('data', 'profit.json'), 'utf8'));
const TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'ORCL', 'AMD', 'INTC'];

// per-ticker report discovery (tried in order) + row-name → canonical segment mapping.
// map: [regex, canonicalName, parentName?] — several raw rows may fold into one canonical name.
const CONFIG = {
  NVDA: {
    reports: [/market platform/i, /segment/i],
    map: [
      [/^data center$/i, 'Data Center'],
      [/^hyperscale/i, 'Hyperscale', 'Data Center'],
      [/^ai clouds/i, 'AI Clouds, Industrial & Enterprise', 'Data Center'],
      [/^edge computing/i, 'Edge Computing'],
      [/^gaming/i, 'Gaming'],
      [/^professional visualization/i, 'Professional Visualization'],
      [/^automotive/i, 'Automotive'],
      [/^oem/i, 'OEM & Other'],
    ],
  },
  AAPL: {
    reports: [/disaggregated net sales/i, /products and services performance/i, /segment.*details/i],
    map: [
      [/^iphone/i, 'iPhone'], [/^mac$/i, 'Mac'], [/^ipad/i, 'iPad'],
      [/^wearables/i, 'Wearables, Home and Accessories'], [/^services/i, 'Services'],
      [/^americas|^europe|^greater china|^japan|^rest of asia pacific/i, null], // geographic rows ignored
    ],
  },
  MSFT: {
    reports: [/segment.*(revenue|details)/i, /segment/i],
    map: [
      [/intelligent cloud/i, 'Intelligent Cloud'],
      [/productivity and business processes/i, 'Productivity and Business Processes'],
      [/more personal computing/i, 'More Personal Computing'],
    ],
  },
  GOOGL: {
    reports: [/disaggregated revenues/i, /revenues.*details/i, /segment/i],
    map: [
      [/google search & other|google search & other/i, 'Google Search & other'],
      [/youtube ads/i, 'YouTube ads'],
      [/google network/i, 'Google Network'],
      [/google subscriptions, platforms, and devices|google other/i, 'Google subscriptions, platforms, and devices'],
      [/google services total|^google services$/i, null], // parent aggregate, recomputed client-side
      [/^google cloud$/i, 'Google Cloud'],
      [/^other bets$/i, 'Other Bets'],
      [/hedging/i, null],
      [/^total revenues/i, null],
    ],
  },
  AMZN: {
    reports: [/segment/i],
    map: [
      [/^north america/i, 'North America'],
      [/^international/i, 'International'],
      [/^aws$|aws segment|amazon web services/i, 'AWS'],
    ],
  },
  META: {
    reports: [/segment/i],
    map: [
      [/family of apps|foa/i, 'Family of Apps'],
      [/reality labs|rl/i, 'Reality Labs'],
    ],
  },
  TSLA: {
    reports: [/total revenues and gross profit by reportable segment/i, /segment/i, /revenue recognition/i],
    map: [
      [/^automotive segment$/i, 'Automotive'],
      [/^automotive sales/i, 'Automotive'], [/automotive regulatory credits/i, 'Automotive'],
      [/^automotive leasing/i, 'Automotive'], [/^total automotive/i, null],
      [/^energy generation and storage segment$/i, 'Energy generation and storage'],
      [/energy generation and storage/i, 'Energy generation and storage'],
      [/^services and other segment$/i, 'Services and other'],
      [/^services and other/i, 'Services and other'],
    ],
  },
  ORCL: {
    // Oracle disclosed reportable-segment revenue (Cloud and Software / Hardware / Services)
    // only from FY26; older filings' income-statement lines don't sum to revenue → skip them.
    reports: [/segment information \(details\)/i],
    map: [
      [/cloud and software|cloud and license/i, 'Cloud and Software'],
      [/\bhardware\b/i, 'Hardware'],
      [/\bservices\b/i, 'Services'],
    ],
  },
  AMD: {
    reports: [/segment/i],
    map: [
      [/^client and gaming (client|gaming)$/i, null], // sub-rows duplicate the group total
      [/^client and gaming/i, 'Client and Gaming'],
      [/^data center/i, 'Data Center'],
      [/^gaming/i, 'Gaming'],
      [/^client/i, 'Client'],
      [/^embedded/i, 'Embedded'],
      [/^all other/i, 'All Other'],
    ],
  },
  INTC: {
    reports: [/segment/i],
    map: [
      [/client computing group|ccg/i, 'Client Computing Group (CCG)'],
      [/data center and ai|dcai/i, 'Data Center and AI (DCAI)'],
      [/network and edge|nex/i, 'Network and Edge (NEX)'],
      [/^altera/i, 'Altera'], [/^mobileye/i, 'Mobileye'],
      [/intel foundry|foundry services/i, 'Intel Foundry'],
      [/^all other|^other/i, 'All Other'],
    ],
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE = path.join('tmp_r', 'segcache');
function cacheGet(key) {
  try { return fs.readFileSync(path.join(CACHE, key), 'utf8'); } catch { return null; }
}
function cachePut(key, text) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, key), text);
}
async function getText(url, tries = 6, cacheKey = null) {
  if (cacheKey) { const hit = cacheGet(cacheKey); if (hit != null) return hit; }
  let err;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      const text = await res.text();
      if (cacheKey) cachePut(cacheKey, text);
      return text;
    } catch (e) { err = e; if (a < tries) await sleep(1200 * a); }
  }
  throw err;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function parseNum(s) {
  s = s.replace(/\$|,/g, '').replace(/\u2212/g, '-').trim();
  if (!s || s === '—' || s === '-') return null;
  const neg = /\(.*\)/.test(s);
  const v = Number(s.replace(/[()]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
function parseDate(s) {
  const m = s.match(/([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mon = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }[m[1]];
  return mon == null ? null : `${m[3]}-${String(mon + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// expand <td>/<th> cells honouring colspan; returns array of strings
function rowCells(tr) {
  const out = [];
  for (const m of tr.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const cs = Number((m[2].match(/colspan="?(\d+)"?/i) || [])[1] || 1);
    const text = decode(m[3].replace(/<[^>]+>/g, ' '));
    for (let i = 0; i < cs; i++) out.push(text);
  }
  return out;
}

// R-file tables stack a name-only row ("Data Center", all cells blank) above the numeric
// "Revenue" row; the numeric row's onclick/href also carries the XBRL dimension member
// (e.g. srt_ProductOrServiceAxis=nvda_DataCenterMember). Each numeric row resolves to
// pendingLabel (display name), falling back to the humanized member; boilerplate element-name
// rows ("... [Line Items]") are skipped.
const BOILER = /\[line items\]|\[axis\]|\[member\]|entity common stock|consolidated entities/i;
function humanize(member) {
  return member.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
}
// Returns { periods: [{idx, months, end}], rows: [{own, pending, member, vals}] } —
// name resolution against the ticker map happens later in resolveName/mapRows.
function parseRTable(html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  let best = null;
  for (const tbl of tables) {
    const trs = [...tbl.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    // find duration header row ("3 Months Ended") and the date row after it
    let durIdx = -1;
    trs.forEach((tr, i) => { if (rowCells(tr).some(c => /months?\s+ended/i.test(c))) durIdx = i; });
    if (durIdx < 0 || durIdx + 1 >= trs.length) continue;
    const durCells = rowCells(trs[durIdx]);
    const dateCells = rowCells(trs[durIdx + 1]);
    // duration header row includes the table-title cell; date row starts directly at the first
    // value column → shift dates by (durCells.length - dateCells.length)
    const off = Math.max(0, durCells.length - dateCells.length);
    const periods = [];
    for (let i = 0; i < durCells.length; i++) {
      const dm = durCells[i].match(/(\d+)\s+months?\s+ended/i);
      const end = dm ? parseDate(dateCells[i - off] || '') : null;
      if (dm && end) periods.push({ idx: i, months: Number(dm[1]), end });
    }
    if (!periods.length) continue;
    const rows = [];
    let pending = null;
    for (const tr of trs.slice(durIdx + 2)) {
      const cells = rowCells(tr);
      if (!cells.length) continue;
      const label = decode(cells[0]);
      const member = (tr.match(/[A-Za-z0-9]+Axis=([A-Za-z0-9]+)Member/) || [])[1];
      const vals = periods.map(p => parseNum(cells[p.idx] ?? ''));
      const hasVal = vals.some(v => v != null);
      if (!hasVal) {
        if (label && !/\[line items\]/i.test(label)) pending = label; // [Member]/[Axis] rows still carry the segment name
        continue;
      }
      const own = label && !BOILER.test(label) && !/^revenues?$/i.test(label) ? label : null;
      rows.push({ own, pending, member: member ? humanize(member) : null, vals });
      pending = null;
    }
    if (!best || rows.length > best.rows.length) best = { periods, rows };
  }
  return best;
}

async function filingRFiles(cik10, accn) {
  const xml = await getText(`https://www.sec.gov/Archives/edgar/data/${cik10}/${accn}/FilingSummary.xml`, 6, `fs_${cik10}_${accn}.xml`);
  const reports = [];
  for (const m of xml.matchAll(/<Report[\s>]([\s\S]*?)<\/Report>/g)) {
    const b = m[1];
    const name = (b.match(/<ShortName>([\s\S]*?)<\/ShortName>/) || [])[1];
    const file = (b.match(/<HtmlFileName>([\s\S]*?)<\/HtmlFileName>/) || [])[1];
    if (name && file && /\.htm$/i.test(file.trim())) reports.push({ name: decode(name), file: file.trim() });
  }
  return reports;
}

// Generic revenue row labels repeat once per segment group ("Net sales", "Total net
// revenue", "Revenue from contract with customers"); the segment's identity lives in the
// pending (dimension-member) row above. Prefer the row's own label only when it is
// non-generic (or already map-matched); otherwise let the pending segment name take over,
// so income-statement rows (Operating income, Costs and Expenses) can't swallow the pending.
const GENERIC = /^(net sales|total net revenue|total revenues?|revenues? from contract with customers|total|segment revenues)$/i;
// expense/profit rows are never segment revenue — drop them before any mapping
const NONREV = /expenses?|operating income|cost of (sales|revenues)|gross profit|margin|depreciation|share-based/i;
function cleanPending(p) {
  return p ? p.replace(/\[(member|axis)\]/gi, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim() : null;
}
function resolveName(row, mapCfg) {
  const matchMap = (s) => mapCfg.some(([re, name]) => name != null && re.test(s));
  const pend = cleanPending(row.pending);
  if (row.own && matchMap(row.own)) return row.own;
  const ownGeneric = !row.own || GENERIC.test(row.own);
  if (ownGeneric && pend && matchMap(pend)) return pend;
  return row.own || pend || row.member || 'Total Revenue';
}

function mapRows(parsed, mapCfg) {
  // returns { [canonicalName]: {value, children: Map(parent→{value})} } for one column index
  return (colIdx) => {
    const tops = new Map(), childAgg = new Map(); // parent -> Map(child -> value)
    for (const row of parsed.rows) {
      const v = row.vals[colIdx];
      if (v == null) continue;
      if (row.own && NONREV.test(row.own)) continue;
      const label = resolveName(row, mapCfg);
      let hit = null;
      for (const [re, name, parent] of mapCfg) {
        if (re.test(label)) { hit = { name, parent }; break; }
      }
      if (!hit || hit.name == null) continue;
      if (hit.parent) {
        if (!childAgg.has(hit.parent)) childAgg.set(hit.parent, new Map());
        const cm = childAgg.get(hit.parent);
        cm.set(hit.name, (cm.get(hit.name) || 0) + v);
      } else {
        tops.set(hit.name, (tops.get(hit.name) || 0) + v);
      }
    }
    // parents with their own top row keep it (children attach to it); parents that appear
    // only as child containers get a synthesized top whose value is the children sum
    for (const [parent, cm] of childAgg) {
      if (!tops.has(parent)) tops.set(parent, [...cm.values()].reduce((s, v) => s + v, 0));
    }
    return { tops, childAgg };
  };
}

async function fetchTicker(tk) {
  const meta = profit.companies[tk];
  const cik10 = String(meta.cik).padStart(10, '0');
  const cfg = CONFIG[tk];
  const sub = JSON.parse(await getText(`https://data.sec.gov/submissions/CIK${cik10}.json`, 3, `sub_${cik10}.json`));
  const f = sub.filings.recent;
  const filings = [];
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] !== '10-Q' && f.form[i] !== '10-K') continue;
    filings.push({ accn: f.accessionNumber[i].replace(/-/g, ''), form: f.form[i], end: f.reportDate ? f.reportDate[i] : null });
    if (filings.length >= 20) break; // enough 10-Qs + 10-Ks to cover 12 quarters (Q4 via 10-K)
  }
  const targetEnds = meta.quarters.map(q => q.end);
  const revByEnd = Object.fromEntries(meta.quarters.map(q => [q.end, q.revenue]));
  const near = (end) => targetEnds.find(te => Math.abs(new Date(te) - new Date(end)) <= 5 * 86400000) || null;
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  // quarter values collected as raw filing units; per-column {end, months, vals}
  const collected = new Map(); // te -> { tops: Map, childAgg: Map, src }
  const ytds = [];             // { end, months, tops, childAgg }
  let bestParsed = null, reportUsed = null;

  for (const fl of filings) {
    let reports;
    try { reports = await filingRFiles(cik10, fl.accn); }
    catch (e) { console.log(`  ${tk}: FilingSummary failed for ${fl.accn}: ${e.message}`); continue; }
    const candidates = [];
    for (const re of cfg.reports) for (const r of reports) if (re.test(r.name)) candidates.push(r);
    let chosen = null, chosenParsed = null, chosenScore = -1;
    for (const cand of candidates) {
      let html;
      try { html = await getText(`https://www.sec.gov/Archives/edgar/data/${cik10}/${fl.accn}/${cand.file}`, 4, `r_${cik10}_${fl.accn}_${cand.file}`); }
      catch (e) { continue; }
      const parsed = parseRTable(html);
      if (!parsed) continue;
      // score: uncollected target quarters hit by 3-month columns, weighted by recency,
      // plus mapped-row count so real segment tables beat "(Narrative)" tables
      let score = 0;
      const mapped = parsed.rows.filter(r => {
        const n = resolveName(r, cfg.map);
        return n && n !== 'Total Revenue' && cfg.map.some(([re, name]) => name != null && re.test(n));
      }).length;
      parsed.periods.forEach((p, i) => {
        if (p.months !== 3) return;
        const te = near(p.end);
        if (te && !collected.has(te)) score += 1 + (te === targetEnds.at(-1) ? 5 : 0);
      });
      score += Math.min(mapped, 10) * 0.01;
      if (score > chosenScore) { chosenScore = score; chosen = cand; chosenParsed = parsed; }
    }
    if (!chosen || chosenScore <= 0) continue;
    if (process.env.DEBUG) console.log(`  ${tk} ${fl.form} ${fl.accn}: chose "${chosen.name}" score=${chosenScore} periods=${JSON.stringify(chosenParsed.periods)}`);
    reportUsed = chosen.name;
    const mapper = mapRows(chosenParsed, cfg.map);
    chosenParsed.periods.forEach((p, i) => {
      const te = near(p.end);
      if (!te) return;
      if (p.months === 3) {
        if (collected.has(te)) return; // newer filing wins
        const { tops, childAgg } = mapper(i);
        if (tops.size >= 2) collected.set(te, { tops, childAgg, src: `${fl.form} ${fl.accn}` }); // >=2 real segments; rejects geographic/misc tables
      } else if (p.months >= 9 || p.months === 6) {
        const { tops, childAgg } = mapper(i);
        if (tops.size >= 2) ytds.push({ end: te, months: p.months, tops, childAgg, src: `${fl.form} ${fl.accn}` });
      }
    });
  }

  // derive quarters missing a 3-month column from YTD minus prior quarters in the same span
  for (const te of targetEnds) {
    if (collected.has(te)) continue;
    const y = ytds.find(y => y.end === te);
    if (!y) continue;
    const priors = targetEnds.filter(x => { const d = dayDiff(x, te); return d > 0 && d < y.months * 31 + 10 && collected.has(x); });
    const spanOK = priors.length === y.months / 3 - 1;
    if (!spanOK) continue;
    const sub = (map, neg) => { const out = new Map(); for (const [k, v] of map) out.set(k, (neg.get(k) || 0) - v); return out; };
    let tops = y.tops, childAgg = new Map([...y.childAgg].map(([p, cm]) => [p, new Map(cm)]));
    for (const pe of priors) {
      const c = collected.get(pe);
      tops = sub(tops, c.tops);
      for (const [p, cm] of c.childAgg) {
        if (!childAgg.has(p)) continue;
        const target = childAgg.get(p);
        for (const [k, v] of cm) target.set(k, (target.get(k) || 0) - v);
      }
    }
    for (const [k, v] of [...tops]) if (Math.abs(v) < 1) tops.delete(k);
    for (const [, cm] of childAgg) for (const [k, v] of [...cm]) if (Math.abs(v) < 1) cm.delete(k);
    if (tops.size) collected.set(te, { tops, childAgg, src: `derived (YTD−priors) from ${y.src}` });
  }

  // unit scaling: detect filing unit (millions etc.) from ratio to merged revenue
  const ratios = [];
  if (process.env.DEBUG) for (const [te, c] of collected) console.log(`  ${tk} collected ${te}:`, [...c.tops], [...c.childAgg].map(([p, cm]) => p + ':[' + [...cm] + ']'));
  for (const [te, c] of collected) {
    const sum = [...c.tops.values()].reduce((s, v) => s + v, 0);
    if (sum > 0) ratios.push(revByEnd[te] / sum);
  }
  ratios.sort((a, b) => a - b);
  const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  let factor = null;
  if (med) for (const cand of [1, 1e3, 1e6]) if (Math.abs(med / cand - 1) < 0.15) { factor = cand; break; }
  if (!factor) {
    const reason = tk === 'INTC'
      ? 'segment revenues include intersegment sales (Intel Foundry model); no clean external-revenue split'
      : 'could not reconcile segment units with revenue';
    return { ticker: tk, degraded: reason };
  }

  const quarters = {}, warnings = [];
  for (const te of targetEnds) {
    const c = collected.get(te);
    if (!c) continue;
    const segs = [];
    let sum = 0;
    for (const [name, v0] of c.tops) {
      const value = v0 * factor;
      if (value <= 0) continue;
      sum += value;
      const seg = { name, value: Math.round(value / 1e6 * 10) / 10 };
      const cm = c.childAgg.get(name);
      if (cm && cm.size) {
        const kids = [...cm].map(([kn, kv]) => ({ name: kn, value: Math.round(kv * factor / 1e6 * 10) / 10 }));
        if (kids.length) seg.children = kids;
      }
      segs.push(seg);
    }
    if (!segs.length) continue;
    segs.sort((a, b) => b.value - a.value);
    const diff = Math.abs(sum - revByEnd[te]) / revByEnd[te];
    if (diff > 0.05) { notes.push(`${tk}: dropped ${te} — segment sum off revenue by ${(diff * 100).toFixed(1)}%`); continue; }
    quarters[te] = segs;
    if (diff > 0.005) warnings.push(`${te}: segment sum off revenue by ${(diff * 100).toFixed(2)}%`);
  }
  const n = Object.keys(quarters).length;
  if (n < 4) return { ticker: tk, degraded: `only ${n} quarters with segment data`, reportUsed };
  return { ticker: tk, quarters, warnings, reportUsed };
}

const companies = {}, notes = [];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : TICKERS;
let covered = 0;
for (const tk of ONLY) {
  process.stdout.write(`${tk} ... `);
  try {
    const r = await fetchTicker(tk);
    if (r.degraded) { console.log(`DEGRADED (${r.degraded})`); companies[tk] = { degraded: r.degraded }; notes.push(`${tk}: degraded — ${r.degraded}`); }
    else {
      console.log(`${Object.keys(r.quarters).length} qtrs via "${r.reportUsed}"${r.warnings.length ? ' WARN ' + r.warnings.join('; ') : ''}`);
      companies[tk] = { report: r.reportUsed, quarters: r.quarters };
      covered++;
      for (const w of r.warnings) notes.push(`${tk}: warning — ${w}`);
    }
  } catch (e) {
    console.log('ERROR ' + e.message);
    companies[tk] = { degraded: 'fetch error: ' + e.message };
    notes.push(`${tk}: error — ${e.message}`);
  }
  await sleep(350);
}
const out = {
  updated: new Date().toISOString(),
  source: 'SEC EDGAR XBRL segment R files (FilingSummary.xml → R*.htm, per-filing segment/disaggregation tables)',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/',
  companies,
  notes,
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'segments.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join('data', 'segments.json.js'),
  'window.__SEGMENT_DATA = ' + JSON.stringify(out) + ';\n');
console.log(`\nwrote data/segments.json: ${covered}/${TICKERS.length} companies with segments`);
for (const n of notes) console.log('NOTE ' + n);
