// 回合（round）与手番（turn）的粒度控制（规格 §3.1 术语定义）
//
// **回合(round)** = 所有存活玩家各完成一次行动；**手番(turn)** = 单个玩家的一次行动。
// 步骤 1–6 在每个手番执行；山议（步骤 7）与认证（步骤 8）**仅在 round 结束时执行一次**。

import type { State } from './state.ts';

/** 当前手番的玩家座位号。已出局玩家不占手番。 */
export function currentPlayer(state: State): number {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length === 0) {
    return -1;
  }
  // turnIndex 是「已行动的手番数」，对存活玩家循环取用
  const idx = state.turnIndex % alive.length;
  return alive[idx]?.seat ?? -1;
}

/**
 * 本手番是否为 round 的最后一个（此时才触发山议与认证）。
 *
 * ⚠️ B9 修正：原判据是 `turnIndex >= aliveCount - 1` —— 而 `turnIndex` 的语义是
 *   「**已行动**的手番数」（见 `currentPlayer` 的注释），已行动人数等于存活人数时
 *   round 才结束。原判据**提前一轮**结束 ⇒ 3 人局每 round 只有 2 人能行动，
 *   第三人永远轮不到（实测：座 2 全程位置 0）⇒ 无人登顶 ⇒ 兜底触发率 100%。
 */
export function isRoundEnd(state: State): boolean {
  const aliveCount = state.players.filter((p) => p.alive).length;
  return state.turnIndex >= aliveCount;
}

/** 推进到下一个手番（不跨 round）。 */
export function nextTurn(state: State): State {
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount === 0) {
    return state;
  }
  return { ...state, turnIndex: state.turnIndex + 1 };
}

/** 跨 round：round +1，turnIndex 归零。 */
export function advanceRound(state: State): State {
  return { ...state, round: state.round + 1, turnIndex: 0 };
}
