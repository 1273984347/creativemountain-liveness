// 机制原语注册表（规格 §6.4）
//
// 主题包**不允许内联代码**——所有效果以「算子 + 参数」表达，
// 算子在此注册并实现。参数一律为**字面量**，不提供任意表达式求值（不用 eval / Function）。
//
// 关键约束（实施计划 §0.3）：每个算子返回 `{ ok, state, note? }`——
// **效果因条件不满足而未生效时 `ok=false` 且状态不变**（与 §5.3.4 灵枢不足的语义一致）。

import type { Card } from '../types/theme.ts';
import type { State } from '../core/state.ts';

/** 算子求值上下文。 */
export interface OpContext {
  /** 当前状态 */
  readonly state: State;
  /** 效果使用者座位号（`target` 缺省即自己） */
  readonly actor: number;
  /** 来源卡（若由卡牌触发） */
  readonly sourceCard?: Card;
}

/** 算子结果。 */
export interface OpResult {
  /** 效果是否实际生效 */
  readonly ok: boolean;
  /** 不可变新状态（`ok=false` 时与入参等价） */
  readonly state: State;
  /** 失败原因（写入日志） */
  readonly note?: string;
}

/** 成功。 */
export function ok(state: State): OpResult {
  return { ok: true, state };
}

/** 失败（状态不变）。 */
export function fail(state: State, note: string): OpResult {
  return { ok: false, state, note };
}

/** 替换某玩家（不可变）。 */
export function withPlayer(state: State, seat: number, patch: Partial<State['players'][number]>): State {
  const players = [...state.players];
  const p = players[seat];
  if (p === undefined) {
    return state;
  }
  players[seat] = { ...p, ...patch };
  return { ...state, players };
}

/** 解析目标座位（缺省为使用者自己）。 */
export function resolveTarget(ctx: OpContext, target?: number): number {
  return target ?? ctx.actor;
}

/** 目标必须存活，否则操作无效。 */
export function aliveTarget(ctx: OpContext, target?: number): { seat: number; ok: true } | { ok: false; note: string } {
  const seat = resolveTarget(ctx, target);
  const p = ctx.state.players[seat];
  if (p === undefined) {
    return { ok: false, note: `目标不存在：座位 ${seat}` };
  }
  if (!p.alive) {
    return { ok: false, note: `目标已出局：座位 ${seat}` };
  }
  return { seat, ok: true };
}

/** 追加日志。 */
export function withLog(state: State, ctx: OpContext, kind: string, message: string, diceRoll?: number): State {
  const entry = {
    round: state.round,
    turnIndex: state.turnIndex,
    actor: ctx.actor,
    kind,
    message,
    ...(diceRoll === undefined ? {} : { diceRoll }),
  };
  return { ...state, log: [...state.log, entry] };
}
