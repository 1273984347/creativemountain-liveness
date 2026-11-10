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
const FACES = ['play', 'council', 'certify'];
const THEMES = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];
const SEEDS = Number(process.env.B70_SEEDS ?? 100);      // 4 × 100 = 400 局/臂
const PLAYERS = 4;
const MODEL_SEAT = 0;
const OUT = 'docs/预研/2026-11-09-b70-face-evaluation.md';

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
  const inj = { calls: 0, fallbacks: 0, emptyCandidates: 0 };
  for (let i = 0; i < SEEDS; i += 1) {
    const seed = 7000 + i * 31;
    for (const theme of themeObjs) {
      const base = await playOne(theme, PLAYERS, seed);
      arms.baseline.push(base);
      const m = await playOne(theme, PLAYERS, seed, undefined, modelPolicy(face, timings));
      arms.model.push(m);
      inj.calls += m.injection.calls; inj.fallbacks += m.injection.fallbacks; inj.emptyCandidates += m.injection.emptyCandidates;
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
  const row = {
    face, gamesPerArm: arms.baseline.length, seeds: SEEDS, players: PLAYERS, themes: THEMES,
    baselineSeat0Wins: wins(arms.baseline), modelSeat0Wins: wins(arms.model),
    baselineWinRate: Number(baseRate.toFixed(4)), modelWinRate: Number(modelRate.toFixed(4)),
    improved: modelRate > baseRate, ...p, ...stat,
    changedRate: Number((p.changed / Math.max(1, p.paired)).toFixed(4)),
    verdict: verdictOf({ significant: stat.significant, improved: modelRate > baseRate }),
    modelCalls: timings.length, latencyMs: { p50: pct(0.5), p95: pct(0.95) },
    fallbackGames: { baseline: fallbackGames(arms.baseline), model: fallbackGames(arms.model) },
    avgRounds: { baseline: Number((arms.baseline.reduce((a, g) => a + g.rounds, 0) / arms.baseline.length).toFixed(2)), model: Number((arms.model.reduce((a, g) => a + g.rounds, 0) / arms.model.length).toFixed(2)) },
    anomalies: arms.baseline.concat(arms.model).reduce((a, g) => a + (g.anomalies ?? []).length, 0),
    injection: inj, minutes: Number(minutes.toFixed(2)),
  };
  results.push(row);
  console.log(`[${face}] ${row.gamesPerArm} 局/臂｜座0 ${row.baselineSeat0Wins}→${row.modelSeat0Wins}｜b=${p.b} c=${p.c} χ²=${stat.chi2}｜${row.verdict}｜${row.minutes} 分钟`);
  if (minutes > 30) { console.error(`面 ${face} 超过 30 分钟预算，停下报告`); break; }
}
mkdirSync('docs/预研/data', { recursive: true });
writeFileSync('docs/预研/data/b70-face-arms.json', JSON.stringify({ generatedAt: new Date().toISOString(), proxy: PROXY, results }, null, 1));
const lines = ['# B70 · 三决策面模型评估读数', '',
  `> 生成：\`npm run eval:faces\`｜每面 ${SEEDS} seed × ${THEMES.length} 主题 = ${SEEDS * THEMES.length} 局/臂｜模型座位 = 座${MODEL_SEAT}｜配对 McNemar 临界 3.841`, '',
  '| 面 | 局/臂 | 座0 胜（基线→模型） | 胜率 | b | c | χ² | 判定 | 胜者变化率 | 模型调用 | 延迟 p50/p95 | 回落/空候选 | 异常 | 分钟 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of results) {
  lines.push(`| ${r.face} | ${r.gamesPerArm} | ${r.baselineSeat0Wins}→${r.modelSeat0Wins} | ${(r.baselineWinRate * 100).toFixed(1)}%→${(r.modelWinRate * 100).toFixed(1)}% | ${r.b} | ${r.c} | ${r.chi2} | ${r.verdict} | ${(r.changedRate * 100).toFixed(1)}% | ${r.modelCalls} | ${r.latencyMs.p50}/${r.latencyMs.p95}ms | ${r.injection.fallbacks}/${r.injection.emptyCandidates} | ${r.anomalies} | ${r.minutes} |`);
}
lines.push('', '原始数据：`docs/预研/data/b70-face-arms.json`', '',
  '⚠️ 口径注记：模型臂在改道命中时不再消耗启发式那次 `s.rng.next()` 判定 ⇒ 两臂随机流自首个分歧起分叉，这是策略注入的固有效应；配对比较仍成立（同 seed 起点相同）。',
  '⚠️ 本批**只评估不接入**：`policy` 缺省 undefined，sim CLI 无新开关，门 ⑨ 基线未动。');
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`报告 → ${OUT}`);
