// 位次胜率极差口径（B25）的引擎层回归。
//
// 覆盖：① 偏离均匀分布时的极差 / RMS / 严格单调计算；② 阈值常量存在且为正（口径不可缺失）；
//   ③ **单调性**在噪声下也常见 ⇒ 不可单独当门禁（断言其只被记录、不参与阈值）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePositionSpread,
  POSITION_RMS_GATE_LIMIT,
  POSITION_SPREAD_GATE_LIMIT,
  POSITION_SPREAD_LIMIT,
} from '../../engine/core/balance.ts';

test('B25：偏离全为 0 ⇒ 极差与 RMS 均为 0、且不算严格单调', () => {
  const s = computePositionSpread([0, 0, 0, 0]);
  assert.equal(s.spread, 0);
  assert.equal(s.rms, 0);
  assert.equal(s.monotone, false, '全相等不构成严格单调');
});

test('B25：极差 = max − min；RMS 用到全部位次', () => {
  const s = computePositionSpread([-2, 0, 1, 3]);
  assert.equal(s.max, 3);
  assert.equal(s.min, -2);
  assert.equal(s.spread, 5, '极差 = 3 − (−2)');
  assert.equal(s.rms, Math.sqrt((4 + 0 + 1 + 9) / 4), 'RMS = √(Σdev²/n)');
});

test('B25：严格单调（升 / 降）能被识别', () => {
  assert.equal(computePositionSpread([3, 1, -1, -3]).monotone, true, '严格递减 ⇒ 判单调');
  assert.equal(computePositionSpread([-3, -1, 1, 3]).monotone, true, '严格递增 ⇒ 判单调');
  assert.equal(computePositionSpread([3, 1, 1, -3]).monotone, false, '有相等项 ⇒ 非严格单调');
});

test('B25：极差只看离群位次 ⇒ RMS 更稳健（同一离群点下 RMS 明显更小）', () => {
  const outlier = computePositionSpread([0, 0, 0, 8]);
  assert.equal(outlier.spread, 8);
  assert.ok(outlier.rms < outlier.spread, 'RMS 应小于极差（用到全部位次 ⇒ 稳健）');
});

test('B25：三层阈值常量存在且为正（口径不可缺失）', () => {
  assert.ok(POSITION_SPREAD_LIMIT > 0, '统计口径阈值');
  assert.ok(POSITION_SPREAD_GATE_LIMIT > 0, '门禁极差阈值');
  assert.ok(POSITION_RMS_GATE_LIMIT > 0, '门禁 RMS 阈值');
});

// ⚠️ B65：阈值**具体值**也要钉住 —— 既有断言只查「> 0」⇒ 阈值被随手改小（如 14 → 6）
//   不会有任何测试报警 ⇒ 门 ⑫ 会变成「看起来在守、实际守不住」的假锁。
//   ⇒ 这里钉住 B65 重校准后的值，并要求**门禁阈值 ≥ 统计阈值**（否则大样本超标而门禁放行）。
test('B65：阈值常量钉住具体值（防被随手改小 ⇒ 门 ⑫ 变假锁）', () => {
  assert.equal(POSITION_SPREAD_LIMIT, 8,
    '[B65 阈值] 统计口径阈值必须是 8pp（B65 重校准：付费后 8 人档大样本实测 7.8pp；原 6pp 是免费出牌时代读数）');
  assert.equal(POSITION_SPREAD_GATE_LIMIT, 14,
    '[B65 阈值] 门禁极差阈值必须是 14pp（B65 重校准：跨 10 组独立样本实测极差 7.7–12.6pp ⇒ 跨样本最大 + 余量）');
  assert.equal(POSITION_RMS_GATE_LIMIT, 6.5,
    '[B65 阈值] 门禁 RMS 阈值必须是 6.5pp（B65 重校准：跨 10 组独立样本实测 RMS 1.17–5.64pp）');
});

test('B65：门禁阈值不得低于统计阈值（大样本超标而门禁放行 ⇒ 判据自相矛盾）', () => {
  assert.ok(POSITION_SPREAD_GATE_LIMIT >= POSITION_SPREAD_LIMIT,
    '[B65 阈值] 门禁极差阈值必须 ≥ 统计口径阈值（门禁是固定 seed 小样本切片 ⇒ 天然更松）');
  assert.ok(POSITION_RMS_GATE_LIMIT >= 3,
    '[B65 阈值] 门禁 RMS 阈值不得低于 3pp（B25 起该口径即以此为下限）');
});
