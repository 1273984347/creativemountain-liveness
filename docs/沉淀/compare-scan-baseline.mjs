// 扫描**可复现性**比对：把「按需重扫」的产物与**入库基线快照**逐组对比。
//
// ⚠️ 用途：基线快照是「判定不变」的对照点 ⇒ 必须能证明「同样的 seed + 同样的局数 ⇒ 同样的结果」
//   ⇒ 本脚本**逐组**比对每个指标；任一不一致即红（确定性模拟下不该出现漂移）。
//
// 用法：`node docs/沉淀/compare-scan-baseline.mjs [--scan=<新产物>] [--baseline=<基线>]`

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const hit = argv.find((x) => x.startsWith('--' + name + '='));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
const baselinePath = resolve(process.cwd(), argOf('baseline', 'docs/baselines/trial-reserve-scan-B34.json'));
const scanPath = resolve(process.cwd(), argOf('scan', 'docs/trial-reserve-scan.json'));

/** 逐组比对的指标（全部原始统计量）。 */
const KEYS = ['perK', 'failed', 'passedAfterFail', 'fallback', 'seats', 'rounds', 'anomalies'];

/**
 * 读 JSON；**文件缺失/不可解析** ⇒ 明确报错并 exit 1（而非抛未捕获异常）。
 *
 * ⚠️ B40：`label` 区分**基线快照**与**扫描产物** ⇒ 报错能直接指出是哪一个输入坏了。
 */
function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error('FAIL  ' + label + '缺失或不可读：' + path);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error('FAIL  ' + label + '不是合法 JSON：' + path);
    process.exit(1);
  }
}
/**
 * **结构校验**（B42）：`groups` 必须是数组；每组必须有数值型 `reserve` / `seedBase` 与全部指标字段。
 *
 * ⚠️ 为什么单独一层：结构字段缺失时，旧的分组键会拼成 `reserve@undefined` ⇒ 只表现为
 *   「缺少该组」⇒ 仍会红但**报错不精准**（看不出是结构坏了还是数据漂移）。
 */
function assertStructure(doc, label) {
  if (!Array.isArray(doc.groups)) {
    console.error('FAIL  ' + label + '结构字段缺失或类型错误：groups（应为数组）');
    process.exit(1);
  }
  // ⚠️ B43：空数组是**第三种**坏法（字段在、类型对、内容空）⇒ 单独点名，别混进「多出该组」。
  if (doc.groups.length === 0) {
    console.error('FAIL  ' + label + '结构字段异常：groups 为空数组（没有任何分组）');
    process.exit(1);
  }
  const bad = [];
  doc.groups.forEach((g, i) => {
    if (g === null || typeof g !== 'object') { bad.push('groups[' + String(i) + '] 不是对象'); return; }
    for (const f of ['reserve', 'seedBase']) {
      if (typeof g[f] !== 'number' || !Number.isFinite(g[f])) { bad.push('groups[' + String(i) + '].' + f); }
    }
    for (const f of KEYS) {
      if (typeof g[f] !== 'number' || !Number.isFinite(g[f])) { bad.push('groups[' + String(i) + '].' + f); }
    }
  });
  if (bad.length > 0) {
    console.error('FAIL  ' + label + '结构字段缺失或非数值：' + bad.slice(0, 10).join('、'));
    process.exit(1);
  }
}
const base = readJson(baselinePath, '基线快照');
const scan = readJson(scanPath, '扫描产物');
assertStructure(base, '基线快照');
assertStructure(scan, '扫描产物');
const keyOf = (g) => String(g.reserve) + '@' + String(g.seedBase);
const mapOf = (doc) => new Map((doc.groups ?? []).map((g) => [keyOf(g), g]));
const bm = mapOf(base);
const sm = mapOf(scan);

console.log('可复现性比对：基线 ' + baselinePath + '（' + String(bm.size) + ' 组）'
  + ' vs 新扫描 ' + scanPath + '（' + String(sm.size) + ' 组）');
if (base.gamesPerGroup !== scan.gamesPerGroup) {
  console.error('FAIL  每组局数不一致：基线 ' + String(base.gamesPerGroup) + ' vs 新扫描 ' + String(scan.gamesPerGroup));
  process.exit(1);
}

let same = 0;
const diffs = [];
for (const [k, bg] of bm) {
  const sg = sm.get(k);
  if (sg === undefined) { diffs.push(k + '：新扫描缺少该组'); continue; }
  // ⚠️ B41：**字段缺失 / 非数值必须显式判失败** —— 否则 `Math.abs(undefined - x)` = NaN，
  //   而 `NaN > 1e-9` 为 false ⇒ 半损坏（字段缺失）会**静默通过**。
  const missing = [];
  const mismatched = [];
  for (const f of KEYS) {
    const a = bg[f];
    const b = sg[f];
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      missing.push(f + '(基线=' + String(a) + '，产物=' + String(b) + ')');
      continue;
    }
    if (Math.abs(a - b) > 1e-9) { mismatched.push(f + ' ' + String(a) + '→' + String(b)); }
  }
  if (missing.length === 0 && mismatched.length === 0) { same += 1; continue; }
  const parts = [];
  if (missing.length > 0) { parts.push('字段缺失或非数值：' + missing.join('、')); }
  if (mismatched.length > 0) { parts.push('数值不一致：' + mismatched.join('、')); }
  diffs.push(k + '：' + parts.join('；'));
}
for (const k of sm.keys()) { if (!bm.has(k)) { diffs.push(k + '：新扫描多出该组'); } }

console.log('逐组一致：' + String(same) + ' / ' + String(bm.size));
if (diffs.length > 0) {
  console.error('FAIL  ' + diffs.slice(0, 10).join('；'));
  process.exit(1);
}
console.log('PASS  重扫结果与基线逐组完全一致 ⇒ 结果可复现');
