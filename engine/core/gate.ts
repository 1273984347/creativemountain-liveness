// 关隘（规格 §3.5）
//
// 关隘是山道上的硬门槛，每座提供两条通过路径：
//   · **付费通道**：支付关隘标价（3–5 灵枢）立即通过；
//   · **试炼通道**：抽一张试炼牌执行其要求。
// 已通过同座关隘的试炼牌不再被抽取。

import type { State } from './state.ts';
import type { Tile } from '../types/theme.ts';

/** 关隘操作结果。 */
export interface GateResult {
  readonly ok: boolean;
  readonly state: State;
  /** 是否通过（false = 停留/失败） */
  readonly passed: boolean;
  readonly note?: string;
}

function fail(state: State, passed: boolean, note: string): GateResult {
  return { ok: false, state, passed, note };
}

/** 玩家是否已通过该关隘（用 flags 记录 `gate_<index>`）。 */
export function hasPassedGate(state: State, seat: number, gateIndex: number): boolean {
  return state.players[seat]?.flags[`gate_${gateIndex}`] === true;
}

/**
 * 付费通道（§3.5）。
 * 支付 `tile.gate.fee` 灵枢即通过；灵枢不足则失败（状态不变）。
 */
export function payGate(state: State, actor: number, tile: Tile): GateResult {
  const fee = tile.gate?.fee;
  if (fee === undefined) { return fail(state, false, '此格不是关隘'); }
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  if (p.resource < fee) {
    return fail(state, false, `灵枢不足：关隘标价 ${fee}，现有 ${p.resource}`);
  }
  const players = state.players.map((x) =>
    x.seat === actor
      ? { ...x, resource: x.resource - fee, flags: { ...x.flags, [`gate_${tile.index}`]: true } }
      : x,
  );
  const next: State = { ...state, players };
  return { ok: true, state: next, passed: true, note: `支付 ${fee} 灵枢通过关隘` };
}

/**
 * 试炼通道（§3.5）。
 * 从 `decks.trial` 抽一张试炼牌；已通过同座关隘的试炼牌不再抽取。
 * 试炼牌的效果由 `effects` 表达；本次只负责抽牌与记录。
 */
export function drawTrial(state: State, actor: number, tile: Tile): GateResult {
  const trialIds = tile.gate?.trialIds;
  if (trialIds === undefined) { return fail(state, false, '此格不是关隘'); }
  const pool = state.decks.trial.filter((t) => trialIds.includes(t.id));
  if (pool.length === 0) { return fail(state, false, '无可用试炼牌'); }
  const idx = Math.floor(state.rng.next() * pool.length);
  const trial = pool[idx];
  if (trial === undefined) { return fail(state, false, '试炼牌抽取失败'); }
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  const players = state.players.map((x) =>
    x.seat === actor
      ? { ...x, flags: { ...x.flags, [`trial_${tile.index}`]: trial.id, [`gate_${tile.index}`]: true } }
      : x,
  );
  const next: State = { ...state, players };
  return { ok: true, state: next, passed: true, note: `试炼牌：${trial.text}` };
}
