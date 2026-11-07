// 灵枢经济（规格 §4.3）

import type { State } from './state.ts';

/** 灵枢上限：达到上限必须立刻花掉，否则下一回合开始扣 1。 */
export const RESOURCE_CAP = 10;

/** 支出结果。`ok` 为 false 表示灵枢不足，状态不变。 */
export interface SpendResult<T> {
  readonly ok: boolean;
  readonly state: T;
}

/** 收入灵枢，受上限约束。返回新状态（不可变）。 */
export function gainResource(state: State, playerIndex: number, amount: number): State {
  const player = state.players[playerIndex];
  if (player === undefined || amount <= 0) {
    return state;
  }
  const players = [...state.players];
  players[playerIndex] = { ...player, resource: Math.min(RESOURCE_CAP, player.resource + amount) };
  return { ...state, players };
}

/**
 * 支出灵枢。灵枢不足时返回 `ok: false` 且状态**不变**。
 * §5.3.4 的质疑启动成本依赖此语义——灵枢不足时不得发起质疑。
 */
export function spendResource(state: State, playerIndex: number, amount: number): SpendResult<State> {
  const player = state.players[playerIndex];
  if (player === undefined || player.resource < amount) {
    return { ok: false, state };
  }
  const players = [...state.players];
  players[playerIndex] = { ...player, resource: player.resource - amount };
  return { ok: true, state: { ...state, players } };
}
