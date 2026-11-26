#!/usr/bin/env node
/**
 * compare_main.mjs — 逐公司 / 逐单元格对比 main 版 data/profit.json 与工作区版本。
 *
 * 用法: node audits/2026-11-26-li/compare_main.mjs
 * 退出码: 0 = 只有 LI 变化且变化单元格数符合预期; 1 = 出现其它公司/其它期变化（回归）
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_REF = process.argv[2] || 'main';
const base = JSON.parse(execFileSync('git', ['show', `${BASE_REF}:data/profit.json`], { cwd: ROOT, maxBuffer: 1 << 28 }).toString());
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/profit.json'), 'utf8'));

const changedCompanies = new Set();
const changedCells = [];
const structural = [];

const baseKeys = Object.keys(base.companies), curKeys = Object.keys(cur.companies);
if (baseKeys.join(',') !== curKeys.join(',')) structural.push('company list/order changed');

for (const tk of new Set([...baseKeys, ...curKeys])) {
  const a = base.companies[tk], b = cur.companies[tk];
  if (!a || !b) { changedCompanies.add(tk); structural.push(`${tk}: company added/removed`); continue; }
  const aq = a.quarters || [], bq = b.quarters || [];
  if (aq.length !== bq.length) structural.push(`${tk}: period count ${aq.length} -> ${bq.length}`);
  const n = Math.min(aq.length, bq.length);
  let coChanged = JSON.stringify(a.quarters) !== JSON.stringify(b.quarters);
  for (let i = 0; i < n; i++) {
    if (aq[i].end !== bq[i].end || JSON.stringify(aq[i]) === JSON.stringify(bq[i])) continue;
    coChanged = true;
    for (const f of new Set([...Object.keys(aq[i]), ...Object.keys(bq[i])])) {
      if (JSON.stringify(aq[i][f]) !== JSON.stringify(bq[i][f])) {
        changedCells.push({ ticker: tk, end: aq[i].end, field: f, from: aq[i][f], to: bq[i][f] });
      }
    }
  }
  const metaOf = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'quarters')));
  if (metaOf(a) !== metaOf(b)) { coChanged = true; structural.push(`${tk}: company metadata changed`); }
  if (coChanged) changedCompanies.add(tk);
}

const topChanged = Object.keys(base).filter(k => k !== 'companies' && JSON.stringify(base[k]) !== JSON.stringify(cur[k]));
for (const k of topChanged) structural.push(`top-level '${k}' changed: ${JSON.stringify(base[k])} -> ${JSON.stringify(cur[k])}`);

console.log(`基准 = ${BASE_REF}:data/profit.json (updated ${base.updated})`);
console.log(`工作区 updated = ${cur.updated}`);
console.log(`变化公司 = [${[...changedCompanies].join(', ')}]`);
console.log(`变化单元格 = ${changedCells.length}`);
for (const c of changedCells) console.log(`  ${c.ticker} ${c.end} ${c.field}: ${c.from} -> ${c.to}`);
if (structural.length) { console.log('结构性差异:'); for (const s of structural) console.log('  ' + s); }

const onlyLi = changedCompanies.size === 1 && changedCompanies.has('LI');
const fieldsOk = changedCells.every(c => ['rd', 'sga', 'opInc'].includes(c.field));
const clean = onlyLi && changedCells.length === 12 && fieldsOk && structural.length === 0;
console.log(clean ? 'PASS 只有 LI 的 12 个单元格变化' : 'FAIL 出现预期之外的差异');
process.exit(clean ? 0 : 1);
