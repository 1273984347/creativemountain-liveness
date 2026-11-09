// B9 规模与平衡模拟（规格 §9.2 / 实施计划 §10.1）
//
// 用法：
//   node tests/sim/run.mjs                     → 全量：4 套主题 × 3–8 人 × 1000 局
//   node tests/sim/run.mjs --games 100         → 每档位 100 局（冒烟）
//   node tests/sim/run.mjs --games 40 --check  → 门禁用：冒烟 + 「零异常」断言
//   node tests/sim/run.mjs --out docs/balance-report.md
//
// 设计要点：
//   · **确定性**：一切随机都取自 state.rng（固定 seed ⇒ 同结果可复现）
//   · **走真实引擎**：同一套 performAction / advanceTurn / 认证 / 山议，与玩家对局同规则
//   · **覆盖全部机制**：行棋 / 问天 / 出牌（含攻击牌选目标）/ 山议投票 /
//     签印 / 质疑 / 判定 / 复议 / 复议投票
//   · **异常即红**：死循环、非法状态、引擎兜底失效 ⇒ 记为异常并计入报告

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import {
  performAction, advanceTurn, needsCouncilVote, needsCertificationAction,
} from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { autoResolveDuel } from '../../engine/core/duel.ts';
import { advanceAuto } from '../../engine/core/advance.ts';
import { resolveGate } from '../../engine/core/gate.ts';
import { computePositionSpread, POSITION_RMS_GATE_LIMIT, POSITION_SPREAD_GATE_LIMIT, TRIAL_PASS_RANGES, tCritical05 } from '../../engine/core/balance.ts';
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import {
  certifySign, certifyChallenge, certifyAnswer, certifyAppeal, certifyAppealVote,
  resolveAppeals, isCertifier, hasUsedCertificationTurn,
} from '../../engine/core/certification.ts';
import { SCALES } from '../../engine/scales.ts';
// ⚠️ B56：决策点记录器用到的两个**只读**工具（不改任何对局行为）。
import { stateToJson } from '../../engine/core/serialize.ts';
import { actionKey } from '../../engine/core/action-key.ts';

const ROOT = process.cwd();
const THEME_IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];

/**
 * ---------- 决策点记录器（B56）----------
 *
 * 用途：给**影子决策探针**（Task 15）提供「启发式在每个决策点**实际选了什么**」的数据源。
 * ⚠️ 记录的 `state` 一律是**动作执行前**的局面（rng 快照与执行时一致 ⇒ 可复现）。
 *
 * ⚠️ **默认关闭**：`recorder === null` ⇒ `record()` 是**空操作** ⇒ 日常模拟零开销、零产物。
 *   ⇒ 报告**逐字不变**是这个工具的第一不变量（见 `tests/gates/sim-record.test.ts`）。
 *
 * ⚠️ **只加行、不改任何决策**：`record()` 是纯读（不改 state、不改控制流、不消耗 rng）。
 *
 * ⚠️ **可见性红线（务必知悉）**：`state` 字段是 `stateToJson(state)` 的**全量**状态，
 *   **含 rng 内部状态**（`initialSeed` / `s`）⇒ **直接把它喂给模型会让模型预测随机流**。
 *   ⇒ 本文件是**本地中间产物**；喂模型前**必须**经 `tools/laya-probe/state-text.mjs`
 *   的可见性受限文本化（它只取公开字段，不读 rng）。
 */

/** 记录器（null = 关闭）。 */
let recorder = null;
/** 记录序号（**从 0 开始** ⇒ `seq` 就是行号；跨全部主题与人数档位）。 */
let recordSeq = 0;
/** 当前局的记录上下文（`playOne` 设置 ⇒ 决策函数内无需改签名）。 */
let recordCtx = null;

/**
 * 记一个决策点。
 *
 * @param {object} state **动作执行前**的局面（探针要重建「当时看到什么」）。
 * @param {number} seat 决策座位。
 * @param {string} heuristic 启发式选中的动作（`actionKey`；对峙选牌用 `duel_card:<id>`）。
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

/** 解析命令行参数。 */
function parseArgs(argv) {
  const out = { games: 1000, check: false, out: null, themes: THEME_IDS, players: SCALES.map((s) => s.players), trialRate: false, trialTimes: 400, seedBase: 1000, positionSpread: false, gateReserve: undefined, scanReserves: [], scanSeeds: [], scanJson: null, record: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') { out.games = Number(argv[++i]); }
    else if (a === '--check') { out.check = true; }
    else if (a === '--out') { out.out = argv[++i]; }
    else if (a === '--themes') { out.themes = argv[++i].split(','); }
    else if (a === '--players') { out.players = argv[++i].split(',').map(Number); }
    // ⚠️ B23：骰子型试炼的**定向长跑**（通过率专项平衡指标）
    else if (a === '--trial-rate') { out.trialRate = true; }
    else if (a === '--trial-times') { out.trialTimes = Number(argv[++i]); }
    // ⚠️ B25：**seed 基值**（换基值 = 换一批独立样本 ⇒ 用于估计位次极差的**噪声区间**）
    else if (a === '--seed-base') { out.seedBase = Number(argv[++i]); }
    // ⚠️ B25：位次胜率极差专项（§9.2 验收口径）
    else if (a === '--position-spread') { out.positionSpread = true; }
    // ⚠️ B27：余量阈值（`GATE_RESOURCE_RESERVE`）**可注入** ⇒ 扫描走生产同一条代码路径
    else if (a === '--gate-reserve') { out.gateReserve = Number(argv[++i]); }
    else if (a === '--scan-reserves') { out.scanReserves = argv[++i].split(',').map(Number); }
    // ⚠️ B28：**多 seed 独立样本**（每个 seed 基值 = 一批独立样本 ⇒ 可估噪声与差异显著性）
    else if (a === '--scan-seeds') { out.scanSeeds = argv[++i].split(',').map(Number); }
    // ⚠️ B34：把**各组原始统计量**落盘（JSON）⇒ 离线回归可直接重算 Welch t（无舍入误差）
    else if (a === '--scan-json') { out.scanJson = argv[++i]; }
    // ⚠️ B56：**决策点记录器**（默认关闭 ⇒ 不带此开关时零开销、零产物）
    else if (a === '--record-decisions') { out.record = argv[++i]; }
  }
  return out;
}

/** 读主题包。 */
function loadTheme(id) {
  return JSON.parse(readFileSync(resolve(ROOT, 'themes', id, 'theme.json'), 'utf8'));
}

/** 状态合法性体检（跑完一局后逐玩家核对）。 */
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

/**
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

/** 山议：每人投给位置最高的对手，然后结算。 */
function councilTurn(s) {
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
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

/** 认证一轮：认证人签印/质疑 → 判定 → 待认证者复议 → 第三方投票 → 复议裁定。 */
function certificationTurn(s) {
  const targets = [...s.certification.pending];
  for (const target of targets) {
    for (const p of s.players) {
      if (!isCertifier(s, p.seat) || hasUsedCertificationTurn(s, p.seat)) { continue; }
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

/**
 * B13：AI 为对峙挑一张牌（**红优先、同色点数大优先**）。
 */
function pickDuelCard(s, seat) {
  const p = s.players[seat];
  if (p === undefined || p.hand.length === 0) { return null; }
  let best = p.hand[0];
  for (const c of p.hand) {
    if (best === undefined) { best = c; continue; }
    const bc = best.color === 'red' ? 1 : 0;
    const cc = c.color === 'red' ? 1 : 0;
    if (cc > bc || (cc === bc && c.rank > best.rank)) { best = c; }
  }
  return best === undefined ? null : best.id;
}

/**
 * B13：若处于待决对峙 ⇒ AI 为**双方各选一张牌**（双方选完才同时揭晓，规格 §3.3）。
 *
 * ⚠️ 可达性要求：若 AI 从不选牌，对峙会**永远卡住**（回合阻塞）⇒ 机制不可达。
 */
function resolveDuelByAI(s) {
  return autoResolveDuel(s);
}

/** 推进手番；若结算后进入对峙 ⇒ AI 选牌后继续推进（回合阻塞的闭环）。 */
function advanceWithDuel(s, mode, opts) {
  // ⚠️ B18：委托引擎层统一出口（对峙 + 关隘闭环都在里面）——
  //   没有关隘闭环时，AI 会在关隘格上反复行棋直到离开 ⇒ **免费穿过关隘**。
  //
  // ⚠️ **B57 修（对峙面观测）**：对峙在**同一次 `advanceAuto` 内**立起并结算
  //   （`engine/core/advance.ts`）⇒ 「对峙未决的局面」从外部**只存在一瞬、不可得**；
  //   且选牌策略在引擎内部 ⇒ 调用方拿不到「启发式选了什么」。
  //   ⇒ 引擎加了**只读观测回调** `onDuelPick`（不改 state / 不改 log / 不改行为）
  //   ⇒ 这里把「选牌当刻」的局面与牌记下来。
  //   ⚠️ 该决策点**没有候选**（对峙期 `candidatesOf` 整表清零 ⇒ G-f）
  //      ⇒ 探针必须把它归入 `noLegalActions` 桶，**不参与** P1/P6 的对比。
  const next = advanceAuto(s, mode, {
    ...opts,
    onDuelPick: (seat, cardId, stateAtPick) => {
      record(stateAtPick, seat, 'duel_card:' + cardId);
    },
  });
  return next;
}

/** 跑一局，返回该局的统计与异常。 */
function playOne(theme, players, seed, gateReserve) {
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
    if (needsCouncilVote(s)) { s = councilTurn(s); }
    if (needsCertificationAction(s)) { s = certificationTurn(s); }
    const seat = currentPlayer(s);
    if (seat < 0) { break; }
    const player = s.players[seat];
    if (player !== undefined && player.pendingCert) {
      // 待认证锁定：不能位移（规格 §5.1），但仍可打非位移牌
      const card = player.hand.find((c) => c.cost <= player.resource && c.type !== 'motion');
      if (card !== undefined) {
        const target = pickTarget(s, seat);
        // ⚠️ B56：记录决策点（待认证锁定下的出牌）
        record(s, seat, actionKey(target === undefined
          ? { type: 'PLAY_CARD', actor: seat, cardId: card.id }
          : { type: 'PLAY_CARD', actor: seat, cardId: card.id, target }));
        s = performAction(s, seat, 'act', target === undefined ? { cardId: card.id } : { cardId: card.id, target });
      }
      s = advanceWithDuel(s, 'standard', { gateReserve });
      continue;
    }
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
      const card = player === undefined ? undefined : player.hand.find((c) => c.cost <= player.resource);
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
    s = advanceWithDuel(s, 'standard', { gateReserve });
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
    anomalies,
  };
}

/**
 * 跑一档位（某主题 × 某人数 × N 局）。
 *
 * ⚠️ seed **必须含主题 id**：否则四套主题共用同一条随机轨迹 ⇒ 统计上是
 *   「同一条轨迹的 4 份拷贝」，不是 4 个独立样本（实测四套主题数据完全相同）。
 */
function runCell(theme, players, games, seedBase, gateReserve) {
  const results = [];
  const themeSeed = [...theme.meta.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 0);
  for (let g = 0; g < games; g++) {
    const seed = seedBase + g * 97 + players * 13 + themeSeed;
    results.push(playOne(theme, players, seed, gateReserve));
  }
  return results;
}

/** 汇总统计。 */
function summarize(cells) {
  const identityWin = new Map();
  const factionWin = new Map();
  const seatWin = new Map();
  // 「行动顺序位次」胜率：位次 0 = 每 round 最先行动者（B10 随机行动顺序）
  const posWin = new Map();
  // **仅单人获胜局**的胜场（排除并列封顶）——
  //   总胜场口径会把「并列封顶」计给每个并列者 ⇒ 座位/位次胜率被口径扭曲。
  const soloSeatWin = new Map();
  const soloPosWin = new Map();
  let soloGames = 0;
  // B13：对峙次数统计
  let duelTotal = 0;
  let duelGames = 0;
  const certRounds = new Map();
  // B23：关隘试炼统计（每张试炼牌 → 抽取次数 / 通过次数 / 触发过的局数）
  const trialDraws = new Map();
  const trialPasses = new Map();
  const trialGames = new Map();
  // B27：试炼失败后果（失败 / 失败后仍通过（掏空余量）/ 失败后被放行）
  let trialFailed = 0;
  let failButPassed = 0;
  let failReleased = 0;
  let total = 0;
  // ⚠️ B11 席位制：结局语义随之改变 ——
  //   `seats` = 席位制结算（**主路径**，达到回合上限即按席位数排名）；
  //   `fallback` = 达到回合上限且**无人取得任何席位**（纯距离排名，异常倾向）；
  //   `no_winner` = 活人缺席。
  let seatSettled = 0;
  let noSeatFallback = 0;
  let noWinner = 0;
  // 席位统计
  let seatTotalSum = 0;
  let gamesWithoutSeat = 0;
  const seatDist = new Map();
  const champSeatDist = new Map();
  // B12：被动触发统计（可达性证据）—— op → 触发次数 / 触发过的局数
  const abilityOps = new Map();
  const abilityGames = new Map();
  let roundSum = 0;
  let anomalies = 0;
  const anomalySamples = [];
  // 先手优势的传导链：先动 → 先登顶 → 先认证 → 先终局
  const chain = { withPeak: 0, firstIsPos0: 0, firstIsWinner: 0, peakRoundSum: 0 };
  for (const c of cells) {
    total += 1;
    roundSum += c.rounds;
    if (c.reason === 'seats') { seatSettled += 1; }
    else if (c.reason === 'fallback') { noSeatFallback += 1; }
    else { noWinner += 1; }
    // 席位统计（B11）
    const st0 = c.seatTotal ?? 0;
    seatTotalSum += st0;
    if (st0 === 0) { gamesWithoutSeat += 1; }
    seatDist.set(st0, (seatDist.get(st0) ?? 0) + 1);
    const champSeats = c.winners.reduce((m, w) => Math.max(m, c.liveSeats?.[w] ?? 0), 0);
    champSeatDist.set(champSeats, (champSeatDist.get(champSeats) ?? 0) + 1);
    const ops = c.passiveOps ?? [];
    for (const op of ops) { abilityOps.set(op, (abilityOps.get(op) ?? 0) + 1); }
    for (const op of new Set(ops)) { abilityGames.set(op, (abilityGames.get(op) ?? 0) + 1); }
    // B23：试炼事件累加（抽取次数 / 通过次数 / 触发过的局数）
    const evs = c.trialEvents ?? [];
    for (const ev of evs) {
      trialDraws.set(ev.id, (trialDraws.get(ev.id) ?? 0) + 1);
      if (ev.passed) { trialPasses.set(ev.id, (trialPasses.get(ev.id) ?? 0) + 1); }
    }
    for (const id of new Set(evs.map((e) => e.id))) {
      trialGames.set(id, (trialGames.get(id) ?? 0) + 1);
    }
    for (const o of c.trialFailOutcomes ?? []) {
      if (o.failed) { trialFailed += 1; }
      if (o.passedAfterFail) { failButPassed += 1; }
      if (o.releasedAfterFail) { failReleased += 1; }
    }
    if (c.firstPendingSeat >= 0) {
      chain.withPeak += 1;
      chain.peakRoundSum += c.firstPendingRound;
      if (c.firstPendingPos === 0) { chain.firstIsPos0 += 1; }
      if (c.winners.includes(c.firstPendingSeat)) { chain.firstIsWinner += 1; }
    }
    if (c.anomalies.length > 0) {
      anomalies += c.anomalies.length;
      if (anomalySamples.length < 5) { anomalySamples.push(c.anomalies[0]); }
    }
    if (c.winners.length === 1) { soloGames += 1; }
    const dc = c.duelCount ?? 0;
    duelTotal += dc;
    if (dc > 0) { duelGames += 1; }
    for (const w of c.winners) {
      const id = c.identities[w];
      const f = c.factions[w];
      if (id !== undefined) { identityWin.set(id, (identityWin.get(id) ?? 0) + 1); }
      if (f !== undefined) { factionWin.set(f, (factionWin.get(f) ?? 0) + 1); }
      seatWin.set(w, (seatWin.get(w) ?? 0) + 1);
      if (c.winners.length === 1) {
        soloSeatWin.set(w, (soloSeatWin.get(w) ?? 0) + 1);
        const p0 = (c.turnOrder ?? []).indexOf(w);
        if (p0 >= 0) { soloPosWin.set(p0, (soloPosWin.get(p0) ?? 0) + 1); }
      }
      // 位次 = 该胜者在开局行动顺序中的位置（先手优势的直接度量）
      const pos = (c.turnOrder ?? []).indexOf(w);
      if (pos >= 0) { posWin.set(pos, (posWin.get(pos) ?? 0) + 1); }
    }
  }
  return {
    total, seatSettled, noSeatFallback, noWinner, anomalies, anomalySamples,
    noSeatFallbackRate: total > 0 ? noSeatFallback / total : 0,
    avgRounds: total > 0 ? roundSum / total : 0,
    avgSeats: total > 0 ? seatTotalSum / total : 0,
    gamesWithoutSeat, seatDist, champSeatDist, abilityOps, abilityGames, duelTotal, duelGames,
    trialDraws, trialPasses, trialGames, trialFailed, failButPassed, failReleased,
    identityWin, factionWin, seatWin, posWin, certRounds, chain, soloSeatWin, soloPosWin, soloGames,
  };
}

/**
 * 定向长跑：某张试炼牌的通过率（**走生产同一条代码路径** —— `resolveGate(state, seat, 'trial')`）。
 *
 * ⚠️ 为什么要定向：真实对局里试炼是**偶发事件**（要走到关隘格 + 选试炼通道）
 *   ⇒ 局数不够时样本量不足以判通过率 ⇒ 用定向长跑把样本量拉满。
 * ⚠️ 每次都用**全新局面**（试炼无论通过或失败都会写标记 ⇒ 同一局面不能复测）。
 * ⚠️ 用 **8 人局**（36 格 / 4 座关隘）⇒ 30 号关隘也在（4 人局只有 28 格 / 3 座）。
 */
function measureTrial(theme, trialId, gateIndex, times) {
  let passes = 0;
  let fallbackWrites = 0;
  let logMismatch = 0;
  for (let i = 0; i < times; i++) {
    // ⚠️ seed **必须含主题 id**：否则四套主题共用同一条随机轨迹（统计上不是 4 个独立样本）。
    const themeSeed = [...theme.meta.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 0);
    const base = createInitialState({ players: 8, seed: 90000 + i * 131 + themeSeed, deckSize: theme.counts.deckTotal });
    const installed = installTheme(base, theme);
    const s = {
      ...installed,
      decks: { ...installed.decks, trial: installed.decks.trial.filter((c) => c.id === trialId) },
      players: installed.players.map((p) => (p.seat === 0 ? { ...p, position: gateIndex } : p)),
    };
    const r = resolveGate(s, 0, 'trial');
    if (r.passed) { passes += 1; }
    else if (r.state.players[0]?.flags['gate_pay_' + gateIndex] === true) { fallbackWrites += 1; }
    // B23：**日志结构化字段必须与引擎判定一致**（否则平衡报告里的通过率与真实判定脱节）
    const entry = r.state.log.find((l) => l.kind === 'trial');
    if (entry === undefined || entry.trialId !== trialId || entry.trialPassed !== r.passed) {
      logMismatch += 1;
    }
  }
  return { passes, times, fallbackWrites, logMismatch };
}

/** 试炼牌 → 理论通过率（骰子型；由主题包数据派生，不手抄）。 */
const trialTheory = new Map();
/** 全部试炼牌 id（含真实对局里**一次都没被抽到**的牌 —— 报告要显式列出，否则「沉默」不可见）。 */
const allTrialIds = new Set();

/**
 * 骰子型试炼的**通过率专项平衡**（B23；规格 §9.2）。
 *
 * 判据：① 每张骰子型试炼的实测通过率与**理论期望**（`(faces - amount + 1) / faces`）偏差 ≤ 10pp；
 *   ② 失败时必须写「本关改为付费」标记（挑战型语义）；
 *   ③ 每张牌必须被某座关隘引用（无死牌）。
 */
function runTrialRate(args) {
  const rows = [];
  const problems = [];
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    const gates = theme.board.tiles.filter((t) => t.kind === 'gate');
    for (const t of theme.trials ?? []) {
      const pred = t.effects?.[0]?.pred;
      if (pred === undefined) { continue; }
      // ⚠️ B26：骰子型有**解析理论期望**；其余按**设计目标区间**（单一事实源：engine/core/balance.ts）。
      const isDice = pred.kind === 'dice_is_at_least';
      const gate = gates.find((g) => (g.gate?.trialIds ?? []).includes(t.id));
      if (gate === undefined) { problems.push(themeId + '/' + t.id + ' 未被任何关隘引用（死牌）'); continue; }
      const m = measureTrial(theme, t.id, gate.index, args.trialTimes);
      const rate = (m.passes / m.times) * 100;
      const faces = pred.faces ?? 20;
      const amount = pred.amount ?? 0;
      const theory = isDice ? ((faces - amount + 1) / faces) * 100 : null;
      const dev = theory === null ? null : rate - theory;
      const range = TRIAL_PASS_RANGES[t.id] ?? null;
      rows.push({ themeId, id: t.id, gate: gate.index, kind: pred.kind, count: pred.count ?? null, amount, faces, theory, rate, dev, range, ...m });
      if (theory !== null) {
        if (Math.abs(dev ?? 0) > 10) {
          problems.push(themeId + '/' + t.id + ' 通过率 ' + rate.toFixed(1) + '% 偏离理论 '
            + theory.toFixed(1) + '% 达 ' + (dev ?? 0).toFixed(1) + 'pp（> 10pp）');
        }
      } else if (range !== null) {
        if (rate < range[0] || rate > range[1]) {
          problems.push(themeId + '/' + t.id + ' 通过率 ' + rate.toFixed(1) + '% 不在目标区间 ['
            + String(range[0]) + '%, ' + String(range[1]) + '%]');
        }
      }
      if (m.fallbackWrites !== m.times - m.passes) {
        problems.push(themeId + '/' + t.id + ' 失败未写「改为付费」标记（'
          + m.fallbackWrites + '/' + String(m.times - m.passes) + '）');
      }
      if (m.logMismatch > 0) {
        problems.push(themeId + '/' + t.id + ' 试炼日志结构化字段与引擎判定不一致（'
          + m.logMismatch + ' 次）');
      }
    }
  }
  if (rows.length === 0) { problems.push('未找到任何试炼牌'); }
  const lines = [];
  lines.push('# 关隘试炼通过率专项报告（自动生成）');
  lines.push('');
  lines.push('> 由 `node tests/sim/run.mjs --trial-rate` 生成；断言口径见规格 §9.2（B23）。');
  lines.push('> **定向长跑**：对每张骰子型试炼（`dice_is_at_least`）重复抽 ' + String(args.trialTimes) + ' 次，');
  lines.push('> 走**生产同一条代码路径**（`resolveGate(state, seat, \'trial\')`），不另写模拟器副本。');
  lines.push('> **理论期望** = `(faces - amount + 1) / faces`（由主题包数据派生，不手抄）。');
  lines.push('');
  lines.push('| 主题 | 试炼牌 | 关隘 | 判定 | 样本 | 通过次数 | 实测通过率 | 理论期望 / 目标区间 | 偏差 | 失败改为付费 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const judge = r.kind === 'dice_is_at_least'
      ? '骰 ≥ ' + String(r.amount) + '/' + String(r.faces)
      : '至少 ' + String(r.count ?? 2) + ' 张匹配牌';
    const ref = r.theory !== null ? r.theory.toFixed(1) + '%'
      : (r.range === null ? '—' : '[' + String(r.range[0]) + '%, ' + String(r.range[1]) + '%]');
    const devTxt = r.dev === null ? '—' : (r.dev >= 0 ? '+' : '') + r.dev.toFixed(1) + 'pp';
    lines.push('| ' + r.themeId + ' | `' + r.id + '` | ' + String(r.gate) + ' | ' + judge
      + ' | ' + String(r.times) + ' | ' + String(r.passes) + ' | ' + r.rate.toFixed(1)
      + '% | ' + ref + ' | ' + devTxt + ' | ' + String(r.fallbackWrites) + ' |');
  }
  lines.push('');
  writeFileSync(resolve(ROOT, 'docs/trial-pass-rate.md'), lines.join('\n') + '\n', 'utf8');
  console.log('报告 → docs/trial-pass-rate.md');
  for (const r of rows) {
    // ⚠️ B26：骰子型有理论期望；条件型按**目标区间**（单一事实源：engine/core/balance.ts）。
    const ref = r.theory !== null
      ? '理论 ' + r.theory.toFixed(1) + '%（偏差 ' + (r.dev ?? 0).toFixed(1) + 'pp）'
      : (r.range === null ? '无目标区间'
        : '目标区间 [' + String(r.range[0]) + '%, ' + String(r.range[1]) + '%]');
    console.log('  ' + r.themeId + '/' + r.id + ' 实测 ' + r.rate.toFixed(1) + '% vs ' + ref
      + '（样本 ' + String(r.times) + '）');
  }
  if (problems.length > 0) {
    console.error('FAIL  ' + problems.join('；'));
    process.exit(1);
  }
  console.log('PASS  关隘试炼通过率专项平衡通过（偏差 ≤ 10pp · 失败必写「改为付费」）');
}
/**
 * 位次胜率极差（规格 §9.2）：按人数档分组，每档 = **独赢局**口径的位次胜率 max−min（pp）。
 *
 * ⚠️ 为什么用**独赢局**口径：总胜场口径把「并列封顶」计给每个并列者 ⇒ 扭曲位次胜率。
 * ⚠️ 为什么**按人数档分组**：不同人数的位次个数不同 ⇒ 极差不可跨档直接比（8 人局极差天然更大）。
 */
function positionSpread(cells, players) {
  const st = summarize(cells);
  const posTotal = [...st.soloPosWin.values()].reduce((a, b) => a + b, 0);
  if (posTotal === 0) { return null; }
  const even = 100 / players;
  const devs = [];
  for (let pos = 0; pos < players; pos++) {
    const w = st.soloPosWin.get(pos) ?? 0;
    devs.push((w / posTotal) * 100 - even);
  }
  // ⚠️ B25：统计量（RMS 偏离 / 极差 / 严格单调）由**引擎侧纯函数**算出（单一事实源，
  //   平衡报告、门禁判定、单测共用同一份实现）。
  const stats = computePositionSpread(devs);
  return {
    players, soloGames: st.soloGames, total: st.total, posTotal,
    max: stats.max, min: stats.min, spread: stats.spread, rms: stats.rms, monotone: stats.monotone,
  };
}

/**
 * 位次胜率极差专项（§9.2）：跑一批模拟 ⇒ 按人数档算极差 ⇒ 打印。
 *
 * ⚠️ `--seed-base` 换基值 = 换一批**独立样本** ⇒ 重复跑若干次即可估计极差的**噪声区间**
 *   （B25 校准阈值的依据：阈值必须高于噪声下界，否则「改前就红」）。
 */
function runPositionSpread(args) {
  const perCell = new Map();
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    for (const players of args.players) {
      perCell.set(themeId + ':' + players, runCell(theme, players, args.games, args.seedBase, args.gateReserve));
    }
  }
  const rows = [];
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const sp = positionSpread(merged, players);
    if (sp !== null) { rows.push(sp); }
  }
  const worst = rows.reduce((m, r) => Math.max(m, r.spread), 0);
  console.log('位次胜率极差（独赢局口径 · seedBase=' + String(args.seedBase)
    + ' · 每档 ' + String(args.games) + ' 局 · 合计 '
    + String(args.games * args.players.length * args.themes.length) + ' 局）');
  for (const r of rows) {
    console.log('  ' + String(r.players) + ' 人局：' + r.min.toFixed(1) + 'pp ~ ' + r.max.toFixed(1)
      + 'pp ⇒ 极差 ' + r.spread.toFixed(1) + 'pp · RMS ' + r.rms.toFixed(2) + 'pp'
      + (r.monotone ? ' · **严格单调**' : '') + '（独赢局 ' + String(r.soloGames)
      + '/' + String(r.total) + '）');
  }
  const worstRms = rows.reduce((m, r) => Math.max(m, r.rms), 0);
  const monoRows = rows.filter((r) => r.monotone);
  console.log('  最大极差 = ' + worst.toFixed(1) + 'pp · 最大 RMS = ' + worstRms.toFixed(2) + 'pp'
    + ' · 严格单调档位 = ' + (monoRows.length === 0 ? '无' : monoRows.map((r) => String(r.players) + ' 人').join('、')));
  if (args.check) {
    // ⚠️ B25：**确定性回归锁** —— 固定 seed ⇒ 同结果 ⇒ 零 flake；
    //   阈值取该固定 seed 的基线 + 余量（基线：极差 8.6pp · RMS 3.38pp）。
    const problems = [];
    if (worst > POSITION_SPREAD_GATE_LIMIT) {
      problems.push('位次胜率最大极差 ' + worst.toFixed(1) + 'pp 超门禁口径 '
        + String(POSITION_SPREAD_GATE_LIMIT) + 'pp');
    }
    if (worstRms > POSITION_RMS_GATE_LIMIT) {
      problems.push('位次胜率最大 RMS 偏离 ' + worstRms.toFixed(2) + 'pp 超门禁口径 '
        + String(POSITION_RMS_GATE_LIMIT) + 'pp');
    }
    if (problems.length > 0) {
      console.error('FAIL  ' + problems.join('；'));
      process.exit(1);
    }
    console.log('PASS  位次胜率极差在门禁口径内（极差 ≤ ' + String(POSITION_SPREAD_GATE_LIMIT)
      + 'pp · RMS ≤ ' + String(POSITION_RMS_GATE_LIMIT) + 'pp）');
  }
  return { rows, worst };
}

/**
 * **余量阈值扫描**（B27）：对若干 `GATE_RESOURCE_RESERVE` 取值各跑一遍全量模拟 ⇒
 * 打印关键指标（试炼使用率 / 失败后果 / 兜底率 / 平均席位 / 回合 / 异常）⇒ 用来**校准**阈值。
 *
 * ⚠️ 走**生产同一条代码路径**（`advanceAuto` 的 `gateReserve` 注入）⇒ 不另写模拟器副本。
 */
function runGateReserveScan(args) {
  const seeds = args.scanSeeds.length > 0 ? args.scanSeeds : [args.seedBase];
  const perRun = args.games * args.players.length * args.themes.length;
  console.log('余量阈值多 seed 复核（每组 ' + String(args.games) + ' 局/档位 · 合计 ' + String(perRun)
    + ' 局/组 × ' + String(seeds.length) + ' 组独立样本）');
  const table = [];
  for (const reserve of args.scanReserves) {
    const samples = [];
    for (const seedBase of seeds) {
      const cells = [];
      for (const themeId of args.themes) {
        const theme = loadTheme(themeId);
        for (const players of args.players) {
          cells.push(...runCell(theme, players, args.games, seedBase, reserve));
        }
      }
      const st = summarize(cells);
      const draws = [...st.trialDraws.values()].reduce((a, b) => a + b, 0);
      samples.push({
        seedBase,
        perK: (draws / Math.max(1, st.total)) * 1000,
        failed: st.trialFailed,
        passedAfterFail: st.failButPassed,
        fallback: st.noSeatFallbackRate * 100,
        seats: st.avgSeats,
        rounds: st.avgRounds,
        anomalies: st.anomalies,
      });
    }
    table.push({ reserve, samples });
  }
  // ⚠️ B34：**各组原始统计量**落盘 ⇒ 离线回归（门 ⑬）据此**直接重算** Welch t 与精确临界值，
  //   不再依赖报告里**已舍入**的「均值 ± σ」⇒ 消除舍入误差。
  if (args.scanJson !== null) {
    const payload = {
      tool: 'node tests/sim/run.mjs --scan-reserves <...> --scan-seeds <...> --scan-json <path>',
      seeds,
      gamesPerGroup: args.games * args.players.length * args.themes.length,
      groups: table.flatMap((t) => t.samples.map((s) => ({ reserve: t.reserve, ...s }))),
    };
    writeFileSync(resolve(ROOT, args.scanJson), JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log('各组原始统计量 → ' + args.scanJson);
  }
  const mean = (t, k) => t.samples.reduce((a, s) => a + s[k], 0) / t.samples.length;
  const sd = (t, k) => {
    const v = t.samples.map((s) => s[k]);
    const mu = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mu) * (b - mu), 0) / v.length);
  };
  // ⚠️ B30：**95% 置信区间**（均值 ± 1.96σ/√n）—— σ 越小 ⇒ CI 越窄 ⇒ 判定越锐。
  const ci95 = (t, k) => 1.96 * sd(t, k) / Math.sqrt(t.samples.length);
  console.log('| 余量 | 组数 | 每组局数 | 试炼/千局 | 失败 | 失败后仍通过 | 兜底率（均值±σ · 95%CI） | 平均席位（均值±σ · 95%CI） | 平均回合 | 异常 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of table) {
    console.log('| ' + String(t.reserve) + ' | ' + String(t.samples.length) + ' | ' + String(perRun)
      + ' | ' + mean(t, 'perK').toFixed(1) + ' ± ' + sd(t, 'perK').toFixed(1)
      + ' | ' + mean(t, 'failed').toFixed(0) + ' ± ' + sd(t, 'failed').toFixed(0)
      + ' | ' + mean(t, 'passedAfterFail').toFixed(0) + ' ± ' + sd(t, 'passedAfterFail').toFixed(0)
      + ' | ' + mean(t, 'fallback').toFixed(2) + '% ± ' + sd(t, 'fallback').toFixed(2) + 'pp ± ' + ci95(t, 'fallback').toFixed(2) + 'pp'
      + ' | ' + mean(t, 'seats').toFixed(3) + ' ± ' + sd(t, 'seats').toFixed(3) + ' ± ' + ci95(t, 'seats').toFixed(3)
      + ' | ' + mean(t, 'rounds').toFixed(2) + ' ± ' + sd(t, 'rounds').toFixed(2)
      + ' | ' + t.samples.reduce((a, s) => a + s.anomalies, 0) + ' |');
  }
  // ⚠️ B28：**差异 vs 噪声** —— 相邻取值的差异若落在 2σ 内 ⇒ 统计上**不可区分** ⇒ 取值选择稳健。
  const base = table.find((t) => t.reserve === 2) ?? table[0];
  if (base !== undefined) {
    console.log('');
    console.log('与余量 2 的差异（**唯一判定口径：Welch t + 95% CI**；2σ 近似仅并列参考）：');
    for (const t of table) {
      if (t === base) { continue; }
      const dF = Math.abs(mean(t, 'fallback') - mean(base, 'fallback'));
      const nF = Math.sqrt(sd(t, 'fallback') ** 2 + sd(base, 'fallback') ** 2);
      const dS = Math.abs(mean(t, 'seats') - mean(base, 'seats'));
      const nS = Math.sqrt(sd(t, 'seats') ** 2 + sd(base, 'seats') ** 2);
      // ⚠️ B30：**Welch t 检验**（不假设等方差）⇒ 比「合并噪声 2σ」更规范地判显著性。
      //   t = |均值差| / √(σA²/nA + σB²/nB)；df = nA + nB − 2 = 18（10 组/取值时）。
      const welch = (k) => {
        const na = t.samples.length;
        const nb = base.samples.length;
        const se = Math.sqrt(sd(t, k) ** 2 / na + sd(base, k) ** 2 / nb);
        return { tv: se > 0 ? Math.abs(mean(t, k) - mean(base, k)) / se : 0, df: na + nb - 2 };
      };
      // ⚠️ B33：本地**查表近似**已移除 ⇒ 临界值的唯一来源是引擎侧精确实现 `tCritical05`。
      // ⚠️ B32/B33：临界值**唯一来源** = 引擎侧精确实现 `tCritical05`（`engine/core/balance.ts`）。
      const tCrit05 = (df) => tCritical05(df);
      // ⚠️ B31：**Welch–Satterthwaite 自由度**（不等方差时的正规做法，不等于 nA+nB−2）。
      const welchDf = (a, b, k) => {
        const na = a.samples.length;
        const nb = b.samples.length;
        const va = (sd(a, k) ** 2) / na;
        const vb = (sd(b, k) ** 2) / nb;
        const den = (va * va) / (na - 1) + (vb * vb) / (nb - 1);
        return den > 0 ? ((va + vb) ** 2) / den : na + nb - 2;
      };
      const wF = welch('fallback');
      const wS = welch('seats');
      // ⚠️ B32：df **不取整**（保留 Welch–Satterthwaite 的小数自由度）⇒ 临界值可精确求。
      const dfF = welchDf(t, base, 'fallback');
      const dfS = welchDf(t, base, 'seats');
      const cF = tCrit05(dfF);
      const cS = tCrit05(dfS);
      console.log('  余量 ' + String(t.reserve) + ' vs 2：'
        + '兜底率差 ' + dF.toFixed(2) + 'pp ⇒ Welch |t|=' + wF.tv.toFixed(2) + '（df≈' + String(dfF)
        + '，临界 ' + String(cF) + '）' + (wF.tv >= cF ? ' **显著**' : ' 不显著')
        + '〔2σ 参考：噪声 ' + nF.toFixed(2) + 'pp〕· '
        + '平均席位差 ' + dS.toFixed(3) + ' ⇒ Welch |t|=' + wS.tv.toFixed(2) + '（df≈' + String(dfS)
        + '，临界 ' + String(cS) + '）' + (wS.tv >= cS ? ' **显著**' : ' 不显著')
        + '〔2σ 参考：噪声 ' + nS.toFixed(3) + '〕');
    }
  }
}

// ---------- 主流程 ----------
const args = parseArgs(process.argv.slice(2));
// ⚠️ B56：**默认关闭** ⇒ 只有显式给了 `--record-decisions` 才启用记录器。
if (args.record !== null) { recorder = []; }
// ⚠️ B23：定向长跑模式（通过率专项平衡）—— 独立于全量模拟，提前分流。
if (args.trialRate) {
  runTrialRate(args);
  process.exit(0);
}
// ⚠️ B25：位次胜率极差专项（§9.2）—— 独立于全量模拟，提前分流。
if (args.positionSpread) {
  runPositionSpread(args);
  process.exit(0);
}
// ⚠️ B27：余量阈值扫描 —— 独立于全量模拟，提前分流。
if (args.scanReserves.length > 0) {
  runGateReserveScan(args);
  process.exit(0);
}
const cells = [];
const perTheme = new Map();
/** 主题 × 人数 → 该档结果（缓存：报告的分组表格直接复用，避免重复模拟） */
const perCell = new Map();
for (const themeId of args.themes) {
  const theme = loadTheme(themeId);
  // B23：理论期望（骰子型试炼）—— 由主题包数据派生，不手抄
  for (const t of theme.trials ?? []) {
    allTrialIds.add(t.id);
    const pred = t.effects?.[0]?.pred;
    if (pred?.kind === 'dice_is_at_least') {
      const faces = pred.faces ?? 20;
      const amount = pred.amount ?? 0;
      trialTheory.set(t.id, ((faces - amount + 1) / faces) * 100);
    }
  }
  const themeCells = [];
  for (const players of args.players) {
    const rs = runCell(theme, players, args.games, args.seedBase, args.gateReserve);
    perCell.set(themeId + ':' + players, rs);
    themeCells.push(...rs);
    cells.push(...rs);
  }
  perTheme.set(themeId, themeCells);
}
// ⚠️ B56：**决策点记录器**落盘（位置：主题循环之后、`summarize` 之前 ——
//   与计划一致 ⇒ 记录的是**全部**主题 × 人数档位的决策点）。
//   ⚠️ 默认关闭 ⇒ 不带 `--record-decisions` 时**不产出任何文件**、**不改变报告**。
if (args.record !== null && recorder !== null) {
  const lines = recorder.map((r) => JSON.stringify(r));
  writeFileSync(args.record, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');
  console.log('决策点记录：' + lines.length + ' 条 → ' + args.record);
}

const summary = summarize(cells);

console.log('== 创界山·活人认证 规模与平衡模拟 ==');
console.log('主题 ' + args.themes.length + ' 套 · 人数档 ' + args.players.join('/') + ' · 每档 ' + args.games + ' 局 · 合计 ' + summary.total + ' 局');
console.log('无人封顶兜底率 ' + (summary.noSeatFallbackRate * 100).toFixed(1) + '% · 席位制结算 ' + summary.seatSettled + ' · 平均席位数 ' + summary.avgSeats.toFixed(2) + ' · 无胜者 ' + summary.noWinner + ' · 平均回合 ' + summary.avgRounds.toFixed(1));
console.log('异常 ' + summary.anomalies + ' 条');
for (const s of summary.anomalySamples) { console.log('  ! ' + s); }

if (args.out !== null) {
  const lines = [];
  lines.push('# 平衡报告（自动生成）');
  lines.push('');
  lines.push('> 由 `node tests/sim/run.mjs` 生成；规格 §9.2 验收口径：兜底触发率 < 15%，胜率偏离 > 15pp 的项须记录在案。');
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push('| 主题数 | ' + args.themes.length + ' |');
  lines.push('| 人数档位 | ' + args.players.join(' / ') + ' |');
  lines.push('| 每档局数 | ' + args.games + ' |');
  lines.push('| 总局数 | ' + summary.total + ' |');
  lines.push('| **无人封顶兜底率** | **' + (summary.noSeatFallbackRate * 100).toFixed(1) + '%**（门槛 < 25%） |');
  lines.push('| 席位制结算局数 | ' + summary.seatSettled + ' |');
  lines.push('| 无胜者局数 | ' + summary.noWinner + ' |');
  lines.push('| 平均回合数 | ' + summary.avgRounds.toFixed(1) + ' |');
  lines.push('| **每局平均席位数** | **' + summary.avgSeats.toFixed(2) + '** |');
  lines.push('| **对峙次数** | **' + summary.duelTotal + '**（每百局 ' + ((summary.duelTotal / Math.max(1, summary.total)) * 100).toFixed(2) + '） |');
  lines.push('| 无席位局数 | ' + summary.gamesWithoutSeat + ' |');
  lines.push('| **异常条数** | **' + summary.anomalies + '**（门槛 0） |');
  lines.push('');
  lines.push('## 分主题 · 分人数档');
  lines.push('');
  lines.push('| 主题 | 人数 | 局数 | 无人封顶率 | 平均席位数 | 平均回合 | 异常 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    for (const players of args.players) {
      const rs = perCell.get(themeId + ':' + players) ?? [];
      const st = summarize(rs);
      lines.push('| ' + theme.meta.name + ' | ' + players + ' | ' + st.total + ' | '
        + (st.noSeatFallbackRate * 100).toFixed(1) + '% | ' + st.avgSeats.toFixed(2) + ' | '
        + st.avgRounds.toFixed(1) + ' | ' + st.anomalies + ' |');
    }
  }
  lines.push('');
  lines.push('## 身份胜率（分主题）');
  lines.push('');
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    const st = summarize(perTheme.get(themeId) ?? []);
    lines.push('### ' + theme.meta.name);
    lines.push('');
    lines.push('| 身份 | 胜场 | 胜率 | 偏离均匀分布 |');
    lines.push('|---|---|---|---|');
    const winTotal = [...st.identityWin.values()].reduce((a, b) => a + b, 0);
    const even = 1 / theme.identities.length;
    for (const id of theme.identities) {
      const w = st.identityWin.get(id.id) ?? 0;
      const rate = winTotal > 0 ? w / winTotal : 0;
      const dev = (rate - even) * 100;
      const flag = Math.abs(dev) > 15 ? ' ⚠️ 偏离 > 15pp（须记录在案并讨论）' : '';
      lines.push('| ' + id.name + ' | ' + w + ' | ' + (rate * 100).toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp' + flag + ' |');
    }
    lines.push('');
  }
  lines.push('## 阵营胜率（分主题）');
  lines.push('');
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    const st = summarize(perTheme.get(themeId) ?? []);
    lines.push('### ' + theme.meta.name);
    lines.push('');
    lines.push('| 阵营 | 胜场 | 胜率 | 偏离均匀分布 |');
    lines.push('|---|---|---|---|');
    const winTotal = [...st.factionWin.values()].reduce((a, b) => a + b, 0);
    const even = 1 / theme.factions.length;
    for (const f of theme.factions) {
      const w = st.factionWin.get(f.id) ?? 0;
      const rate = winTotal > 0 ? w / winTotal : 0;
      const dev = (rate - even) * 100;
      const flag = Math.abs(dev) > 15 ? ' ⚠️ 偏离 > 15pp（须记录在案并讨论）' : '';
      lines.push('| ' + f.name + ' | ' + w + ' | ' + (rate * 100).toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp' + flag + ' |');
    }
    lines.push('');
  }
  lines.push('## 分析要点');
  lines.push('');
  lines.push('- **无人封顶兜底率**（B11）：席位制下「达到回合上限」是**正常结局**，故原「兜底触发率」改为「**无人取得任何席位**的局占比」——过高说明签印门槛或山道长度失衡（规格 §9.2）。');
  lines.push('- **活人席分布**（B11）：每局平均席位数反映认证流程的通畅度；席位越充足，先登顶者的领先越容易被追平 ⇒ 先手优势越弱。');
  lines.push('- **身份/阵营胜率**：身份与阵营**开局随机分配**（固定 seed 可复现）⇒ 胜率差异只剩「机制强度」；');
  lines.push('  单项偏离均匀分布未超 15pp 时不触发记录线。');
  lines.push('- **主题间一致性**：四套主题共享通用卡牌池（效果逐字相同），胜率分布应当几乎重合；差异只来自 2 张标志卡与文案。');
  lines.push('- **行动顺序随机化（B10）**：行动顺序在开局**随机决定**，整局沿用 ⇒ 「先手」不再绑定任何固定座位。');
  lines.push('  「按行动顺序位次」表是先手优势的直接读数，「按座位胜率」表是座位与胜率是否解耦的读数。');
  lines.push('  **B11 席位制**后「先登顶」只领先 1 席 ⇒ 位次胜率应趋于均匀（验收口径：极差 < 4pp）。');
  lines.push('- **模拟 AI 偏置**：AI 优先登顶、认证人倾向签印 ⇒ 放大「先登顶 = 先赢」的优势；真人对局的认证是社交博弈，读数须打折。');
  lines.push('');
  lines.push('## 按行动顺序位次的胜率（检验「先行动优势」是否已消除）');
  lines.push('');
  lines.push('> **口径说明**：位次 = 该玩家在本局**开局随机行动顺序**中的位置（位次 1 = 每回合最先行动）。',
    '> 这是「先手优势」的**直接度量**，比座位胜率锐利 —— 座位胜率会被身份/阵营等其它因素稀释，',
    '> 而位次胜率只反映「先行动」本身。');
  lines.push('');
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const st = summarize(merged);
    const winTotal = [...st.posWin.values()].reduce((a, b) => a + b, 0);
    const even = 100 / players;
    lines.push('### ' + players + ' 人局（合并 ' + args.themes.length + ' 套主题 · ' + st.total + ' 局 · 均匀基准 ' + even.toFixed(1) + '%）');
    lines.push('');
    lines.push('| 位次 | 胜场 | 胜率 | 偏离均匀 |');
    lines.push('|---|---|---|---|');
    for (let pos = 0; pos < players; pos++) {
      const w = st.posWin.get(pos) ?? 0;
      const rate = winTotal > 0 ? (w / winTotal) * 100 : 0;
      const dev = rate - even;
      lines.push('| 第' + (pos + 1) + ' 位 | ' + w + ' | ' + rate.toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp |');
    }
    lines.push('');
  }
  lines.push('## 先手优势的传导路径（先动 → 先登顶 → 先认证 → 先终局）');
  lines.push('');
  lines.push('> 逐环转化率。「位次 1 成为首个登顶者」低 ⇒ 先动者并不必然先登顶；');
  lines.push('> 「首个登顶者成为获胜者」高 ⇒ 登顶先后**直接决定**胜负（认证轮次错位把「先动」放大成「先赢」）。');
  lines.push('');
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const st = summarize(merged);
    const denom = st.chain.withPeak > 0 ? st.chain.withPeak : 1;
    lines.push('### ' + players + ' 人局');
    lines.push('');
    lines.push('| 环节 | 数值 | 含义 |');
    lines.push('|---|---|---|');
    lines.push('| 位次 1 成为**首个登顶者** | ' + ((st.chain.firstIsPos0 / denom) * 100).toFixed(1) + '% | 先动者并不必然先登顶（随机行棋稀释先后差异） |');
    lines.push('| **首个登顶者**最终获胜 | ' + ((st.chain.firstIsWinner / denom) * 100).toFixed(1) + '% | 登顶先后**直接决定**胜负 ⇒ 认证轮次错位把「先动」放大成「先赢」 |');
    lines.push('| 首个登顶者的平均登顶轮次 | ' + (st.chain.peakRoundSum / denom).toFixed(1) + ' | |');
    lines.push('');
  }
  lines.push('## 按座位胜率（检验「座位」与胜率是否已解耦）');
  lines.push('');
  lines.push('> **口径说明**：座位胜率**只能在同一人数档位内比较** —— 座 3 只出现在 4 人以上的局，',
    '> 跨档位汇总会把「该座位出现的局数」混进分母，读数无意义。');
  lines.push('');
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const st = summarize(merged);
    const winTotal = [...st.seatWin.values()].reduce((a, b) => a + b, 0);
    const even = 100 / players;
    lines.push('### ' + players + ' 人局（合并 ' + args.themes.length + ' 套主题 · ' + st.total + ' 局 · 均匀基准 ' + even.toFixed(1) + '%）');
    lines.push('');
    lines.push('| 座位 | 胜场 | 胜率 | 偏离均匀 |');
    lines.push('|---|---|---|---|');
    for (let seat = 0; seat < players; seat++) {
      const w = st.seatWin.get(seat) ?? 0;
      const rate = winTotal > 0 ? (w / winTotal) * 100 : 0;
      const dev = rate - even;
      lines.push('| 座' + seat + ' | ' + w + ' | ' + rate.toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp |');
    }
    lines.push('');
  }
  lines.push('## 仅单人获胜局（剔除「并列封顶」的口径影响）');
  lines.push('');
  lines.push('> **为什么要剔除**：`certificationThreshold` 在「两人以上同时待认证」时只需 1 个签印，',
    '> 且达标的待认证者**同时封顶、并列获胜** ⇒ 总胜场口径会把同一场胜利计给每个并列者，',
    '> 进而扭曲座位/位次胜率。下表只统计**独赢**的局。');
  lines.push('');
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const st = summarize(merged);
    const even = 100 / players;
    lines.push('### ' + players + ' 人局（独赢局 ' + st.soloGames + ' / ' + st.total + '）');
    lines.push('');
    lines.push('| 座位 | 独赢场次 | 独赢率 | 偏离均匀 |');
    lines.push('|---|---|---|---|');
    const seatTotal = [...st.soloSeatWin.values()].reduce((a, b) => a + b, 0);
    for (let seat = 0; seat < players; seat++) {
      const w = st.soloSeatWin.get(seat) ?? 0;
      const rate = seatTotal > 0 ? (w / seatTotal) * 100 : 0;
      const dev = rate - even;
      lines.push('| 座' + seat + ' | ' + w + ' | ' + rate.toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp |');
    }
    lines.push('');
    lines.push('| 位次 | 独赢场次 | 独赢率 | 偏离均匀 |');
    lines.push('|---|---|---|---|');
    const posTotal = [...st.soloPosWin.values()].reduce((a, b) => a + b, 0);
    for (let pos = 0; pos < players; pos++) {
      const w = st.soloPosWin.get(pos) ?? 0;
      const rate = posTotal > 0 ? (w / posTotal) * 100 : 0;
      const dev = rate - even;
      lines.push('| 第' + (pos + 1) + ' 位 | ' + w + ' | ' + rate.toFixed(1) + '% | '
        + (dev >= 0 ? '+' : '') + dev.toFixed(1) + 'pp |');
    }
    lines.push('');
  }
  lines.push('### 试炼失败的后果（B27）');
  lines.push('');
  lines.push('> **口径**：玩家 flags —— 试炼失败 ⇒ 写 `gate_pay_<N>`（本关改为付费）；其后**最终通过** ⇒ `gate_<N>`（**掏空余量仍过关**）；**被放行** ⇒ `gate_fail_<N>`。');
  lines.push('> 这是余量规则的**真实代价**：为保留余量而试炼，失败后往往照样要付费 ⇒ 余量归零。');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push('| 试炼失败次数 | ' + String(summary.trialFailed) + ' |');
  lines.push('| 失败后仍通过（掏空余量） | ' + String(summary.failButPassed) + ' |');
  lines.push('| 失败后被放行 | ' + String(summary.failReleased) + ' |');
  lines.push('');
  lines.push('## 位次胜率极差（§9.2 验收口径）');
  lines.push('');
  lines.push('> **口径**：**独赢局**口径下按人数档分组的位次胜率极差（max−min，pp）。');
  lines.push('> **为什么单列**：先手优势是**位次**的直接度量；座位胜率会被身份等因素稀释 ⇒ 不可用它代理。');
  lines.push('> **为什么按人数档分组**：不同人数的位次个数不同 ⇒ 极差不可跨档直接比（8 人局天然更大）。');
  lines.push('');
  lines.push('| 人数档 | 独赢局 / 总局数 | 最小偏离 | 最大偏离 | 极差 | RMS 偏离 | 严格单调 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const players of args.players) {
    const merged = [];
    for (const themeId of args.themes) {
      merged.push(...(perCell.get(themeId + ':' + players) ?? []));
    }
    const sp = positionSpread(merged, players);
    if (sp === null) { continue; }
    lines.push('| ' + String(players) + ' 人 | ' + String(sp.soloGames) + ' / ' + String(sp.total)
      + ' | ' + sp.min.toFixed(1) + 'pp | ' + sp.max.toFixed(1) + 'pp | **' + sp.spread.toFixed(1)
      + 'pp** | ' + sp.rms.toFixed(2) + 'pp | ' + (sp.monotone ? '是' : '否') + ' |');
  }
  lines.push('');
  lines.push('## 活人席分布（B11 计分制）');
  lines.push('');
  lines.push('> **口径**：每局发放的活人席总数（认证通过一次 = 1 席，可重复获取；封顶后回到山道起点）。');
  lines.push('');
  lines.push('| 每局席位数 | 局数 | 占比 |');
  lines.push('|---|---|---|');
  for (const k of [...summary.seatDist.keys()].sort((a, b) => a - b)) {
    const n = summary.seatDist.get(k) ?? 0;
    lines.push('| ' + k + ' 席 | ' + n + ' | ' + ((n / summary.total) * 100).toFixed(1) + '% |');
  }
  lines.push('');
  lines.push('| 冠军席位数 | 局数 | 占比 |');
  lines.push('|---|---|---|');
  for (const k of [...summary.champSeatDist.keys()].sort((a, b) => a - b)) {
    const n = summary.champSeatDist.get(k) ?? 0;
    lines.push('| ' + k + ' 席 | ' + n + ' | ' + ((n / summary.total) * 100).toFixed(1) + '% |');
  }
  lines.push('## 身份被动触发统计（B12 可达性证据）');
  lines.push('');
  lines.push('> **口径**：每局日志中 `[被动:<op>]` 前缀的记录数（主动型与自动型同格式）。',
    '> 织梦者计**发动 + 生效**两次（改判定在险径结算时消费）；其余被动一次发动记一次。');
  lines.push('> **这是「机制真实存在」的证据** —— 此前 7 个被动的 op 只出现在主题包里、**引擎无消费点**，',
    '> 永不触发（机制看着实现、实际是死代码）；B12 补齐触发点后，每个被动在真实对局中都会出现。');
  lines.push('');
  lines.push('| 被动 | op | 触发次数 | 触发过的局数 | 每百局触发次数 |');
  lines.push('|---|---|---|---|---|');
  const PASSIVE_LABELS = {
    move_forward: '开拓者 · 首次移动 +1 格',
    create_card: '匠师 · 免费造物',
    peek_deck: '观星者 · 看牌堆顶',
    shield: '守夜人 · 回合末护盾',
    transfer_resource: '窃火者 · 偷灵枢',
    modify_judgement: '织梦者 · 改险径判定',
    certify_free_pass: '山主 · 免质疑',
  };
  for (const op of Object.keys(PASSIVE_LABELS)) {
    const n = summary.abilityOps.get(op) ?? 0;
    const g = summary.abilityGames.get(op) ?? 0;
    lines.push('| ' + PASSIVE_LABELS[op] + ' | `' + op + '` | ' + n + ' | ' + g + ' | '
      + ((n / summary.total) * 100).toFixed(1) + ' |');
  }
  lines.push('');  lines.push('## 对峙统计（B13 可达性证据）');
  lines.push('');
  lines.push('> **口径**：日志中 `kind=duel` 的记录数（规格 §3.3：同格相遇 → 亮牌对峙）。');
  lines.push('> **此前对峙完全不可达** —— 引擎里只有一个无人调用的半成品 op `compare_cards`，',
    '> 且语义与规格不符（它把对手的牌抢过来，而规格是败者抽 1 张牌）。B13 落地后对峙才真正发生。');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|---|---|');
  lines.push('| 对峙总次数 | ' + summary.duelTotal + ' |');
  lines.push('| 发生对峙的局数 | ' + summary.duelGames + ' / ' + summary.total + ' |');
  lines.push('| 每百局对峙次数 | ' + ((summary.duelTotal / Math.max(1, summary.total)) * 100).toFixed(2) + ' |');
  lines.push('');
  lines.push('## 关隘试炼统计（B23 通过率专项指标）');
  lines.push('');
  lines.push('> **口径**：日志中 `kind=trial` 的条目（结构化字段 `trialId` / `trialPassed`，**不解析文案**）。');
  lines.push('> **抽取次数** = 试炼通道抽到该牌的次数；**通过率** = 通过次数 / 抽取次数。');
  lines.push('> **理论期望** = `(faces - amount + 1) / faces`（骰子型试炼；由主题包数据派生）。');
  lines.push('');
  lines.push('> ⚠️ **样本量说明**：真实对局里试炼是**偶发事件**（AI 策略「灵枢够就付费」）⇒ 抽取次数很少 ⇒');
  lines.push('> 本表只作**可达性证据**（哪张牌被真正抽到过、哪些牌一次都没出现），**不作硬阈值**；');
  lines.push('> 精确判据见**定向长跑**（`node tests/sim/run.mjs --trial-rate` ⇒ 报告 `docs/trial-pass-rate.md`）。');
  lines.push('');
  lines.push('| 试炼牌 | 抽取次数 | 通过次数 | 通过率 | 触发过的局数 | 每千局抽取 | 理论期望 | 偏差 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const id of [...allTrialIds].sort()) {
    const draws = summary.trialDraws.get(id) ?? 0;
    const passes = summary.trialPasses.get(id) ?? 0;
    const games = summary.trialGames.get(id) ?? 0;
    const rate = draws > 0 ? (passes / draws) * 100 : 0;
    const th = trialTheory.get(id);
    const thTxt = th === undefined ? '—' : th.toFixed(1) + '%';
    const dev = (th === undefined || draws === 0) ? '—'
      : (rate - th >= 0 ? '+' : '') + (rate - th).toFixed(1) + 'pp';
    const rateTxt = draws > 0 ? rate.toFixed(1) + '%' : '—';
    const perK = summary.total > 0 ? (draws / summary.total) * 1000 : 0;
    lines.push('| `' + id + '` | ' + draws + ' | ' + passes + ' | ' + rateTxt + ' | '
      + games + ' | ' + perK.toFixed(3) + ' | ' + thTxt + ' | ' + dev + ' |');
  }
  lines.push('');
  writeFileSync(resolve(ROOT, args.out), lines.join('\n') + '\n', 'utf8');
  console.log('报告 → ' + args.out);
}

if (args.check) {
  const problems = [];
  if (summary.anomalies > 0) { problems.push('异常 ' + summary.anomalies + ' 条'); }
  if (summary.noSeatFallbackRate >= 0.25) {
    problems.push('无人封顶兜底率 ' + (summary.noSeatFallbackRate * 100).toFixed(1) + '% ≥ 25%');
  }
  // ⚠️ B13：**对峙可达性**（门禁第 10 道的负样本锚点）——
  //   引擎若丢了对峙的消费点，对峙次数会恒为 0 ⇒ 这里必红。
  if (summary.duelTotal <= 0) {
    problems.push('对峙在真实对局中从未发生（对峙消费点可能已丢失）');
  }
  // ⚠️ B24：**试炼通道可达性** —— 每张试炼牌都必须在真实对局中被抽到过。
  //   B23 实测：AI「灵枢够就付费」⇒ 24000 局仅 9 次 ⇒ 12 张里 6 张一次都没出现（机制形同虚设）。
  //   B24 的余量规则把使用率提上来 ⇒ 这里锁住「每张牌都被抽到过」，防策略再退化。
  const unseen = [...allTrialIds].filter((id) => (summary.trialDraws.get(id) ?? 0) <= 0);
  if (allTrialIds.size === 0) {
    problems.push('未找到任何试炼牌（主题包数据异常）');
  } else if (unseen.length > 0) {
    problems.push('以下试炼牌在真实对局中一次都没被抽到：' + unseen.join('、'));
  }
  // ⚠️ B27：**挑战型必须真的会失败** —— 试炼若从无失败 ⇒ 已退化为「永远通过」（B26 的老问题复发）。
  if (summary.trialFailed <= 0) {
    problems.push('试炼在真实对局中从未失败（挑战型可能已退化为「永远通过」）');
  }
  if (problems.length > 0) {
    console.error('FAIL  ' + problems.join('；'));
    process.exit(1);
  }
  console.log('PASS  规模与平衡冒烟通过（异常 0 · 无人封顶兜底率 < 25%）');
}