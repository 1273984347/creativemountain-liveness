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

// ---------- 引擎结算（Task 6）----------
//
// ⚠️ 拒绝以**引用相等**表达（probeAction 认得的信号）；生效路径走 recoverFromExhaustion。
import { mk, putPending } from './fixtures.ts';
import { performAction } from '../../engine/core/turn-runner.ts';

/** 夹具：座 `seat` 力竭 + 灵枢置值。 */
function exhaustedAt(s: import('../../engine/core/state.ts').State, seat: number, resource: number): import('../../engine/core/state.ts').State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, exhaustedRounds: 2, resource, hp: 0 } : p)) };
}

test('B76：自恢正例——扣 2、解除、回血保底、日志（自恢）', () => {
  const s = exhaustedAt(mk(4, 7), 0, 3);
  const r = performAction(s, 0, 'recuperate', {});
  const p = r.players[0]!;
  assert.equal(p.resource, 1, '扣 2 灵枢');
  assert.equal(p.exhaustedRounds, 0, '解除');
  assert.equal(p.hp, Math.ceil(p.hpMax / 2), '保底回血');
  assert.ok(r.log.some((l) => l.kind === 'exhaustion' && l.message.includes('（自恢）')));
});

test('B76：救援正例——扣 1、目标解除、日志（被座 N 救援）', () => {
  const s = exhaustedAt(mk(4, 7), 1, 0);
  const r = performAction(s, 0, 'recuperate', { target: 1 });
  assert.equal(r.players[0]!.resource, s.players[0]!.resource - 1, '扣 1 灵枢');
  assert.equal(r.players[1]!.exhaustedRounds, 0, '目标解除');
  assert.equal(r.players[1]!.hp, Math.ceil(r.players[1]!.hpMax / 2), '目标保底回血');
  assert.ok(r.log.some((l) => l.kind === 'exhaustion' && l.message.includes('座位 1（救援）')), 'message 契约：解除力竭：座位 N（救援）');
});

test('B76：灵枢不足自恢 ⇒ 引用相等拒绝', () => {
  const s = exhaustedAt(mk(4, 7), 0, 1);
  assert.equal(performAction(s, 0, 'recuperate', {}), s);
});

test('B76：灵枢不足救援 ⇒ 引用相等拒绝', () => {
  const s = exhaustedAt(mk(4, 7), 1, 0);
  const poor = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, resource: 0 } : p)) };
  assert.equal(performAction(poor, 0, 'recuperate', { target: 1 }), poor);
});

test('B76：力竭者不能救援他人 ⇒ 引用相等拒绝', () => {
  const s = { ...exhaustedAt(mk(4, 7), 1, 0), players: exhaustedAt(mk(4, 7), 1, 0).players.map((p) => (p.seat === 0 ? { ...p, exhaustedRounds: 2 } : p)) };
  assert.equal(performAction(s, 0, 'recuperate', { target: 1 }), s);
});

test('B76：目标未力竭 ⇒ 引用相等拒绝', () => {
  const s = exhaustedAt(mk(4, 7), 0, 3);
  assert.equal(performAction(s, 0, 'recuperate', { target: 1 }), s);
});

test('B76：pendingCert 下自恢允许，certification 字段逐字不变（R-B76-4）', () => {
  const s = putPending(exhaustedAt(mk(4, 7), 1, 3), [1]);
  const certBefore = JSON.stringify(s.certification);
  const r = performAction(s, 1, 'recuperate', {});
  assert.equal(r.players[1]!.exhaustedRounds, 0, '自恢成功');
  assert.equal(JSON.stringify(r.certification), certBefore, '认证状态零交互');
});

test('B76：三态叠加（力竭+待认证+印记）自恢 ⇒ hasMark/alive 逐字不变（R-B76-1）', () => {
  const base = putPending(exhaustedAt(mk(4, 7), 1, 3), [1]);
  const marked = { ...base, players: base.players.map((p) => (p.seat === 1 ? { ...p, hasMark: true } : p)) };
  const r = performAction(marked, 1, 'recuperate', {});
  assert.equal(r.players[1]!.hasMark, true, '印记不清');
  assert.equal(r.players[1]!.alive, true, '不出局');
  assert.equal(r.players[1]!.exhaustedRounds, 0);
});
