// 山议放逐**不得击穿存活下限**（B10 收尾④ 修正的回归）。
//
// 背景：原实现对每个被提名者**独立**判断 `alive.length - 1 < exileFloor`
//   ⇒ 一次山议可放逐多人。4 人局若全员并列最高票 ⇒ 4 人**同时**被放逐 ⇒ 存活归零
//   ⇒ `currentPlayer` 返回 -1 ⇒ 对局**无结局**（实测 24000 局出现 1 例「未分出胜负」）。
//   规格 §5.8：任何时候场上存活玩家不得少于 3 人 ⇒ 下限须按**累计**口径守住。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { castVote, openCouncil, resolveCouncil, topVoted } from '../../engine/core/council.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { getScales } from '../../engine/scales.ts';

/** 存活人数。 */
function aliveCount(s: State): number {
  return s.players.filter((p) => p.alive).length;
}

test('山议：4 人局全员并列最高票时，不得把存活人数打到下限以下', () => {
  const s = createInitialState({ players: 4, seed: 11, deckSize: 40 });
  const opened = openCouncil(s);
  assert.equal(opened.ok, true);
  let st = opened.state;
  // 环形投票 ⇒ 每人各得 1 票 ⇒ 全员并列最高
  for (let i = 0; i < 4; i++) {
    st = castVote(st, i, (i + 1) % 4).state;
  }
  assert.equal(topVoted(st).length, 4, '应构造出 4 人并列最高');
  const res = resolveCouncil(st);
  assert.equal(res.ok, true);
  const alive = aliveCount(res.state);
  assert.ok(alive >= 3, `存活人数 ${alive} 不得低于放逐下限 3`);
  assert.ok(currentPlayer(res.state) >= 0, '对局必须还能继续（currentPlayer 不得为 -1）');
});

test('山议：8 人局全员并列最高票时，存活人数仍须 ≥ 放逐下限', () => {
  const s = createInitialState({ players: 8, seed: 12, deckSize: 40 });
  const opened = openCouncil(s);
  assert.equal(opened.ok, true);
  let st = opened.state;
  for (let i = 0; i < 8; i++) {
    st = castVote(st, i, (i + 1) % 8).state;
  }
  assert.equal(topVoted(st).length, 8, '应构造出 8 人并列最高');
  const res = resolveCouncil(st);
  const floor = getScales(8).exileFloor;
  const alive = aliveCount(res.state);
  assert.ok(alive >= floor, `存活人数 ${alive} 不得低于放逐下限 ${floor}`);
  assert.ok(currentPlayer(res.state) >= 0, '对局必须还能继续');
});

test('山议：常规放逐行为不变（5 人局，座位 1 得 2 票居首 ⇒ 放逐 1 人）', () => {
  const s = createInitialState({ players: 5, seed: 13, deckSize: 40 });
  const opened = openCouncil(s);
  assert.equal(opened.ok, true);
  let st = opened.state;
  st = castVote(st, 0, 1).state;
  st = castVote(st, 1, 2).state;
  st = castVote(st, 2, 1).state;
  st = castVote(st, 3, 4).state;
  st = castVote(st, 4, 3).state;
  assert.deepEqual(topVoted(st), [1], '座位 1 得 2 票居首');
  const res = resolveCouncil(st);
  assert.equal(res.ok, true);
  assert.equal(aliveCount(res.state), 4, '应放逐 1 人');
  assert.equal(res.state.players[1]?.alive, false, '座位 1 被放逐');
});

test('山议：凭证免疫仍然生效（持凭证者不被放逐）', () => {
  const s = createInitialState({ players: 5, seed: 14, deckSize: 40 });
  const withFlag: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 1 ? { ...p, flags: { ...p.flags, exemptFromVote: true } } : p)),
  };
  const opened = openCouncil(withFlag);
  assert.equal(opened.ok, true);
  let st = opened.state;
  st = castVote(st, 0, 1).state;
  st = castVote(st, 1, 2).state;
  st = castVote(st, 2, 1).state;
  const res = resolveCouncil(st);
  assert.equal(res.state.players[1]?.alive, true, '持凭证者不应被放逐');
});
