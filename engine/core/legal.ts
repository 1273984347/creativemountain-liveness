// 合法动作枚举（规格 §7）。
//
// 三段式：**候选粗筛 → rng 隔离试跑 → 判定收集**。
// ⚠️ 为什么不手写合法性镜像：镜像会漂。B13 之前对峙算子无人调用、旧实现把
//   CERTIFY_APPEAL 的 target 写成「别人」（引擎要求 target === actor ⇒ 必被拒）、
//   还枚举过一个**零调用方**的「出题合规裁定」动作（Task 1 已从 Action 契约移除；
//   `action-contract.test.ts` 用本文件源码文本钉住它不再回来）——三例都是镜像漂移的实证。
//   现在由引擎自己背书：枚举出来的动作一定被执行入口接受（`一致性-正向` 常驻用例钉住）。
// ⚠️ 反向的教训**同样**要记（发现 2）：粗筛在**三条**故意窄于引擎——`phase !== '行动'` /
//   `isRoundEnd` / **死亡座位**（a–e 见 `candidatesOf` 的契约表）。
//   ⚠️ **B68 更新**：`duel !== null` 那条**已移除**（G-f 已修 ⇒ 对峙面改为发选牌候选）。
//   ⚠️ **B66 更新**：`pendingCert` 那条**已不再**是「粗筛窄于引擎」——G-b 已修（引擎 `act` 分支
//   现查 `pendingCert` ⇒ 锁定者打位移类牌被引擎拒绝）。
//   ⚠️ **B71 更新**：B66 只把**引擎**改成「只拒位移牌」，枚举仍整面关闭 ⇒ 锁定者的**非位移牌**
//   引擎放行、枚举却不发（`牌在手里、UI 点不到、模型问不到`）。B71 让枚举**逐条对齐引擎**：
//   锁定者只发**非位移** `PLAY_CARD`（位移判定用 `cardHasMovement`，与引擎同源）。
//   ⇒ 该条**不再**是「窄于引擎」，而是「与引擎同判」；其余窄于引擎的只有 `phase` /
//   `isRoundEnd` / **死亡座位** 三条（见 `candidatesOf` 的契约表）。
// ⚠️ **B65：费用作为门槛，但由**引擎**判**（G-a 收口）**：出牌**付费**（规格 §3.1「行事」/§4.3）
//   ⇒ 引擎 `act` 分支查 `card.cost`、灵枢不足即拒绝 ⇒ 本文件的**试跑**（`probeAction`）如实反映该拒绝
//   ⇒ 粗筛**不必**另写 `cost <= resource` 的镜像判据（那才是第二事实源）。
//
// 覆盖的五个决策面（+ 认证子面）：
//   行棋 MOVE / 问天 ROLL_WHEEL / 出牌 PLAY_CARD(×目标) /
//   身份被动 ABILITY(×目标) / 山议投票 VOTE /
//   认证 CERTIFY_SIGN·CHALLENGE·ABSTAIN·APPEAL·ANSWER·APPEAL_VOTE。
// ⚠️ `PASS` **不枚举**：UI 无「结束手番」入口（枚举出来等于给模型
//   一个玩家实际操作不了的选项）——尽管 `probeAction` 对它能给出答案。
// ⚠️ `COMPARE`（关隘出牌比对）**已可枚举**：B19 接了 UI 侧；B53 删掉了 `probe.ts` 里
//   未清理的 B18 占位分支（同一个 switch 里两个 `case 'COMPARE'`，先命中的占位分支
//   永远生效 ⇒ 出牌比对被永久拒收 ⇒ 枚举里永远没有它，而 UI 能做 ⇒ 同一枚举破口）。

import type { Action } from './action.ts';
import type { State } from './state.ts';
import { probeAction } from './probe.ts';
import { cardHasMovement, cardNeedsTarget, targetCandidates } from './targeting.ts';
import { abilityAvailability, activeAbilityId } from './passives.ts';
import { hasUsedCertificationTurn, isCertifier } from './certification.ts';
import { duelPicked, isDuelParticipant } from './duel.ts';
import { isRoundEnd } from './round.ts';
import { pendingGate } from './gate.ts';
import { pendingBarrier } from './barrier.ts';

/** 行动阶段候选上限（官方 serve `MAX_CHOICE_OPTIONS=100`，留余量）。 */
export const LEGAL_ACTION_CAP = 64;

/**
 * 行动窗口（**位移 / 问天 / 身份被动**）：存活 ∧ 无未决对峙 ∧ 阶段为行动 ∧ 本 round 尚未走完。
 *
 * ⚠️ 待认证锁定（§5.1）**不在**这里返回「整面关闭」的理由：锁定者仍可打**非位移牌**，
 *   那部分候选由 `actionPhaseCandidates` 的锁定分支发（B71；位移判定与引擎同源
 *   `cardHasMovement`）。本函数对锁定者返回 false ⇒ 只关位移族（MOVE/ROLL_WHEEL/ABILITY）。
 *
 * ⚠️ 这里**不判**「是不是该座位的手番」：`performAction` 从不看 actor 是否为当前手番
 *   （与 `advanceTurn` 不看 PASS 的 actor 同源，G-c 族），探针据此；
 *   手番归属是 UI/流程层的门禁（Task 7），写进这里会让枚举领先引擎 ⇒ 正是本文件要避免的镜像漂移。
 * ⚠️ 同样**不判** `duel.pickA/pickB`：`DuelState` 那两个字段是可选的，
 *   「未决」即整体阻塞（`advanceTurn` 开头 `state.duel !== null` 那条早退）。
 *
 * ## 反过来的教训（发现 2）：真正**窄于引擎**的判据只剩三条
 *
 * 「枚举不得领先引擎」防的是**多**加判据；下面三条是**有意**多出来的严格，
 * 属于 UI 一致性 / 已登记 gap，不是引擎合法性判据（完整清单与证据行见 `candidatesOf` 的契约）：
 *   · `state.phase !== '行动'` —— `performAction` 从不读 `phase` ⇒ 山议里行棋照样被接受；
 *   · `!isRoundEnd(state)` —— 同样从不看 `turnIndex`/round 进度；
 *   · **死亡座位** —— `performAction` 只查 `player === undefined`，从不查 `alive`。
 * ⚠️ `p.pendingCert` 与 `state.duel !== null` 两条**曾**是更严的判据，现均已与引擎对齐：
 *   B66 修好引擎 `act` 分支（只拒**位移**牌）；B68 让对峙面改发选牌候选；B71 让锁定者
 *   拿到与引擎同判的**非位移**牌候选。
 * ⇒ 改这三条前先读 `candidatesOf` 的表格与那几条取证用例：**行为不动**，要动的是登记口径。
 */
/** 行动窗口里**与锁定无关**的四条判据（存活 / 无对峙 / 阶段 / 本轮未完）。 */
function actionWindowOpenExceptLock(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if (state.duel !== null) { return false; }  // B13 对峙阻塞
  if (state.phase !== '行动') { return false; }
  return !isRoundEnd(state);
}

export function actionWindowOpen(state: State, seat: number): boolean {
  const p = state.players[seat];
  // §5.1 锁定：只关**位移族**（MOVE / ROLL_WHEEL / ABILITY）；非位移出牌见 `actionPhaseCandidates`。
  if (p !== undefined && p.pendingCert) { return false; }
  return actionWindowOpenExceptLock(state, seat);
}

/** 行动阶段三面：行棋 / 问天 / 出牌(×目标) / 身份被动(×目标)。 */
function actionPhaseCandidates(state: State, seat: number): Action[] {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return []; }
  // ⚠️ B18：停在**未通过的关隘** ⇒ 手番暂停，只能选通过通道（付费 / 试炼）。
  //   否则玩家可以无视关隘继续行棋 —— 关隘形同虚设。
  // ⚠️ 这一分支**不受行动窗口的其它判据约束**（含 isRoundEnd）：该手番已经行动过
  //   （地形在手番末结算），若沿用行动窗口会把通道候选也一并关掉 ⇒ 关隘永远选不了。
  if (pendingGate(state, seat) !== null) {
    // ⚠️ B19-b：本关**已改为付费**（试炼失败后）⇒ 只剩付费通道。
    const idx = state.players[seat]?.position ?? 0;
    if (state.players[seat]?.flags[`gate_pay_${idx}`] === true) {
      return [{ type: 'GATE_RESOLVE', actor: seat, channel: 'pay' }];
    }
    const out: Action[] = [
      { type: 'GATE_RESOLVE', actor: seat, channel: 'pay' },
      { type: 'GATE_RESOLVE', actor: seat, channel: 'trial' },
    ];
    // ⚠️ B19：出牌比对通道 —— 候选 = 我的每张牌 × 每个存活对手（引擎试跑会拒掉无效组合）。
    const me = state.players[seat];
    for (const other of state.players) {
      if (!other.alive || other.seat === seat) { continue; }
      for (const card of me?.hand ?? []) {
        out.push({ type: 'COMPARE', actor: seat, cardId: card.id, target: other.seat });
      }
    }
    return out;
  }
  // ⚠️ B18-b：停在**可放印的裂隙格** ⇒ 只发两条通道候选（放印 / 不放）。
  if (pendingBarrier(state, seat) !== null) {
    return [
      { type: 'BARRIER_RESOLVE', actor: seat, channel: 'place' },
      { type: 'BARRIER_RESOLVE', actor: seat, channel: 'skip' },
    ];
  }
  // ⚠️ **B68：对峙面（§3.3）** —— 待决对峙时**取代**行动面（该手番已被对峙阻塞）。
  //   ⚠️ **可见性边界（预研红线 3）**：亮牌**对对手不可见** ⇒ 候选**只发自己手牌里的牌**、
  //   **且只发给对峙参与者** ⇒ 任何一方都拿不到对方的手牌 id ⇒ 无法看到对方将出什么牌。
  //   ⚠️ 「已锁定」的人不再发候选（引擎 `submitDuelCard` 会拒「你已锁定亮牌」⇒ 发了就是死选项）。
  if (state.duel !== null) {
    if (!isDuelParticipant(state, seat)) { return []; }   // 非参与者 ⇒ 无可做动作
    if (duelPicked(state, seat)) { return []; }          // 已锁定 ⇒ 等对方
    const out: Action[] = [];
    for (const card of p.hand) {
      out.push({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId: card.id });
    }
    return out;
  }
  // ⚠️ **B71：待认证锁定者仍可打非位移牌**（规格 §5.1 / §13.4 ③；引擎 `act` 分支自 B66 起只拒位移牌）
  //   ⇒ 行动面**不再整面关闭**：只发**非位移** `PLAY_CARD`（位移判定用 `cardHasMovement`，
  //   与引擎 `performAction` 同源 ⇒ 枚举与引擎同判，不再窄于引擎）。
  //   ⚠️ 位移族（MOVE / ROLL_WHEEL / ABILITY）仍不发 —— 见 `actionWindowOpen` 对锁定者的 false；
  //   其余四条窗口判据（存活/无对峙/阶段/本轮未完）由 `actionWindowOpenExceptLock` 统一表达，
  //   **不要**在这里手写镜像（两份判据迟早漂移）。
  if (p.pendingCert) {
    if (!actionWindowOpenExceptLock(state, seat)) { return []; }
    const out: Action[] = [];
    for (const card of p.hand) {
      // ⚠️ B75：装备**不限位移**（引擎 equip 分支不查 pendingCert ⇒ 锁定期间照样能装备）；
      //   必须排在 `cardHasMovement` 的 continue **之前**，否则位移牌被跳过的同时也跳过了装备。
      out.push({ type: 'EQUIP_CARD', actor: seat, cardId: card.id });
      if (cardHasMovement(card)) { continue; }   // 引擎会拒（G-b 已修）⇒ 不发
      if (cardNeedsTarget(card)) {
        for (const target of targetCandidates(state, seat)) {
          out.push({ type: 'PLAY_CARD', actor: seat, cardId: card.id, target });
        }
      } else {
        out.push({ type: 'PLAY_CARD', actor: seat, cardId: card.id });
      }
    }
    return out;
  }
  if (!actionWindowOpen(state, seat)) { return []; }
  const out: Action[] = [
    { type: 'MOVE', actor: seat, steps: 0 },   // 步数由骰子定，玩家不可选
    { type: 'ROLL_WHEEL', actor: seat },
  ];
  for (const card of p.hand) {
    // ⚠️ B75：每张手牌都追加一条装备候选（与 PLAY_CARD 并列，装备免费 ⇒ 不看资源）。
    //   ⚠️ 候选数由此**按手牌数线性增长** ⇒ `LEGAL_ACTION_CAP=64` 更容易撞上，
    //   撞上限是**如实截断**（stats.truncated=true），不得放宽上限来「让用例好看」。
    out.push({ type: 'EQUIP_CARD', actor: seat, cardId: card.id });
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

/**
 * 山议面候选（§5.6 + B75 设计 §5.1）。
 *
 * · 投票：未结算 ∧ 本人未投过 ∧ 存活 ⇒ 除自己外的每个存活玩家一票。
 * · 否决（B75）：未结算 ∧ 本人存活 ∧ 持 `canVeto` ∧ 本局未用过 ∧ **所有存活玩家都已投票**。
 *   ⚠️ 「票齐」用存活者的 `every`，**不用**「票数 ≥ 存活数」——出局者的旧票会残留在 `votes` 里，
 *     后者会在还有人没投时提前放行（与引擎 `useCouncilVeto` 同款判据，三层不得各写一套口径）。
 */
function councilCandidates(state: State, seat: number): Action[] {
  if (state.council.resolved === true) { return []; }
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  const out: Action[] = [];
  if (state.council.votes[seat] === undefined) {
    for (const p of state.players) {
      if (p.alive && p.seat !== seat) { out.push({ type: 'VOTE', actor: seat, target: p.seat }); }
    }
  }
  const allVoted = state.players.filter((p) => p.alive)
    .every((p) => state.council.votes[p.seat] !== undefined);
  if (allVoted && state.council.vetoUsed !== true && me.flags.canVeto === true) {
    out.push({ type: 'COUNCIL_VETO', actor: seat });
  }
  return out;
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
 * ⚠️ **B67 更新**：双人互验（§5.5）的 `certifyMutualSign` **已有 Action 成员**
 *   （`CERTIFY_MUTUAL_SIGN`，B67 补入）⇒ 本层发互签候选（待认证者给另一位待认证者），
 *   条件与 UI 侧 `uiCandidates` / 面板侧 `certPanelActions` **同款**（本轮未用过机会）⇒ 三层集合相等。
 *
 * ⚠️ **待认证者本人不是「整段返回」**（发现 1，两条都是引擎真接受、粗筛曾漏发）：
 *   · `certifyAnswer` 只看 `pending(target)` ∧ `challenged(actor)` ∧ `actor !== target`，
 *     **不要求**判定人是「非待认证的认证人」⇒「质疑别人、随后自己登顶」的座位仍有判定权；
 *   · `certifyAppealVote` 只排除**申请人**与**判定人**，而 `resolveAppeals` 把
 *     「存活 − 判定人 − 待认证对象」全算独立第三方 ⇒ 同场另一名待认证者是要投票的人。
 *   故这里只对**复议**（本人）与**认证人三面**（判据取引擎自己的 `isCertifier`）按座位身份收口，
 *   `ANSWER` / `APPEAL_VOTE` 两类**一律先发给全部待认证目标**，真非当事人由试跑便宜地滤掉
 *   （`actor === target` 那条「自己判自己」也交给引擎拒，不在这里重写判据）。
 */
function certificationCandidates(state: State, seat: number): Action[] {
  const c = state.certification;
  if (c.pending.length === 0) { return []; }
  const out: Action[] = [];
  if (c.pending.includes(seat)) {
    // 待认证者本人：唯一属于他的入口是复议（本人申请，`target === actor`）。
    // ⚠️ **复议与互签是两个独立入口** ⇒ 申请复议**不**占用互签（互签的占用记在 `signed`）。
    if (!c.appealed.includes(seat)) {
      out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat });
    }
    // ⚠️ **B67：双人互验的互签**（§5.5）—— 待认证者给**另一位**待认证者签印。
    //   ⚠️ **只发给「另一位待认证者」**（`target !== seat`）⇒ 互签语义天然自洽；
    //   「对方是否还在待认证」由试跑（引擎 `certifyMutualSign`）便宜地滤掉 ⇒ 不在此手写镜像判据。
    //   ⚠️ **本轮已用过机会的座位不发**（与签印 / 质疑 / 弃权同一层：`hasUsedCertificationTurn`）。
    if (!hasUsedCertificationTurn(state, seat)) {
      for (const other of c.pending) {
        if (other === seat) { continue; }
        out.push({ type: 'CERTIFY_MUTUAL_SIGN', actor: seat, target: other });
      }
    }
  }
  // 本轮机会三选一：认证人判据取引擎的 `isCertifier`（待认证者不是认证人 ⇒ 引擎必拒 ⇒ 不发，省试跑）。
  const certifierTurn = isCertifier(state, seat) && !hasUsedCertificationTurn(state, seat);
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
  return out;
}

/**
 * 候选总集（粗筛，不含合法性判断）——`getLegalActions` 与 `getLegalActionStats` 共用同一份。
 *
 * ## 已知窄于引擎的五处（发现 2：登记过的**口径**，不是待修的 bug）
 *
 * `一致性-正向` 常驻用例只钉得住「候选 ⊆ 引擎接受」这一个方向；反方向
 * （**引擎会接受、粗筛却不发**）对它完全不可见，历史上就是这么漏掉两条认证候选的
 * （见 `certificationCandidates` 注释里的发现 1）。除那两条已补齐的漏发之外，
 * 以下**四处**是**故意**窄，各自都有可执行证据行（`tests/engine/legal-probe.test.ts`）：
 *
 * | # | 粗筛多出来的一条判据 | 引擎现实 | 为什么仍然这么定 | 证据行 |
 * |---|---|---|---|---|
 * | a | ~~`p.pendingCert` ⇒ 行动面整体关闭~~ | ⚠️ **B71 起与引擎逐条同判**：引擎 `act` 分支自 B66 起**只拒位移牌**（`cardHasMovement`，含 utility 与嵌套效果），锁定者的**非位移牌被放行** ⇒ 枚举也**只发非位移** `PLAY_CARD`；位移族（MOVE/ROLL_WHEEL/ABILITY）不发 ⇒ 不再窄于引擎 | （原「整面关闭」的理由是 UI 在待认证期禁用整个行动区；B71 改为 UI 与枚举同步只开非位移出牌） | `§7 粗筛与引擎同判·其一`（B71 更新） |
 * | b | ~~`state.duel !== null` ⇒ **整表清零**~~ | ⚠️ **B68 已移除该条**：G-f 已修 ⇒ 引擎枚举层在**对峙面**发 `DUEL_SUBMIT_CARD` 候选（**取代**行动面）⇒ 对峙参与者拿到自己手牌的选牌候选，**非参与者仍无候选** | （原理由：对峙选牌是「隐藏信息」流程、本就打算在门禁层外置 —— 但「门禁层外置」不等于「**枚举整表清零**」：那会让 AI/sidecar 在真人必须选暗牌的时刻拿到**空动作表**） | `§7 粗筛与引擎同判` 现行三条 · 及其余取证行 |
 * | c | `state.phase !== '行动'` ⇒ 不发 MOVE/ROLL_WHEEL/PLAY_CARD | `performAction` **从不读** `state.phase` ⇒ 山议阶段照样接受行棋 | 阶段是流程层的闸门（§3.1 八步），引擎不判不代表玩家可以乱按 | `§7 粗筛窄于引擎五处·其三` |
 * | d | `isRoundEnd(state)` ⇒ 同上关闭 | `performAction` 同样**不看** `turnIndex` 与 round 进度 | 「本 round 已行动过」属手番归属门禁（Task 7），与 c 同族 | `§7 粗筛窄于引擎五处·其四` |
 * | e | **死亡座位**（`alive !== true`）⇒ 整表清零 | `performAction` 只查 `player === undefined`，**从不查 `alive`** ⇒ 已出局座位的动作仍会被执行 | 出局者的动作**玩家点不到**（UI 只渲染存活座位）⇒ 同 a 的理由：不给模型一条不存在的选项 | `§7 粗筛窄于引擎五处·其五` |
 *
 * ⚠️ 反过来也**不要**据此加判据：`PASS` 不枚举（`COMPARE` 已可枚举，B19 接线）、非当前手番不给行棋候选、
 *   需目标的牌不发无目标版本——这些同样是口径，理由在各函数注释里。
 * ⚠️ **B65 更新**：**费用不再是「不作门槛」**（G-a 已裁定为出牌付费）⇒ 但**也不要在粗筛里手写** `cost` 判据 ——
 *   正确做法是**让引擎自己拒**、由试跑如实反映（见文件头注释与规格 §7 契约②）。
 *   新加「窄于引擎」的判据时，**必须**同时留下形如上面五行的取证用例（引擎侧 `ok:true`
 *   或入口可用 + 枚举侧缺失），否则 Task 9 的登记与 Task 15 的判读无从引用。
 */
export function candidatesOf(state: State, playerId: number): Action[] {
  if (state.players[playerId]?.alive !== true) { return []; }
  return [
    ...actionPhaseCandidates(state, playerId),
    ...councilCandidates(state, playerId),
    ...certificationCandidates(state, playerId),
  ];
}

/**
 * 一次枚举的全部读数：粗筛 → 逐条试跑 → 收集（受上限截停）。
 *
 * ⚠️ 这是 `getLegalActions` 与 `getLegalActionStats` **共用**的唯一一趟遍历（发现 7）：
 *   两条公共入口各跑一趟的话，试跑成本翻倍 ⇒ Task 15 逐决策点采样时 P2/P3 的读数
 *   会把「探针自己调了两遍」混进延迟与 token 预算里；更要紧的是 `dropped` 这种
 *   「走到第几条候选时被上限拦停」的过程量**只有单趟才量得到**（两趟只能靠减法猜，
 *   而猜出来的那个数把「被引擎拒的候选」也算成丢失 ⇒ 正是发现 3 的假阳性）。
 */
function enumerate(state: State, playerId: number): {
  readonly actions: Action[];
  readonly candidates: number;
  readonly dropped: number;
} {
  const list = candidatesOf(state, playerId);
  const out: Action[] = [];
  let tried = 0;
  for (const a of list) {
    if (out.length >= LEGAL_ACTION_CAP) { break; }
    tried += 1;
    if (probeAction(state, a).ok) { out.push(a); }
  }
  return { actions: out, candidates: list.length, dropped: list.length - tried };
}

/** 该玩家的合法动作（试跑背书，受 `LEGAL_ACTION_CAP` 截断）。 */
export function getLegalActions(state: State, playerId: number): Action[] {
  return enumerate(state, playerId).actions;
}

/** 枚举计数（规格 §7 的派生读数，供 P3 的 token 预算口径使用）。 */
export interface LegalActionStats {
  /** 粗筛候选总数 */
  readonly candidates: number;
  /** 试跑通过并进入枚举的数量（受 LEGAL_ACTION_CAP 截断） */
  readonly enumerated: number;
  /** 是否发生截断（口径：`candidates > LEGAL_ACTION_CAP`，与 `enumerated` 一样由同一个粗筛给出） */
  readonly truncated: boolean;
  /**
   * 因上限而**没被试跑**的候选条数（= 单趟遍历走到 `break` 时剩下的候选数）。
   *
   * 口径（一句话）：**只算「被上限拦停而从未试跑」的候选；被引擎试跑后拒掉的不算丢失，那是筛选**。
   * ⇒ `truncated` 会假阳性（候选超上限而接受数不足上限时结果为真却一条没丢），
   *   **Task 15 / P3 的下调判据读 `dropped`，不读 `truncated`**。
   */
  readonly dropped: number;
}

/**
 * 候选/枚举/截断计数：P3（token 预算）读数的数据源。
 *
 * ⚠️ 与 `getLegalActions` **共用同一趟 `enumerate`**（同一个粗筛、同一次试跑），
 *   不复制第二份粗筛逻辑——两处各写一份的话，「统计说的候选数」和「枚举真给出的候选」
 *   会分叉，P3 读数就失去意义（本文件的存在理由正是防这种漂移）。
 * ⚠️ 判「结果是否被截断」用 `dropped`（> 0 才是真丢了候选），**不要**用 `truncated`：
 *   `truncated` 的定义是 `candidates > LEGAL_ACTION_CAP`（计划钉死的口径，不改），
 *   它在「候选超上限、接受数却不足上限」时给真，而那种情况下枚举其实**完整**。
 */
export function getLegalActionStats(state: State, playerId: number): LegalActionStats {
  const e = enumerate(state, playerId);
  return { candidates: e.candidates, enumerated: e.actions.length, truncated: e.candidates > LEGAL_ACTION_CAP, dropped: e.dropped };
}
