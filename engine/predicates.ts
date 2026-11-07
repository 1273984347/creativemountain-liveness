// 条件谓词注册表（规格 §6.4）
//
// 谓词是纯函数：读状态 → 返回布尔。**不产生副作用**。
// 组合器 `conditional` 用它决定分支（规格 §6.4 组合表达）。

import type { Card, Predicate, PredicateMap, PredicateName } from './types/theme.ts';
import type { CompareOp } from './types/common.ts';
import { filterMatches } from './types/card.ts';
import type { State } from './core/state.ts';

/** 谓词求值上下文。 */
export interface PredicateContext {
  /** 当前状态 */
  readonly state: State;
  /** 效果使用者座位号（`tile_kind` / `has_card` 等默认以TA为准） */
  readonly actor: number;
}

/** 数值比较。 */
function compare(actual: number, op: CompareOp, expected: number): boolean {
  switch (op) {
    case 'lte': return actual <= expected;
    case 'gte': return actual >= expected;
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
  }
}

/** 取某玩家的手牌（不存在则空数组）。 */
function handOf(ctx: PredicateContext, seat: number): readonly Card[] {
  return ctx.state.players[seat]?.hand ?? [];
}

/** 谓词实现表。 */
export type PredicateHandlers = {
  [K in PredicateName]: (ctx: PredicateContext, params: PredicateMap[K]) => boolean;
};

export const PREDICATES: PredicateHandlers = {
  tile_kind: (ctx, p) => {
    const seat = ctx.actor;
    const player = ctx.state.players[seat];
    if (player === undefined) { return false; }
    const index = p.tileIndex ?? player.position;
    const tile = ctx.state.board.tiles.find((t) => t.index === index);
    return tile !== undefined && tile.kind === p.kind;
  },
  has_card: (ctx, p) => handOf(ctx, ctx.actor).some((c) => filterMatches(p.filter, c)),
  resource_at_least: (ctx, p) => (ctx.state.players[ctx.actor]?.resource ?? 0) >= p.amount,
  hand_count: (ctx, p) => compare(handOf(ctx, ctx.actor).length, p.op, p.count),
  is_pending_cert: (ctx) => ctx.state.players[ctx.actor]?.pendingCert === true,
  phase_is: (ctx, p) => ctx.state.phase === p.value,
  players_alive: (ctx, p) =>
    compare(ctx.state.players.filter((pl) => pl.alive).length, p.op, p.count),
  /** 作用域：效果使用者**手牌**中是否存在该类型的牌（缺口 G6 的裁定）。 */
  card_type_is: (ctx, p) => handOf(ctx, ctx.actor).some((c) => c.type === p.type),
  identity_is: (ctx, p) => ctx.state.players[ctx.actor]?.identityId === p.identityId,
  faction_is: (ctx, p) => ctx.state.players[ctx.actor]?.factionId === p.factionId,
  hp_at_least: (ctx, p) => (ctx.state.players[ctx.actor]?.hp ?? 0) >= p.amount,
  flag_set: (ctx, p) => ctx.state.players[ctx.actor]?.flags[p.flag] !== undefined,
  last_dice_even: (ctx) => ctx.state.lastDice % 2 === 0,
  /** 关隘试炼「掷指令骰 ≥ 15」用（缺口 G2）。 */
  dice_is_at_least: (ctx, p) => ctx.state.lastDice >= p.amount,
  /** 对峙与险径的颜色判定（缺口 G3）。 */
  card_color_is: (ctx, p) => {
    if (p.source.kind === 'deckTop') {
      const top = ctx.state.decks.deck[0];
      return top !== undefined && top.color === p.color;
    }
    const source = p.source;
    if (source.kind !== 'cardId') {
      return false;
    }
    const c = handOf(ctx, ctx.actor).find((x) => x.id === source.cardId);
    return c !== undefined && c.color === p.color;
  },
};

/** 求值一个谓词。 */
export function evaluatePredicate(ctx: PredicateContext, pred: Predicate): boolean {
  const handler = PREDICATES[pred.kind] as (c: PredicateContext, p: unknown) => boolean;
  return handler(ctx, pred);
}
