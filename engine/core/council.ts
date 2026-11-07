// 山议（规格 §5.6）
//
// 每 N **round** 召开一次（标准 / 新手两档间隔见 §8）。
// 全员匿名投票，得票最高者被放逐。
// **3 人局特判**：放逐下限恒为 3，3 人局放逐会触犯下限 → 改为**山议裁定**（扣灵枢不淘汰）。

import type { State } from './state.ts';
import { councilInterval, type RuleMode } from '../scales.ts';

/** 山议操作结果。 */
export interface CouncilResult {
  readonly ok: boolean;
  readonly state: State;
  readonly note?: string;
}

function fail(state: State, note: string): CouncilResult {
  return { ok: false, state, note };
}

function succeed(state: State, note?: string): CouncilResult {
  return note === undefined ? { ok: true, state } : { ok: true, state, note };
}

/** 本回合是否该召开山议（按 round 计数，标准 / 新手两档间隔）。 */
export function shouldHoldCouncil(state: State, mode: RuleMode): boolean {
  const c = state.council;
  if (c.resolved === false) {
    return false; // 山议进行中
  }
  const interval = councilInterval(state.scales, mode);
  const elapsed = state.round - c.lastRound;
  return elapsed >= interval;
}

/** 开启一次山议。 */
export function openCouncil(state: State): CouncilResult {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length < 2) { return fail(state, '存活玩家不足，无法召开山议'); }
  const next: State = {
    ...state,
    phase: '山议',
    council: { ...state.council, votes: {}, resolved: false },
  };
  return succeed(next, '山议开始');
}

/** 投票（匿名）。仲裁者可投 2 票（§4.1 仲裁者特权）。 */
export function castVote(state: State, actor: number, target: number): CouncilResult {
  const c = state.council;
  if (c.resolved) { return fail(state, '山议未在进行中'); }
  const voter = state.players[actor];
  if (voter === undefined || !voter.alive) { return fail(state, '投票人已出局'); }
  if (actor === target) { return fail(state, '不能投自己'); }
  const voted = state.players[target];
  if (voted === undefined || !voted.alive) { return fail(state, '投票目标已出局'); }
  if (c.votes[actor] !== undefined) { return fail(state, '本轮已投过票'); }
  const votes: Readonly<Record<number, number>> = { ...c.votes, [actor]: target };
  const next: State = { ...state, council: { ...c, votes } };
  return succeed(next, `投票给座位 ${target}`);
}
/**
 * 投票权重 = 1 + 该玩家的**额外投票数**。
 *
 * ⚠️ B10 修正：原实现硬编码 `identityId === 'arbiter' ? 2 : 1` ——
 *   `extra_vote` 算子写入的 `flags.extraVotes` **从无消费点**（只写不读），
 *   于是「仲裁者 2 票」靠 id 硬编码撑着，任何**其他**拿到 extra_vote 的玩家都无效。
 *   现改为数据驱动：常驻型被动在分配身份时授予 `flags.extraVotes`（见 core/passives.ts）。
 */
export function voteWeight(state: State, voter: number): number {
  const extra = (state.players[voter]?.flags.extraVotes as number | undefined) ?? 0;
  return 1 + Math.max(0, extra);
}

/** 统计票数（含额外投票权重）。 */
function tally(state: State): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [voterStr, target] of Object.entries(state.council.votes)) {
    const voter = Number(voterStr);
    const weight = voteWeight(state, voter);
    counts.set(target, (counts.get(target) ?? 0) + weight);
  }
  return counts;
}

/** 得票最高者（并列时全部返回）。 */
export function topVoted(state: State): readonly number[] {
  const counts = tally(state);
  if (counts.size === 0) { return []; }
  let max = 0;
  for (const v of counts.values()) { if (v > max) { max = v; } }
  if (max === 0) { return []; }
  return [...counts.entries()].filter(([, v]) => v === max).map(([k]) => k).sort((a, b) => a - b);
}

/**
 * 结算山议（§5.6）。
 *
 * - **3 人局** → **山议裁定**：得票最高者**扣 2 灵枢**（不淘汰、不失认证印资格）。
 *   并列最高则各扣 1 灵枢。
 * - **4 人及以上** → 得票最高者**放逐**（出局）。
 *   · **放逐下限**：存活人数不得低于 `exileFloor`（恒为 3）——若放逐会触犯下限则不放逐，改为扣灵枢。
 *   · **凭证**：被提名者消耗 3 灵枢出示凭证可免疫本次放逐（公开信息，使用后全场可见）。
 *   · **仲裁者否决**：仲裁者可消耗特权否决本次放逐（每局 1 次）。
 */
export function resolveCouncil(state: State): CouncilResult {
  const c = state.council;
  if (c.resolved) { return fail(state, '山议未在进行中'); }
  const alive = state.players.filter((p) => p.alive);
  const tops = topVoted(state);
  const council: State['council'] = { ...c, heldCount: c.heldCount + 1, lastRound: state.round, votes: {}, resolved: true };
  let next: State = { ...state, phase: '行动', council };
  if (tops.length === 0) {
    return succeed(next, '山议无人得票，散会');
  }
  const isThreePlayer = alive.length === 3;
  if (isThreePlayer) {
    // 3 人局：山议裁定（扣灵枢，不淘汰）
    const penalty = tops.length > 1 ? 1 : 2;
    const players = next.players.map((p) =>
      tops.includes(p.seat) ? { ...p, resource: Math.max(0, p.resource - penalty) } : p,
    );
    next = { ...next, players };
    return succeed(next, `山议裁定：座位 ${tops.join(', ')} 扣 ${penalty} 灵枢（3 人局不淘汰）`);
  }
  // 4 人及以上：放逐（需检查下限 / 凭证 / 否决）
  const floor = state.scales.exileFloor;
  const exiled = tops.filter((seat) => {
    const p = state.players[seat];
    if (p === undefined) { return false; }
    // 放逐后存活人数会低于下限 → 不放逐
    if (alive.length - 1 < floor) { return false; }
    // 凭证免疫（公开信息，使用后全场可见）
    if (p.flags.exemptFromVote === true) { return false; }
    return true;
  });
  if (exiled.length === 0) {
    return succeed(next, '山议：无人被放逐（下限保护 / 凭证 / 否决）');
  }
  const players = next.players.map((p) => (exiled.includes(p.seat) ? { ...p, alive: false } : p));
  next = { ...next, players };
  // 被放逐者若处于待认证 → 认证终止（§5.6）
  const pending = next.certification.pending.filter((seat) => !exiled.includes(seat));
  next = { ...next, certification: { ...next.certification, pending } };
  return succeed(next, `山议：座位 ${exiled.join(', ')} 被放逐`);
}
