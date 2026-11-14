// 身份的**被动特权**（规格 §4.1 权威被动表，B12）。
//
// ⚠️ B12 修正：此前本文件**只覆盖 extra_vote**（常驻型），其余 7 个被动的 op
//   **只写不读** —— 引擎里没有任何消费点，机制看着实现、实际永不触发
//   （实测：主题包 4 套 × 8 身份的被动，只有仲裁者的 extra_vote 真正生效）。
//   B12 为每个被动补齐触发点与消费点。
//
// 设计要点：
//   · **触发方式两类**：「自动」= 在对应流程里自动应用（开拓者 / 守夜人 / 山主）；
//     「主动」= 玩家在行动阶段「行事」时发动（匠师 / 观星者 / 窃火者 / 织梦者）。
//   · **次数闸门**：「每回合 1 次」用 `turn.abilityUsedThisTurn`（回合末清零）；
//     「每场 1 次」用 `counters.abilityUses`（本局累计，不清零）。
//   · 被动规格在**分配身份时**授予玩家（`flags.passive`），引擎按 **op** 分发
//     ⇒ **主题化友好**：不同主题的同一身份用不同 op 也能正确工作。

import type { Effect } from '../types/theme.ts';
import type { State } from './state.ts';

/** 被动规格（主题包 `identity.passive` 原样搬运）。 */
export type PassiveSpec = Effect;

/** 主动型被动的 op（其余为常驻型或自动型）。 */
export const ACTIVE_ABILITY_OPS = ['create_card', 'peek_deck', 'transfer_resource', 'modify_judgement'] as const;

/** 主动型被动的 op 集合。 */
const ACTIVE_OPS = new Set<string>(ACTIVE_ABILITY_OPS);

/** 被动里授予的常驻标记。 */
export interface GrantedFlags {
  /** 投票权重加成（`extra_vote`）：投票权重 = 1 + extraVotes */
  readonly extraVotes: number;
}

/**
 * 计算一个被动里**常驻型**效果的授予值。
 *
 * 递归下探 sequence / conditional / count —— 被动也可能是组合结构。
 *
 * ⚠️ 只有**常驻型**（投票权重加成）走这里；其余被动由 `performAbility`（主动型）
 *   或各流程的自动触发点（自动型）消费 —— 见文件头「设计要点」。
 */
export function grantedFlags(passive: Effect | undefined): GrantedFlags {
  let extraVotes = 0;
  const walk = (e: Effect): void => {
    switch (e.op) {
      case 'extra_vote':
        extraVotes += e.amount;
        break;
      case 'sequence':
        e.effects.forEach(walk);
        break;
      case 'conditional':
        walk(e.then);
        if (e.else !== undefined) { walk(e.else); }
        break;
      case 'count':
        walk(e.effect);
        break;
      default:
        break;
    }
  };
  if (passive !== undefined) { walk(passive); }
  return { extraVotes };
}

/** 读某玩家的被动规格（未授予 ⇒ undefined，如旧存档）。 */
export function passiveOf(state: State, seat: number): PassiveSpec | undefined {
  const raw = state.players[seat]?.flags.passive;
  return raw === undefined ? undefined : (raw as PassiveSpec);
}

/**
 * 主动被动的**稳定标识**（未授予被动 ⇒ 空串）。
 *
 * ⚠️ `PassiveSpec = Effect` ⇒ 被动**没有 id 字段**，可辨识的只有 `op`。
 *   `legal.ts` 与 `web/legal-gate.ts` 必须共用这个取法，不得各写一份——
 *   两处各写就是「枚举给的 abilityId 与 UI 显示的 abilityId 分叉」的开始
 *   （B15 已注册的三处镜像漂移同源）。
 *   引擎侧 `performAbility` 从不读 `Action.abilityId`（发动哪个被动由 `flags.passive` 决定），
 *   所以这个标识只服务于「对外一致」，不影响合法性判定。
 */
export function activeAbilityId(state: State, seat: number): string {
  return passiveOf(state, seat)?.op ?? '';
}

/** 主动能力是否可发动。 */
export interface AbilityAvailability {
  /** 是否可发动 */
  readonly usable: boolean;
  /** 不可用的原因（可发动时为空串） */
  readonly reason: string;
  /** 是否需要选择目标（窃火者偷资源） */
  readonly needsTarget: boolean;
}

/**
 * 主动能力的可用性判据。
 *
 * 「每场 1 次」用 `counters.abilityUses`（本局累计）；
 * 「每回合 1 次」用 `turn.abilityUsedThisTurn`（回合末清零）。
 */
export function abilityAvailability(state: State, seat: number): AbilityAvailability {
  const player = state.players[seat];
  if (player === undefined) { return { usable: false, reason: '座位不存在', needsTarget: false }; }
  if (!player.alive) { return { usable: false, reason: '已出局', needsTarget: false }; }
  // ⚠️ B76：力竭封锁主动被动（规格设计 §2 效果 #3）——观星者 / 窃火者 / 织梦者 / 匠师全走本入口。
  if ((player.exhaustedRounds ?? 0) > 0) { return { usable: false, reason: '力竭期间不能发动被动', needsTarget: false }; }
  const passive = passiveOf(state, seat);
  if (passive === undefined) { return { usable: false, reason: '本局没有身份被动（旧存档）', needsTarget: false }; }
  if (!ACTIVE_OPS.has(passive.op)) { return { usable: false, reason: '该被动为自动/常驻型，无需发动', needsTarget: false }; }
  // 「每场 1 次」：匠师（`freeCreates` 专用计数，不与其它被动的总次数混用）
  if (passive.op === 'create_card') {
    const used = player.counters.freeCreates ?? 0;
    if (used >= 1) { return { usable: false, reason: '本场已用过一次免费造物', needsTarget: false }; }
  }
  // 「每回合 1 次」：观星者 / 窃火者 / 织梦者
  if (player.turn.abilityUsedThisTurn) {
    return { usable: false, reason: '本回合已发动过被动', needsTarget: false };
  }
  return { usable: true, reason: '', needsTarget: passive.op === 'transfer_resource' };
}
