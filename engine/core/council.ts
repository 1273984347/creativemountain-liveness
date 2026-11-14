// 山议（规格 §5.6）
//
// 每 N **round** 召开一次（标准 / 新手两档间隔见 §8）。
// 全员匿名投票，得票最高者被放逐。
// **3 人局特判**：放逐下限恒为 3，3 人局放逐会触犯下限 → 改为**山议裁定**（扣灵枢不淘汰）。

import type { State } from './state.ts';
import { councilInterval, type RuleMode } from '../scales.ts';
// ⚠️ B75：计数的「怎么加」只有 `counters.ts` 一个出处；即时目标结算只有 `goals/settle.ts` 一个出处。
import { bumpCounterOf } from './counters.ts';
import { settleImmediateGoals } from '../goals/settle.ts';

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
 * 仲裁者否决（B75，规格 §9.3 + 设计 §4.2）。每局 1 次。
 *
 * ⚠️ **硬前置：所有存活玩家都已投票**。否决的语义是「否决**本次**放逐」⇒
 *   必须先看到本次投票结果；这也顺带消除了「投票未结束但结果已定」的中间态。
 * ⚠️ 判据用 `every` 而不是「票数 ≥ 存活数」：出局者的旧票会残留在 `votes` 里，
 *   后者会在还有人没投的时候提前放行。
 * ⚠️ 本函数**只记录使用**，不写 `vetoCount` —— 「用没用」和「有没有阻止住放逐」是两回事，
 *   后者要到 `resolveCouncil` 才算得出来（见设计 §4.3）。
 */
export function useCouncilVeto(state: State, actor: number): CouncilResult {
  const c = state.council;
  if (c.resolved) { return fail(state, '山议未在进行中'); }
  const p = state.players[actor];
  if (p === undefined || !p.alive) { return fail(state, '你已出局'); }
  if (p.flags.canVeto !== true) { return fail(state, '你没有否决特权'); }
  if (c.vetoUsed) { return fail(state, '本局否决已使用'); }
  const allVoted = state.players.filter((x) => x.alive).every((x) => c.votes[x.seat] !== undefined);
  if (!allVoted) { return fail(state, '等待所有玩家投票后才能使用否决'); }
  // ⚠️ B75.1（R7 裁定 · 方案 3）：否决**只可救他人，不可自救**。
  //   本条把「自己被顶上最高票 ⇒ 每局一次的放逐免疫」这条最强的自保线抽掉 ⇒
  //   仲裁者的胜率从 24–28% 回落，同时保留「救他人」的战术价值（放逐谁仍然改变席位分布）。
  //   ⚠️ 判据用 `topVoted`（含**并列**最高票的全部座位）⇒ 并列时也不许自救。
  if (topVoted(state).includes(actor)) { return fail(state, '你不能为自己使用否决（只可救他人）'); }
  return succeed({ ...state, council: { ...c, vetoUsed: true, vetoBy: actor } }, '仲裁者否决（每局 1 次）');
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
  // ⚠️ B10 收尾④ 修正：放逐下限必须**累计**判断，不能逐个判断。
  //   原实现对每个被提名的座位**独立**判断 `alive.length - 1 < floor`
  //   ⇒ 一次山议可放逐多人，把存活人数打到下限以下：
  //   4 人局若全员并列最高票 ⇒ 4 人**同时**被放逐 ⇒ 存活归零
  //   ⇒ `currentPlayer` 返回 -1 ⇒ 对局**无结局**（实测 24000 局出现 1 例「未分出胜负」）。
  //   规格 §5.8：任何时候场上存活玩家不得少于 3 人 ⇒ 下限须按**累计**口径守住。
  const exiled: number[] = [];
  let remaining = alive.length;
  for (const seat of tops) {
    const p = state.players[seat];
    if (p === undefined) { continue; }
    // 再放逐一人就会击穿下限 → 停止放逐（后续提名同样不放逐）
    if (remaining - 1 < floor) { break; }
    // 凭证免疫（公开信息，使用后全场可见）
    if (p.flags.exemptFromVote === true) { continue; }
    exiled.push(seat);
    remaining -= 1;
  }
  // ⚠️ B75：否决在**名单已算出、尚未落地**时应用（设计 §4.3 的实现顺序：
  //   算 tops/exiled → 应用否决 → 写计数与即时目标 → 更新 players）。
  //   只有「本来会有人被放逐」才算**成功否决** ⇒ 才写 `vetoCount`；
  //   下限/凭证本来就没人被放逐时，否决属于**白用** ⇒ 只说明、不计数。
  const vetoBy = next.council.vetoBy ?? null;
  const vetoed = exiled.length > 0 && next.council.vetoUsed === true && vetoBy !== null;
  if (vetoed) { exiled.length = 0; }
  if (exiled.length === 0) {
    if (vetoed && vetoBy !== null) {
      // 计数写在结算即时目标**之前** ⇒ `veto_success` 这一局就能看到自己的计数器；
      // `settleImmediateGoals` 是**全局**的（检查所有玩家的 immediate 目标，不只否决者）。
      return succeed(settleImmediateGoals(bumpCounterOf(next, vetoBy, 'vetoCount', 1)),
        '山议裁定：仲裁者否决，本次无人被放逐');
    }
    if (next.council.vetoUsed === true && vetoBy !== null) {
      return succeed(next, '山议：无人被放逐（下限保护 / 凭证；本局否决已使用但未阻止放逐）');
    }
    return succeed(next, '山议：无人被放逐（下限保护 / 凭证）');
  }
  // ⚠️ B60：被放逐者**身上的印记作废**（规格 §5.6：「被放逐者失去认证印资格，其身上的印记作废」）。
  //   为什么由**放逐侧**负责、而不是靠「判定时跳过出局者」：山议在本回合末只被**开启**
  //   （`openCouncil` ⇒ `council.resolved = false`），真正的放逐发生在**山议被结算时**
  //   ——即本函数返回**之后** ⇒ 回合末的目标判定执行时，玩家**尚未**被放逐
  //   ⇒ 他会先拿到印记 ⇒ 只有放逐侧能把这枚印记收掉。
  //   效果上等价（印记只减半签印门槛，而放逐者已退出 `certification.pending` ⇒ 永不可能认证），
  //   但不收掉的话 UI 会给已出局者显示「印记」徽章，且「目标达成」统计会被虚高。
  const players = next.players.map((p) => (exiled.includes(p.seat)
    ? { ...p, alive: false, hasMark: false, exhaustedRounds: 0 }   // ⚠️ B76 最终审查 I2：身上的力竭状态随放逐作废（与 hasMark 同款 §5.6 语义）
    : p));
  next = { ...next, players };
  // 被放逐者若处于待认证 → 认证终止（§5.6）
  const pending = next.certification.pending.filter((seat) => !exiled.includes(seat));
  next = { ...next, certification: { ...next.certification, pending } };
  return succeed(next, `山议：座位 ${exiled.join(', ')} 被放逐`);
}
