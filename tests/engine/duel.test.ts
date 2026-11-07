// 对峙（规格 §3.3，B13）的行为契约。
//
// ⚠️ B13 之前：引擎里只有一个**无人调用**的半成品 op `compare_cards` ⇒ 对峙**不可达**；
//   且它把**对手的牌抢过来**，与规格「败者抽 1 张牌」不符。本文件钉住规格的权威语义。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Card } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { compareCards, startDuel, submitDuelCard, duelPicked, duelOpponent } from '../../engine/core/duel.ts';
import { finishTurn, advanceTurn } from '../../engine/core/turn-runner.ts';

/** 造一张牌。 */
function card(id: string, color: 'red' | 'black', rank: number): Card {
  return { id, name: id, type: 'utility', cost: 0, color, rank, text: '', effects: [] };
}

/** 造一局：座 0 与座 1 同格、各持指定手牌，牌库有 3 张。 */
function scene(h0: Card[], h1: Card[], deck: Card[] = [card('d1', 'red', 5), card('d2', 'black', 9), card('d3', 'red', 7)]): State {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 10 });
  const base: State = {
    ...s,
    decks: { ...s.decks, deck },
    players: s.players.map((p) => {
      if (p.seat === 0) { return { ...p, position: 5, hand: h0 }; }
      if (p.seat === 1) { return { ...p, position: 5, hand: h1 }; }
      return { ...p, hand: [] };
    }),
  };
  return base;
}

// ---------- 纯比较 ----------

test('B13：比较规则 = 颜色优先（红 > 黑），同色比 rank 数值', () => {
  assert.equal(compareCards(card('a', 'red', 2), card('b', 'black', 14)), 'a', '红胜黑（点数再大也不行）');
  assert.equal(compareCards(card('a', 'black', 14), card('b', 'red', 2)), 'b', '红胜黑');
  assert.equal(compareCards(card('a', 'red', 13), card('b', 'red', 12)), 'a', '同色比 rank');
  assert.equal(compareCards(card('a', 'red', 12), card('b', 'red', 13)), 'b', '同色比 rank');
  assert.equal(compareCards(card('a', 'red', 9), card('b', 'red', 9)), 'tie', '颜色与点数均同 → 平局');
});

// ---------- 触发 ----------

test('B13：落点与他人同格 ⇒ 进入待决对峙', () => {
  const s = scene([card('a1', 'red', 10)], [card('b1', 'black', 10)]);
  const next = finishTurn(s, 0);
  assert.notEqual(next.duel, null, '应进入对峙');
  assert.equal(next.duel?.seatA, 0);
  assert.equal(next.duel?.seatB, 1);
});

test('B13：不同格 ⇒ 不触发对峙', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 10 });
  const next = finishTurn(s, 0);
  assert.equal(next.duel, null, '不同格不该对峙');
});

// ---------- 选牌与同时揭晓 ----------

test('B13：双方各自选牌；一方锁定后对方仍未锁定（选牌不互相可见）', () => {
  const s = scene([card('a1', 'red', 10)], [card('b1', 'black', 10)]);
  const started = startDuel(s, 0, 1);
  assert.notEqual(started.duel, null);
  const r1 = submitDuelCard(started, 0, 'a1');
  assert.equal(r1.ok, true);
  assert.equal(r1.state.duel?.pickA, 'a1', '座 0 已锁定');
  assert.equal(r1.state.duel?.pickB, undefined, '座 1 尚未锁定');
  assert.equal(duelPicked(r1.state, 0), true);
  assert.equal(duelPicked(r1.state, 1), false);
  assert.equal(duelOpponent(r1.state, 0), 1);
});

test('B13：回合阻塞 —— 对峙未结算时 advanceTurn 不推进回合', () => {
  const s = scene([card('a1', 'red', 10)], [card('b1', 'black', 10)]);
  const started = startDuel(s, 0, 1);
  const before = started.turnIndex;
  const after = advanceTurn(started, 'standard');
  assert.equal(after.turnIndex, before, '回合不应推进');
  assert.equal(after.duel !== null, true, '对峙仍在');
});

// ---------- 结算 ----------

test('B13：颜色胜 —— 败者推后 1 格并抽 1 张牌；胜者不获额外收益', () => {
  const s = scene([card('a1', 'red', 10)], [card('b1', 'black', 10)]);
  const started = startDuel(s, 0, 1);
  let st = submitDuelCard(started, 0, 'a1').state;
  st = submitDuelCard(st, 1, 'b1').state;
  assert.equal(st.duel, null, '对峙应已结算');
  assert.equal(st.players[1]?.position, 4, '败者推后 1 格');
  assert.equal(st.players[0]?.position, 5, '胜者位置不变');
  assert.equal(st.players[0]?.hand.length, 0, '胜者不获额外收益（不拿对手的牌）');
  assert.equal(st.players[1]?.hand.length, 1, '败者亮牌离手 + 抽 1 张 = 1 张');
  assert.equal(st.decks.deck.length, 2, '牌库被抽走 1 张');
  assert.equal(st.publicCards.length, 2, '两张亮牌公开留场');
});

test('B13：点数胜 —— 同色比 rank，大者胜', () => {
  const s = scene([card('a1', 'red', 12)], [card('b1', 'red', 9)]);
  const started = startDuel(s, 0, 1);
  let st = submitDuelCard(started, 0, 'a1').state;
  st = submitDuelCard(st, 1, 'b1').state;
  assert.equal(st.players[1]?.position, 4, '座 1（rank 9）落败推后 1 格');
  assert.equal(st.players[0]?.position, 5);
});

test('B13：平局 —— 双方均不后退，各弃 1 张（亮牌弃掉、不公开留场）', () => {
  const s = scene([card('a1', 'red', 9)], [card('b1', 'red', 9)]);
  const started = startDuel(s, 0, 1);
  let st = submitDuelCard(started, 0, 'a1').state;
  st = submitDuelCard(st, 1, 'b1').state;
  assert.equal(st.players[0]?.position, 5, '座 0 不后退');
  assert.equal(st.players[1]?.position, 5, '座 1 不后退');
  assert.equal(st.players[0]?.hand.length, 0, '各弃 1 张');
  assert.equal(st.players[1]?.hand.length, 0, '各弃 1 张');
  assert.equal(st.publicCards.length, 0, '平局的亮牌被弃掉、不公开留场');
});

test('B13：任一方手牌为空 ⇒ 自动落败（推后 1 格、不抽牌）', () => {
  const s = scene([card('a1', 'red', 10)], []);
  const started = startDuel(s, 0, 1);
  assert.equal(started.duel, null, '手牌为空 ⇒ 直接结算，不进入待决');
  assert.equal(started.players[1]?.position, 4, '空手方推后 1 格');
  assert.equal(started.players[0]?.hand.length, 1, '胜者不获额外收益');
});

test('B13：公开亮牌在 round 末清空', () => {
  const s = scene([card('a1', 'red', 10)], [card('b1', 'black', 10)]);
  const started = startDuel(s, 0, 1);
  let st = submitDuelCard(started, 0, 'a1').state;
  st = submitDuelCard(st, 1, 'b1').state;
  assert.equal(st.publicCards.length, 2);
  // 把手番指针推到本 round 最后一个（3 个存活者 ⇒ turnIndex = 3 时下一推进即 round 末）
  const atEnd: State = { ...st, turnIndex: 3 };
  const after = advanceTurn(atEnd, 'standard');
  assert.equal(after.publicCards.length, 0, 'round 末公开亮牌应清空');
});
