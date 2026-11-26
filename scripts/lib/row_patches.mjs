// Shared row-patch layer: targeted, whitelisted, verify-before-write corrections to individual
// quarter fields that cannot be expressed as a staging batch "enrich" (that path only fills empty
// slots and never overwrites an existing, non-null value).
//
// Why this exists: six historical netInc values for 005930.KS / 066570.KS came from stockanalysis
// `niToCommon` and are not IFRS net income attributable to owners. They are wrong in the *value*,
// not in the source line, so the only safe fix is an explicit old -> new patch that refuses to run
// when the on-disk value is neither the expected old value nor the already-applied new value.
//
// Contract:
//   * only fields listed in PATCHABLE_FIELDS may be written (currently: netInc, rd, sga, opInc);
//   * the target row must already exist and already carry the field, so the key ORDER never moves;
//   * every patch must resolve, otherwise applyRowPatches throws and the caller exits non-zero;
//   * re-applying the same patch file is a no-op (value === new => reported as "already").
//
// Consumers:
//   scripts/patch_rows_2026-11-20.mjs  — standalone targeted write (verifies + writes profit.json + mirror)
//   scripts/patch_rows_2026-11-26_li.mjs — same writer for the LI as-reported corrections
//   scripts/merge_batches.mjs          — every write path (--batch-only and full rebuild), so a
//                                        rebuild reproduces the corrected values instead of the old ones.
import fs from 'node:fs';
import path from 'node:path';

export const PATCHABLE_FIELDS = ['netInc', 'rd', 'sga', 'opInc'];
export const DEFAULT_PATCH_FILE = 'data/staging/patches/2026-11-20_netinc.json';
// Every committed patch file, applied in this order by scripts/merge_batches.mjs so that a full
// rebuild reproduces the corrected values. DEFAULT_PATCH_FILE stays the single-file default for the
// 2026-11-20 writer + verify_historical_netinc test.
export const DEFAULT_PATCH_FILES = [
  DEFAULT_PATCH_FILE,
  'data/staging/patches/2026-11-26_li.json',
];

/** Load + validate a patch file. Accepts bare array or {_meta, patches:[...]}. */
export function loadPatches(rootDir, file = DEFAULT_PATCH_FILE) {
  const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);
  if (!fs.existsSync(abs)) throw new Error(`patch file not found: ${abs}`);
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const list = Array.isArray(doc) ? doc : doc.patches;
  if (!Array.isArray(list) || !list.length) throw new Error(`patch file has no patches: ${abs}`);
  const errs = [], seen = new Set();
  list.forEach((p, i) => {
    if (typeof p.ticker !== 'string' || !p.ticker.trim()) errs.push(`#${i}: missing ticker`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.end || ''))) errs.push(`#${i}: bad end ${JSON.stringify(p.end)}`);
    if (!PATCHABLE_FIELDS.includes(p.field)) errs.push(`#${i}: field '${p.field}' is not patchable (allowed: ${PATCHABLE_FIELDS.join(', ')})`);
    for (const k of ['old', 'new']) {
      if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) errs.push(`#${i}: ${k} must be a finite number`);
    }
    if (p.old === p.new) errs.push(`#${i}: old === new (${p.old})`);
    const key = `${p.ticker}|${p.end}|${p.field}`;
    if (seen.has(key)) errs.push(`#${i}: duplicate patch for ${key}`);
    seen.add(key);
  });
  if (errs.length) throw new Error(`invalid patch file ${path.relative(rootDir, abs)}:\n  ` + errs.join('\n  '));
  return { doc, patches: list, file: abs };
}

/**
 * Apply patches to a profit payload in place (key order preserved).
 * @returns {{applied: object[], already: object[], touched: Map<string, string[]>}}
 * @throws  when a patch target is missing or its current value is neither old nor new.
 */
export function applyRowPatches(profit, patches, { label = 'patch' } = {}) {
  const applied = [], already = [], failed = [];
  const touched = new Map();
  for (const p of patches) {
    const co = profit.companies?.[p.ticker];
    if (!co) { failed.push({ ...p, reason: 'ticker-not-found' }); continue; }
    const q = (co.quarters || []).find(x => x.end === p.end);
    if (!q) { failed.push({ ...p, reason: 'period-not-found' }); continue; }
    if (!Object.prototype.hasOwnProperty.call(q, p.field)) { failed.push({ ...p, reason: 'field-absent' }); continue; }
    if (q[p.field] === p.new) { already.push({ ticker: p.ticker, end: p.end, field: p.field, value: p.new }); continue; }
    if (q[p.field] !== p.old) { failed.push({ ...p, reason: 'value-mismatch', found: q[p.field], expectedOld: p.old }); continue; }
    q[p.field] = p.new; // assignment to an existing key keeps its position
    const key = `${p.ticker}|${p.end}`;
    touched.set(key, [...(touched.get(key) || []), p.field]);
    applied.push({ ticker: p.ticker, end: p.end, field: p.field, old: p.old, new: p.new });
  }
  if (failed.length) {
    const msg = failed.map(f => `${f.ticker} ${f.end} ${f.field}: ${f.reason}` +
      (f.found !== undefined ? ` (found ${JSON.stringify(f.found)}, expected old ${f.old} or new ${f.new})` : '')).join('\n  ');
    throw new Error(`[${label}] patch refused:\n  ` + msg);
  }
  return { applied, already, touched };
}
