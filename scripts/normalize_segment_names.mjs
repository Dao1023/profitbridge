#!/usr/bin/env node
// normalize_segment_names.mjs
// One-shot + reusable: normalize TRADITIONAL-Chinese segment names in
// data/segments.json to SIMPLIFIED Chinese (the UI is zh-CN; HK/TW filings keep
// the Eastmoney original traditional names, e.g. 互聯網增值服務 → 互联网增值服务).
//
// Design constraints (per task):
//   * NO external dependency (no opencc); conversion uses an EXACT per-character
//     traditional→simplified map below. No whole-word / heuristic replacement.
//   * Only strings reachable through a `name` key are touched (segment names,
//     incl. nested `children[].name` / `annualQuarters`). Values, order, notes,
//     reason, periodTypes, failures, _conflicts … are left byte-identical.
//   * Serialization is JSON.stringify(data, null, 2) + "\n", which reproduces the
//     original file byte-for-byte for the untouched content (verified).
//   * The conversion is self-proving: after transforming, we re-scan EVERY `name`
//     in the whole DB and assert the residual traditional-character count is 0.
//
// Usage:
//   node scripts/normalize_segment_names.mjs            # apply in place
//   node scripts/normalize_segment_names.mjs --check    # dry-run: report only,
//                                                       # exit 1 if any traditional
//                                                       # char remains (nothing written)
//   node scripts/normalize_segment_names.mjs --file <p> # operate on another JSON file
//
// hasTraditional(s) == does s contain at least one char from the
// traditional-exclusive judge set (keys of TRAD2SIMP). The set is printed on run.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ---------------------------------------------------------------------------
// EXACT traditional → simplified map (traditional-exclusive chars only; never
// map a char that is identical in both scripts, e.g. 台/后/里/面/云/干).
// The 41 chars in [CORE] are every traditional char actually present in
// data/segments.json segment names; the rest are common traditional-exclusive
// extras (from the task's example list) so the judge generalizes safely.
// ---------------------------------------------------------------------------
const TRAD2SIMP = {
  // --- present in the dataset (41) ---
  '亞': '亚', '個': '个', '備': '备', '內': '内', '動': '动', '務': '务',
  '區': '区', '國': '国', '團': '团', '場': '场', '娛': '娱', '廣': '广',
  '數': '数', '業': '业', '樂': '乐', '歐': '欧', '灣': '湾', '營': '营',
  '產': '产', '發': '发', '礎': '础', '絡': '络', '網': '网', '線': '线',
  '聯': '联', '興': '兴', '設': '设', '資': '资', '賣': '卖', '軟': '软',
  '辦': '办', '遊': '游', '運': '运', '銀': '银', '銷': '销', '閒': '闲',
  '關': '关', '陸': '陆', '電': '电', '類': '类', '飲': '饮',
  // --- traditional-exclusive extras (not currently present, kept for safety) ---
  '儲': '储', '華': '华', '圖': '图', '圓': '圆', '處': '处', '熱': '热',
  '飼': '饲', '餅': '饼', '會': '会', '額': '额', '車': '车', '廠': '厂',
  '價': '价', '風': '风', '險': '险', '頻': '频', '寬': '宽', '訊': '讯',
  '戲': '戏', '體': '体', '鏈': '链',
};

const TRAD_SET = new Set(Object.keys(TRAD2SIMP));

/** hasTraditional(s): true iff s contains ≥1 traditional-exclusive character. */
export function hasTraditional(s) {
  for (const ch of String(s)) if (TRAD_SET.has(ch)) return true;
  return false;
}

/** Convert one string char-by-char using the exact map (identity otherwise). */
export function toSimplified(s) {
  let out = '';
  for (const ch of String(s)) out += TRAD_SET.has(ch) ? TRAD2SIMP[ch] : ch;
  return out;
}

/** Visit every `name` string: cb(value, parentObject). */
function forEachName(node, cb) {
  if (Array.isArray(node)) {
    for (const x of node) forEachName(x, cb);
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k === 'name' && typeof v === 'string') cb(v, node);
      else forEachName(v, cb);
    }
  }
}

function collectNameStats(data) {
  const names = new Map(); // original name -> occurrences
  forEachName(data, (v) => names.set(v, (names.get(v) || 0) + 1));
  let residualChars = 0;
  const residualNames = new Map();
  for (const [nm, cnt] of names) {
    let bad = 0;
    for (const ch of nm) if (TRAD_SET.has(ch)) bad++;
    if (bad) {
      residualChars += bad * cnt;
      residualNames.set(nm, bad);
    }
  }
  return { names, residualChars, residualNames };
}

// --- args ---
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
let FILE = join(ROOT, 'data', 'segments.json');
const fi = argv.indexOf('--file');
if (fi !== -1 && argv[fi + 1]) FILE = argv[fi + 1];

const raw = readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);

const before = collectNameStats(data);
console.log('file:', FILE);
console.log('judge charset (hasTraditional), ' + TRAD_SET.size + ' chars:');
console.log('  ' + [...TRAD_SET].sort().join(''));
console.log('distinct name strings before:', before.names.size);
console.log('traditional chars present in names before:', before.residualChars,
  '(' + before.residualNames.size + ' distinct names)');

// transform names in memory
const changed = new Map(); // original -> simplified
forEachName(data, (v, parent) => {
  if (hasTraditional(v)) {
    const s = toSimplified(v);
    changed.set(v, s);
    parent.name = s;
  }
});

// self-proof: residual re-scan on the transformed tree
const after = collectNameStats(data);
console.log('names changed (distinct):', changed.size);
// per-ticker change counts, computed from the ORIGINAL parse
const orig = JSON.parse(raw);
const perTicker = new Map();
for (const tk of Object.keys(orig.companies || {})) {
  let n = 0;
  forEachName(orig.companies[tk], (v) => { if (hasTraditional(v)) n++; });
  perTicker.set(tk, n);
}
for (const [tk, n] of perTicker) if (n) console.log('  ' + tk + ': ' + n);
console.log('residual traditional chars in names after:', after.residualChars);
if (after.residualChars !== 0) {
  console.error('FAIL: residual traditional characters remain:',
    [...after.residualNames].slice(0, 20));
  process.exit(2);
}

if (CHECK) {
  if (changed.size > 0) {
    console.log('CHECK: ' + changed.size + ' distinct names WOULD change; file not modified.');
    process.exit(1);
  }
  console.log('CHECK: no traditional segment names found; nothing to do.');
  process.exit(0);
}

// --- write with identical formatting ---
const out = JSON.stringify(data, null, 2) + '\n';
if (out === raw) {
  console.log('no textual change; file left as-is.');
  process.exit(0);
}
writeFileSync(FILE, out, 'utf8');

// reload and re-verify persistence + residual 0
const persisted = collectNameStats(JSON.parse(readFileSync(FILE, 'utf8')));
console.log('written. persisted residual traditional chars:', persisted.residualChars);
if (persisted.residualChars !== 0) {
  console.error('FAIL: persisted file still has traditional chars.');
  process.exit(2);
}
console.log('OK: ' + changed.size + ' distinct names normalized.');
