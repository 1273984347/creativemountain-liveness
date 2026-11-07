// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedState } from '../../engine/core/probe.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { mk } from './fixtures.ts';

test('隔离（常驻）：试跑不得推进原 state 的随机源——第 ⑨ 门确定性的护栏', () => {
  const s = mk();
  const before = s.rng.snapshot();
  const iso = isolatedState(s);
  performAction(iso, 0, 'move');   // 内部掷移动骰
  performAction(iso, 0, 'ask');    // 内部掷指令骰
  assert.equal(s.rng.snapshot(), before, '原实例 rng 必须逐字不变');
  assert.notEqual(iso.rng.snapshot(), before, '探针实例必须被推进（否则两者共享同一实例）');
});
