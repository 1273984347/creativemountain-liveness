// 用 B31 的 **20 组数据**（每取值 6 万局）复核「余量 0 vs 2」的判定 ⇒ 精确临界值（B32）。
//
// ⚠️ 为什么存成脚本：B31 的结论要能在**不重跑 7 分钟模拟**的前提下被复核 ⇒ 直接用其发布的
//   「均值 ± σ」重算 Welch t 与 Welch–Satterthwaite 自由度 ⇒ 与扫描工具口径一致。
// ⚠️ 精度提醒：输入是 B31 **已舍入**的发布值 ⇒ 重算的 t 有 ±0.01 量级误差 ⇒ 判定不受影响。

import { tCritical05 } from '../../engine/core/balance.ts';

/** B31（20 组 × 3000 局 = 每取值 60000 局）的发布数据：均值与组间 σ。 */
const GROUPS = {
  0: { fallback: { mean: 6.82, sd: 0.33 }, seats: { mean: 1.453, sd: 0.013 } },
  2: { fallback: { mean: 7.13, sd: 0.35 }, seats: { mean: 1.440, sd: 0.013 } },
};
const N = 20;

/** Welch t + Welch–Satterthwaite 自由度（与扫描工具同一套公式）。 */
function welch(a, b) {
  const va = (a.sd ** 2) / N;
  const vb = (b.sd ** 2) / N;
  const se = Math.sqrt(va + vb);
  const df = ((va + vb) ** 2) / (((va * va) / (N - 1)) + ((vb * vb) / (N - 1)));
  return { t: Math.abs(a.mean - b.mean) / se, df };
}

console.log('用 B31 的 20 组数据复核「余量 0 vs 2」（精确 t 临界值，B32）：');
console.log('| 指标 | 均值差 | Welch |t| | df（未取整） | 精确临界值 | 判定 |');
console.log('|---|---|---|---|---|---|');
let allSignificant = true;
for (const key of ['fallback', 'seats']) {
  const w = welch(GROUPS[0][key], GROUPS[2][key]);
  const crit = tCritical05(w.df);
  const sig = w.t >= crit;
  if (!sig) { allSignificant = false; }
  console.log('| ' + key + ' | ' + (GROUPS[0][key].mean - GROUPS[2][key].mean).toFixed(3)
    + ' | ' + w.t.toFixed(3) + ' | ' + w.df.toFixed(2) + ' | ' + crit.toFixed(4)
    + ' | ' + (sig ? '**显著**' : '不显著') + ' |');
}
console.log('');
console.log(allSignificant ? 'PASS  判定不变：余量 0 vs 2 在两项指标上均显著' : 'FAIL  判定发生变化');
if (!allSignificant) { process.exit(1); }
