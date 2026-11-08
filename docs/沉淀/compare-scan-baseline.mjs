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

const base = JSON.parse(readFileSync(baselinePath, 'utf8'));
const scan = JSON.parse(readFileSync(scanPath, 'utf8'));
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
  const bad = KEYS.filter((f) => Math.abs(bg[f] - sg[f]) > 1e-9);
  if (bad.length === 0) { same += 1; }
  else {
    diffs.push(k + '：' + bad.map((f) => f + ' ' + String(bg[f]) + '→' + String(sg[f])).join('、'));
  }
}
for (const k of sm.keys()) { if (!bm.has(k)) { diffs.push(k + '：新扫描多出该组'); } }

console.log('逐组一致：' + String(same) + ' / ' + String(bm.size));
if (diffs.length > 0) {
  console.error('FAIL  ' + diffs.slice(0, 10).join('；'));
  process.exit(1);
}
console.log('PASS  重扫结果与基线逐组完全一致 ⇒ 结果可复现');
