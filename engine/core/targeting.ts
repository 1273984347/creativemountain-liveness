// 出牌目标选择（规格 §3.3 对峙 / §6.4 效果算子）。
//
// 主题包里攻击类牌的目标写成 `target: 0` —— 那只是**占位**，
// 真实目标由使用者选择。若不覆盖，引擎会照字面打「座位 0」，
// 等于每张攻击牌都只能打同一个人。
//
// 本文件是**纯函数**（无副作用、无 DOM）⇒ 可直接单测，也是 UI 的判据来源。

import type { Card, Effect } from '../types/theme.ts';
import type { State } from './state.ts';

/** 一个效果里是否带**数字型 target**（= 需要选择目标）。 */
export function effectNeedsTarget(effect: Effect): boolean {
  switch (effect.op) {
    case 'conditional':
      return effectNeedsTarget(effect.then)
        || (effect.else !== undefined && effectNeedsTarget(effect.else));
    case 'count':
      return effectNeedsTarget(effect.effect);
    case 'sequence':
      return effect.effects.some((e) => effectNeedsTarget(e));
    default:
      return 'target' in effect && typeof (effect as { readonly target?: unknown }).target === 'number';
  }
}

/** 一张牌是否需要选择目标。 */
export function cardNeedsTarget(card: Card): boolean {
  return card.effects.some((e) => effectNeedsTarget(e));
}

/** 可选目标座位：**除自己外的存活玩家**（与卡面文案「对一名对手」一致）。 */
export function targetCandidates(state: State, seat: number): number[] {
  return state.players.filter((p) => p.alive && p.seat !== seat).map((p) => p.seat);
}

/**
 * 解析一次「点选目标」，返回出牌 payload。
 *
 * - 返回 null ⇒ **取消**（点了自己 / 非法选择）⇒ 不出牌；
 * - 返回 `{ cardId }`（无 target）⇒ 该牌不需要目标，直接出牌；
 * - 返回 `{ cardId, target }` ⇒ 出牌并把效果树里的目标整体改写为该座位。
 */
export function resolveTargetPick(
  state: State,
  seat: number,
  cardId: string,
  picked: number | undefined,
): { readonly cardId: string; readonly target?: number } | null {
  const card = state.players[seat]?.hand.find((c) => c.id === cardId);
  if (card === undefined) {
    return null;
  }
  if (!cardNeedsTarget(card)) {
    return { cardId };
  }
  const candidates = targetCandidates(state, seat);
  if (candidates.length === 0) {
    // 无人可打 ⇒ 不带目标（引擎会拒绝该效果，而不是误伤座位 0）
    return { cardId };
  }
  if (picked === undefined || !candidates.includes(picked)) {
    return null;
  }
  return { cardId, target: picked };
}