#!/usr/bin/env node
/**
 * verify_scan.mjs — 轻量自检：校验 scan_filings.mjs 的 --json 输出结构完整、扫描数达标、无错误
 *
 * 用法（三选一）：
 *   node scripts/scan_filings.mjs --json --out tmp-scan/scan.json
 *   node tests/verify_scan.mjs tmp-scan/scan.json          # 读文件
 *   node scripts/scan_filings.mjs --json | node tests/verify_scan.mjs   # 读 stdin
 *   node tests/verify_scan.mjs --run                        # 现场跑一次扫描再校验
 *
 * 退出码：0 = 全部通过；1 = 有断言失败或输入不可用
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadInput() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (fileArg) return fs.readFileSync(path.resolve(fileArg), 'utf8');
  if (args.includes('--run')) {
    return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'scan_filings.mjs'), '--json'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env,
    });
  }
  if (!process.stdin.isTTY) return fs.readFileSync(0, 'utf8');
  throw new Error('no input: pass a JSON file path, pipe --json output, or use --run');
}

let fails = 0;
const ok = (cond, msg) => {
  if (cond) console.log('ok  ', msg);
  else { console.error('FAIL', msg); fails++; }
};

let data;
try {
  data = JSON.parse(loadInput());
} catch (e) {
  console.error('FAIL 输入无法解析为 JSON:', e.message);
  process.exit(1);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

ok(isObj(data), '输出是 JSON 对象');
ok(isNum(data.scannedAt === undefined ? NaN : Date.parse(data.scannedAt)), 'scannedAt 可解析为时间');
ok(isObj(data.counts), 'counts 是对象');

for (const k of ['newPeriods', 'fillCandidates', 'filingAlerts', 'skipped']) {
  ok(Array.isArray(data[k]), `${k} 是数组`);
}
ok(Array.isArray(data.errors), 'errors 是数组');

if (isObj(data.counts)) {
  for (const k of ['total', 'scanned', 'newPeriods', 'fillCandidates', 'filingAlerts', 'errors', 'skipped']) {
    ok(isNum(data.counts[k]), `counts.${k} 是数字`);
  }
  ok(data.counts.scanned >= 80, `扫描数 >= 80（实际 ${data.counts.scanned}）`);
  ok(data.counts.errors === 0, `errors === 0（实际 ${data.counts.errors}）`);
  // 计数与数组长度自洽（数组存在时）
  if (Array.isArray(data.errors)) ok(data.errors.length === data.counts.errors, 'errors 数量自洽');
  if (Array.isArray(data.newPeriods)) ok(data.newPeriods.length === data.counts.newPeriods, 'newPeriods 数量自洽');
  if (Array.isArray(data.filingAlerts)) ok(data.filingAlerts.length === data.counts.filingAlerts, 'filingAlerts 数量自洽');
}

// 6-K 提醒不得混入「新期」：newPeriods 的 reportType 不应是 6-K
if (Array.isArray(data.newPeriods)) {
  ok(data.newPeriods.every((n) => n.reportType !== '6-K'), 'newPeriods 中不含 6-K（reportDate≠期末）');
}

if (fails) { console.error(`\nverify_scan: ${fails} 项失败`); process.exit(1); }
console.log('\nverify_scan: 全部通过');
