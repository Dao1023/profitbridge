// 显式修复脚本：NESN.SW / MC.PA 分部值「二次换算」回退（2026-11-20）
//
// 背景（证据链）：
//   - tmp-seg-plan/cache_D2/assemble_d2.py 以 native 原币值 round(v * 快照fx, 2) 生成 D2 staging，
//     快照fx = profit.json 2025-12-31 的 fxToUsd（NESN 1.21274155 / MC 1.12091287），全期同值。
//     即 staging 里的 value 已经是 USD $M。
//   - commit c20be5d 又把这些已是 USD 的 value 当作 CHF/EUR 再乘一次同一快照fx -> 双重换算。
//     反算证据：旧值 / 快照fx^2 == native 整数（NESN 2023 合计 92998、MC 2022 合计 79184 等）。
//   - 2026-10-30 的 fixup 只把 profit.json 还原为本币并给了逐期 fx，segments 没跟着改。
//
// 本脚本：value = round(native 原币披露值 * 该期 profit.json fxToUsd, 2)，
//   currencyNote 改写为该期真实 fx；同时重建 data/segments.json.js 镜像并断言深度相等。
// 幂等：已是目标值的期次跳过（重复执行零变化）。
//
// native 原币值来源：Nestle Annual Review 2024/2025 与 LVMH URD 2025 的「按产品/业务组分收入」表
//   （已用 pdftotext 复核：Nestle 2023 92,998 / 2024 91,354 / 2025 89,490 CHF m；
//    LVMH 2022 79,184 / 2023 86,153 / 2024 84,683 / 2025 80,807 EUR m，均与年报 Total 一致）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const W = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const norm = o => {
  if (Array.isArray(o)) return o.map(norm);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o).sort()) r[k] = norm(o[k]); return r; }
  return o;
};
const deepEqual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const r2 = x => Math.round(x * 100) / 100;

// ---- native 披露值（原币，百万） ----
const NATIVE = {
  'NESN.SW': {
    cur: 'CHF',
    periods: {
      '2023-12-31': [
        ['Powdered and Liquid Beverages', 24786], ['Water', 3320], ['Milk products and Ice cream', 10981],
        ['Nutrition and Health Science', 15278], ['Prepared dishes and cooking aids', 11666],
        ['Confectionery', 8107], ['PetCare', 18860],
      ],
      '2024-12-31': [
        ['Powdered and Liquid Beverages', 24598], ['Water', 3180], ['Milk products and Ice cream', 10397],
        ['Nutrition and Health Science', 15137], ['Prepared dishes and cooking aids', 10711],
        ['Confectionery', 8449], ['PetCare', 18882],
      ],
      '2025-12-31': [
        ['Powdered and Liquid Beverages', 25144], ['Water', 3128], ['Milk products and Ice cream', 9698],
        ['Nutrition and Health Science', 14304], ['Prepared dishes and cooking aids', 10114],
        ['Confectionery', 8696], ['PetCare', 18406],
      ],
    },
  },
  'MC.PA': {
    cur: 'EUR',
    periods: {
      '2022-12-31': [
        ['Wines and Spirits', 7099], ['Fashion and Leather Goods', 38648], ['Perfumes and Cosmetics', 7722],
        ['Watches and Jewelry', 10581], ['Selective Retailing', 14852], ['Other activities and eliminations', 282],
      ],
      '2023-12-31': [
        ['Wines and Spirits', 6602], ['Fashion and Leather Goods', 42169], ['Perfumes and Cosmetics', 8271],
        ['Watches and Jewelry', 10902], ['Selective Retailing', 17885], ['Other activities and eliminations', 324],
      ],
      '2024-12-31': [
        ['Wines and Spirits', 5862], ['Fashion and Leather Goods', 41060], ['Perfumes and Cosmetics', 8418],
        ['Watches and Jewelry', 10577], ['Selective Retailing', 18262], ['Other activities and eliminations', 504],
      ],
      '2025-12-31': [
        ['Wines and Spirits', 5358], ['Fashion and Leather Goods', 37770], ['Perfumes and Cosmetics', 8174],
        ['Watches and Jewelry', 10486], ['Selective Retailing', 18348], ['Other activities and eliminations', 671],
      ],
    },
  },
};

const SEG = J('data/segments.json');
const PROF = J('data/profit.json');
const out = [];
let changed = 0, skipped = 0;

for (const [tk, spec] of Object.entries(NATIVE)) {
  const co = SEG.companies[tk];
  if (!co || !co.quarters) throw new Error(`${tk}: no quarters in segments.json`);
  const profitRows = new Map((PROF.companies[tk].quarters || []).map(q => [q.end, q]));
  for (const [end, items] of Object.entries(spec.periods)) {
    const rows = co.quarters[end];
    if (!rows) throw new Error(`${tk} ${end}: missing in segments.json`);
    const p = profitRows.get(end);
    if (!p) throw new Error(`${tk} ${end}: missing in profit.json`);
    if (typeof p.fxToUsd !== 'number') throw new Error(`${tk} ${end}: no fxToUsd`);
    if (p.periodType && p.periodType !== 'annual') throw new Error(`${tk} ${end}: profit periodType=${p.periodType}`);
    if (rows.length !== items.length) throw new Error(`${tk} ${end}: segment count ${rows.length} != native ${items.length}`);
    const fx = p.fxToUsd;
    const note = `converted from ${spec.cur} at period-end ECB fxToUsd ${fx}`;
    const oldSum = rows.reduce((a, r) => a + r.value, 0);
    const rec = { tk, end, fx, rev: p.revenue, oldSum, newSum: 0, rows: [] };
    items.forEach(([name, nat], i) => {
      const row = rows[i];
      if (row.name !== name) throw new Error(`${tk} ${end}[${i}]: name '${row.name}' != '${name}'`);
      const nv = r2(nat * fx);
      rec.rows.push({ name, nat, old: row.value, next: nv });
      if (row.value !== nv) changed++; else skipped++;
      row.value = nv;
      row.currencyNote = note;
      rec.newSum += nv;
    });
    rec.newSum = r2(rec.newSum);
    rec.nativeSum = items.reduce((a, [, v]) => a + v, 0);
    rec.oldRatio = oldSum / (p.revenue * fx);
    rec.newRatio = rec.newSum / (p.revenue * fx);
    rec.nativeDev = rec.nativeSum / p.revenue - 1;
    out.push(rec);
  }
}

// ---------- 审计备注 ----------
const NOTE_NESN = 'NESN.SW: 2023-2025 分部值此前被二次换算（D2 staging 已是 USD，又被当作 CHF 再乘一次快照 fx 1.21274155），2026-11-20 按 native CHF 披露值 × 该期 profit.json fxToUsd 重算；合计与 Annual Review 的 Total sales 完全一致（92,998 / 91,354 / 89,490 CHF m）。';
const NOTE_MC = 'MC.PA: 2022-2025 分部值此前被二次换算（D2 staging 已是 USD，又被当作 EUR 再乘一次快照 fx 1.12091287），2026-11-20 按 native EUR 披露值 × 该期 profit.json fxToUsd 重算；合计与 URD 的 Total revenue 完全一致（79,184 / 86,153 / 84,683 / 80,807 EUR m）。';
SEG.notes = SEG.notes || [];
for (const n of [NOTE_NESN, NOTE_MC]) if (!SEG.notes.includes(n)) SEG.notes.push(n);
SEG.updated = '2026-11-20';

// ---------- 写盘 + 镜像断言 ----------
W('data/segments.json', JSON.stringify(SEG, null, 2) + '\n');
W('data/segments.json.js', 'window.__SEGMENT_DATA = ' + JSON.stringify(SEG) + ';\n');
const mirror = fs.readFileSync(path.join(ROOT, 'data/segments.json.js'), 'utf8');
const m = mirror.match(/^window\.__SEGMENT_DATA\s*=\s*([\s\S]*);\s*$/);
if (!m) throw new Error('segments.json.js mirror format unexpected');
if (!deepEqual(JSON.parse(m[1]), SEG)) throw new Error('segments.json.js mirror != segments.json');

// ---------- 报告 ----------
console.log('==== NESN.SW / MC.PA 分部按同期 fxToUsd 重算 ====');
for (const r of out) {
  console.log(`\n${r.tk} ${r.end}  fx=${r.fx}  rev=${r.rev}  nativeSum=${r.nativeSum}  nativeDev=${(r.nativeDev * 100).toFixed(3)}%`);
  console.log(`  oldSum=${r.oldSum.toFixed(1)}  newSum=${r.newSum.toFixed(1)}  oldRatio=${r.oldRatio.toFixed(5)}  newRatio=${r.newRatio.toFixed(5)}`);
  for (const x of r.rows) {
    console.log(`    ${x.name.padEnd(34)} native=${String(x.nat).padStart(6)}  old=${String(x.old).padStart(9)}  new=${String(x.next).padStart(9)}  old/rev=${(x.old / (r.rev * r.fx)).toFixed(4)}  new/rev=${(x.next / (r.rev * r.fx)).toFixed(4)}`);
  }
}
console.log(`\nchanged=${changed} skipped=${skipped}`);
console.log('WROTE data/segments.json + data/segments.json.js ; mirror deepEqual=true');
