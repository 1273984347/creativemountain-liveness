// B76 RECUPERATE：动作契约 / key / 引擎结算 / 候选形状。
//
// ⚠️ 契约与结算分两个任务落（T5 契约 / T6 结算）；本文件随任务追加。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionKey, actionFromKey } from '../../engine/core/action-key.ts';

test('B76：key 往返——无 target = recuperate（单段）', () => {
  const a = { type: 'RECUPERATE' as const, actor: 2 };
  assert.equal(actionKey(a), 'recuperate');
  const back = actionFromKey('recuperate');
  assert.deepEqual({ ...back, actor: 2 }, a);
});

test('B76：key 往返——有 target = recuperate:<seat>（两段）', () => {
  const a = { type: 'RECUPERATE' as const, actor: 0, target: 3 };
  assert.equal(actionKey(a), 'recuperate:3');
  const back = actionFromKey('recuperate:3');
  assert.deepEqual({ ...back, actor: 0 }, a);
});

test('B76：严格反解——recuperate:junk / recuperate: / recuperate:1x 一律抛', () => {
  assert.throws(() => actionFromKey('recuperate:junk'), /非整数|缺座位/);
  assert.throws(() => actionFromKey('recuperate:'));
  assert.throws(() => actionFromKey('recuperate:1x'), /非整数/);
  assert.throws(() => actionFromKey('recuperate:1:extra'), /非规范形/);
});
