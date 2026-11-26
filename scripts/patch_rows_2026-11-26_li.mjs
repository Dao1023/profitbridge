#!/usr/bin/env node
/**
 * patch_rows_2026-11-26_li.mjs — targeted, whitelisted correction of 12 LI cells to as-reported values.
 *
 * 背景: 理想汽车 (LI) 的 12 格来自 stockanalysis 归一化报表, 不是公司 as-reported 合并经营报表:
 *   * opInc (8 格: 4 个 Q2 + FY2022..FY2025): SA 把「资产处置损益」从经营利润中剔除, 而公司披露的
 *     income/(loss) from operations 已含该损益 → 差额与 SA 的 Gain (Loss) on Sale of Assets 行逐格相符;
 *   * 2021Q3 / FY2021 的 rd / sga (4 格): 第三方在 R&D 与 SG&A 之间重分类 (总额不变、opInc 不变)。
 * 这些值错在「数值」而不是「来源行」, staging enrich 只补空值、改不到非空旧值, 所以走既有 patch 层。
 *
 * 语义 (与 scripts/patch_rows_2026-11-20.mjs 一致):
 *   * 只允许 rd / sga / opInc 三个字段; 目标期必须已存在且已有该键 → 键序不变。
 *   * 应用前校验磁盘现值 === old (严格数值相等); 不等且不等于 new 时 exit 1 并打印实际值。
 *   * 幂等: 已是 new 视为已应用, 第二次执行 no-op 且不报错。
 *   * 写 data/profit.json 与 data/profit.json.js 镜像, 并断言「其它所有期逐字节不变」+ 镜像 deepEqual。
 *
 * 用法:
 *   node scripts/patch_rows_2026-11-26_li.mjs                       # 应用默认 patch 文件
 *   node scripts/patch_rows_2026-11-26_li.mjs --patch-file=path.json
 *   node scripts/patch_rows_2026-11-26_li.mjs --dry                 # 只校验/打印, 不写盘
 *
 * 退出码: 0 = 已应用或本来就是目标值; 1 = 校验失败(不写盘)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert';
import { loadPatches, applyRowPatches, PATCHABLE_FIELDS } from './lib/row_patches.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const argOf = (name) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const DEFAULT_LI_PATCH_FILE = 'data/staging/patches/2026-11-26_li.json';
const PATCH_FILE = argOf('patch-file') || DEFAULT_LI_PATCH_FILE;
const PROFIT = path.join(ROOT, 'data/profit.json');
const MIRROR = path.join(ROOT, 'data/profit.json.js');
// 本 patch 文件的字段白名单（严格于 lib 的全局白名单）: 只改这三列。
const LI_FIELDS = ['rd', 'sga', 'opInc'];

const die = (msg) => { console.error('FAIL ' + msg); process.exit(1); };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

const { doc, patches } = loadPatches(ROOT, PATCH_FILE);
const badFields = [...new Set(patches.map(p => p.field))].filter(f => !LI_FIELDS.includes(f));
if (badFields.length) die(`patch file may only contain ${LI_FIELDS.join('/')}; found ${badFields.join(', ')}`);
if (patches.length !== 12) die(`expected 12 LI patches, found ${patches.length}`);

const profit = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
const before = clone(profit);
const beforeSha = sha(PROFIT);

// ---------- 0) 目标行必须存在、字段必须已存在、键序基线 ----------
const rows = new Map(); // "tk|end" -> { row, keys, json, periodType }
for (const p of patches) {
  const co = profit.companies?.[p.ticker];
  if (!co) die(`company ${p.ticker} not found in data/profit.json`);
  const q = (co.quarters || []).find(x => x.end === p.end);
  if (!q) die(`${p.ticker} ${p.end}: period not found`);
  if (!(p.field in q)) die(`${p.ticker} ${p.end}: field '${p.field}' absent — refusing to append a new key`);
  if (q[p.field] !== p.old && q[p.field] !== p.new) {
    die(`${p.ticker} ${p.end} ${p.field}: on-disk value ${q[p.field]} !== expected old ${p.old} (and !== new ${p.new})`);
  }
  rows.set(`${p.ticker}|${p.end}`, { row: q, keys: Object.keys(q), json: JSON.stringify(q), periodType: q.periodType });
}

// ---------- 1) 应用 (校验 old / 幂等 new) ----------
let res;
try { res = applyRowPatches(profit, patches, { label: 'patch_rows_li' }); }
catch (e) { die(e.message); }

// ---------- 2) 断言: 只改了白名单字段, 键序不变, 其它所有期逐字节不变 ----------
const errs = [];
for (const [key, meta] of rows) {
  const [tk, end] = key.split('|');
  const q = profit.companies[tk].quarters.find(x => x.end === end);
  const keysNow = Object.keys(q);
  if (JSON.stringify(keysNow) !== JSON.stringify(meta.keys)) errs.push(`${key}: key order changed ${meta.keys} -> ${keysNow}`);
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
// every other row in the file: byte-identical
let checked = 0;
for (const [tk, co] of Object.entries(profit.companies)) {
  const oldCo = before.companies[tk];
  const oldQ = oldCo.quarters || [], newQ = co.quarters || [];
  if (oldQ.length !== newQ.length) { errs.push(`${tk}: period count ${oldQ.length} -> ${newQ.length}`); continue; }
  for (let i = 0; i < newQ.length; i++) {
    const k = `${tk}|${newQ[i].end}`;
    if (rows.has(k)) continue;
    if (JSON.stringify(oldQ[i]) !== JSON.stringify(newQ[i])) errs.push(`${k}: row changed although not a patch target`);
    checked++;
  }
  const meta = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k2]) => k2 !== 'quarters')));
  if (meta(oldCo) !== meta(co)) errs.push(`${tk}: company metadata changed`);
}
for (const k of Object.keys(before)) if (!(k in profit)) errs.push(`top-level key ${k} removed`);
if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(profit))) errs.push('top-level key order changed');
if (JSON.stringify(Object.keys(before.companies)) !== JSON.stringify(Object.keys(profit.companies))) errs.push('company order changed');
if (checked + rows.size !== Object.values(profit.companies).reduce((s, c) => s + c.quarters.length, 0)) {
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
assert.deepStrictEqual(JSON.parse(mirrorPayload), profit, 'mirror data/profit.json.js != data/profit.json');
console.log(JSON.stringify({ ...summary, beforeSha, afterSha: sha(PROFIT), afterMirrorSha: sha(MIRROR), metaId: doc._meta && doc._meta.id }, null, 2));
