// 决策层单一真相源（B70 从 run.mjs 原样搬出）。
// ⚠️ 依赖必须单向：run.mjs → policy.mjs → engine/*；本文件**不得** import run.mjs
//   （run.mjs 有模块级主流程，被 import 就会跑一整轮模拟）。
// ⚠️ playOne 为 async：Task 3 起可注入需要 await 的模型策略；缺省 policy 时行为与搬移前逐字相同。

import { createInitialState } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import {
  performAction, advanceTurn, needsCouncilVote, needsCertificationAction,
} from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { GOALS, isGoalAchieved } from '../../engine/goals/registry.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { advanceAuto } from '../../engine/core/advance.ts';
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import {
  certifySign, certifyChallenge, certifyAnswer, certifyAppeal, certifyAppealVote, certifyMutualSign,
  certifyAbstain, resolveAppeals, isCertifier, hasUsedCertificationTurn,
} from '../../engine/core/certification.ts';

import { getLegalActions } from '../../engine/core/legal.ts';
import { stateToJson } from '../../engine/core/serialize.ts';
import { actionKey, actionFromKey, withActor } from '../../engine/core/action-key.ts';

let recorder = null;
let recordSeq = 0;
let recordCtx = null;

/** 由 run.mjs 装配记录器（null = 关闭，record 为空操作）。 */
export function setRecorder(value) { recorder = value; recordSeq = 0; }
export function getRecorder() { return recorder; }

export /**
 * 记一个决策点。
 *
 * @param {object} state **动作执行前**的局面（探针要重建「当时看到什么」）。
 * @param {number} seat 决策座位。
 * @param {string} heuristic 启发式选中的动作（`actionKey`；对峙选牌用 `actionKey` 的规范形 `duel:card:<id>`）。
 * @param {number|null} face 引擎产生的**骰面点数**（无骰面的决策点为 null）。
 * @returns {number} 该条记录的下标（**动作执行后**可回填 `face`；关闭时返回 -1）。
 */
function record(state, seat, heuristic, face = null) {
  if (recorder === null) { return -1; }
  const ctx = recordCtx;
  recorder.push({
    seq: recordSeq++,
    themeId: ctx?.themeId ?? '',
    players: ctx?.players ?? 0,
    seed: ctx?.seed ?? 0,
    round: state.round,
    turnIndex: state.turnIndex,
    seat,
    phase: state.phase,
    face,
    heuristic,
    state: stateToJson(state),
  });
  return recorder.length - 1;
}

export /** 状态合法性体检（跑完一局后逐玩家核对）。 */
function checkState(s, label) {
  const problems = [];
  for (const p of s.players) {
    if (!Number.isFinite(p.hp) || p.hp < 0) problems.push(label + ' 座' + p.seat + ' 体力非法 ' + p.hp);
    if (!Number.isFinite(p.resource) || p.resource < 0) problems.push(label + ' 座' + p.seat + ' 资源非法 ' + p.resource);
    if (!Number.isFinite(p.position) || p.position < 0 || p.position > s.board.length) {
      problems.push(label + ' 座' + p.seat + ' 位置越界 ' + p.position);
    }
    if (!Number.isFinite(p.shield) || p.shield < 0) problems.push(label + ' 座' + p.seat + ' 护盾非法 ' + p.shield);
    if (p.hand.length > p.hpMax) {
      // ⚠️ 异常必须带**足够定位的上下文**（B18-c 追「终局手牌超上限」用）：
      //   只报「座N 手牌超上限」无法区分成因（回合末未跑 / 放逐未清牌 / 抽牌后未裁 / hpMax 口径）。
      const others = s.players.map((x) => '座' + x.seat + (x.alive ? '' : '(出局)')
        + ' h' + x.hand.length + '/' + x.hpMax + '@' + x.position).join(' ');
      problems.push(label + ' 座' + p.seat + ' 手牌超上限 ' + String(p.hand.length) + '/' + String(p.hpMax)
        + ' | round=' + String(s.round) + ' turnIndex=' + String(s.turnIndex)
        + ' phase=' + s.phase + ' alive=' + String(s.players.filter((x) => x.alive).length)
        + ' outcome=' + JSON.stringify(s.outcome)
        + ' | ' + others);
    }
  }
  return problems;
}

export /**
 * 挑一个默认出牌目标：除自己外位置最高的存活玩家。
 *
 * ⚠️ 位置并列时**随机**选（用 state.rng ⇒ 仍可复现）。
 *   原实现取「座位序最靠前」者 ⇒ 小号座位被系统性地多打一次 ⇒
 *   读数上表现为「座号越大胜率越高」的假趋势（实测 6 人局 +2.8pp、4 人局严格递增）。
 *   真实对局中攻击目标是**玩家自选**（B10 收尾①），不存在这种座位绑定，
 *   模拟器不该把它引入 —— 否则测的是 AI 的偏置，不是规则的公平性。
 */
function pickTarget(s, seat) {
  const others = s.players.filter((p) => p.alive && p.seat !== seat);
  if (others.length === 0) { return undefined; }
  let maxPos = -1;
  for (const p of others) {
    if (p.position > maxPos) { maxPos = p.position; }
  }
  const tied = others.filter((p) => p.position === maxPos);
  const chosen = tied[Math.floor(s.rng.next() * tied.length)];
  return chosen === undefined ? undefined : chosen.seat;
}

export /** 山议：每人投给位置最高的对手，然后结算。 */
async function councilTurn(s, policy, counters, hit) {
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
    // ⚠️ B70 Task 3：**council 面注入**（默认关闭 ⇒ hit 恒 false，下面整段是空操作）。
    //   改道命中即投完 `continue`（该循环原本同层就有 `continue` ⇒ 语义等价于「这个人投完了」）；
    //   任何失败（null / 非法 key / 抛错 / 超时 / 引擎拒绝）⇒ 落回下面的 `pickTarget` 启发式。
    if (hit(p.seat)) {
      const picked = await askPolicy(policy, s, p.seat, counters);
      if (picked !== null && picked.type === 'VOTE') {
        record(s, p.seat, actionKey(picked));
        const v = castVote(s, p.seat, picked.target);
        if (v.ok) { s = v.state; continue; }
      }
    }
    const t = pickTarget(s, p.seat);
    if (t === undefined) { continue; }
    // ⚠️ B56：记录决策点（**动作前**的局面）
    record(s, p.seat, actionKey({ type: 'VOTE', actor: p.seat, target: t }));
    const r = castVote(s, p.seat, t);
    if (r.ok) { s = r.state; }
  }
  const rr = resolveCouncil(s);
  return rr.ok ? rr.state : s;
}

export /** 认证一轮：认证人签印/质疑 → 判定 → 待认证者复议 → 第三方投票 → 复议裁定。 */
async function certificationTurn(s, policy, counters, hit) {
  const targets = [...s.certification.pending];
  for (const target of targets) {
    for (const p of s.players) {
      if (!isCertifier(s, p.seat) || hasUsedCertificationTurn(s, p.seat)) { continue; }
      // ⚠️ B70 Task 3：**certify 面注入**（默认关闭 ⇒ hit 恒 false）。
      //   本面**只**改道「签印 / 质疑 / 弃权」三选；下面的判定（`certifyAnswer`）、互签
      //   （`certifyMutualSign`）、复议申请与复议票**一律走原逻辑**。
      //   ⚠️ 改道命中时不再消耗原来那次 `s.rng.next() < 0.2` ⇒ 模型臂随机流自首个分歧起分叉。
      if (hit(p.seat)) {
        const picked = await askPolicy(policy, s, p.seat, counters);
        if (picked !== null) {
          record(s, p.seat, actionKey(picked));
          const r = picked.type === 'CERTIFY_CHALLENGE' ? certifyChallenge(s, p.seat, target)
            : picked.type === 'CERTIFY_ABSTAIN' ? certifyAbstain(s, p.seat, target)
            : certifySign(s, p.seat, target);
          if (r.ok) { s = r.state; continue; }
        }
      }
      const challenger = p.resource >= 2 && s.rng.next() < 0.2;
      if (challenger) {
        // ⚠️ B56：记录决策点（**动作前**的局面）
        record(s, p.seat, actionKey({ type: 'CERTIFY_CHALLENGE', actor: p.seat, target }));
        const r = certifyChallenge(s, p.seat, target);
        if (r.ok) {
          s = r.state;
          const passed = s.rng.next() < 0.65;
          record(s, p.seat, actionKey({ type: 'CERTIFY_ANSWER', actor: p.seat, target, passed }));
          const ans = certifyAnswer(s, p.seat, target, passed);
          if (ans.ok) { s = ans.state; }
        }
      } else {
        // ⚠️ B56：记录决策点（签印）
        record(s, p.seat, actionKey({ type: 'CERTIFY_SIGN', actor: p.seat, target }));
        const sign = certifySign(s, p.seat, target);
        if (sign.ok) { s = sign.state; }
      }
    }
    // ⚠️ **B67：双人互验的互签**（§5.5）—— 待认证者给**另一位**待认证者签印。
    //   ⚠️ **为什么必须做**：此前双人互验**只有引擎函数、没有动作成员**（G-d）⇒ 数字轨与模拟器
    //   **均不可达** ⇒ 双人局会因「两人都要等对方签」而死锁（规格 §5.5 明写「**不产生死锁**」）。
    //   ⇒ 互签一旦双方都发生 ⇒ 各自达标（双人时门槛降为 1，见 §5.2 步骤 0）。
    if (targets.length >= 2) {
      for (const me of targets) {
        if (hasUsedCertificationTurn(s, me)) { continue; }
        const other = targets.find((x) => x !== me);
        if (other === undefined) { continue; }
        // ⚠️ B56：记录决策点（**动作前**的局面）
        record(s, me, actionKey({ type: 'CERTIFY_MUTUAL_SIGN', actor: me, target: other }));
        const ms = certifyMutualSign(s, me, other);
        if (ms.ok) { s = ms.state; }
      }
    }
    // 待认证者申请复议（被判不通过时）
    const judged = Object.entries(s.certification.judgments)
      .some(([k, v]) => v === false && Number(k) !== target);
    if (judged && s.rng.next() < 0.35) {
      // ⚠️ B56：记录决策点（复议申请）
      record(s, target, actionKey({ type: 'CERTIFY_APPEAL', actor: target, target }));
      const ap = certifyAppeal(s, target, target);
      if (ap.ok) {
        s = ap.state;
        for (const p of s.players) {
          if (!p.alive || p.seat === target) { continue; }
          if (s.certification.challenged.includes(p.seat)) { continue; }
          if (s.certification.appealVotes[p.seat] !== undefined) { continue; }
          const overturn = s.rng.next() < 0.5;
          // ⚠️ B56：记录决策点（复议票）
          record(s, p.seat, actionKey({ type: 'CERTIFY_APPEAL_VOTE', actor: p.seat, target, overturn }));
          const v = certifyAppealVote(s, p.seat, target, overturn);
          if (v.ok) { s = v.state; }
        }
        const rs = resolveAppeals(s, target);
        if (rs.ok) { s = rs.state; }
      }
    }
  }
  return s;
}

export /**
 * AI 的**出牌选牌**（B65）——按效果强度选，不是「第一张付得起的牌」。
 *
 * ⚠️ **为什么改（G-a 付费的连带后果）**：出牌改为**付费**后（规格 §3.1「行事」/§4.3），
 *   灵枢迅速见底 ⇒ 旧策略「找第一张 `cost <= resource` 的牌」会让大量回合**无牌可打**
 *   ⇒ 退化为行棋 ⇒ 对局拖长、并列封顶变多 ⇒ **独赢局口径下位次胜率极差被噪声主导**
 *   （实测：8 人局独赢局 391/400 → 350/400 ⇒ 极差 5.9pp → 13.4pp，门 ⑫ 判红）。
 *
 * ⚠️ **判据只用 op 语义，不硬编码主题卡名**（⇒ 四套主题通用、新增卡自动跟上）：
 *   · **位移类**（`move_forward` / `move_by_dice` / `teleport` / `swap_position` …）
 *     ⇒ 推进登顶 ⇒ 直接影响「谁先坐上活人席」⇒ 优先打；
 *   · **压制类**（`damage` / `poison` / `slow` / `silence` / `skip_turn`）
 *     ⇒ 削弱对手 ⇒ 次优先；
 *   · 其余（`heal` / `shield` / `gain_resource` / 抽牌…）⇒ 兜底。
 *
 * ⚠️ **平价优先**：同强度下**优先选更便宜的牌**（资源是稀缺资源 ⇒ 少花多得牌）。
 * ⚠️ **不越权**：本函数只**选牌**，不代替引擎判合法（费用不足的牌由引擎拒 ⇒ 见 B65/A-7）。
 *
 * @param {object} hand 座的手牌
 * @param {number} resource 当前灵枢
 * @returns {object|undefined} 选中的牌（无可打牌 ⇒ undefined）
 */
function pickPlayableCard(hand, resource) {
  const affordable = hand.filter((c) => c.cost <= resource);
  // ⚠️ 无可打牌时返回 **undefined**（不是 null）⇒ 与调用点的 `card === undefined` 判据一致
  //   （返回 null 会让调用点漏判 ⇒ 读 `card.id` 抛 TypeError）。
  if (affordable.length === 0) { return undefined; }
  const rank = (card) => {
    const ops = new Set();
    const collect = (list) => {
      for (const eff of list) {
        ops.add(eff.op);
        if (eff.op === 'sequence' && Array.isArray(eff.effects)) { collect(eff.effects); }
      }
    };
    collect(card.effects);
    // 位移类（推进登顶 ⇒ 影响活人席归属）
    for (const op of ['move_forward', 'move_by_dice', 'teleport', 'swap_position']) {
      if (ops.has(op)) { return 3; }
    }
    // 压制类（削弱对手）
    for (const op of ['damage', 'poison', 'slow', 'silence', 'skip_turn']) {
      if (ops.has(op)) { return 2; }
    }
    return 1;
  };
  let best = null;
  let bestRank = 0;
  let bestCost = Infinity;
  for (const card of affordable) {
    const r = rank(card);
    if (r > bestRank || (r === bestRank && card.cost < bestCost)) {
      best = card;
      bestRank = r;
      bestCost = card.cost;
    }
  }
  return best;
}

export /**
 * AI 偶尔发动身份被动（B12）。
 *
 * ⚠️ **可达性要求**：若 AI 从不发动，被动在真实对局中**永远不会触发** ⇒
 *   平衡读数与「机制真实存在」的断言都无从谈起（这是「只写不读」死机制的老教训）。
 *
 * 规则一致性：发动被动**占用本回合的行动**（规格 §3.1 行动三选一）⇒
 *   发动成功后本回合不再行棋/问天/出牌。
 */
function maybeUseAbility(s, seat) {
  const passive = s.players[seat]?.flags?.passive;
  if (passive === undefined || passive === null) { return null; }
  const op = String(passive.op);
  // 发动概率：约 1/4 的行动机会
  if (s.rng.next() >= 0.25) { return null; }
  let target;
  if (op === 'transfer_resource') {
    // 窃火者：选一个灵枢最多的对手偷
    const others = s.players.filter((p) => p.alive && p.seat !== seat && p.resource > 0);
    if (others.length === 0) { return null; }
    let best = others[0];
    for (const p of others) { if (best !== undefined && p.resource > best.resource) { best = p; } }
    target = best.seat;
  }
  // ⚠️ B56：记录决策点（动作执行前的局面）
  const abilityId = op;
  record(s, seat, actionKey(target === undefined
    ? { type: 'ABILITY', actor: seat, abilityId }
    : { type: 'ABILITY', actor: seat, abilityId, target }));
  const r = performAbility(s, seat, target);
  return r.ok ? { state: r.state, op } : null;
}

export /** 推进手番；若结算后进入对峙 ⇒ AI 选牌后继续推进（回合阻塞的闭环）。 */
async function advanceWithDuel(s, mode, opts) {
  // ⚠️ B18：委托引擎层统一出口（对峙 + 关隘闭环都在里面）——
  //   没有关隘闭环时，AI 会在关隘格上反复行棋直到离开 ⇒ **免费穿过关隘**。
  //
  // ⚠️ **B57 修（对峙面观测）**：对峙在**同一次 `advanceAuto` 内**立起并结算
  //   （`engine/core/advance.ts`）⇒ 「对峙未决的局面」从外部**只存在一瞬、不可得**；
  //   且选牌策略在引擎内部 ⇒ 调用方拿不到「启发式选了什么」。
  //   ⇒ 引擎加了**只读观测回调** `onDuelPick`（不改 state / 不改 log / 不改行为）
  //   ⇒ 这里把「选牌当刻」的局面与牌记下来。
  //   ⚠️ **B68 更新（G-f 已修）**：对峙期 `candidatesOf` **不再整表清零** ——
  //   对峙参与者现在能拿到「锁定自己手牌里的一张」的候选（`DUEL_SUBMIT_CARD`）。
  //   ⇒ 该决策点**有候选**了 ⇒ 探针不再把它归入 `noLegalActions` 桶。
  const next = advanceAuto(s, mode, {
    ...opts,
    onDuelPick: (seat, cardId, stateAtPick) => {
      record(stateAtPick, seat, actionKey({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId }));
    },
  });
  return next;
}

/** 面 → 该面的动作类型集合（certify 面只含签印/质疑/弃权，判定与复议仍走原逻辑）。 */
const FACE_TYPES = {
  play: ['PLAY_CARD'],
  council: ['VOTE'],
  certify: ['CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN'],
};

/**
 * 问一次策略；任何失败都回落（返回 null），并计数。
 * ⚠️ 绝不抛错到调用方：注入失败不得让对局卡死或丢样本。
 *
 * 计数口径：`emptyCandidates` 在「该面一条候选都没有」时递增且**不计入 calls**
 * （没问出口，自然没有回落）；`calls` 只统计真的问了策略器的次数。
 */
async function askPolicy(policy, state, seat, counters) {
  const types = FACE_TYPES[policy.face];
  const candidates = getLegalActions(state, seat).filter((a) => types.includes(a.type));
  if (candidates.length === 0) { counters.emptyCandidates += 1; return null; }
  counters.calls += 1;
  // ⚠️ 超时定时器必须在 finally 里清掉（B70 Task 3 控制器裁定）：
  //   评估器要跑上千次调用，`Promise.race` 里那个 30s timer 若不清，
  //   每次调用都留一个挂起句柄 ⇒ 进程退出前滞留、timer 堆积。
  //   这是零行为变更的纯资源修正：超时仍然 ⇒ reject ⇒ 走同一个 catch ⇒ `fallbacks += 1`。
  let timer = null;
  try {
    const key = await Promise.race([
      policy.decide(state, seat, candidates),
      new Promise((_, reject) => {
        timer = setTimeout(() => { reject(new Error('policy-timeout')); }, policy.timeoutMs ?? 30000);
      }),
    ]);
    if (typeof key !== 'string') { counters.fallbacks += 1; return null; }
    const action = withActor(actionFromKey(key), seat);
    const match = candidates.find((c) => actionKey(c) === actionKey(action));
    if (match === undefined) { counters.fallbacks += 1; return null; }
    return match;
  } catch { counters.fallbacks += 1; return null; } finally {
    if (timer !== null) { clearTimeout(timer); }
  }
}

export /** 跑一局，返回该局的统计与异常。 */
async function playOne(theme, players, seed, gateReserve, policy) {
  // ⚠️ B70 Task 3：**默认关闭**的策略注入。`policy === undefined`（sim CLI 的全部调用）
  //   ⇒ `hit` 恒 false ⇒ 三处改道分支一次都不进 ⇒ 与注入前逐字同行为（门 ⑨ diff 为空是硬约束）。
  const counters = { calls: 0, fallbacks: 0, emptyCandidates: 0 };
  const hit = (seat) => policy !== undefined && policy !== null && policy.seat === seat;
  // ⚠️ B56：记录本局上下文（主题 / 人数 / **本局 seed**）⇒ 决策点函数内无需改签名。
  recordCtx = { themeId: theme.meta.id, players, seed };
  const base = createInitialState({ players, seed, deckSize: theme.counts.deckTotal });
  let s = installTheme(base, theme);
  const anomalies = [];
  const abilityOps = [];
  const maxSteps = s.scales.globalRoundLimit * players * 8 + 200;
  let steps = 0;
  // 首个进入待认证（登顶）的玩家 —— 用于追踪「先手优势」的传导路径：
  // 先动 → 先登顶 → 先收集签印 → 先认证达成 → 先终局。
  let firstPendingSeat = -1;
  let firstPendingRound = 0;
  let firstPendingPos = -1;
  while (!s.outcome.finished) {
    if (steps++ > maxSteps) { anomalies.push('死循环：超过 ' + maxSteps + ' 步'); break; }
    if (needsCouncilVote(s)) { s = await councilTurn(s, policy, counters, hit); }
    if (needsCertificationAction(s)) { s = await certificationTurn(s, policy, counters, hit); }
    const seat = currentPlayer(s);
    if (seat < 0) { break; }
    const player = s.players[seat];
    if (player !== undefined && player.pendingCert) {
      // 待认证锁定：不能位移（规格 §5.1），但仍可打非位移牌
      // ⚠️ B65：用 `pickPlayableCard` 选牌（按效果强度 + 平价优先），不再「取第一张付得起的」。
      const lockedHand = player.hand.filter((c) => c.type !== 'motion');
      // ⚠️ B70 Task 3：**play 面注入（待认证锁定分支）**。该分支原本就以 `advanceWithDuel` +
      //   `continue` 收尾 ⇒ 改道分支自带推进（这里 `continue` 合法且必要）。
      //   ⚠️ 现状读数：§7 粗筛在 `pendingCert` 时**不发行动面候选**（`actionWindowOpen` 为假）
      //   ⇒ 锁定分支的 `askPolicy` 目前只会 `emptyCandidates += 1` 后回落，不产生 `calls`。
      if (hit(seat)) {
        const picked = await askPolicy(policy, s, seat, counters);
        if (picked !== null && picked.type === 'PLAY_CARD') {
          const payload = picked.target === undefined ? { cardId: picked.cardId } : { cardId: picked.cardId, target: picked.target };
          record(s, seat, actionKey(picked));
          s = performAction(s, seat, 'act', payload);
          s = await advanceWithDuel(s, 'standard', { gateReserve });
          continue;
        }
      }
      const card = pickPlayableCard(lockedHand, player.resource);
      if (card !== undefined) {
        const target = pickTarget(s, seat);
        // ⚠️ B56：记录决策点（待认证锁定下的出牌）
        record(s, seat, actionKey(target === undefined
          ? { type: 'PLAY_CARD', actor: seat, cardId: card.id }
          : { type: 'PLAY_CARD', actor: seat, cardId: card.id, target }));
        s = performAction(s, seat, 'act', target === undefined ? { cardId: card.id } : { cardId: card.id, target });
      }
      s = await advanceWithDuel(s, 'standard', { gateReserve });
      continue;
    }
    // ⚠️ B70 Task 3：**play 面注入（普通分支）**。
    //   ⚠️ 这里**不得用 `continue`** —— 尾部还有 `advanceWithDuel` 与 `firstPendingSeat` 统计，
    //   跳过会让模型臂少记「首个登顶者」的传导数据 ⇒ 改用 `injected` 标志位把**原决策块**包起来。
    //   原块（含 `s.rng.next()` 的 0.16/0.75/0.85 三段）整块留在 `if (!injected)` 里 ⇒ 回落路径一行未改。
    let injected = false;
    if (hit(seat)) {
      const picked = await askPolicy(policy, s, seat, counters);
      if (picked !== null && picked.type === 'PLAY_CARD') {
        const payload = picked.target === undefined ? { cardId: picked.cardId } : { cardId: picked.cardId, target: picked.target };
        record(s, seat, actionKey(picked));
        s = performAction(s, seat, 'act', payload);
        injected = true;
      }
    }
    if (!injected) {
      const roll = s.rng.next();
      // B12：AI 偶尔发动身份被动（发动成功则**占用本回合行动**，不再行棋/问天/出牌）
      if (roll < 0.16) {
        const used = maybeUseAbility(s, seat);
        if (used !== null) {
          abilityOps.push(used.op);
          s = used.state;
          s = advanceTurn(s, 'standard');
          continue;
        }
      }
      if (roll < 0.75) {
        // ⚠️ B56：记录决策点（骰面在**动作执行后**才有 ⇒ 先占位，事后回填）
        const recMove = record(s, seat, actionKey({ type: 'MOVE', actor: seat, steps: 0 }));
        s = performAction(s, seat, 'move');
        // ⚠️ 纯 JS（`.mjs` 里不得用 TS 的非空断言 `!` —— E22）
        const rowMove = recorder === null ? undefined : recorder[recMove];
        if (rowMove !== undefined) { rowMove.face = s.lastDice ?? null; }
      } else if (roll < 0.85) {
        const recAsk = record(s, seat, actionKey({ type: 'ROLL_WHEEL', actor: seat }));
        s = performAction(s, seat, 'ask');
        const rowAsk = recorder === null ? undefined : recorder[recAsk];
        if (rowAsk !== undefined) { rowAsk.face = s.lastDice ?? null; }
      } else {
        // ⚠️ B65：用 `pickPlayableCard` 选牌（按效果强度 + 平价优先），不再「取第一张付得起的」。
        const card = player === undefined ? undefined : pickPlayableCard(player.hand, player.resource);
        if (card === undefined) {
          record(s, seat, actionKey({ type: 'MOVE', actor: seat, steps: 0 }));
          s = performAction(s, seat, 'move');
        } else {
          const target = pickTarget(s, seat);
          // ⚠️ B56：记录决策点（需目标的牌带 target）
          record(s, seat, actionKey(target === undefined
            ? { type: 'PLAY_CARD', actor: seat, cardId: card.id }
            : { type: 'PLAY_CARD', actor: seat, cardId: card.id, target }));
          s = performAction(s, seat, 'act', target === undefined ? { cardId: card.id } : { cardId: card.id, target });
        }
      }
    }
    s = await advanceWithDuel(s, 'standard', { gateReserve });
    if (firstPendingSeat < 0 && s.certification.pending.length > 0) {
      firstPendingSeat = s.certification.pending[0] ?? -1;
      firstPendingRound = s.round;
      firstPendingPos = s.turnOrder.indexOf(firstPendingSeat);
    }
  }
  const problems = checkState(s, '终局');
  anomalies.push(...problems);
  if (!s.outcome.finished) { anomalies.push('未分出胜负'); }
  if (s.round > s.scales.globalRoundLimit + 1) { anomalies.push('超出全局回合上限 ' + s.round); }
  return {
    reason: s.outcome.reason,
    rounds: s.round,
    winners: [...s.outcome.winners],
    identities: s.players.map((p) => p.identityId),
    factions: s.players.map((p) => p.factionId),
    // 开局的行动顺序（座位序列）—— 用于「按行动顺序位次」的胜率统计（先手优势的直接度量）
    turnOrder: [...s.turnOrder],
    firstPendingSeat, firstPendingRound, firstPendingPos,
    certRound: s.certification.round,
    // B11 活人席计分制：本局发放的席位数（终局不再由「封顶」触发，而是按席位数排名）
    liveSeats: { ...s.liveSeats },
    seatTotal: Object.values(s.liveSeats).reduce((a, b) => a + b, 0),
    abilityOps,
    // B27：**试炼失败后的归宿**（局末从玩家 flags 推导 —— 失败必写 `gate_pay_<N>`，
    //   最终通过 ⇒ `gate_<N>`（掏空余量仍过关），被放行 ⇒ `gate_fail_<N>`）。
    trialFailOutcomes: s.players.map((p) => {
      const o = { failed: false, passedAfterFail: false, releasedAfterFail: false };
      for (const k of Object.keys(p.flags)) {
        if (!k.startsWith('gate_pay_')) { continue; }
        o.failed = true;
        const idx = k.slice('gate_pay_'.length);
        if (p.flags['gate_' + idx] === true) { o.passedAfterFail = true; }
        if (p.flags['gate_fail_' + idx] === true) { o.releasedAfterFail = true; }
      }
      return o;
    }),
    // B12：被动触发**统一从日志提取**（主动型 + 自动型同格式 `[被动:<op>]`）
    // B13：对峙次数（kind='duel' 的日志条数）—— 对峙可达性证据
    duelCount: s.log.filter((l) => l.kind === 'duel').length,
    // B23：试炼事件（**结构化字段** ⇒ 不解析文案；`trialId` / `trialPassed` 由引擎写入）
    trialEvents: s.log
      .filter((l) => l.kind === 'trial' && typeof l.trialId === 'string')
      .map((l) => ({ id: l.trialId, passed: l.trialPassed === true })),
    passiveOps: s.log.map((l) => {
      const m = /^\[被动:([a-z_]+)\]/.exec(l.message);
      return m === null ? null : m[1];
    }).filter((x) => x !== null),
    // ⚠️ B60：**身份目标达成的可达性读数**（证明「目标可达」而不只是「链路接通」）。
    //   ⚠️ 口径：**由引擎判定器直接判定**（`isGoalAchieved`）⇒ 与引擎同源（单一事实源），
    //   且「达成过」是**历史事实** ⇒ 不会被之后的放逐（§5.6：印记作废）抹掉。
    //   ⇒ 「目标达成」与「持有印记」是**两个口径**，报告里分开列。
    goalKinds: s.players.map((p) => {
      const identity = theme.identities.find((i) => i.id === p.identityId);
      const goal = identity?.goal;
      if (goal === undefined) { return null; }
      return isGoalAchieved(s, p.seat, goal.kind, goal.count ?? 1) ? goal.kind : null;
    }).filter((x) => x !== null),
    markCount: s.players.filter((p) => p.hasMark).length,
    // ⚠️ B60：**持印玩家的目标 kind**（按 kind 分桶）⇒ 门 ⑨ 可**按判定路径**锚定：
    //   `pass_gates` 的印记**必须**经由「计数写入 → 回合末判定 → 发印记」三环才发得出
    //   ⇒ 撤掉任一环 ⇒ 该 kind 的持印数归零 ⇒ 锚点必红。
    //   ⚠️ 为什么不能只看「持印总数」：`survive_with_hp` 走 `terminal` 路径（终局判定）
    //   ⇒ 撤掉回合末判定调用后仍有人持印 ⇒ 总量锚点**测不出**该环断裂（复审实证）。
    markKinds: s.players.filter((p) => p.hasMark).map((p) => {
      const identity = theme.identities.find((i) => i.id === p.identityId);
      return identity?.goal.kind ?? null;
    }).filter((x) => x !== null),
    counterValues: s.players.map((p) => {
      const identity = theme.identities.find((i) => i.id === p.identityId);
      const kind = identity?.goal.kind;
      if (kind === undefined) { return null; }
      const counterName = GOALS[kind]?.counter ?? '';
      if (counterName === '') { return null; }
      return { kind, value: p.counters[counterName] ?? 0, count: identity?.goal.count ?? 1 };
    }).filter((x) => x !== null),
    anomalies,
    // ⚠️ B70 Task 3：注入计数（缺省 policy ⇒ 恒 `{ calls: 0, fallbacks: 0, emptyCandidates: 0 }`）。
    //   `calls` = 真的问了策略器的次数；`fallbacks` = 其中回落的次数；
    //   `emptyCandidates` = 该面一条候选都没有（没问出口 ⇒ 不计入 calls/fallbacks）的次数。
    injection: counters,
  };
}
