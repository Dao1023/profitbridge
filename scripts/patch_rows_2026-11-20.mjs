#!/usr/bin/env node
/**
 * patch_rows_2026-11-20.mjs — targeted, whitelisted correction of individual quarter fields.
 *
 * 背景: 005930.KS / 066570.KS 的 6 个历史 netInc 来自 stockanalysis `niToCommon`(净利润减优先股股利),
 * 不是 IFRS 归母净利。这些值错在「数值」而不是来源行, staging batch 的 enrich 路径只补空值、
 * 不能覆盖非空旧值, 所以用一个显式 old -> new patch 层定向改值 (见 scripts/lib/row_patches.mjs)。
 *
 * 语义:
 *   * 只允许 PATCHABLE_FIELDS 白名单字段(当前 netInc); 目标期必须已存在且已有该键 → 键序不变。
 *   * 必须校验磁盘现值 === old (不等且不等于 new 时 exit 1, 防误改); 已是 new 视为已应用(幂等)。
 *   * 写 data/profit.json 与 data/profit.json.js 镜像, 并断言「其它所有期逐字节不变」。
 *
 * 用法:
 *   node scripts/patch_rows_2026-11-20.mjs                       # 应用默认 patch 文件
 *   node scripts/patch_rows_2026-11-20.mjs --patch-file=path.json
 *   node scripts/patch_rows_2026-11-20.mjs --dry                 # 只校验/打印, 不写盘
 *
 * 退出码: 0 = 已应用或本来就是目标值; 1 = 校验失败(不写盘)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadPatches, applyRowPatches, DEFAULT_PATCH_FILE, PATCHABLE_FIELDS } from './lib/row_patches.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const argOf = (name) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const PATCH_FILE = argOf('patch-file') || DEFAULT_PATCH_FILE;
const PROFIT = path.join(ROOT, 'data/profit.json');
const MIRROR = path.join(ROOT, 'data/profit.json.js');

const die = (msg) => { console.error('FAIL ' + msg); process.exit(1); };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

const { doc, patches } = loadPatches(ROOT, PATCH_FILE);
const profit = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
const before = clone(profit);
const beforeSha = sha(PROFIT);

// ---------- 0) 目标行必须存在、字段必须已存在、键序基线 ----------
const rows = new Map(); // "tk|end" -> { row, keys, json }
for (const p of patches) {
  const co = profit.companies?.[p.ticker];
  if (!co) die(`company ${p.ticker} not found in data/profit.json`);
  const q = (co.quarters || []).find(x => x.end === p.end);
  if (!q) die(`${p.ticker} ${p.end}: period not found`);
  if (!(p.field in q)) die(`${p.ticker} ${p.end}: field '${p.field}' absent — refusing to append a new key`);
  rows.set(`${p.ticker}|${p.end}`, { row: q, keys: Object.keys(q), json: JSON.stringify(q), periodType: q.periodType });
}

// ---------- 1) 应用 (校验 old / 幂等 new) ----------
let res;
try { res = applyRowPatches(profit, patches, { label: 'patch_rows' }); }
catch (e) { die(e.message); }

// ---------- 2) 断言: 只改了白名单字段, 键序不变, 其它所有期逐字节不变 ----------
const errs = [];
for (const [key, meta] of rows) {
  const [tk, end] = key.split('|');
  const q = profit.companies[tk].quarters.find(x => x.end === end);
  const keysNow = Object.keys(q);
  if (JSON.stringify(keysNow) !== JSON.stringify(meta.keys)) errs.push(`${key}: key order changed ${meta.keys} -> ${keysNow}`);
  // row with the patched field(s) reset to old must be byte-identical to the before image
  let changedFields = [];
  for (const f of PATCHABLE_FIELDS) if (meta.keys.includes(f)) changedFields.push(f);
  if (!changedFields.length) errs.push(`${key}: no patchable field present`);
  // compare against the pre-application image: `old` for patches applied now, `new` for patches that
  // were already in place before this run (idempotent re-run => the row is already the target image).
  const asBefore = clone(q);
  for (const p of patches) {
    if (p.ticker !== tk || p.end !== end) continue;
    const wasApplied = (res.applied || []).some(a => a.ticker === tk && a.end === end && a.field === p.field);
    asBefore[p.field] = wasApplied ? p.old : p.new;
  }
  if (JSON.stringify(asBefore) !== meta.json) errs.push(`${key}: unexpected change beyond ${changedFields.join(', ')}`);
}
// 3,733 other rows: every company entry byte-identical except the 6 patched rows' netInc
let checked = 0;
for (const [tk, co] of Object.entries(profit.companies)) {
  const oldCo = before.companies[tk];
  const oldQ = oldCo.quarters || [], newQ = co.quarters || [];
  if (oldQ.length !== newQ.length) { errs.push(`${tk}: period count ${oldQ.length} -> ${newQ.length}`); continue; }
  for (let i = 0; i < newQ.length; i++) {
    const k = `${tk}|${newQ[i].end}`;
    if (rows.has(k)) continue;
    if (JSON.stringify(oldQ[i]) !== JSON.stringify(newQ[i])) {
      // same row object shifted position is already covered by index alignment; report only real diffs
      errs.push(`${k}: row changed although not a patch target`);
    }
    checked++;
  }
  const meta = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k2]) => k2 !== 'quarters')));
  if (meta(oldCo) !== meta(co)) errs.push(`${tk}: company metadata changed`);
}
for (const k of Object.keys(before)) if (!(k in profit)) errs.push(`top-level key ${k} removed`);
if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(profit))) errs.push('top-level key order changed');
if (JSON.stringify(before.companies && Object.keys(before.companies)) !== JSON.stringify(Object.keys(profit.companies))) errs.push('company order changed');
const patchedRowIds = new Set(rows.keys());
if (checked + patchedRowIds.size !== Object.values(profit.companies).reduce((s, c) => s + c.quarters.length, 0)) {
  errs.push('row accounting mismatch (expected every row visited exactly once)');
}
if (errs.length) { console.error(errs.join('\n')); die('post-patch integrity assertions failed; nothing written'); }

// ---------- 3) 写盘 + 镜像 ----------
const summary = {
  patchFile: path.relative(ROOT, path.join(ROOT, PATCH_FILE)),
  applied: res.applied,
  already: res.already,
  untouchedRowsChecked: checked,
};
if (DRY) {
  console.log(JSON.stringify({ dry: true, ...summary }, null, 2));
  process.exit(0);
}
if (!res.applied.length) {
  console.log(JSON.stringify({ noop: true, sha256: beforeSha, ...summary }, null, 2));
  process.exit(0);
}
// `updated` only moves when the payload really changed (mirror merge_batches' stamp rule)
profit.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(PROFIT, JSON.stringify(profit, null, 2) + '\n');
fs.writeFileSync(MIRROR, 'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n');
const mirrorPayload = fs.readFileSync(MIRROR, 'utf8').replace(/^window\.__PROFIT_DATA = /, '').replace(/;\n$/, '');
if (JSON.stringify(JSON.parse(mirrorPayload)) !== JSON.stringify(profit)) die('mirror data/profit.json.js != data/profit.json');
console.log(JSON.stringify({ ...summary, beforeSha, afterSha: sha(PROFIT), afterMirrorSha: sha(MIRROR), metaId: doc._meta && doc._meta.id }, null, 2));
