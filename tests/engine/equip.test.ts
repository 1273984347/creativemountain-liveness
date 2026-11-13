// B75：装备动作（手牌 → 装备区）。入口唯一：`performAction(state, seat, 'equip', { cardId })`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performAction } from '../../engine/core/turn-runner.ts';
import { mk, lockedScene, gateScene, exiledScene } from './fixtures.ts';
import { cardHasMovement } from '../../engine/core/targeting.ts';

test('B75：装备把手牌移入装备区并计 equipsTotal', () => {
  const s = mk();
  const card = s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.notEqual(next, s, '装备必须被接受');
  assert.equal(next.players[0]!.hand.some((c) => c.id === card.id), false);
  assert.equal(next.players[0]!.equipment.some((c) => c.id === card.id), true);
  assert.equal(next.players[0]!.counters.equipsTotal, 1);
});

test('B75：牌不在手 / 缺 cardId ⇒ 引用相等拒绝', () => {
  const s = mk();
  assert.equal(performAction(s, 0, 'equip', { cardId: 'no_such_card' }), s);
  assert.equal(performAction(s, 0, 'equip', {}), s);
});

test('B75：待认证锁定下允许装备（装备不是位移）', () => {
  const s = lockedScene();
  assert.equal(s.players[0]!.pendingCert, true, '前提：夹具必须是待认证锁定');
  const card = s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.notEqual(next, s);
  assert.equal(next.players[0]!.equipment.length, 1);
});

test('B75：关隘暂停时拒绝装备（该手番的行动已在「到达」时用掉）', () => {
  const s = gateScene();
  const card = s.players[0]!.hand[0]!;
  assert.equal(performAction(s, 0, 'equip', { cardId: card.id }), s);
});

test('B75：装备不占手牌上限（只从 hand 移走，不进任何弃牌堆）', () => {
  const s = mk();
  const card = s.players[0]!.hand.find((c) => !cardHasMovement(c)) ?? s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.equal(next.players[0]!.equipment.length, 1);
  assert.equal(next.players[0]!.hand.length, s.players[0]!.hand.length - 1);
  assert.equal(next.decks.discard.filter((c) => c.id === card.id).length, 0, '装备牌不得进弃牌堆');
});

test('B75：已出局者不能装备', () => {
  const s = exiledScene(4, 7, 0);
  assert.equal(s.players[0]!.alive, false, '前提：座 0 已出局');
  const card = s.players[0]!.hand[0];
  if (card === undefined) { return; } // 夹具不保证出局者仍有手牌 ⇒ 无牌可试即跳过
  assert.equal(performAction(s, 0, 'equip', { cardId: card.id }), s);
});

test('B75：装备不消耗随机数（同一 seed 下 rng 游标不动）', () => {
  // ⚠️ 决策/行动不得额外抽随机数（`Rng.next()` 是可变的）⇒ 装备必须零扰动。
  const s = mk();
  const card = s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.deepEqual(next.rng.snapshot(), s.rng.snapshot(), '装备不得推进随机流');
});
