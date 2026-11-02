#!/usr/bin/env node
/*
 * detect.mjs — 分部数据可疑点检测器（只读，不修改任何数据）
 *
 * 输入: ../../data/segments.json, ../../data/profit.json
 * 输出: findings.json (全部原始命中) + stdout 可读摘要
 *
 * 四类规则:
 *  R1 分部合计 vs 同期营收偏离 >±8%   (仅“分部覆盖全公司”的公司; 部分覆盖跳过)
 *  R2 同粒度同比异常 (<0.4x 或 >2.5x) 且相邻期正常
 *  R3 跨期分部名称突然断裂/新增
 *  R4 分部值 <=0 但业务不应为负 (排除抵销/推导/Corporate 等合并调整行)
 *
 * 关键数据事实(见 app.js / notes):
 *  - profit.json 的 revenue 以报告币种百万计; 换算 USD-M = revenue * q.fxToUsd (USD-M 公司 fx 缺省为1)
 *  - segments.json 的 value 一律 USD-$M (非本币), 除中/港 A/H 股为“产品线口径/单季口径”, 与营收不可比
 *  - 韩国(005930/066570)含“内部抵销/合并调整(推导)”行, 由构造使其加总=营收, 因此 R1 天然通过
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..', '..');
const seg = JSON.parse(readFileSync(join(ROOT, 'data', 'segments.json'), 'utf8'));
const prof = JSON.parse(readFileSync(join(ROOT, 'data', 'profit.json'), 'utf8'));

const DAY = 86400000;
const parseDate = (s) => new Date(s + 'T00:00:00Z').getTime();

// 合并调整/抵销类行, 允许为负
const RECON_RE = /(抵销|抵銷|推导|推導|elimination|reconcil|corporate and|合并调整|合併調整)/i;
const isRecon = (name) => RECON_RE.test(name || '');

function revUsd(tk, d) {
  const c = prof.companies[tk];
  if (!c || !c.quarters) return null;
  const q = c.quarters.find((x) => x.end === d);
  if (!q || q.revenue == null) return null;
  const fx = q.fxToUsd != null ? q.fxToUsd : (c.currency === 'USD-M' ? 1 : null);
  if (fx == null) return null;
  return q.revenue * fx;
}
function revNative(tk, d) {
  const c = prof.companies[tk];
  if (!c || !c.quarters) return null;
  const q = c.quarters.find((x) => x.end === d);
  return q ? q.revenue : null;
}

// 分部合计（顶层 value 相加; children 是父项细分，不重复加）
function segSum(segs) {
  return (segs || []).reduce((a, x) => a + (typeof x.value === 'number' ? x.value : 0), 0);
}

const findings = [];
const push = (o) => findings.push(o);

// ============ 预计算每家公司的季度序列与覆盖率判定 ============
const companyInfo = {};
for (const tk of Object.keys(seg.companies)) {
  const c = seg.companies[tk] || {};
  const quarters = c.quarters || {};
  const dates = Object.keys(quarters).sort();
  const ptOf = (d) => (c.periodTypes || {})[d] || null;

  // 每季度偏离
  const devs = [];
  for (const d of dates) {
    const rv = revUsd(tk, d);
    const sum = segSum(quarters[d]);
    if (rv && rv > 0) devs.push({ d, sum, rv, dev: sum / rv - 1 });
  }
  // 覆盖率: 至少一半季度 |dev|<=8% 视为“覆盖全公司”
  const okCount = devs.filter((x) => Math.abs(x.dev) <= 0.08).length;
  const fullCoverage = devs.length >= 2 && okCount / devs.length >= 0.5;
  companyInfo[tk] = { dates, ptOf, devs, fullCoverage, currency: prof.companies[tk]?.currency };
}

// ============ R1: 分部合计 vs 营收 偏离 >±8% ============
for (const [tk, info] of Object.entries(companyInfo)) {
  if (!info.fullCoverage) continue;
  for (const x of info.devs) {
    if (Math.abs(x.dev) > 0.08) {
      push({
        rule: 'R1_sum_vs_revenue', ticker: tk, end: x.d,
        detail: { segSum: +x.sum.toFixed(2), revUsd: +x.rv.toFixed(2), devPct: +(x.dev * 100).toFixed(2) },
        severityHint: 'P1',
      });
    }
  }
}

// 记录被排除的公司(部分覆盖), 便于报告说明
const excludedPartial = Object.entries(companyInfo)
  .filter(([, i]) => i.devs.length >= 2 && !i.fullCoverage)
  .map(([tk, i]) => ({ ticker: tk, currency: i.currency, nDev: i.devs.length, ok: i.devs.filter((x) => Math.abs(x.dev) <= 0.08).length }));

// ============ 通用序列工具 ============
// 在 dates 中(同 periodType)按日期差找上一期/下一期/去年同期
function sameTypeDates(tk) {
  const info = companyInfo[tk];
  const byType = {};
  for (const d of info.dates) {
    const pt = info.ptOf(d);
    (byType[pt] ||= []).push(d);
  }
  return byType;
}
function findYoY(tk, d, pt) {
  // 同 periodType, 目标 = 日期往前约1年
  const info = companyInfo[tk];
  const target = parseDate(d) - 365 * DAY;
  const tol = pt === 'annual' ? 70 : pt === 'half' ? 55 : 45;
  let best = null, bestDiff = Infinity;
  for (const d2 of info.dates) {
    if (d2 === d) continue;
    if (info.ptOf(d2) !== pt) continue;
    const diff = Math.abs(parseDate(d2) - target);
    if (diff < tol * DAY && diff < bestDiff) { best = d2; bestDiff = diff; }
  }
  return best;
}
function neighbor(tk, d, pt, step) {
  const info = companyInfo[tk];
  const ds = info.dates.filter((x) => info.ptOf(x) === pt).sort();
  const i = ds.indexOf(d);
  if (i < 0) return null;
  return ds[i + step] || null;
}
function valOf(tk, d, name) {
  const segs = seg.companies[tk].quarters[d] || [];
  const e = segs.find((x) => x.name === name);
  return e && typeof e.value === 'number' ? e.value : null;
}

// ============ R2: 同比异常 ============
for (const tk of Object.keys(seg.companies)) {
  const info = companyInfo[tk];
  if (!info.dates.length) continue;
  const byType = sameTypeDates(tk);
  for (const d of info.dates) {
    const pt = info.ptOf(d);
    const yoyD = findYoY(tk, d, pt);
    if (!yoyD) continue;
    const segs = seg.companies[tk].quarters[d] || [];
    for (const e of segs) {
      if (isRecon(e.name)) continue;
      const now = e.value, before = valOf(tk, yoyD, e.name);
      if (!(typeof now === 'number' && typeof before === 'number') || before <= 0) continue;
      const ratio = now / before;
      if (ratio < 0.4 || ratio > 2.5) {
        // 相邻期正常判定: 前一期 & 后一期的同比都在 [0.5,2.0]
        const prevD = neighbor(tk, d, pt, -1);
        const nextD = neighbor(tk, d, pt, +1);
        const yoyRatioAt = (dd) => {
          if (!dd) return null;
          const yd = findYoY(tk, dd, pt);
          if (!yd) return null;
          const b = valOf(tk, yd, e.name); const n = valOf(tk, dd, e.name);
          if (!(typeof b === 'number' && typeof n === 'number') || b <= 0) return null;
          return n / b;
        };
        const rPrev = yoyRatioAt(prevD);
        const rNext = yoyRatioAt(nextD);
        const normal = (r) => r == null ? null : (r >= 0.5 && r <= 2.0);
        const prevOK = normal(rPrev), nextOK = normal(rNext);
        const adjNormal = [prevOK, nextOK].filter((v) => v !== null);
        const adjacentNormal = adjNormal.length > 0 && adjNormal.every((v) => v === true);
        push({
          rule: 'R2_yoy_anomaly', ticker: tk, end: d, name: e.name,
          detail: {
            value: now, priorYearEnd: yoyD, priorValue: before, ratio: +ratio.toFixed(3),
            prevYoY: rPrev == null ? null : +rPrev.toFixed(3),
            nextYoY: rNext == null ? null : +rNext.toFixed(3),
            adjacentNormal,
          },
          severityHint: adjacentNormal ? 'P0/P1' : 'P2',
        });
      }
    }
  }
}

// ============ R2b: 相邻期包络单点离群 (同比基准缺失时的补充) ============
// 当前值不在 [0.4*min(prev,next), 2.5*max(prev,next)] 且 prev/next 大体一致(0.5~2)
for (const tk of Object.keys(seg.companies)) {
  const info = companyInfo[tk];
  for (const d of info.dates) {
    const pt = info.ptOf(d);
    const prevD = neighbor(tk, d, pt, -1);
    const nextD = neighbor(tk, d, pt, +1);
    if (!prevD || !nextD) continue;
    for (const e of seg.companies[tk].quarters[d] || []) {
      if (isRecon(e.name)) continue;
      const v = e.value, pv = valOf(tk, prevD, e.name), nv = valOf(tk, nextD, e.name);
      if (!(typeof v === 'number' && typeof pv === 'number' && typeof nv === 'number') || pv <= 0 || nv <= 0) continue;
      const lo = 0.4 * Math.min(pv, nv), hi = 2.5 * Math.max(pv, nv);
      const neighborsConsistent = Math.min(pv, nv) / Math.max(pv, nv) >= 0.5;
      if (neighborsConsistent && (v < lo || v > hi)) {
        const rv = revUsd(tk, d);
        push({
          rule: 'R2b_isolated_outlier', ticker: tk, end: d, name: e.name,
          detail: {
            value: v, prev: { end: prevD, v: pv }, next: { end: nextD, v: nv },
            vsPrev: +(v / pv).toFixed(3), vsNext: +(v / nv).toFixed(3),
            sharePct: rv ? +(v / rv * 100).toFixed(1) : null,
          },
          severityHint: 'P0/P1',
        });
      }
    }
  }
}

// ============ R5: 份额结构断裂 (同季多分部同向崩解, 且合计仍=营收 → 掩盖型错配) ============
for (const tk of Object.keys(seg.companies)) {
  const info = companyInfo[tk];
  if (!info.fullCoverage) continue;
  // 每个 name 的份额中位数
  const shareHist = {};
  for (const d of info.dates) {
    const rv = revUsd(tk, d); if (!rv || rv <= 0) continue;
    for (const e of seg.companies[tk].quarters[d] || []) {
      if (isRecon(e.name)) continue;
      if (typeof e.value !== 'number') continue;
      (shareHist[e.name] ||= []).push({ d, share: e.value / rv });
    }
  }
  const medianShare = {};
  for (const [nm, arr] of Object.entries(shareHist)) {
    if (arr.length < 5) continue;
    const s = arr.map((x) => x.share).sort((a, b) => a - b);
    medianShare[nm] = s[Math.floor(s.length / 2)];
  }
  for (const d of info.dates) {
    const rv = revUsd(tk, d); if (!rv || rv <= 0) continue;
    const segs = (seg.companies[tk].quarters[d] || []).filter((e) => !isRecon(e.name) && typeof e.value === 'number');
    const devs = [];
    for (const e of segs) {
      const ms = medianShare[e.name];
      if (ms == null || ms <= 0.05) continue; // 只看有分量的分部
      const share = e.value / rv;
      const rel = share / ms - 1;
      devs.push({ name: e.name, value: e.value, share, medianShare: ms, rel });
    }
    // 至少两个分部同时相对偏离>50%, 且方向相反(一个暴增一个暴减), 典型“重分配/对调”
    const big = devs.filter((x) => Math.abs(x.rel) > 0.5);
    if (big.length >= 2) {
      const hasUp = big.some((x) => x.rel > 0.5), hasDown = big.some((x) => x.rel < -0.5);
      // 隔离性: 相邻两期用同一 median 计算时, 这些分部都应“正常”(|rel|<0.35), 排除长期趋势误报
      const pt = info.ptOf(d);
      const prevD = neighbor(tk, d, pt, -1), nextD = neighbor(tk, d, pt, +1);
      const shareRelAt = (dd, nm) => {
        if (!dd) return null;
        const rv2 = revUsd(tk, dd); if (!rv2 || rv2 <= 0) return null;
        const e2 = (seg.companies[tk].quarters[dd] || []).find((x) => x.name === nm);
        if (!e2 || typeof e2.value !== 'number') return null;
        return (e2.value / rv2) / medianShare[nm] - 1;
      };
      const isolated = big.every((x) => {
        const a = shareRelAt(prevD, x.name), b = shareRelAt(nextD, x.name);
        const vals = [a, b].filter((v) => v != null);
        return vals.length > 0 && vals.every((v) => Math.abs(v) < 0.45);
      });
      if (hasUp && hasDown && isolated) {
        push({
          rule: 'R5_share_structure_break', ticker: tk, end: d,
          detail: { revenueUsd: +rv.toFixed(1), segments: big.map((x) => ({ name: x.name, value: x.value, sharePct: +(x.share * 100).toFixed(1), medianSharePct: +(x.medianShare * 100).toFixed(1), relPct: +(x.rel * 100).toFixed(0) })) },
          severityHint: 'P0',
        });
      }
    }
  }
}

// ============ R6: 季度粒度混入年度累计 (某"quarter"期数值≈前3季之和) ============
for (const tk of Object.keys(seg.companies)) {
  const info = companyInfo[tk];
  const ds = info.dates;
  for (let i = 3; i < ds.length; i++) {
    const d = ds[i];
    if (info.ptOf(d) !== 'quarter') continue;
    // 仅在同一财年连续4季时判定: 前3期都是quarter且日期相隔约1季
    const p1 = ds[i - 1], p2 = ds[i - 2], p3 = ds[i - 3];
    if (info.ptOf(p1) !== 'quarter' || info.ptOf(p2) !== 'quarter' || info.ptOf(p3) !== 'quarter') continue;
    const rv = revUsd(tk, d), a = revUsd(tk, p1), b = revUsd(tk, p2), c = revUsd(tk, p3);
    if (!(rv > 0 && a > 0 && b > 0 && c > 0)) continue;
    const sum3 = a + b + c;
    const med3 = [a, b, c].sort((x, y) => x - y)[1];
    const prevRegular = Math.max(a, b, c) / Math.min(a, b, c) < 2.2;
    const looksAnnual = rv / sum3 > 1.15 && rv / sum3 < 1.65; // 年度 ≈ 三个已知季 + 一个标准季
    if (prevRegular && looksAnnual && rv / med3 > 2.2) {
      push({
        rule: 'R6_annual_in_quarter', ticker: tk, end: d,
        detail: { revenue: +rv.toFixed(1), sumPrev3: +sum3.toFixed(1), ratioToPrev3: +(rv / sum3).toFixed(3), prev3: [p1, p2, p3] },
        severityHint: 'P1',
      });
    }
  }
}

// ============ R3: 名称突然断裂/新增 ============
for (const tk of Object.keys(seg.companies)) {
  const info = companyInfo[tk];
  const byType = sameTypeDates(tk);
  for (const pt of Object.keys(byType)) {
    const ds = byType[pt].sort();
    for (let i = 1; i < ds.length; i++) {
      const d = ds[i], prev = ds[i - 1], next = ds[i + 1] || null;
      const curNames = (seg.companies[tk].quarters[d] || []).map((x) => x.name);
      const prevNames = (seg.companies[tk].quarters[prev] || []).map((x) => x.name);
      const nextNames = next ? (seg.companies[tk].quarters[next] || []).map((x) => x.name) : null;
      const rv = revUsd(tk, d);
      // 新增: 本期有, 前一期无, 下一期(若有)有
      for (const nm of curNames) {
        if (isRecon(nm)) continue;
        if (!prevNames.includes(nm) && (nextNames === null || nextNames.includes(nm))) {
          const v = valOf(tk, d, nm);
          const share = rv && rv > 0 && v != null ? v / rv : null;
          if (share != null && share > 0.05) {
            push({ rule: 'R3_name_added', ticker: tk, end: d, name: nm,
              detail: { value: v, sharePct: +(share * 100).toFixed(1), prevNames, curNames }, severityHint: 'P2' });
          }
        }
      }
      // 断裂: 前一期有, 本期无, 后一期(若有)有
      for (const nm of prevNames) {
        if (isRecon(nm)) continue;
        if (!curNames.includes(nm) && (nextNames === null || nextNames.includes(nm))) {
          const v = valOf(tk, prev, nm);
          const rvp = revUsd(tk, prev);
          const share = rvp && rvp > 0 && v != null ? v / rvp : null;
          if (share != null && share > 0.05) {
            push({ rule: 'R3_name_dropped', ticker: tk, end: d, name: nm,
              detail: { droppedFrom: prev, prevValue: v, sharePct: +(share * 100).toFixed(1), prevNames, curNames }, severityHint: 'P2' });
          }
        }
      }
    }
  }
}

// ============ R4: 值为 0 或负数 ============
for (const tk of Object.keys(seg.companies)) {
  const c = seg.companies[tk];
  for (const d of Object.keys(c.quarters || {})) {
    for (const e of c.quarters[d] || []) {
      if (isRecon(e.name)) continue;
      if (typeof e.value === 'number' && e.value <= 0) {
        push({ rule: 'R4_nonpositive', ticker: tk, end: d, name: e.name,
          detail: { value: e.value }, severityHint: 'P2' });
      }
    }
  }
}

// ---- 输出 ----
const out = { generatedAt: new Date().toISOString(), companyCoverageExcludedPartial: excludedPartial, findings };
writeFileSync(join(__here, 'findings.json'), JSON.stringify(out, null, 2));

// 摘要
const byRule = {};
for (const f of findings) (byRule[f.rule] ||= []).push(f);
console.log('截至', out.generatedAt);
console.log('总命中:', findings.length, '| 规则分布:', Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, v.length])));
console.log('\n排除(部分覆盖/口径不可比)公司:', excludedPartial.map((x) => x.ticker).join(', '));
for (const rule of ['R1_sum_vs_revenue', 'R6_annual_in_quarter', 'R5_share_structure_break', 'R2b_isolated_outlier', 'R2_yoy_anomaly', 'R3_name_added', 'R3_name_dropped', 'R4_nonpositive']) {
  const arr = byRule[rule] || [];
  console.log(`\n===== ${rule} (${arr.length}) =====`);
  for (const f of arr) {
    if (rule === 'R1_sum_vs_revenue') console.log(`${f.ticker} ${f.end} sum=${f.detail.segSum} rev=${f.detail.revUsd} dev=${f.detail.devPct}%`);
    else if (rule === 'R6_annual_in_quarter') console.log(`${f.ticker} ${f.end} rev=${f.detail.revenue} ≈ 前3季合计 ${f.detail.sumPrev3} (${f.detail.ratioToPrev3}x)  ${f.detail.prev3.join(',')}`);
    else if (rule === 'R5_share_structure_break') console.log(`${f.ticker} ${f.end} rev=${f.detail.revenueUsd} :: ` + f.detail.segments.map(s => `${s.name}=${s.value}(${s.sharePct}% vs med ${s.medianSharePct}%, ${s.relPct}%)`).join(' | '));
    else if (rule === 'R2b_isolated_outlier') console.log(`${f.ticker} ${f.end} ${f.name}: ${f.detail.value} prev=${f.detail.prev.v}(${f.detail.prev.end}) next=${f.detail.next.v}(${f.detail.next.end}) vsPrev=${f.detail.vsPrev} vsNext=${f.detail.vsNext} share=${f.detail.sharePct}%`);
    else if (rule === 'R2_yoy_anomaly') console.log(`${f.ticker} ${f.end} ${f.name}: ${f.detail.value} vs ${f.detail.priorValue}(${f.detail.priorYearEnd}) = ${f.detail.ratio}x prevYoY=${f.detail.prevYoY} nextYoY=${f.detail.nextYoY} adjNormal=${f.detail.adjacentNormal}`);
    else console.log(`${f.ticker} ${f.end} ${f.name} ${JSON.stringify(f.detail).slice(0, 140)}`);
  }
}
