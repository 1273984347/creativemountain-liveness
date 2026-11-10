// tools/laya-probe/face-stats.mjs
// B70 Task 5：三面评估器的纯统计层 —— 无 IO、无模型 ⇒ 可常驻单测（game-arms-stats.test.ts）。
// 临界 3.841 = χ²(1) 的 p=0.05；措辞固定三种（spec 权威，评估器与报告都从这里取）。
export const CHI2_CRITICAL = 3.841;

/**
 * 同 seed 配对的 McNemar 检验（连续性校正）。
 * @param {number} b 基线赢而模型输的局数
 * @param {number} c 基线输而模型赢的局数
 */
export function mcnemar(b, c) {
  const n = b + c;
  const chi2 = n === 0 ? 0 : Number(((Math.abs(b - c) - 1) ** 2 / n).toFixed(6));
  return { b, c, chi2, significant: chi2 > CHI2_CRITICAL, noDiscordant: n === 0 };
}

/** winners 数组里是否含该座位。 */
const won = (winners, seat) => Array.isArray(winners) && winners.includes(seat);

/**
 * 逐局配对计数（同 seed 一一对应）。
 * @param {number[][]} baseWinners 各局基线胜者座位数组
 * @param {number[][]} armWinners 各局模型臂胜者座位数组
 * @param {number} seat 模型座位
 */
export function pairWinners(baseWinners, armWinners, seat) {
  let b = 0, c = 0, both = 0, neither = 0;
  const n = Math.min(baseWinners.length, armWinners.length);
  for (let i = 0; i < n; i += 1) {
    const x = won(baseWinners[i], seat), y = won(armWinners[i], seat);
    if (x && !y) { b += 1; } else if (!x && y) { c += 1; } else if (x && y) { both += 1; } else { neither += 1; }
  }
  return { b, c, both, neither, changed: b + c, paired: n };
}

/** 判定措辞 —— 只允许三种固定说法（spec §10 的硬约束，报告里不得自由发挥）。 */
export function verdictOf({ significant, improved }) {
  if (!significant) { return '未检出改善'; }
  return improved ? '该面值得接入，另立批次做门 ⑨ 重校准' : '该面模型劣于启发式，保持贪心';
}
