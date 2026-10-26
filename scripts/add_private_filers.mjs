#!/usr/bin/env node
// add_private_filers.mjs — append HUAWEI & LEGO (private filers with official audited annual reports)
// APPEND-ONLY: never mutates existing entries; preserves profitPreview/skipped/notes.
import fs from 'node:fs';

const P = 'data/profit.json';
const profit = JSON.parse(fs.readFileSync(P, 'utf8'));
const C = 'data/companies.json';
const companies = JSON.parse(fs.readFileSync(C, 'utf8'));

const FX_CNY = +(1 / 6.677446).toFixed(8);  // open.er-api.com 2026-10-27 snapshot USD/CNY
const FX_DKK = +(1 / 6.67684).toFixed(8);   // open.er-api.com 2026-10-27 snapshot USD/DKK

const q = (end, v) => ({
  end, periodType: 'annual', fxToUsd: v.fx,
  revenue: v.rev, gross: null, opInc: v.op ?? null, netInc: v.ni, rd: v.rd ?? null, sga: null, tax: null,
});

const HUAWEI = [
  // FY CNY-M: revenue / operating profit / net profit / R&D — Huawei annual reports (KPMG-audited, IFRS)
  ['2019-12-31', { rev: 858800, ni: 62700, rd: 131700 }],
  ['2020-12-31', { rev: 891400, ni: 64600, rd: 141900 }],
  ['2021-12-31', { rev: 636807, op: 121412, ni: 113718, rd: 142700 }],
  ['2022-12-31', { rev: 642338, op: 42216, ni: 35562, rd: 161500 }],
  ['2023-12-31', { rev: 704174, op: 104401, ni: 86950, rd: 164700 }],
  ['2024-12-31', { rev: 862072, op: 79361, ni: 62574, rd: 179700 }],
  ['2025-12-31', { rev: 880941, op: 96937, ni: 68036, rd: 192300 }],
].map(([e, v]) => q(e, { ...v, fx: FX_CNY }));

const LEGO = [
  // FY DKK-M: revenue / operating profit / net profit — LEGO Group Annual Reports (audited, IFRS), FY = calendar year
  ['2019-12-31', { rev: 38500, op: 10800, ni: 8300 }],
  ['2020-12-31', { rev: 43700, op: 12900, ni: 4100 }], // 2020 NI hit by one-off tax (LEGO Foundation share transaction)
  ['2021-12-31', { rev: 55300, op: 17000, ni: 13300 }],
  ['2022-12-31', { rev: 64600, op: 17900, ni: 13800 }],
  ['2023-12-31', { rev: 65900, op: 17100, ni: 13100 }],
  ['2024-12-31', { rev: 74300, op: 18700, ni: 13800 }],
].map(([e, v]) => q(e, { ...v, fx: FX_DKK }));

const huaweiNote = `Private filer (unlisted; publishes audited annual reports): companyType=private, synthetic ticker HUAWEI (no real listing). FY=calendar year, IFRS consolidated, audited by KPMG. CNY-M as-reported; opInc/null rd null before FY2021 (2019-2020 operating profit not in official highlights table). R&D 2019/2020/2023/2024/2025 from official annual-report news releases (131.7/141.9/164.7/179.7/192.3 Bn CNY); 2021 142.7 & 2022 161.5 Bn CNY per FY2022 report (bjnews cross-check). FY2021-2025 rev/op/NI from huawei.com bond-investor-relations Financial Highlights five-year table (https://www.huawei.com/en/bond-investor-relations/financial-highlights); FY2019 https://www.huawei.com/en/news/2020/3/Huawei-2019-annual-report; FY2020 https://www.huawei.com/de/news/2021/huawei-schliesst-geschaeftsjahr-2020-mit-umsatz-und-gewinnwachstum-ab. fxToUsd snapshot 1/USD-CNY 6.677446 (open.er-api.com 2026-10-27, single rate).`;
const legoNote = `Private filer (family-owned, unlisted; publishes audited annual reports): companyType=private, synthetic ticker LEGO (no real ticker). FY=calendar year, IFRS, audited (Deloitte). DKK-M as-reported; press-release rounded values (Bn DKK → M). FY2019 https://www.lego.com/aboutus/news/2020/march/annual-results; FY2020 https://www.lego.com/da-dk/aboutus/news/2021/march/2020-annual-results (NI 4.1 Bn DKK one-off tax, LEGO Foundation share transaction); FY2021 https://www.lego.com/da-dk/aboutus/news/2022/march/2021-annual-results; FY2022/FY2023 https://www.lego.com/en-us/aboutus/news/2024/march/lego-delivered-topline-growth-and-outpaced-market-in-2023; FY2024 https://www.lego.com/en-us/aboutus/news/2025/march/lego-group-delivers-record-results-in-2024. fxToUsd snapshot 1/USD-DKK 6.67684 (open.er-api.com 2026-10-27, single rate).`;

if (profit.companies.HUAWEI || profit.companies.LEGO) throw new Error('HUAWEI/LEGO entries already exist — abort');
profit.companies.HUAWEI = {
  name: 'Huawei Technologies Co., Ltd. 华为', currency: 'CNY-M', frequency: 'annual',
  companyType: 'private', quarters: HUAWEI, notes: huaweiNote,
};
profit.companies.LEGO = {
  name: 'LEGO Group (LEGO System A/S) 乐高', currency: 'DKK-M', frequency: 'annual',
  companyType: 'private', quarters: LEGO, notes: legoNote,
};
profit.notes = [...(profit.notes || []),
  'HUAWEI: new private-filer entry (unlisted, official audited annual reports), CNY-M annual FY=Dec, synthetic ticker, 7 FY 2019-2025.',
  'LEGO: new private-filer entry (unlisted, official audited annual reports), DKK-M annual FY=Dec, synthetic ticker, 6 FY 2019-2024.',
  'ByteDance/MiHoYo: NOT added — no official audited public financial statements exist (media-cited internal figures only); out of scope by no-public-filings rule.'];
profit.updated = new Date().toISOString();
fs.writeFileSync(P, JSON.stringify(profit, null, 2));
fs.writeFileSync('data/profit.json.js', 'window.__PROFIT_DATA = ' + JSON.stringify(profit) + ';\n');

const add = (arr, ticker, entry) => {
  if (arr.some(c => c.ticker === ticker)) throw new Error(ticker + ' already in companies.json');
  arr.push(entry);
};
add(companies, 'HUAWEI', {
  ticker: 'HUAWEI', nameZh: '华为', nameEn: 'Huawei Technologies Co., Ltd.',
  color: '#cf0a2c', frequency: 'annual', companyType: 'private',
});
add(companies, 'LEGO', {
  ticker: 'LEGO', nameZh: '乐高', nameEn: 'The LEGO Group',
  color: '#ffcf00', frequency: 'annual', companyType: 'private',
});
fs.writeFileSync(C, JSON.stringify(companies, null, 2));
console.log('added HUAWEI (' + HUAWEI.length + ' FY) and LEGO (' + LEGO.length + ' FY); companies.json total ' + companies.length);
