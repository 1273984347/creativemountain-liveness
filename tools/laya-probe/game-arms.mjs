// tools/laya-probe/game-arms.mjs
// B70：三面两臂评估器。可复跑；**不进门禁**；无服务即 SKIP 退出码 0。
// 用法：先起 node tools/laya-sidecar/up.mjs --weights <权重路径>，再 npm run eval:faces
// ⚠️ 本批只评估不接入：policy 缺省 undefined，sim CLI 无新开关，门 ⑨ 基线未动。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';
import { describeState, buildChoice } from './state-text.mjs';
import { actionKey } from '../../engine/core/action-key.ts';
import { mcnemar, pairWinners, verdictOf } from './face-stats.mjs';

const ROOT = process.cwd();
const PROXY = process.env.LAYA_PROXY_URL ?? 'http://127.0.0.1:8711';
const ALL_FACES = ['play', 'council', 'certify'];
// ⚠️ B73：可只跑指定面（扩样复验用），默认三面全跑；未知面直接拒绝（不静默跳过）。
const FACES = (process.env.B70_FACES ?? ALL_FACES.join(',')).split(',').map((x) => x.trim()).filter((x) => x !== '');
for (const f of FACES) {
  if (!ALL_FACES.includes(f)) { console.error(`未知面：${f}（可用：${ALL_FACES.join(',')}）`); process.exit(2); }
}
// ⚠️ B73：扩样/复验的产物用 `B70_TAG` 分文件，**不覆盖**主表（400 局/臂）与主读数。
const TAG = process.env.B70_TAG ?? '';
const SUFFIX = TAG === '' ? '' : '-' + TAG;
const THEMES = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];
const SEEDS = Number(process.env.B70_SEEDS ?? 100);      // 4 × 100 = 400 局/臂
// ⚠️ B74：扩样复验用独立 seed 基（默认 7000；复现组用 9000）⇒ 两组样本互不重叠。
const SEED_BASE = Number(process.env.B70_SEED_BASE ?? 7000);
const PLAYERS = 4;
const MODEL_SEAT = 0;
// ⚠️ B70 终审 I4：生成物**只能**写到这里，不能写评估报告本体 ——
//   报告里的「结论」段是手写的，脚本覆写会把已入库的人工判断整段冲掉（可复跑与结论文档互不破坏）。
const OUT = `docs/预研/data/b70-face-readings${SUFFIX}.md`;
// 规格 §6 的样本下限；不足 ⇒ 判定固定为「样本不足/未跑满」，**不得**输出三种固定措辞之一
// （B70 终审 Minor 5：`B70_SEEDS` 是环境变量，误设成 20 也会照常出判定）。
const MIN_GAMES_PER_ARM = 400;
const VERDICT_INSUFFICIENT = '样本不足/未跑满（前置自检未通过）';

async function sidecarUp() {
  try { const r = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) }); return r.ok; }
  catch { return false; }
}

/** 模型策略：只回答该面的候选；任何失败返回 null 交给 playOne 回落。 */
function modelPolicy(face, timings) {
  return {
    face, seat: MODEL_SEAT,
    decide: async (state, seat, candidates) => {
      const t0 = performance.now();
      try {
        const q = buildChoice(state, seat);
        const allowed = new Set(candidates.map((c) => actionKey(c)));
        const criteria = Object.fromEntries(Object.entries(q.criteria).filter(([k]) => allowed.has(k)));
        if (Object.keys(criteria).length === 0) { return null; }
        const resp = await fetch(`${PROXY}/v1/systemone`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: describeState(state, seat), questions: { act: { type: 'choice', instructions: q.instructions, criteria } } }),
          signal: AbortSignal.timeout(30000),
        });
        const j = await resp.json();
        const k = j?.answers?.act?.choice ?? null;
        return typeof k === 'string' && allowed.has(k) ? k : null;
      } catch { return null; }
      finally { timings.push(Math.round(performance.now() - t0)); }
    },
  };
}

if (!(await sidecarUp())) {
  console.log('SKIP {"reason":"no-sidecar","hint":"先跑 node tools/laya-sidecar/up.mjs --weights <权重路径>"}');
  process.exit(0);
}

const themeObjs = THEMES.map((id) => JSON.parse(readFileSync(resolve(ROOT, 'themes', id, 'theme.json'), 'utf8')));
const results = [];
for (const face of FACES) {
  const t0 = Date.now();
  const arms = { baseline: [], model: [] };
  const timings = [];
  const inj = {
    calls: 0, fallbacks: 0, emptyCandidates: 0,
    emptyByReason: { unregisteredFace: 0, stationMismatch: 0, noCandidate: 0, narrowedEmpty: 0 },
  };
  let budgetHit = false;
  for (let i = 0; i < SEEDS && !budgetHit; i += 1) {
    const seed = SEED_BASE + i * 31;
    for (const theme of themeObjs) {
      const base = await playOne(theme, PLAYERS, seed);
      arms.baseline.push(base);
      const m = await playOne(theme, PLAYERS, seed, undefined, modelPolicy(face, timings));
      arms.model.push(m);
      inj.calls += m.injection.calls; inj.fallbacks += m.injection.fallbacks; inj.emptyCandidates += m.injection.emptyCandidates;
      for (const [k, v] of Object.entries(m.injection.emptyByReason)) { inj.emptyByReason[k] += v; }
    }
    // ⚠️ B73：预算检查**在每 200 局之间**做（此前只在该面跑完后检查 ⇒ 中途超时无法止损）。
    if (((i + 1) * THEMES.length) % 200 === 0 && (Date.now() - t0) > 30 * 60000) {
      console.error(`面 ${face} 超过 30 分钟预算（已完成 ${String((i + 1) * THEMES.length)} 局/臂），停下报告`);
      budgetHit = true;
    }
  }
  const minutes = (Date.now() - t0) / 60000;
  const wins = (g) => g.filter((x) => Array.isArray(x.winners) && x.winners.includes(MODEL_SEAT)).length;
  const p = pairWinners(arms.baseline.map((g) => g.winners), arms.model.map((g) => g.winners), MODEL_SEAT);
  const stat = mcnemar(p.b, p.c);
  const baseRate = wins(arms.baseline) / arms.baseline.length;
  const modelRate = wins(arms.model) / arms.model.length;
  const sorted = timings.slice().sort((a, b) => a - b);
  const pct = (q) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  // 兜底局 = 终局走「距峰顶格数」兜底结算的局（outcome.reason === 'fallback'），与注入回落无关。
  const fallbackGames = (g) => g.filter((x) => x.reason === 'fallback').length;
  const anomalies = arms.baseline.concat(arms.model).reduce((a, g) => a + (g.anomalies ?? []).length, 0);
  // ⚠️ 前置自检（B70 终审 Minor 5）：先验样本量与异常数，再谈判定
  //   ⇒ 不满足时判定固定为「样本不足/未跑满」，不出三种固定措辞（避免 20 seed 也「出结论」）。
  const preflightOk = arms.baseline.length >= MIN_GAMES_PER_ARM
    && arms.model.length >= MIN_GAMES_PER_ARM && anomalies === 0;
  const verdict = preflightOk
    ? verdictOf({ significant: stat.significant, improved: modelRate > baseRate })
    : VERDICT_INSUFFICIENT;
  const row = {
    face, gamesPerArm: arms.baseline.length, seeds: SEEDS, players: PLAYERS, themes: THEMES,
    baselineSeat0Wins: wins(arms.baseline), modelSeat0Wins: wins(arms.model),
    baselineWinRate: Number(baseRate.toFixed(4)), modelWinRate: Number(modelRate.toFixed(4)),
    improved: modelRate > baseRate, ...p, ...stat,
    changedRate: Number((p.changed / Math.max(1, p.paired)).toFixed(4)),
    preflight: { minGamesPerArm: MIN_GAMES_PER_ARM, anomalies, ok: preflightOk },
    verdict,
    // ⚠️ 名字按实际口径（B70 终审 Minor 7）：这是 `decide` 的**调用次数**（含提前 return 的分支），
    //   不是 HTTP 调用次数；`fallbacks === 0` 时两者恰好相等，故障注入下会分家。
    decideCalls: timings.length, latencyMs: { p50: pct(0.5), p95: pct(0.95) },
    fallbackGames: { baseline: fallbackGames(arms.baseline), model: fallbackGames(arms.model) },
    avgRounds: { baseline: Number((arms.baseline.reduce((a, g) => a + g.rounds, 0) / arms.baseline.length).toFixed(2)), model: Number((arms.model.reduce((a, g) => a + g.rounds, 0) / arms.model.length).toFixed(2)) },
    anomalies,
    injection: inj, minutes: Number(minutes.toFixed(2)),
  };
  results.push(row);
  console.log(`[${face}] ${row.gamesPerArm} 局/臂｜座0 ${row.baselineSeat0Wins}→${row.modelSeat0Wins}｜b=${p.b} c=${p.c} χ²=${stat.chi2}｜${row.verdict}｜${row.minutes} 分钟`);
  if (!preflightOk) { console.error(`面 ${face} 前置自检未通过：局/臂=${String(row.gamesPerArm)}（需 ≥${String(MIN_GAMES_PER_ARM)}）、anomalies=${String(anomalies)}（需 0）`); }
  if (budgetHit) { break; }
}
mkdirSync('docs/预研/data', { recursive: true });
writeFileSync(`docs/预研/data/b70-face-arms${SUFFIX}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), proxy: PROXY, faces: FACES, tag: TAG, seedBase: SEED_BASE, results }, null, 1));
const lines = ['# B70 · 三决策面模型评估读数（生成物，勿手改）', '',
  '> 生成：`npm run eval:faces`' + (TAG === '' ? '' : '（tag=' + TAG + '，仅面 ' + FACES.join(',') + '）') + '｜每面 ' + String(SEEDS) + ' seed × ' + String(THEMES.length) + ' 主题 = ' + String(SEEDS * THEMES.length) + ' 局/臂｜模型座位 = 座' + String(MODEL_SEAT) + '｜配对 McNemar 临界 3.841',
  '> ⚠️ 本文件由脚本覆写；**结论段**在 `docs/预研/2026-11-09-b70-face-evaluation.md`（手写，不由本脚本生成）。', '',
  '| 面 | 局/臂 | 座0 胜（基线→模型） | 胜率 | b | c | χ² | 判定 | 胜者变化率 | decide 调用 | 延迟 p50/p95 | 回落/空候选 | 异常 | 分钟 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of results) {
  lines.push(`| ${r.face} | ${r.gamesPerArm} | ${r.baselineSeat0Wins}→${r.modelSeat0Wins} | ${(r.baselineWinRate * 100).toFixed(1)}%→${(r.modelWinRate * 100).toFixed(1)}% | ${r.b} | ${r.c} | ${r.chi2} | ${r.verdict} | ${(r.changedRate * 100).toFixed(1)}% | ${r.decideCalls} | ${r.latencyMs.p50}/${r.latencyMs.p95}ms | ${r.injection.fallbacks}/${r.injection.emptyCandidates} | ${r.anomalies} | ${r.minutes} |`);
}
lines.push('', '**空候选按成因拆分**（子项之和 = 上表「空候选」列）：', '',
  '| 面 | 站点≠面 | 面未登记 | 该面确无候选 | 收窄后为空 | 合计 |',
  '|---|---|---|---|---|---|');
for (const r of results) {
  const b = r.injection.emptyByReason;
  lines.push(`| ${r.face} | ${b.stationMismatch} | ${b.unregisteredFace} | ${b.noCandidate} | ${b.narrowedEmpty} | ${r.injection.emptyCandidates} |`);
}
lines.push('', '原始数据：`docs/预研/data/b70-face-arms.json`', '',
  '⚠️ 判定前置自检（B70 终审 Minor 5）：每面 `gamesPerArm >= 400` 且 `anomalies === 0`；不满足时判定固定为「样本不足/未跑满（前置自检未通过）」，**不会**输出三种固定措辞之一（JSON 的 `preflight.ok` 可核）。',
  '⚠️ 臂的定义（C1 后）：play 面**只**接管「选哪张牌 + 打谁」——`s.rng.next()` 的 0.16/0.75/0.85 三段行动分段两臂完全相同（每次手番两臂都消耗同一个 `roll`），只有 `roll >= 0.85`（基线本来就要出牌）那一段换成模型答案。',
  '⚠️ 随机流口径（C1 后）：两臂的分叉点是「**实际打出的牌不同**⇒ 之后的状态与 rng 使用不同」，**不是**「改道命中时跳过了一次 rng」。配对比较仍成立（同 seed 起点相同）。',
  '⚠️ `emptyCandidates` = **未问出口的到达数**（含站点≠面 / 面未登记 / 该面确无候选 / 收窄后为空），**不是**「该面无候选的时刻」；按成因的拆分见上表（B70 终审 I3）。',
  '⚠️ `decideCalls` 是 `decide` 的调用次数（含提前 return 的分支），不是 HTTP 调用次数；`fallbacks=0` 时两者相等（B70 终审 Minor 7）。',
  '⚠️ 本批**只评估不接入**：`policy` 缺省 undefined，sim CLI 无新开关，门 ⑨ 基线未动。');
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`读数 → ${OUT}`);
