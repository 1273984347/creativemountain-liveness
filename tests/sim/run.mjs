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

/** 挑一个默认出牌目标：除自己外位置最高的存活玩家。 */
function pickTarget(s, seat) {
  const others = s.players.filter((p) => p.alive && p.seat !== seat);
  if (others.length === 0) { return undefined; }
  let best = others[0];
  for (const p of others) {
    if (best !== undefined && p.position > best.position) { best = p; }
  }
  return best === undefined ? undefined : best.seat;
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

/** 跑一局，返回该局的统计与异常。 */
function playOne(theme, players, seed) {
  const base = createInitialState({ players, seed, deckSize: theme.counts.deckTotal });
  let s = installTheme(base, theme);
  const anomalies = [];
  const maxSteps = s.scales.globalRoundLimit * players * 8 + 200;
  let steps = 0;
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
      s = advanceTurn(s, 'standard');
      continue;
    }
    const roll = s.rng.next();
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
    s = advanceTurn(s, 'standard');
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
    certRound: s.certification.round,
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
  const certRounds = new Map();
  let total = 0;
  let fallback = 0;
  let certified = 0;
  let noWinner = 0;
  let roundSum = 0;
  let anomalies = 0;
  const anomalySamples = [];
  for (const c of cells) {
    total += 1;
    roundSum += c.rounds;
    if (c.reason === 'fallback') { fallback += 1; }
    else if (c.reason === 'certified') { certified += 1; }
    else { noWinner += 1; }
    if (c.anomalies.length > 0) {
      anomalies += c.anomalies.length;
      if (anomalySamples.length < 5) { anomalySamples.push(c.anomalies[0]); }
    }
    for (const w of c.winners) {
      const id = c.identities[w];
      const f = c.factions[w];
      if (id !== undefined) { identityWin.set(id, (identityWin.get(id) ?? 0) + 1); }
      if (f !== undefined) { factionWin.set(f, (factionWin.get(f) ?? 0) + 1); }
    }
    if (c.reason === 'certified') {
      const k = '第' + c.certRound + '轮';
      certRounds.set(k, (certRounds.get(k) ?? 0) + 1);
    }
  }
  return {
    total, fallback, certified, noWinner, anomalies, anomalySamples,
    fallbackRate: total > 0 ? fallback / total : 0,
    avgRounds: total > 0 ? roundSum / total : 0,
    identityWin, factionWin, certRounds,
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
console.log('兜底触发率 ' + (summary.fallbackRate * 100).toFixed(1) + '% · 认证达成 ' + summary.certified + ' · 无胜者 ' + summary.noWinner + ' · 平均回合 ' + summary.avgRounds.toFixed(1));
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
  lines.push('| **兜底触发率** | **' + (summary.fallbackRate * 100).toFixed(1) + '%**（门槛 < 15%） |');
  lines.push('| 认证达成局数 | ' + summary.certified + ' |');
  lines.push('| 无胜者局数 | ' + summary.noWinner + ' |');
  lines.push('| 平均回合数 | ' + summary.avgRounds.toFixed(1) + ' |');
  lines.push('| **异常条数** | **' + summary.anomalies + '**（门槛 0） |');
  lines.push('');
  lines.push('## 分主题 · 分人数档');
  lines.push('');
  lines.push('| 主题 | 人数 | 局数 | 兜底率 | 认证达成 | 平均回合 | 异常 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const themeId of args.themes) {
    const theme = loadTheme(themeId);
    for (const players of args.players) {
      const rs = perCell.get(themeId + ':' + players) ?? [];
      const st = summarize(rs);
      lines.push('| ' + theme.meta.name + ' | ' + players + ' | ' + st.total + ' | '
        + (st.fallbackRate * 100).toFixed(1) + '% | ' + st.certified + ' | '
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
  lines.push('- **兜底触发率**：多数局在回合上限内分出胜负；超过 15% 说明门槛或山道长度需要回调（规格 §9.2）。');
  lines.push('- **身份/阵营胜率**：注意**身份与阵营按座位轮转分配**，胜率差异同时包含「座位顺序优势」与「机制强度」两项；');
  lines.push('  单项偏离均匀分布未超 15pp 时不触发记录线，但沿座位顺序的**单调性**仍值得在 V1.1 评估（随机分配身份可打散）。');
  lines.push('- **主题间一致性**：四套主题共享通用卡牌池（效果逐字相同），胜率分布应当几乎重合；差异只来自 2 张标志卡与文案。');
  lines.push('- **模拟 AI 偏置**：AI 优先登顶、认证人倾向签印 ⇒ 放大「先登顶 = 先赢」的座位优势；真人对局的认证是社交博弈，读数须打折。');
  lines.push('');
  lines.push('## 认证轮次分布');
  lines.push('');
  lines.push('| 主题 | 第 1 轮达成 | 第 2 轮达成 |');
  lines.push('|---|---|---|');
  for (const themeId of args.themes) {
    const st = summarize(perTheme.get(themeId) ?? []);
    lines.push('| ' + themeId + ' | ' + (st.certRounds.get('第1轮') ?? 0) + ' | ' + (st.certRounds.get('第2轮') ?? 0) + ' |');
  }
  writeFileSync(resolve(ROOT, args.out), lines.join('\n') + '\n', 'utf8');
  console.log('报告 → ' + args.out);
}

if (args.check) {
  const problems = [];
  if (summary.anomalies > 0) { problems.push('异常 ' + summary.anomalies + ' 条'); }
  if (summary.fallbackRate >= 0.15) {
    problems.push('兜底触发率 ' + (summary.fallbackRate * 100).toFixed(1) + '% ≥ 15%');
  }
  if (problems.length > 0) {
    console.error('FAIL  ' + problems.join('；'));
    process.exit(1);
  }
  console.log('PASS  规模与平衡冒烟通过（异常 0 · 兜底率 < 15%）');
}