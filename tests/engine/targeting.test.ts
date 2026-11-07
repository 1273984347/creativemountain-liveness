// 出牌目标选择的行为契约（规格 §3.3 / §6.4）。
//
// 覆盖三层：
//   ① 纯函数判据（哪些牌需要目标、谁能被选、点选如何解析）
//   ② 引擎集成（performAction 收到 target ⇒ 效果真的打到那个人）
//   ③ 回归防线（需要目标却没选目标 ⇒ **不出牌**，不误伤占位座位 0）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Card, Effect, ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import {
  cardNeedsTarget,
  effectNeedsTarget,
  resolveTargetPick,
  targetCandidates,
} from '../../engine/core/targeting.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 座 0 手里有指定卡、其余照常的局面。 */
function withCardInHand(card: Card): State {
  const s0 = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  return {
    ...s0,
    players: s0.players.map((p, i) => (i === 0 ? { ...p, hand: [card] } : p)),
  };
}

// ---------- ① 纯函数判据 ----------

test('effectNeedsTarget：带数字型 target 的效果需要目标', () => {
  assert.equal(effectNeedsTarget({ op: 'damage', amount: 1, target: 0 }), true);
  assert.equal(effectNeedsTarget({ op: 'swap_position', target: 0 }), true);
});

test('effectNeedsTarget：不带 target 的效果不需要目标', () => {
  assert.equal(effectNeedsTarget({ op: 'gain_resource', amount: 1 }), false);
  assert.equal(effectNeedsTarget({ op: 'draw_cards', count: 2 }), false);
});

test('effectNeedsTarget：嵌套在 sequence / conditional / count 里也要识别', () => {
  const seq: Effect = { op: 'sequence', effects: [{ op: 'damage', amount: 1, target: 0 }] };
  assert.equal(effectNeedsTarget(seq), true);
  const cond: Effect = {
    op: 'conditional',
    pred: { kind: 'hp_at_least', amount: 3 },
    then: { op: 'damage', amount: 1, target: 0 },
    else: { op: 'gain_resource', amount: 1 },
  };
  assert.equal(effectNeedsTarget(cond), true);
  const cnt: Effect = { op: 'count', count: 2, effect: { op: 'poison', amount: 1, target: 0 } };
  assert.equal(effectNeedsTarget(cnt), true);
});

test('cardNeedsTarget：主题包里的攻击牌被识别为需要目标', () => {
  const attack = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(attack !== undefined);
  assert.equal(cardNeedsTarget(attack), true);
  const utility = theme.cards.find((c) => c.id === 'c_spiritcharm');
  assert.ok(utility !== undefined);
  assert.equal(cardNeedsTarget(utility), false);
});

test('targetCandidates：排除自己与已出局者', () => {
  const s = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  assert.deepEqual(targetCandidates(s, 0), [1, 2]);
  const dead = { ...s, players: s.players.map((p) => (p.seat === 2 ? { ...p, alive: false } : p)) };
  assert.deepEqual(targetCandidates(dead, 0), [1]);
});

// ---------- resolveTargetPick ----------

test('resolveTargetPick：不需要目标的牌 ⇒ 直接出牌', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritcharm');
  assert.ok(card !== undefined);
  const s = withCardInHand(card);
  assert.deepEqual(resolveTargetPick(s, 0, card.id, undefined), { cardId: card.id });
});

test('resolveTargetPick：需要目标的牌 + 合法选择 ⇒ 带 target', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(card !== undefined);
  const s = withCardInHand(card);
  assert.deepEqual(resolveTargetPick(s, 0, card.id, 2), { cardId: card.id, target: 2 });
});

test('resolveTargetPick：点自己 / 未选 ⇒ 取消（返回 null）', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(card !== undefined);
  const s = withCardInHand(card);
  assert.equal(resolveTargetPick(s, 0, card.id, 0), null, '点自己应取消');
  assert.equal(resolveTargetPick(s, 0, card.id, undefined), null, '未选应取消');
});

test('resolveTargetPick：卡不在手牌 ⇒ 取消', () => {
  const s = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  assert.equal(resolveTargetPick(s, 0, 'c_not_in_hand', 1), null);
});

// ---------- ② 引擎集成：效果真的打到指定的人 ----------

test('引擎集成：performAction 带 target ⇒ 伤害落到该座位，而不是占位座位 0', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(card !== undefined);
  const s = withCardInHand(card);
  const before = s.players.map((p) => p.hp);
  const r = performAction(s, 0, 'act', { cardId: card.id, target: 2 });
  assert.equal(r.players[2]?.hp, (before[2] ?? 0) - 1, '座 2 应掉 1 点体力');
  assert.equal(r.players[0]?.hp, before[0], '座 0 不应掉血（target 不得落回占位座位）');
  assert.equal(r.players[0]?.hand.length, 0, '牌应已打出');
});

test('引擎集成：同一张牌打不同目标 ⇒ 伤害落到不同的人', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(card !== undefined);
  const toOne = performAction(withCardInHand(card), 0, 'act', { cardId: card.id, target: 1 });
  const toTwo = performAction(withCardInHand(card), 0, 'act', { cardId: card.id, target: 2 });
  const hp = (st: State, i: number): number => st.players[i]?.hp ?? 0;
  assert.ok(hp(toOne, 1) < hp(toOne, 2), '打座 1 ⇒ 座 1 掉血');
  assert.ok(hp(toTwo, 2) < hp(toTwo, 1), '打座 2 ⇒ 座 2 掉血');
});

// ---------- ③ 回归防线：需要目标却没选 ⇒ 不出牌 ----------

test('回归：需要目标却未指定 target ⇒ **不出牌**，不误伤占位座位 0', () => {
  const card = theme.cards.find((c) => c.id === 'c_spiritblade');
  assert.ok(card !== undefined);
  const s = withCardInHand(card);
  const before = s.players.map((p) => p.hp);
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.equal(r.players[0]?.hand.length, 1, '牌不应被打出');
  assert.deepEqual(r.players.map((p) => p.hp), before, '任何人不应掉血');
});

test('回归：四套主题里所有需要目标的牌，都能被 cardNeedsTarget 识别', () => {
  for (const id of ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych']) {
    const t = JSON.parse(
      readFileSync(resolve(process.cwd(), 'themes', id, 'theme.json'), 'utf8'),
    ) as ThemePack;
    const attackCards = t.cards.filter((c) => c.type === 'attack');
    assert.ok(attackCards.length > 0, id + ' 应有攻击牌');
    for (const c of attackCards) {
      assert.equal(cardNeedsTarget(c), true, id + ' 的攻击牌 ' + c.id + ' 未被识别为需要目标');
    }
  }
});