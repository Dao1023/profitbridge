#!/usr/bin/env node
/**
 * probe_metrics.mjs — 扩展指标层可行性探测器（真实请求，不依赖文档）
 *
 * 用法：
 *   node scripts/probe_metrics.mjs sec MSFT KO CAT
 *   node scripts/probe_metrics.mjs a 600887 600519
 *   node scripts/probe_metrics.mjs hk 0700 0941 0005
 *   node scripts/probe_metrics.mjs dart 005930
 *   node scripts/probe_metrics.mjs all
 *
 * 输出：每个 ticker 的标签/字段覆盖率（年数、区间、最新值），以及分红接口摘要。
 * 原始响应缓存在 tmp-metrics-probe/cache/（可用 --no-cache 强制重取）。
 */
import fs from 'node:fs';
import path from 'node:path';

const CACHE = path.join('tmp-metrics-probe', 'cache');
const argv = process.argv.slice(2);
const NO_CACHE = argv.includes('--no-cache');
const args = argv.filter(a => a !== '--no-cache');
const SEC_UA = { 'User-Agent': 'profitbridge metrics research dao1023@example.com' };
const EM_UA = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://emweb.securities.eastmoney.com/' };

const SEC_CIK = {
  MSFT: 789019, KO: 21344, CAT: 18230, AAPL: 320193, JPM: 19617,
  XOM: 34088, BABA: 1577552, PG: 80424, JNJ: 200406, WMT: 104169,
  TSM: 1046179, SONY: 313838, ASML: 937966, NVDA: 1045810, AMZN: 1018724,
};

/** us-gaap 标签（任务要求的 19 项，含两个分红标签的或关系） */
const SEC_TAGS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'CostOfGoodsAndServicesSold',
  'GrossProfit',
  'OperatingIncomeLoss',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'IncomeTaxExpenseBenefit',
  'NetIncomeLoss',
  'ResearchAndDevelopmentExpense',
  'SellingGeneralAndAdministrativeExpense',
  'Assets',
  'Liabilities',
  'StockholdersEquity',
  'CashAndCashEquivalentsAtCarryingValue',
  'LongTermDebtNoncurrent',
  'NetCashProvidedByUsedInOperatingActivities',
  'PaymentsOfDividends',
  'PaymentsOfDividendsCommonStock',
  'PaymentsForRepurchaseOfCommonStock',
  'PaymentsToAcquirePropertyPlantAndEquipment',
];
const STOCK_TAGS = new Set([
  'Assets', 'Liabilities', 'StockholdersEquity', 'CashAndCashEquivalentsAtCarryingValue',
  'LongTermDebtNoncurrent',
]);

/** A 股三表关键字段（含任务点名口径与常见替代项） */
const A_FIELDS = {
  RPT_F10_FINANCE_GINCOME: [
    'TOTAL_OPERATE_INCOME', 'OPERATE_INCOME', 'OPERATE_COST', 'TOTAL_OPERATE_COST',
    'SALE_EXPENSE', 'MANAGE_EXPENSE', 'RESEARCH_EXPENSE', 'FINANCE_EXPENSE',
    'OPERATE_PROFIT', 'TOTAL_PROFIT', 'INCOME_TAX', 'NETPROFIT', 'PARENT_NETPROFIT',
    'MINORITY_INTEREST', 'BASIC_EPS',
  ],
  RPT_F10_FINANCE_GBALANCE: [
    'TOTAL_ASSETS', 'TOTAL_LIABILITIES', 'TOTAL_EQUITY', 'TOTAL_PARENT_EQUITY',
    'MONETARYFUNDS', 'ACCOUNTS_RECE', 'INVENTORY', 'FIXED_ASSET', 'CIP',
    'GOODWILL', 'SHORT_LOAN', 'LONG_LOAN', 'BOND_PAYABLE', 'LEASE_LIAB',
    'DIVIDEND_PAYABLE', 'TREASURY_SHARES', 'SHARE_CAPITAL', 'CAPITAL_RESERVE',
    'SURPLUS_RESERVE', 'UNASSIGN_RPOFIT',
  ],
  RPT_F10_FINANCE_GCASHFLOW: [
    'NETCASH_OPERATE', 'NETCASH_INVEST', 'NETCASH_FINANCE',
    'CONSTRUCT_LONG_ASSET', 'ASSIGN_DIVIDEND_PORFIT', 'PAY_ALL_TAX', 'END_CCE',
  ],
};
/** 国企专属关键词：在四张 A 股表的全部字段名里扫描 */
const SOE_HINTS = /(STATE_OWNED|STATE_CONTROLLED|SASAC|GUOZHI|国有|上缴|PROFIT_PAY|PAY_PROFIT|REMITTANCE|CAPITAL_GAIN)/i;

const SEC_ANNUAL_FORMS = /^(10-K|20-F|40-F)$/;

function cachePath(name) {
  return path.join(CACHE, name.replace(/[^\w.-]+/g, '_'));
}
async function fetchJson(url, name, headers = EM_UA, { force = false } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = cachePath(name);
  if (!NO_CACHE && !force && fs.existsSync(f)) {
    return { json: JSON.parse(fs.readFileSync(f, 'utf8')), cached: true, http: 200 };
  }
  const t0 = Date.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
  fs.writeFileSync(f, JSON.stringify(json));
  return { json, cached: false, http: res.status, ms: Date.now() - t0 };
}

/* ------------------------------- SEC ------------------------------- */
/** us-gaap 标签 -> IFRS/别名映射（20-F 用 ifrs-full，且各家用词不同） */
const SEC_ALT = {
  Revenues: { ifrs: 'Revenue', usgaap: ['RevenueFromContractWithCustomerExcludingAssessedTax'] },
  RevenueFromContractWithCustomerExcludingAssessedTax: { ifrs: 'Revenue' },
  CostOfGoodsAndServicesSold: { ifrs: 'CostOfSales', usgaap: ['CostOfRevenue', 'CostOfGoodsSold'] },
  GrossProfit: { ifrs: 'GrossProfit' },
  OperatingIncomeLoss: { ifrs: 'ProfitLossFromOperatingActivities' },
  IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: { ifrs: 'ProfitLossBeforeTax' },
  IncomeTaxExpenseBenefit: { ifrs: 'IncomeTaxExpenseContinuingOperations' },
  NetIncomeLoss: { ifrs: 'ProfitLoss', usgaap: ['ProfitLoss'] },
  ResearchAndDevelopmentExpense: { ifrs: 'ResearchAndDevelopmentExpense' },
  SellingGeneralAndAdministrativeExpense: {
    ifrs: 'AdministrativeExpense',
    usgaap: ['SellingAndMarketingExpense', 'GeneralAndAdministrativeExpense'],
  },
  Assets: { ifrs: 'Assets' },
  Liabilities: { ifrs: 'Liabilities' },
  StockholdersEquity: {
    ifrs: 'Equity',
    usgaap: ['StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  },
  CashAndCashEquivalentsAtCarryingValue: { ifrs: 'CashAndCashEquivalents' },
  LongTermDebtNoncurrent: { ifrs: 'BorrowingsNoncurrent' },
  NetCashProvidedByUsedInOperatingActivities: { ifrs: 'CashFlowsFromUsedInOperatingActivities' },
  PaymentsOfDividends: { ifrs: 'DividendsPaid' },
  PaymentsOfDividendsCommonStock: { ifrs: 'DividendsPaid', usgaap: ['PaymentsOfDividends'] },
  PaymentsForRepurchaseOfCommonStock: { ifrs: 'PaymentsToAcquireOrRedeemEntitysShares' },
  PaymentsToAcquirePropertyPlantAndEquipment: {
    ifrs: 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
  },
};

/** 在 us-gaap / ifrs-full 及别名里找“覆盖最新年份最多”的标签 */
function factCandidates(raw, tag) {
  const out = [];
  const alt = SEC_ALT[tag] || {};
  for (const ns of ['us-gaap', 'ifrs-full']) out.push([ns, tag]);
  if (alt.ifrs) out.push(['ifrs-full', alt.ifrs]);
  for (const n of alt.usgaap || []) out.push(['us-gaap', n]);
  return out;
}

function annualRows(facts, tag, unit, { dedupe = true } = {}) {
  const rows = (facts.units?.[unit] || [])
    .filter(v => SEC_ANNUAL_FORMS.test(v.form) && v.fp === 'FY')
    .filter(v => {
      if (!STOCK_TAGS.has(tag)) {
        if (!v.start || !v.end) return false;
        const days = (Date.parse(v.end) - Date.parse(v.start)) / 864e5;
        if (days < 340 || days > 380) return false; // 排除季度/半年累计
      }
      return true;
    });
  if (!dedupe) return rows;
  const byEnd = new Map();
  for (const v of rows) {
    const prev = byEnd.get(v.end);
    if (!prev || String(v.filed) > String(prev.filed)) byEnd.set(v.end, v);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

/** 选标签：优先最新年度更晚的，其次年数更多的（SONY: us-gaap 到 2021，ifrs 到 2025） */
function pickFacts(raw, tag, unit) {
  let best = null;
  for (const [ns, name] of factCandidates(raw, tag)) {
    const f = raw.facts?.[ns]?.[name];
    if (!f?.units?.[unit]) continue;
    const rows = annualRows(f, tag, unit);
    if (!rows.length) continue;
    const score = [rows.at(-1).end, rows.length];
    if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
      best = { facts: f, ns, name, rows, score };
    }
  }
  return best;
}

function secAnnual(raw, tag, reportingUnit) {
  const found = pickFacts(raw, tag, reportingUnit);
  if (!found) return null;
  const rows = found.rows;
  const ends = rows.map(v => v.end);
  return {
    unit: reportingUnit, n: ends.length, first: ends[0], last: ends.at(-1),
    latest: rows.at(-1).val,
    years: ends.map(e => e.slice(0, 4)),
    alias: found.name === tag ? null : found.name,
  };
}

/** 报告币种：取 Assets 事实里年度条数最多的单位（BABA 有 CNY/USD 双列） */
function reportingUnitOf(raw) {
  const units = [];
  for (const ns of ['us-gaap', 'ifrs-full']) {
    const f = raw.facts?.[ns]?.Assets;
    if (!f?.units) continue;
    for (const [u, rows] of Object.entries(f.units)) {
      units.push([u, rows.filter(v => SEC_ANNUAL_FORMS.test(v.form) && v.fp === 'FY').length]);
    }
  }
  units.sort((a, b) => b[1] - a[1]);
  return units[0]?.[0] || 'USD';
}

async function probeSec(tickers) {
  console.log('\n## SEC companyfacts (10-K/20-F/40-F, fp=FY; us-gaap 或 ifrs-full)');
  const summary = {};
  for (const tk of tickers) {
    const cik = SEC_CIK[tk.toUpperCase()] || (/^\d{10}$/.test(tk) ? Number(tk) : null);
    if (!cik) { console.log(`\n### ${tk}: 未知 ticker（请在 SEC_CIK 表补充 CIK）`); continue; }
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`;
    const { json: raw, http, ms, cached } = await fetchJson(url, `sec_${tk}.json`, SEC_UA);
    if (!raw.facts) { console.log(`\n### ${tk}: 请求失败 HTTP ${http}`); continue; }
    const reportingUnit = reportingUnitOf(raw);
    const nsUsed = ['us-gaap', 'ifrs-full'].filter(ns => raw.facts[ns]).join('+');
    console.log(`\n### ${tk} ${raw.entityName}  CIK=${cik}  currency=${reportingUnit}  ns=${nsUsed}  ` +
      `${cached ? 'cache' : `live ${http} ${ms}ms`}  size=${(JSON.stringify(raw).length / 1048576).toFixed(1)}MB`);
    const rows = {};
    for (const tag of SEC_TAGS) {
      const r = secAnnual(raw, tag, reportingUnit);
      rows[tag] = r;
      const alias = r?.alias ? ` [别名 ${r.alias}]` : '';
      console.log(`  ${tag.padEnd(78)} ${r ? `${r.unit} n=${String(r.n).padStart(2)} ${r.first}..${r.last} latest=${fmt(r.latest)}${alias}` : 'MISSING'}`);
    }
    // 推导项：标签缺失时的兜底口径
    const rev = secAnnual(raw, 'Revenues', reportingUnit) || secAnnual(raw, 'RevenueFromContractWithCustomerExcludingAssessedTax', reportingUnit);
    const cogs = secAnnual(raw, 'CostOfGoodsAndServicesSold', reportingUnit);
    const assets = secAnnual(raw, 'Assets', reportingUnit);
    const liab = secAnnual(raw, 'Liabilities', reportingUnit);
    const eq = secAnnual(raw, 'StockholdersEquity', reportingUnit);
    if (!rows.GrossProfit && rev && cogs) console.log(`  → 可推导 GrossProfit = Revenues(${rev.n}) - COGS(${cogs.n})`);
    if (!liab && assets && eq) console.log(`  → 可推导 Liabilities = Assets(${assets.n}) - Equity(${eq.n})`);
    if (!eq && assets && liab) console.log(`  → 可推导 Equity = Assets(${assets.n}) - Liabilities(${liab.n})`);
    summary[tk] = { entityName: raw.entityName, currency: reportingUnit, rows };
  }
  return summary;
}

/* ------------------------------- 东财 A 股 ------------------------------- */
const EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
async function emGet(reportName, filter, pageSize = 500, name) {
  const p = new URLSearchParams({ reportName, columns: 'ALL', filter, pageNumber: '1', pageSize: String(pageSize) });
  return fetchJson(`${EM_BASE}?${p}`, name || `em_${reportName}_${filter.replace(/\W+/g, '')}.json`);
}
/** 拉全分页（东财单页上限 5000；港股单公司可达数千行） */
async function emGetAll(reportName, filter, name, pageSize = 5000) {
  const first = await emGet(reportName, filter, pageSize, `${name}_p1.json`);
  const pages = first.json.result?.pages || 1;
  const all = [...(first.json.result?.data || [])];
  for (let i = 2; i <= pages; i++) {
    const p = new URLSearchParams({ reportName, columns: 'ALL', filter, pageNumber: String(i), pageSize: String(pageSize) });
    const { json } = await fetchJson(`${EM_BASE}?${p}`, `${name}_p${i}.json`);
    all.push(...(json.result?.data || []));
  }
  return all;
}
const aSuffix = code => code.startsWith('6') ? 'SH' : code.startsWith(('0')) || code.startsWith('3') ? 'SZ' : 'BJ';

async function probeA(codes) {
  console.log('\n## 东方财富 A 股三表 + 分红（RPT_F10_FINANCE_G*/RPT_SHAREBONUS_DET）');
  const summary = {};
  for (const code of codes) {
    const secucode = `${code}.${aSuffix(code)}`;
    console.log(`\n### ${code} (${secucode})`);
    const tables = {};
    for (const [rn, fields] of Object.entries(A_FIELDS)) {
      const { json, http } = await emGet(rn, `(SECUCODE="${secucode}")`, 500, `em_${rn}_${code}.json`);
      const data = json.result?.data || [];
      if (!data.length) { console.log(`  ${rn}: 无数据 HTTP ${http} ${json.message || ''}`); continue; }
      data.sort((a, b) => String(a.REPORT_DATE).localeCompare(String(b.REPORT_DATE)));
      const types = [...new Set(data.map(x => x.REPORT_TYPE))];
      console.log(`  ${rn}: ${data.length} 行, REPORT_TYPE=${JSON.stringify(types)}, ${data[0].REPORT_DATE?.slice(0, 10)} .. ${data.at(-1)?.REPORT_DATE?.slice(0, 10)}`);
      const cov = {};
      for (const f of fields) {
        const nonnull = data.filter(x => x[f] != null).length;
        const annual = data.filter(x => x.REPORT_TYPE === '年报' && x[f] != null);
        cov[f] = { nonnull, total: data.length, annual: annual.length, latest: annual.at(-1)?.[f] ?? null };
        console.log(`    ${f.padEnd(30)} 非空 ${String(nonnull).padStart(3)}/${data.length}  年报 ${String(annual.length).padStart(2)}  最新年报=${fmt(cov[f].latest)}`);
      }
      // 国企专属字段名扫描（A 股四张表全部字段）
      const soe = Object.keys(data[0]).filter(k => SOE_HINTS.test(k));
      console.log(`    国企关键词字段命中: ${soe.length ? soe.join(',') : '无'}`);
      tables[rn] = { rows: data.length, types, cov, soeFields: soe };
    }
    // 分红
    const { json: dj } = await emGet('RPT_SHAREBONUS_DET', `(SECURITY_CODE="${code}")`, 500, `em_div_${code}.json`);
    const div = dj.result?.data || [];
    div.sort((a, b) => String(a.REPORT_DATE).localeCompare(String(b.REPORT_DATE)));
    const implemented = div.filter(x => x.ASSIGN_PROGRESS === '实施分配');
    console.log(`  RPT_SHAREBONUS_DET: ${div.length} 条, 实施分配 ${implemented.length}, ` +
      `${div.at(-1)?.REPORT_DATE?.slice(0, 10)} .. ${div[0]?.REPORT_DATE?.slice(0, 10)}`);
    console.log(`    每股派息字段 PRETAX_BONUS_RMB 非空 ${div.filter(x => x.PRETAX_BONUS_RMB != null).length}; ` +
      `TOTAL_SHARES 非空 ${div.filter(x => x.TOTAL_SHARES != null).length}; ` +
      `EX_DIVIDEND_DATE 非空 ${div.filter(x => x.EX_DIVIDEND_DATE).length}`);
    for (const r of implemented.slice(0, 3)) {
      console.log(`    样例 ${r.REPORT_DATE?.slice(0, 10)} ${r.ASSIGN_PROGRESS} ${r.IMPL_PLAN_PROFILE} 每股派(元/10股)=${r.PRETAX_BONUS_RMB} 总股本=${fmt(r.TOTAL_SHARES)} 除权日=${r.EX_DIVIDEND_DATE?.slice(0, 10)}`);
    }
    summary[code] = { secucode, tables, dividend: { rows: div.length, implemented: implemented.length } };
  }
  return summary;
}

/* ------------------------------- 东财港股 ------------------------------- */
const HK_TABLES = {
  RPT_HKF10_FN_INCOME_PC: '利润表',
  RPT_HKF10_FN_BALANCE_PC: '资产负债表',
  RPT_HKF10_FN_CASHFLOW_PC: '现金流量表',
  RPT_HKF10_FN_MAININDICATOR: '主要指标',
};
const hkCode = c => String(c).replace(/\.HK$/i, '').padStart(5, '0');

async function probeHk(codes) {
  console.log('\n## 东方财富港股 F10（*_PC 系列 + RPT_HKF10_MAIN_DIVBASIC）');
  const summary = {};
  for (const code of codes) {
    const h = hkCode(code);
    console.log(`\n### ${h}.HK`);
    const out = {};
    // 报告币种：MAININDICATOR.CURRENCY 是交易币种（HKD），必须从非 _PC 报表取
    const curRows = await emGetAll('RPT_HKF10_FN_INCOME', `(SECUCODE="${h}.HK")`, `hk_cur_${h}`);
    curRows.sort((a, b) => String(a.REPORT_DATE).localeCompare(String(b.REPORT_DATE)));
    const reportingCurrency = curRows.at(-1)?.CURRENCY || '?';
    console.log(`  报告币种(非_PC INCOME)=${reportingCurrency} (${curRows.at(-1)?.CURRENCY_CODE})，最新期=${curRows.at(-1)?.REPORT_DATE?.slice(0, 10)}`);
    // 主要指标（OCF/ICF/FCF、DPS；CURRENCY 是交易币种）
    const mrows = await emGetAll('RPT_HKF10_FN_MAININDICATOR', `(SECUCODE="${h}.HK")`, `hk_main_${h}`);
    mrows.sort((a, b) => String(a.REPORT_DATE).localeCompare(String(b.REPORT_DATE)));
    const annualM = mrows.filter(x => x.REPORT_TYPE?.includes('年报'));
    console.log(`  MAININDICATOR: ${mrows.length} 行, 年报 ${annualM.length}, 币种=${mrows[0]?.CURRENCY || '?'}`);
    for (const f of ['OPERATE_INCOME', 'GROSS_PROFIT', 'OPERATE_PROFIT', 'PRETAX_PROFIT', 'HOLDER_PROFIT',
      'TOTAL_ASSETS', 'TOTAL_LIABILITIES', 'TOTAL_PARENT_EQUITY', 'NETCASH_OPERATE', 'NETCASH_INVEST',
      'NETCASH_FINANCE', 'END_CASH', 'DIVI_RATIO', 'DIVIDEND_RATE', 'DPS_HKD']) {
      const nn = annualM.filter(x => x[f] != null).length;
      console.log(`    ${f.padEnd(22)} 年报非空 ${String(nn).padStart(2)}/${annualM.length} 最新=${fmt(annualM.at(-1)?.[f])}`);
    }
    out.main = { rows: mrows.length, annual: annualM.length, currency: mrows[0]?.CURRENCY };

    for (const [rn, label] of Object.entries(HK_TABLES)) {
      if (rn === 'RPT_HKF10_FN_MAININDICATOR') continue;
      const data = await emGetAll(rn, `(SECUCODE="${h}.HK")`, `hk_${h}_${rn}`);
      if (!data.length) { console.log(`  ${label} ${rn}: 无数据`); continue; }
      data.sort((a, b) => String(a.REPORT_DATE).localeCompare(String(b.REPORT_DATE)));
      const annual = data.filter(x => x.DATE_TYPE_CODE === '001');
      const items = [...new Set(annual.map(x => x.STD_ITEM_NAME))];
      const years = [...new Set(annual.map(x => x.REPORT_DATE?.slice(0, 4)))].sort();
      console.log(`  ${label} ${rn}: ${data.length} 行, 年报 ${annual.length} 行 / ${years.length} 个年度 (${years[0]}..${years.at(-1)}), 科目 ${items.length} 个`);
      console.log(`    科目示例: ${items.slice(0, 12).join(' / ')}`);
      out[label] = { rows: data.length, annualRows: annual.length, years: years.length, firstYear: years[0], lastYear: years.at(-1), items };
    }
    // 港股分红
    const div = await emGetAll('RPT_HKF10_MAIN_DIVBASIC', `(SECURITY_CODE="${h}")(IS_BFP="0")`, `hk_div_${h}`);
    div.sort((a, b) => String(a.YEAR).localeCompare(String(b.YEAR)));
    console.log(`  分红 RPT_HKF10_MAIN_DIVBASIC: ${div.length} 条, 年度分配 ${div.filter(x => x.REPORT_TYPE === '年度分配').length}`);
    for (const r of div.slice(-3)) {
      console.log(`    样例 ${r.YEAR} ${r.REPORT_TYPE} ${r.PLAN_EXPLAIN} 除净日=${r.EX_DIVIDEND_DATE} 发放日=${r.DIVIDEND_DATE}`);
    }
    out.dividend = { rows: div.length, sample: div.slice(0, 3) };
    summary[h] = out;
  }
  return summary;
}

/* ------------------------------- DART ------------------------------- */
async function probeDart(codes) {
  console.log('\n## DART (韩国)');
  const key = process.env.DART_API_KEY || '';
  const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${key}&corp_code=00126380`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  console.log(`  GET opendart company.json -> HTTP ${res.status} status=${json.status} message=${json.message}`);
  console.log(json.status === '000' ? '  API key 有效，可继续取 fnlttSinglAcnt' : '  无有效 key：DART 结构化财报需 OpenDART 认证 key（免费注册），本次未验证');
  return { status: json.status, message: json.message };
}

function fmt(v) {
  if (v == null) return 'null';
  if (typeof v !== 'number') return String(v);
  return Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + 'e8' : String(v);
}

/* ------------------------------- main ------------------------------- */
const mode = (args.shift() || 'all').toLowerCase();
if (mode === 'sec') await probeSec(args.length ? args : ['MSFT', 'KO', 'CAT']);
else if (mode === 'a') await probeA(args.length ? args : ['600887', '600519']);
else if (mode === 'hk') await probeHk(args.length ? args : ['0700', '0941', '0005']);
else if (mode === 'dart') await probeDart(args);
else if (mode === 'all') {
  await probeSec(['MSFT', 'KO', 'CAT']);
  await probeA(['600887', '600519']);
  await probeHk(['0700', '0941', '0005']);
  await probeDart([]);
} else {
  console.log('用法: node scripts/probe_metrics.mjs [sec|a|hk|dart|all] [ticker...]');
  process.exit(1);
}
