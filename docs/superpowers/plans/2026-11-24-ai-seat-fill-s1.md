# AI 补位座位 G4 + S1 核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 G4（seed 可在 UI 指定并随导出保留）与 S1 核心动作闭环（受控座位契约、统一动作提交口、确定性启发式、AI 动作/弃权日志），不越过 Ask 5 与 S3 的未决边界。

**Architecture:** `web/seed.ts` 只负责 seed 文本解析；`Player.controlledBy` 记录座位归属且旧存档默认 `human`；`engine/core/apply-action.ts` 成为 **AI/脚本侧**声明式动作的统一提交口（Web 现有直调入口本轮不改，测试逐字对齐）；`engine/core/heuristic-policy.ts` 只从合法候选里做确定性选择；`engine/core/seat-runner.ts` 把“选动作 → 提交 → 写 AI 事件”收成一个可测试步骤。生产 UI 本轮只接 seed，不开放 AI 座位开关。

**Tech Stack:** TypeScript（strict / exactOptionalPropertyTypes / noUncheckedIndexedAccess）、Node.js `node:test`、Playwright、esbuild 单文件 HTML。

**Spec:** `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` v2.2 §6.2 / §7.5；`spark-output/prd/ai-seat-fill.md`；`spark-output/metric/ai-seat-fill.md`。

## Global Constraints

- **Ask 1 = A（引擎级强制，不靠策略自觉）**：程序座位**不计入认证门槛 N、不持有活人席**；`applyAction` 对 `controlledBy='ai'` 拒绝 `CERTIFY_SIGN` / `CERTIFY_MUTUAL_SIGN` / `CERTIFY_CHALLENGE` / `CERTIFY_ANSWER` / `CERTIFY_APPEAL` / `CERTIFY_APPEAL_VOTE` / `COUNCIL_VETO`；`certifySign` / `certifyMutualSign` 直接调用也拒绝 AI 认证人；认证结算只给人类座位发活人席。启发式仍过滤同一禁止集（优化，不是唯一防线）。认证面只允许 `CERTIFY_ABSTAIN`；AI 作为待认证者时由真人出题/判定，不替它回答。
- **Ask 2 = yes**：零模型、零 sidecar、零网络请求；发布包不新增依赖。
- **G3 已裁**：`seat_filled_by_ai` 与 `seat_offline_temporary` 是两种状态；本轮只实现前者，后者保留类型名但不开放入口。两态超时阈值各 120s，本轮不实现计时器。
- **Ask 5 未拍**：不新增“启用/禁用 AI”工具栏开关，不新增生产 AI 座位选择器；`controlledBy` 仅由引擎/测试/未来配置层设置。
- **S3 未决**：不实现 AI 质疑、AI 作答、AI 申请复议；`certifyAnswer` 的开放项保持原样。
- **State 契约纪律**：新增 `Player` / `LogEntry` 字段前先改规格 §6.2 并追加 v2.3 修订记录；不得新增 `State` 顶层字段（C9 只覆盖顶层）。
- **默认人类路径零漂移**：`controlledBy` 默认 `human`；没有 AI 座位时不得出现 `ai_action_committed` / `ai_forfeit` 日志；门⑨与 release 100 组基线必须逐字节/逐组全等。
- **AI/脚本提交单一入口**：外部决策器只走 `applyAction`；Web 现有直调入口本轮保持不动，由 Task 3 的逐字一致性测试钉住。`probeAction` 继续作为试跑判据，不复制第二套规则镜像。
- **测试依赖方向**：`engine/` 与 `web/` 不得 import `tests/`；集成测试可在 `tests/` 消费生产模块。
- **提交纪律**：逐任务提交，按文件名 `git add`，禁止 `git add -A`；门禁直接跑、不接管道；失败先修根因，不 `--no-verify`。
- **执行隔离**：动代码前用 `superpowers:using-git-worktrees` 建隔离 worktree；当前主工作树存在并行会话，禁止直接在主树施工。
- **批次前置**：B81/B82/B83 已占用；本计划建议下一号为 **B84**，但必须由用户明确批准后才能提交。未批准前只建 worktree 与准备任务，不创建提交、不写执行记录。

---

### Task 1: G4 — seed 可指定、可复现、随导出保留

**Files:**
- Create: `web/seed.ts`
- Create: `tests/web/seed.test.ts`
- Modify: `web/main.ts`（`Ui`、初始状态、`newGame`、`loadGame`、`importSave`、`renderToolbar`）
- Modify: `tests/e2e/duel-e2e.mjs`（在现有门⑩脚本头部追加 seed 导出检查，不新增门）

**Interfaces:**
- Consumes: `State.seed`、`stateToJson`（现有）
- Produces: `DEFAULT_SEED = 42`、`MAX_SEED = 0xffffffff`、`parseSeed(raw: string): number | null`

- [ ] **Step 1: 写失败测试**

创建 `tests/web/seed.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED, MAX_SEED, parseSeed } from '../../web/seed.ts';

test('seed 解析：空/空白/负数/小数/科学计数/超 uint32 一律拒绝', () => {
  for (const raw of ['', '   ', '-1', '1.5', '1e3', '0x10', '4294967296', 'abc']) {
    assert.equal(parseSeed(raw), null, `必须拒绝：${JSON.stringify(raw)}`);
  }
});

test('seed 解析：0、42、uint32 上限与首尾空白可接受', () => {
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed('42'), 42);
  assert.equal(parseSeed(' 123456 '), 123456);
  assert.equal(parseSeed(String(MAX_SEED)), MAX_SEED);
  assert.equal(DEFAULT_SEED, 42);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test tests/web/seed.test.ts`
Expected: FAIL，`web/seed.ts` 不存在或 `parseSeed` 未定义。

- [ ] **Step 3: 写最小实现**

创建 `web/seed.ts`：

```ts
export const DEFAULT_SEED = 42;
export const MAX_SEED = 0xffffffff;

/** 只接受十进制 uint32；拒绝空串、负号、小数、科学计数和十六进制。 */
export function parseSeed(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) { return null; }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SEED) { return null; }
  return value;
}
```

- [ ] **Step 4: 跑单测确认绿**

Run: `node --test tests/web/seed.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 UI 与存档回填**

在 `web/main.ts` 顶部加入：

```ts
import { DEFAULT_SEED, parseSeed } from './seed.ts';
```

`Ui` 增加 `readonly seed: number` 不成立（UI 状态会变），改为：

```ts
seed: number;
```

初始化与 `newGame` 改为：

```ts
state: installTheme(
  createInitialState({ players: 4, seed: DEFAULT_SEED, deckSize: initialTheme.counts.deckTotal }),
  initialTheme,
),
seed: DEFAULT_SEED,
```

```ts
createInitialState({ players: ui.playerCount, seed: ui.seed, deckSize: theme.counts.deckTotal })
```

`loadGame` 与 `importSave` 在 `ui.state = state` 后增加：

```ts
ui.seed = state.seed;
```

`renderToolbar` 在“模式”之后、“操作者”之前插入：

```ts
const seedInput = el('input', {
  class: 'sel seed-input',
  type: 'number',
  min: '0',
  max: '4294967295',
  step: '1',
  value: String(ui.seed),
  'aria-label': 'Seed',
});
seedInput.addEventListener('input', () => {
  const parsed = parseSeed(seedInput.value);
  if (parsed === null) {
    seedInput.setAttribute('aria-invalid', 'true');
    seedInput.setAttribute('title', 'Seed 须为 0–4294967295 的整数；新开一局仍使用上一次有效值。');
    return;
  }
  ui.seed = parsed;
  seedInput.removeAttribute('aria-invalid');
  seedInput.removeAttribute('title');
});
bar.append(el('label', { class: 'lbl', text: 'Seed' }), seedInput);
```

不得改动既有 `select` 的数量与顺序；seed 用 `input`，门⑩现有 `selects.nth(0..3)` 保持不变。

- [ ] **Step 6: 扩展现有浏览器 E2E**

在 `tests/e2e/duel-e2e.mjs` 增加：

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
```

在 `await page.goto(url)` 后、现有 `const selects` 前插入：

```js
const seedInput = page.locator('input[aria-label="Seed"]');
await seedInput.fill('123456');
await page.getByRole('button', { name: '新开一局' }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: '导出' }).click();
const download = await downloadPromise;
const downloadPath = await download.path();
assert.ok(downloadPath, '导出必须产生可读文件');
const envelope = JSON.parse(readFileSync(downloadPath, 'utf8'));
const saved = JSON.parse(envelope.state);
assert.equal(saved.seed, 123456, '导出必须保留 UI 指定的 seed');
assert.equal(saved.rng.initialSeed, 123456, 'RNG 初始种子必须与 UI 指定值一致');
await seedInput.fill('42');
await page.getByRole('button', { name: '新开一局' }).click();
```

- [ ] **Step 7: 跑类型、单测、构建与门⑩**

Run:

```bash
npm run typecheck
node --test tests/web/seed.test.ts
npm run build:only
node tests/e2e/duel-e2e.mjs
```

Expected: 全部 PASS；E2E `consoleErrors` 为空。

- [ ] **Step 8: 提交**

```bash
git add web/seed.ts tests/web/seed.test.ts web/main.ts tests/e2e/duel-e2e.mjs
git commit -m "feat(G4): seed 可指定并随导出保留"
```

---

### Task 2: S1-A — `Player.controlledBy` 契约与旧存档兼容

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（§6.2 + v2.3 修订记录）
- Modify: `engine/core/state.ts`
- Modify: `engine/core/serialize.ts`
- Create: `tests/engine/seat-control.test.ts`

**Interfaces:**
- Consumes: `State` / `Player` / `SerializedState`
- Produces: `export type SeatController = 'human' | 'ai'`；`Player.controlledBy: SeatController`；`isAiSeat(state: State, seat: number): boolean`

- [ ] **Step 1: 先改规格（契约纪律）**

§6.2 的 `Player` 说明后增加：

```ts
controlledBy: 'human' | 'ai'; // 座位控制者；旧存档缺省按 human 归一化
```

在 §6.2 末尾增加：

> **v2.3 补位契约**：`Player.controlledBy` 是座位归属的唯一事实源；新建状态恒为 `human`，只有显式配置才可为 `ai`。旧存档缺该字段时按 `human` 归一化，不升存档版本、不迁移文件。`controlledBy` 不参与任何数值/平衡计算，默认人类路径不得产生 AI 日志。

修订记录追加：

```md
> - **v2.3** 依 **AI 补位 S1** 增补座位控制契约：`Player.controlledBy: 'human' | 'ai'`，新建状态默认 `human`，旧存档缺字段按 `human` 归一化；不改 `State` 顶层、不升存档版本、不动规模数值 ⇒ 门⑨与 release 基线保持全等。后续 AI 运行器只对该字段为 `ai` 的座位生效。
```

- [ ] **Step 2: 写失败测试**

创建 `tests/engine/seat-control.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { deserializeState, serializeState, stateFromJson, stateToJson } from '../../engine/core/serialize.ts';

test('新建状态所有座位 controlledBy=human', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  assert.deepEqual(s.players.map((p) => p.controlledBy), ['human', 'human', 'human', 'human']);
});

test('controlledBy=ai 可序列化并原样还原', () => {
  const base = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  const s: State = {
    ...base,
    players: base.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' } : p),
  };
  const restored = stateFromJson(stateToJson(s));
  assert.equal(restored.players[2]?.controlledBy, 'ai');
  assert.equal(restored.players[0]?.controlledBy, 'human');
});

test('旧存档缺 controlledBy 时按 human 归一化，不抛错', () => {
  const base = createInitialState({ players: 3, seed: 9, deckSize: 40 });
  const raw = serializeState(base) as unknown as {
    state: { players: Array<Record<string, unknown>> };
  };
  delete raw.state.players[0]!.controlledBy;
  const restored = deserializeState(raw);
  assert.equal(restored.players[0]?.controlledBy, 'human');
});
```

- [ ] **Step 3: 跑测试确认红**

Run: `node --test tests/engine/seat-control.test.ts`
Expected: FAIL，`controlledBy` 不存在。

- [ ] **Step 4: 改 State 与序列化**

`engine/core/state.ts` 在 `Player` 接口增加：

```ts
/** 座位控制者；旧存档缺省按 human 归一化（v2.3）。 */
readonly controlledBy: SeatController;
```

文件内导出类型：

```ts
export type SeatController = 'human' | 'ai';
```

`createInitialState` 的玩家字面量增加：

```ts
controlledBy: 'human',
```

在 `State` 接口后增加唯一判据：

```ts
/** 座位是否由程序控制；旧存档缺 controlledBy 时 serialize 层已归一化为 human。 */
export function isAiSeat(state: State, seat: number): boolean {
  return state.players[seat]?.controlledBy === 'ai';
}
```

`engine/core/serialize.ts` 解码返回前归一化：

```ts
const players = rest.players.map((p) => ({
  ...p,
  controlledBy: p.controlledBy ?? 'human',
}));
return { ...rest, players, turnOrder, liveSeats, duel, publicCards, rng: Rng.fromSnapshot(rngRaw.initialSeed, rngRaw.snapshot) };
```

- [ ] **Step 5: 跑测试与类型检查**

Run:

```bash
node --test tests/engine/seat-control.test.ts tests/engine/state-contract.test.ts
npm run typecheck
npm run doc-sync
```

Expected: 全部 PASS；C9 不出现新顶层字段漂移。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md engine/core/state.ts engine/core/serialize.ts tests/engine/seat-control.test.ts
git commit -m "feat(S1): 增加 controlledBy 座位契约与旧存档归一化"
```

---

### Task 3: S1-B — 统一动作提交口 `applyAction`

**Files:**
- Create: `engine/core/apply-action.ts`
- Create: `tests/engine/apply-action.test.ts`

**Interfaces:**
- Consumes: `Action`、`State`、`RuleMode`、现有 11 类引擎入口
- Produces: `applyAction(state: State, action: Action, mode?: RuleMode): State`；拒绝时返回原引用

- [ ] **Step 1: 写失败测试（先覆盖六族语义）**

创建 `tests/engine/apply-action.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../../engine/core/apply-action.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { castVote } from '../../engine/core/council.ts';
import { certifyAbstain } from '../../engine/core/certification.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { councilScene, mk, pendingScene } from './fixtures.ts';

test('行动面：MOVE 与真实 UI 路径 performAction + advanceTurn 逐字一致', () => {
  const s = mk(4, 7);
  const expected = advanceTurn(performAction(s, 0, 'move'), 'standard');
  assert.deepEqual(applyAction(s, { type: 'MOVE', actor: 0, steps: 0 }), expected);
});

test('行动面：ROLL_WHEEL 与真实路径逐字一致', () => {
  const s = mk(4, 11);
  const expected = advanceTurn(performAction(s, 0, 'ask'), 'standard');
  assert.deepEqual(applyAction(s, { type: 'ROLL_WHEEL', actor: 0 }), expected);
});

test('拒绝语义：非法 VOTE 返回原引用', () => {
  const s = councilScene(4, 7);
  assert.equal(applyAction(s, { type: 'VOTE', actor: 0, target: 0 }), s);
});

test('Ask1=A 引擎级强制：AI 认证人即使拿到合法 SIGN 候选也被提交口拒绝', () => {
  const base = pendingScene(4, 7);
  const s = {
    ...base,
    players: base.players.map((p) => p.seat === 1 ? { ...p, controlledBy: 'ai' as const } : p),
  };
  const legalSign = getLegalActions(s, 1).find((a) => a.type === 'CERTIFY_SIGN');
  assert.ok(legalSign, '前提：人类认证人确有 SIGN 候选');
  assert.equal(applyAction(s, legalSign), s);
});

test('山议面：VOTE 不推进手番，与 castVote 逐字一致', () => {
  const s = councilScene(4, 7);
  const expected = castVote(s, 0, 1);
  assert.equal(expected.ok, true);
  assert.deepEqual(applyAction(s, { type: 'VOTE', actor: 0, target: 1 }), expected.state);
});

test('认证面：CERTIFY_ABSTAIN 不推进手番，与引擎入口逐字一致', () => {
  const s = pendingScene(4, 7);
  const expected = certifyAbstain(s, 1, 0);
  assert.equal(expected.ok, true);
  assert.deepEqual(applyAction(s, { type: 'CERTIFY_ABSTAIN', actor: 1, target: 0 }), expected.state);
});

test('候选一致性：对每个真实候选 applyAction 都不得原样返回', () => {
  const scenes = [mk(4, 7), councilScene(4, 7), pendingScene(4, 7)];
  for (const s of scenes) {
    for (const seat of s.players.map((p) => p.seat)) {
      for (const action of getLegalActions(s, seat)) {
        assert.notEqual(applyAction(s, action), s, `合法候选被提交口拒绝：${actionKey(action)}`);
      }
    }
  }
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test tests/engine/apply-action.test.ts`
Expected: FAIL，`apply-action.ts` 不存在。

- [ ] **Step 3: 实现 AI/脚本统一分派**

创建 `engine/core/apply-action.ts`：

```ts
import type { Action, ActionType } from './action.ts';
import { isAiSeat, type State } from './state.ts';
import type { RuleMode } from '../scales.ts';
import { advanceTurn, performAction } from './turn-runner.ts';
import { performAbility } from './abilities.ts';
import { castVote, useCouncilVeto } from './council.ts';
import { resolveGate, resolveCompareGate } from './gate.ts';
import { resolveBarrier } from './barrier.ts';
import { submitDuelCard } from './duel.ts';
import {
  certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote,
  certifyChallenge, certifyMutualSign, certifySign,
} from './certification.ts';

type FlagResult = { readonly ok: boolean; readonly state: State };

const AI_FORBIDDEN: ReadonlySet<ActionType> = new Set<ActionType>([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

const accepted = (state: State, result: FlagResult): State => result.ok ? result.state : state;
const actionThenAdvance = (state: State, next: State, mode: RuleMode): State =>
  next === state ? state : advanceTurn(next, mode);

/** AI/脚本侧声明式动作统一提交口；拒绝 = 返回原引用（与 performAction 同形）。 */
export function applyAction(state: State, action: Action, mode: RuleMode = 'standard'): State {
  if (isAiSeat(state, action.actor) && AI_FORBIDDEN.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'MOVE':
      return actionThenAdvance(state, performAction(state, action.actor, 'move'), mode);
    case 'ROLL_WHEEL':
      return actionThenAdvance(state, performAction(state, action.actor, 'ask'), mode);
    case 'PLAY_CARD':
      return actionThenAdvance(state, performAction(state, action.actor, 'act', {
        cardId: action.cardId,
        ...(action.target === undefined ? {} : { target: action.target }),
      }), mode);
    case 'ABILITY': {
      const r = performAbility(state, action.actor, action.target);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'COMPARE': {
      const r = resolveCompareGate(state, action.actor, action.cardId, action.target);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'GATE_RESOLVE': {
      const r = resolveGate(state, action.actor, action.channel);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'BARRIER_RESOLVE': {
      const r = resolveBarrier(state, action.actor, action.channel);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'PASS':
      return actionThenAdvance(state, performAction(state, action.actor, 'pass'), mode);
    case 'VOTE':
      return accepted(state, castVote(state, action.actor, action.target));
    case 'CERTIFY_SIGN':
      return accepted(state, certifySign(state, action.actor, action.target));
    case 'CERTIFY_CHALLENGE':
      return accepted(state, certifyChallenge(state, action.actor, action.target));
    case 'CERTIFY_ABSTAIN':
      return accepted(state, certifyAbstain(state, action.actor, action.target));
    case 'CERTIFY_APPEAL':
      return accepted(state, certifyAppeal(state, action.actor, action.target));
    case 'CERTIFY_APPEAL_VOTE':
      return accepted(state, certifyAppealVote(state, action.actor, action.target, action.overturn));
    case 'CERTIFY_ANSWER':
      return accepted(state, certifyAnswer(state, action.actor, action.target, action.passed));
    case 'CERTIFY_MUTUAL_SIGN':
      return accepted(state, certifyMutualSign(state, action.actor, action.target));
    case 'DUEL_SUBMIT_CARD': {
      const r = submitDuelCard(state, action.actor, action.cardId);
      if (!r.ok) { return state; }
      return r.state.duel === null ? advanceTurn(r.state, mode) : r.state;
    }
    case 'EQUIP_CARD':
      return actionThenAdvance(state, performAction(state, action.actor, 'equip', { cardId: action.cardId }), mode);
    case 'COUNCIL_VETO':
      return accepted(state, useCouncilVeto(state, action.actor));
    case 'RECUPERATE':
      return actionThenAdvance(state, performAction(state, action.actor, 'recuperate',
        action.target === undefined ? {} : { target: action.target }), mode);
  }
}
```

说明：`MOVE.steps` 与 `ABILITY.abilityId` 保持现有引擎语义（骰面/身份被动由引擎决定），提交口不另造规则镜像；调用方必须只传 `getLegalActions` 枚举出的动作。

- [ ] **Step 4: 跑测试与类型检查**

Run:

```bash
node --test tests/engine/apply-action.test.ts tests/engine/legal-probe.test.ts
npm run typecheck
```

Expected: 全部 PASS；穷尽 switch 保证新增 `ActionType` 时编译失败。

- [ ] **Step 5: 提交**

```bash
git add engine/core/apply-action.ts tests/engine/apply-action.test.ts
git commit -m "feat(S1): 增加声明式动作统一提交口"
```

---

### Task 4: S1-C — 确定性 `HeuristicPolicy`（只选合法动作）

**Files:**
- Create: `engine/core/heuristic-policy.ts`
- Create: `tests/engine/heuristic-policy.test.ts`

**Interfaces:**
- Consumes: `State`、`Action`、`ActionType`
- Produces:
  - `export interface SeatPolicy { choose(state: State, playerId: number, legal: readonly Action[]): Action | null }`
  - `export const heuristicPolicy: SeatPolicy`
  - `export function policyBand(action: Action): 1 | 2 | 3`

- [ ] **Step 1: 写失败测试**

创建 `tests/engine/heuristic-policy.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicPolicy, policyBand } from '../../engine/core/heuristic-policy.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { councilScene, mk, pendingScene } from './fixtures.ts';

const FORBIDDEN = new Set([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

test('启发式只从传入合法候选里选择，且确定性', () => {
  for (const s of [mk(6, 7), councilScene(6, 7), pendingScene(6, 7)]) {
    for (const seat of s.players.map((p) => p.seat)) {
      const legal = getLegalActions(s, seat);
      const a = heuristicPolicy.choose(s, seat, legal);
      const b = heuristicPolicy.choose(s, seat, legal);
      assert.deepEqual(a, b);
      if (a !== null) {
        assert.ok(legal.some((x) => actionKey(x) === actionKey(a)), '选择了候选集外动作');
        assert.equal(FORBIDDEN.has(a.type), false, `Ask1=A 禁止动作：${a.type}`);
      }
    }
  }
});

test('认证面只弃权，不签印/质疑/作答', () => {
  const s = pendingScene(6, 7);
  const legal = getLegalActions(s, 1);
  const picked = heuristicPolicy.choose(s, 1, legal);
  assert.equal(picked?.type, 'CERTIFY_ABSTAIN');
});

test('空候选返回 null，不编造动作', () => {
  const s = mk(4, 7);
  assert.equal(heuristicPolicy.choose(s, 0, []), null);
});

test('降级带：阻塞动作=1，常规行动=2，出牌/装备/PASS=3', () => {
  const s = mk(4, 7);
  const vote = getLegalActions(councilScene(4, 7), 0).find((a) => a.type === 'VOTE');
  assert.ok(vote);
  assert.equal(policyBand(vote), 1);
  assert.equal(policyBand({ type: 'MOVE', actor: 0, steps: 0 }), 2);
  assert.equal(policyBand({ type: 'PASS', actor: 0 }), 3);
  assert.equal(policyBand({ type: 'PLAY_CARD', actor: 0, cardId: 'x' }), 3);
  assert.ok(s);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test tests/engine/heuristic-policy.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现策略**

创建 `engine/core/heuristic-policy.ts`：

```ts
import type { Action, ActionType } from './action.ts';
import type { State } from './state.ts';

export interface SeatPolicy {
  choose(state: State, playerId: number, legal: readonly Action[]): Action | null;
}

const FORBIDDEN: ReadonlySet<ActionType> = new Set<ActionType>([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

const BAND: Readonly<Record<ActionType, 1 | 2 | 3>> = {
  COMPARE: 1,
  GATE_RESOLVE: 1, BARRIER_RESOLVE: 1, DUEL_SUBMIT_CARD: 1,
  VOTE: 1, CERTIFY_ABSTAIN: 1,
  MOVE: 2, ROLL_WHEEL: 2, ABILITY: 2, RECUPERATE: 2,
  PLAY_CARD: 3, EQUIP_CARD: 3, PASS: 3,
  CERTIFY_SIGN: 3, CERTIFY_MUTUAL_SIGN: 3, CERTIFY_CHALLENGE: 3,
  CERTIFY_ANSWER: 3, CERTIFY_APPEAL: 3, CERTIFY_APPEAL_VOTE: 3,
  COUNCIL_VETO: 3,
};

export function policyBand(action: Action): 1 | 2 | 3 {
  return BAND[action.type];
}

const TYPE_ORDER: Readonly<Partial<Record<ActionType, number>>> = {
  COMPARE: 0,
  GATE_RESOLVE: 1, BARRIER_RESOLVE: 2, DUEL_SUBMIT_CARD: 3,
  VOTE: 4, CERTIFY_ABSTAIN: 5,
  MOVE: 6, ROLL_WHEEL: 7, ABILITY: 8, RECUPERATE: 9,
  PLAY_CARD: 10, EQUIP_CARD: 11, PASS: 12,
};

function cardRank(state: State, seat: number, cardId: string): number {
  return state.players[seat]?.hand.find((c) => c.id === cardId)?.rank ?? 0;
}

function compareActions(state: State, a: Action, b: Action): number {
  const band = policyBand(a) - policyBand(b);
  if (band !== 0) { return band; }
  const order = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
  if (order !== 0) { return order; }
  if (a.type === 'GATE_RESOLVE' && b.type === 'GATE_RESOLVE') {
    return (a.channel === 'pay' ? 0 : 1) - (b.channel === 'pay' ? 0 : 1);
  }
  if (a.type === 'BARRIER_RESOLVE' && b.type === 'BARRIER_RESOLVE') {
    return (a.channel === 'skip' ? 0 : 1) - (b.channel === 'skip' ? 0 : 1);
  }
  if (a.type === 'VOTE' && b.type === 'VOTE') { return a.target - b.target; }
  if (a.type === 'CERTIFY_ABSTAIN' && b.type === 'CERTIFY_ABSTAIN') { return a.target - b.target; }
  if (a.type === 'RECUPERATE' && b.type === 'RECUPERATE') {
    return (a.target ?? -1) - (b.target ?? -1);
  }
  const aCard = a.type === 'PLAY_CARD' || a.type === 'EQUIP_CARD' || a.type === 'DUEL_SUBMIT_CARD';
  const bCard = b.type === 'PLAY_CARD' || b.type === 'EQUIP_CARD' || b.type === 'DUEL_SUBMIT_CARD';
  if (aCard && bCard) {
    const aId = a.type === 'PLAY_CARD' || a.type === 'EQUIP_CARD' || a.type === 'DUEL_SUBMIT_CARD' ? a.cardId : '';
    const bId = b.type === 'PLAY_CARD' || b.type === 'EQUIP_CARD' || b.type === 'DUEL_SUBMIT_CARD' ? b.cardId : '';
    return cardRank(state, a.actor, aId) - cardRank(state, b.actor, bId) || aId.localeCompare(bId);
  }
  return 0;
}

export const heuristicPolicy: SeatPolicy = {
  choose(state, playerId, legal) {
    const candidates = legal.filter((a) => a.actor === playerId && !FORBIDDEN.has(a.type));
    candidates.sort((a, b) => compareActions(state, a, b));
    return candidates[0] ?? null;
  },
};
```

- [ ] **Step 4: 跑测试与类型检查**

Run:

```bash
node --test tests/engine/heuristic-policy.test.ts
npm run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add engine/core/heuristic-policy.ts tests/engine/heuristic-policy.test.ts
git commit -m "feat(S1): 增加确定性启发式座位策略"
```

---

### Task 5: S1-D — 座位运行器与 AI 事件日志

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（§6.2 LogEntry 可选字段，仍属 v2.3）
- Modify: `engine/core/state.ts`（`LogEntry` 增可选元数据）
- Modify: `engine/core/certification.ts`（AI 认证人拒绝 + AI 不授活人席）
- Create: `engine/core/seat-runner.ts`
- Create: `tests/engine/seat-runner.test.ts`

**Interfaces:**
- Consumes: `SeatPolicy`、`applyAction`、`getLegalActions`、`actionKey`
- Produces:
  - `export type SeatMode = 'seat_filled_by_ai' | 'seat_offline_temporary'`
  - `export interface SeatStepResult { state: State; action: Action | null; accepted: boolean; degradeLevel: 1 | 2 | 3; reason: string }`
  - `export function runSeatStep(state: State, seat: number, policy: SeatPolicy, mode: RuleMode, seatMode: SeatMode = 'seat_filled_by_ai'): SeatStepResult`

- [ ] **Step 1: 规格补 LogEntry 元数据**

§6.2 `log` 行注释后增加：

```ts
// AI 事件可选元数据（默认人类路径不写，v2.3）：
// actionKey?: string; degradeLevel?: 1 | 2 | 3; seatMode?: 'seat_filled_by_ai' | 'seat_offline_temporary';
```

并增加一句：

> AI 运行器只写 `kind='ai_action_committed'` 或 `kind='ai_forfeit'`；两类事件都必须带 `seatMode`，动作事件还必须带 `actionKey` / `degradeLevel`。元数据缺省不影响旧存档与旧日志解析。

- [ ] **Step 2: 写失败测试**

创建 `tests/engine/seat-runner.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeatStep } from '../../engine/core/seat-runner.ts';
import { heuristicPolicy } from '../../engine/core/heuristic-policy.ts';
import type { SeatPolicy } from '../../engine/core/heuristic-policy.ts';
import type { State } from '../../engine/core/state.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { certifyMutualSign, certifySign, advanceCertificationRound } from '../../engine/core/certification.ts';
import { mk, pendingScene } from './fixtures.ts';

function withAi(s: State, seat = 0): State {
  return { ...s, players: s.players.map((p) => p.seat === seat ? { ...p, controlledBy: 'ai' } : p) };
}

test('AI 座位提交合法动作并写 actionKey/degradeLevel/seatMode', () => {
  const s = withAi(mk(6, 7));
  const r = runSeatStep(s, 0, heuristicPolicy, 'standard');
  assert.equal(r.accepted, true);
  assert.ok(r.action);
  assert.notEqual(r.state, s);
  const event = r.state.log.at(-1);
  assert.equal(event?.kind, 'ai_action_committed');
  assert.equal(event?.actionKey, actionKey(r.action));
  assert.equal(event?.degradeLevel, r.degradeLevel);
  assert.equal(event?.seatMode, 'seat_filled_by_ai');
});

test('策略返回候选集外动作时拒绝并写 ai_forfeit', () => {
  const s = withAi(mk(4, 7));
  const bad: SeatPolicy = { choose: () => ({ type: 'PASS', actor: 1 }) };
  const r = runSeatStep(s, 0, bad, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('无合法候选时显式 ai_forfeit(blocked)，不静默跳过', () => {
  const s = withAi(mk(4, 7));
  const none: SeatPolicy = { choose: () => null };
  const r = runSeatStep(s, 0, none, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.action, null);
  assert.equal(r.reason, 'blocked');
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
});

test('自定义策略提交 AI 禁止动作时由提交口拒绝并写 ai_forfeit(engine_rejected)', () => {
  const base = pendingScene(4, 7);
  const s = withAi(base, 1);
  const sign = { type: 'CERTIFY_SIGN', actor: 1, target: 0 } as const;
  const policy: SeatPolicy = { choose: () => sign };
  const r = runSeatStep(s, 1, policy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'engine_rejected');
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
});

test('认证入口直接调用也拒绝 AI 认证人签印/互签', () => {
  const base = pendingScene(4, 7);
  const s = withAi(base, 1);
  assert.equal(certifySign(s, 1, 0).ok, false);
  const twoPending = pendingScene(4, 7);
  const withTwo = {
    ...twoPending,
    players: twoPending.players.map((p) => p.seat === 1 ? { ...p, controlledBy: 'ai' as const } : p),
  };
  assert.equal(certifyMutualSign(withTwo, 1, 0).ok, false);
});

test('AI 待认证者即使被真人签够，也不获得活人席', () => {
  const base = pendingScene(4, 7);
  let s = withAi(base, 0);
  for (const seat of [1, 2, 3]) {
    const r = certifySign(s, seat, 0);
    assert.equal(r.ok, true, `真人座 ${seat} 签印必须成功`);
    s = r.state;
  }
  const closed = advanceCertificationRound(s);
  assert.equal(closed.ok, true);
  assert.equal(closed.state.liveSeats[0], undefined, 'AI 不得持有活人席');
  assert.equal(closed.state.players[0]?.pendingCert, false, 'AI 认证结束后仍回到山道');
});

test('人类座位不产生 AI 事件', () => {
  const s = mk(4, 7);
  const r = runSeatStep(s, 0, heuristicPolicy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'not_ai_seat');
  assert.equal(r.state, s);
});
```

- [ ] **Step 3: 跑测试确认红**

Run: `node --test tests/engine/seat-runner.test.ts`
Expected: FAIL，模块/日志字段不存在。

- [ ] **Step 4: 扩 LogEntry 并实现运行器**

`engine/core/state.ts` 的 `LogEntry` 末尾增加：

```ts
readonly actionKey?: string;
readonly degradeLevel?: 1 | 2 | 3;
readonly seatMode?: 'seat_filled_by_ai' | 'seat_offline_temporary';
```

`engine/core/certification.ts` 增加 `isAiSeat` 导入，并在两个签印入口早退：

```ts
// certifySign：isCertifier 检查之后
if (isAiSeat(state, actor)) { return fail(state, '程序座位没有签印权'); }

// certifyMutualSign：pending 双方检查之后
if (isAiSeat(state, actor)) { return fail(state, '程序座位没有签印权'); }
```

认证结算发活人席处只给人类座位：

```ts
for (const seat of certified) {
  if (isAiSeat(state, seat)) { continue; }
  liveSeats[seat] = (liveSeats[seat] ?? 0) + 1;
}
```

AI 仍可从 `certified` 名单回到山道起点、解除待认证，只是不增加 `liveSeats`。

创建 `engine/core/seat-runner.ts`：

```ts
import type { Action } from './action.ts';
import { isAiSeat, type State } from './state.ts';
import type { RuleMode } from '../scales.ts';
import { actionKey } from './action-key.ts';
import { currentPlayer } from './round.ts';
import { getLegalActions } from './legal.ts';
import { applyAction } from './apply-action.ts';
import { policyBand, type SeatPolicy } from './heuristic-policy.ts';

export type SeatMode = 'seat_filled_by_ai' | 'seat_offline_temporary';

export interface SeatStepResult {
  readonly state: State;
  readonly action: Action | null;
  readonly accepted: boolean;
  readonly degradeLevel: 1 | 2 | 3;
  readonly reason: string;
}

function forfeit(state: State, seat: number, seatMode: SeatMode, reason: string): SeatStepResult {
  return {
    state: {
      ...state,
      log: [...state.log, {
        round: state.round, turnIndex: state.turnIndex, actor: seat,
        kind: 'ai_forfeit', message: `程序座位弃权：${reason}`, seatMode,
      }],
    },
    action: null,
    accepted: false,
    degradeLevel: 3,
    reason,
  };
}

export function runSeatStep(
  state: State,
  seat: number,
  policy: SeatPolicy,
  mode: RuleMode,
  seatMode: SeatMode = 'seat_filled_by_ai',
): SeatStepResult {
  if (!isAiSeat(state, seat)) {
    return { state, action: null, accepted: false, degradeLevel: 3, reason: 'not_ai_seat' };
  }
  if (seatMode === 'seat_offline_temporary') {
    return { state, action: null, accepted: false, degradeLevel: 3, reason: 'offline_mode_not_implemented' };
  }
  const legal = getLegalActions(state, seat);
  const action = policy.choose(state, seat, legal);
  if (action === null) { return forfeit(state, seat, seatMode, 'blocked'); }
  if (action.actor !== seat || !legal.some((a) => actionKey(a) === actionKey(action))) {
    return forfeit(state, seat, seatMode, 'illegal_choice');
  }
  const turnOnly = new Set<Action['type']>([
    'MOVE', 'ROLL_WHEEL', 'PLAY_CARD', 'ABILITY', 'COMPARE',
    'GATE_RESOLVE', 'BARRIER_RESOLVE', 'PASS', 'EQUIP_CARD', 'RECUPERATE',
  ]);
  if (turnOnly.has(action.type) && currentPlayer(state) !== seat) {
    return forfeit(state, seat, seatMode, 'wrong_turn');
  }
  if (action.type === 'DUEL_SUBMIT_CARD'
    && state.duel !== null
    && action.actor !== state.duel.seatA
    && action.actor !== state.duel.seatB) {
    return forfeit(state, seat, seatMode, 'wrong_turn');
  }
  const next = applyAction(state, action, mode);
  if (next === state) { return forfeit(state, seat, seatMode, 'engine_rejected'); }
  const degradeLevel = policyBand(action);
  return {
    state: {
      ...next,
      log: [...next.log, {
        round: next.round, turnIndex: next.turnIndex, actor: seat,
        kind: 'ai_action_committed', message: `程序座位行动：${actionKey(action)}`,
        actionKey: actionKey(action), degradeLevel, seatMode,
      }],
    },
    action,
    accepted: true,
    degradeLevel,
    reason: 'committed',
  };
}
```

- [ ] **Step 5: 跑测试、类型与文档同步**

Run:

```bash
node --test tests/engine/seat-runner.test.ts tests/engine/seat-control.test.ts tests/engine/apply-action.test.ts tests/engine/heuristic-policy.test.ts
npm run typecheck
npm run doc-sync
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md engine/core/state.ts engine/core/certification.ts engine/core/seat-runner.ts tests/engine/seat-runner.test.ts
git commit -m "feat(S1): 增加座位运行器与 AI 事件日志"
```

---

### Task 6: S1-E — 真实决策点集成回归（不接 UI 开关）

**Files:**
- Create: `tests/engine/heuristic-policy-integration.test.ts`

**Interfaces:**
- Consumes: `tests/sim/policy.mjs::playOne`、`FacePolicy`、生产 `heuristicPolicy`
- Produces: 无生产接口；只增加常驻回归证据

- [ ] **Step 1: 写集成测试**

创建 `tests/engine/heuristic-policy-integration.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';
import type { FacePolicy } from '../../tests/sim/policy.d.mts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { heuristicPolicy } from '../../engine/core/heuristic-policy.ts';
import { actionKey } from '../../engine/core/action-key.ts';

const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
const FORBIDDEN = new Set([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

test('6 人局真实决策点：启发式在 play/council/certify 三面均零回落、不选禁止动作', async () => {
  for (const face of ['play', 'council', 'certify'] as const) {
    for (const seed of [7, 11, 17]) {
      const policy: FacePolicy = {
        face,
        seat: 2,
        decide: async (state, seat, candidates) => {
          const picked = heuristicPolicy.choose(state, seat, candidates);
          if (picked === null) { return null; }
          assert.equal(FORBIDDEN.has(picked.type), false, `${face}/${seed} 选了禁止动作 ${picked.type}`);
          return actionKey(picked);
        },
      };
      const result = await playOne(theme, 6, seed, undefined, policy);
      assert.equal(result.injection.fallbacks, 0, `${face}/${seed} 不得回落原启发式`);
      assert.ok(result.injection.calls > 0, `${face}/${seed} 必须真的到达决策点`);
      assert.equal(result.anomalies.includes('未分出胜负'), false, `${face}/${seed} 必须正常终局`);
      assert.ok(result.winners.length > 0, `${face}/${seed} 必须产出胜者`);
      assert.equal(result.anomalies.some((a) => a.includes('死循环')), false, `${face}/${seed} 不得死循环`);
    }
  }
});
```

- [ ] **Step 2: 跑测试确认基线**

Run: `node --test tests/engine/heuristic-policy-integration.test.ts`
Expected: PASS。若红，先按 systematic-debugging 查真实决策点，不放宽断言。

- [ ] **Step 3: 提交**

```bash
git add tests/engine/heuristic-policy-integration.test.ts
git commit -m "test(S1): 锁定真实决策点零回落与禁止动作边界"
```

---

### Task 7: S1 收口验证与默认路径零漂移证明

**Files:**
- Modify: `spark-output/context/prd.json`（把 S1 核心标为已实现，UI 开关仍 blocked on Ask 5）
- Modify: `spark-output/prd/ai-seat-fill.md`（§0 / §6 S1 状态）
- Modify: `spark-output/README-归档索引.md`（状态行）

- [ ] **Step 1: 跑完整验证**

Run（不接管道）：

```bash
npm run typecheck
node --test tests/web/seed.test.ts tests/engine/seat-control.test.ts tests/engine/apply-action.test.ts tests/engine/heuristic-policy.test.ts tests/engine/seat-runner.test.ts tests/engine/heuristic-policy-integration.test.ts
npm run build:only
node tests/e2e/duel-e2e.mjs
npm run gate
npm run release:check
```

Expected：
- 类型 0 错；定向测试全绿；E2E 0 console error；
- `npm run gate` 13 门全绿；
- `release:check` 100 组逐组一致、零漂移（默认人类路径不得受 `controlledBy` / AI 日志影响）。

- [ ] **Step 2: 回写状态**

`prd.json` 根节点增加（该文件没有“S1 条目”，不要伪造路径）：

```json
"implementation_status": "core_done_ui_blocked_on_ask5",
"implemented": ["G4 seed UI/export", "Player.controlledBy + legacy normalization", "applyAction dispatcher", "HeuristicPolicy", "runSeatStep + AI logs"],
"not_implemented": ["production AI seat selector", "Ask5 ban switch", "seat_offline_temporary timer", "S3 challenge/answer"]
```

PRD §0 增加：

> **S1 核心已实现（2026-11-24）**：seed 可指定并随导出保留；`controlledBy` / `applyAction` / `HeuristicPolicy` / `runSeatStep` 已落地并有真实决策点回归。**生产 AI 座位开关仍未实现**，因为 Ask 5 未拍；S3 的质疑/作答路径仍未开放。

- [ ] **Step 3: 提交**

```bash
git add spark-output/context/prd.json spark-output/prd/ai-seat-fill.md spark-output/README-归档索引.md
git commit -m "docs(S1): 回写核心实现状态与未决边界"
```

---

## Self-Review

- **Spec coverage**：G4 ↔ Task 1；C7 `controlledBy` ↔ Task 2；C5 统一提交/三级降级 ↔ Task 3–5；Ask 1=A ↔ Task 4 禁止集 + Task 6 真实决策点；默认人类路径零漂移 ↔ Task 7 release:check。
- **明确不覆盖**：Ask 4（真人局日期）、Ask 5（生产开关）、S3（AI 质疑/作答/复议）、`seat_offline_temporary` 计时器、Host 多端。它们都有已登记的去处，不用 TODO 混进本计划。
- **类型一致性**：`SeatPolicy.choose` 在 Task 4 定义，Task 5/6 沿用；`applyAction` 在 Task 3 定义，Task 5 沿用；`controlledBy` 在 Task 2 定义，Task 5 读取；`SeatMode` 在 Task 5 定义并用于日志。
- **占位符扫描**：本计划无 “TBD / implement later / similar to Task N”；所有代码步骤均给出实际测试或实现代码。
- **执行前检查**：必须先建隔离 worktree；主树当前有并行会话，不得直接施工。
