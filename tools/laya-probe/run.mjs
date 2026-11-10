// 影子决策探针（B57 · Task 15）—— 读决策点记录 → 出题 → 问模型 → 与启发式对比。
//
// 产出四组读数（**判据写死，不因结果不好而改**，见计划 §2.3）：
//   · **P1** 打通率：拿到 choice 且严格反解成功（`answerRate`）、`illegal` 计数；
//   · **P2** 延迟：已回答样本的 p50 / p95（毫秒）；
//   · **P3** token 预算：候选数分布 + **`dropped` 之和**（下调信号读 `dropped`，不是 `truncated`）；
//   · **P6** 一致率：模型选择与启发式选择的吻合率 + 分歧样本。
//
// ⚠️ **分桶硬要求**：`noLegalActions === true` 的样本（待认证锁定 / 对峙未决 / 非行动阶段）
//   **单独计数**并列出原因，**不得**混进 `answerRate` 的分母而不说明。
//
// ⚠️ **可见性红线**：喂给模型的 `state` 一律经 `describeState`（可见性受限文本化），
//   **绝不**直接把记录里的全量状态（它含 rng 内部状态）送出去。
//
// ⚠️ **严格反解入 try/catch**：反解是严格规范形，模型给一个畸形 key 会抛错；
//   抛错必须计成「未回答 + err」，而不是让整个脚本崩溃。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stateFromJson } from '../../engine/core/serialize.ts';
import { actionFromKey, withActor } from '../../engine/core/action-key.ts';
import { getLegalActionStats } from '../../engine/core/legal.ts';
import { probeAction } from '../../engine/core/probe.ts';
import { buildChoice, describeState } from './state-text.mjs';
import { normalizeLegacyKey } from './key-normalize.mjs';

const ROOT = process.cwd();
const DATA_DIR = resolve(ROOT, 'docs/预研/data');
/** 反代地址（Task 13 的产物）。 */
const PROXY = process.env.LAYA_PROXY_URL ?? 'http://127.0.0.1:8711';
/** 最多问多少个决策点（避免一次跑太久）。 */
const LIMIT = Number(process.env.LAYA_PROBE_LIMIT ?? 300);

/**
 * 读取决策点记录（**排除小样本**：它只有 2 条，会掺进正式读数**）。
 *
 * ⚠️ **流式截断**（B57）：4 人采样文件实测 **94 MB**、8 人更大 ⇒ 读全文件进内存
 *   既慢又可能撑爆堆 ⇒ 逐行读、**凑够 LIMIT 就停**。
 *
 * @param {number} limit 最多取多少条
 * @returns {object[]} 决策点记录
 */
function loadDecisions(limit) {
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('decisions-') && f.endsWith('.jsonl'))
    .filter((f) => f !== 'decisions-sample.jsonl')
    .sort();
  const rows = [];
  // ⚠️ **轮流取**（B57）：4 人与 8 人**都要进读数** ⇒ 若按文件顺序取满，
  //   后面的文件（8 人）**一条都进不来** ⇒ 读数只代表一种规模。
  const handles = files.map((f) => ({
    name: f,
    text: readFileSync(resolve(DATA_DIR, f), 'utf8'),
    pos: 0,
    done: false,
  }));
  while (rows.length < limit) {
    let progressed = false;
    for (const h of handles) {
      if (h.done || rows.length >= limit) { continue; }
      const nl = h.text.indexOf('\n', h.pos);
      const line = nl === -1 ? h.text.slice(h.pos) : h.text.slice(h.pos, nl);
      h.pos = nl === -1 ? h.text.length : nl + 1;
      if (nl === -1) { h.done = true; }
      if (line.trim() !== '') { rows.push(JSON.parse(line)); progressed = true; }
    }
    if (!progressed) { break; }
  }
  return rows;
}

/** 问模型一次（走反代 ⇒ CORS/超时/SKIP 都由反代处理）。 */
async function askModel(choice) {
  const body = {
    state: choice.stateText,
    questions: {
      act: {
        type: 'choice',
        instructions: choice.instructions,
        criteria: choice.criteria,
      },
    },
  };
  const t0 = Date.now();
  const res = await fetch(`${PROXY}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  if (res.status !== 200) {
    return { ms, status: res.status, raw: text, choice: null, err: `HTTP ${String(res.status)}` };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return { ms, status: res.status, raw: text, choice: null, err: `响应非 JSON：${String(e.message)}` };
  }
  const answer = parsed?.answers?.act ?? {};
  return {
    ms,
    status: res.status,
    raw: text,
    choice: typeof answer.choice === 'string' ? answer.choice : null,
    confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
    probabilities: answer.probabilities ?? null,
    err: null,
  };
}

/**
 * 「无候选」的**原因**（计划要求列出，不得只报计数）。
 *
 * ⚠️ 直接读**引擎状态**判定（不靠题面文本猜）⇒ 分类与真实口径一致。
 *
 * @param {object} state 引擎状态
 * @param {number} seat 决策座位
 * @returns {string} 原因标签
 */
function reasonOf(state, seat) {
  if (state.duel !== null) { return '对峙未决'; }
  if (state.phase !== '行动') { return `非行动阶段（${String(state.phase)}）`; }
  const p = state.players[seat];
  if (p !== undefined && p.pendingCert) { return '待认证锁定'; }
  return '其他（候选为空但上述三条都不成立）';
}

/** 百分位（线性插值法）。 */
function pct(values, p) {
  if (values.length === 0) { return null; }
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const v = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  return Math.round(v * 100) / 100;
}

const sampled = loadDecisions(LIMIT);
const byFile = {};
for (const r of sampled) { const k = r.players + 'p'; byFile[k] = (byFile[k] ?? 0) + 1; }

const results = [];
for (const row of sampled) {
  const state = stateFromJson(row.state);
  const seat = row.seat;
  const choice = buildChoice(state, seat);
  const stats = getLegalActionStats(state, seat);
  const rec = {
    seq: row.seq,
    themeId: row.themeId,
    players: row.players,
    face: row.face,
    candidates: stats.candidates,
    enumerated: stats.enumerated,
    dropped: stats.dropped,
    truncated: stats.truncated,
    noLegalActions: choice.noLegalActions,
    noLegalReason: choice.noLegalActions ? reasonOf(state, seat) : null,
    answered: false,
    err: null,
    illegal: false,
    laya: null,
    heuristic: normalizeLegacyKey(row.heuristic),
    agree: null,
    ms: null,
  };
  // ⚠️ **无候选的样本单独分桶**（待认证锁定 / 对峙未决 / 非行动阶段）⇒ 不问模型。
  if (choice.noLegalActions) {
    results.push(rec);
    continue;
  }
  const asked = await askModel({
    stateText: describeState(state, seat),
    instructions: choice.instructions,
    criteria: choice.criteria,
  });
  rec.ms = asked.ms;
  rec.laya = asked.choice;
  if (asked.err !== null) {
    rec.err = asked.err;
    results.push(rec);
    continue;
  }
  // ⚠️ **严格反解必须包 try/catch**：畸形 key ⇒ 计成「未回答 + err」，不能崩脚本。
  let action = null;
  try {
    action = withActor(actionFromKey(String(asked.choice)), seat);
  } catch (e) {
    rec.err = `反解失败：${String(e.message)}`;
    results.push(rec);
    continue;
  }
  rec.answered = true;
  // 复核：引擎是否真的接受这个动作（**非法提交要计 0 例**）。
  const verdict = probeAction(state, action);
  rec.illegal = verdict.ok !== true;
  if (!rec.illegal) {
    // ⚠️ **B70 读侧归一化**：历史样本的对峙启发式 key 是记录器当年手拼的 `duel_card:<id>`，
    //   而模型只能输出规范形 `duel:card:<id>`（`actionFromKey` 只认规范形）⇒ 不归一化会把
    //   **格式差异**算成决策分歧，P6 在对峙样本上恒判 disagree。两侧都取规范形后再比。
    //   ⚠️ 只在此处（比较前）归一化 ⇒ 历史 JSONL 不改写，`duel_card:` 也不是合法的写侧格式。
    rec.agree = normalizeLegacyKey(String(asked.choice)) === normalizeLegacyKey(String(row.heuristic));
  }
  results.push(rec);
}

// ---------- 读数 ----------
const n = results.length;
const noLegal = results.filter((r) => r.noLegalActions);
const asked = results.filter((r) => !r.noLegalActions);
const answered = results.filter((r) => r.answered);
const illegal = results.filter((r) => r.illegal);
const errs = results.filter((r) => r.err !== null);
const agreed = answered.filter((r) => r.agree === true);
const disagreed = answered.filter((r) => r.agree === false);

const read = {
  P1: {
    sampled: n,
    byPlayers: byFile,
    noLegalActions: noLegal.length,
    noLegalReasons: noLegal.reduce((acc, r) => {
      const k = r.noLegalReason ?? '未分类';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    asked: asked.length,
    answered: answered.length,
    answerRate: asked.length === 0 ? null : Math.round((answered.length / asked.length) * 10000) / 10000,
    illegal: illegal.length,
    errors: errs.length,
    errorSamples: errs.slice(0, 5).map((r) => ({ seq: r.seq, err: r.err })),
  },
  P2: {
    n: answered.length,
    p50ms: pct(answered.map((r) => r.ms ?? 0), 0.5),
    p95ms: pct(answered.map((r) => r.ms ?? 0), 0.95),
  },
  P3: {
    maxCandidates: Math.max(0, ...results.map((r) => r.candidates)),
    meanCandidates: n === 0 ? null : Math.round((results.reduce((a, r) => a + r.candidates, 0) / n) * 100) / 100,
    droppedSum: results.reduce((a, r) => a + (r.dropped ?? 0), 0),
    truncatedCount: results.filter((r) => r.truncated === true).length,
  },
  P6: {
    comparable: answered.length,
    agree: agreed.length,
    agreeRate: answered.length === 0 ? null : Math.round((agreed.length / answered.length) * 10000) / 10000,
    disagreements: disagreed.slice(0, 20).map((r) => ({ seq: r.seq, themeId: r.themeId, laya: r.laya, heuristic: r.heuristic })),
  },
};

console.log('== 影子决策探针读数 ==');
console.log(JSON.stringify(read, null, 2));
const out = resolve(DATA_DIR, 'probe-raw.json');
writeFileSync(out, JSON.stringify({ read, results }, null, 2) + '\n', 'utf8');
console.log('原始读数 → ' + out);
