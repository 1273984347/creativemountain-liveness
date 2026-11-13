// 终局目标结算（规格 §6.4「达成即发印记」+ §4.1 印记效果）。
//
// ⚠️ **为什么需要这个文件（B60）**：此前 `goals/registry.ts` 是**只读不跑的死表** ——
//   ① 目标判定（`isGoalAchieved`）在生产代码里**零调用方**（只有测试引用）；
//   ② 「达成即发印记」的**写方不存在** ⇒ `hasMark` 永远为 false
//      ⇒ 规格 §4.1「持印记者所需签印数减半」**永不生效**。
//   ⇒ 即便 `gatesPassed` 被写入，身份目标依然**没有任何可观测后果**。
//   本文件补上判定 → 发印记这条链，使「身份目标」真正**可达**。
//
// ⚠️ **判定时机由 `GOALS[kind].timing` 决定**（唯一事实源，不在本文件另立一张表）：
//   · `round_end`  ⇒ 回合末统一检查（`settleRoundEndGoals`）；
//   · `terminal`   ⇒ 终局判定时一次性检查（`settleTerminalGoals`）；
//   · `immediate`  ⇒ 即时结算（两个接线点：B61 的「质疑判不通过」处、B75 的「仲裁者否决实际阻止放逐」处）；
//     B75 前该时机的 `veto_success` 因**没有否决机制**而恒为 false（登记见 `docs/批次/B60-*.md` §7 T3 与 `README.md` G-i），
//     `vetoCount` 的写入点自 B75 起才存在 ⇒ 本时机**已有生产调用方**。
//
// ⚠️ **目标从哪来**：State **不持有主题包引用**（§6.2 契约冻结）⇒ 身份的
//   `goal { kind, count }` 由 `setup.ts` 在**开局分配身份时**派生到 `player.flags.goal`。
//   身份是**开局随机分配**的（B10）⇒ 目标整局不变 ⇒ 派生一次即够。

import type { State } from '../core/state.ts';
import type { GoalKind } from '../types/theme.ts';
import { GOALS, isGoalAchieved, type GoalTiming } from './registry.ts';

/** 玩家身份目标（开局由主题包派生到 `flags.goal`）。 */
export interface PlayerGoal {
  /** 目标判定器名（规格 §6.4 目标判定表）。 */
  readonly kind: GoalKind;
  /** 达成阈值（缺省 1）。 */
  readonly count: number;
}

/**
 * 取玩家的身份目标。
 *
 * ⚠️ **没有目标信息 ⇒ 返回 null（跳过判定），不是「判定为未达成」** ——
 *   未装主题的测试局面（`createInitialState`）没有 `flags.goal`，
 *   若把「缺目标」当成「未达成」再发一枚印记 ⇒ 会凭空造出奖励。
 */
export function goalOf(state: State, seat: number): PlayerGoal | null {
  const raw = state.players[seat]?.flags.goal;
  if (raw === undefined || raw === null || typeof raw !== 'object') { return null; }
  const g = raw as { kind?: unknown; count?: unknown };
  // ⚠️ **必须用 `Object.hasOwn` 而不是 `in`**：`'constructor' in GOALS` 会命中
  //   `Object.prototype` 上的键 ⇒ 非法 kind 能通过校验（虽然当前会被 timing 判据挡住，
  //   但那是**巧合**，不是保证）⇒ 判据本身要严。
  if (typeof g.kind !== 'string' || !Object.hasOwn(GOALS, g.kind)) { return null; }
  const count = typeof g.count === 'number' && Number.isFinite(g.count) ? g.count : 1;
  return { kind: g.kind as GoalKind, count };
}

/**
 * 结算指定时机的终局目标：**达成即发【印记】**（规格 §6.4 + §4.1）。
 *
 * ⚠️ **印记不叠加**（§4.1「重复获得不额外生效」）⇒ 已持印记者**直接跳过**：
 *   不重复发、**也不重复记日志**（否则日志会随回合数无界增长）。
 *
 * ⚠️ **出局者不判定**：印记只对「待认证者」有意义（§4.1 的签印门槛减半），
 *   而被放逐者已失去认证资格（§5.6）⇒ 给他发印记没有意义。
 */
export function settleGoals(state: State, timing: GoalTiming): State {
  const winners: { seat: number; goal: PlayerGoal }[] = [];
  for (const p of state.players) {
    if (!p.alive || p.hasMark) { continue; }
    const goal = goalOf(state, p.seat);
    if (goal === null) { continue; }
    // 判定时机不符 ⇒ 这一轮不判（不是「判为未达成」）。
    if (GOALS[goal.kind].timing !== timing) { continue; }
    if (!isGoalAchieved(state, p.seat, goal.kind, goal.count)) { continue; }
    winners.push({ seat: p.seat, goal });
  }
  if (winners.length === 0) { return state; }
  const seats = new Set(winners.map((w) => w.seat));
  return {
    ...state,
    players: state.players.map((p) => (seats.has(p.seat) ? { ...p, hasMark: true } : p)),
    log: [
      ...state.log,
      ...winners.map((w) => ({
        round: state.round,
        turnIndex: state.turnIndex,
        actor: w.seat,
        kind: 'goal',
        message: `身份目标达成（${w.goal.kind} ≥ ${w.goal.count}）—— 获得【印记】`,
      })),
    ],
  };
}

/**
 * 回合末结算目标（规格 §6.4 的 `round_end` 时机）。
 *
 * ⚠️ 规格 §6.4 明文：「其余均在**回合末结算**统一检查（避免同回合内多次触发导致重复发奖）」
 *   ⇒ 判定点**唯一** ⇒ 不在关隘通过的那一刻判（那会让同一回合多次触发）。
 */
export function settleRoundEndGoals(state: State): State {
  return settleGoals(state, 'round_end');
}

/**
 * **即时结算**目标（规格 §6.4 的 `immediate` 时机：否决生效时 / 质疑成功时）。
 *
 * ⚠️ B61：接线点在**质疑判不通过**处（`certification.ts` 的 `certifyAnswer`）——
 *   规格 §5.3.2：「质疑**成功**（答对 ≤ 1）」⇒ 判不通过即质疑成功 ⇒ 此时判定并发放印记。
 */
export function settleImmediateGoals(state: State): State {
  return settleGoals(state, 'immediate');
}

/**
 * 终局判定目标（规格 §6.4 的 `terminal` 时机 —— `survive_with_hp`「终局判定时一次性检查」）。
 *
 * ⚠️ **规格内部张力（如实登记，不擅自改语义）**：`survive_with_hp` 要求「存活至终局」，
 *   ⇒ 它**只能在终局才判定达成** ⇒ 印记在认证阶段（已结束）之后才发放
 *   ⇒ 对**本局**无实际收益（印记只减半签印门槛，而认证已结束）。
 *   本实现按规格**字面**执行（终局判定时发印记）；该张力的处置归后续裁定。
 */
export function settleTerminalGoals(state: State): State {
  return settleGoals(state, 'terminal');
}
