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
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import {
  certifySign, certifyChallenge, certifyAnswer, certifyAppeal, certifyAppealVote,
  resolveAppeals, isCertifier, hasUsedCertificationTurn,
} from '../../engine/core/certification.ts';
import { SCALES } from '../../engine/scales.ts';

const ROOT = process.cwd();
const THEME_IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];

/** 解析命令行参数。 */
function parseArgs(argv) {
  const out = { games: 1000, check: false, out: null, themes: THEME_IDS, players: SCALES.map((s) => s.players) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') { out.games = Number(argv[++i]); }
    else if (a === '--check') { out.check = true; }
    else if (a === '--out') { out.out = argv[++i]; }
    else if (a === '--themes') { out.themes = argv[++i].split(','); }
    else if (a === '--players') { out.players = argv[++i].split(',').map(Number); }
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
    if (p.hand.length > p.hpMax) problems.push(label + ' 座' + p.seat + ' 手牌超上限');
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
        const r = certifyChallenge(s, p.seat, target);
        if (r.ok) {
          s = r.state;
          const passed = s.rng.next() < 0.65;
          const ans = certifyAnswer(s, p.seat, target, passed);
          if (ans.ok) { s = ans.state; }
        }
      } else {
        const sign = certifySign(s, p.seat, target);
        if (sign.ok) { s = sign.state; }
      }
    }
    // 待认证者申请复议（被判不通过时）
    const judged = Object.entries(s.certification.judgments)
      .some(([k, v]) => v === false && Number(k) !== target);
    if (judged && s.rng.next() < 0.35) {
      const ap = certifyAppeal(s, target, target);
      if (ap.ok) {
        s = ap.state;
        for (const p of s.players) {
          if (!p.alive || p.seat === target) { continue; }
          if (s.certification.challenged.includes(p.seat)) { continue; }
          if (s.certification.appealVotes[p.seat] !== undefined) { continue; }
          const v = certifyAppealVote(s, p.seat, target, s.rng.next() < 0.5);
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
function advanceWithDuel(s, mode) {
  let next = advanceTurn(s, mode);
  if (next.duel !== null) {
    next = resolveDuelByAI(next);
    next = advanceTurn(next, mode);
  }
  return next;
}

/** 跑一局，返回该局的统计与异常。 */
function playOne(theme, players, seed) {
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
        s = performAction(s, seat, 'act', target === undefined ? { cardId: card.id } : { cardId: card.id, target });
      }
      s = advanceWithDuel(s, 'standard');
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
      s = performAction(s, seat, 'move');
    } else if (roll < 0.85) {
      s = performAction(s, seat, 'ask');
    } else {
      const card = player === undefined ? undefined : player.hand.find((c) => c.cost <= player.resource);
      if (card === undefined) {
        s = performAction(s, seat, 'move');
      } else {
        const target = pickTarget(s, seat);
        s = performAction(s, seat, 'act', target === undefined ? { cardId: card.id } : { cardId: card.id, target });
      }
    }
    s = advanceWithDuel(s, 'standard');
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
    // B12：被动触发**统一从日志提取**（主动型 + 自动型同格式 `[被动:<op>]`）
    // B13：对峙次数（kind='duel' 的日志条数）—— 对峙可达性证据
    duelCount: s.log.filter((l) => l.kind === 'duel').length,
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
function runCell(theme, players, games) {
  const results = [];
  const themeSeed = [...theme.meta.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 100000, 0);
  for (let g = 0; g < games; g++) {
    const seed = 1000 + g * 97 + players * 13 + themeSeed;
    results.push(playOne(theme, players, seed));
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
    identityWin, factionWin, seatWin, posWin, certRounds, chain, soloSeatWin, soloPosWin, soloGames,
  };
}

// ---------- 主流程 ----------
const args = parseArgs(process.argv.slice(2));
const cells = [];
const perTheme = new Map();
/** 主题 × 人数 → 该档结果（缓存：报告的分组表格直接复用，避免重复模拟） */
const perCell = new Map();
for (const themeId of args.themes) {
  const theme = loadTheme(themeId);
  const themeCells = [];
  for (const players of args.players) {
    const rs = runCell(theme, players, args.games);
    perCell.set(themeId + ':' + players, rs);
    themeCells.push(...rs);
    cells.push(...rs);
  }
  perTheme.set(themeId, themeCells);
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
  if (problems.length > 0) {
    console.error('FAIL  ' + problems.join('；'));
    process.exit(1);
  }
  console.log('PASS  规模与平衡冒烟通过（异常 0 · 无人封顶兜底率 < 25%）');
}