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
import { cardHasMovement } from '../../engine/core/targeting.ts';
import { GOALS, isGoalAchieved } from '../../engine/goals/registry.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { advanceAuto } from '../../engine/core/advance.ts';
import { castVote, resolveCouncil, topVoted, useCouncilVeto } from '../../engine/core/council.ts';
// ⚠️ B75：装备分支只给 `equip_count` 目标的身份用 ⇒ 需要读**运行时目标**（flags.goal 由 setup 派生）。
import { goalOf } from '../../engine/goals/settle.ts';
import {
  certifySign, certifyChallenge, certifyAnswer, certifyAppeal, certifyAppealVote, certifyMutualSign,
  certifyAbstain, resolveAppeals, isCertifier, hasUsedCertificationTurn,
} from '../../engine/core/certification.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { stateToJson } from '../../engine/core/serialize.ts';
import { actionKey, actionFromKey, withActor } from '../../engine/core/action-key.ts';

// ⚠️ **禁止并发调用 `playOne`**（B70 复审登记）：recorder / recordSeq / recordCtx 是模块级可变量，
//   现在靠 `runCell` 串行才安全。改成 `Promise.all` 之类并发会让 JSONL 的 themeId/seed/round 串号；
//   真要并发，必须先把记录上下文改成显式传参。
let recorder = null;
// 记录序号**从 0 开始** ⇒ `seq` 就是 JSONL 行号；跨全部主题与人数档位连续递增。
let recordSeq = 0;
// 当前局的记录上下文（`playOne` 设置 ⇒ 决策函数内无需改签名）。
let recordCtx = null;

/** 由 run.mjs 装配记录器（null = 关闭，record 为空操作）；装配时把序号与上下文一起归零。 */
export function setRecorder(value) { recorder = value; recordSeq = 0; recordCtx = null; }
export function getRecorder() { return recorder; }

/**
 * 记一个决策点。
 *
 * @param {object} state **动作执行前**的局面（探针要重建「当时看到什么」）。
 * @param {number} seat 决策座位。
 * @param {string} heuristic 启发式选中的动作（`actionKey`；对峙选牌用 `actionKey` 的规范形 `duel:card:<id>`）。
 * @param {number|null} face 引擎产生的**骰面点数**（无骰面的决策点为 null）。
 * @returns {number} 该条记录的下标（**动作执行后**可回填 `face`；关闭时返回 -1）。
 */
export function record(state, seat, heuristic, face = null) {
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

/** 状态合法性体检（跑完一局后逐玩家核对）。 */
export function checkState(s, label) {
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

/**
 * 挑一个默认出牌目标：除自己外位置最高的存活玩家。
 *
 * ⚠️ 位置并列时**随机**选（用 state.rng ⇒ 仍可复现）。
 *   原实现取「座位序最靠前」者 ⇒ 小号座位被系统性地多打一次 ⇒
 *   读数上表现为「座号越大胜率越高」的假趋势（实测 6 人局 +2.8pp、4 人局严格递增）。
 *   真实对局中攻击目标是**玩家自选**（B10 收尾①），不存在这种座位绑定，
 *   模拟器不该把它引入 —— 否则测的是 AI 的偏置，不是规则的公平性。
 */
export function pickTarget(s, seat) {
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

/** 山议：每人投给位置最高的对手，然后结算。 */
export async function councilTurn(s, policy, counters, hit) {
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
    // ⚠️ B70 Task 3：**council 面注入**（默认关闭 ⇒ hit 恒 false，下面整段是空操作）。
    //   改道命中即投完 `continue`（该循环原本同层就有 `continue` ⇒ 语义等价于「这个人投完了」）；
    //   任何失败（null / 非法 key / 抛错 / 超时 / 引擎拒绝）⇒ 落回下面的 `pickTarget` 启发式。
    //   ⚠️ B70 评审 N-1（修复轮 2）：本站点声明为 'council' ⇒ `policy.face` 不是 council
    //     时在**问出口之前**就短路（计 emptyCandidates 后回落），跨面候选不再到达这里。
    if (hit(p.seat)) {
      const picked = await askPolicy(policy, s, p.seat, counters, 'council');
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
  // ⚠️ B75：仲裁者自保否决 —— 位置在**投票循环之后、结算之前**（引擎的硬前置就是「票已齐」）。
  //   最多一人使用（`vetoUsed` 每局一次 ⇒ 循环里成功一次就 break）；否决不写决策记录器：
  //   记录器的 council 面口径是「投票」，把否决混进去会让 B70 那类读数变成两种语义共用一个键空间。
  for (const p of s.players.filter((x) => x.alive)) {
    if (shouldVeto(s, p.seat)) {
      const v = useCouncilVeto(s, p.seat);
      if (v.ok) { s = v.state; }
      break;
    }
  }
  const rr = resolveCouncil(s);
  return rr.ok ? rr.state : s;
}

/** 认证一轮：认证人签印/质疑 → 判定 → 待认证者复议 → 第三方投票 → 复议裁定。 */
export async function certificationTurn(s, policy, counters, hit) {
  const targets = [...s.certification.pending];
  for (const target of targets) {
    for (const p of s.players) {
      if (!isCertifier(s, p.seat) || hasUsedCertificationTurn(s, p.seat)) { continue; }
      // ⚠️ B70 Task 3：**certify 面注入**（默认关闭 ⇒ hit 恒 false）。
      //   本面**只**改道「签印 / 质疑 / 弃权」三选；下面的判定（`certifyAnswer`）、互签
      //   （`certifyMutualSign`）、复议申请与复议票**一律走原逻辑**。
      //   ⚠️ 改道命中时不再消耗原来那次 `s.rng.next() < 0.2` ⇒ 模型臂随机流自首个分歧起分叉。
      //   ⚠️ B70 评审 I-1（修复轮 1）+ N-1（修复轮 2）：候选**按当前 target 收窄**，且本站点
      //     声明为 certify 面（`policy.face !== 'certify'` ⇒ 在问出口**之前**就短路回落）。
      //     两条一起才让「模型看到的 / JSONL 记的 / 引擎做的」是同一个 target 的同一个动作：
      //     · 不收窄 ⇒ `pending.length >= 2` 时 `legal.ts` 会对**每个**待认证目标各发三条候选，
      //       于是「模型想质疑 5、循环此刻 target=3 ⇒ 引擎质疑 3、JSONL 记下没发生过的事」；
      //     · 不绑面 ⇒ `face: 'play'` 的策略器会在这里拿到该座位的 `PLAY_CARD` 候选（认证人往往
      //       同时是行动窗口开着的手番玩家），下面的三目 `else` 执行的是 `certifySign`，
      //       记录的却是 `play:<cardId>-><target>` ⇒ 引擎替该座位签了印、JSONL 记了一张
      //       从未打出的牌（N-1 的幻影记录）。
      //     （council 面本来就忠实使用 `picked.target` ⇒ 两面口径统一。）
      //   ⚠️ 候选都经 `getLegalActions` ⇒ `probeAction` 背书，故保持「先 record 后判 ok」的形状，
      //     不需要为 `r.ok === false` 加分支。
      if (hit(p.seat)) {
        const picked = await askPolicy(policy, s, p.seat, counters, 'certify', (a) => a.target === target);
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

/**
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
/**
 * 牌的启发式优先级（3=位移 / 2=压制 / 1=其它）。
 *
 * ⚠️ B75：从 `pickPlayableCard` 内部提到模块级 —— **装备选牌要用同一把尺反向取「最不需要打出」的一张**；
 *   留在函数内部就得再抄一份判据（两份尺子迟早漂移）。行为与提出前逐字相同。
 */
function rankOf(card) {
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
}

/**
 * B75：要装备哪张手牌 —— 取「最不需要打出」的一张可支付、非位移牌。
 *
 * ⚠️ 手牌 < 2 时**不装备**：留一张牌才有事可做（装备掉唯一的手牌会把行动面变成空集）。
 * ⚠️ 位移判定用 `cardHasMovement`（引擎/枚举同源，覆盖 utility 与嵌套效果），
 *   **不用** `rankOf(c) < 3` —— rankOf 只认 4 个位移 op，会漏 `move_backward` / `move_to_tile` /
 *   `move_relative_to` 以及 conditional / count 的嵌套 ⇒ 判据更弱就不是同一个口径。
 * ⚠️ 资源：装备本身免费，但**付不起的牌一旦装备就永远打不出去** ⇒ 只在付得起的牌里挑
 *   （与出牌共用「能不能支付」这条现实约束）。
 */
export function pickEquipCard(state, seat) {
  const p = state.players[seat];
  if (p === undefined || p.hand.length < 2) { return undefined; }
  const candidates = p.hand.filter((c) => c.cost <= p.resource && !cardHasMovement(c));
  if (candidates.length === 0) { return undefined; }
  return candidates.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
}

/**
 * B75.1：仲裁者是否应在**本次**山议使用否决 —— 自救被规则禁止后，只剩「救他人」这一种形状。
 *
 * ⚠️ 判据与引擎 `useCouncilVeto` 逐条一致（含「所有存活玩家都已投票」的 `every` 判据与 `!topVoted.includes(seat)`）：
 *   不一致 ⇒ 启发式白白发一次引擎必拒的动作，还多耗一次随机数。
 * ⚠️ **策略是占位、不是最优**：自救禁了以后，「放逐别人」对仲裁者并无直接收益 ⇒ 纯自利 AI 的最优解是**永远不用**；
 *   但那样 `veto_success` 又归零（违反完成定义「达成次数 > 0」）。这里取「以 0.15 概率救他人」模拟人类
 *   「留一个弱的当靶子 / 看不下去」的非理性行为；批次记录里注明**人类玩家的否决行为未建模**。
 * ⚠️ **随机流代价（如实登记）**：`state.rng.next()` 是可变对象 ⇒ 本条会在「持权者活着 ∧ 票已齐 ∧ 自己不是最高票」时
 *   消耗一次 rng ⇒ B75.1 的分叉起点就是这里（装备带那条复用同一个 roll，零扰动）。
 *   判据顺序刻意把 `canVeto` / `vetoUsed` / `allVoted` 都放在抽签**之前** ⇒ 不含权、未票齐的座位一律不消耗，
 *   每次山议至多多耗一次（只有持权者走到抽签）。
 */
export function shouldVeto(state, seat) {
  const c = state.council;
  if (c.resolved || c.vetoUsed || (c.vetoBy ?? null) !== null) { return false; }
  const p = state.players[seat];
  if (p === undefined || !p.alive || p.flags.canVeto !== true) { return false; }
  const allVoted = state.players.filter((x) => x.alive).every((x) => c.votes[x.seat] !== undefined);
  if (!allVoted) { return false; }
  const tops = topVoted(state);
  if (tops.includes(seat)) { return false; }   // B75.1：自救禁止（与引擎同判）
  if (tops.length === 0) { return false; }     // 无人得票 ⇒ 本次本就不会放逐，白用
  return state.rng.next() < 0.15;
}

export function pickPlayableCard(hand, resource) {
  const affordable = hand.filter((c) => c.cost <= resource);
  // ⚠️ 无可打牌时返回 **undefined**（不是 null）⇒ 与调用点的 `card === undefined` 判据一致
  //   （返回 null 会让调用点漏判 ⇒ 读 `card.id` 抛 TypeError）。
  if (affordable.length === 0) { return undefined; }
  let best = null;
  let bestRank = 0;
  let bestCost = Infinity;
  for (const card of affordable) {
    const r = rankOf(card);
    if (r > bestRank || (r === bestRank && card.cost < bestCost)) {
      best = card;
      bestRank = r;
      bestCost = card.cost;
    }
  }
  return best;
}

/**
 * AI 偶尔发动身份被动（B12）。
 *
 * ⚠️ **可达性要求**：若 AI 从不发动，被动在真实对局中**永远不会触发** ⇒
 *   平衡读数与「机制真实存在」的断言都无从谈起（这是「只写不读」死机制的老教训）。
 *
 * 规则一致性：发动被动**占用本回合的行动**（规格 §3.1 行动三选一）⇒
 *   发动成功后本回合不再行棋/问天/出牌。
 */
export function maybeUseAbility(s, seat) {
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

/**
 * B75.2：目标感知追goal —— `reroll_count` / `steal_count` 两目标的「策略调优」收口
 * （B75 批次记录 §7 遗留 4：两目标此前「阈值/策略未达标」——AI 被动使用率 ~4%/手番，
 *   阈值 5/3 在整局尺度上不可达 ⇒ 平衡报告达成 0 人次）。
 *
 * 语义（与 B75 装备分支同一范式）：
 *   · **达阈即停**：`counters ≥ goal.count` ⇒ null（不无限占行动、不拖慢全局节奏）；
 *   · **不抽随机数**：决策由状态决定（`Rng.next()` 可变 ⇒ 零扰动，见 equip 分支同款注释）；
 *   · **失败回落**：`performAbility` 失败（每回合闸门 / 目标灵枢不足）⇒ null，调用方回落行动带；
 *   · **只服务两类目标**：`equip_count` 归 B75 装备分支，本函数不叠用。
 *
 * ⚠️ 这是**占位启发式**（非最优、人类玩家行为未建模 —— 同 B75.1 §6 的声明）：
 *   窃火者「有目标就偷最富者、偷满为止」；织梦者「未达标就改判、改满为止」。
 */
export function goalPursuit(s, seat) {
  const goal = goalOf(s, seat);
  if (goal === null || goal === undefined) { return null; }
  const p = s.players[seat];
  if (p === undefined || !p.alive || p.pendingCert) { return null; }
  const passive = p.flags?.passive;
  if (passive === undefined || passive === null) { return null; }
  const counters = p.counters ?? {};
  if (goal.kind === 'steal_count' && passive.op === 'transfer_resource') {
    if ((counters.stolenTotal ?? 0) >= goal.count) { return null; }
    const amount = passive.amount ?? 1;
    // 窃火者：选灵枢最多的对手偷（与 maybeUseAbility 的选择器同口径：平手取序靠前）
    const others = s.players.filter((x) => x.alive && x.seat !== seat && (x.resource ?? 0) >= amount);
    let best = others[0];
    for (const x of others) { if (best !== undefined && (x.resource ?? 0) > (best.resource ?? 0)) { best = x; } }
    if (best === undefined) { return null; }
    const r = performAbility(s, seat, best.seat);
    // ⚠️ `target` 一并返回：调用方（playOne）记录决策点时要写真实动作（与 maybeUseAbility 同形状）
    return r.ok ? { state: r.state, op: String(passive.op), target: best.seat } : null;
  }
  if (goal.kind === 'reroll_count' && passive.op === 'modify_judgement') {
    if ((counters.rerollCount ?? 0) >= goal.count) { return null; }
    // 织梦者：目标缺省 = 自己（abilities.ts 的 case 分支内部传 `target: seat`）⇒ 不带 target 字段
    const r = performAbility(s, seat);
    return r.ok ? { state: r.state, op: String(passive.op) } : null;
  }
  return null;
}

/**
 * B76：力竭自恢的占位决策（p=0.5）——**前置过滤在抽签之前**（r2 评审 🔴3）：
 * 非力竭 / 灵枢不足的座位**零 rng 消耗**。占位声明同 B75.1 §6：非最优、人类行为未建模、消耗一次 rng。
 */
export function selfRecuperateChoice(s, seat) {
  const p = s.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if ((p.exhaustedRounds ?? 0) === 0 || (p.resource ?? 0) < 2) { return false; }
  return s.rng.next() < 0.5;
}

/**
 * B76：力竭救援的占位决策（p=0.10）——同款前置过滤（自己不力竭、存在力竭他人才抽签）。
 * 目标选择：hp 最低者先救（占位启发式，非最优）。
 */
export function rescueChoice(s, seat) {
  const me = s.players[seat];
  if (me === undefined || !me.alive) { return { fire: false, target: -1 }; }
  if ((me.exhaustedRounds ?? 0) > 0 || (me.resource ?? 0) < 1) { return { fire: false, target: -1 }; }
  const targets = s.players.filter((x) => x.alive && x.seat !== seat && (x.exhaustedRounds ?? 0) > 0);
  if (targets.length === 0) { return { fire: false, target: -1 }; }
  if (s.rng.next() >= 0.10) { return { fire: false, target: -1 }; }
  let best = targets[0];
  for (const t of targets) { if (best !== undefined && t.hp < best.hp) { best = t; } }
  return best === undefined ? { fire: false, target: -1 } : { fire: true, target: best.seat };
}

/** 推进手番；若结算后进入对峙 ⇒ AI 选牌后继续推进（回合阻塞的闭环）。 */
export async function advanceWithDuel(s, mode, opts) {
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
 * 「到达但未问出口」的唯一自增入口（`emptyCandidates` 只在这里加）。
 *
 * ⚠️ B70 终审 I3：`emptyCandidates` 的真实口径是**未问出口的到达数**，含四类成因
 *   （站点≠面 / 面未登记 / 该面确无候选 / 按 filter 收窄后为空）⇒ 另记一份**成因子计数**，
 *   让读者能从 JSON 自己算出「其中跨站点到达占多少」。子字段之和恒等于 `emptyCandidates`，
 *   **不新增顶层计数种类**（`calls` / `fallbacks` / `emptyCandidates` 三种语义不变）。
 */
function bumpEmpty(counters, reason) {
  counters.emptyCandidates += 1;
  counters.emptyByReason[reason] += 1;
}

/**
 * 问一次策略；任何失败都回落（返回 null），并计数。
 * ⚠️ 绝不抛错到调用方：注入失败不得让对局卡死或丢样本。
 *
 * 计数口径（**顶层只有这三种**，不得新增第四种）：
 * · `calls` —— **该面被问出口**的次数（站点面 ≡ 策略面 ∧ 拿到候选才算，即简报的语义）；
 * · `fallbacks` —— 其中问了但回落的次数；
 * · `emptyCandidates` —— **未问出口的到达数**：到达了注入点，但（站点面与策略面不符 /
 *   面未登记 / 该面在该局面没有候选 / 按 filter 收窄后为空）⇒ 既不计 calls 也不计 fallbacks。
 *   ⚠️ B70 终审 I3：它**不是**「该面无候选的时刻」——四类成因里「站点 ≠ 面」在读数中占绝大多数
 *   （跨面到达）。成因拆分见 `emptyByReason`（子字段之和恒等于本字段，**不是**第四种顶层计数）。
 * ⇒ 不变式：**每个到达注入点的时刻恰好计一次**（`calls + emptyCandidates == 到达次数`），
 *   既不静默丢弃（否则 Task 5 用 `fallbacks / calls` 读回落率时分母失真）也不重复计数。
 *
 * @param {FacePolicy} policy 注入描述。
 * @param {object} state **动作执行前**的局面。
 * @param {number} seat 决策座位。
 * @param {object} counters 本局计数（就地递增）。
 * @param {string} stationFace **本站点属于哪个面**（'play' | 'council' | 'certify'）。
 *   ⚠️ B70 评审 N-1（修复轮 2）：站点面 ≠ `policy.face` ⇒ **在问出口之前**短路回落。
 *   「此刻该做认证动作还是该出牌」是由**控制流**决定的，局面本身决定不了：`getLegalActions`
 *   把四族候选混在一张表里返回，而认证循环里那个认证人**往往同时是行动窗口开着的手番玩家**
 *   ⇒ 拿 `types` 过滤挡不住「在 certify 站点拿到 PLAY_CARD 候选」（反之亦然）。
 *   只补 `picked.type` 的类型判据更不行：那会把跨面问出口留在 `calls` 里（既没改道也没回落），
 *   且记录/执行仍会分家 ⇒ 故把「站点 ≡ 面」变成**问出口的前置条件**。
 * @param {(a: object) => boolean} [filter] **可选**的候选收窄（默认全部放行）。
 *   调用点的循环维度比「该座位的全部候选」更细时（certify 面：外层还按待认证 target 逐个人转），
 *   必须用它把候选钉到**当前这一次执行的对象**上 —— 否则策略器选的 target 与循环实际执行的
 *   target 可以不是同一个人，记录（`actionKey(picked)`）与引擎真正发生的动作就会不一致（B70 评审 I-1）。
 *   收窄后为空 ⇒ 计 `emptyCandidates`（成因记 `narrowedEmpty`）后回落，**不新增顶层计数种类**。
 */
async function askPolicy(policy, state, seat, counters, stationFace, filter) {
  const types = FACE_TYPES[policy.face];
  // ⚠️ 运行时守卫（B70 Task 3 修复轮 1 · 连带修正 + 修复轮 2 的 N-2）：`policy` 由 `.mjs`
  //   调用方直接构造（Task 5 的 game-arms.mjs），TS 的字面量联合类型**保护不到它**。
  //   face 拼成 Object.prototype 的成员名（'toString' / 'constructor' / '__proto__' /
  //   'hasOwnProperty'）时 `FACE_TYPES[policy.face]` 取到的是**原型链上的值**而非 undefined
  //   ⇒ 上一轮的 `types === undefined` 挡不住它，`types.includes` 照样在 try **之外**抛
  //   TypeError 炸掉整局。按「拿到了这一面的类型表」判，一次覆盖 undefined 与原型链两种漏网。
  //   处理口径不变：记 emptyCandidates 后返回 null 走回落，不抛错、不新增顶层计数种类、不记 fallbacks。
  if (!Array.isArray(types)) { bumpEmpty(counters, 'unregisteredFace'); return null; }
  const keep = filter ?? (() => true);
  // ⚠️ 站点 ≡ 面 是**问出口的前置条件**（B70 评审 N-1，见上面 stationFace 的说明）。
  if (stationFace !== policy.face) { bumpEmpty(counters, 'stationMismatch'); return null; }
  // ⚠️ 先按「面」取候选，再按 `filter` 收窄 —— 两步分开才能在 `emptyByReason` 里区分
  //   「该面在本局面本来就没有候选」与「收窄（certify 面的当前 target）之后为空」（B70 终审 I3）。
  const ofFace = getLegalActions(state, seat).filter((a) => types.includes(a.type));
  if (ofFace.length === 0) { bumpEmpty(counters, 'noCandidate'); return null; }
  const candidates = ofFace.filter(keep);
  if (candidates.length === 0) { bumpEmpty(counters, 'narrowedEmpty'); return null; }
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

/** 跑一局，返回该局的统计与异常。 */
export async function playOne(theme, players, seed, gateReserve, policy) {
  // ⚠️ B70 Task 3：**默认关闭**的策略注入。`policy === undefined`（sim CLI 的全部调用）
  //   ⇒ `hit` 恒 false ⇒ 三处改道分支一次都不进 ⇒ 与注入前逐字同行为（门 ⑨ diff 为空是硬约束）。
  //   ⚠️ `hit` 只认**座位**（简报形状）；「本站点属于哪个面」由每个注入站点各自声明给
  //   `askPolicy`（B70 评审 N-1）⇒ 跨面问出口在问出口之前就被短路，不会到达 `decide`。
  const counters = {
    calls: 0, fallbacks: 0, emptyCandidates: 0,
    emptyByReason: { unregisteredFace: 0, stationMismatch: 0, noCandidate: 0, narrowedEmpty: 0 },
  };
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
    // ⚠️ B75.2：对峙未决 ⇒ 本手番的唯一义务是亮牌（§3.3：选牌对对手不可见、结算期阻塞）。
    //   启发式带（行棋/问天/出牌）**不得**绕过对峙阻塞 —— 此前无守卫，同一玩家在冻结的
    //   turnIndex 下反复行动（实测一回合连走 4 次），对峙永不结算时全场死锁。
    //   AI 的选牌由 `advanceWithDuel` 内的 `autoResolveDuel` 处理（含空手判负，B75.2 补结算时点语义）。
    if (s.duel !== null) {
      s = await advanceWithDuel(s, 'standard', { gateReserve });
      continue;
    }
    const player = s.players[seat];
    if (player !== undefined && player.pendingCert) {
      // 待认证锁定：不能位移（规格 §5.1），但仍可打非位移牌
      // ⚠️ B65：用 `pickPlayableCard` 选牌（按效果强度 + 平价优先），不再「取第一张付得起的」。
      // ⚠️ B72：位移判定用 `cardHasMovement`（与引擎 / 枚举同源），**不再**用 `type !== 'motion'`
      //   —— 位移可藏在 utility 与嵌套效果里（B66 已证）。旧过滤会让启发式挑中引擎必拒的牌 ⇒ 空耗回合。
      // ⚠️ B76：力竭的待认证者可自恢（恢复不是位移；占本手番行动——与出牌同款收尾）。
      if ((player.exhaustedRounds ?? 0) > 0 && player.resource >= 2 && s.rng.next() < 0.5) {
        record(s, seat, actionKey({ type: 'RECUPERATE', actor: seat }));
        s = performAction(s, seat, 'recuperate', {});
        s = await advanceWithDuel(s, 'standard', { gateReserve });
        continue;
      }
      const lockedHand = player.hand.filter((c) => !cardHasMovement(c));
      // ⚠️ B70 Task 3：**play 面注入（待认证锁定分支）**。该分支原本就以 `advanceWithDuel` +
      //   `continue` 收尾 ⇒ 改道分支自带推进（这里 `continue` 合法且必要）。
      //   ⚠️ **B71 起该注入点真正可达**：§7 粗筛在 `pendingCert` 时改为只发**非位移** `PLAY_CARD`
      //   （与引擎同判）⇒ `askPolicy` 能拿到候选。此前（B70）粗筛整面关闭 ⇒ 该点恒为
      //   `emptyCandidates`、模型从未被问到；B70 的 play 读数只覆盖非锁定回合。
      //   ⚠️ 本分支的**基线启发式**仍是 `type !== 'motion'`（不改成 `cardHasMovement`：
      //   那会移动门 ⑨ 的基线报告，属另一次 re-baseline 批次的活）⇒ 极少数 utility 位移牌
      //   仍会被启发式尝试、被引擎拒（G-b）⇒ 该回合空耗。**模型臂**从枚举拿到的都是合法牌。
      if (hit(seat)) {
        const picked = await askPolicy(policy, s, seat, counters, 'play');
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
    // ⚠️ B70 终审 C1（修复）：**play 面注入下沉到出牌分支** —— 规格 §4 的「范围界定」是硬约束：
    //   本面只决定「出哪张牌 + 打谁」，**不含**「行棋/问天/行事」三选一。⇒ `roll` 在注入**之前**
    //   消耗（两臂都恰好消耗一次，0.16 / 0.75 / 0.85 三段行动分段两臂完全相同），只有
    //   `roll >= 0.85`（基线本来就要出牌）才把「选哪张牌 + 打谁」换成模型答案。
    //   ⚠️ 修复前的形状是「命中即整块决策跳过」⇒ 模型臂变成「能出牌就出牌」，同时改掉了
    //     出牌频率 / 身份被动 / 行棋与问天比例 ⇒ play 面读数成了双变量对比（终审 C1 实测：
    //     同一批 seed 座0 出牌次数 2/1/1/4/2 → 6/6/7/8/10、`ability` 恒 0）。
    //   ⚠️ 随机流口径（C1 后）：两臂在每次手番都消耗同一个 `roll` ⇒ 分叉起点不是「跳过了一次
    //     rng」，而是「实际打出的牌不同 ⇒ 之后的状态与 rng 使用不同」。
    const roll = s.rng.next();
    // ⚠️ B75.2：目标感知追goal（reroll_count / steal_count）——放在**行动带之前**、
    //   `roll` 消耗**之后**：保持「每手番恰消耗一次 roll」的 C1 不变量，追goal回合 roll 值弃用。
    //   `goalPursuit` 自身零随机消耗（决策由状态决定）；达阈即停。
    //   待认证锁定分支在上方 `continue`，天然不会走到这里（goalPursuit 对 pendingCert
    //   也返回 null，双保险）。
    //   ⚠️ **时序与概率（B75.2 实测后定，两轮扫描）**：**全程**可追、每回合以 **0.2** 概率追。
    //     · 下半局限定（时序门）是在「回合末清零未接线」的旧引擎上测的（追goal每局至多
    //       打 1 次），接线后其前提消失；实测全程低概率把追goal手番摊薄，门 ⑫ 回到 10.1pp
    //       （锁内，且 3 人局的严格单调清零——旧基线本有）。
    //     · 确定性追goal实测达成率 ~89%（印记几乎必发），窃火者为 5 次偷取烧掉 ~31% 手番
    //       ⇒ 胜率崩到 3.8%；p=0.2 把达成率压回健康带（steal 27% / reroll 68%），
    //       窃火者回到 ~7%（每 1 回合追goal ≈ −2.7pp，代价由达成率加权摊薄）。
    //       ⚠️ 0.2 无经验依据（占位，同 B75.1 §6 的 0.15 声明）；若要调，必须连同重标定一起做。
    //   ⚠️ **随机流**：`goalPursuit` 保持纯函数（零随机消耗，有专测）；概率判定在接线层，
    //     仅在「追goal可达」的回合**额外**消耗一次 `s.rng.next()`（B75.1 shouldVeto 同款先例，
    //     随机流分叉起点如实登记）。不命中 ⇒ 落回正常行动带（roll 已消耗，口径不变）。
    // ⚠️ B76：力竭恢复占位分支（自恢优先于救援；前置过滤 ⇒ 非目标座位零 rng 消耗；
    //   恢复占掉本手番行动，roll 已消耗、值弃用——与追goal分支同款口径）。
    if (selfRecuperateChoice(s, seat)) {
      record(s, seat, actionKey({ type: 'RECUPERATE', actor: seat }));
      s = performAction(s, seat, 'recuperate', {});
      s = advanceTurn(s, 'standard');
      continue;
    }
    const rescuePick = rescueChoice(s, seat);
    if (rescuePick.fire) {
      record(s, seat, actionKey({ type: 'RECUPERATE', actor: seat, target: rescuePick.target }));
      s = performAction(s, seat, 'recuperate', { target: rescuePick.target });
      s = advanceTurn(s, 'standard');
      continue;
    }
    const gotPursuit = goalPursuit(s, seat);
    if (gotPursuit !== null && s.rng.next() < 0.2) {
      record(s, seat, actionKey({ type: 'ABILITY', actor: seat, abilityId: gotPursuit.op, ...(gotPursuit.target === undefined ? {} : { target: gotPursuit.target }) }));
      abilityOps.push(gotPursuit.op);
      s = gotPursuit.state;
      s = advanceTurn(s, 'standard');
      continue;
    }
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
      // ⚠️ B75：`equip_count` 身份的装备分支 —— 把 0.85–1.0 的出牌带**二分**（`roll < 0.925` ⇒ 装备）。
      //   ⚠️ **不额外抽随机数**：`Rng.next()` 是可变对象（engine/core/dice.ts），
      //      再掷一次会移动整条 rng 轨迹 ⇒ 门 ⑨ 的固定 seed 读数与配对比较全部失真。
      //      用同一个 `roll` 划带 ⇒ 随机流零扰动，只是这半段的选择从「出牌」变成「装备」。
      //   ⚠️ 本分支自带 `advanceWithDuel` + `continue`（与待认证锁定分支同款），**不得**再落回出牌块。
      const goal = goalOf(s, seat);
      const equipped = s.players[seat]?.counters.equipsTotal ?? 0;
      if (goal !== null && goal.kind === 'equip_count' && equipped < goal.count && roll < 0.925) {
        const toEquip = pickEquipCard(s, seat);
        if (toEquip !== undefined) {
          record(s, seat, actionKey({ type: 'EQUIP_CARD', actor: seat, cardId: toEquip.id }));
          s = performAction(s, seat, 'equip', { cardId: toEquip.id });
          s = await advanceWithDuel(s, 'standard', { gateReserve });
          continue;
        }
      }
      // 基线本来就要出牌 ⇒ **只有这里**换「选哪张牌 + 打谁」。
      // ⚠️ 候选在此站点收窄为**只含 `PLAY_CARD`**（`askPolicy` 的第 6 参 filter）—— 规格 §4
      //   「本面只决定出哪张牌」。`FACE_TYPES` 本身不动（它同时是「面 → 动作类型」的文档）。
      let injectedCard = null;
      if (hit(seat)) {
        const picked = await askPolicy(policy, s, seat, counters, 'play', (a) => a.type === 'PLAY_CARD');
        if (picked !== null && picked.type === 'PLAY_CARD') { injectedCard = picked; }
      }
      if (injectedCard !== null) {
        // 记录与执行用**同一个**动作（target 来自模型选择，不再用 `pickTarget`）。
        const payload = injectedCard.target === undefined
          ? { cardId: injectedCard.cardId }
          : { cardId: injectedCard.cardId, target: injectedCard.target };
        record(s, seat, actionKey(injectedCard));
        s = performAction(s, seat, 'act', payload);
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
    // ⚠️ B76：力竭四计数器（message 契约由 policy-ai 的守卫测试钉住）。
    exhaustedTotal: s.log.filter((l) => l.kind === 'exhaustion' && l.message.startsWith('力竭：')).length,
    recuperateSelf: s.log.filter((l) => l.kind === 'exhaustion' && l.message.includes('（自恢）')).length,
    recuperateRescue: s.log.filter((l) => l.kind === 'exhaustion' && l.message.includes('（救援）')).length,
    naturalRecovery: s.log.filter((l) => l.kind === 'exhaustion' && l.message.includes('（自然）')).length,
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
    // ⚠️ B70 Task 3：注入计数（缺省 policy ⇒ 三个顶层计数恒 0，`emptyByReason` 亦全 0）。
    //   `calls` = **该面**被问出口的次数（站点面 ≡ 策略面 ∧ 拿到候选才算 ⇒ 简报语义）；
    //   `fallbacks` = 其中回落的次数；
    //   `emptyCandidates` = **未问出口的到达数**（面未登记 / 站点面 ≠ 策略面 /
    //   该面在本局面没有候选 / 按 filter 收窄后为空 ⇒ 没问出口 ⇒ 不计 calls/fallbacks）；
    //   `emptyByReason` = 上面四类成因的**子计数**（之和恒等于 `emptyCandidates`；B70 终审 I3）。
    //   不变式：`calls + emptyCandidates` == 该局到达本站点的时刻数（每个到达恰好计一次）。
    injection: counters,
  };
}
