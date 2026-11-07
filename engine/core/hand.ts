// 手牌、牌库与裁牌（规格 §3.1 步骤 4/6、§4.2 手牌上限 = 体力上限）

import type { Card } from '../types/theme.ts';
import type { Player, State } from './state.ts';

/** 手牌上限 = 体力上限（沿用原作「手牌数 = 体力值」）。 */
export function handLimitOf(player: Player): number {
  return player.hpMax;
}

/**
 * 抽牌。牌库抽空时把弃牌堆洗回牌库（规格 §3.1 步骤 6 牌库循环）；
 * 两者皆空则跳过（不抽）。
 */
export function drawCards(state: State, playerIndex: number, count: number): State {
  const player = state.players[playerIndex];
  if (player === undefined || count <= 0) {
    return state;
  }
  const drawn: Card[] = [];
  let deck = [...state.deck];
  let discard = [...state.discard];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) {
        break; // 牌库与弃牌堆皆空，跳过抽牌
      }
      deck = discard;
      discard = [];
    }
    const card = deck.shift();
    if (card === undefined) {
      break;
    }
    drawn.push(card);
  }
  const players = [...state.players];
  const target = players[playerIndex];
  if (target === undefined) {
    return state;
  }
  players[playerIndex] = { ...target, hand: [...target.hand, ...drawn] };
  return { ...state, players, deck, discard };
}

/** 裁牌：手牌数超出上限则弃至上限（规格 §3.1 步骤 4）。 */
export function discardDownToLimit(state: State, playerIndex: number): State {
  const player = state.players[playerIndex];
  if (player === undefined) {
    return state;
  }
  const limit = handLimitOf(player);
  if (player.hand.length <= limit) {
    return state;
  }
  const keep = player.hand.slice(0, limit);
  const dropped = player.hand.slice(limit);
  const players = [...state.players];
  players[playerIndex] = { ...player, hand: keep };
  return { ...state, players, discard: [...state.discard, ...dropped] };
}

/** 开局发牌：每名玩家发 `scales.handStart` 张（规格 §3.1 开局设置）。 */
export function dealInitialHands(state: State): State {
  let next = state;
  for (const p of state.players) {
    if (!p.alive) {
      continue;
    }
    next = drawCards(next, p.seat, state.scales.handStart);
  }
  return next;
}
