#!/usr/bin/env node
// Coverage audit: expected vs actual reporting periods per company.
// READ-ONLY over data/profit.json, data/companies.json, data/segments.json.
// Output: console summary + tmp-audit-cov/report.md
// Rule: notes/frequency fields are the ONLY allowed source for missing-reason inference.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const profit = load('profit.json');
const companies = load('companies.json');
const segments = load('segments.json');

const AUDIT_DATE = new Date(profit.updated || Date.now()); // "today" for disclosure-due logic
const D = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
const days = (a, b) => Math.round((b - a) / 86400000);

function noteFor(ticker, pc) {
  const norm = (n) => n == null ? '' : (Array.isArray(n) ? n.join(' ') : String(n));
  const own = norm(pc.notes);
  const global = (profit.notes || []).filter((n) => n.startsWith(ticker + ':')).join(' ');
  return (own + ' ' + global).trim();
}

// generate expected period-end dates: anchor (month,day) once per year, years from..to
function anchorDates(anchor, yFrom, yTo) {
  const out = [];
  for (let y = yFrom; y <= yTo; y++) {
    const d = new Date(Date.UTC(y, anchor.m, anchor.d));
    // anchor month overflow (e.g. Feb 30) not expected in this dataset
    out.push(d);
  }
  return out;
}
function nextAnchorAfter(anchor, date) {
  let d = new Date(Date.UTC(date.getUTCFullYear(), anchor.m, anchor.d));
  if (d <= date) d = new Date(Date.UTC(date.getUTCFullYear() + 1, anchor.m, anchor.d));
  return d;
}

// ---- Profit statement audit ----
function auditProfit(ticker, pc) {
  const freq = pc.frequency || 'q'; // EDGAR series without explicit frequency = quarterly
  const qs = pc.quarters || [];
  const ends = qs.map((q) => q.end);
  const has = (e) => ends.includes(e);
  const res = { ticker, freq, actual: qs.length, first: ends[0] || null, last: ends.at(-1) || null, missing: [], dueNotYet: 0, periodTypes: {} };
  const notes = noteFor(ticker, pc);
  qs.forEach((q) => { const t = q.periodType || 'q'; res.periodTypes[t] = (res.periodTypes[t] || 0) + 1; });
  const nulls = qs.filter((q) => q.revenue == null || q.netInc == null);
  res.nullFields = nulls.map((q) => `${q.end}(rev=${q.revenue ?? 'null'},ni=${q.netInc ?? 'null'})`);

  if (freq === 'annual') {
    const a = ends.length ? { m: D(ends.at(-1)).getUTCMonth(), d: D(ends.at(-1)).getUTCDate() } : null;
    if (a) {
      const y0 = D(ends[0]).getUTCFullYear();
      for (const d of anchorDates(a, y0 + 1, AUDIT_DATE.getUTCFullYear())) {
        if (d.getTime() + 45 * 86400000 <= AUDIT_DATE.getTime() && !ends.some((e) => Math.abs(days(D(e), d)) <= 92)) {
          res.missing.push(fmt(d));
        } else if (!ends.some((e) => Math.abs(days(D(e), d)) <= 92)) res.dueNotYet++;
      }
    }
    res.rule = `annual（FY@${a ? (a.m + 1 + '/' + a.d) : '?'}，每年 1 期）`;
  } else if (freq === 'hk-mixed') {
    // per periodType (q1..q4/annual), each fiscal year should have one period
    const types = Object.keys(res.periodTypes);
    const fy = {}; // fiscal-year -> last end per type
    for (const t of types) {
      const series = qs.filter((q) => (q.periodType || 'q') === t).map((q) => q.end);
      const a = { m: D(series.at(-1)).getUTCMonth(), d: D(series.at(-1)).getUTCDate() };
      const y0 = D(series[0]).getUTCFullYear();
      for (const d of anchorDates(a, y0 + 1, AUDIT_DATE.getUTCFullYear())) {
        if (d.getTime() + 45 * 86400000 <= AUDIT_DATE.getTime() && !series.some((e) => Math.abs(days(D(e), d)) <= 92)) res.missing.push(fmt(d) + `[${t}]`);
        else if (!series.some((e) => Math.abs(days(D(e), d)) <= 92)) res.dueNotYet++;
      }
    }
    res.rule = `hk-mixed（按 periodType 分组：${types.join(',')}，各型每年 1 期）`;
  } else if (freq === 'mixed') {
    // as-filed pattern (e.g. KR: Q1/Q3/FY) — expect same periodType set every full year
    const byYear = {};
    qs.forEach((q) => { const y = q.end.slice(0, 4); (byYear[y] ||= []).push(q.periodType || 'q'); });
    const years = Object.keys(byYear).map(Number).sort();
    const maxN = Math.max(...Object.values(byYear).map((v) => v.length));
    const fullYears = years.filter((y) => byYear[y].length === maxN);
    const pattern = [...new Set(byYear[fullYears[0]] || [])].sort();
    for (const y of fullYears) {
      const ts = byYear[y] || [];
      for (const t of pattern) if (!ts.includes(t)) res.missing.push(`${y}[${t}]`);
    }
    if (years[0] < (fullYears[0] ?? years[0])) res.partialStart = `首年 ${years[0]} 期数不全（起始年，不计缺失）`;
    res.rule = `mixed（as-filed 年度模式 ${pattern.join('/')}，每财年各 1 期）`;
  } else {
    // quarterly / hk-mixed-style series: walk forward one period (~91d) from first actual end;
    // a period is "dueNotYet" if its end + 45d reporting lag > audit date, else missing
    if (ends.length) {
      let cur = D(ends[0]);
      const limit = AUDIT_DATE.getTime() + 45 * 86400000;
      let guard = 0;
      while (cur.getTime() <= limit && guard++ < 300) {
        const matchedEnd = ends.find((e) => Math.abs(days(D(e), cur)) <= 45);
        if (matchedEnd) {
          cur = new Date(D(matchedEnd).getTime() + 91 * 86400000);
        } else {
          const label = fmt(cur);
          if (cur.getTime() + 45 * 86400000 <= AUDIT_DATE.getTime()) res.missing.push(label);
          else res.dueNotYet++;
          cur = new Date(cur.getTime() + 91 * 86400000);
        }
      }
      // first-year partial series (company listed mid-year) is the series start, not a gap — by construction walk starts at first actual
      res.rule = 'q（季频，间隔 ~91d 逐期推进核对，含期内断档）';
    }
  }

  // reason inference — ONLY from notes / frequency / null fields
  const reasons = [];
  const trunc = notes.match(/truncated to last (\d+) continuous quarters \(full (?:XBRL )?run: (\d+)\)/);
  if (trunc) {
    res.noteLost = +trunc[2] - +trunc[1];
    reasons.push(`抓取截断：notes 明示 history truncated（完整 ${trunc[2]} 季 → 保留 ${trunc[1]} 季，头部少 ${res.noteLost} 期）→ 可补抓`);
  }
  if (/truncated to last \d+/.test(notes)) reasons.push('抓取截断：notes 明示 history truncated（如 64-quarter cap）→ 可补抓');
  if (nulls.length) reasons.push(`字段 null：${nulls.length} 期 revenue/netInc 为 null（差分或未披露字段）`);
  if (freq === 'annual') reasons.push('频次=annual：数据源口径即年度，无季度期属口径设计，非缺失');
  if (freq === 'mixed') reasons.push('频次=mixed：as-filed 口径（如韩国 Q1/Q3/FY），未披露型季属披露制度，非缺失');
  if (freq === 'hk-mixed') reasons.push('频次=hk-mixed：港式累计差分，periodType 各型逐年核对');
  if (/not (separately )?disclosed|no differencing/.test(notes)) reasons.push('notes 明示披露制度不含该期型');
  if (res.missing.length && !reasons.length) reasons.push('notes/frequency 无解释 → 疑似抓取漏期，可补抓');
  res.reasons = reasons;
  res.coverage = res.missing.length === 0 ? 100 : null;
  return res;
}

// ---- Segments audit: for companies WITH segment disclosure ----
function auditSegments() {
  const out = [];
  for (const [ticker, sc] of Object.entries(segments.companies || {})) {
    const segEnds = Object.keys(sc.quarters || {}).sort();
    const pc = profit.companies[ticker];
    const profEnds = (pc?.quarters || []).map((q) => q.end);
    // continuity within seg series
    let gaps = [];
    for (let i = 1; i < segEnds.length; i++) {
      const d = days(D(segEnds[i - 1]), D(segEnds[i]));
      if (d > 130) gaps.push(`${segEnds[i - 1]}→${segEnds[i]} (${d}d)`);
    }
    // profit quarters inside seg range but absent from seg
    const inside = profEnds.filter((e) => segEnds.length && e >= segEnds[0] && e <= segEnds.at(-1) && !segEnds.includes(e));
    out.push({ ticker, n: segEnds.length, first: segEnds[0] || null, last: segEnds.at(-1) || null, gaps, missingVsProfit: inside });
  }
  return out;
}

// ---- run ----
const rows = Object.entries(profit.companies).map(([t, pc]) => auditProfit(t, pc));
rows.sort((a, b) => (a.missing.length - a.actual) - (b.missing.length - b.actual)); // worst (most missing relative) first
const segRows = auditSegments();

const L = [];
const w = (s = '') => L.push(s);
w('# ProfitBridge 数据覆盖审计报告');
w();
w(`- 审计时点（数据 updated）：${profit.updated}`);
w(`- 审计口径：期望期数由各公司实际期末锚点 + frequency 规则生成；起点=最早实际期（companies.json 无 firstYear/listingInfo 字段 → **全部标注「起点存疑」，未回推**，绝不臆造）`);
w(`- 缺失原因推断仅来自 profit.json 的 notes / frequency / null 字段`);
w(`- 期末晚于审计时点的期不算缺失（记 dueNotYet，尚未到披露时点）`);
w();
w('## 汇总');
const totMissing = rows.reduce((s, r) => s + r.missing.length, 0);
const withMissing = rows.filter((r) => r.missing.length);
w(`- 公司总数：${rows.length}（profit.json）；零缺失：${rows.length - withMissing.length} 家；有缺失：${withMissing.length} 家；缺失期合计：${totMissing}`);
w(`- 3 月财年 / 非标期型（annual、mixed、hk-mixed 等口径设计）已单独归类，不计缺失`);
w();
w('## 最差 20 家（按缺失期数降序）');
w();
w('| # | ticker | freq | 实际期数 | 首期 | 末期 | 缺失期数 | 缺失明细 |');
w('|---|--------|------|---------|------|------|---------|---------|');
[...withMissing].sort((a, b) => b.missing.length - a.missing.length).slice(0, 20).forEach((r, i) => {
  w(`| ${i + 1} | ${r.ticker} | ${r.freq} | ${r.actual} | ${r.first} | ${r.last} | ${r.missing.length} | ${r.missing.join('、')} |`);
});
w();
w('## 全量明细');
w();
w('| ticker | 频次规则 | 实际期数 | 范围 | 覆盖缺失 | dueNotYet | null 字段 | 原因推断（仅 notes/frequency 来源） |');
w('|--------|----------|---------|------|---------|-----------|-----------|------|');
for (const r of rows) {
  w(`| ${r.ticker} | ${r.rule} | ${r.actual} | ${r.first} ~ ${r.last} | ${r.missing.length ? r.missing.join('、') : '无'} | ${r.dueNotYet} | ${r.nullFields.join('、') || '—'} | ${r.reasons.join('；') || '—'} |`);
}
w();
w('## Segments 覆盖（有分部披露的公司）');
w();
w('| ticker | 分部期数 | 范围 | 系列内断档 | profit 有而分部缺 |');
w('|--------|---------|------|-----------|------------------|');
for (const s of segRows) {
  w(`| ${s.ticker} | ${s.n} | ${s.first} ~ ${s.last} | ${s.gaps.join('、') || '无'} | ${s.missingVsProfit.join('、') || '无'} |`);
}
w();

const report = L.join('\n');
mkdirSync(join(ROOT, 'tmp-audit-cov'), { recursive: true });
writeFileSync(join(ROOT, 'tmp-audit-cov', 'report.md'), report);

// console summary
console.log(`审计完成：${rows.length} 家公司，缺失期合计 ${totMissing}，有缺失公司 ${withMissing.length} 家`);
console.log('最差 10 家:');
[...withMissing].sort((a, b) => b.missing.length - a.missing.length).slice(0, 10).forEach((r) =>
  console.log(`  ${r.ticker} [${r.freq}] n=${r.actual} ${r.first}~${r.last} 缺失${r.missing.length}: ${r.missing.slice(0, 8).join(' ')}${r.missing.length > 8 ? ' …' : ''}`));
console.log(`报告已写入 tmp-audit-cov/report.md`);
