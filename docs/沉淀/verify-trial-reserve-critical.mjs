// 余量判定的**离线回归**（门禁第 ⑬ 道）—— 用扫描落盘的**各组原始统计量**直接重算 Welch t。
//
// ⚠️ B34：数据源从「报告里**已舍入**的均值 ± σ」换成 `docs/trial-reserve-scan.json`（各组原值）
//   ⇒ 消除舍入误差（此前 t 有 ±0.01 量级误差）。
// ⚠️ 判定口径唯一：Welch t（Welch–Satterthwaite 自由度）+ **精确** t 临界值（`engine/core/balance.ts`）。
// ⚠️ 同时与 **B31 的发布值**对照（t = 2.86 / 3.38）⇒ 确认判定与数值均未漂移。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { tCritical05 } from '../../engine/core/balance.ts';

// ⚠️ B35：默认读**入库的基线快照**（B34 扫描结果）⇒ 门禁不依赖任何生成物；
//   另可用 `--scan=<path>` 指向**按需生成**的新扫描产物（重扫后与基线对照）。
const argv = process.argv.slice(2);
const scanArg = argv.find((a) => a.startsWith('--scan='));
const SCAN = scanArg === undefined
  ? resolve(process.cwd(), 'docs', 'baselines', 'trial-reserve-scan-B34.json')
  : resolve(process.cwd(), scanArg.slice('--scan='.length));
const raw = JSON.parse(readFileSync(SCAN, 'utf8'));
const groups = raw.groups ?? [];

/** 被复核的一对取值：余量 0 vs 2（试炼通道可用性 vs 平衡代价）。 */
const BASE = 2;
const A = 0;

/** B31 的发布值（用于对照，确认未漂移）。 */
const B31_BASELINE = { fallback: 2.86, seats: 3.38 };

function stats(reserve, key) {
  const v = groups.filter((g) => g.reserve === reserve).map((g) => g[key]);
  const n = v.length;
  if (n === 0) { throw new Error('扫描数据里没有余量 ' + String(reserve) + ' 的分组'); }
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  return { mean, sd, n };
}

/** Welch t + Welch–Satterthwaite 自由度（与扫描工具同一套公式）。 */
function welch(a, b) {
  const va = (a.sd ** 2) / a.n;
  const vb = (b.sd ** 2) / b.n;
  const se = Math.sqrt(va + vb);
  const df = ((va + vb) ** 2) / (((va * va) / (a.n - 1)) + ((vb * vb) / (b.n - 1)));
  return { t: Math.abs(a.mean - b.mean) / se, df };
}

console.log('余量判定离线回归（原始统计量 · 精确 t 临界值 · B35 · 基线快照）：');
console.log('数据源：' + SCAN + '（' + String(groups.length) + ' 个分组，每组 ' + String(raw.gamesPerGroup) + ' 局）');
console.log('| 指标 | 均值差 | Welch t | df | 精确临界值 | 判定 | 与 B31 发布值之差 |');
console.log('|---|---|---|---|---|---|---|');
const problems = [];
for (const key of ['fallback', 'seats']) {
  const a = stats(A, key);
  const b = stats(BASE, key);
  const w = welch(a, b);
  const crit = tCritical05(w.df);
  const sig = w.t >= crit;
  const drift = Math.abs(w.t - B31_BASELINE[key]);
  if (!sig) { problems.push(key + '：判定变为不显著（t=' + w.t.toFixed(3) + ' < 临界 ' + crit.toFixed(4) + '）'); }
  if (drift > 0.05) { problems.push(key + '：与 B31 发布值 t 相差 ' + drift.toFixed(3) + '（> 0.05）'); }
  console.log('| ' + key + ' | ' + (a.mean - b.mean).toFixed(3) + ' | ' + w.t.toFixed(3)
    + ' | ' + w.df.toFixed(2) + ' | ' + crit.toFixed(4) + ' | ' + (sig ? '**显著**' : '不显著')
    + ' | ' + drift.toFixed(3) + ' |');
}
console.log('');
if (problems.length > 0) {
  console.error('FAIL  ' + problems.join('；'));
  process.exit(1);
}
console.log('PASS  判定不变：余量 0 vs 2 在两项指标上均显著，且与 B31 发布值一致');
