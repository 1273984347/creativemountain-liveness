// 终局目标判定器（规格 §6.4 目标判定表）
//
// 目标判定**不是**普通效果算子，而是引擎内建的一组判定器。
// 主题包通过 `goal: { kind, count }` 声明，只能取本表枚举值。
//
// 判定时机统一：除 `veto_success` 与 `successful_challenge` 为**即时结算**外，
// 其余均在**回合末结算**统一检查（避免同回合内多次触发导致重复发奖）。
// 达成即发【印记】（印记效果由引擎统一处理，主题包不定义）。

import type { GoalKind } from '../types/theme.ts';
import type { State } from '../core/state.ts';

/** 判定时机。 */
export type GoalTiming = 'round_end' | 'immediate' | 'terminal';

/** 目标判定器。 */
export interface GoalJudge {
  /** 判定时机 */
  readonly timing: GoalTiming;
  /** 引擎内建计数器名（与规格 §6.4 表一致） */
  readonly counter: string;
  /**
   * 判定：返回是否达成。
   * `count` 为阈值（缺省 1）。`survive_with_hp` 的 count 忽略。
   */
  readonly judge: (state: State, seat: number, count: number) => boolean;
}

/** 取玩家的计数器值。 */
function counterOf(state: State, seat: number, name: string): number {
  return state.players[seat]?.counters[name] ?? 0;
}

/** 目标判定器表。 */
export const GOALS: Record<GoalKind, GoalJudge> = {
  pass_gates: {
    timing: 'round_end',
    counter: 'gatesPassed',
    judge: (s, seat, count) => counterOf(s, seat, 'gatesPassed') >= count,
  },
  equip_count: {
    timing: 'round_end',
    counter: 'equipsTotal',
    judge: (s, seat, count) => counterOf(s, seat, 'equipsTotal') >= count,
  },
  draw_count: {
    timing: 'round_end',
    counter: 'cardsDrawn',
    judge: (s, seat, count) => counterOf(s, seat, 'cardsDrawn') >= count,
  },
  veto_success: {
    timing: 'immediate',
    counter: 'vetoCount',
    judge: (s, seat, count) => counterOf(s, seat, 'vetoCount') >= count,
  },
  /** 存活至终局 且 当前体力 >= 初始体力（count 忽略） */
  survive_with_hp: {
    timing: 'terminal',
    counter: '',
    judge: (s, seat) => {
      const p = s.players[seat];
      return p !== undefined && p.alive && p.hp >= p.hpMax;
    },
  },
  steal_count: {
    timing: 'round_end',
    counter: 'stolenTotal',
    judge: (s, seat, count) => counterOf(s, seat, 'stolenTotal') >= count,
  },
  reroll_count: {
    timing: 'round_end',
    counter: 'rerollCount',
    judge: (s, seat, count) => counterOf(s, seat, 'rerollCount') >= count,
  },
  successful_challenge: {
    timing: 'immediate',
    counter: 'successfulChallenges',
    judge: (s, seat, count) => counterOf(s, seat, 'successfulChallenges') >= count,
  },
};

/** 判定某玩家的某目标是否达成。 */
export function isGoalAchieved(state: State, seat: number, kind: GoalKind, count: number): boolean {
  return GOALS[kind].judge(state, seat, count);
}

/** 该目标是否应在回合末检查（即时/终局目标不在此列）。 */
export function isRoundEndGoal(kind: GoalKind): boolean {
  return GOALS[kind].timing === 'round_end';
}
