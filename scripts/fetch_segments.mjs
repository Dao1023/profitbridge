// fetch_segments.mjs — quarterly revenue-by-segment from SEC EDGAR "FilingSummary.xml → R files".
// For each company (registry: data/companies.json — ticker, cik, report regexes, segment map):
// list recent 10-Q/10-K filings (data.sec.gov submissions), fetch each filing's FilingSummary.xml
// (www.sec.gov), locate ALL segment/disaggregation reports by ShortName regex, parse EVERY R*.htm
// table (scoring tables by map-matched segment rows, not raw row count) and MERGE all candidate
// tables per quarter (dedupe identical names). 3-month columns are taken directly — including
// prior-year comparative columns in newer filings, which rescue quarters whose own filing failed.
// Validate each quarter's segment sum against merged revenue from data/profit.json ($M):
// <0.5% off → keep (+warning), >5% off → drop + record in failures.
// Output: data/segments.json — { updated, source, sourceUrl, companies, notes, failures }
// Units: ALL values in $M (profit.json is $M too).
// Usage: NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node scripts/fetch_segments.mjs
import fs from 'node:fs';
import path from 'node:path';

const UA = 'ProfitBridgeDashboard research contact@example.com';
const profit = JSON.parse(fs.readFileSync(path.join('data', 'profit.json'), 'utf8'));
// registry: adding a company = adding one entry to data/companies.json
const REGISTRY = JSON.parse(fs.readFileSync(path.join('data', 'companies.json'), 'utf8'));
const TICKERS = REGISTRY.map(c => c.ticker);
const CONFIG = Object.fromEntries(REGISTRY.map(c => [c.ticker, {
  reports: c.reports.map(src => new RegExp(src, 'i')),
  map: c.segmentMap.map(([src, name, parent]) => [new RegExp(src, 'i'), name, parent || undefined]),
}]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE = path.join('archive', 'tmp_r', 'segcache');
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
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(45000) });
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
function parseRTable(tbl) {
  const trs = [...tbl.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  // find duration header row ("3 Months Ended") and the date row after it
  let durIdx = -1;
  trs.forEach((tr, i) => { if (rowCells(tr).some(c => /months?\s+ended/i.test(c))) durIdx = i; });
  if (durIdx < 0 || durIdx + 1 >= trs.length) return null;
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
  if (!periods.length) return null;
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
  if (!rows.length) return null;
  return { periods, rows };
}
// ALL duration tables in one R file — table selection is by map-score, not row count (P1)
function parseRTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => parseRTable(m[0])).filter(Boolean);
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
const GENERIC = /^(net sales|total net revenue|total revenues?|revenue|revenues? from contract with customers|total|segment revenues?):?$/i;
// expense/profit rows are never segment revenue — drop them before any mapping
const NONREV = /expenses?|operating income|cost of (sales|revenues)|gross profit|margin|depreciation|share-based/i;
function cleanPending(p) {
  return p ? p.replace(/\[(member|axis)\]/gi, '').replace(/\s+/g, ' ').trim() : null; // keep '|' — labelCands splits on it
}
// a label may be a pipe-joined dimension stack ("Google | Google Cloud"); test the whole
// label, its pipe-stripped joined form, AND each segment so anchored map patterns like
// ^google cloud$ hit children while suppression entries like ^client and gaming (client|gaming)$
// still catch child rows
function labelCands(s) {
  return [s, s.split('|').map(x => x.trim()).join(' '), ...s.split('|').map(x => x.trim())];
}
function resolveName(row, mapCfg) {
  const matchMap = (s) => labelCands(s).some(x => mapCfg.some(([re, name]) => name != null && re.test(x)));
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
      const cands = labelCands(label);
      for (const [re, name, parent] of mapCfg) {
        if (cands.some(x => re.test(x))) { hit = { name, parent }; break; }
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

// A quarter may be read by SEVERAL tables with DIFFERENT disaggregation bases (e.g. NVDA's
// FY26 two-segment basis vs the older five-market-platform basis in a newer filing's
// comparative column). Union-merging such readings corrupts the sum, so every reading is kept
// and, per quarter, the one that best reconciles with merged revenue is chosen (ties → more
// mapped rows). The raw unit factor is determined FIRST, company-wide, so a dominant wrong
// basis cannot mask the correct table.
function pickFactor(allReadings, revByEnd) {
  // candidate voting: count, per unit candidate, how many most-specific readings reconcile
  // within 2% at that unit; the true unit wins even when wrong-basis tables outnumber
  // correct ones (e.g. AMD: 8 roll-up tables at 1.43× revenue vs 4 exact segment notes).
  const usable = allReadings.filter(r => r.sum > 0 && revByEnd[r.te] != null);
  let best = null, bestN = 0;
  for (const cand of [1, 1e3, 1e6, 1e-3, 1e-6]) {
    const n = usable.filter(r => Math.abs(revByEnd[r.te] / r.sum / cand - 1) < 0.02).length;
    if (n > bestN) { best = cand; bestN = n; }
  }
  if (process.env.DEBUG && usable.length) {
    const r = usable.map(x => (revByEnd[x.te] / x.sum).toExponential(2));
    console.log('  pickFactor votes:', JSON.stringify([1, 1e3, 1e6, 1e-3, 1e-6].map(c => [c, usable.filter(x => Math.abs(revByEnd[x.te] / x.sum / c - 1) < 0.02).length])), 'ratios', r.join(' '));
  }
  return bestN > 0 ? best : null;
}

function pickReading(readings, revM, factor) {
  let best = null, bestErr = Infinity;
  for (const r of readings) {
    const err = Math.abs(r.sum * factor - revM) / revM;
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && best && r.mappedN > best.mappedN)) { best = r; bestErr = err; }
  }
  return { best, err: bestErr };
}

async function fetchTicker(tk, failures) {
  const meta = profit.companies[tk];
  const cik10 = String(meta.cik).padStart(10, '0');
  const cfg = CONFIG[tk];
  const sub = JSON.parse(await getText(`https://data.sec.gov/submissions/CIK${cik10}.json`, 3, `sub_${cik10}.json`));
  // recent[] only reaches back a couple of years for heavy filers (Form 4s push older filings
  // into the archives); older 10-Qs live in sub.filings.files JSON shards and MUST be merged,
  // otherwise early quarters (GOOGL ≤2023Q2, META ≤2024Q1 …) are unreachable.
  const rows = [{ recent: sub.filings.recent }];
  for (const shard of (sub.filings.files || [])) {
    try { rows.push({ recent: JSON.parse(await getText(`https://data.sec.gov/submissions/${shard.name}`, 3, `subarch_${cik10}_${shard.name}`)) }); }
    catch (e) { failures.push({ ticker: tk, accn: shard.name, kind: 'submissions-archive', reason: e.message }); }
  }
  // full XBRL history: quarters from profit.json (already capped at the most recent 64),
  // minus TTM-only trailing quarters if any — every listed quarter is a target
  const targetEnds = meta.quarters.map(q => q.end).slice(-64);
  const oldestTarget = targetEnds.reduce((a, b) => a < b ? a : b);
  const filings = [];
  for (const { recent: f } of rows) {
    for (let i = 0; i < f.form.length; i++) {
      if (f.form[i] !== '10-Q' && f.form[i] !== '10-K') continue;
      const end = f.reportDate ? f.reportDate[i] : null;
      // filings OLDER than the oldest target contain only periods ≤ end < oldestTarget and
      // can never contribute (comparatives only reach backward from newer filings)
      if (end && end < oldestTarget) continue;
      // 64 quarters ≈ up to ~110 10-Q/10-K filings (16y × 4Q + 16 10-K + slack);
      // the end < oldestTarget filter already prunes irrelevant old filings
      filings.push({ accn: f.accessionNumber[i].replace(/-/g, ''), form: f.form[i], end });
      if (filings.length >= 160) break;
    }
  }
  const revByEnd = Object.fromEntries(meta.quarters.map(q => [q.end, q.revenue]));
  const near = (end) => targetEnds.find(te => Math.abs(new Date(te) - new Date(end)) <= 5 * 86400000) || null;
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  // quarter values collected as raw filing units; per-column {end, months, vals}
  const collected = new Map(); // te -> { tops: Map, childAgg: Map, src, mappedN }
  const ytds = [];             // { end, months, tops, childAgg }

  // per-filing work is independent (shared Maps/arrays are append-only) → run with a small
  // concurrency pool; SEC rate limits are honored by keeping the pool small + per-request sleep
  async function doFiling(fl) {
    let reports;
    try { reports = await filingRFiles(cik10, fl.accn); }
    catch (e) {
      failures.push({ ticker: tk, accn: fl.accn, kind: 'FilingSummary', reason: e.message });
      return;
    }
    // ALL candidate reports × ALL duration tables in each (P1: no best-of-one choice)
    const candidateFiles = [];
    for (const re of cfg.reports) for (const r of reports) if (re.test(r.name) && !candidateFiles.includes(r.file)) candidateFiles.push(r.file);
    for (const file of candidateFiles) {
      let html;
      try { html = await getText(`https://www.sec.gov/Archives/edgar/data/${cik10}/${fl.accn}/${file}`, 4, `r_${cik10}_${fl.accn}_${file}`); await sleep(120); }
      catch (e) { failures.push({ ticker: tk, accn: fl.accn, file, kind: 'R-file', reason: e.message }); continue; }
      const tables = parseRTables(html);
      for (const parsed of tables) {
        // score: rows the ticker map actually recognizes (P1) — real segment tables beat
        // geographic-only / narrative tables regardless of raw row count
        const mappedN = parsed.rows.filter(r => {
          const n = resolveName(r, cfg.map);
          return n && n !== 'Total Revenue' && cfg.map.some(([re, name]) => name != null && re.test(n));
        }).length;
        if (!mappedN) continue;
        const mapper = mapRows(parsed, cfg.map);
        for (let i = 0; i < parsed.periods.length; i++) {
          const p = parsed.periods[i];
          const te = near(p.end);
          if (!te) continue;
          const { tops, childAgg } = mapper(i);
          if (tops.size < 2) continue; // need >=2 real segments; rejects geographic/misc tables
          const src = `${fl.form} ${fl.accn}/${file}`;
          const sum = [...tops.values()].reduce((s, v) => s + v, 0);
          if (p.months === 3) {
            if (!collected.has(te)) collected.set(te, []);
            collected.get(te).push({ tops, childAgg, mappedN, src, sum });
          } else if (p.months === 6 || p.months >= 9) {
            ytds.push({ end: te, months: p.months, tops, childAgg, src });
          }
        }
      }
    }
  }
  // concurrency pool of 6 filings at a time
  const POOL = 6;
  let fi = 0, doneN = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (fi < filings.length) {
      const fl = filings[fi++];
      await doFiling(fl);
      if (++doneN % 20 === 0) console.log(`  ... ${doneN}/${filings.length} filings`);
    }
  }));

  // pick the best-reconciling reading per quarter (see pickReading), before YTD derivation
  const allReadings = [];
  for (const [te, readings] of collected) for (const r of readings) allReadings.push({ ...r, te });
  if (process.env.DEBUG) for (const r of allReadings) console.log(`  rdg ${r.te} [${tk}] mappedN=${r.mappedN} sum=${r.sum} rev=${revByEnd[r.te]} ${r.src}:`, [...r.tops]);
  const factor = pickFactor(allReadings, revByEnd);
  if (!factor) {
    const reason = tk === 'INTC'
      ? 'segment revenues include intersegment sales (Intel Foundry model); no clean external-revenue split'
      : 'could not reconcile segment units with revenue';
    return { ticker: tk, degraded: reason };
  }
  const chosen = new Map(); // te -> { tops, childAgg, src, mappedN, sum, err }
  for (const [te, readings] of collected) {
    const { best, err } = pickReading(readings, revByEnd[te], factor);
    chosen.set(te, { ...best, err });
  }
  if (process.env.DEBUG) for (const [te, c] of chosen) console.log(`  ${tk} collected ${te}:`, [...c.tops], [...c.childAgg].map(([p, cm]) => p + ':[' + [...cm] + ']'), `err=${(c.err * 100).toFixed(2)}%`);

  // derive quarters missing a 3-month column from YTD minus prior quarters in the same span
  for (const te of targetEnds) {
    if (chosen.has(te)) continue;
    const y = ytds.find(y => y.end === te);
    if (!y) continue;
    const priors = targetEnds.filter(x => { const d = dayDiff(x, te); return d > 0 && d < y.months * 31 + 10 && chosen.has(x); });
    const spanOK = priors.length === y.months / 3 - 1;
    if (!spanOK) continue;
    // (fixed: was (neg − map), i.e. prior − YTD, which made every derived Q4 non-positive)
    const sub = (map, neg) => { const out = new Map(); for (const [k, v] of map) out.set(k, v - (neg.get(k) || 0)); return out; };
    let tops = y.tops, childAgg = new Map([...y.childAgg].map(([p, cm]) => [p, new Map(cm)]));
    for (const pe of priors) {
      const c = chosen.get(pe);
      tops = sub(tops, c.tops);
      for (const [p, cm] of c.childAgg) {
        if (!childAgg.has(p)) continue;
        const target = childAgg.get(p);
        for (const [k, v] of cm) target.set(k, (target.get(k) || 0) - v);
      }
    }
    for (const [k, v] of [...tops]) if (Math.abs(v) < 1) tops.delete(k);
    for (const [, cm] of childAgg) for (const [k, v] of [...cm]) if (Math.abs(v) < 1) cm.delete(k);
    if (process.env.DEBUG) console.log('  deriv', te, 'months=' + y.months, 'priors=' + priors, [...tops], 'ytdTops', [...y.tops]);
    if (tops.size) chosen.set(te, { tops, childAgg, src: `derived (YTD−priors) from ${y.src}`, mappedN: tops.size, sum: [...tops.values()].reduce((s, v) => s + v, 0), err: 0 });
  }

  const quarters = {}, warnings = [], noDisclosure = [];
  for (const te of targetEnds) {
    const c = chosen.get(te);
    // quarters with no segment column found in ANY fetched filing = the source itself has no
    // segment disclosure for that period (pre-ASC-606-era filings etc.) — recorded in notes,
    // NOT failures (failures are reserved for fetch/reconciliation problems)
    if (!c) { noDisclosure.push(te); continue; }
    const segs = [];
    let sum = 0;
    for (const [name, v0] of c.tops) {
      const value = v0 * factor; // $M
      if (value <= 0) continue;
      sum += value;
      const seg = { name, value: Math.round(value * 10) / 10 };
      const cm = c.childAgg.get(name);
      if (cm && cm.size) {
        const kids = [...cm].map(([kn, kv]) => ({ name: kn, value: Math.round(kv * factor * 10) / 10 }));
        if (kids.length) seg.children = kids;
      }
      segs.push(seg);
    }
    if (!segs.length) { failures.push({ ticker: tk, end: te, kind: 'empty-quarter', reason: 'all mapped segment values non-positive' }); continue; }
    segs.sort((a, b) => b.value - a.value);
    const diff = Math.abs(sum - revByEnd[te]) / revByEnd[te];
    if (diff > 0.05) { failures.push({ ticker: tk, end: te, kind: 'reconciliation', reason: `segment sum off revenue by ${(diff * 100).toFixed(1)}% — dropped`, src: c.src }); continue; }
    quarters[te] = segs;
    if (diff > 0.005) warnings.push(`${te}: segment sum off revenue by ${(diff * 100).toFixed(2)}%`);
  }
  const n = Object.keys(quarters).length;
  if (n < 4) return { ticker: tk, degraded: `only ${n} quarters with segment data` };
  return { ticker: tk, quarters, warnings, noDisclosure };
}

// ---- write guard (P4): never let a partial (e.g. ONLY=) run overwrite a fuller file ----
function guardCompanyCount(newCount) {
  let prevCount = null;
  try {
    const prev = JSON.parse(fs.readFileSync(path.join('data', 'segments.json'), 'utf8'));
    prevCount = Object.keys(prev.companies || {}).length;
  } catch { /* no previous file */ }
  const floor = Math.max(prevCount ?? 0, 10);
  if (newCount < floor && process.env.ALLOW_PARTIAL !== '1') {
    throw new Error(`write guard: refusing to write segments.json with ${newCount} companies (floor=${floor}` +
      (prevCount != null ? `, previous file had ${prevCount}` : '') + '). A partial run (ONLY=?) would destroy full data.');
  }
}

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : TICKERS;
// incremental run: start from the previous segments.json so each finished company is
// checkpointed to disk immediately (a 30-min run keeps its progress on interruption)
function loadPrev() {
  try { return JSON.parse(fs.readFileSync(path.join('data', 'segments.json'), 'utf8')); }
  catch { return { companies: {}, notes: [], failures: [] }; }
}
const prev = loadPrev();
const ONLYSET = new Set(ONLY);
const companies = {}, notes = [], failures = [];
for (const [tk, c] of Object.entries(prev.companies || {})) if (!ONLYSET.has(tk)) companies[tk] = c;
for (const n of prev.notes || []) if (!ONLYSET.has(String(n).split(':')[0].trim())) notes.push(n);
for (const f of prev.failures || []) if (!ONLYSET.has(f.ticker)) failures.push(f);
let covered = Object.values(companies).filter(c => c.quarters).length;
const t0 = Date.now();
function checkpoint(doneTk) {
  const out = {
    updated: new Date().toISOString(),
    source: 'SEC EDGAR XBRL segment R files (FilingSummary.xml → R*.htm, per-filing segment/disaggregation tables)',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/',
    companies,
    notes,
    failures,
  };
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(path.join('data', 'segments.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join('data', 'segments.json.js'),
    'window.__SEGMENT_DATA = ' + JSON.stringify(out) + ';\n');
  const el = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  [checkpoint] ${doneTk} written (${covered}/${TICKERS.length} companies covered, ${failures.length} failures, ${el}s elapsed)`);
}
for (const tk of ONLY) {
  process.stdout.write(`${tk} ... `);
  try {
    const r = await fetchTicker(tk, failures);
    if (r.degraded) { console.log(`DEGRADED (${r.degraded})`); companies[tk] = { degraded: r.degraded }; notes.push(`${tk}: degraded — ${r.degraded}`); }
    else {
      console.log(`${Object.keys(r.quarters).length} qtrs${r.warnings.length ? ' WARN ' + r.warnings.join('; ') : ''}`);
      companies[tk] = { quarters: r.quarters };
      covered++;
      for (const w of r.warnings) notes.push(`${tk}: warning — ${w}`);
      if (r.noDisclosure.length) notes.push(`${tk}: ${r.noDisclosure.length} 季无分部披露（源上无分部表，非抓取失败）: ${r.noDisclosure.join(', ')}`);
      // NVDA disclosure-basis change: from FY26 Q1 (quarter ending 2025-04-27) NVIDIA reports
      // only two segments (Compute & Networking / Graphics) instead of the five market platforms.
      if (tk === 'NVDA') {
        const two = Object.keys(r.quarters).filter(te => te >= '2025-04-27' && r.quarters[te].length === 2);
        if (two.length) notes.push(`NVDA: ${two[0]} 起公司披露口径变为两个分部（Compute & Networking / Graphics），此前为 5 个市场平台列；前端按现有口径渲染`);
      }
    }
  } catch (e) {
    console.log('ERROR ' + e.message);
    companies[tk] = { degraded: 'fetch error: ' + e.message };
    notes.push(`${tk}: error — ${e.message}`);
    failures.push({ ticker: tk, kind: 'ticker', reason: e.message });
  }
  checkpoint(tk);
  await sleep(350);
}
guardCompanyCount(Object.keys(companies).length); // degraded tickers still count (they are kept in output)
checkpoint('final');
console.log(`\nwrote data/segments.json: ${covered}/${TICKERS.length} companies with segments, ${failures.length} failures`);
for (const n of notes) console.log('NOTE ' + n);
for (const f of failures) console.log('FAIL ' + JSON.stringify(f));
