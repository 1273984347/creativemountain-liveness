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
// ⚠️ 「可点性」只有**一条**判据：`uiBlockNotice`——每个分支要么返回 null（放行），
//   要么返回一句**点名原因来源**的人话；`uiAllows` 只是它的布尔投影。
//   修复轮（评审发现 A/B）之前这里是「判据一份、拒绝原因无人表达」，
//   于是「挡下了却什么都不说」和「UI 里另抄一份显隐」都能长期存活——现在结构上不可能。
//   UI 侧的消费口径见 `web/main.ts` 的 `// 门禁:` 锚点与 `web/ui/cert.ts` 的 `certClickableActions`。
//
// ⚠️ 费用**不**作为总门槛（G-a 未裁定）——但引擎入口自己会拒的**成本前置**（质疑 1 灵枢、
//   复议 2 灵枢）不在此列：那是 `certifyChallenge` / `certifyAppeal` 的真实前置，
//   补在这里只为与 `probeAction` 对齐（引擎拒的 UI 也必须点不到，否则枚举层守卫红）。
//   这两条已由 `starvedCertScene` + 门禁层守卫**钉死**，不再是无人验证的手写镜像。

import type { State } from '../engine/core/state.ts';
import type { Action } from '../engine/core/action.ts';
import type { CertificationState } from '../engine/core/flow.ts';
import { cardNeedsTarget, targetCandidates } from '../engine/core/targeting.ts';
import { abilityAvailability, activeAbilityId } from '../engine/core/passives.ts';
import { actionKey } from '../engine/core/action-key.ts';
import { isRoundEnd } from '../engine/core/round.ts';

/**
 * 行动窗口的**拒因**（null = 窗口开着）：
 * 存活 ∧ 非待认证锁定 ∧ 无未决对峙 ∧ 阶段为行动 ∧ 本 round 尚未走完。
 *
 * 与 `legal.ts` 的 `actionWindowOpen` **各自独立写**一份（同样不判手番归属——
 * `performAction` 从不看 actor 是否为当前手番，判了就让 UI 领先引擎 ⇒ 正是漂移）。
 * 这里用共享低层原语 `isRoundEnd` 表达「本 round 还没走完」，而不是抄 `turnIndex < 存活数`
 * （写死会与 B9 修正后的 `isRoundEnd` 口径分叉）。
 */
function actionWindowRefusal(state: State, seat: number): string | null {
  const p = state.players[seat];
  if (p === undefined) { return '该座位不存在（人数档位与存档不一致）。'; }
  if (!p.alive) { return '该玩家已出局。'; }
  if (p.pendingCert) { return '待认证锁定：你已在峰顶，不能主动移动（只能被质疑后退）。'; }
  if (state.duel !== null) { return '对峙未结算：双方各自锁定亮牌后才能继续行动。'; }
  if (state.phase !== '行动') { return '当前阶段不可行事（先完成山议/认证）。'; }
  if (isRoundEnd(state)) { return '本 round 已走完：等待回合结算。'; }
  return null;
}

/** 行动窗口（与 `renderActions` 原先的三段禁用条件一一对应）。 */
export function actionWindow(state: State, seat: number): boolean {
  return actionWindowRefusal(state, seat) === null;
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

/**
 * 合法认证人的**拒因**（null = 是合法认证人）——独立重写引擎 `isCertifier`（存活 ∧ 非待认证者）。
 * ⚠️ 判据只此一份：粗筛用它的布尔投影 `isCertifierLike`，拒因文案给门禁层用
 *   （修复轮前签名是 `(state, c, seat)`，而 `c` 恒等于 `state.certification` —— 评审 Minor 已收）。
 */
function certifierRefusal(state: State, seat: number): string | null {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return '你已出局，不再是合法认证人。'; }
  return isPendingSeat(state.certification, seat) ? '你是待认证者本人，不能给自己认证。' : null;
}

/** 合法认证人（存活 ∧ 非待认证者）——独立重写引擎 `isCertifier`。 */
function isCertifierLike(state: State, seat: number): boolean {
  return certifierRefusal(state, seat) === null;
}

/**
 * 复议投票的「存在待复议判定」判据——对齐引擎 `certifyAppealVote` 的 challenger 取法：
 * `Object.keys(judgments).find((k) => judgments[k] === false && k !== actor)` 命中。
 * ⇒ 语义 = **存在一条非本人所判的「判不通过」**；本人若是唯一的失败判定人则无从复议（引擎拒）。
 */
function hasJudgmentToAppeal(c: CertificationState, seat: number): boolean {
  return Object.keys(c.judgments).some((k) => c.judgments[Number(k)] === false && Number(k) !== seat);
}

/** 带目标形状的拒因（未选目标 / 目标不在候选里）——与 `targetCandidates` 同一来源。 */
function targetRefusal(state: State, seat: number, target: number | undefined, label: string): string | null {
  if (target === undefined) { return `${label}需要选择目标（只能选存活对手）。`; }
  return targetCandidates(state, seat).includes(target)
    ? null
    : `${label}的目标不合法：只能选除自己外的存活座位（座${String(target)} 不在候选里）。`;
}

/**
 * 一次点击的**拒因**（null = 允许提交）——UI 可点性的唯一判据，`uiAllows` 只问它是否为 null。
 *
 * 判据与 `probeAction` 的引擎接受口径**逐条对齐**（枚举层守卫据此钉相等）：
 *   · MOVE / ROLL_WHEEL / PLAY_CARD / ABILITY ⇒ 行动窗口（+ 牌/能力自身前置）；
 *   · VOTE ⇒ 山议进行中 ∧ 本人未投 ∧ 双方存活 ∧ 非投自己；
 *   · 认证人三面 ⇒ 待认证目标 ∧ 合法认证人 ∧ 本轮机会未用（质疑另需 ≥1 灵枢）；
 *   · ANSWER ⇒ 本人已质疑且未判定 ∧ 目标待认证 ∧ 非判自己；
 *   · APPEAL ⇒ 本人待认证且未申请 ∧ 目标＝本人 ∧ ≥2 灵枢；
 *   · APPEAL_VOTE ⇒ 见下（发现 1：按引擎纠正，不再排除同场另一名待认证者）；
 *   · PASS ⇒ 无 UI 入口；· COMPARE ⇒ 关隘出牌比对通道（B19 已接线）。
 *
 * ⚠️ 分支内各判据的**顺序**只决定「先说哪一句」，不改变布尔结果（同一条合取式）；
 *   但每一条被拒的形状都必须留下一句可给人看的话（评审发现 B：拒绝不得沉默），
 *   「放行 ⇒ 理由为 null、被拒 ⇒ 理由非空」由常驻用例双向钉住。
 */
export function uiBlockNotice(state: State, seat: number, action: Action): string | null {
  const c = state.certification;
  const me = state.players[seat];
  switch (action.type) {
    case 'MOVE':
    case 'ROLL_WHEEL':
      return actionWindowRefusal(state, seat);
    case 'PLAY_CARD': {
      const window = actionWindowRefusal(state, seat);
      if (window !== null) { return window; }
      const card = me?.hand.find((x) => x.id === action.cardId);
      if (card === undefined) { return '手牌里没有这张牌（可能已被弃掉或不属于你）。'; }
      // 需目标的牌必须带候选目标；不需目标的牌必须不带目标（引擎 `act` 分支同源）。
      return cardNeedsTarget(card)
        ? targetRefusal(state, seat, action.target, `「${card.name}」`)
        : action.target === undefined ? null : '该牌不需要选择目标。';
    }
    case 'ABILITY': {
      const window = actionWindowRefusal(state, seat);
      if (window !== null) { return window; }
      const avail = abilityAvailability(state, seat);
      if (!avail.usable) { return '被动不可发动：' + avail.reason; }
      if (action.abilityId !== activeAbilityId(state, seat)) {
        return '被动标识与当前生效的被动不一致（面板已过期，请重新查看）。';
      }
      return avail.needsTarget
        ? targetRefusal(state, seat, action.target, '该身份被动')
        : action.target === undefined ? null : '该身份被动不需要选择目标。';
    }
    case 'VOTE': {
      if (state.council.resolved) { return '山议未在进行中（等流程层召开山议）。'; }
      if (state.council.votes[seat] !== undefined) { return '你本轮已投过票，等待其他人。'; }
      if ((me?.alive ?? false) === false) { return '你已出局，无法参加山议投票。'; }
      if (action.target === seat) { return '不能投自己。'; }
      return (state.players.find((p) => p.seat === action.target)?.alive ?? false) === false
        ? '投票目标已出局。'
        : null;
    }
    case 'CERTIFY_SIGN':
    case 'CERTIFY_ABSTAIN': {
      if (!isPendingSeat(c, action.target)) { return `座${String(action.target)} 不在待认证状态。`; }
      const certifier = certifierRefusal(state, seat);
      if (certifier !== null) { return certifier; }
      return usedCertTurn(c, seat) ? '你本轮的认证机会已用（签印 / 质疑 / 弃权 三选一）。' : null;
    }
    case 'CERTIFY_CHALLENGE': {
      if (!isPendingSeat(c, action.target)) { return `座${String(action.target)} 不在待认证状态。`; }
      const certifier = certifierRefusal(state, seat);
      if (certifier !== null) { return certifier; }
      if (usedCertTurn(c, seat)) { return '你本轮的认证机会已用（签印 / 质疑 / 弃权 三选一）。'; }
      // 质疑扣 1 灵枢（§5.3.4；引擎不足则拒 ⇒ 这里也得拒，`starvedCertScene` 钉着这条）
      return (me?.resource ?? 0) >= 1 ? null : '灵枢不足：发起质疑需 1 灵枢。';
    }
    case 'CERTIFY_APPEAL': {
      if (action.target !== seat) { return '复议必须由待认证者本人申请（target 必须是本人）。'; }
      if (!isPendingSeat(c, seat)) { return '你不是待认证者，无从申请复议。'; }
      if (c.appealed.includes(seat)) { return '本轮已申请过复议。'; }
      // 复议需 2 灵枢（certifyAppeal 的真实前置；`starvedCertScene` 钉着这条）
      return (me?.resource ?? 0) >= 2 ? null : '灵枢不足：申请复议需 2 灵枢。';
    }
    case 'CERTIFY_ANSWER': {
      if (!c.challenged.includes(seat)) { return '你本轮未发起质疑，没有判定权。'; }
      if (c.judgments[seat] !== undefined) { return '你本轮已给出判定，不得重复判定。'; }
      if (!isPendingSeat(c, action.target)) { return `座${String(action.target)} 不在待认证状态。`; }
      return action.target === seat ? '不能判定自己。' : null;
    }
    case 'CERTIFY_APPEAL_VOTE': {
      // ⚠️ 发现 1（本轮纠正）：草稿写作 `!c.pending.includes(seat)`——把「同场另一名待认证者」也挡在门外。
      //   引擎 `certifyAppealVote` 只排除**申请人**（target === actor）与**唯一失败判定人**（见 hasJudgmentToAppeal），
      //   `resolveAppeals` 更把「存活 − 判定人 − 待认证对象」全算独立第三方 ⇒ co-pending 座位**该投、也能投**。
      //   这里按引擎收口，**不得**反过来把守卫放宽成子集来迁就草稿。
      if (!c.appealed.includes(action.target)) { return `座${String(action.target)} 未申请复议。`; }
      if (c.appealVotes[seat] !== undefined) { return '你本轮已投过复议票。'; }
      if ((me?.alive ?? false) === false) { return '你已出局，不能参与复议投票。'; }
      if (action.target === seat) { return '申请人本人不投自己的复议。'; }
      return hasJudgmentToAppeal(c, seat)
        ? null
        : '没有可复议的失败判定（唯一的「判不通过」正是你所判 ⇒ 当事人回避）。';
    }
    case 'PASS':
      return 'PASS（结束手番）在数字轨没有 UI 入口。';
    case 'COMPARE': {
      // ⚠️ B19：关隘出牌比对通道（规格 §3.5 B19 定案）——判据与 probeAction 对齐。
      if (pendingGateHere(state, seat) === null) { return '你当前不在未通过的关隘格上，无需比对。'; }
      const card = me?.hand.find((x) => x.id === action.cardId);
      if (card === undefined) { return '手牌里没有这张牌（可能已被弃掉或不属于你）。'; }
      // ⚠️ B53 修正：引擎 `resolveCompareGate` 在**本关已改为付费**时拒绝出牌比对
      //   （B24 试炼失败后置 `gate_pay_<index>` 标记）⇒ UI 侧必须同判，否则
      //   「UI 允许 / 引擎拒绝」又成一处破口。
      // ⚠️ `pendingGateHere` 只返回 `{ fee, payOnly }`（无 index）⇒ 关隘格序号
      //   直接取玩家所在格的 `index`（与引擎 `pendingGate` 的取法一致）。
      const gateIndex = me?.position;
      if (gateIndex !== undefined && me?.flags[`gate_pay_${gateIndex}`] === true) {
        return '本关已改为付费（试炼失败后），不能再走出牌比对通道。';
      }
      if (action.target === seat) { return '不能与自己比对。'; }
      const foe = state.players.find((p) => p.seat === action.target);
      if (foe === undefined) { return '目标不存在。'; }
      if (!foe.alive) { return '目标已出局。'; }
      return null;
    }
    case 'GATE_RESOLVE': {
      const gate = pendingGateHere(state, seat);
      if (gate === null) { return '你当前不在未通过的关隘格上，无需选择通道。'; }
      if (action.channel === 'pay') {
        const mine = me?.resource ?? 0;
        if (mine < gate.fee) { return `灵枢不足：关隘标价 ${gate.fee}，现有 ${mine}。`; }
      }
      return null;
    }
    case 'BARRIER_RESOLVE': {
      const b = pendingBarrierHere(state, seat);
      if (b === null) { return '你当前不在可放印的裂隙格上，无需选择。'; }
      return null;
    }
  }
}

/** UI 是否允许提交该动作（单条门禁）＝ `uiBlockNotice` 放行。 */
export function uiAllows(state: State, seat: number, action: Action): boolean {
  return uiBlockNotice(state, seat, action) === null;
}

/**
 * 「这次点击将要提交的动作**存在**一个合法目标形状」——选目标模式的入口判据（发现 A 旁路二·进）。
 *
 * ⚠️ 为什么不能直接问无目标形状：需目标的牌 / 需目标的被动**没有**合法的无目标形状
 *   （引擎 `act` 分支在「需要目标而未选」处原样返回），所以按钮显隐只能用「存在合法目标」这一条。
 *   修复前 `renderActions` 只看 `cardNeedsTarget(card) && targetCandidates(...).length > 0`
 *   与 `ability.usable` ⇒ 山议阶段攻击牌照样能进选目标模式并把牌打出去（而普通牌被拒）。
 */
export type UiTargetedShape =
  | { readonly type: 'PLAY_CARD'; readonly cardId: string }
  | { readonly type: 'ABILITY'; readonly abilityId: string };

/** 是否存在合法的带目标形状（判据仍然只有 `uiBlockNotice` 一份）。 */
export function uiHasLegalTarget(state: State, seat: number, shape: UiTargetedShape): boolean {
  return targetCandidates(state, seat).some((target) => uiAllows(state, seat,
    shape.type === 'PLAY_CARD'
      ? { type: 'PLAY_CARD', actor: seat, cardId: shape.cardId, target }
      : { type: 'ABILITY', actor: seat, abilityId: shape.abilityId, target }));
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
/**
 * 「停在**未通过的关隘**上」的判据（规格 §3.5，B18）。
 *
 * ⚠️ **本文件独立写一份**，不 import 引擎的 `pendingGate` —— 本文件的全部价值就是
 *   「与引擎枚举各自独立实现、再做集合相等比对」；借道引擎判据会让漂移守卫退化成恒等式。
 */
export function pendingGateHere(state: State, seat: number): { readonly fee: number; readonly payOnly: boolean } | null {
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return null; }
  const tile = state.board.tiles.find((t) => t.index === me.position);
  if (tile === undefined || tile.kind !== 'gate') { return null; }
  if (me.flags[`gate_${String(tile.index)}`] === true) { return null; }
  // ⚠️ B19-b：已判「未通过并放行」⇒ 不再把玩家留在这座关隘上。
  if (me.flags[`gate_fail_${String(tile.index)}`] === true) { return null; }
  // ⚠️ B19-b：本关已改为付费（试炼失败后）⇒ 只剩付费通道。
  const payOnly = me.flags[`gate_pay_${String(tile.index)}`] === true;
  return { fee: tile.gate?.fee ?? 0, payOnly };
}

/**
 * 「停在**可放印的裂隙格**上」的判据（规格 §3.4，B18-b）。
 *
 * ⚠️ **本文件独立写一份**，不 import 引擎的 `pendingBarrier`（理由同 `pendingGateHere`）。
 */
export function pendingBarrierHere(state: State, seat: number): { readonly index: number; readonly cost: number } | null {
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return null; }
  const tile = state.board.tiles.find((t) => t.index === me.position);
  if (tile === undefined || tile.kind !== 'rift') { return null; }
  if (tile.barrier === true) { return null; }   // 已有印 ⇒ 直接判定，不给选择
  if (me.resource < 2) { return null; }         // 放不起 ⇒ 不必打扰玩家
  return { index: tile.index, cost: 2 };
}

export function uiCandidates(state: State, seat: number): Action[] {
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  const out: Action[] = [];
  // ---- 关隘面（B18）：停在未通过的关隘 ⇒ 只发两条通道候选，**替代**行动面 ----
  //   （与引擎 `actionPhaseCandidates` 同款结构：关隘面在行动窗口之外。）
  const gateFace = pendingGateHere(state, seat);
  if (gateFace !== null) {
    // ⚠️ B19-b：本关已改为付费 ⇒ 只发付费通道。
    out.push({ type: 'GATE_RESOLVE', actor: seat, channel: 'pay' });
    if (!gateFace.payOnly) {
      out.push({ type: 'GATE_RESOLVE', actor: seat, channel: 'trial' });
    }
    // ⚠️ **B53 修正**：出牌比对通道的候选此前**整条缺失** ⇒ UI 侧候选集不含 COMPARE，
    //   而 UI **实际有**该入口（`web/main.ts` 的手牌点击 → 选对手 → 提交 COMPARE），
    //   引擎侧 `candidatesOf` 也发 ⇒ 两侧集合不等 ⇒ 漂移守卫在**关隘面**判红。
    //   （此前该面恒为空集 ⇒ 破口不可见 —— E87「空集 ≠ 有效」。）
    //   形状与引擎一致：我的每张牌 × 每个存活对手（引擎试跑会滤掉无效组合）。
    if (!gateFace.payOnly) {
      for (const foe of state.players) {
        if (!foe.alive || foe.seat === seat) { continue; }
        for (const card of me.hand) {
          out.push({ type: 'COMPARE', actor: seat, cardId: card.id, target: foe.seat });
        }
      }
    }
  } else if (pendingBarrierHere(state, seat) !== null) {
    // ⚠️ B18-b：裂隙面（放印 / 不放）。
    out.push({ type: 'BARRIER_RESOLVE', actor: seat, channel: 'place' });
    out.push({ type: 'BARRIER_RESOLVE', actor: seat, channel: 'skip' });
  } else if (actionWindow(state, seat)) {
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
    const certifierTurn = isCertifierLike(state, seat) && !usedCertTurn(c, seat);
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
