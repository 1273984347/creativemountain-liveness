// 裂隙与封路印（规格 §3.4，B18-b）的回归测试。
//
// 覆盖：① 待放印判定（含资源不足不打扰玩家）；② 放印（扣费 + 置印 + **不判定自己**）；
//   ③ 不放印；④ **已有印时到达 ⇒ 判色**（红通过 / 黑停 1 回合）；⑤ 引擎层门禁。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { BARRIER_COST, judgeBarrier, pendingBarrier, resolveBarrier } from '../../engine/core/barrier.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import type { ThemePack } from '../../engine/types/theme.ts';

/** 17 号格 = 裂隙（xianxia2026 主题）。 */
const RIFT_INDEX = 17;

/** 装主题并把座 0 放到裂隙格（`resource` 可调；`barrier` 可预置封路印）。 */
function riftScene(opts: { readonly resource?: number; readonly barrier?: boolean } = {}): State {
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  const s0 = installTheme(createInitialState({ players: 4, seed: 7, deckSize: 40 }), theme);
  const board = opts.barrier === true
    ? { ...s0.board, tiles: s0.board.tiles.map((t) => (t.index === RIFT_INDEX ? { ...t, barrier: true } : t)) }
    : s0.board;
  return {
    ...s0,
    board,
    players: s0.players.map((p) =>
      p.seat === 0 ? { ...p, position: RIFT_INDEX, resource: opts.resource ?? 10 } : p),
  };
}

/** 把牌堆顶换成指定颜色（判色用）。 */
function topColor(state: State, color: 'red' | 'black'): State {
  const top = state.decks.deck[0];
  assert.ok(top !== undefined, '牌堆不应为空');
  const deck = [top === undefined ? top : { ...top, color }, ...state.decks.deck.slice(1)];
  return { ...state, decks: { ...state.decks, deck } };
}

test('B18-b：落在无印裂隙格且资源够 ⇒ 待放印；资源不足则不打扰玩家', () => {
  const s = riftScene();
  assert.ok(pendingBarrier(s, 0) !== null, '应待放印');
  assert.equal(pendingBarrier(s, 1), null, '别的座位不在裂隙格上');
  assert.equal(pendingBarrier(riftScene({ resource: BARRIER_COST - 1 }), 0), null, '资源不足 ⇒ 不必打扰');
  assert.equal(pendingBarrier(riftScene({ barrier: true }), 0), null, '已有印 ⇒ 直接判定，不给选择');
});

test('B18-b：放印 —— 扣 2 资源、在该格置印，且**放置当次不判定自己**', () => {
  const s = riftScene();
  const r = resolveBarrier(s, 0, 'place');
  assert.equal(r.ok, true, '放印应成功：' + String(r.note));
  assert.equal(r.state.players[0]?.resource, 10 - BARRIER_COST, '应扣掉 2 点资源');
  const tile = r.state.board.tiles.find((t) => t.index === RIFT_INDEX);
  assert.equal(tile?.barrier, true, '该格应有封路印');
  assert.equal(r.state.players[0]?.statuses.skip_turn ?? 0, 0, '放置当次不判定自己 ⇒ 不会被自己封住');
});

test('B18-b：不放印 —— 直接通过（不扣资源、不置印）', () => {
  const s = riftScene();
  const r = resolveBarrier(s, 0, 'skip');
  assert.equal(r.ok, true);
  assert.equal(r.state.players[0]?.resource, 10, '不放印不扣资源');
  const tile = r.state.board.tiles.find((t) => t.index === RIFT_INDEX);
  assert.notEqual(tile?.barrier, true, '不放印 ⇒ 无封路印');
  assert.ok(r.state.log.some((l) => l.kind === 'barrier'), '应留下裂隙日志（让探针能区分已处理）');
});

test('B18-b：封路印判定 —— 红牌通过、黑牌停 1 回合（沿用险径判色）', () => {
  const s = topColor(riftScene(), 'red');
  const before = s.decks.deck.length;
  const red = judgeBarrier(s, 0);
  assert.equal(red.blocked, false, '红牌应通过');
  assert.equal(red.state.decks.deck.length, before - 1, '翻开的牌应从牌堆顶取出');
  const black = judgeBarrier(topColor(riftScene(), 'black'), 0);
  assert.equal(black.blocked, true, '黑牌应被拦');
  assert.equal(black.state.players[0]?.statuses.skip_turn ?? 0, 1, '被拦 ⇒ 停 1 回合');
});

test('B18-b：引擎层门禁 —— 待放印时行棋/问天/出牌一律被拒', () => {
  const s = riftScene();
  assert.equal(performAction(s, 0, 'move'), s, '待放印时不得行棋');
  assert.equal(performAction(s, 0, 'ask'), s, '待放印时不得问天');
  assert.equal(performAction(s, 0, 'act', { cardId: 'x' }), s, '待放印时不得出牌');
});
