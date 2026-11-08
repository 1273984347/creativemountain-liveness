// 关隘（规格 §3.5）
//
// 关隘是山道上的硬门槛，每座提供两条通过路径：
//   · **付费通道**：支付关隘标价（3–5 灵枢）立即通过；
//   · **试炼通道**：抽一张试炼牌执行其要求。
// 已通过同座关隘的试炼牌不再被抽取。

import type { State } from './state.ts';
import type { Tile } from '../types/theme.ts';
import { rollD20 } from './dice.ts';
import { applyEffectToState } from '../ops/registry.ts';

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

/**
 * 玩家当前是否停在**未通过**的关隘格上（⇒ 需要选择通过通道，规格 §3.5 B18 定案）。
 *
 * ⚠️ 状态**由位置与 flags 推导**，不新增 State 字段（§6.2 契约不必变更）。
 */
export function pendingGate(state: State, seat: number): Tile | null {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return null; }
  const tile = state.board.tiles.find((t) => t.index === p.position);
  if (tile === undefined || tile.kind !== 'gate') { return null; }
  if (hasPassedGate(state, seat, tile.index)) { return null; }
  return tile;
}

/**
 * 试炼通道（规格 §3.5 B18 定案 2/3）：**公开抽牌 → 掷一次 20 面指令骰 → 执行效果树**。
 *
 * ⚠️ 试炼的**判定与后果完全由主题包数据表达**（`trials[].effects` + 谓词），
 *   引擎**不硬编码任何试炼文案**——引擎只负责掷骰（供 `dice_is_at_least` 取值）与执行效果树。
 */
function trialChannel(state: State, actor: number, tile: Tile): GateResult {
  const drawn = drawTrial(state, actor, tile);
  if (!drawn.ok) { return drawn; }
  let next = drawn.state;
  const trialId = next.players[actor]?.flags[`trial_${tile.index}`];
  const trial = next.decks.trial.find((t) => t.id === trialId);
  if (trial === undefined) {
    return { ok: true, state: next, passed: true, note: '试炼牌已抽取' };
  }
  // 掷一次 20 面指令骰（供 dice_is_at_least 谓词取值；规格 §3.5 B18 定案 3）
  const face = rollD20(next.rng);
  next = { ...next, lastDice: face };
  // 执行效果树（成功/失败后果由主题包数据决定）
  for (const eff of trial.effects) {
    next = applyEffectToState({ state: next, actor }, eff);
  }
  next = {
    ...next,
    log: [...next.log, {
      round: next.round, turnIndex: next.turnIndex, actor, kind: 'trial',
      message: `关隘试炼：${trial.text}`, diceRoll: face,
    }],
  };
  return { ok: true, state: next, passed: true, note: `试炼牌：${trial.text}` };
}

/**
 * 关隘通道选择（规格 §3.5 B18 定案）：
 *   · `pay`   —— 付费通道：付该格标价（3–5 灵枢）立即通过；灵枢不足 ⇒ 引擎拒绝。
 *   · `trial` —— 试炼通道：公开抽一张试炼牌并执行其效果树 ⇒ 通过。
 *
 * ⚠️ 两条通道都是「通过」——失败后果由试炼牌的效果树表达（主题包数据）。
 */
export function resolveGate(state: State, actor: number, channel: 'pay' | 'trial'): GateResult {
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  const tile = pendingGate(state, actor);
  if (tile === null) { return fail(state, false, '当前不在未通过的关隘格上'); }
  if (channel === 'pay') { return payGate(state, actor, tile); }
  return trialChannel(state, actor, tile);
}

/**
 * **自动解算关隘**（供 AI / 脚本等自行驱动对局的调用方使用）。
 *
 * ⚠️ 为什么必须提供这个出口：**关隘会阻塞回合推进**（与对峙同款）——
 *   任何自己驱动对局的调用方（模拟器、测试、教学脚本）不处理它就会**静默卡死**
 *   （B13 对峙的同款教训：会阻塞流程的机制，必须在引擎层给所有调用方一个统一出口）。
 *
 * 策略：**灵枢够就付费，否则走试炼**（与玩家策略同款）。
 */
export function autoResolveGate(state: State, seat: number): State {
  const tile = pendingGate(state, seat);
  if (tile === null) { return state; }
  const p = state.players[seat];
  const fee = tile.gate?.fee ?? 0;
  const channel = p !== undefined && p.resource >= fee ? 'pay' : 'trial';
  const r = resolveGate(state, seat, channel);
  return r.ok ? r.state : state;
}
