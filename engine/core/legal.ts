// 合法动作枚举（规格 §7）。
//
// 三段式：**候选粗筛 → rng 隔离试跑 → 判定收集**。
// ⚠️ 为什么不手写合法性镜像：镜像会漂。B13 之前对峙算子无人调用、旧实现把
//   CERTIFY_APPEAL 的 target 写成「别人」（引擎要求 target === actor ⇒ 必被拒）、
//   还枚举过一个**零调用方**的「出题合规裁定」动作（Task 1 已从 Action 契约移除；
//   `action-contract.test.ts` 用本文件源码文本钉住它不再回来）——三例都是镜像漂移的实证。
//   现在由引擎自己背书：枚举出来的动作一定被执行入口接受（`一致性-正向` 常驻用例钉住）。
// ⚠️ 费用不作为门槛：规格 §3.1 未写支付、引擎不扣不校验（G-a 未裁定）。
//
// 覆盖的五个决策面（+ 认证子面）：
//   行棋 MOVE / 问天 ROLL_WHEEL / 出牌 PLAY_CARD(×目标) /
//   身份被动 ABILITY(×目标) / 山议投票 VOTE /
//   认证 CERTIFY_SIGN·CHALLENGE·ABSTAIN·APPEAL·ANSWER·APPEAL_VOTE。
// ⚠️ `PASS` 与 `COMPARE` **不枚举**：前者 UI 无「结束手番」入口（枚举出来等于给模型
//   一个玩家实际操作不了的选项），后者入口待 B14——尽管 `probeAction` 对两者都能给答案。

import type { Action } from './action.ts';
import type { State } from './state.ts';
import { probeAction } from './probe.ts';
import { cardNeedsTarget, targetCandidates } from './targeting.ts';
import { abilityAvailability, activeAbilityId } from './passives.ts';
import { hasUsedCertificationTurn } from './certification.ts';
import { isRoundEnd } from './round.ts';

/** 行动阶段候选上限（官方 serve `MAX_CHOICE_OPTIONS=100`，留余量）。 */
export const LEGAL_ACTION_CAP = 64;

/**
 * 行动窗口：存活 ∧ 非待认证锁定 ∧ 无未决对峙 ∧ 阶段为行动 ∧ 本 round 尚未走完。
 *
 * ⚠️ 这里**不判**「是不是该座位的手番」：`performAction` 从不看 actor 是否为当前手番
 *   （与 `advanceTurn` 不看 PASS 的 actor 同源，G-c 族），探针据此；
 *   手番归属是 UI/流程层的门禁（Task 7），写进这里会让枚举领先引擎 ⇒ 正是本文件要避免的镜像漂移。
 * ⚠️ 同样**不判** `duel.pickA/pickB`：`DuelState` 那两个字段是可选的，
 *   「未决」即整体阻塞（`advanceTurn` 开头 `state.duel !== null` 那条早退）。
 */
export function actionWindowOpen(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if (p.pendingCert) { return false; }        // §5.1 待认证锁定：整个行动阶段无动作
  if (state.duel !== null) { return false; }  // B13 对峙阻塞
  if (state.phase !== '行动') { return false; }
  return !isRoundEnd(state);                  // 已行动手番数 < 存活人数 ⇒ 本轮还在进行中
}

/** 行动阶段三面：行棋 / 问天 / 出牌(×目标) / 身份被动(×目标)。 */
function actionPhaseCandidates(state: State, seat: number): Action[] {
  const p = state.players[seat];
  if (p === undefined || !actionWindowOpen(state, seat)) { return []; }
  const out: Action[] = [
    { type: 'MOVE', actor: seat, steps: 0 },   // 步数由骰子定，玩家不可选
    { type: 'ROLL_WHEEL', actor: seat },
  ];
  for (const card of p.hand) {
    if (cardNeedsTarget(card)) {
      // 需目标的牌**只**按候选目标展开（不给无目标版本：引擎在 `act` 分支原样返回）。
      for (const target of targetCandidates(state, seat)) {
        out.push({ type: 'PLAY_CARD', actor: seat, cardId: card.id, target });
      }
    } else {
      out.push({ type: 'PLAY_CARD', actor: seat, cardId: card.id });
    }
  }
  const avail = abilityAvailability(state, seat);
  if (avail.usable) {
    const abilityId = activeAbilityId(state, seat);
    if (avail.needsTarget) {
      for (const target of targetCandidates(state, seat)) { out.push({ type: 'ABILITY', actor: seat, abilityId, target }); }
    } else {
      out.push({ type: 'ABILITY', actor: seat, abilityId });
    }
  }
  return out;
}

/** 山议投票（§5.6）：未结算 ∧ 本人未投过 ∧ 存活 ⇒ 除自己外的每个存活玩家一票。 */
function councilCandidates(state: State, seat: number): Action[] {
  if (state.council.resolved === true || state.council.votes[seat] !== undefined) { return []; }
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  return state.players
    .filter((p) => p.alive && p.seat !== seat)
    .map((p): Action => ({ type: 'VOTE', actor: seat, target: p.seat }));
}

/**
 * 认证候选（§5.3）。三处按引擎真实前置纠正：
 *   · `CERTIFY_APPEAL` 由待认证者本人申请（`target === actor`，且需 2 灵枢）；
 *     旧实现把它发给「判定不通过的那个人」⇒ 每个复议候选必被引擎拒；
 *   · `CERTIFY_ANSWER` 只给**已质疑且尚未判定**者（`judgments` 以判定人为键，
 *     `certifyAnswer` 无重复判定守卫 ⇒ 去重必须由粗筛承担）；
 *   · 复议票 `CERTIFY_APPEAL_VOTE` 只发给非当事人（认证人与待认证者都被引擎拒）。
 * 签印/质疑/弃权共用引擎自己的 `hasUsedCertificationTurn` 判据（本轮机会三选一），
 * 不在这里重写那份集合判断。
 * ⚠️ 双人互验（§5.5）的 `certifyMutualSign` **没有对应的 Action 成员** ⇒ 无法枚举，
 *   待 Action 契约裁定（本文件不擅自新增动作类型）。
 */
function certificationCandidates(state: State, seat: number): Action[] {
  const c = state.certification;
  if (c.pending.length === 0) { return []; }
  const out: Action[] = [];
  if (c.pending.includes(seat)) {
    // 待认证者：本轮唯一入口是复议（本人申请，且 `target === actor`）。
    if (!c.appealed.includes(seat)) { out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat }); }
    return out;
  }
  const used = hasUsedCertificationTurn(state, seat);
  const judged = c.judgments[seat] !== undefined;
  for (const target of c.pending) {
    if (!used) {
      out.push({ type: 'CERTIFY_SIGN', actor: seat, target });
      out.push({ type: 'CERTIFY_CHALLENGE', actor: seat, target });
      out.push({ type: 'CERTIFY_ABSTAIN', actor: seat, target });
    }
    if (c.challenged.includes(seat) && !judged) {
      out.push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: true });
      out.push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: false });
    }
  }
  if (c.appealVotes[seat] === undefined) {
    for (const target of c.appealed) {
      out.push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: true });
      out.push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: false });
    }
  }
  return out;
}

/** 候选总集（粗筛，不含合法性判断）——`getLegalActions` 与 `getLegalActionStats` 共用。 */
export function candidatesOf(state: State, playerId: number): Action[] {
  if (state.players[playerId]?.alive !== true) { return []; }
  return [
    ...actionPhaseCandidates(state, playerId),
    ...councilCandidates(state, playerId),
    ...certificationCandidates(state, playerId),
  ];
}

/** 该玩家的合法动作（试跑背书，受 `LEGAL_ACTION_CAP` 截断）。 */
export function getLegalActions(state: State, playerId: number): Action[] {
  const out: Action[] = [];
  for (const a of candidatesOf(state, playerId)) {
    if (out.length >= LEGAL_ACTION_CAP) { break; }
    if (probeAction(state, a).ok) { out.push(a); }
  }
  return out;
}
