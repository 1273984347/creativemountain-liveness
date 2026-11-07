// 活人认证（规格 §5）——全项目最复杂的规则块
//
// §5.1 进入条件 · §5.2 门槛公式 · §5.3 签印/质疑/复议/合规 · §5.4 题目来源 · §5.5 双人互验

import type { State } from './state.ts';
import type { CertificationState } from './flow.ts';

/** 空认证状态。 */
export function emptyCertification(): CertificationState {
  return {
    // 0 = 第 1 轮尚未开始（待认证者刚登顶）；1 = 第 1 轮进行中；2 = 第 2 轮
    round: 0, pending: [], signed: [], challenged: [], abstained: [],
    signatures: {}, judgments: {}, appealed: [], appealVotes: {},
    validityVotes: {}, validityDecided: false,
  };
}

/**
 * 实际门槛（§5.2）——**计算顺序不可颠倒**：
 *
 * 0. 前置分支：场上**同时存在 2 名待认证者** → `base = 1`，**跳过后续所有步骤**
 *    （不走 min、不走印记减半；有印记的双人互验仍是 1）。
 * 1. `base = min(N, 存活人数 - 1)`——签印人只能来自其他存活玩家。
 * 2. 持【印记】→ `base = ceil(base / 2)`（向上取整）。
 * 3. 叠加 `extra_signatures_required`（临时加成，不改本公式）。
 * 4. `base` 最低为 1（不允许 0 门槛，否则登顶即通关）。
 */
export function certificationThreshold(state: State, seat: number): number {
  const pendingCount = state.certification.pending.length;
  if (pendingCount >= 2) {
    return 1;
  }
  const alive = state.players.filter((p) => p.alive).length;
  let base = Math.min(state.scales.threshold, alive - 1);
  const player = state.players[seat];
  if (player !== undefined && player.hasMark) {
    base = Math.ceil(base / 2);
  }
  base += state.extraSignaturesRequired;
  return Math.max(1, base);
}

/** 待认证者已获得的签印数。 */
export function signatureCount(state: State, seat: number): number {
  return state.certification.signatures[seat] ?? 0;
}

/** 该玩家是否已用掉本轮的认证机会（签印 / 质疑 / 弃权 三选一）。 */
export function hasUsedCertificationTurn(state: State, seat: number): boolean {
  const c = state.certification;
  return c.signed.includes(seat) || c.challenged.includes(seat) || c.abstained.includes(seat);
}

/** 某玩家是否是本轮的合法认证人（存活、非待认证者）。 */
export function isCertifier(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  return !state.certification.pending.includes(seat);
}
/** 认证动作的统一返回。 */
export interface CertifyResult {
  readonly ok: boolean;
  readonly state: State;
  readonly note?: string;
}

function fail(state: State, note: string): CertifyResult {
  return { ok: false, state, note };
}

function succeed(state: State, note?: string): CertifyResult {
  return note === undefined ? { ok: true, state } : { ok: true, state, note };
}

/** 写入签印数。 */
function addSignature(state: State, seat: number, delta: number): State {
  const c = state.certification;
  const signatures: Readonly<Record<number, number>> = { ...c.signatures, [seat]: (c.signatures[seat] ?? 0) + delta };
  return { ...state, certification: { ...c, signatures } };
}

/**
 * 签印（§5.3.1）。
 * 认证人放弃自己的认证权，直接贡献 1 枚签印。
 */
export function certifySign(state: State, actor: number, target: number): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(target)) { return fail(state, `座位 ${target} 不在待认证状态`); }
  if (!isCertifier(state, actor)) { return fail(state, `座位 ${actor} 不是认证人`); }
  if (hasUsedCertificationTurn(state, actor)) { return fail(state, '本轮已用过认证机会'); }
  let next: State = { ...state, certification: { ...c, signed: [...c.signed, actor] } };
  next = addSignature(next, target, 1);
  next = { ...next, players: next.players.map((p) => (p.seat === target ? { ...p, flags: { ...p.flags, signedThisRound: true } } : p)) };
  return succeed(next, '签印');
}

/**
 * 弃权（§5.3.1）。
 * 保留认证印到下轮（本轮不使用机会）。
 */
export function certifyAbstain(state: State, actor: number, target: number): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(target)) { return fail(state, `座位 ${target} 不在待认证状态`); }
  if (!isCertifier(state, actor)) { return fail(state, `座位 ${actor} 不是认证人`); }
  if (hasUsedCertificationTurn(state, actor)) { return fail(state, '本轮已用过认证机会'); }
  const next: State = { ...state, certification: { ...c, abstained: [...c.abstained, actor] } };
  return succeed(next, '弃权');
}

/**
 * 发起质疑（§5.3.1）。
 * **发起即扣 1 灵枢**（无论成败，§5.3.4 成本对称）。灵枢不足则不可发起。
 */
export function certifyChallenge(state: State, actor: number, target: number): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(target)) { return fail(state, `座位 ${target} 不在待认证状态`); }
  if (!isCertifier(state, actor)) { return fail(state, `座位 ${actor} 不是认证人`); }
  if (hasUsedCertificationTurn(state, actor)) { return fail(state, '本轮已用过认证机会'); }
  const challenger = state.players[actor];
  if (challenger === undefined || challenger.resource < 1) {
    return fail(state, '灵枢不足，无法发起质疑（需 1 灵枢）');
  }
  const players = state.players.map((p) => (p.seat === actor ? { ...p, resource: p.resource - 1 } : p));
  const next: State = { ...state, players, certification: { ...c, challenged: [...c.challenged, actor] } };
  return succeed(next, '质疑已发起（-1 灵枢）');
}
/**
 * 认证人给出判定（§5.3.2）。
 *
 * `passed = true`  → 答对 >= 2 → 该认证人**视为签印**。
 * `passed = false` → 答对 <= 1 → 该认证人不签印，且**待认证者后退 1 格**。
 *                   若待认证者因此离开峰顶 → 认证即时终止（§5.1）。
 */
export function certifyAnswer(state: State, actor: number, target: number, passed: boolean): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(target)) { return fail(state, `座位 ${target} 不在待认证状态`); }
  if (!c.challenged.includes(actor)) { return fail(state, `座位 ${actor} 本轮未发起质疑`); }
  if (actor === target) { return fail(state, '不能判定自己'); }
  const judgments: Readonly<Record<number, boolean>> = { ...c.judgments, [actor]: passed };
  let next: State = { ...state, certification: { ...c, judgments } };
  if (passed) {
    // 视为签印（§5.3.1）
    next = addSignature(next, target, 1);
    return succeed(next, '判定通过，视为签印');
  }
  // 判不通过 → **先记录判定，给出复议窗口**（§5.3.2）。
  // 后退 1 格是**复议流程结束后**才执行的后果（见 applyFailJudgment）——
  // 否则待认证者会被立即推下山，根本来不及申请复议。
  return succeed(next, '判不通过，待认证者可申请复议');
}

/**
 * 执行「判不通过」的后果：待认证者后退 1 格；离开峰顶 → 认证终止（§5.1）。
 *
 * 这是**复议流程结束后**才调用的——判不通过本身不立即后退。
 */
export function applyFailJudgment(state: State, target: number): State {
  const tp = state.players[target];
  if (tp === undefined) { return state; }
  const newPos = Math.max(1, tp.position - 1);
  const leftPeak = newPos !== state.board.peakIndex;
  const players = state.players.map((p) =>
    p.seat === target
      ? { ...p, position: newPos, ...(leftPeak ? { pendingCert: false } : {}) }
      : p,
  );
  let next: State = { ...state, players };
  if (leftPeak) {
    next = { ...next, certification: { ...next.certification, pending: next.certification.pending.filter((s) => s !== target) } };
  }
  return next;
}

/**
 * 申请复议（§5.3.2）。
 *
 * 待认证者消耗 **2 灵枢** 申请复议；由**除认证人与待认证者外的存活玩家**投票裁定。
 * 复议票 **>= 半数** 支持撤销 → 该题改判为通过；否则维持原判，且**待认证者额外扣 1 灵枢**。
 * 平票 → 视为复议成功（保护被质疑方）。
 * 独立第三方不足 2 人时（在场 3 人）→ 掷 6 面骰，**4–6 算复议成功**。
 * 每待认证者每轮限 1 次。
 */
export function certifyAppeal(state: State, actor: number, target: number): CertifyResult {
  const c = state.certification;
  // 语义统一：所有认证 Action 的 target 均表示「待认证者」；
  // 复议由待认证者自己申请（actor === target），每待认证者每轮限 1 次。
  if (!c.pending.includes(actor)) { return fail(state, '只有待认证者可申请复议'); }
  if (target !== actor) { return fail(state, '复议的目标必须是待认证者自己'); }
  if (c.appealed.includes(actor)) { return fail(state, '本轮已申请过复议'); }
  const p = state.players[actor];
  if (p === undefined || p.resource < 2) {
    return fail(state, '灵枢不足，无法申请复议（需 2 灵枢）');
  }
  const players = state.players.map((x) => (x.seat === actor ? { ...x, resource: x.resource - 2 } : x));
  const next: State = { ...state, players, certification: { ...c, appealed: [...c.appealed, actor] } };
  return succeed(next, '已申请复议（-2 灵枢）');
}

/**
 * 复议投票（§5.3.2）。
 *
 * `overturn = true` 表示投票**推翻**原判（该题改判为通过）。
 * 投票人必须是除认证人与待认证者外的存活玩家；**投票不消耗认证印**。
 */
export function certifyAppealVote(state: State, actor: number, target: number, overturn: boolean): CertifyResult {
  const c = state.certification;
  if (!c.appealed.includes(target)) { return fail(state, `座位 ${target} 未申请复议`); }
  const challenger = Object.keys(c.judgments).find((k) => c.judgments[Number(k)] === false && Number(k) !== actor);
  if (challenger === undefined) { return fail(state, '没有待复议的判定'); }
  const challengerSeat = Number(challenger);
  if (actor === challengerSeat) { return fail(state, '认证人不得参与复议投票'); }
  if (actor === target) { return fail(state, '待认证者不得参与复议投票'); }
  const voter = state.players[actor];
  if (voter === undefined || !voter.alive) { return fail(state, '投票人已出局'); }
  if (c.appealVotes[actor] !== undefined) { return fail(state, '本轮已投过复议票'); }
  const appealVotes: Readonly<Record<number, boolean>> = { ...c.appealVotes, [actor]: overturn };
  const next: State = { ...state, certification: { ...c, appealVotes } };
  return succeed(next, overturn ? '投：推翻原判' : '投：维持原判');
}
/**
 * 复议裁定（§5.3.2）。
 *
 * 在复议票收齐（或独立第三方不足 2 人时掷骰）后调用。
 * 复议**成功** → 该题改判为通过（视为签印）；
 * 复议**失败** → 维持原判（不通过），且**待认证者额外扣 1 灵枢**。
 */
export function resolveAppeals(state: State, target: number): CertifyResult {
  const c = state.certification;
  if (!c.appealed.includes(target)) { return fail(state, '无待裁定的复议'); }
  const challengers = Object.keys(c.judgments)
    .map((k) => Number(k))
    .filter((seat) => c.judgments[seat] === false);
  if (challengers.length === 0) { return fail(state, '没有判不通过的题可复议'); }
  const challengerSeat = challengers[0];
  if (challengerSeat === undefined) { return fail(state, '复议对象缺失'); }
  // 独立第三方 = 存活玩家 - 认证人 - 待认证者
  const thirdParties = state.players
    .filter((p) => p.alive && p.seat !== challengerSeat && p.seat !== target)
    .map((p) => p.seat);
  const votes = Object.entries(c.appealVotes)
    .filter(([k]) => thirdParties.includes(Number(k)))
    .map(([, v]) => v);
  let success: boolean;
  if (thirdParties.length < 2) {
    // 独立第三方不足 2 人 → 掷 6 面骰，4–6 算成功（给被质疑方 50% 反制）
    const roll = Math.floor(state.rng.next() * 6) + 1;
    success = roll >= 4;
    const next: State = { ...state, lastDice: roll };
    return applyAppealOutcome(next, target, challengerSeat, success, '掷骰裁定');
  }
  // 多数决：推翻票 >= 半数 → 成功；平票 → 视为成功（保护被质疑方）
  const overturns = votes.filter((v) => v === true).length;
  const half = thirdParties.length / 2;
  success = overturns >= half;
  return applyAppealOutcome(state, target, challengerSeat, success, `复议投票 ${overturns}/${thirdParties.length}`);
}

/** 应用复议结果。 */
function applyAppealOutcome(state: State, target: number, challengerSeat: number, success: boolean, label: string): CertifyResult {
  const c = state.certification;
  if (success) {
    // 改判为通过 → 该认证人视为签印
    const judgments: Readonly<Record<number, boolean>> = { ...c.judgments, [challengerSeat]: true };
    let next: State = { ...state, certification: { ...c, judgments } };
    next = addSignature(next, target, 1);
    return succeed(next, `${label}：复议成功，改判为通过`);
  }
  // 失败 → 维持原判，待认证者额外扣 1 灵枢，并执行后退
  const players = state.players.map((p) => (p.seat === target ? { ...p, resource: Math.max(0, p.resource - 1) } : p));
  let next: State = { ...state, players };
  next = applyFailJudgment(next, target);
  return succeed(next, `${label}：复议失败，维持原判，待认证者 -1 灵枢并后退 1 格`);
}

/**
 * 出题合规裁定投票（§5.3.3）。
 *
 * `valid = true` 表示题目**可验证**（待认证者必须回答）；
 * `valid = false` 表示题目**不可验证**（须换题，且本轮不得再出同类题）。
 * 投票人：全场非当事人。
 */
export function certifyValidateQuestion(state: State, actor: number, target: number, valid: boolean): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(target)) { return fail(state, `座位 ${target} 不在待认证状态`); }
  if (actor === target) { return fail(state, '待认证者不得参与合规裁定'); }
  const voter = state.players[actor];
  if (voter === undefined || !voter.alive) { return fail(state, '投票人已出局'); }
  if (c.validityVotes[actor] !== undefined) { return fail(state, '本轮已投过合规票'); }
  const validityVotes: Readonly<Record<number, boolean>> = { ...c.validityVotes, [actor]: valid };
  const next: State = { ...state, certification: { ...c, validityVotes } };
  return succeed(next, valid ? '投：题目可验证' : '投：题目不可验证');
}
/**
 * 推进一轮认证（§5.2）。
 *
 * - 有待认证者达到门槛 → **封顶**（返回 `certified`）。
 * - 无人达到门槛且本轮是第 2 轮 → 待认证者**退回山道 60% 位置**，本次登顶作废。
 * - 否则进入下一轮（清空本轮记录）。
 */
export function advanceCertificationRound(state: State): CertifyResult {
  const c = state.certification;
  if (c.pending.length === 0) {
    return fail(state, '当前无待认证者');
  }
  // ⚠️ B9 修正：`certification.round === 0` 表示「第 1 轮**尚未开始**」。
  //   待认证者是在某个**手番末**登顶的，若在**同一 round 末**就判定第 1 轮，
  //   认证人还没来得及签印 ⇒ 第 1 轮必然空转 ⇒ 登顶几乎必然失败
  //   （实测：兜底触发率 96%，认证达成仅 4%）。
  //   正确时序：登顶当轮只「开启」第 1 轮，接下来**整轮**供认证人签印。
  if (c.round === 0) {
    const opened: State = {
      ...state,
      certification: { ...emptyCertification(), round: 1, pending: [...c.pending] },
    };
    return succeed(opened, '开始第 1 轮认证');
  }
  // 轮末：对「判不通过且未申请复议」的认证人执行后退后果（§5.3.2）
  // ——判不通过本身不立即后退；复议窗口关闭后才执行。
  let settled = state;
  for (const [challengerStr, passed] of Object.entries(c.judgments)) {
    if (passed !== false) { continue; }
    const challenger = Number(challengerStr);
    for (const seat of c.pending) {
      // 该待认证者已就这个质疑申请过复议 → 由 resolveAppeals 处理，不在此执行
      if (c.appealed.includes(seat)) { continue; }
      settled = applyFailJudgment(settled, seat);
    }
    void challenger;
  }
  state = settled;
  const certified = c.pending.filter((seat) => signatureCount(state, seat) >= certificationThreshold(state, seat));
  if (certified.length > 0) {
    const next: State = {
      ...state,
      outcome: { finished: true, winners: certified, reason: 'certified' },
    };
    return succeed(next, `封顶：座位 ${certified.join(', ')}`);
  }
  // 未达成
  const pendingNow = state.certification.pending;
  if (c.round >= 2) {
    // 第 2 轮结束仍未达成 → 退回山道 60% 位置
    const players = state.players.map((p) => {
      if (!pendingNow.includes(p.seat)) { return p; }
      const back = Math.max(1, Math.round(state.board.length * 0.6));
      return { ...p, position: back, pendingCert: false };
    });
    const next: State = {
      ...state,
      players,
      certification: { ...emptyCertification(), pending: [] },
    };
    return succeed(next, '两轮未达成，待认证者退回山道 60% 位置');
  }
  // 进入下一轮
  const next: State = {
    ...state,
    certification: { ...emptyCertification(), round: 2, pending: c.pending },
  };
  return succeed(next, '进入第 2 轮认证');
}

/**
 * 玩家登顶峰顶 → 进入待认证状态（§5.1）。
 *
 * 双人互验（§5.5）：若已有另一名待认证者，则**双方互签互验**，各自门槛为 1。
 */
export function enterPendingCertification(state: State, seat: number): CertifyResult {
  const c = state.certification;
  if (c.pending.includes(seat)) {
    return fail(state, `座位 ${seat} 已在待认证状态`);
  }
  const pending = [...c.pending, seat];
  const players = state.players.map((p) => (p.seat === seat ? { ...p, pendingCert: true } : p));
  const next: State = { ...state, players, certification: { ...c, pending } };
  return succeed(next, pending.length >= 2 ? '双人互验：双方进入待认证' : '进入待认证状态');
}

/**
 * 双人互验的互签（§5.5）：A 签 B 与 B 签 A 互为对方贡献 1 枚签印。
 * 门槛已降为 1，因此互签即可各自达标。
 */
export function certifyMutualSign(state: State, actor: number, target: number): CertifyResult {
  const c = state.certification;
  if (!c.pending.includes(actor) || !c.pending.includes(target)) {
    return fail(state, '互签要求双方都在待认证状态');
  }
  if (actor === target) { return fail(state, '不能与自己互签'); }
  const next = addSignature(state, target, 1);
  return succeed(next, `互签：座位 ${actor} 为座位 ${target} 签印`);
}
