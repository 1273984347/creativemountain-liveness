// 新增谓词 `has_card_count`（B26）的回归。
//
// 覆盖：① 「至少 N 张匹配 filter 的牌」的数量判定（不足 / 恰好）；
//   ② 与 `has_card` 的差别（后者只判「有没有」）⇒ 条件型试炼挑战性的来源。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePredicate, type PredicateContext } from '../../engine/predicates.ts';
import type { State } from '../../engine/core/state.ts';
import type { Card } from '../../engine/types/theme.ts';

function card(id: string, type: Card['type'], color: Card['color']): Card {
  return { id, name: id, type, cost: 0, color, rank: 2, text: '', effects: [] };
}

function ctxOf(hand: readonly Card[]): PredicateContext {
  const state = { players: [{ seat: 0, hand: [...hand] }] } as unknown as State;
  return { state, actor: 0 };
}

test('B26：has_card_count —— 不足 N 张 ⇒ 不通过；恰好 ⇒ 通过', () => {
  const hand = [card('a', 'motion', 'red'), card('b', 'motion', 'black'), card('c', 'attack', 'red')];
  const ctx = ctxOf(hand);
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card_count', filter: { type: 'motion' }, count: 2 }), true,
    '手上有 2 张身法牌 ⇒ 满足');
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card_count', filter: { type: 'motion' }, count: 3 }), false,
    '只有 2 张身法牌 ⇒ 不满足');
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card_count', filter: { type: 'attack' }, count: 1 }), true,
    '有 1 张攻伐牌 ⇒ 满足');
});

test('B26：has_card_count 与 has_card 的差别 —— 「有」与「够多」不同', () => {
  const ctx = ctxOf([card('a', 'motion', 'red')]);
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card', filter: { type: 'motion' } }), true, '有 1 张 ⇒ has_card 通过');
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card_count', filter: { type: 'motion' }, count: 2 }), false,
    '同样 1 张 ⇒ has_card_count 不通过（挑战性来源）');
});

test('B26：空手牌 ⇒ has_card_count 恒不通过', () => {
  const ctx = ctxOf([]);
  assert.equal(evaluatePredicate(ctx, { kind: 'has_card_count', filter: { type: 'motion' }, count: 1 }), false);
});
