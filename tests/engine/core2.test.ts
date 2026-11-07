// B1 引擎骨架的行为契约（先于实现写，规格 §3.1 / §3.4 / §4.3）

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getScales } from '../../engine/scales.ts';
import { createInitialState } from '../../engine/core/state.ts';
import { nextTurn, advanceRound } from '../../engine/core/round.ts';
import { drawCards, discardDownToLimit, handLimitOf } from '../../engine/core/hand.ts';
import { gainResource, spendResource, RESOURCE_CAP } from '../../engine/core/resource.ts';
import { tileAt, peakIndexOf } from '../../engine/core/board.ts';
import { at } from './helpers.ts';


// ---------- 开局发牌（§3.1 开局设置 / §8 counts.handStart） ----------

test('开局每人发 handStart 张手牌', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  for (const p of s.players) {
    assert.equal(p.hand.length, getScales(3).handStart);
  }
});


// ---------- 手牌与牌库循环（§3.1 步骤 6、§3.4 险径） ----------

test('手牌上限 = 体力上限（沿用原作「手牌数 = 体力值」）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const p = at(s.players, 0);
  assert.equal(handLimitOf(p), p.hpMax);
});

test('抽牌后手牌数增加', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const before = at(s.players, 0).hand.length;
  const r = drawCards(s, 0, 3);
  assert.equal(at(r.players, 0).hand.length, before + 3);
});

test('未超上限时裁牌不动手牌', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const trimmed = discardDownToLimit(s, 0);
  assert.equal(at(trimmed.players, 0).hand.length, at(s.players, 0).hand.length);
  assert.equal(trimmed.discard.length, 0);
});

test('裁牌：超出上限的牌被弃掉并进入弃牌堆', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const limit = handLimitOf(at(s.players, 0));
  const drawn = drawCards(s, 0, limit + 3); // 明确超出上限
  assert.ok(at(drawn.players, 0).hand.length > limit);
  const trimmed = discardDownToLimit(drawn, 0);
  assert.equal(at(trimmed.players, 0).hand.length, limit);
  assert.ok(trimmed.discard.length >= 3, '被弃的牌应进入弃牌堆');
});

test('牌库抽空后弃牌堆洗回牌库（牌库循环）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const limit = handLimitOf(at(s.players, 0));
  // 先抽到超上限并裁牌，制造弃牌堆
  const discarded = discardDownToLimit(drawCards(s, 0, limit + 5), 0);
  assert.ok(discarded.discard.length > 0);
  // 抽空牌库
  const emptied = drawCards(discarded, 0, discarded.deck.length);
  assert.equal(emptied.deck.length, 0);
  assert.ok(emptied.discard.length > 0, '弃牌堆应仍有牌可洗回');
  // 再抽一张应触发洗回弃牌堆：手牌 +1，弃牌堆清空
  const recycled = drawCards(emptied, 0, 1);
  assert.equal(at(recycled.players, 0).hand.length, at(emptied.players, 0).hand.length + 1);
  assert.equal(recycled.discard.length, 0, '洗回后弃牌堆应清空');
});


// ---------- 灵枢经济（§4.3） ----------

test('灵枢收入后增加，上限为 10', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const g = gainResource(s, 0, 3);
  assert.equal(at(g.players, 0).resource, at(s.players, 0).resource + 3);
  const capped = gainResource(g, 0, 99);
  assert.equal(at(capped.players, 0).resource, RESOURCE_CAP);
});

test('灵枢不足时无法支出，状态不变', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const r = spendResource(s, 0, 99);
  assert.equal(r.ok, false);
  assert.equal(at(r.state.players, 0).resource, at(s.players, 0).resource);
});


// ---------- 棋盘（§3.3） ----------

test('棋盘格位按 index 可寻址，峰顶为 peakIndex', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  assert.equal(tileAt(s.board, 1)?.index, 1);
  assert.equal(peakIndexOf(s.board), s.board.peakIndex);
});

test('越界格位返回 undefined（不抛异常）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  assert.equal(tileAt(s.board, 9999), undefined);
});


// ---------- 空跑一局（§10 B1 验收） ----------

test('空跑一局：3 人局在全局回合上限内结束，round 正确推进', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  const limit = getScales(3).globalRoundLimit;
  let state = s;
  let guard = 0;
  while (state.round <= limit && guard < 10_000) {
    state = advanceRound(nextTurn(state));
    guard += 1;
  }
  assert.ok(state.round > limit, '未在回合上限后停机');
  assert.ok(guard < 10_000, '疑似死循环');
});
