// 显式修复脚本：把 segments.json 里「degraded 是字符串」的异常形态统一为规范占位（2026-11-20）
//
// 背景（证据链）：
//   - 规范占位形态（SPCX / CBRS / LEGO / 02513.HK / 00100.HK / 00992.HK 已是）：
//       { "degraded": true, "reason": "<原因>", "quarters": {} }
//     app.js 的 segmentStatus() 只认 `c.degraded === true`，读到就返回
//       { kind:'unavailable', reason:c.reason }  → 图内提示 "该公司未公开分部数据" + reason。
//   - 异常形态：degraded 直接是一个字符串（原因文本），没有 quarters 键。app.js 里
//     `c.degraded === true` 不成立、`c.quarters` 又是 undefined，于是落到
//       { kind:'noData' } → 只能显示通用文案 "暂无可用分部数据 / 数据源未提供该公司的分部拆分"，
//     原因文本在 UI 上完全丢失（只在 JSON 里躺着）。
//
// 本脚本：degraded:string → { degraded:true, reason:<原字符串>, quarters:{} }；
//   其余字段（periods / periodTypes / annualQuarters / notes / 数值）一律逐字保留，
//   并断言「除目标公司外零变化」，随后重建 data/segments.json.js 镜像并深度相等断言。
// 幂等：degraded 已是 true 的公司跳过（重复执行零变化）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = (p, s) => fs.writeFileSync(path.join(ROOT, p), s, 'utf8');
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const CRLF = s => s.replace(/\n/g, '\r\n');

const raw = fs.readFileSync(path.join(ROOT, 'data/segments.json'), 'utf8');
const SEG = JSON.parse(raw);
// 先证明「重建序列化」与现有文件逐字节一致，保证下面写盘只产生目标差异
assert.equal(CRLF(JSON.stringify(SEG, null, 2)) + '\r\n', raw, 'segments.json 格式非 2 空格/CRLF，拒绝重排');

const before = {};                       // 修复前逐公司 sha256
for (const [t, e] of Object.entries(SEG.companies)) before[t] = sha(e);

const FIXED = [];
for (const [t, e] of Object.entries(SEG.companies)) {
  if (typeof e.degraded !== 'string') continue;   // 只处理异常形态；true / 无该字段一律不动
  const reason = e.degraded.trim();
  assert.ok(reason.length > 0, `${t}: degraded 字符串为空`);
  // 规范键序：degraded → reason → quarters → （其余原有字段按原顺序）
  const rebuilt = { degraded: true, reason };
  for (const k of Object.keys(e)) {
    if (k === 'degraded' || k === 'reason' || k === 'quarters') continue;
    rebuilt[k] = e[k];
  }
  rebuilt.quarters = (e.quarters && typeof e.quarters === 'object' && !Array.isArray(e.quarters)) ? e.quarters : {};
  // 除 degraded/reason/quarters 外的字段必须逐字相同
  const strip = o => { const r = { ...o }; delete r.degraded; delete r.reason; delete r.quarters; return r; };
  assert.deepEqual(strip(rebuilt), strip(e), `${t}: 除 degraded 表示形式外字段被改动`);
  assert.equal(sha(rebuilt.quarters), sha(e.quarters || {}), `${t}: quarters 被改动`);
  FIXED.push({ ticker: t, oldType: typeof e.degraded, reason, keysBefore: Object.keys(e), keysAfter: Object.keys(rebuilt) });
  SEG.companies[t] = rebuilt;
}

// 逐公司 sha 断言：除目标公司外零变化
const after = {};
for (const [t, e] of Object.entries(SEG.companies)) after[t] = sha(e);
assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), '公司集合发生变化');
const changed = Object.keys(before).filter(t => before[t] !== after[t]);
const fixedTickers = FIXED.map(f => f.ticker);
assert.deepEqual(changed.sort(), fixedTickers.slice().sort(), `变化公司不等于目标集合：${changed.join(',')}`);
console.log(`companies=${Object.keys(before).length}  changed=${changed.length} (${changed.join(', ')})`);

// periods / notes / 顶层字段不变
for (const k of Object.keys(SEG)) if (k !== 'companies') assert.ok(k in JSON.parse(raw), `顶层字段 ${k} 丢失`);
assert.deepEqual(Object.keys(SEG).sort(), Object.keys(JSON.parse(raw)).sort(), '顶层键集合变化');
assert.deepEqual(SEG.notes, JSON.parse(raw).notes, 'notes 被改动');
assert.deepEqual(SEG.failures, JSON.parse(raw).failures, 'failures 被改动');

// ---------- 写盘 + 镜像 ----------
const jsonOut = CRLF(JSON.stringify(SEG, null, 2)) + '\r\n';
W('data/segments.json', jsonOut);
W('data/segments.json.js', 'window.__SEGMENT_DATA = ' + JSON.stringify(SEG) + ';\r\n');

const mirror = fs.readFileSync(path.join(ROOT, 'data/segments.json.js'), 'utf8');
assert.ok(mirror.startsWith('window.__SEGMENT_DATA = '), '镜像前缀丢失');
const body = mirror.replace(/^window\.__SEGMENT_DATA = /, '').replace(/;\r?\n$/, '');
assert.deepStrictEqual(JSON.parse(body), SEG, '镜像 deepEqual 失败');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/segments.json'), 'utf8')), SEG);
console.log('mirror: prefix ok, deepEqual=true');

// ---------- 报告 ----------
for (const f of FIXED) {
  console.log(`\n${f.ticker}`);
  console.log(`  before: keys=[${f.keysBefore}]  degraded="${f.reason.slice(0, 70)}${f.reason.length > 70 ? '…' : ''}"`);
  console.log(`  after : keys=[${f.keysAfter}]  degraded=true`);
}
console.log(`\nfixed=${FIXED.length}`);
