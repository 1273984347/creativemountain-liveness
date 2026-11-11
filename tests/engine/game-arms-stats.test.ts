// tests/engine/game-arms-stats.test.ts
// B70 Task 5：三面评估器的统计逻辑（McNemar 连续性校正 + 同 seed 配对计数 + 固定判定措辞）。
// 纯统计、不依赖模型与服务 ⇒ 常驻单测（评估器本体 tools/laya-probe/game-arms.mjs 不进门禁）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcnemar, pairWinners, verdictOf, CHI2_CRITICAL } from '../../tools/laya-probe/face-stats.mjs';

test('McNemar 连续性校正与临界值', () => {
  const r = mcnemar(14, 4);
  assert.equal(r.chi2, Number(((Math.abs(14 - 4) - 1) ** 2 / 18).toFixed(6)));
  assert.equal(r.significant, true);          // 4.5 > 3.841
  assert.equal(mcnemar(17, 8).significant, false);   // 2.56 < 3.841
  assert.equal(CHI2_CRITICAL, 3.841);
});

test('判定用未取整的 χ²：临界值两侧各一例（B70 终审 Minor 4/6）', () => {
  // 3.840909…（差 0.000091）⇒ 不显著
  const below = mcnemar(29, 15);
  assert.equal(below.chi2, 3.840909);
  assert.equal(below.significant, false);
  // 3.841897…（差 0.000897）⇒ 显著；若先取整到 6 位再比较，临界附近的翻转就会判错
  const above = mcnemar(407, 352);
  assert.equal(above.chi2, 3.841897);
  assert.equal(above.significant, true);
  // 独立复算（不引用实现）：(|b−c|−1)²/(b+c)
  assert.ok((Math.abs(407 - 352) - 1) ** 2 / (407 + 352) > CHI2_CRITICAL);
  assert.ok((Math.abs(29 - 15) - 1) ** 2 / (29 + 15) <= CHI2_CRITICAL);
});

test('b+c=0 ⇒ 无可配对差异，不得报显著', () => {
  const r = mcnemar(0, 0);
  assert.equal(r.chi2, 0);
  assert.equal(r.significant, false);
  assert.equal(r.noDiscordant, true);
});

test('配对计数：b=基线赢而模型输，c=反之', () => {
  const base = [[0], [1], [0], [2]];
  const arm  = [[1], [1], [0], [0]];
  const p = pairWinners(base, arm, 0);
  assert.equal(p.b, 1);      // 第1局：基线含0、臂不含
  assert.equal(p.c, 1);      // 第4局：基线不含0、臂含
  assert.equal(p.both, 1);   // 第3局
  assert.equal(p.neither, 1);// 第2局
  assert.equal(p.changed, 2);
});

test('判定措辞固定三种，不得自由发挥', () => {
  assert.equal(verdictOf({ significant: true, improved: true }), '该面值得接入，另立批次做门 ⑨ 重校准');
  assert.equal(verdictOf({ significant: false, improved: true }), '未检出改善');
  assert.equal(verdictOf({ significant: false, improved: false }), '未检出改善');
  assert.equal(verdictOf({ significant: true, improved: false }), '该面模型劣于启发式，保持贪心');
});
