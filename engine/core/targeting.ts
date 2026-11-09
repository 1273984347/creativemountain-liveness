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

/**
 * 一张牌是否**含位移**（规格 §5.1「待认证锁定」用）。
 *
 * ⚠️ **为什么不能只看 `card.type === 'motion'`**（B66 实测）：主题包里有一张
 *   **`utility` 类型**的位移牌（`c_throwspirit` / cost 1 / `move_by_dice`）
 *   ⇒ 只按 type 判会**漏掉它** ⇒ 锁定者仍能用它位移 ⇒ 锁定被绕过。
 *   ⇒ 判据按 **op 语义**（与 B65 的 `pickPlayableCard` 同款思路）。
 *
 * ⚠️ **嵌套效果要展开**：`sequence` / `conditional` / `count` 里藏的位移也算
 *   （否则一张 sequence 位移牌会绕过锁定）。
 */
export function cardHasMovement(card: Card): boolean {
  const MOVE_OPS = new Set([
    'move_forward', 'move_backward', 'move_to_tile', 'move_relative_to',
    'swap_position', 'teleport', 'move_by_dice',
  ]);
  const walk = (effects: readonly Effect[]): boolean => {
    for (const eff of effects) {
      if (MOVE_OPS.has(eff.op)) { return true; }
      if (eff.op === 'sequence' && walk(eff.effects)) { return true; }
      if (eff.op === 'conditional') {
        if (walk([eff.then]) || (eff.else !== undefined && walk([eff.else]))) { return true; }
      }
      if (eff.op === 'count' && walk([eff.effect])) { return true; }
    }
    return false;
  };
  return walk(card.effects);
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