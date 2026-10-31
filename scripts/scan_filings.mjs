#!/usr/bin/env node
/**
 * scan_filings.mjs — 每日新财报扫描（只读，绝不修改 data/ 下任何文件）
 *
 * 目的：每天检查 profitbridge 已收录公司是否已有「站内还没有的新报告期」披露出来，
 *      输出一份待办清单，供人或 Agent 决定是否补入。
 *
 * 数据源（均为免费公开）：
 *   - A 股：东财 datacenter RPT_F10_FINANCE_GINCOME（累计值，NOTICE_DATE 为公告日）
 *   - 港股：东财 datacenter RPT_HKF10_FN_MAININDICATOR
 *   - 美股/欧股/台股等有 CIK 的公司：SEC EDGAR submissions API（filings.recent）
 *   - 无 CIK 且非 A/H 股（私有公司、KR 等）：标记 skipped，人工关注
 *
 * 判定「新期」：源站最新可用报告期 end > 站内该公司最大 end。
 * 判定「补字段候选」：源站最新期 == 站内最大 end，但站内该期有字段为空而源站有值。
 *   —— 只对 A 股做（东财字段齐全；港股/美股缺失多为结构性不上报，天天报会成噪音）。
 *   —— 降噪：若某字段在最近 3 期都缺失（长期结构性缺失），归入 longTermMissing 只统计，
 *      不进 fillCandidates；只报「最新期新出现的缺失」。
 *
 * SEC 必须分两类：
 *   - 10-Q/10-K/20-F/40-F（SEC_PERIODIC）的 reportDate 是真报告期末 → 用于判「新期」。
 *   - 6-K 的 reportDate 恒等于 filingDate，不能当期末 → 只作「公告提醒」filingAlerts
 *     （近 SIXK_ALERT_DAYS 天内提交的 6-K，按 ticker 聚合，列最近 3 个 filingDate）。
 *
 * 用法：
 *   node scripts/scan_filings.mjs                  # 人读摘要
 *   node scripts/scan_filings.mjs --json           # 机器可读 JSON（stdout）
 *   node scripts/scan_filings.mjs --out out.json   # 同时写文件（自动建目录）
 *
 * 退出码：0 = 扫描完成（无论有无新披露）；1 = 扫描本身失败（读取/结构异常）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFIT = path.join(ROOT, 'data', 'profit.json');

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const outIdx = argv.indexOf('--out');
const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

const UA = 'profitbridge-scan/1.0 (contact: local)';
const SEC_UA = 'profitbridge scan admin@example.com';
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.SCAN_CONCURRENCY || 6)));
const REQ_GAP_MS = Number(process.env.SCAN_GAP_MS || 120);
const nowISO = new Date().toISOString();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, { tries = 3, headers = {}, timeoutMs = 20000 } = {}) {
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 404) {
        const e = new Error('HTTP 404 not found');
        e.fatal = true;
        throw e;
      }
      if (!r.ok) {
        lastErr = 'HTTP ' + r.status;
        if (i < tries - 1) await sleep(600 * (i + 1));
        continue;
      }
      return await r.json();
    } catch (e) {
      if (e && e.fatal) throw e;
      lastErr = e && e.message ? e.message : String(e);
      if (i < tries - 1) await sleep(800 * (i + 1));
    }
  }
  throw new Error(lastErr || 'fetch failed');
}

/* ---------------- 市场归类 ---------------- */
function marketOf(ticker) {
  if (/\.(SS|SH|SZ)$/i.test(ticker)) return 'A';
  if (/^[0-9]{4,5}\.HK$/i.test(ticker)) return 'HK';
  if (/\.KS$/i.test(ticker)) return 'KR';
  if (/\.TW$/i.test(ticker)) return 'TW';
  if (/\.(SW|PA|DE|L|AS|MI)$/i.test(ticker)) return 'EU';
  return 'US';
}
function eastmoneyCode(ticker) {
  const t = ticker.toUpperCase();
  if (/\.SS$/.test(t)) return t.replace(/\.SS$/, '.SH');
  return t; // .SH / .SZ / .HK 直接可用
}
const missingField = (obj, f) => !obj || obj[f] === undefined || obj[f] === null;

/* ---------------- 数据源探测 ---------------- */
async function probeA(ticker) {
  const secu = eastmoneyCode(ticker);
  const base = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
  const u = `${base}?reportName=RPT_F10_FINANCE_GINCOME&columns=ALL`
    + `&filter=${encodeURIComponent(`(SECUCODE="${secu}")`)}`
    + '&pageNumber=1&pageSize=2&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC';
  const j = await getJSON(u);
  const rows = (j && j.result && j.result.data) || [];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    latestEnd: String(r.REPORT_DATE).slice(0, 10),
    latestNotice: r.NOTICE_DATE ? String(r.NOTICE_DATE).slice(0, 10) : null,
    reportType: r.REPORT_DATE_NAME || r.REPORT_TYPE || null,
    has: {
      revenue: typeof r.TOTAL_OPERATE_INCOME === 'number',
      gross: typeof r.OPERATE_COST === 'number',
      opInc: typeof r.OPERATE_PROFIT === 'number',
      netInc: typeof r.PARENT_NETPROFIT === 'number',
      rd: typeof r.RESEARCH_EXPENSE === 'number',
      sga: typeof r.SALE_EXPENSE === 'number' && typeof r.MANAGE_EXPENSE === 'number',
    },
  };
}

async function probeHK(ticker) {
  const secu = ticker.toUpperCase();
  const base = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
  const u = `${base}?reportName=RPT_HKF10_FN_MAININDICATOR&columns=ALL`
    + `&filter=${encodeURIComponent(`(SECUCODE="${secu}")`)}`
    + '&pageNumber=1&pageSize=2&sortTypes=-1&sortColumns=REPORT_DATE&source=F10&client=PC';
  const j = await getJSON(u);
  const rows = (j && j.result && j.result.data) || [];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    latestEnd: String(r.REPORT_DATE).slice(0, 10),
    latestNotice: r.NOTICE_DATE ? String(r.NOTICE_DATE).slice(0, 10) : null,
    reportType: r.REPORT_TYPE || r.DATE_TYPE_CODE_NAME || r.DATE_TYPE_CODE || null,
    has: { revenue: true, gross: true, opInc: true, netInc: true, rd: true, sga: true },
  };
}

const SEC_PERIODIC = new Set(['10-Q', '10-K', '20-F', '40-F']);
const SIXK_ALERT_DAYS = 21;
async function probeSEC(cik) {
  const u = `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
  const j = await getJSON(u, { tries: 3, headers: { 'User-Agent': SEC_UA } });
  const rec = (j && j.filings && j.filings.recent) || null;
  if (!rec || !rec.form) return null;
  let best = null;
  const sixK = [];
  const cutoff = new Date(Date.now() - SIXK_ALERT_DAYS * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < rec.form.length; i++) {
    const form = rec.form[i];
    const rd = rec.reportDate && rec.reportDate[i];
    const fd = rec.filingDate && rec.filingDate[i];
    if (form === '6-K' && fd && fd >= cutoff) {
      sixK.push({ filingDate: fd, accession: rec.accessionNumber ? rec.accessionNumber[i] : null });
    }
    if (!SEC_PERIODIC.has(form)) continue;       // 6-K/8-K/10-Q/A… 不参与「新期」判定
    if (!rd || rd.length !== 10) continue;
    if (!best || rd > best.end) best = { end: rd, form, filingDate: fd || null };
  }
  sixK.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  if (!best && !sixK.length) return null;
  return {
    periodic: best ? {
      latestEnd: best.end,
      latestNotice: best.filingDate,
      reportType: best.form,
      has: { revenue: true, gross: true, opInc: true, netInc: true, rd: true, sga: true },
    } : null,
    sixK,
  };
}

/* ---------------- 主流程 ---------------- */
function lastNQuarters(co, n) {
  const qs = (co.quarters || []).slice().sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  return qs.slice(-n);
}

async function main() {
  if (!fs.existsSync(PROFIT)) throw new Error('profit.json not found at ' + PROFIT);
  const P = JSON.parse(fs.readFileSync(PROFIT, 'utf8'));
  const tickers = Object.keys(P.companies || {}).sort();
  if (!tickers.length) throw new Error('profit.json has no companies');

  const jobs = tickers.map((t) => ({ ticker: t, market: marketOf(t), co: P.companies[t] }));
  const result = {
    scannedAt: nowISO,
    siteUpdated: P.updated || null,
    counts: {
      total: jobs.length, scanned: 0, newPeriods: 0, fillCandidates: 0,
      filingAlerts: 0, longTermMissing: 0, errors: 0, skipped: 0,
    },
    newPeriods: [],
    fillCandidates: [],
    filingAlerts: [],
    longTermMissing: [],
    errors: [],
    skipped: [],
  };

  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const { ticker, market, co } = job;
      let siteMaxEnd = '';
      if (co.quarters && co.quarters.length) {
        siteMaxEnd = co.quarters.reduce((m, q) => (q.end > m ? q.end : m), '');
      }

      let probe = null;
      try {
        if (market === 'A') {
          probe = await probeA(ticker);
        } else if (market === 'HK') {
          probe = await probeHK(ticker);
        } else if (market === 'KR') {
          result.skipped.push({ ticker, market, reason: 'KR：未接免费数据源' });
          result.counts.skipped++; continue;
        } else if (co.cik) {
          probe = await probeSEC(co.cik);
        } else {
          const reason = market === 'EU' ? 'EU：无 CIK（未接欧股源）'
            : market === 'TW' ? 'TW：无 CIK（未接台股源）'
            : '私有/无 CIK（人工关注）';
          result.skipped.push({ ticker, market, reason });
          result.counts.skipped++; continue;
        }
      } catch (e) {
        const msg = (e && e.message) || String(e);
        if (/HTTP 404/.test(msg)) {
          result.skipped.push({ ticker, market, reason: '源站 404（未收录）' });
          result.counts.skipped++;
        } else {
          result.errors.push({ ticker, market, error: msg });
          result.counts.errors++;
        }
        continue;
      }

      if (!probe) {
        result.skipped.push({ ticker, market, reason: '源站无数据行' });
        result.counts.skipped++;
        continue;
      }
      result.counts.scanned++;

      // SEC 分两类：periodic（真期末，判新期）与 sixK（仅公告提醒）；A/H 的 probe 无 periodic 字段
      const periodic = probe.periodic !== undefined ? probe.periodic : probe;

      if (periodic && periodic.latestEnd && periodic.latestEnd > siteMaxEnd) {
        result.newPeriods.push({
          ticker, name: co.name, market, currency: co.currency,
          siteMaxEnd, latestEnd: periodic.latestEnd,
          latestNotice: periodic.latestNotice, reportType: periodic.reportType,
        });
        result.counts.newPeriods++;
      } else if (periodic && periodic.latestEnd && periodic.latestEnd === siteMaxEnd && market === 'A') {
        // 只对 A 股做「补空字段」判定；并做长期缺失降噪。
        const last3 = lastNQuarters(co, 3);
        const latest = last3[last3.length - 1] || {};
        const newMissing = [];
        const structural = [];
        for (const f of ['gross', 'opInc', 'rd', 'sga']) {
          if (!missingField(latest, f)) continue;      // 站内最新期本来就有值，跳过
          if (!periodic.has[f]) continue;              // 源站也没有，无法补，跳过
          const missingAll3 = last3.length >= 3 && last3.every((q) => missingField(q, f));
          if (missingAll3) structural.push(f);
          else newMissing.push(f);
        }
        if (newMissing.length) {
          result.fillCandidates.push({
            ticker, name: co.name, market, end: siteMaxEnd,
            missing: newMissing, latestNotice: periodic.latestNotice,
          });
          result.counts.fillCandidates++;
        }
        if (structural.length) {
          result.longTermMissing.push({
            ticker, name: co.name, market, end: siteMaxEnd, missing: structural,
          });
          result.counts.longTermMissing++;
        }
      }

      if (probe.sixK && probe.sixK.length) {
        result.filingAlerts.push({
          ticker, name: co.name, market,
          latestSixK: probe.sixK[0].filingDate,
          count: probe.sixK.length,
          recent: probe.sixK.slice(0, 3).map((x) => x.filingDate),
        });
        result.counts.filingAlerts++;
      }

      await sleep(REQ_GAP_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  result.newPeriods.sort((a, b) => (b.latestNotice || '').localeCompare(a.latestNotice || ''));
  result.filingAlerts.sort((a, b) => (b.latestSixK || '').localeCompare(a.latestSixK || ''));

  if (outFile) {
    const abs = path.resolve(outFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(result, null, 2));
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const c = result.counts;
  console.log(`=== profitbridge 新财报扫描 ${result.scannedAt} (site updated=${result.siteUpdated}) ===`);
  console.log(`公司 ${c.total} | 已扫 ${c.scanned} | 新期 ${c.newPeriods} | 可补字段 ${c.fillCandidates} | 6-K 提醒 ${c.filingAlerts} | 长期缺失 ${c.longTermMissing} | 错误 ${c.errors} | 跳过 ${c.skipped}`);

  if (result.newPeriods.length) {
    console.log('\n--- 有新的报告期，可补入 ---');
    for (const n of result.newPeriods) {
      console.log(`  ${n.ticker.padEnd(12)} ${(n.name || '').padEnd(16)} 站内 ${n.siteMaxEnd} -> 源站 ${n.latestEnd} (${n.reportType || '?'}, 公告 ${n.latestNotice || '?'})`);
    }
  } else {
    console.log('\n--- 无新报告期 ---');
  }

  if (result.fillCandidates.length) {
    console.log('\n--- 最新期字段可补齐（新出现的缺失） ---');
    for (const f of result.fillCandidates) {
      console.log(`  ${f.ticker.padEnd(12)} ${f.end} 缺 ${f.missing.join('/')} (公告 ${f.latestNotice || '?'})`);
    }
  }

  if (result.longTermMissing.length) {
    console.log('\n--- 长期缺失（最近 3 期同样缺失，仅统计不逐条待办） ---');
    for (const f of result.longTermMissing) {
      console.log(`  ${f.ticker.padEnd(12)} ${f.end} 缺 ${f.missing.join('/')}`);
    }
  }

  if (result.filingAlerts.length) {
    console.log(`\n--- 6-K 公告提醒（近 ${SIXK_ALERT_DAYS} 天内提交，reportDate≠期末，仅供参考） ---`);
    for (const a of result.filingAlerts) {
      console.log(`  ${a.ticker.padEnd(12)} ${(a.name || '').padEnd(16)} 近 ${a.count} 条，最近: ${a.recent.join(', ')}`);
    }
  }

  if (result.errors.length) {
    console.log('\n--- 扫描错误（需人工看） ---');
    for (const e of result.errors) console.log(`  ${e.ticker.padEnd(12)} ${e.error}`);
  }

  if (result.skipped.length) {
    const byReason = {};
    for (const s of result.skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    console.log('\n--- 跳过（按原因聚合） ---');
    for (const [reason, n] of Object.entries(byReason)) console.log(`  ${n} 家: ${reason}`);
  }

  console.log('\n(只读扫描，未修改任何 data/ 文件)');
}

main().catch((e) => {
  console.error('SCAN FAILED: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
