// 精确 t 分布临界值（B32）的回归。
//
// 覆盖：① 双侧 p=0.05 临界值与**权威表值**逐个核对（df = 1/5/10/18/30/38/60/120）；
//   ② CDF 的对称性与单调性；③ 非法 df 被拒。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { studentTCdf, tCritical05 } from '../../engine/core/balance.ts';

test('B32：精确 t 临界值与权威表值一致（±0.001）', () => {
  const table: ReadonlyArray<readonly [number, number]> = [
    [1, 12.706], [5, 2.571], [10, 2.228], [18, 2.101], [30, 2.042],
    [38, 2.024], [60, 2.000], [120, 1.980],
  ];
  for (const [df, expected] of table) {
    const got = tCritical05(df);
    assert.ok(Math.abs(got - expected) < 0.001,
      'df=' + String(df) + '：精确值 ' + got.toFixed(4) + ' 应≈表值 ' + String(expected));
  }
});

test('B32：临界值随 df 单调递减（df 越大 ⇒ 越接近正态）', () => {
  const d10 = tCritical05(10);
  const d30 = tCritical05(30);
  const d120 = tCritical05(120);
  assert.ok(d10 > d30 && d30 > d120, '临界值应随 df 递减');
  assert.ok(Math.abs(d120 - 1.96) < 0.03, 'df=120 应接近正态 1.96');
});

test('B32：t 分布 CDF 对称、单调，且临界值处恰为 0.975', () => {
  assert.ok(Math.abs(studentTCdf(2.5, 18) + studentTCdf(-2.5, 18) - 1) < 1e-12, 'CDF 须关于 0.5 对称');
  assert.ok(studentTCdf(1, 18) > studentTCdf(0, 18), 'CDF 须随 t 递增');
  const c = tCritical05(18);
  assert.ok(Math.abs(studentTCdf(c, 18) - 0.975) < 1e-9, '临界值处 CDF = 0.975');
});

test('B32：非法 df 被拒', () => {
  assert.throws(() => tCritical05(0));
  assert.throws(() => tCritical05(-1));
});
