# Laya sidecar V2 预研（B15 枚举落地 + B16 sidecar 探针）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把规格 §7 的「UI 与 AI 使用同一枚举」落成可机械验证的契约（试跑式 `getLegalActions`），并用一个本地 Laya sidecar 与影子决策探针量出工程可行性读数 P0–P6。

**Architecture:** 三段式枚举（候选粗筛 → rng 隔离试跑 → 判定收集）在引擎内自证合法；`web/legal-gate.ts` 独立表达 UI 侧判据，由漂移守卫断言两个实现给出同一集合；sidecar 走「官方 `laya.serve` 应用（硬绑环回）+ Node 反代（补 CORS／权重对拍／SKIP）」两跳，探针只读引擎、不驱动对局（状态采样 + 影子决策）。

**Tech Stack:** TypeScript strict（`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）、Node 24（`node --test` 直跑 `.ts`）、esbuild 单文件打包、Playwright（复用既有 `file://` E2E 骨架，不新增依赖）、Python 3.12 + `laya==0.4.21`（FastAPI/uvicorn）。

**Spec:** `docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`（主设计）+ `docs/superpowers/specs/2026-11-08-creativemountain-ai-prespike-overview.md`（总纲与红线）

## Global Constraints

- 十道门**不得**调用模型：`tools/gate.mjs` 不新增任何需要 sidecar 的条目；无服务即 SKIP 且退出码 0。
- 发布包**零增量**：`esbuild.config.mjs` 与 `build/build-package.mjs` 不得引用 `tools/laya-sidecar/**`、`tools/laya-probe/**`；**因此动作编码器落在 `engine/core/action-key.ts`**（`web/` 可引用它，不可引用 `tools/`）；Python 依赖不写入 `package.json` / `package-lock.json`。
- 模型只见公开信息：禁止集 = 他人手牌 id、牌堆顺序（`state.decks.deck` 首张）、`duel.pickA`、`duel.pickB`；由常驻测试断言文本化输出不含这些字样。
- 服务只绑环回：官方 serve `LAYA_SERVE_PORT=8712`、反代 `LAYA_PROXY_PORT=8711`（避开 GateKeeper 的 8000）；`LAYA_HOST` 在 `launch.py` 内硬编码 `127.0.0.1`（官方默认 `0.0.0.0` 不可用）。
- 供应链纪律：`laya==0.4.21` 锁版本；权重 `D:\<local-libs>\laya-multilingual\model.safetensors` 共 643835514 字节、sha256 `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`，对拍不符即拒绝启动；`USE_TF=0`、`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、`HF_HOME=D:\<local-libs>\hf-home`。
- 枚举候选上限 `LEGAL_ACTION_CAP = 64`（官方 `MAX_CHOICE_OPTIONS=100`，留余量）。
- **费用不作为合法性门槛**（G-a 未裁定）：`getLegalActions` 与 `uiAllows` 均不检查 `card.cost`；`tests/sim/run.mjs` 中 sim 自己的 `cost <= resource` 过滤属其启发式策略，不改。
- 本批**不做**：AI 强度、AI 驱动对局、关隘接线（B14）、`gatesPassed` 写入（B14）、出牌费用语义裁定（G-a）、引擎 `act` 分支的 `pendingCert` 加固（G-b）。
- sim 默认路径逐字不变：`tests/sim/run.mjs` 只加默认关闭的 `--record-decisions`（纯记录，不掷骰、不改决策）。
- sim 无可调种子参数：`parseArgs` 只认 `--games/--check/--out/--themes/--players`（`tests/sim/run.mjs:38-50`），每局 seed 由 `runCell` 的 `1000 + g*97 + players*13 + themeSeed` 生成（`:308-311`）⇒ 同参数即逐字可复现；任何命令都**不要**加 `--seed`（会被静默忽略，让人误以为换了随机流）。
- 单一来源约定：被动标识一律 `activeAbilityId(state, seat)`（Task 5 定义），`legal.ts` 与 `web/legal-gate.ts` 不得各写取法；测试局面一律从 `tests/engine/fixtures.ts` 导入，不得在各测试文件内重复构造。
- 提交信息风格：`<type>(B15): 中文` / `<type>(B16): 中文`。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `engine/core/action.ts` | Action 可辨识联合的唯一真相源 | Modify |
| `engine/core/action-key.ts` | 动作 ↔ 稳定 key 的可逆编码（UI 与探针共用） | Create |
| `engine/core/probe.ts` | rng 隔离 + `probeAction`（三种拒绝表达适配） | Create |
| `engine/core/passives.ts` | 新增 `activeAbilityId`（被动标识唯一来源） | Modify |
| `engine/core/legal.ts` | 候选粗筛 → 试跑 → 收集；`LEGAL_ACTION_CAP` 与统计 | Rewrite |
| `web/legal-gate.ts` | UI 侧独立判据 `actionWindow` / `uiAllows` / `uiAllowedSet` | Create |
| `web/main.ts` | 行动区与手牌点击改为消费 `legal-gate` | Modify |
| `tools/laya-probe/state-text.mjs` | 可见性受限的 state / 动作文本化与 choice 题面 | Create |
| `tests/engine/fixtures.ts` | 测试局面唯一来源（`mk` / `lockedScene` / `pendingScene` / `appealedScene` / `councilScene`） | Create |
| `tests/engine/action-contract.test.ts` | Action 契约源码比对 | Create |
| `tests/engine/action-key.test.ts` | key 往返、稳定性、未知 key 抛错 | Create |
| `tests/engine/legal-probe.test.ts` | 常驻四条（一致性正向 / 漂移守卫 / rng 隔离 / 禁止集） | Create |
| `tests/gates/sidecar-guard.test.ts`、`tests/gates/laya-skip.test.ts`、`tests/gates/sim-record.test.ts` | 反代／降级／记录器的常驻负样本 | Create |
| `tests/sim/run.mjs` | `--record-decisions` 决策点记录器 | Modify |
| `tools/laya-sidecar/env-check.mjs`、`launch.py`、`serve.mjs` | P0 自检、官方 app 启动、Node 反代 | Create |
| `tools/laya-probe/run.mjs`、`browser.mjs`、`skip.mjs` | P1/P2/P3/P6、P4、P5 | Create |
| `docs/预研/2026-11-08-laya-sidecar.md`、`docs/预研/data/**` | 读数报告与原始数据 | Create |
| `package.json`、`README.md`、`.gitignore`、主规格 §5.3/§6.3/§7 | 脚本、门禁表、忽略项、口径 | Modify |

**任务顺序即依赖顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10（阶段 A 完）→ 11 → 12 → 13 → 14 → 15 → 16 → 17。

---

## 阶段 A · B15 §7 枚举落地

### Task 1: Action 契约修正

**Files:**
- Modify: `engine/core/action.ts:7-36`
- Modify: `engine/core/legal.ts:38-48`（删除对孤儿 `CERTIFY_VALIDATE_QUESTION` 的枚举，避免类型门禁一路红到 Task 5）
- Test: `tests/engine/action-contract.test.ts`（Create）

**Interfaces:**
- Produces: `ActionType` 13 成员（含 `CERTIFY_APPEAL_VOTE`、无 `CERTIFY_VALIDATE_QUESTION`）；`CERTIFY_ANSWER = { type; actor; target; passed }`；`CERTIFY_APPEAL_VOTE = { type; actor; target; overturn }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/engine/action-contract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 契约表的 13 项（真值取自源码文本，与门 ③ 的 unionMembers 同法）。 */
const MEMBERS = ['MOVE', 'PLAY_CARD', 'ABILITY', 'ROLL_WHEEL', 'COMPARE', 'PASS', 'VOTE',
  'CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'CERTIFY_ANSWER'];

test('§6.3 ActionType = 契约表 13 项（复议票入枚举、孤儿 CERTIFY_VALIDATE_QUESTION 移除）', () => {
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  assert.deepEqual(found.slice().sort(), MEMBERS.slice().sort());
});

test('§6.3 CERTIFY_ANSWER 字段贴合唯一真实入口 certifyAnswer(state,actor,target,passed)', () => {
  const line = /'CERTIFY_ANSWER';[^}]*}/.exec(readFileSync('engine/core/action.ts', 'utf8'))?.[0] ?? '';
  assert.match(line, /readonly target: number/);
  assert.match(line, /readonly passed: boolean/);
  assert.doesNotMatch(line, /questionIndex/);
});

test('§7 legal.ts 不再枚举无调用方的 CERTIFY_VALIDATE_QUESTION', () => {
  assert.doesNotMatch(readFileSync('engine/core/legal.ts', 'utf8'), /CERTIFY_VALIDATE_QUESTION/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/action-contract.test.ts`
Expected: FAIL —— 第 1 条差集含 `CERTIFY_VALIDATE_QUESTION`、缺 `CERTIFY_APPEAL_VOTE`

- [ ] **Step 3: 改契约**

`engine/core/action.ts`：`ActionType` 删除 `| 'CERTIFY_VALIDATE_QUESTION'`，在 `| 'CERTIFY_APPEAL'` 之后插入 `| 'CERTIFY_APPEAL_VOTE'`；`Action` 联合末尾两行替换为：

```ts
  | { readonly type: 'CERTIFY_APPEAL_VOTE'; readonly actor: number; readonly target: number; readonly overturn: boolean }
  | { readonly type: 'CERTIFY_ANSWER'; readonly actor: number; readonly target: number; readonly passed: boolean };
```

`engine/core/legal.ts`：删除第 38–48 行整段（`CERTIFY_VALIDATE_QUESTION` 的循环），不留空壳。

- [ ] **Step 4: 跑类型与门 ②**

Run: `npm run typecheck && npm test`
Expected: PASS —— 全仓无 `CERTIFY_VALIDATE_QUESTION` 引用（已核实 `b3.test.ts` 不引用）

- [ ] **Step 5: 提交**

```bash
git add engine/core/action.ts engine/core/legal.ts tests/engine/action-contract.test.ts
git commit -m "refactor(B15): Action 契约贴合真实入口——新增 CERTIFY_APPEAL_VOTE、移除孤儿 CERTIFY_VALIDATE_QUESTION"
```

### Task 2: 动作 key 可逆编码

**Files:**
- Create: `engine/core/action-key.ts`
- Test: `tests/engine/action-key.test.ts`（Create）

**Interfaces:**
- Produces: `actionKey(action: Action): string`、`actionFromKey(key: string): Action`（`actor` 填 `-1`）、`withActor(action: Action, seat: number): Action`
- 消费方：`web/legal-gate.ts`（Task 7）、`tools/laya-probe/**`（Task 6 之后所有探针任务）

- [ ] **Step 1: 写失败测试（15 个样本必须得到 15 个互异 key）**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionKey, actionFromKey, withActor } from '../../engine/core/action-key.ts';
import type { Action } from '../../engine/core/action.ts';

const SAMPLES: Action[] = [
  { type: 'MOVE', actor: 0, steps: 0 },
  { type: 'ROLL_WHEEL', actor: 2 },
  { type: 'PASS', actor: 3 },
  { type: 'COMPARE', actor: 3, cardId: 'c_gate_trial', target: 1 },
  { type: 'PLAY_CARD', actor: 0, cardId: 'c_windstep' },
  { type: 'PLAY_CARD', actor: 0, cardId: 'c_fang', target: 3 },
  { type: 'ABILITY', actor: 1, abilityId: 'peek_deck' },
  { type: 'ABILITY', actor: 1, abilityId: 'transfer_resource', target: 4 },
  { type: 'VOTE', actor: 5, target: 2 },
  { type: 'CERTIFY_SIGN', actor: 1, target: 0 },
  { type: 'CERTIFY_CHALLENGE', actor: 1, target: 0 },
  { type: 'CERTIFY_ABSTAIN', actor: 1, target: 0 },
  { type: 'CERTIFY_APPEAL', actor: 0, target: 0 },
  { type: 'CERTIFY_APPEAL_VOTE', actor: 1, target: 0, overturn: true },
  { type: 'CERTIFY_APPEAL_VOTE', actor: 1, target: 0, overturn: false },
  { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: true },
  { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: false },
];

test('key 往返：withActor(decode(encode(a)), a.actor) 与 a 等价', () => {
  for (const a of SAMPLES) {
    assert.deepEqual(withActor(actionFromKey(actionKey(a)), a.actor), a, `往返失败：${actionKey(a)}`);
  }
});

test('key 唯一：SAMPLES 互不相同 ⇒ key 集合大小相等（actor 不入 key）', () => {
  const keys = SAMPLES.map((a) => actionKey(a));
  assert.equal(new Set(keys).size, keys.length, `key 撞车：${keys.join(' | ')}`);
});

test('未知 key 必须抛错，绝不猜', () => {
  for (const bad of ['bogus:1', 'cert:whatever:0', 'vote:xx', 'play']) {
    assert.throws(() => actionFromKey(bad), /key|动作/);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/action-key.test.ts`
Expected: FAIL —— `Cannot find module '../../engine/core/action-key.ts'`

- [ ] **Step 3: 实现**

```ts
// engine/core/action-key.ts
// 动作 ↔ 稳定 key（唯一、可逆、不含自由文本）。
//
// ⚠️ 为什么落在 engine 而不是 tools：`web/legal-gate.ts` 要用它做漂移守卫，
//   而 tools/ 不得被发布包引用（红线 2）——esbuild 会把它打进单文件 HTML。
// ⚠️ 为什么 actor 不入 key：actor 由请求上下文（哪个座位在决策）决定，
//   入 key 会让同一个选择在别的位置得到不同 key，模型学到的偏好无法迁移。

import type { Action } from './action.ts';

export function actionKey(a: Action): string {
  switch (a.type) {
    case 'MOVE': return 'move';
    case 'ROLL_WHEEL': return 'ask';
    case 'PASS': return 'pass';
    case 'PLAY_CARD': return a.target === undefined ? `play:${a.cardId}` : `play:${a.cardId}->${a.target}`;
    case 'ABILITY': return a.target === undefined ? `ability:${a.abilityId}` : `ability:${a.abilityId}->${a.target}`;
    case 'VOTE': return `vote:${a.target}`;
    case 'COMPARE': return `gate:${a.cardId}->${a.target}`;
    case 'CERTIFY_SIGN': return `cert:sign:${a.target}`;
    case 'CERTIFY_CHALLENGE': return `cert:challenge:${a.target}`;
    case 'CERTIFY_ABSTAIN': return `cert:abstain:${a.target}`;
    case 'CERTIFY_APPEAL': return `cert:appeal:${a.target}`;
    case 'CERTIFY_APPEAL_VOTE': return `cert:appealvote:${a.target}:${a.overturn ? 'overturn' : 'uphold'}`;
    case 'CERTIFY_ANSWER': return `cert:answer:${a.target}:${a.passed ? 'pass' : 'fail'}`;
  }
}

/** 反解（`actor` 留 `-1`，由 `withActor` 补齐）。key 不合法 ⇒ 抛错。 */
export function actionFromKey(key: string): Action {
  const parts = key.split(':');
  const head = String(parts[0]);
  const num = (v: string | undefined): number => {
    const n = Number(v);
    if (v === undefined || !Number.isInteger(n)) { throw new Error(`key 缺座位信息：${key}`); }
    return n;
  };
  switch (head) {
    case 'move': return { type: 'MOVE', actor: -1, steps: 0 };
    case 'ask': return { type: 'ROLL_WHEEL', actor: -1 };
    case 'pass': return { type: 'PASS', actor: -1 };
    case 'vote': return { type: 'VOTE', actor: -1, target: num(parts[1]) };
    case 'play': {
      const [id, t] = String(parts[1]).split('->');
      return t === undefined
        ? { type: 'PLAY_CARD', actor: -1, cardId: String(id) }
        : { type: 'PLAY_CARD', actor: -1, cardId: String(id), target: num(t) };
    }
    case 'ability': {
      const [id, t] = String(parts[1]).split('->');
      return t === undefined
        ? { type: 'ABILITY', actor: -1, abilityId: String(id) }
        : { type: 'ABILITY', actor: -1, abilityId: String(id), target: num(t) };
    }
    case 'gate': {
      const [id, t] = String(parts[1]).split('->');
      if (t === undefined) { throw new Error(`key 缺目标：${key}`); }
      return { type: 'COMPARE', actor: -1, cardId: String(id), target: num(t) };
    }
    case 'cert': {
      const kind = String(parts[1]);
      const tail = String(parts[2]).split(':');
      const target = num(tail[0]);
      switch (kind) {
        case 'sign': return { type: 'CERTIFY_SIGN', actor: -1, target };
        case 'challenge': return { type: 'CERTIFY_CHALLENGE', actor: -1, target };
        case 'abstain': return { type: 'CERTIFY_ABSTAIN', actor: -1, target };
        case 'appeal': return { type: 'CERTIFY_APPEAL', actor: -1, target };
        case 'appealvote': return { type: 'CERTIFY_APPEAL_VOTE', actor: -1, target, overturn: tail[1] === 'overturn' };
        case 'answer': return { type: 'CERTIFY_ANSWER', actor: -1, target, passed: tail[1] === 'pass' };
        default: throw new Error(`未知认证动作：${key}`);
      }
    }
    default: throw new Error(`未知动作 key：${key}`);
  }
}

export function withActor(action: Action, seat: number): Action {
  return { ...action, actor: seat } as Action;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/engine/action-key.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add engine/core/action-key.ts tests/engine/action-key.test.ts
git commit -m "feat(B15): 动作 key 可逆编码落在 engine（模型只输出 key，不产出自由文本）"
```

### Task 3: rng 隔离 + 测试局面唯一来源

**Files:**
- Create: `engine/core/probe.ts`
- Create: `tests/engine/fixtures.ts`
- Test: `tests/engine/legal-probe.test.ts`（Create，本 Task 落常驻第 3 条）

**Interfaces:**
- Consumes: `Rng.snapshot()` / `Rng.fromSnapshot(initialSeed, snapshot)`（`engine/core/dice.ts:20-45`）、`createInitialState`
- Produces: `isolatedState(state: State): State`；`mk(players?, seed?)`、`lockedScene()`、`pendingScene(players?, seed?)`、`challengedScene()`、`appealedScene()`、`councilScene(players?, seed?)`

- [ ] **Step 1: 写失败测试**

```ts
// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedState } from '../../engine/core/probe.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { mk } from './fixtures.ts';

test('隔离（常驻）：试跑不得推进原 state 的随机源——第 ⑨ 门确定性的护栏', () => {
  const s = mk();
  const before = s.rng.snapshot();
  const iso = isolatedState(s);
  performAction(iso, 0, 'move');   // 内部掷移动骰
  performAction(iso, 0, 'ask');    // 内部掷指令骰
  assert.equal(s.rng.snapshot(), before, '原实例 rng 必须逐字不变');
  assert.notEqual(iso.rng.snapshot(), before, '探针实例必须被推进（否则两者共享同一实例）');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— `Cannot find module '../../engine/core/probe.ts'`

- [ ] **Step 3: 实现 `isolatedState`**

```ts
// engine/core/probe.ts
// 试跑基础设施（规格 §7 落地）。
//
// ⚠️ 为什么不能拿原 state 直接试跑：`State.rng` 是**可变类实例**
//   （`Rng.next()` 写内部 `s`；`readonly rng` 只锁引用、不锁内容）
//   ⇒ 直接试跑会推进随机源、改变对局轨迹，毁掉第 ⑨ 门与 balance-report 的固定 seed 复现。

import { Rng } from './dice.ts';
import type { State } from './state.ts';

/** 换一个全新随机源的状态副本；起点与 `state` 相同，但推进只影响副本。 */
export function isolatedState(state: State): State {
  return { ...state, rng: Rng.fromSnapshot(state.rng.initialSeed, state.rng.snapshot()) };
}
```

- [ ] **Step 4: 实现 `tests/engine/fixtures.ts`（后续任务只用它，不再手拼局面）**

```ts
// 测试局面的唯一来源：全部通过**真实引擎调用**构造，不手拼 certification/council 字段。
import { createInitialState, type State } from '../../engine/core/state.ts';
import { certifyAppeal, certifyAnswer, certifyChallenge } from '../../engine/core/certification.ts';
import { openCouncil } from '../../engine/core/council.ts';

export type SeatCount = 3 | 4 | 5 | 6 | 7 | 8;

/** 初始状态（`deckSize` 与既有测试一致取 40，保证有手牌可打）。 */
export function mk(players = 4, seed = 7): State {
  return createInitialState({ players: players as SeatCount, seed, deckSize: 40 });
}

/** 把指定座位放上峰顶并置为待认证。 */
export function putPending(s: State, seats: number[]): State {
  return {
    ...s,
    players: s.players.map((p) => (seats.includes(p.seat) ? { ...p, position: s.board.peakIndex, pendingCert: true } : p)),
    certification: { ...s.certification, round: 1, pending: seats },
  };
}

/** 座 0 待认证锁定（行动阶段应无动作）。 */
export function lockedScene(): State { return putPending(mk(), [0]); }

/** 座 0 待认证、认证轮进行中。 */
export function pendingScene(players = 4, seed = 7): State { return putPending(mk(players, seed), [0]); }

/** 座 1 已质疑座 0（获得判定权）。 */
export function challengedScene(players = 4, seed = 7): State {
  return certifyChallenge(pendingScene(players, seed), 1, 0).state;
}

/** 座 1 质疑并判座 0 不通过 ⇒ 座 0 付 2 资源后复议已发起。 */
export function appealedScene(players = 5, seed = 7): State {
  const judged = certifyAnswer(challengedScene(players, seed), 1, 0, false).state;
  const rich = { ...judged, players: judged.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)) };
  const r = certifyAppeal(rich, 0, 0);
  assert.ok(r.ok, '复议申请必须成功，否则后续断言无意义：' + (r.note ?? ''));
  return r.state;
}

/** 山议进行中。 */
export function councilScene(players = 4, seed = 7): State { return openCouncil(mk(players, seed)).state; }
```

> `certifyAppeal` 要求 `resource >= 2` 且 `target === actor`（[certification.ts:206-222](file:///D:/<repo>/engine/core/certification.ts#L206)）——`appealedScene` 先补资源再申请，正是因为这条前置；用 `assert.ok(r.ok)` 而不是静默返回，是为了让「前置没满足」在测试里立刻暴露成清晰失败，而不是让下游断言莫名其妙地红。
> 文件顶部需 `import assert from 'node:assert/strict';`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add engine/core/probe.ts tests/engine/fixtures.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B15): rng 隔离探针 + 测试局面唯一来源（真实引擎调用构造）"
```

### Task 4: `probeAction` 适配三种拒绝表达

**Files:**
- Modify: `engine/core/probe.ts`
- Test: `tests/engine/legal-probe.test.ts`（追加）

**Interfaces:**
- Consumes: `performAction`、`advanceTurn`、`performAbility`、`castVote`、`certifySign/Challenge/Abstain/Appeal/AppealVote/Answer`
- Produces: `interface ProbeResult { ok: boolean; reason: string }`、`probeAction(state: State, action: Action): ProbeResult`

- [ ] **Step 1: 写失败测试**

```ts
import { probeAction } from '../../engine/core/probe.ts';
import { councilScene, mk, pendingScene } from './fixtures.ts';

test('试跑：非法动作必被拒（引用相等 / ok=false / 手番未推进）', () => {
  const s = mk();
  assert.equal(probeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: 'no_such_card' }).ok, false);
  assert.equal(probeAction(s, { type: 'VOTE', actor: 0, target: 1 }).ok, false, '山议未开 ⇒ castVote.ok=false');
  assert.equal(probeAction(s, { type: 'ABILITY', actor: 0, abilityId: 'peek_deck' }).ok, false, '未授予被动 ⇒ ok=false');
  assert.equal(probeAction(s, { type: 'CERTIFY_SIGN', actor: 0, target: 1 }).ok, false, '无待认证者 ⇒ fail');
  assert.equal(probeAction(s, { type: 'COMPARE', actor: 0, cardId: 'c', target: 1 }).ok, false, '关隘入口未接线（B14）');
  assert.equal(probeAction(s, { type: 'PASS', actor: 0 }).ok, false, '座 0 不是当前手番 ⇒ 不推进');
});

test('试跑：合法动作通过且原 state 随机源不被消耗', () => {
  const s = mk();
  const card = s.players[0]?.hand[0];
  assert.ok(card !== undefined, '初始手牌必须有牌');
  const r = probeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: card.id });
  assert.equal(r.ok, true, r.reason);
  assert.equal(s.rng.snapshot(), mk().rng.snapshot());
});

test('试跑：山议投票与认证签印在对应局面合法', () => {
  assert.equal(probeAction(councilScene(), { type: 'VOTE', actor: 0, target: 1 }).ok, true);
  assert.equal(probeAction(pendingScene(), { type: 'CERTIFY_SIGN', actor: 1, target: 0 }).ok, true);
});

test('试跑：复议必须由待认证者本人发起（旧手写镜像方向有误）', () => {
  const s = pendingScene();
  assert.equal(probeAction(s, { type: 'CERTIFY_APPEAL', actor: 1, target: 0 }).ok, false, '认证人不能替别人申请');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— `probeAction is not defined`

- [ ] **Step 3: 实现**

```ts
// engine/core/probe.ts 追加

import type { Action } from './action.ts';
import type { RuleMode } from '../scales.ts';
import { advanceTurn, performAction } from './turn-runner.ts';
import { performAbility } from './abilities.ts';
import { castVote } from './council.ts';
import {
  certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote,
  certifyChallenge, certifySign,
} from './certification.ts';

const MODE: RuleMode = 'standard';

/** 试跑结果：`reason` 为拒绝原因（接受时为引擎 note 或空串）。 */
export interface ProbeResult {
  readonly ok: boolean;
  readonly reason: string;
}

const reject = (reason: string): ProbeResult => ({ ok: false, reason });

/** `performAction` 无返回标记 ⇒ 唯一判据是**返回引用等于入参**（各拒绝分支均 `return state`）。 */
function byRef(next: State, from: State): ProbeResult {
  return next === from ? reject('引擎原样返回（动作被拒）') : { ok: true, reason: '' };
}

/** 有 `{ok,note}` 契约的入口统一折叠；`ok=true` 但状态未变也算拒。 */
function byFlag(ok: boolean, note: string | undefined, next: State, from: State): ProbeResult {
  if (!ok) { return reject(note ?? '引擎拒绝'); }
  return next === from ? reject('ok=true 但状态未变') : { ok: true, reason: note ?? '' };
}

export function probeAction(state: State, action: Action): ProbeResult {
  const s = isolatedState(state);
  switch (action.type) {
    case 'MOVE': return byRef(performAction(s, action.actor, 'move'), s);
    case 'ROLL_WHEEL': return byRef(performAction(s, action.actor, 'ask'), s);
    case 'PLAY_CARD': {
      const payload = action.target === undefined
        ? { cardId: action.cardId }
        : { cardId: action.cardId, target: action.target };
      return byRef(performAction(s, action.actor, 'act', payload), s);
    }
    case 'PASS': {
      const r = advanceTurn(s, MODE);
      return r !== s && (r.turnIndex !== s.turnIndex || r.round !== s.round)
        ? { ok: true, reason: '' }
        : reject('手番未推进（对峙阻塞或无当前手番）');
    }
    case 'ABILITY': { const r = performAbility(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'VOTE': { const r = castVote(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'COMPARE': return reject('关隘入口未接线（B14）');   // payGate/drawTrial 全仓零引用
    case 'CERTIFY_SIGN': { const r = certifySign(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_CHALLENGE': { const r = certifyChallenge(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ABSTAIN': { const r = certifyAbstain(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL': { const r = certifyAppeal(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ANSWER': { const r = certifyAnswer(s, action.actor, action.target, action.passed); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL_VOTE': { const r = certifyAppealVote(s, action.actor, action.target, action.overturn); return byFlag(r.ok, r.note, r.state, s); }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/engine/legal-probe.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add engine/core/probe.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B15): probeAction 统一三种拒绝表达（引用相等 / ok=false / 手番未推进）"
```

### Task 5: 枚举重写 · 五个决策面一次到位

**Files:**
- Modify: `engine/core/passives.ts`（新增 `activeAbilityId`）
- Rewrite: `engine/core/legal.ts`
- Test: `tests/engine/legal-probe.test.ts`（追加一致性-正向常驻条 + 各面断言）

**Interfaces:**
- Consumes: `probeAction`（Task 4）、`cardNeedsTarget`/`targetCandidates`（`engine/core/targeting.ts:28-35`）、`abilityAvailability`（`engine/core/passives.ts:89`）、`passiveOf`
- Produces: `LEGAL_ACTION_CAP = 64`、`activeAbilityId(state, seat): string`、`actionWindowOpen(state, seat): boolean`、`candidatesOf(state, seat): Action[]`、`getLegalActions(state, playerId): Action[]`（签名不变）

> **为什么五面一次改完**：`legal.ts` 必须整体可编译；把山议/认证两段留到下一个任务会让本任务提交时类型门禁为红。面与面之间没有可独立验收的中间态。

- [ ] **Step 1: 写失败测试**

```ts
import { getLegalActions, actionWindowOpen, LEGAL_ACTION_CAP } from '../../engine/core/legal.ts';
import { activeAbilityId } from '../../engine/core/passives.ts';
import { appealedScene, challengedScene, councilScene, lockedScene, mk, pendingScene } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

test('§7 行动阶段：枚举出行棋/问天/出牌', () => {
  const s = mk();
  const before = s.rng.snapshot();
  const types = new Set(getLegalActions(s, 0).map((a) => a.type));
  assert.ok(types.has('MOVE'));
  assert.ok(types.has('ROLL_WHEEL'));
  assert.ok(types.has('PLAY_CARD'), '有手牌 ⇒ 至少一张可打');
  assert.equal(s.rng.snapshot(), before, '枚举不得消耗随机源');
});

test('§7 待认证锁定：行动阶段整体无动作（与 UI 禁用行动区一致）', () => {
  for (const a of getLegalActions(lockedScene(), 0)) {
    assert.equal(['MOVE', 'ROLL_WHEEL', 'PLAY_CARD', 'ABILITY'].includes(a.type), false, `泄漏 ${a.type}`);
  }
});

test('§7 对峙未决 ⇒ 行动窗口关闭（DuelState 的 pickA/pickB 是可选字段，不写 undefined）', () => {
  const s: State = { ...mk(), duel: { seatA: 0, seatB: 1 } };
  assert.equal(actionWindowOpen(s, 0), false);
  assert.equal(actionWindowOpen(mk(), 0), true);
});

test('§7 被动标识唯一来源 = activeAbilityId（PassiveSpec = Effect，没有 id 字段）', () => {
  assert.equal(activeAbilityId(mk(), 0), '');
  const s = mk();
  const withPassive: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, passive: { op: 'peek_deck' } } } : p)),
  };
  assert.equal(activeAbilityId(withPassive, 0), 'peek_deck');
});

test('§7 需目标的牌按候选目标展开，且不含无目标版本（引擎要求有目标才可出）', () => {
  const base = mk();
  const targeted = {
    id: 'test_targeted', name: '测试制敌', type: 'utility' as const, cost: 0, color: 'red' as const,
    rank: 5, text: '弃掉目标 1 张牌。', effects: [{ op: 'discard_opponent', count: 1, target: 1 }],
  };
  const s: State = {
    ...base,
    players: base.players.map((p) => (p.seat === 0 ? { ...p, hand: [targeted, ...p.hand] } : p)),
  };
  const plays = getLegalActions(s, 0).filter((a) => a.type === 'PLAY_CARD' && a.cardId === 'test_targeted');
  assert.equal(plays.length, targetCandidates(s, 0).length, '每个存活对手一条');
  assert.equal(plays.some((a) => a.type === 'PLAY_CARD' && a.target === undefined), false, '无目标版本必被引擎拒');
});

test('§7 认证段：签印/质疑/弃权在册，未质疑者无判定权、无人复议时无复议票', () => {
  const types = new Set(getLegalActions(pendingScene(), 1).map((a) => a.type));
  assert.ok(types.has('CERTIFY_SIGN'));
  assert.ok(types.has('CERTIFY_CHALLENGE'));
  assert.ok(types.has('CERTIFY_ABSTAIN'));
  assert.equal(types.has('CERTIFY_ANSWER'), false, '未质疑 ⇒ 无判定权');
  assert.equal(types.has('CERTIFY_APPEAL_VOTE'), false);
  assert.equal(types.has('PASS'), false, 'UI 无「结束手番」入口 ⇒ 不枚举');
  assert.equal(types.has('COMPARE'), false, '关隘未接线 ⇒ 不枚举');
});

test('§7 判定权只属于已质疑者，且判定去重由粗筛承担（certifyAnswer 无重复判定守卫）', () => {
  const answered = getLegalActions(challengedScene(), 1).filter((a) => a.type === 'CERTIFY_ANSWER');
  assert.equal(answered.length, 2, '判通过 / 判不通过 各一条');
  const judgedState = { ...challengedScene() };
  const after = certifyAnswerRun(judgedState);
  assert.equal(getLegalActions(after, 1).some((a) => a.type === 'CERTIFY_ANSWER'), false, '已判定 ⇒ 不再返回判定动作');
  assert.equal(getLegalActions(challengedScene(), 3).some((a) => a.type === 'CERTIFY_ANSWER'), false, '未质疑者无判定权');
});

test('§7 复议：本人可申请（target === actor），复议票只发给非当事人', () => {
  const appeal = getLegalActions(pendingScene(), 0).filter((a) => a.type === 'CERTIFY_APPEAL');
  assert.equal(appeal.length, 1, '只能对自己申请一次');
  const voted = getLegalActions(appealedScene(), 3).filter((a) => a.type === 'CERTIFY_APPEAL_VOTE');
  assert.equal(voted.length, 2, '推翻 / 维持 两条');
});

test('§7 山议：投票动作覆盖除自己外的存活玩家', () => {
  const votes = getLegalActions(councilScene(), 0).filter((a) => a.type === 'VOTE');
  assert.equal(votes.length, 3, '4 人局 ⇒ 3 个可投对象');
});

test('一致性-正向（常驻）：枚举出的每个动作必被引擎接受', () => {
  const scenes = [mk(), mk(8, 23), lockedScene(), pendingScene(), challengedScene(), appealedScene(), councilScene()];
  for (const s of scenes) {
    for (let seat = 0; seat < s.players.length; seat += 1) {
      for (const a of getLegalActions(s, seat)) {
        assert.equal(probeAction(s, a).ok, true, `${a.type} 应合法：${probeAction(s, a).reason}`);
      }
    }
  }
});

test('§7 上限：枚举结果永不超过 LEGAL_ACTION_CAP', () => {
  for (const s of [mk(8, 23), councilScene(8, 23), appealedScene(8, 23)]) {
    assert.ok(getLegalActions(s, 0).length <= LEGAL_ACTION_CAP);
  }
});

/** 已判定过的局面（用真实入口推进，不手拼字段）。 */
function certifyAnswerRun(s: State): State { return certifyAnswer(s, 1, 0, false).state; }
```

（文件顶部补 `import { certifyAnswer } from '../../engine/core/certification.ts';`、`import { probeAction } from '../../engine/core/probe.ts';`、`import { targetCandidates } from '../../engine/core/targeting.ts';`、`import type { State } from '../../engine/core/state.ts';`）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— `activeAbilityId`/`actionWindowOpen` 未定义，`PLAY_CARD`/`CERTIFY_ANSWER` 缺失，复议方向错误

- [ ] **Step 3: `activeAbilityId`（单一来源）**

```ts
// engine/core/passives.ts 追加
// PassiveSpec = Effect ⇒ 被动没有 id 字段，稳定标识只能取 op。

/** 主动被动的稳定标识。`legal.ts` 与 `web/legal-gate.ts` 必须共用它，不得各写取法。 */
export function activeAbilityId(state: State, seat: number): string {
  return passiveOf(state, seat)?.op ?? '';
}
```

- [ ] **Step 4: 重写 `engine/core/legal.ts`**

```ts
// 合法动作枚举（规格 §7）。
//
// 三段式：**候选粗筛 → rng 隔离试跑 → 判定收集**。
// ⚠️ 为什么不手写合法性镜像：镜像会漂。B13 之前对峙算子无人调用、旧实现把
//   CERTIFY_APPEAL 的 target 写成「别人」（引擎要求 target === actor ⇒ 必被拒）、
//   枚举过零调用方的 CERTIFY_VALIDATE_QUESTION ——三例都是镜像漂移的实证。
//   现在由引擎自己背书：枚举出来的动作一定被执行入口接受。
// ⚠️ 费用不作为门槛：规格 §3.1 未写支付、引擎不扣不校验（G-a 未裁定）。

import type { Action } from './action.ts';
import type { State } from './state.ts';
import { probeAction } from './probe.ts';
import { cardNeedsTarget, targetCandidates } from './targeting.ts';
import { abilityAvailability, activeAbilityId } from './passives.ts';

/** 行动阶段候选上限（官方 serve `MAX_CHOICE_OPTIONS=100`，留余量）。 */
export const LEGAL_ACTION_CAP = 64;

/** 行动窗口：存活 ∧ 非待认证锁定 ∧ 无未决对峙 ∧ 阶段为行动 ∧ 轮到该座位。 */
export function actionWindowOpen(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if (p.pendingCert) { return false; }        // §5.1 锁定
  if (state.duel !== null) { return false; }  // B13 对峙阻塞
  if (state.phase !== '行动') { return false; }
  return state.turnIndex < state.players.filter((q) => q.alive).length;
}

function actionPhaseCandidates(state: State, seat: number): Action[] {
  const p = state.players[seat];
  if (p === undefined || !actionWindowOpen(state, seat)) { return []; }
  const out: Action[] = [
    { type: 'MOVE', actor: seat, steps: 0 },   // 步数由骰子定，玩家不可选
    { type: 'ROLL_WHEEL', actor: seat },
  ];
  for (const card of p.hand) {
    if (cardNeedsTarget(card)) {
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

function councilCandidates(state: State, seat: number): Action[] {
  if (state.council.resolved === true || state.council.votes[seat] !== undefined) { return []; }
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  return state.players.filter((p) => p.alive && p.seat !== seat).map((p): Action => ({ type: 'VOTE', actor: seat, target: p.seat }));
}

/**
 * 认证候选（§5.3）。三处按引擎真实前置纠正：
 *   · `CERTIFY_APPEAL` 由待认证者本人申请（`target === actor`，且需 2 资源）；
 *   · `CERTIFY_ANSWER` 只给**已质疑且尚未判定**者（`judgments` 以判定人为键，
 *     `certifyAnswer` 无重复判定守卫 ⇒ 去重必须由粗筛承担）；
 *   · 复议票 `CERTIFY_APPEAL_VOTE` 只发给非当事人（认证人与待认证者都被引擎拒）。
 * `PASS` 与 `COMPARE` 不枚举：前者 UI 无入口，后者入口待 B14。
 */
function certificationCandidates(state: State, seat: number): Action[] {
  const c = state.certification;
  if (c.pending.length === 0) { return []; }
  const out: Action[] = [];
  if (c.pending.includes(seat)) {
    if (!c.appealed.includes(seat)) { out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat }); }
    return out;
  }
  const used = c.signed.includes(seat) || c.challenged.includes(seat) || c.abstained.includes(seat);
  const judged = c.judgments[seat] !== undefined;
  for (const target of c.pending) {
    if (!used) {
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

/** 候选总集（粗筛，不含合法性判断）。 */
export function candidatesOf(state: State, playerId: number): Action[] {
  if (state.players[playerId]?.alive !== true) { return []; }
  return [
    ...actionPhaseCandidates(state, playerId),
    ...councilCandidates(state, playerId),
    ...certificationCandidates(state, playerId),
  ];
}

/** 该玩家的合法动作（试跑背书，受 `LEGAL_ACTION_CAP` 截断）。 */
export function getLegalActions(state: State, playerId: number): Action[] {
  const out: Action[] = [];
  for (const a of candidatesOf(state, playerId)) {
    if (out.length >= LEGAL_ACTION_CAP) { break; }
    if (probeAction(state, a).ok) { out.push(a); }
  }
  return out;
}
```

- [ ] **Step 5: 跑门 ② 与类型（含 `b3.test.ts` 既有四条 §7 断言）**

Run: `npm run typecheck && npm test`
Expected: PASS。若 `b3.test.ts:303-331` 有失败，逐条核对「引擎执行 vs 旧手写期望」，**以引擎执行为准**修订该断言并在其上方补一行说明；不得反向修改测试期望以外的东西。

- [ ] **Step 6: 提交**

```bash
git add engine/core/legal.ts engine/core/passives.ts tests/engine/legal-probe.test.ts tests/engine/b3.test.ts
git commit -m "feat(B15): 五面试跑式枚举 + 纠正手写镜像三处漂移（复议方向/判定去重/孤儿动作）"
```

### Task 6: 枚举统计（P3 数据源）

**Files:**
- Modify: `engine/core/legal.ts`
- Test: `tests/engine/legal-probe.test.ts`（追加）

**Interfaces:**
- Consumes: `candidatesOf`（Task 5）
- Produces: `interface LegalActionStats { candidates: number; enumerated: number; truncated: boolean }`、`getLegalActionStats(state, playerId): LegalActionStats`

- [ ] **Step 1: 写失败测试**

```ts
import { getLegalActionStats } from '../../engine/core/legal.ts';

test('§7 统计：enumerated == 枚举长度，truncated 与候选数一致', () => {
  for (const s of [mk(), mk(8, 23), councilScene(8, 23), appealedScene(5, 23)]) {
    const stats = getLegalActionStats(s, 0);
    assert.equal(stats.enumerated, getLegalActions(s, 0).length);
    assert.ok(stats.enumerated <= LEGAL_ACTION_CAP);
    assert.ok(stats.candidates >= stats.enumerated);
    assert.equal(stats.truncated, stats.candidates > LEGAL_ACTION_CAP);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— `getLegalActionStats is not defined`

- [ ] **Step 3: 实现（复用同一 `candidatesOf`，杜绝两处逻辑分叉）**

```ts
export interface LegalActionStats {
  /** 粗筛候选总数 */
  readonly candidates: number;
  /** 试跑通过并进入枚举的数量（受 LEGAL_ACTION_CAP 截断） */
  readonly enumerated: number;
  /** 是否发生截断 */
  readonly truncated: boolean;
}

/** 候选/枚举/截断计数：P3（token 预算）读数的数据源。 */
export function getLegalActionStats(state: State, playerId: number): LegalActionStats {
  const candidates = candidatesOf(state, playerId).length;
  return { candidates, enumerated: getLegalActions(state, playerId).length, truncated: candidates > LEGAL_ACTION_CAP };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/engine/legal-probe.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add engine/core/legal.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B15): getLegalActionStats 暴露候选/枚举/截断计数（P3 读数数据源）"
```

### Task 7: UI 门禁下沉 + 漂移守卫

**Files:**
- Create: `web/legal-gate.ts`
- Modify: `web/main.ts:335-341`（行棋/问天按钮）、`web/main.ts:375-380`（手牌点击）
- Test: `tests/engine/legal-probe.test.ts`（追加常驻第 2 条）

**Interfaces:**
- Consumes: `State`/`Action`、`cardNeedsTarget`/`targetCandidates`、`abilityAvailability`/`activeAbilityId`、`actionKey`（Task 2）
- Produces: `actionWindow(state, seat): boolean`、`uiAllows(state, seat, action): boolean`、`uiAllowedSet(state, seat): string[]`

- [ ] **Step 1: 写失败测试**

```ts
import { uiAllowedSet } from '../../web/legal-gate.ts';
import { actionKey } from '../../engine/core/action-key.ts';

test('漂移守卫（常驻）：UI 允许集合 == 引擎枚举集合', () => {
  for (const seed of [7, 11, 23, 37, 53]) {
    const scenes = [mk(4, seed), mk(8, seed), lockedScene(), pendingScene(4, seed), challengedScene(4, seed), appealedScene(5, seed), councilScene(4, seed)];
    for (const s of scenes) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        const engine = getLegalActions(s, seat).map(actionKey).sort();
        assert.deepEqual(uiAllowedSet(s, seat).sort(), engine, `seed=${seed} seat=${seat} phase=${s.phase}`);
      }
    }
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— `uiAllowedSet` 未定义

- [ ] **Step 3: 实现 `web/legal-gate.ts`**

```ts
// UI 可点性的唯一来源（规格 §7 落地）。
//
// ⚠️ 本文件**不得** import `getLegalActions`：它的价值在于独立表达 UI 规则，
//   再与引擎试跑结果做集合相等比对（tests/engine/legal-probe.test.ts 漂移守卫）。

import type { State } from '../engine/core/state.ts';
import type { Action } from '../engine/core/action.ts';
import { cardNeedsTarget, targetCandidates } from '../engine/core/targeting.ts';
import { abilityAvailability, activeAbilityId } from '../engine/core/passives.ts';
import { actionKey } from '../engine/core/action-key.ts';

/** 行动窗口（与 `renderActions` 原先的三段禁用条件一一对应）。 */
export function actionWindow(state: State, seat: number): boolean {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return false; }
  if (p.pendingCert) { return false; }
  if (state.duel !== null) { return false; }
  return state.phase === '行动' && state.turnIndex < state.players.filter((q) => q.alive).length;
}

/** UI 是否允许提交该动作。费用**不**作为门槛（G-a 未裁定，与现状一致）。 */
export function uiAllows(state: State, seat: number, action: Action): boolean {
  const c = state.certification;
  switch (action.type) {
    case 'MOVE':
    case 'ROLL_WHEEL':
      return actionWindow(state, seat);
    case 'PLAY_CARD': {
      if (!actionWindow(state, seat)) { return false; }
      const card = state.players[seat]?.hand.find((x) => x.id === action.cardId);
      if (card === undefined) { return false; }
      return cardNeedsTarget(card)
        ? action.target !== undefined && targetCandidates(state, seat).includes(action.target)
        : action.target === undefined;
    }
    case 'ABILITY': {
      if (!actionWindow(state, seat)) { return false; }
      const avail = abilityAvailability(state, seat);
      if (!avail.usable || action.abilityId !== activeAbilityId(state, seat)) { return false; }
      return avail.needsTarget
        ? action.target !== undefined && targetCandidates(state, seat).includes(action.target)
        : action.target === undefined;
    }
    case 'VOTE': {
      const me = state.players[seat];
      return state.council.resolved === false
        && state.council.votes[seat] === undefined
        && (me?.alive ?? false)
        && action.target !== seat
        && (state.players.find((p) => p.seat === action.target)?.alive ?? false);
    }
    case 'CERTIFY_SIGN':
    case 'CERTIFY_CHALLENGE':
    case 'CERTIFY_ABSTAIN':
      return c.pending.includes(action.target)
        && !c.pending.includes(seat)
        && !c.signed.includes(seat) && !c.challenged.includes(seat) && !c.abstained.includes(seat);
    case 'CERTIFY_APPEAL':
      return action.target === seat && c.pending.includes(seat) && !c.appealed.includes(seat);
    case 'CERTIFY_ANSWER':
      return c.challenged.includes(seat)
        && c.judgments[seat] === undefined
        && c.pending.includes(action.target)
        && action.target !== seat;
    case 'CERTIFY_APPEAL_VOTE':
      return c.appealed.includes(action.target)
        && c.appealVotes[seat] === undefined
        && !c.pending.includes(seat)
        && c.judgments[seat] !== false;   // 判定人不得参与复议投票
    case 'PASS':
    case 'COMPARE':
      return false;   // PASS 无 UI 入口；COMPARE 待 B14 接线
  }
}

/** UI 允许动作的 key 集：自行枚举候选再过滤（不得借道 getLegalActions）。 */
export function uiAllowedSet(state: State, seat: number): string[] {
  const out: string[] = [];
  const push = (a: Action): void => { if (uiAllows(state, seat, a)) { out.push(actionKey(a)); } };
  if (actionWindow(state, seat)) {
    push({ type: 'MOVE', actor: seat, steps: 0 });
    push({ type: 'ROLL_WHEEL', actor: seat });
    for (const card of state.players[seat]?.hand ?? []) {
      if (cardNeedsTarget(card)) {
        for (const t of targetCandidates(state, seat)) { push({ type: 'PLAY_CARD', actor: seat, cardId: card.id, target: t }); }
      } else {
        push({ type: 'PLAY_CARD', actor: seat, cardId: card.id });
      }
    }
    const abilityId = activeAbilityId(state, seat);
    if (abilityAvailability(state, seat).usable) {
      if (abilityAvailability(state, seat).needsTarget) {
        for (const t of targetCandidates(state, seat)) { push({ type: 'ABILITY', actor: seat, abilityId, target: t }); }
      } else {
        push({ type: 'ABILITY', actor: seat, abilityId });
      }
    }
  }
  for (const p of state.players) {
    if (p.seat !== seat) { push({ type: 'VOTE', actor: seat, target: p.seat }); }
  }
  for (const target of state.certification.pending) {
    push({ type: 'CERTIFY_SIGN', actor: seat, target });
    push({ type: 'CERTIFY_CHALLENGE', actor: seat, target });
    push({ type: 'CERTIFY_ABSTAIN', actor: seat, target });
    push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: true });
    push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: false });
    push({ type: 'CERTIFY_APPEAL', actor: seat, target });
  }
  for (const target of state.certification.appealed) {
    push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: true });
    push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: false });
  }
  return out;
}
```

- [ ] **Step 4: `renderActions` 与手牌点击改为消费它**

`web/main.ts` 行棋/问天按钮（`:335-341`）各包一层，按钮内部逻辑**不动**：

```ts
  if (uiAllows(ui.state, seat, { type: 'MOVE', actor: seat, steps: 0 })) {
    row.append(button('行棋（掷 6 面，必须走满）', () => {
      ui.state = performAction(ui.state, seat, 'move');
      ui.state = advanceTurn(ui.state, ui.mode);
      render();
    }));
  }
```

手牌点击处（`:375-380`）在 `playCard` 之前加同一道闸（不动对峙面板的选牌分支）：

```ts
    if (!uiAllows(ui.state, seat, { type: 'PLAY_CARD', actor: seat, cardId })) { return; }
```

- [ ] **Step 5: 跑门 ② + 十道门（证明 UI 行为未变）**

Run: `npm test && npm run gate`
Expected: 十道门全绿。门 ⑩ 对峙 E2E 若失败 ⇒ `uiAllows` 与 `renderActions` 原逻辑不等价 ⇒ 回 Step 3 修实现，**不得**改 E2E 期望迁就。

- [ ] **Step 6: 提交**

```bash
git add web/legal-gate.ts web/main.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B15): UI 可点性下沉 web/legal-gate + 漂移守卫（两独立实现集合相等）"
```

### Task 8: 可见性受限文本化器 + 禁止集

**Files:**
- Create: `tools/laya-probe/state-text.mjs`
- Test: `tests/engine/legal-probe.test.ts`（追加常驻第 4 条）

**Interfaces:**
- Consumes: `getLegalActions`（Task 5）、`actionKey`（Task 2）
- Produces: `describeState(state, seat): string`、`describeAction(state, action): string`、`buildChoice(state, seat): { instructions: string; criteria: Record<string,string> }`

- [ ] **Step 1: 写失败测试**

```ts
import { buildChoice, describeState } from '../../tools/laya-probe/state-text.mjs';

test('可见性红线（常驻）：文本化不得泄漏禁止集', () => {
  const s = mk(4, 7);
  const otherHandId = String(s.players[1]?.hand[0]?.id ?? '');
  const deckTopId = String(s.decks.deck[0]?.id ?? '');
  assert.ok(otherHandId.length > 0 && deckTopId.length > 0, '样本非空，否则测试失去意义');
  const poisoned = { ...s, duel: { seatA: 0, seatB: 1, pickA: 'duel_secret_a', pickB: 'duel_secret_b' } };
  const text = describeState(poisoned, 0) + ' ' + buildChoice(poisoned, 0).instructions
    + ' ' + Object.values(buildChoice(poisoned, 0).criteria).join(' ');
  for (const leak of [otherHandId, deckTopId, 'duel_secret_a', 'duel_secret_b']) {
    assert.equal(text.includes(leak), false, `泄漏：${leak}`);
  }
});

test('文本化：每候选一句话，长度受预算约束（rl_agent_config.head_max_len=256）', () => {
  for (const s of [mk(8, 11), councilScene(8, 11), appealedScene(8, 11)]) {
    for (const [k, v] of Object.entries(buildChoice(s, 0).criteria)) {
      assert.ok(String(v).length <= 40, `候选 ${k} 语义过长：${v}`);
    }
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现（白名单式：禁止集靠「不写字段访问」达成，不靠事后过滤）**

```js
// tools/laya-probe/state-text.mjs
// 可见性受限的 state 文本化（规格 §7 + 预研红线 3）。
//
// ⚠️ 只允许访问公开集：棋盘/地形、各家资源·HP·位次·身份·阵营·印记·持牌数·装备计数·活人席、
//   认证池与票数、山议已投票、**自己**的手牌、已公开亮牌。
//   禁止集（他人手牌 id、state.decks.deck 顺序、duel.pickA/pickB）在本文件内不得出现字段访问。

import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';

function seatLine(state, p) {
  const seats = state.liveSeats[p.seat] ?? 0;
  return `座${p.seat} 身份${p.identityId} 阵营${p.factionId} 位${p.position} 血${p.hp}/${p.hpMax}`
    + ` 资源${p.resource} 持牌${p.hand.length} 装备${p.equipment.length} 席${seats}`
    + (p.hasMark ? ' 持印记' : '') + (p.pendingCert ? ' 待认证' : '') + (p.alive ? '' : ' 已出局');
}

export function describeState(state, seat) {
  const me = state.players[seat];
  const c = state.certification;
  const lines = [
    `第${state.round}轮 第${state.turnIndex + 1}手 阶段${state.phase}`,
    `你的手牌：${me.hand.map((x) => `${x.name}(费${x.cost},${x.color === 'red' ? '红' : '黑'})`).join('、')}`,
    ...state.players.map((p) => seatLine(state, p)),
  ];
  if (c.pending.length > 0) {
    lines.push(`待认证：${c.pending.join('、')}｜已签印：${c.signed.join('、')}｜已质疑：${c.challenged.join('、')}`);
  }
  if (state.council.resolved === false) {
    lines.push(`山议进行中，已投票座位：${Object.keys(state.council.votes).join('、')}`);
  }
  return lines.join('\n');
}

/** 一句话动作语义（≤40 字符）。 */
export function describeAction(state, action) {
  switch (action.type) {
    case 'MOVE': return '行棋：掷骰前进';
    case 'ROLL_WHEEL': return '问天：掷指令骰';
    case 'PASS': return '结束手番';
    case 'COMPARE': return '过隘';
    case 'PLAY_CARD': {
      const card = state.players[action.actor].hand.find((x) => x.id === action.cardId);
      return `出「${card.name}」${action.target === undefined ? '' : '→座' + action.target}（费${card.cost}）`.slice(0, 40);
    }
    case 'ABILITY': return `发动被动 ${action.abilityId}${action.target === undefined ? '' : '→座' + action.target}`.slice(0, 40);
    case 'VOTE': return `山议投座${action.target}`.slice(0, 40);
    case 'CERTIFY_SIGN': return `给座${action.target}签印`.slice(0, 40);
    case 'CERTIFY_CHALLENGE': return `质疑座${action.target}`.slice(0, 40);
    case 'CERTIFY_ABSTAIN': return `对座${action.target}弃权`.slice(0, 40);
    case 'CERTIFY_APPEAL': return '自己申请复议（-2 资源）'.slice(0, 40);
    case 'CERTIFY_APPEAL_VOTE': return `复议票${action.overturn ? '推翻' : '维持'}`.slice(0, 40);
    case 'CERTIFY_ANSWER': return `判定座${action.target}${action.passed ? '通过' : '不通过'}`.slice(0, 40);
  }
}

/** 官方 `/v1/systemone` 的 choice 题面。 */
export function buildChoice(state, seat) {
  const criteria = {};
  for (const a of getLegalActions(state, seat)) { criteria[actionKey(a)] = describeAction(state, a); }
  return { instructions: '现在轮到该玩家行动，应选哪个动作？', criteria };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/engine/legal-probe.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tools/laya-probe/state-text.mjs tests/engine/legal-probe.test.ts
git commit -m "feat(B15): 可见性受限文本化器（禁止集靠不写字段访问达成）"
```

### Task 9: 口径同步（主规格 + README）

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` §6.3、§7、§5.3
- Modify: `README.md:41-51`（门禁表补第 ⑩ 行）、`README.md:66-86`（已知限制补 G-a/G-b/G-c）

- [ ] **Step 1: 主规格 §7 措辞替换（承诺 → 已实现契约）**

```markdown
- **已实现（B15）**：`getLegalActions` = **候选粗筛 → rng 隔离试跑 → 判定收集**，
  枚举结果由引擎执行背书（`engine/core/probe.ts`）；UI 侧判据独立表达于 `web/legal-gate.ts`，
  两者由常驻测试 `tests/engine/legal-probe.test.ts` 断言集合相等（漂移守卫）。
  候选上限 `LEGAL_ACTION_CAP = 64`，超限截断并由 `getLegalActionStats` 计数。
- **不枚举项**：`PASS`（UI 无「结束手番」入口）、`COMPARE`（关隘入口待 B14 接线）。
  `CERTIFY_VALIDATE_QUESTION` 因算子零调用方移出契约；复议投票为 `CERTIFY_APPEAL_VOTE`；
  `CERTIFY_ANSWER` 字段改为 `target`/`passed`（贴合 `certifyAnswer`），判定权只属于已质疑且未判定者；
  `CERTIFY_APPEAL` 的 `target` 为待认证者本人（旧手写镜像方向有误）。
- **费用不作为合法性门槛**（G-a 未裁定）。
```

§6.3 的 ActionType 清单同步为 13 项；§5.3 的「复议投票」动作名同步为 `CERTIFY_APPEAL_VOTE`。

- [ ] **Step 2: README 门禁表补第 ⑩ 行**

```markdown
| ⑩ | 浏览器端到端 | 对峙全流程（`tests/e2e/duel-e2e.mjs`，依赖门 ④ 产物） |
```

- [ ] **Step 3: README 已知限制补三条**

```markdown
- **出牌费用语义未定（G-a）**：规格 §3.1 未写支付、引擎 `act` 分支既不校验也不扣
  （`engine/core/turn-runner.ts:221-232`）、UI 不设门槛、仅模拟器把 `cost <= resource` 当资格线
  ⇒ 数字轨现在可以免费出牌。待与关隘接线（B14）一并裁定。
- **待认证锁定只在调用方生效（G-b）**：引擎 `act` 分支不检查 `pendingCert`，
  UI 靠禁用行动区挡住、模拟器靠过滤位移牌挡住；枚举层按 UI 规则排除该动作，**引擎本身未加固**。
- **`gatesPassed` 无写入方（G-c）**：四套主题各有一个身份目标是 `pass_gates`，
  而关隘逻辑 `engine/core/gate.ts` 全仓零引用 ⇒ 这 4 个身份目标当前永不可达。修复归 B14。
```

- [ ] **Step 4: 跑门 ③ 与门 ②**

Run: `npm run doc-sync && npm test`
Expected: 全绿。注：`SPEC_PATH` 固定指向主规格（`tools/doc-sync-lib.mjs:17`），本轮新增的 spec/plan 不参与比对。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md README.md
git commit -m "docs(B15): 规格 §6.3/§7/§5.3 与代码对齐 + README 补第 ⑩ 道门与 G-a/b/c"
```

### Task 10: 第 ⑨ 门回归（证明对局行为未变）

**Files:**
- Create/Modify: `docs/预研/2026-11-08-laya-sidecar.md`（「阶段 A 回归」段）

- [ ] **Step 1: 重跑十道门**

Run: `npm run gate 2>&1 | tail -30`
Expected: 全绿

- [ ] **Step 2: 比对平衡基线**

Run: `node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after.md > docs/预研/data/tmp/sim-after.log 2>&1 && diff docs/balance-report.md docs/预研/data/tmp/balance-after.md && echo 报告逐字一致`
Expected: `diff` 无输出 ⇒ 打印「报告逐字一致」。`docs/balance-report.md` 由默认参数生成（4 主题 × 3–8 人 × 每档 1000 局 = 24000 局），此处用同一默认参数复现，才构成真正的逐字等价证据。
有差异 ⇒ B15 某处改了执行路径 ⇒ 用 `git stash` 逐段回退定位（先怀疑 `advanceTurn` 调用顺序与牌序访问）；**不得**通过重新生成基线掩盖差异。

- [ ] **Step 3: 落档（把上两步的实际输出写进报告）**

```markdown
## 阶段 A 回归（B15 完成时点）

- 十道门：`npm run gate` 全绿（尾行：<实际输出>）
- 第 ⑨ 门读数：与 `docs/balance-report.md` 基线 <一致 | 差异逐字段列出>
- 常驻四条：一致性-正向 ✓ / 漂移守卫 ✓ / rng 隔离 ✓ / 禁止集 ✓
- 纠正的既有缺陷：<逐条列出：复议 target 方向、CERTIFY_VALIDATE_QUESTION 孤儿枚举、UI 复议投票入口缺失>
```

- [ ] **Step 4: 提交**

```bash
git add docs/预研/2026-11-08-laya-sidecar.md
git commit -m "test(B15): 第 ⑨ 门回归比对 + 四条常驻护栏落档"
```

---

## 阶段 B · B16 sidecar 与探针

### Task 11: P0 环境自检（定 venv 与 launch 路线）

**Files:**
- Create: `tools/laya-sidecar/env-check.mjs`
- Create: `docs/预研/data/p0-env.md`（脚本产出）
- Modify: `.gitignore`

**Interfaces:**
- Produces: `LAYA_PY`（解释器绝对路径，后续所有 Python 调用只读它）、路线判定 `A` 或 `B`

- [ ] **Step 1: 写自检脚本**

```js
// tools/laya-sidecar/env-check.mjs
// P0：权重对拍 → venv 决策树 → 官方 API 面探查。结论决定 Task 12 走 A 路还是 B 路。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const WEIGHT = 'D:/<local-libs>/laya-multilingual/model.safetensors';
const EXPECTED = { bytes: 643835514, sha256: '9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204' };
const CANDIDATES = [
  process.env.LAYA_PY ?? '',
  'D:/<repo>/.laya-venv/Scripts/python.exe',   // ② 独立 venv，指望 user site 的 .pth 递来 D 盘 torch
  'D:/<other-repo>/experiments/venv/Scripts/python.exe',        // ① 复用邻居 venv（已含 torch 2.6.0+cu124 与 laya 0.4.21）
].filter((p) => p !== '');

const PY_PROBE = [
  'import laya, inspect, torch',
  'from laya import serve',
  'print("laya", laya.__version__)',
  'print("create_app", inspect.signature(serve.create_app))',
  'print("Router", inspect.signature(laya.Router.__init__))',
  'print("load", inspect.signature(laya.load))',
  'print("torch", torch.__version__, torch.__file__, torch.cuda.is_available())',
].join('; ');

const buf = existsSync(WEIGHT) ? readFileSync(WEIGHT) : null;
const hex = buf === null ? '' : createHash('sha256').update(buf).digest('hex');
const lines = [`[weights] 存在=${buf !== null} 字节=${buf === null ? -1 : buf.byteLength}（期望 ${EXPECTED.bytes}） sha256=${hex.slice(0, 16)}…`, ''];
mkdirSync('docs/预研/data', { recursive: true });

if (buf === null || buf.byteLength !== EXPECTED.bytes || hex !== EXPECTED.sha256) {
  lines.push('对拍失败 ⇒ 按红线 4 停止，不出任何后续结论。');
  writeFileSync('docs/预研/data/p0-env.md', lines.join('\n'));
  console.error(lines.join('\n'));
  process.exit(1);
}
lines.push('对拍通过。');

for (const py of CANDIDATES) {
  lines.push(`\n[env] ${py}`);
  // ⚠️ 不加 `-I`：isolated 模式会排除 user site，而候选 ② 指望的正是 user site 里
  //   `_torch_drive.pth` 把 D:\<local-libs>\torch-cu124 递进 sys.path —— 用 -I 探必然判假。
  try { lines.push(execFileSync(py, ['-c', PY_PROBE], { encoding: 'utf8', timeout: 180000 })); }
  catch (e) { lines.push('FAIL: ' + String(e.message).slice(0, 240)); }
  try { lines.push('（对照 -I）' + execFileSync(py, ['-I', '-c', 'import torch;print(torch.__file__)'], { encoding: 'utf8', timeout: 180000 })); }
  catch (e) { lines.push('（对照 -I）FAIL: ' + String(e.message).slice(0, 120)); }
}
lines.push('\n判定：② 的 torch.__file__ 含 D:\\pylibs\\torch-cu124 且 cuda.is_available()=True ⇒ 采用 ②（零额外磁盘）；否则采用 ① 并登记跨项目耦合。');

writeFileSync('docs/预研/data/p0-env.md', lines.join('\n'));
console.log(lines.join('\n'));
```

- [ ] **Step 2: 建候选 ② 并跑自检**

```bash
python -m venv --system-site-packages .laya-venv
.laya-venv/Scripts/python.exe -m pip install "laya==0.4.21" "laya[serve]"
node tools/laya-sidecar/env-check.mjs
```
Expected: `docs/预研/data/p0-env.md` 首段含「对拍通过」，并打印各环境的 `create_app`／`Router`／`load` 签名与 torch 来源、CUDA 可用性

- [ ] **Step 3: 据实测签名定路线，补写进 p0-env.md（取值必须来自上一步实际输出）**

```markdown
采用环境：<绝对路径>
torch 来源：<D:\<local-libs>\torch-cu124 | venv 自带>
CUDA 可用：<True | False>
launch 路线：A | B
A 路条件：`create_app` 首参接受 Router/agent 实例，且 `Router` 签名含本地目录或缓存路径参数
B 路条件：`laya.load` 能拿到可用推理对象（已在 t1_bench.py:47 验证），但不满足 A 路条件
两路都不满足：结论记为「官方 app 无法指向本地权重」，Task 12 不实现启动器，探针 P1–P4 标「未跑：环境不支持」
```

- [ ] **Step 4: `.gitignore` 追加**

```
.laya-venv/
tools/laya-sidecar/__pycache__/
docs/预研/data/tmp/
```

- [ ] **Step 5: 提交**

```bash
git add tools/laya-sidecar/env-check.mjs docs/预研/data/p0-env.md .gitignore
git commit -m "chore(B16): P0 环境自检（权重对拍 + venv 决策树 + create_app/Router/load API 面）"
```

### Task 12: `launch.py`（官方 app + 本地权重 + 硬绑环回）

**Files:**
- Create: `tools/laya-sidecar/launch.py`

**Interfaces:**
- Consumes: Task 11 定下的 `LAYA_PY` 与路线
- Produces: `127.0.0.1:8712` 上的官方 `POST /v1/systemone` 与 `GET /health`

- [ ] **Step 1: 写启动器（A 路）**

```python
# tools/laya-sidecar/launch.py — 官方 laya.serve 应用 + 本地权重 + 只绑环回。
#
# 红线：官方 LAYA_HOST 默认 0.0.0.0（会把推理端口摊到局域网），此处硬编码 127.0.0.1；
#       权重 sha256 已在 Node 侧对拍（serve.mjs），此处不重复校验。
import os

os.environ["USE_TF"] = "0"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("HF_HOME", r"D:\<local-libs>\hf-home")

HOST = "127.0.0.1"
PORT = int(os.environ.get("LAYA_SERVE_PORT", "8712"))
WEIGHTS = r"D:\<local-libs>\laya-multilingual"


def build_app():
    from laya import Router
    from laya.serve import create_app
    return create_app(Router(models_dir=WEIGHTS, preload=True))   # 参数名以 p0-env.md 记录的签名为准


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(build_app(), host=HOST, port=PORT, log_level="warning")
```

B 路（Task 11 判为 B 时）把 `build_app()` 替换为：

```python
def build_app():
    import laya
    from laya.serve import create_app
    agent = laya.load(WEIGHTS, subfolder="", device="cuda")   # CPU 则 device="cpu"；见 t1_bench.py:47
    try:
        return create_app(agent)
    except TypeError:
        raise SystemExit("create_app 不接受 laya.load 的返回值 ⇒ 官方 app 无法指向本地权重（P0 结论）")
```

- [ ] **Step 2: 起服务验健康（记录实际加载耗时）**

```bash
mkdir -p docs/预研/data/tmp
".laya-venv/Scripts/python.exe" tools/laya-sidecar/launch.py > docs/预研/data/tmp/serve.log 2>&1 &
sleep 45
curl -s http://127.0.0.1:8712/health
```
Expected: JSON 含计算设备信息、`serve.log` 无 traceback。若 45s 未就绪，读 `serve.log` 得到实际耗时并替换该值，同时把耗时写进报告（P2 的加载耗时）。

- [ ] **Step 3: 打一次 choice 验端点可用**

```bash
curl -s -X POST http://127.0.0.1:8712/v1/systemone -H 'content-type: application/json' \
  -d '{"state":"座0 位24 血8/8 资源3 待认证","questions":{"act":{"type":"choice","instructions":"该做什么？","criteria":{"move":"行棋：掷骰前进","ask":"问天：掷指令骰"}}}}'
```
Expected: `answers.act.choice` ∈ {`move`,`ask`} 且带置信度字段；原始响应存 `docs/预研/data/p0-smoke-choice.json`

- [ ] **Step 4: 提交**

```bash
git add tools/laya-sidecar/launch.py docs/预研/data/p0-smoke-choice.json
git commit -m "feat(B16): launch.py 官方 serve 应用 + 本地权重 + 硬绑 127.0.0.1:8712"
```

### Task 13: 反代（CORS / 对拍 / SKIP）

**Files:**
- Create: `tools/laya-sidecar/serve.mjs`
- Test: `tests/gates/sidecar-guard.test.ts`（Create）

**Interfaces:**
- Consumes: `127.0.0.1:8712`（Task 12）
- Produces: `LAYA_PROXY_PORT` 上的 `GET /health`、`POST /v1/systemone`，恒带 CORS 头与 `OPTIONS` 应答；上游不可达 ⇒ `503 {"unavailable":true}` 且进程不退

- [ ] **Step 1: 写失败测试（三条都不需要模型；每条用**独立端口**避免互撞）**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

/** 起反代（独立端口）；返回句柄与 stdout 缓冲。 */
function startProxy(port: number, weightsPath?: string) {
  const args = ['tools/laya-sidecar/serve.mjs'];
  if (weightsPath !== undefined) { args.push('--weights', weightsPath); }
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LAYA_PROXY_PORT: String(port), LAYA_SERVE_PORT: String(1 + port) },
  }) as ChildProcessWithoutNullStreams;
  let out = '', err = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  return { child, out: () => out, err: () => err };
}

async function until<T>(fn: () => Promise<T>, tries = 60, gap = 250): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, gap)); } }
  throw last;
}

test('权重对拍不符 ⇒ 拒绝启动、退出码非 0、不监听端口', async () => {
  mkdirSync('docs/预研/data/tmp', { recursive: true });
  const fake = 'docs/预研/data/tmp/fake-model.safetensors';
  writeFileSync(fake, 'not-a-model');                       // 字节数即不符
  const { child, err } = startProxy(8731, fake);
  const code = await new Promise<number>((res) => child.on('exit', (c) => res(c ?? -1)));
  assert.notEqual(code, 0);
  assert.match(err(), /对拍失败/);
});

test('上游不可达 ⇒ /health 返回 503 {unavailable:true} 且带 ACAO 头，进程存活', async () => {
  const { child } = startProxy(8732);
  try {
    const r = await until(() => fetch('http://127.0.0.1:8732/health'));
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { unavailable: true });
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  } finally { child.kill(); }
});

test('OPTIONS 预检必须应答 204（file:// 的 JSON POST 必带预检）', async () => {
  const { child } = startProxy(8733);
  try {
    await until(() => fetch('http://127.0.0.1:8733/health'));
    const r = await fetch('http://127.0.0.1:8733/v1/systemone', { method: 'OPTIONS' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-methods'), 'POST, GET, OPTIONS');
  } finally { child.kill(); }
});
```

> 第 2、3 条走默认权重路径 ⇒ 执行机必须真有 `D:\<local-libs>\laya-multilingual\model.safetensors`（Task 11 已对拍）。若缺失，测试按红线拒绝启动而失败——这是**预期失败**，在报告里登记「本机无权重，P4/P5 未跑」，**不得**放宽对拍让门禁变绿。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/gates/sidecar-guard.test.ts`
Expected: FAIL —— 文件不存在

- [ ] **Step 3: 实现**

```js
// tools/laya-sidecar/serve.mjs
// Node 反代：官方 serve 无 CORS ⇒ 由本层补齐；纪律（对拍 / 绑环回 / SKIP）也在此。
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const UPSTREAM_PORT = Number(process.env.LAYA_SERVE_PORT ?? '8712');
const LISTEN_PORT = Number(process.env.LAYA_PROXY_PORT ?? '8711');
const EXPECTED = { bytes: 643835514, sha256: '9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204' };

const argv = process.argv.slice(2);
const weightsPath = argv.includes('--weights') ? String(argv[argv.indexOf('--weights') + 1]) : 'D:/<local-libs>/laya-multilingual/model.safetensors';

/** 红线 4：对拍不符即拒绝启动。返回问题描述，null 表示通过。 */
function checkWeights(path) {
  if (!existsSync(path)) { return `文件不存在：${path}`; }
  const buf = readFileSync(path);
  if (buf.byteLength !== EXPECTED.bytes) { return `字节数 ${buf.byteLength} ≠ ${EXPECTED.bytes}：${path}`; }
  const hex = createHash('sha256').update(buf).digest('hex');
  return hex === EXPECTED.sha256 ? null : `sha256 ${hex.slice(0, 16)}… ≠ 期望：${path}`;
}

// file:// 的 Origin 是 null，只能通配；本服务只绑环回，暴露面即本机。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(CORS)) { res.setHeader(k, v); }
    res.writeHead(204);
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => { chunks.push(c); });
  req.on('end', async () => {
    try {
      const up = await fetch(`http://127.0.0.1:${UPSTREAM_PORT}${req.url ?? '/'}`, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const text = await up.text();
      res.writeHead(up.status, { ...CORS, 'content-type': 'application/json' });
      res.end(text);
    } catch {
      res.writeHead(503, { ...CORS, 'content-type': 'application/json' });
      res.end(JSON.stringify({ unavailable: true }));   // SKIP 语义：不抛栈、不退出
    }
  });
});

const problem = checkWeights(weightsPath);
if (problem !== null) { console.error(`[weights] 对拍失败：${problem}`); process.exit(1); }
server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[proxy] http://127.0.0.1:${LISTEN_PORT} → 127.0.0.1:${UPSTREAM_PORT}`);
});
```

- [ ] **Step 4: 跑测试 + 门 ②**

Run: `node --test tests/gates/sidecar-guard.test.ts && npm test`
Expected: 三条 PASS；门 ② 全绿

- [ ] **Step 5: 提交**

```bash
git add tools/laya-sidecar/serve.mjs tests/gates/sidecar-guard.test.ts
git commit -m "feat(B16): Node 反代补 CORS/OPTIONS + 权重对拍拒启 + 无服务 SKIP 形状"
```

### Task 14: sim 决策点记录器（默认关闭）

**Files:**
- Modify: `tests/sim/run.mjs`（import、`parseArgs`、七个决策点、落盘）
- Test: `tests/gates/sim-record.test.ts`（Create）

**Interfaces:**
- Consumes: `stateToJson`（`engine/core/serialize.ts:61`）、`actionKey`（Task 2）、`activeAbilityId`（Task 5）
- Produces: `--record-decisions <path>`；JSONL 行 `{ seq, themeId, players, seed, round, turnIndex, seat, phase, face, heuristic, state }`

- [ ] **Step 1: 写失败测试**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

/**
 * sim 的随机性由 `runCell` 的 seed 公式确定（`1000 + g*97 + players*13 + themeSeed`，
 * 见 tests/sim/run.mjs:308-311），**没有 `--seed` 参数** ⇒ 同 `--themes/--players/--games`
 * 即逐字可复现。这正是「开关不改变对局路径」能够被断定的前提。
 */
const BASE = ['tests/sim/run.mjs', '--themes', 'xianxia2026', '--players', '4', '--games', '2'];
const tmp = (name: string): string => `docs/预研/data/tmp/${name}`;
const run = (extra: string[]): void => { execFileSync(process.execPath, BASE.concat(extra), { encoding: 'utf8' }); };

test('开关默认关闭：不产出 JSONL，报告照常生成', () => {
  mkdirSync('docs/预研/data/tmp', { recursive: true });
  rmSync(tmp('off.jsonl'), { force: true });
  run(['--out', tmp('off.md')]);
  assert.equal(existsSync(tmp('off.jsonl')), false, '默认不得产出记录文件');
  assert.ok(readFileSync(tmp('off.md'), 'utf8').length > 200, '报告必须非空');
});

test('开启开关：报告逐字不变（对局路径未被改动），JSONL 字段齐全且 seq 递增', () => {
  rmSync(tmp('on.jsonl'), { force: true });
  run(['--out', tmp('on.md')]);                                              // 不带开关
  run(['--record-decisions', tmp('on.jsonl'), '--out', tmp('on-rec.md')]);  // 带开关，同参数
  assert.equal(readFileSync(tmp('on-rec.md'), 'utf8'), readFileSync(tmp('on.md'), 'utf8'),
    '带记录开关的报告必须与不带时逐字一致');
  const lines = readFileSync(tmp('on.jsonl'), 'utf8').trim().split('\n');
  assert.ok(lines.length > 10, `决策点太少：${lines.length}`);
  const first = JSON.parse(String(lines[0])) as Record<string, unknown>;
  for (const k of ['seq', 'themeId', 'players', 'seed', 'round', 'turnIndex', 'seat', 'phase', 'face', 'heuristic', 'state']) {
    assert.ok(k in first, `记录缺字段 ${k}`);
  }
  assert.equal(first.themeId, 'xianxia2026');
  assert.equal(JSON.parse(String(lines[1])).seq, 1, 'seq 必须递增');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/gates/sim-record.test.ts`
Expected: FAIL —— 未知参数 `--record-decisions` 被 `parseArgs` 忽略 ⇒ 记录文件不存在 ⇒ `readFileSync` 抛错

- [ ] **Step 3: 加参数与记录器**

`parseArgs` 的初值行加一个键（`tests/sim/run.mjs:39`），并在 if 链里加分支（与 `--out` 同风格）：

```js
const out = { games: 1000, check: false, out: null, record: null, themes: THEME_IDS, players: SCALES.map((s) => s.players) };
// if 链内追加：
else if (a === '--record-decisions') { out.record = argv[++i]; }
```

顶部 import 追加：

```js
import { stateToJson } from '../../engine/core/serialize.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { activeAbilityId } from '../../engine/core/passives.ts';
```

记录器（放在 `playOne` 之前的辅助函数区）：

```js
/**
 * 影子决策数据源。`recorder === null` ⇒ record() 是空操作，对局路径逐字不变。
 * ⚠️ 只做记录：不调用任何引擎入口、不取随机数，否则第 ⑨ 门读数会被改动。
 */
let recorder = null;
function record(state, seat, face, action) {
  if (recorder === null) { return; }
  recorder.lines.push(JSON.stringify({
    seq: recorder.lines.length, themeId: recorder.themeId, players: state.players.length, seed: state.seed,
    round: state.round, turnIndex: state.turnIndex, seat, phase: state.phase, face,
    heuristic: actionKey(action), state: stateToJson(state),
  }));
}
```

- [ ] **Step 4: 七个决策点各插一次 `record`（只加一行，不改原逻辑）**

| 位置（现有代码） | `face` | `action` |
|---|---|---|
| `councilTurn` 落票处 | `council` | `{ type: 'VOTE', actor: seat, target }` |
| `certificationTurn` 签印 | `certify` | `{ type: 'CERTIFY_SIGN', actor: seat, target }` |
| `certificationTurn` 质疑 | `certify` | `{ type: 'CERTIFY_CHALLENGE', actor: seat, target }` |
| `certificationTurn` 弃权 | `certify` | `{ type: 'CERTIFY_ABSTAIN', actor: seat, target }` |
| `certificationTurn` 判定 / 复议票 | `certify` | `{ type: 'CERTIFY_ANSWER', actor: seat, target, passed }` / `{ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn }` |
| `maybeUseAbility` 成功分支 | `ability` | `{ type: 'ABILITY', actor: seat, abilityId: activeAbilityId(s, seat), target }`（无目标时不写 `target` 键） |
| `pickDuelCard` 选定处 | `duel` | `{ type: 'PLAY_CARD', actor: seat, cardId }` |
| `playOne` 的 `move` / `ask` 分支 | `move` / `ask` | `{ type: 'MOVE', actor: seat, steps: 0 }` / `{ type: 'ROLL_WHEEL', actor: seat }` |
| `playOne` 的出牌分支 | `play` | 需目标时 `{ type: 'PLAY_CARD', actor: seat, cardId, target }`，否则不带 `target` |

每处调用的形态（以 `councilTurn` 为例，其余同形，只换 `face` 与动作对象）：

```js
record(s, seat, 'council', { type: 'VOTE', actor: seat, target });
```

主流程的初始化与落盘（`tests/sim/run.mjs:411-425`）：

```js
const args = parseArgs(process.argv.slice(2));
if (args.record !== null) { recorder = { path: args.record, themeId: null, lines: [] }; }
const cells = [];
…
for (const themeId of args.themes) {
  if (recorder !== null) { recorder.themeId = themeId; }        // 已有循环，只加这一行
  const theme = loadTheme(themeId);
  …
}
if (recorder !== null) { writeFileSync(resolve(ROOT, args.record), recorder.lines.join('\n') + '\n', 'utf8'); }
const summary = summarize(cells);                                // 既有行，位置不变
```

> `writeFileSync` 放在 `const summary = summarize(cells)` **之前**：记录文件与报告文件互不影响，且不带开关时该分支整体不执行。

- [ ] **Step 5: 跑测试 + 采样 + 门 ⑨ 复跑**

```bash
node --test tests/gates/sim-record.test.ts
node tests/sim/run.mjs --themes xianxia2026 --players 4 --games 6 --record-decisions docs/预研/data/decisions-smoke.jsonl
head -1 docs/预研/data/decisions-smoke.jsonl | cut -c1-160
npm run gate 2>&1 | tail -20
```
Expected: 记录行含 `heuristic` 与 `state`；不带开关时报告与基线逐字一致；十道门全绿

- [ ] **Step 6: 提交**

```bash
git add tests/sim/run.mjs tests/gates/sim-record.test.ts docs/预研/data/decisions-smoke.jsonl
git commit -m "feat(B16): sim 决策点记录器（--record-decisions 默认关闭，影子决策数据源）"
```

### Task 15: 探针主脚本（P1 / P2 / P3 / P6）

**Files:**
- Create: `tools/laya-probe/run.mjs`
- Create: `docs/预研/data/decisions-4p.jsonl`、`decisions-8p.jsonl`、`probe-raw.json`

**Interfaces:**
- Consumes: `docs/预研/data/decisions-*.jsonl`、`stateFromJson`、`getLegalActions`、`getLegalActionStats`、`describeState`/`buildChoice`、`actionKey`/`actionFromKey`/`withActor`、`probeAction`、反代 `:8711`
- Produces: `{ P1, P2, P3, P6 }` 读数（stdout + `probe-raw.json`）

- [ ] **Step 1: 实现**

```js
// tools/laya-probe/run.mjs
// 影子决策：在同一状态上比较 Laya 与 sim 启发式的选择。模型不参与驱动对局（红线 1）。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { stateFromJson } from '../../engine/core/serialize.ts';
import { getLegalActionStats } from '../../engine/core/legal.ts';
import { probeAction } from '../../engine/core/probe.ts';
import { actionFromKey, actionKey, withActor } from '../../engine/core/action-key.ts';
import { buildChoice, describeState } from './state-text.mjs';

const PROXY = `http://127.0.0.1:${process.env.LAYA_PROXY_PORT ?? '8711'}/v1/systemone`;
const LIMIT = Number(process.env.LAYA_PROBE_LIMIT ?? '300');
const dir = 'docs/预研/data';

const rows = readdirSync(dir)
  .filter((f) => f.startsWith('decisions-') && f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(`${dir}/${f}`, 'utf8').split('\n'))
  .filter((l) => l.trim() !== '')
  .slice(0, LIMIT);
if (rows.length < 100) { console.error(`决策点不足：${rows.length} < 100（P1 判据要求 ≥100）`); process.exit(1); }

const out = [];
for (const line of rows) {
  const rec = JSON.parse(line);
  const state = stateFromJson(rec.state);
  const choice = buildChoice(state, rec.seat);
  const stats = getLegalActionStats(state, rec.seat);
  const t0 = performance.now();
  let answer = null, err = null;
  try {
    const resp = await fetch(PROXY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: describeState(state, rec.seat),
        questions: { act: { type: 'choice', instructions: choice.instructions, criteria: choice.criteria } },
      }),
      signal: AbortSignal.timeout(30000),
    });
    answer = (await resp.json())?.answers?.act?.choice ?? null;
  } catch (e) { err = String(e?.message ?? e).slice(0, 160); }
  const ms = Math.round(performance.now() - t0);
  const chosen = typeof answer === 'string' ? withActor(actionFromKey(answer), rec.seat) : null;
  out.push({
    seq: rec.seq, face: rec.face, themeId: rec.themeId, players: rec.players, ms, err,
    candidates: stats.candidates, enumerated: stats.enumerated, truncated: stats.truncated,
    answered: chosen !== null,
    illegal: chosen !== null && !probeAction(state, chosen).ok,
    laya: chosen === null ? null : actionKey(chosen),
    heuristic: rec.heuristic,
    agree: chosen !== null && actionKey(chosen) === rec.heuristic,
  });
}

const n = out.length;
const quantile = (arr, q) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))];
const answered = out.filter((r) => r.answered);
const summary = {
  P1: {
    samples: n,
    answerRate: answered.length / n,
    illegal: out.filter((r) => r.illegal).length,
    judge: 'answerRate ≥ 0.99 且 illegal = 0',
  },
  P2: { ms_p50: quantile(answered.map((r) => r.ms), 0.5), ms_p95: quantile(answered.map((r) => r.ms), 0.95), device: process.env.LAYA_DEVICE ?? 'unknown' },
  P3: { maxCandidates: Math.max(...out.map((r) => r.candidates)), truncated: out.filter((r) => r.truncated).length },
  P6: { agreeRate: out.filter((r) => r.agree).length / n, disagreements: out.filter((r) => !r.agree).slice(0, 20) },
  errors: out.filter((r) => r.err !== null).slice(0, 10),
};
summary.P1.answerRate = Number(summary.P1.answerRate.toFixed(4));
summary.P6.agreeRate = Number(summary.P6.agreeRate.toFixed(4));

writeFileSync(`${dir}/probe-raw.json`, JSON.stringify({ summary, rows: out }, null, 1));
console.log(JSON.stringify(summary, null, 1));
```

- [ ] **Step 2: 采样并跑探针**

```bash
node tests/sim/run.mjs --themes xianxia2026,scifi-ai,hybrid,urban-psych --players 4 --games 6 --record-decisions docs/预研/data/decisions-4p.jsonl
node tests/sim/run.mjs --themes xianxia2026,scifi-ai,hybrid,urban-psych --players 8 --games 3 --record-decisions docs/预研/data/decisions-8p.jsonl
node tools/laya-sidecar/serve.mjs &
LAYA_DEVICE=cuda node tools/laya-probe/run.mjs
```
Expected: 打印 P1/P2/P3/P6；`P1.illegal` 必须为 0

- [ ] **Step 3: 按判据裁定（判据不得为了变绿而调整）**

- P1：`answerRate ≥ 0.99 ∧ illegal = 0`；不达标 ⇒ 结论「枚举契约有洞，先补 B15」
- P2：`ms_p95 ≤ 300`（GPU）或 `≤ 1500`（CPU）；超线 ⇒ 「只能做异步预研，进不了真人桌局」
- P3：`truncated = 0`；否则下调 `LEGAL_ACTION_CAP` 并复跑，把「候选数安全区」写进结论
- P6：仅记录，不设判据；把 `disagreements` 前 20 条的 `face` 分布写成一句话画像

- [ ] **Step 4: 提交**

```bash
git add tools/laya-probe/run.mjs docs/预研/data/decisions-4p.jsonl docs/预研/data/decisions-8p.jsonl docs/预研/data/probe-raw.json
git commit -m "feat(B16): 影子决策探针 P1/P2/P3/P6（模型不驱动对局）"
```

### Task 16: 浏览器可达性探针（P4）

**Files:**
- Create: `tools/laya-probe/browser.mjs`
- Create: `docs/预研/data/p4-browser.json`

**Interfaces:**
- Consumes: `dist/发布包/数字轨/创界山-活人认证.html`（门 ④ 产物）、反代 `LAYA_PROXY_PORT`、Playwright（既有 devDependency）

- [ ] **Step 1: 实现（`page.on` 必须在 `goto` 之前注册，否则收不到 CORS 报错）**

```js
// tools/laya-probe/browser.mjs
// P4：file:// 打开的单文件 HTML 能否叫到 127.0.0.1:8711。复用门 ⑩ 的 file:// 打开方式。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const PORT = process.env.LAYA_PROXY_PORT ?? '8711';
const html = resolve('dist/发布包/数字轨/创界山-活人认证.html');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(m.text()); } });
page.on('pageerror', (e) => { consoleErrors.push('pageerror: ' + e.message); });

await page.goto(pathToFileURL(html).href);

const health = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url);
    return { reachable: true, status: r.status, body: (await r.text()).slice(0, 200) };
  } catch (e) { return { reachable: false, error: String(e?.message ?? e) }; }
}, `http://127.0.0.1:${PORT}/health`);

const post = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: '座0 位1 血8/8 资源3',
        questions: { act: { type: 'choice', instructions: '选哪个？', criteria: { move: '行棋：掷骰前进', ask: '问天：掷指令骰' } } },
      }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 240) };
  } catch (e) { return { error: String(e?.message ?? e) }; }
}, `http://127.0.0.1:${PORT}/v1/systemone`);

await browser.close();
console.log(JSON.stringify({ P4: { origin: 'file://', health, post, consoleErrors } }, null, 1));
```

- [ ] **Step 2: 跑探针并把失败层次归类**

```bash
npm run build:only
node tools/laya-sidecar/serve.mjs &
node tools/laya-probe/browser.mjs > docs/预研/data/p4-browser.json
cat docs/预研/data/p4-browser.json
```
Expected: `health.reachable = true` 且 `post.status = 200`（反代在跑、官方 serve 不在时 `post.status = 503`）。失败则按 `consoleErrors` 归类并写代价结论：
`OPTIONS 405`（预检没接）／缺 `Access-Control-Allow-Origin`／私有网络访问（PNA）预检被拒／混合内容
最终若不可达，结论为「V2 需要 http 预览服务，放弃双击即玩」——这是产品级取舍，不做技术绕过。

- [ ] **Step 3: 提交**

```bash
git add tools/laya-probe/browser.mjs docs/预研/data/p4-browser.json
git commit -m "feat(B16): P4 浏览器可达性探针（复用门 ⑩ 的 file:// 骨架 + 失败层次取证）"
```

### Task 17: P5 降级自证 + 脚本入口 + 报告落盘

**Files:**
- Create: `tools/laya-probe/skip.mjs`
- Create: `tests/gates/laya-skip.test.ts`
- Modify: `package.json:7-20`（scripts）、`docs/预研/2026-11-08-laya-sidecar.md`

**Interfaces:**
- Produces: `npm run env:laya`、`sidecar:laya`、`probe:laya`、`probe:laya:browser`、`probe:laya:skip`；`skip.mjs` 输出首词恒为 `SKIP`、退出码恒为 0

- [ ] **Step 1: 写常驻负样本（不需要模型、不需要权重）**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('无服务环境：探针 SKIP 且退出码 0（红线 1/2 的常驻负样本）', () => {
  const out = execFileSync(process.execPath, ['tools/laya-probe/skip.mjs'],
    { encoding: 'utf8', env: { ...process.env, LAYA_PROXY_PORT: '1' } });   // 端口 1 必然连不上
  assert.match(out, /^SKIP /);
  const payload = JSON.parse(out.replace(/^SKIP /, '').trim()) as Record<string, unknown>;
  assert.equal(typeof payload.reason, 'string');
  assert.equal(typeof payload.records, 'number');
});
```

- [ ] **Step 2: 实现 `skip.mjs`**

```js
// tools/laya-probe/skip.mjs —— P5：sidecar 不在时必须静默跳过，绝不把错误抛给门禁/CI。
import { existsSync, readdirSync } from 'node:fs';

const port = Number(process.env.LAYA_PROXY_PORT ?? '8711');
const dir = 'docs/预研/data';
const records = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('decisions-')).length : 0;

try {
  const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  if (r.ok) {
    console.log(`SKIP {"reason":"sidecar-ready","status":${r.status},"records":${records}}`);
  } else {
    console.log(`SKIP {"reason":"proxy-says-unavailable","status":${r.status},"records":${records}}`);
  }
} catch (e) {
  const msg = JSON.stringify(String(e?.message ?? e).slice(0, 120));
  console.log(`SKIP {"reason":"no-sidecar","error":${msg},"records":${records}}`);
}
process.exit(0);   // 无服务不是失败
```

- [ ] **Step 3: 加脚本入口（`package.json` 的 `scripts` 内）**

```json
    "env:laya": "node tools/laya-sidecar/env-check.mjs",
    "sidecar:laya": "node tools/laya-sidecar/serve.mjs",
    "probe:laya": "node tools/laya-probe/run.mjs",
    "probe:laya:browser": "node tools/laya-probe/browser.mjs",
    "probe:laya:skip": "node tools/laya-probe/skip.mjs"
```

- [ ] **Step 4: 补齐预研报告（每格填**实测值**；缺环境时按括注写不跑原因）**

```markdown
## P0–P6 读数

| # | 读数 | 实测 | 判据 | 判定 |
|---|---|---|---|---|
| P0 | 环境/venv/对拍 | 取自 `docs/预研/data/p0-env.md` 的采用环境与路线 | 对拍通过 + serve 起得来 | — |
| P1 | 端到端打通率 | `probe-raw.json` 的 summary.P1.answerRate / illegal | ≥0.99 且 illegal=0 | 达标/不达标 |
| P2 | 延迟 p50/p95 | summary.P2.ms_p50 / ms_p95（device=…） | GPU ≤300ms / CPU ≤1500ms | 达标/不达标 |
| P3 | 候选与截断 | summary.P3.maxCandidates / truncated | truncated=0 | 达标/不达标 |
| P4 | 浏览器 file:// | `p4-browser.json` 的 health.reachable / post.status | 通，或给出失败层次 | 达标/不达标 |
| P5 | 无服务降级 | `npm run probe:laya:skip` 的实际输出 | SKIP + 退出码 0 | 达标/不达标 |
| P6 | 分歧率 | summary.P6.agreeRate（仅记录，不设判据） | — | — |

环境缺失时该格写「未跑：本机无权重 / 无 CUDA / create_app 不接受本地权重」，不得留空、也不得下调判据。

## 三条可行性判定
1. 接线：<成 / 不成 + 证据（引 P1）>
2. 延迟：<够 / 不够 + 对真人桌局的影响（引 P2）>
3. 浏览器：<可达 / 需 http 预览 + 代价（引 P4）>

## 对 V2 的建议
- 是否值得做 AI 陪练（引 P1/P2/P6 与规格 §7 的三条 V1 后置理由）
- 是否需要分层决策（先选面再选牌；依据 P3 候选分布与 P6 分歧画像）
- B14 后关隘并入枚举的剩余成本（`COMPARE` 换成真试跑 + 漂移守卫补一条 + balance-report 重跑）

## 红线自证
- `npm run gate` 全绿：<实际尾行>
- `git status --short dist/` 为空（发布包零增量）
- `npm run probe:laya:skip` 退出码 0（无服务不是失败）
```

- [ ] **Step 5: 跑门 ② + 十道门 + 红线自证**

```bash
npm test
npm run gate 2>&1 | tail -20
git status --short dist/
npm run probe:laya:skip; echo "exit=$?"
```
Expected: 十道门全绿；`dist/` 无变化；`skip` 首词 `SKIP` 且 `exit=0`

- [ ] **Step 6: 提交**

```bash
git add tools/laya-probe/skip.mjs tests/gates/laya-skip.test.ts package.json docs/预研/2026-11-08-laya-sidecar.md
git commit -m "feat(B16): P5 无服务降级常驻负样本 + 探针脚本入口 + 预研读数报告落盘"
```

---

## 完成定义（对照设计 §7）

- [ ] P0–P6 全部有实测读数，报告给出接线／延迟／浏览器三条判定与对 V2 的建议
- [ ] 四条常驻测试进 `npm test` 且绿：一致性-正向、漂移守卫、rng 隔离、禁止集
- [ ] `npm run gate` 十道全绿，第 ⑨ 门关键读数与 `docs/balance-report.md` 基线一致
- [ ] `git status --short dist/` 为空、`package.json` 无 Python 依赖、`tools/gate.mjs` 未新增需 sidecar 的条目
- [ ] 主规格 §6.3/§7/§5.3 与 README 已同步；G-a/G-b/G-c 三条登记在案
- [ ] 已纠正的既有缺陷留证：`CERTIFY_APPEAL` 镜像方向、`CERTIFY_VALIDATE_QUESTION` 孤儿枚举、UI 复议投票入口缺失、`abilityId` 标识来源
- [ ] 明确**不包含**：AI 强度结论、sidecar 进产品、关隘可玩（B14）
