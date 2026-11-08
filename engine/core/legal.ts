// 合法动作枚举（规格 §7）。
//
// 三段式：**候选粗筛 → rng 隔离试跑 → 判定收集**。
// ⚠️ 为什么不手写合法性镜像：镜像会漂。B13 之前对峙算子无人调用、旧实现把
//   CERTIFY_APPEAL 的 target 写成「别人」（引擎要求 target === actor ⇒ 必被拒）、
//   还枚举过一个**零调用方**的「出题合规裁定」动作（Task 1 已从 Action 契约移除；
//   `action-contract.test.ts` 用本文件源码文本钉住它不再回来）——三例都是镜像漂移的实证。
//   现在由引擎自己背书：枚举出来的动作一定被执行入口接受（`一致性-正向` 常驻用例钉住）。
// ⚠️ 反向的教训**同样**要记（发现 2）：粗筛在四处**故意**窄于引擎——`pendingCert` /
//   `duel !== null` / `phase !== '行动'` / `isRoundEnd`（a–d 见 `candidatesOf` 的契约表）。
//   那是 UI 一致性与已登记 gap，**不是**引擎合法性判据，也不是待修的 bug；
//   `一致性-正向` 对这种「少发候选」完全失明，故四处各有一条专门的取证用例钉住现状。
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
import { hasUsedCertificationTurn, isCertifier } from './certification.ts';
import { isRoundEnd } from './round.ts';
import { pendingGate } from './gate.ts';

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
 *
 * ## 反过来的教训（发现 2）：这五条判据里有**四条让本函数比引擎更严**
 *
 * 「枚举不得领先引擎」防的是**多**加判据；但这四条是**有意**多出来的严格，
 * 属于 UI 一致性 / 已登记 gap，不是引擎合法性判据（完整清单与证据行见 `candidatesOf` 的契约）：
 *   · `p.pendingCert` —— 引擎只在 `move` 分支查它，`act` 分支不查 ⇒ 锁定者出牌**被引擎放行**（G-b）；
 *   · `state.duel !== null` —— 整表清零，而 `submitDuelCard` 此时是活的玩家入口（无 Action 成员，B13 gap）；
 *   · `state.phase !== '行动'` —— `performAction` 从不读 `phase` ⇒ 山议里行棋照样被接受；
 *   · `!isRoundEnd(state)` —— 同样从不看 `turnIndex`/round 进度。
 * ⇒ 改这四条前先读 `candidatesOf` 的表格与那四条取证用例：**行为不动**，要动的是登记口径。
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
  if (p === undefined || !p.alive) { return []; }
  // ⚠️ B18：停在**未通过的关隘** ⇒ 手番暂停，只能选通过通道（付费 / 试炼）。
  //   否则玩家可以无视关隘继续行棋 —— 关隘形同虚设。
  // ⚠️ 这一分支**不受行动窗口的其它判据约束**（含 isRoundEnd）：该手番已经行动过
  //   （地形在手番末结算），若沿用行动窗口会把通道候选也一并关掉 ⇒ 关隘永远选不了。
  if (pendingGate(state, seat) !== null) {
    return [
      { type: 'GATE_RESOLVE', actor: seat, channel: 'pay' },
      { type: 'GATE_RESOLVE', actor: seat, channel: 'trial' },
    ];
  }
  if (!actionWindowOpen(state, seat)) { return []; }
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
  if (c.pending.includes(seat) && !c.appealed.includes(seat)) {
    // 待认证者本人：唯一属于他的入口是复议（本人申请，`target === actor`）。
    out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat });
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
 * ## 已知窄于引擎的四处（发现 2：登记过的**口径**，不是待修的 bug）
 *
 * `一致性-正向` 常驻用例只钉得住「候选 ⊆ 引擎接受」这一个方向；反方向
 * （**引擎会接受、粗筛却不发**）对它完全不可见，历史上就是这么漏掉两条认证候选的
 * （见 `certificationCandidates` 注释里的发现 1）。除那两条已补齐的漏发之外，
 * 以下四处是**故意**窄，各自都有可执行证据行（`tests/engine/legal-probe.test.ts`）：
 *
 * | # | 粗筛多出来的一条判据 | 引擎现实 | 为什么仍然这么定 | 证据行 |
 * |---|---|---|---|---|
 * | a | `p.pendingCert` ⇒ 行动面整体关闭 | `performAction` 只有 `move` 分支查 `pendingCert`，`act` 分支不查 ⇒ 锁定者出牌被放行（G-b） | UI 在待认证期**禁用整个行动区**，给模型一条玩家点不到的动作等于给它一个不存在的选项 | `§7 粗筛窄于引擎四处·其一`＋表里 `PLAY_CARD@待认证锁定（G-b 取证）` |
 * | b | `state.duel !== null` ⇒ **整表清零** | 玩家此刻仍有可执行的入口 `submitDuelCard(seat, cardId)`（`{ok,state,note}` 契约；脚本/AI 另有 `autoResolveDuel`），但它**没有对应的 Action 成员** | Action 契约不在本文件改动面内（B13 gap）；对峙选牌是「隐藏信息」流程，本就打算在门禁层外置 | `§7 粗筛窄于引擎四处·其二`＋表里 `PASS@对峙未决` |
 * | c | `state.phase !== '行动'` ⇒ 不发 MOVE/ROLL_WHEEL/PLAY_CARD | `performAction` **从不读** `state.phase` ⇒ 山议阶段照样接受行棋 | 阶段是流程层的闸门（§3.1 八步），引擎不判不代表玩家可以乱按 | `§7 粗筛窄于引擎四处·其三` |
 * | d | `isRoundEnd(state)` ⇒ 同上关闭 | `performAction` 同样**不看** `turnIndex` 与 round 进度 | 「本 round 已行动过」属手番归属门禁（Task 7），与 c 同族 | `§7 粗筛窄于引擎四处·其四` |
 *
 * ⚠️ 反过来也**不要**据此加判据：`PASS` / `COMPARE` 不枚举、非当前手番不给行棋候选、
 *   费用不作门槛（G-a）、需目标的牌不发无目标版本——这些同样是口径，理由在各函数注释里。
 *   新加「窄于引擎」的判据时，**必须**同时留下形如上面四行的取证用例（引擎侧 `ok:true`
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
