// UI 可点性的唯一来源（规格 §7 落地）。
//
// ⚠️ 本文件**不得** import `getLegalActions` / `candidatesOf`：它的价值在于**独立**表达 UI 规则，
//   再与引擎试跑结果做集合相等比对（`tests/engine/legal-probe.test.ts` 漂移守卫）。
//   两处各写一份正是设计意图——只要有一侧的判据漂移，守卫就变红；若本文件借道引擎枚举，
//   它就退化成恒等式，再也抓不到「UI 能点的模型不能选、模型能选的 UI 点不到」。
//   允许 import 的只有**低层共享判据**（targeting / passives / action-key / round），
//   与 `legal.ts` 用同一批原语但**各自组织**，这仍是两条独立实现。
//
// 三层职责（对应引擎的「候选粗筛 → 试跑 → 收集」三段式）：
//   · `uiCandidates`  = UI 自己的粗筛（与 `candidatesOf` 独立等价，供候选层守卫比对）；
//   · `uiAllows`      = 单条动作的门禁（与 `probeAction` 的接受判据独立等价）；
//   · `uiAllowedSet`  = 粗筛 ∩ 门禁（与 `getLegalActions` 独立等价，供枚举层守卫比对）。
//
// ⚠️ 费用**不**作为门槛（G-a 未裁定）——但引擎入口自己会拒的**成本前置**（质疑 1 灵枢、
//   复议 2 灵枢）不在此列：那是 `certifyChallenge` / `certifyAppeal` 的真实前置，
//   补在 `uiAllows` 里只为与 `probeAction` 对齐（引擎拒的 UI 也必须点不到，否则枚举层守卫红）。

import type { State } from '../engine/core/state.ts';
import type { Action } from '../engine/core/action.ts';
import type { CertificationState } from '../engine/core/flow.ts';
import { cardNeedsTarget, targetCandidates } from '../engine/core/targeting.ts';
import { abilityAvailability, activeAbilityId } from '../engine/core/passives.ts';
import { actionKey } from '../engine/core/action-key.ts';
import { isRoundEnd } from '../engine/core/round.ts';

/**
 * 行动窗口：存活 ∧ 非待认证锁定 ∧ 无未决对峙 ∧ 阶段为行动 ∧ 本 round 尚未走完。
 *
 * 与 `legal.ts` 的 `actionWindowOpen` **各自独立写**一份（同样不判手番归属——
 * `performAction` 从不看 actor 是否为当前手番，判了就让 UI 领先引擎 ⇒ 正是漂移）。
 * 这里用共享低层原语 `isRoundEnd` 表达「本 round 还没走完」，而不是抄 `turnIndex < 存活数`
 * （写死会与 B9 修正后的 `isRoundEnd` 口径分叉）。
 */
export function actionWindow(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if (p.pendingCert) { return false; }        // §5.1 待认证锁定：整个行动阶段无动作
  if (state.duel !== null) { return false; }  // B13 对峙未决：回合阻塞
  if (state.phase !== '行动') { return false; }
  return !isRoundEnd(state);
}

// ---- 认证判据的独立表达（不 import certification 的集合判据，也不 import legal.ts）----

/** 是否待认证者（对应引擎 `pending.includes(seat)`）。 */
function isPendingSeat(c: CertificationState, seat: number): boolean {
  return c.pending.includes(seat);
}

/** 本轮认证机会（签印 / 质疑 / 弃权）是否已用——独立重写引擎 `hasUsedCertificationTurn`。 */
function usedCertTurn(c: CertificationState, seat: number): boolean {
  return c.signed.includes(seat) || c.challenged.includes(seat) || c.abstained.includes(seat);
}

/** 合法认证人（存活 ∧ 非待认证者）——独立重写引擎 `isCertifier`。 */
function isCertifierLike(state: State, c: CertificationState, seat: number): boolean {
  const p = state.players[seat];
  return p !== undefined && p.alive && !isPendingSeat(c, seat);
}

/**
 * 复议投票的「存在待复议判定」判据——对齐引擎 `certifyAppealVote` 的 challenger 取法：
 * `Object.keys(judgments).find((k) => judgments[k] === false && k !== actor)` 命中。
 * ⇒ 语义 = **存在一条非本人所判的「判不通过」**；本人若是唯一的失败判定人则无从复议（引擎拒）。
 */
function hasJudgmentToAppeal(c: CertificationState, seat: number): boolean {
  return Object.keys(c.judgments).some((k) => c.judgments[Number(k)] === false && Number(k) !== seat);
}

/**
 * UI 是否允许提交该动作（单条门禁）。
 *
 * 判据与 `probeAction` 的引擎接受口径**逐条对齐**（枚举层守卫据此钉相等）：
 *   · MOVE / ROLL_WHEEL / PLAY_CARD / ABILITY ⇒ 行动窗口（+ 牌/能力自身前置）；
 *   · VOTE ⇒ 山议进行中 ∧ 本人未投 ∧ 双方存活 ∧ 非投自己；
 *   · 认证人三面 ⇒ 待认证目标 ∧ 合法认证人 ∧ 本轮机会未用（质疑另需 ≥1 灵枢）；
 *   · ANSWER ⇒ 本人已质疑且未判定 ∧ 目标待认证 ∧ 非判自己；
 *   · APPEAL ⇒ 本人待认证且未申请 ∧ 目标＝本人 ∧ ≥2 灵枢；
 *   · APPEAL_VOTE ⇒ 见下（发现 1：按引擎纠正，不再排除同场另一名待认证者）；
 *   · PASS / COMPARE ⇒ 无 UI 入口 / 待 B14。
 */
export function uiAllows(state: State, seat: number, action: Action): boolean {
  const c = state.certification;
  const me = state.players[seat];
  switch (action.type) {
    case 'MOVE':
    case 'ROLL_WHEEL':
      return actionWindow(state, seat);
    case 'PLAY_CARD': {
      if (!actionWindow(state, seat) || me === undefined) { return false; }
      const card = me.hand.find((x) => x.id === action.cardId);
      if (card === undefined) { return false; }
      // 需目标的牌必须带候选目标；不需目标的牌必须不带目标（引擎 `act` 分支同源）。
      return cardNeedsTarget(card)
        ? action.target !== undefined && targetCandidates(state, seat).includes(action.target)
        : action.target === undefined;
    }
    case 'ABILITY': {
      if (!actionWindow(state, seat)) { return false; }
      const avail = abilityAvailability(state, seat);
      if (!avail.usable || action.abilityId !== activeAbilityId(state, seat)) { return false; }
      return avail.needsTarget
        ? action.target !== undefined && targetCandidates(state, seat).includes(action.target)
        : action.target === undefined;
    }
    case 'VOTE': {
      return state.council.resolved === false
        && state.council.votes[seat] === undefined
        && (me?.alive ?? false)
        && action.target !== seat
        && (state.players.find((p) => p.seat === action.target)?.alive ?? false);
    }
    case 'CERTIFY_SIGN':
    case 'CERTIFY_ABSTAIN':
      return isPendingSeat(c, action.target)
        && isCertifierLike(state, c, seat)
        && !usedCertTurn(c, seat);
    case 'CERTIFY_CHALLENGE':
      return isPendingSeat(c, action.target)
        && isCertifierLike(state, c, seat)
        && !usedCertTurn(c, seat)
        && (me?.resource ?? 0) >= 1;   // 质疑扣 1 灵枢（§5.3.4；引擎不足则拒 ⇒ 这里也得拒）
    case 'CERTIFY_APPEAL':
      return action.target === seat
        && isPendingSeat(c, seat)
        && !c.appealed.includes(seat)
        && (me?.resource ?? 0) >= 2;   // 复议需 2 灵枢（certifyAppeal 真实前置）
    case 'CERTIFY_ANSWER':
      return c.challenged.includes(seat)
        && c.judgments[seat] === undefined
        && isPendingSeat(c, action.target)
        && action.target !== seat;
    case 'CERTIFY_APPEAL_VOTE':
      // ⚠️ 发现 1（本轮纠正）：草稿写作 `!c.pending.includes(seat)`——把「同场另一名待认证者」也挡在门外。
      //   引擎 `certifyAppealVote` 只排除**申请人**（target === actor）与**唯一失败判定人**（见 hasJudgmentToAppeal），
      //   `resolveAppeals` 更把「存活 − 判定人 − 待认证对象」全算独立第三方 ⇒ co-pending 座位**该投、也能投**。
      //   这里按引擎收口，**不得**反过来把守卫放宽成子集来迁就草稿。
      return c.appealed.includes(action.target)
        && c.appealVotes[seat] === undefined
        && (me?.alive ?? false)
        && action.target !== seat
        && hasJudgmentToAppeal(c, seat);
    case 'PASS':
    case 'COMPARE':
      return false;   // PASS 无 UI 入口；COMPARE 待 B14 接线
  }
}

/**
 * UI 自建候选（粗筛）——与 `candidatesOf` **独立等价**（候选层守卫据此比对）。
 *
 * ⚠️ 结构上逐面对齐引擎粗筛，但每处判据都在本文件独立重写：
 *   · 座位不存活 ⇒ 整体无候选（对应 `candidatesOf` 开头的存活早退，含认证/山议面）；
 *   · 行动面按 `actionWindow` 收口，需目标的牌**只**按候选目标展开；
 *   · 山议候选「未结算 ∧ 本人未投」；
 *   · 认证面在 `pending` 为空时整体不发，APPEAL_VOTE 也在此面内（同引擎）。
 */
export function uiCandidates(state: State, seat: number): Action[] {
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  const out: Action[] = [];
  // ---- 行动面：行棋 / 问天 / 出牌(×目标) / 身份被动(×目标) ----
  if (actionWindow(state, seat)) {
    out.push({ type: 'MOVE', actor: seat, steps: 0 });
    out.push({ type: 'ROLL_WHEEL', actor: seat });
    for (const card of me.hand) {
      if (cardNeedsTarget(card)) {
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
        for (const target of targetCandidates(state, seat)) {
          out.push({ type: 'ABILITY', actor: seat, abilityId, target });
        }
      } else {
        out.push({ type: 'ABILITY', actor: seat, abilityId });
      }
    }
  }
  // ---- 山议投票面 ----
  if (state.council.resolved === false && state.council.votes[seat] === undefined) {
    for (const p of state.players) {
      if (p.alive && p.seat !== seat) { out.push({ type: 'VOTE', actor: seat, target: p.seat }); }
    }
  }
  // ---- 认证面 ----
  const c = state.certification;
  if (c.pending.length > 0) {
    if (isPendingSeat(c, seat) && !c.appealed.includes(seat)) {
      out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat });
    }
    const certifierTurn = isCertifierLike(state, c, seat) && !usedCertTurn(c, seat);
    const judged = c.judgments[seat] !== undefined;
    for (const target of c.pending) {
      if (certifierTurn) {
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
  }
  return out;
}

/** UI 允许动作的 key 集：先自建候选，再逐条过门禁（与引擎「候选 → 试跑 → 收集」独立等价）。 */
export function uiAllowedSet(state: State, seat: number): string[] {
  const out: string[] = [];
  for (const a of uiCandidates(state, seat)) {
    if (uiAllows(state, seat, a)) { out.push(actionKey(a)); }
  }
  return out;
}
