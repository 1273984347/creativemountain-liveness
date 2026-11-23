# B85 Ask 4 实拍采集缺失项实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Ask 4 实拍局所需的 `human_takeover_click`、AI/人类墙钟耗时、观察员面板与本地记录导出，使 5 真人 + 1 AI 的实拍局可以按现有当场表采集数据。

**Architecture:** 新增独立 `playtest` 构建入口，通过 URL 参数指定 `seed` 与 `aiSeat`；生产 `main.ts` 仅保留编译期死代码开关，正常发布包不包含实拍页。实拍事件存储在浏览器内存的独立事件表，不写入 `State.log`，因此固定 seed 的引擎日志与 release 基线不受墙钟影响。

**Tech Stack:** TypeScript、DOM API、Playwright、esbuild（同一源码两次构建，`PLAYTEST_MODE` 编译期常量）。

**Spec:** `spark-output/metric/ai-seat-fill.md`、`spark-output/metric/playtest-field-sheet.md`、`spark-output/prd/ai-seat-fill.md`、主规格 §7.5。

## Global Constraints

- **Ask 5 未拍**：生产 UI 不得新增 AI 座位选择器、启用/禁用开关或可见的实拍入口。
- **独立实拍构建**：仅 `dist/创界山-活人认证-实拍.html` 提供 `?playtest=1&seed=<uint32>&aiSeat=<0..5>` 配置（固定 6 人局）；发布包只复制生产 HTML。
- **零模型、零 sidecar、零网络、零新依赖**；所有记录只留在浏览器内存与用户主动下载的 JSON。
- **引擎确定性不被污染**：墙钟时间与观察事件不进入 `State.log`；生产构建必须通过死代码消除移除实拍代码。
- **AI 只走生产路径**：实拍 AI 必须调用 B84 的 `runSeatStep` → `applyAction`，不得在测试/UI 侧复制规则。
- **无合法候选不无限重试**：同一局面签名只记录一次 `ai_forfeit`；状态实质变化后才允许再次决策。
- **墙钟可测试**：统一接受 `now: () => number`，单测注入假时钟；浏览器使用 `performance.now`。
- **记录最小化**：只记座位号、轮次、动作键、时长与观察编码，不记姓名、设备标识、IP 或自由聊天。
- **门禁数量不变**：不新增第 14 门；扩展现有 `tests/e2e/duel-e2e.mjs`，让门⑩同时验证生产页与实拍页。
- **默认人类路径零漂移**：生产 HTML 无实拍面板、无 AI 自动运行、无额外事件；release 100 组必须全等。
- **提交纪律**：逐任务提交、按文件名 `git add`，禁止 `git add -A`、`--no-verify`、push。
- **批次前置**：B84 已合并，B85 是下一可用号，但须用户明确批准后才创建提交与执行记录；未批准前只写计划、不施工。

---

### Task 1: 实拍配置与事件模型（纯函数）

**Files:**
- Create: `web/playtest-events.ts`
- Create: `tests/web/playtest-events.test.ts`

**Interfaces:**
- Produces:
  - `export interface PlaytestConfig { readonly seed: number; readonly aiSeat: number }`
  - `export function parsePlaytestConfig(search: string): PlaytestConfig | null`
  - `export type PlaytestEvent = ...`（下方联合）
  - `export class PlaytestEventStore { record(event): PlaytestEvent; setMetadata(metadata: { themeId: string; players: number; mode: string }): void; setSnapshot(snapshot: string): void; toJSON(): unknown; reset(): void }`

- [ ] **Step 1: 写失败测试**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaytestEventStore, parsePlaytestConfig } from '../../web/playtest-events.ts';

test('实拍配置：必须显式 playtest=1 + 合法 seed + 0..5 的 aiSeat', () => {
  assert.deepEqual(parsePlaytestConfig('playtest=1&seed=123456&aiSeat=2'),
    { seed: 123456, aiSeat: 2 });
  for (const q of ['', 'seed=1&aiSeat=2', 'playtest=1&seed=-1&aiSeat=2',
    'playtest=1&seed=1&aiSeat=6', 'playtest=1&seed=1&aiSeat=x']) {
    assert.equal(parsePlaytestConfig(q), null, q);
  }
});

test('事件表：seq 递增、导出包含配置与事件、reset 清空', () => {
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  store.record({ type: 'human_takeover_click', seat: 2, control: '行棋' });
  store.record({ type: 'table_attention_peak', anchorRound: 3, anchorLogIndex: 9,
    focusSeat: 1, durationSec: 4 });
  const data = store.toJSON() as { config: { seed: number }; events: unknown[] };
  assert.equal(data.config.seed, 7);
  assert.equal(data.events.length, 2);
  assert.equal((data.events[0] as { seq: number }).seq, 0);
  assert.equal((data.events[1] as { seq: number }).seq, 1);
  store.reset();
  assert.equal((store.toJSON() as { events: unknown[] }).events.length, 0);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test tests/web/playtest-events.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现事件模型**

`web/playtest-events.ts` 必须定义以下事件联合（字段名与 metric.json 对齐）：

```ts
export type PlaytestEvent =
  | { readonly type: 'game_start'; readonly seed: number; readonly aiSeat: number }
  | { readonly type: 'ai_turn_start'; readonly round: number; readonly turnIndex: number; readonly seat: number }
  | { readonly type: 'ai_action_committed'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly actionKey: string; readonly durationMs: number;
      readonly degradeLevel: 1 | 2 | 3; readonly seatMode: 'seat_filled_by_ai' }
  | { readonly type: 'ai_turn_duration_ms'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly durationMs: number }
  | { readonly type: 'ai_forfeit'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly reason: string; readonly durationMs: number;
      readonly seatMode: 'seat_filled_by_ai' }
  | { readonly type: 'human_turn_duration_ms'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly durationMs: number }
  | { readonly type: 'human_takeover_click'; readonly seat: number; readonly control: string }
  | { readonly type: 'table_attention_peak'; readonly anchorRound: number;
      readonly anchorLogIndex: number; readonly focusSeat: number; readonly durationSec: number }
  | { readonly type: 'gaze_panel'; readonly seat: number; readonly durationMs: number }
  | { readonly type: 'post_game_poll'; readonly seat: number; readonly wantHumanBack: boolean;
      readonly wouldReplay: number; readonly feltRobotic: number; readonly recalledPeakCount: number;
      readonly oneLineAnomaly: string };
```

实现要点：
- `parsePlaytestConfig` 用 `URLSearchParams`；`playtest` 必须严格等于 `1`；seed 复用 `web/seed.ts::parseSeed`；实拍局固定 6 人，`aiSeat` 只接受 `0..5` 整数。
- `PlaytestEventStore` 为每个事件补 `seq` 与 `ts`（`Date.now`，仅实拍页使用）；`toJSON()` 输出 `{schema:1, config, metadata, events, snapshot}`，`metadata` 记录主题/人数/模式，`snapshot` 由控制器在每次状态变化后通过 `setSnapshot(stateToJson(state))` 更新，供锚点回放。
- `reset()` 清空事件但保留 config。

- [ ] **Step 4: 跑测试确认绿**

Run: `node --test tests/web/playtest-events.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add web/playtest-events.ts tests/web/playtest-events.test.ts
git commit -m "feat(B85): 实拍配置与事件模型"
```

---

### Task 2: AI 自动运行、墙钟计时与人工接管检测

**Files:**
- Create: `web/playtest-controller.ts`
- Create: `tests/web/playtest-controller.test.ts`
- Modify: `web/main.ts`（仅编译期 `PLAYTEST_MODE` 分支）

**Interfaces:**
- Consumes: `runSeatStep`、`heuristicPolicy`、`getLegalActions`、`currentPlayer`、`PlaytestEventStore`
- Produces:
  - `export interface PlaytestControllerOptions { getState(): State; getSeat(): number; getMode(): RuleMode; setState(s: State): void; requestRender(): void; now?: () => number }`
  - `export class PlaytestController { afterRender(state: State): void; captureHumanClick(control: string, target: HTMLElement): void; readonly store: PlaytestEventStore }`

- [ ] **Step 1: 写失败测试**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaytestController } from '../../web/playtest-controller.ts';
import { PlaytestEventStore } from '../../web/playtest-events.ts';
import { mk } from '../engine/fixtures.ts';
import type { State } from '../../engine/core/state.ts';
import { currentPlayer } from '../../engine/core/round.ts';

function aiState(): State {
  const s = mk(6, 7);
  return { ...s, players: s.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' } : p) };
}

test('AI 座位在合法候选出现时自动走 runSeatStep，并记录动作前回合与墙钟', async () => {
  let state = aiState();
  let t = 100;
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; },
    requestRender: () => {},
    now: () => t,
  }, store);
  // 把 AI 座位推到当前手番
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  await new Promise((r) => setTimeout(r, 0));
  const event = store.toJSON().events.find((e: any) => e.type === 'ai_action_committed');
  assert.ok(event);
  assert.equal(event.round, 1);
  assert.equal(event.turnIndex, 0);
  assert.equal(event.durationMs, 0);
});

test('同一局面签名上的 forfeit 不重复调度', async () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({ getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard', setState: (s) => { state = s; },
    requestRender: () => {}, now: () => 0 }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0,
    players: state.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai', pendingCert: true } : p) };
  c.afterRender(state);
  await new Promise((r) => setTimeout(r, 0));
  c.afterRender(state);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(store.toJSON().events.filter((e: any) => e.type === 'ai_forfeit').length, 1);
});

test('点击 AI 座位控件记录 human_takeover_click，点击真人控件记录人类手番耗时', () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  let t = 0;
  const c = new PlaytestController({ getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard', setState: (s) => { state = s; },
    requestRender: () => {}, now: () => t }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  c.captureHumanClick('行棋', {} as HTMLElement);
  t = 500;
  state = { ...state, turnIndex: 1 };
  c.afterRender(state);
  c.captureHumanClick('问天', {} as HTMLElement);
  const events = store.toJSON().events;
  assert.ok(events.some((e: any) => e.type === 'human_takeover_click' && e.seat === 2));
  assert.ok(events.some((e: any) => e.type === 'human_turn_duration_ms' && e.seat === 0));
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `node --test tests/web/playtest-controller.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现控制器**

`PlaytestController` 职责：
- `afterRender` 记录当前手番开始时间；若当前 `round/turnIndex/seat` 变化，重置 `turnStartedAt = now()`。
- 若当前手番是 AI 座位，或任一 AI 座位存在合法流程候选（山议/认证/对峙），调度一个 `setTimeout(..., 0)`；`running` 防重入。非当前手番的行动面候选不会被调度。
- 单步只处理一个 AI 座位：`start = now()` → `runSeatStep(state, seat, policy, getMode())` → `end = now()` → 写 `ai_turn_duration_ms` 与 `ai_action_committed` / `ai_forfeit` → `setState` → `requestRender`。
- 用 `stateSignature(state)` 防重复：包含 `round/turnIndex/phase`、所有座位 `position/pendingCert/statuses`、`certification`、`council.votes`、`duel`、关隘/裂隙阻塞；forfeit 后签名不变则不重试。
- `captureHumanClick(control, target)`：忽略 `.playtest-panel` 与 `.toolbar` 内的点击；若 `getSeat()` 是 AI 座位，写 `human_takeover_click`；否则用动作前记录的 `round/turnIndex` 写 `human_turn_duration_ms`。
- 不把任何时间写进 `State.log`；每次 `setState` 后调用 `store.setSnapshot(stateToJson(state))`，保证导出含可回放终局。

`web/main.ts` 仅增加编译期分支：

```ts
declare const PLAYTEST_MODE: boolean;
let playtest: PlaytestController | null = null;
```

`render()` 末尾：

```ts
if (playtest !== null) {
  playtest.afterRender(ui.state);
}
```

文件底部初始化：

```ts
if (PLAYTEST_MODE) {
  const config = parsePlaytestConfig(location.search);
  if (config !== null) {
    ui.playerCount = 6;
    ui.seed = config.seed;
    newGame();
    ui.state = { ...ui.state, players: ui.state.players.map((p) =>
      p.seat === config.aiSeat ? { ...p, controlledBy: 'ai' } : p) };
    const store = new PlaytestEventStore(config);
    store.setMetadata({ themeId: ui.themeId, players: 6, mode: ui.mode });
    store.record({ type: 'game_start', seed: config.seed, aiSeat: config.aiSeat });
    playtest = new PlaytestController({
      getState: () => ui.state,
      getSeat: () => ui.seat,
      getMode: () => ui.mode,
      setState: (s) => { ui.state = s; },
      requestRender: render,
      now: () => performance.now(),
    }, store);
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const control = target?.closest('button')?.textContent?.trim();
      if (target !== null && control !== undefined && control !== '') {
        playtest?.captureHumanClick(control, target);
      }
    }, true);
  }
}
render();
```

- [ ] **Step 4: 跑测试与类型检查**

Run:

```bash
node --test tests/web/playtest-controller.test.ts tests/web/playtest-events.test.ts
npm run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add web/playtest-controller.ts tests/web/playtest-controller.test.ts web/main.ts
git commit -m "feat(B85): 实拍 AI 自动运行与墙钟/接管采集"
```

---

### Task 3: 观察员面板与本地导出

**Files:**
- Create: `web/playtest-panel.ts`
- Create: `web/playtest-main.ts`
- Modify: `esbuild.config.mjs`
- Modify: `package.json`
- Modify: `web/playtest-controller.ts`（暴露 store 与面板回调）
- Modify: `web/main.ts`（挂载观察员面板）

**Interfaces:**
- Consumes: `PlaytestEventStore`、`State`
- Produces: `renderPlaytestPanel(store: PlaytestEventStore, state: State, now: () => number): HTMLElement`

- [ ] **Step 1: 写浏览器失败测试**

扩展 `tests/e2e/duel-e2e.mjs`：先把现有 `await browser.close()` 移到新增实拍块之后，再在现有对峙测试结束后新增：

```js
const playtestUrl = 'file:///' + file.replace('创界山-活人认证.html', '创界山-活人认证-实拍.html')
  .split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/')
  + '?playtest=1&seed=123456&aiSeat=2';
const pt = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const ptErrors = [];
pt.on('console', (m) => { if (m.type() === 'error') { ptErrors.push(m.text()); } });
pt.on('pageerror', (e) => { ptErrors.push('pageerror: ' + e.message); });
await pt.goto(playtestUrl);
await pt.getByRole('button', { name: '记一次同频' }).click();
await pt.getByRole('button', { name: '记一次看面板' }).click();
const ptDownloadPromise = pt.waitForEvent('download');
await pt.getByRole('button', { name: '导出实拍记录' }).click();
const ptDownload = await ptDownloadPromise;
const ptPath = await ptDownload.path();
const ptData = JSON.parse(readFileSync(ptPath, 'utf8'));
assert.equal(ptData.config.seed, 123456);
assert.equal(ptData.config.aiSeat, 2);
assert.ok(ptData.events.some((e) => e.type === 'table_attention_peak'));
assert.ok(ptData.events.some((e) => e.type === 'gaze_panel'));
assert.equal(ptErrors.length, 0);
await pt.close();
```

- [ ] **Step 2: 跑测试确认红**

Run: `npm run build:only && node tests/e2e/duel-e2e.mjs`
Expected: FAIL，实拍 HTML 或面板不存在。

- [ ] **Step 3: 实现面板**

先实现独立构建入口：`web/playtest-main.ts` 仅 `import './main.ts'`；`esbuild.config.mjs` 抽 `buildHtml(entry, define, outName, title)`，分别用 `PLAYTEST_MODE=false/true` 构建生产页与实拍页；`package.json` 增加 `test:e2e:playtest`。实拍面板样式由 `renderPlaytestPanel` 在创建面板时注入独立 `<style>`，不修改共享 `web/styles.css`，确保生产 HTML 不含实拍类名。

`renderPlaytestPanel` 使用现有 `el/button/section`，包含：
- 标题「实拍观察员」+ 当前 seed / AI 座位。
- 「记一次同频」：读取焦点座位输入（默认当前 AI 座位）与持续秒数输入（默认 3），写 `table_attention_peak`，`anchorLogIndex = state.log.length - 1`。
- 「记一次看面板」：写 `gaze_panel`，座位取当前操作者，时长由面板内累计。
- 「导出实拍记录」：`Blob` + `URL.createObjectURL` 下载 `创界山-实拍-<seed>-<aiSeat>.json`。
- 局后 5 人自报表单：`wantHumanBack` 复选框、`wouldReplay` 1–5、`feltRobotic` 1–5、`recalledPeakCount` 数字、`oneLineAnomaly` 单行文本；每次提交写一条 `post_game_poll`。
- 事件计数摘要：同频、接管、AI 动作、弃权。

`web/main.ts` 在 `render()` 末尾的实拍分支加入：

```ts
if (playtest !== null) {
  root.append(renderPlaytestPanel(playtest.store, ui.state, () => performance.now()));
  playtest.afterRender(ui.state);
}
```

面板样式固定右侧、可折叠、不遮挡主操作区；小屏时改为底部抽屉。样式只在实拍面板创建时注入，生产页通过死代码消除不出现面板或样式。

- [ ] **Step 4: 跑 E2E 与类型检查**

Run:

```bash
npm run typecheck
npm run build:only
node tests/e2e/duel-e2e.mjs
```

Expected: PASS；生产页与实拍页 `consoleErrors` 均为空。

- [ ] **Step 5: 提交**

```bash
git add web/playtest-panel.ts web/playtest-main.ts esbuild.config.mjs package.json web/playtest-controller.ts web/main.ts tests/e2e/duel-e2e.mjs
git commit -m "feat(B85): 独立实拍页、观察员面板与本地记录导出"
```

---

### Task 4: 发布包排除与生产页扫描

**Files:**
- Modify: `build/build-package.mjs`
- Modify: `tests/e2e/duel-e2e.mjs`

**Interfaces:**
- Consumes: Task 3 生成的 `dist/创界山-活人认证-实拍.html`
- Produces: 发布包排除断言 + 生产 HTML 无实拍标识的浏览器断言

- [ ] **Step 1: 在现有 E2E 增加生产页断言**

在生产页加载后、关闭浏览器前增加：

```js
const productionHtml = readFileSync(file, 'utf8');
assert.equal(productionHtml.includes('实拍观察员'), false);
assert.equal(productionHtml.includes('playtest-panel'), false);
```

- [ ] **Step 2: 实现发布包排除断言**

`build/build-package.mjs` 在复制生产 HTML 后增加：

```ts
const packagedPlaytest = resolve(OUT, '数字轨', '创界山-活人认证-实拍.html');
if (existsSync(packagedPlaytest)) {
  console.error('FAIL  实拍 HTML 不得进入发布包');
  process.exit(1);
}
```

实拍 HTML 只允许留在 `dist/` 根目录；发布包不复制、不删除源文件。

- [ ] **Step 3: 跑构建、门禁与发布检查**

Run:

```bash
npm run typecheck
npm run build:only
node tests/e2e/duel-e2e.mjs
npm run gate
npm run release:check
```

Expected：13 门全绿；release 100/100 零漂移；发布包无实拍 HTML；生产 HTML 无实拍文案/类名。

- [ ] **Step 4: 提交**

```bash
git add build/build-package.mjs tests/e2e/duel-e2e.mjs
git commit -m "build(B85): 发布包排除实拍页并锁定生产页无实拍标识"
```

---

### Task 5: 实拍就绪状态回写与使用说明

**Files:**
- Modify: `spark-output/metric/ai-seat-fill.md`
- Modify: `spark-output/metric/playtest-field-sheet.md`
- Modify: `spark-output/context/metric.json`
- Modify: `spark-output/context/prd.json`
- Modify: `spark-output/prd/ai-seat-fill.md`
- Modify: `spark-output/README-归档索引.md`

**Interfaces:**
- Consumes: B85 实拍页与事件 schema
- Produces: Ask 4 状态从 `blocked_on_instrumentation` 改为 `ready_to_schedule`

- [ ] **Step 1: 回写状态**

`metric.json`：
- `human_takeover_click` → `exists`
- `ai_turn_duration_ms` / `human_turn_duration_ms` → `exists`
- `table_attention_peak` / `gaze_panel` / `post_game_poll` → `exists`
- `game_export_snapshot` → 增加实拍事件导出说明
- 新增 `playtest_build: dist/创界山-活人认证-实拍.html`

`playtest-field-sheet.md`：
- K3（接管点击）、K5（墙钟）、K6（观察面板）标 ✅。
- 使用步骤改为：构建 → 打开实拍 HTML → 填 URL 参数 → 5 真人局 → 导出 JSON → 按当场表录入。

`prd.json` / `prd.md`：
- Ask 4 状态 = `ready_to_schedule`，仍缺用户定日期与参与者。
- 明确 **Ask 5 生产开关仍未实现**，实拍页不是生产功能。

- [ ] **Step 2: 验证文档与 JSON**

Run:

```bash
npm run doc-sync
node --test tests/web/playtest-events.test.ts
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 3: 提交**

```bash
git add spark-output/metric/ai-seat-fill.md spark-output/metric/playtest-field-sheet.md spark-output/context/metric.json spark-output/context/prd.json spark-output/prd/ai-seat-fill.md spark-output/README-归档索引.md
git commit -m "docs(B85): Ask 4 实拍采集就绪状态回写"
```

---

## Self-Review

- **Spec coverage**：Task 1 覆盖事件 schema；Task 2 覆盖 AI/人类墙钟与接管；Task 3 覆盖观察员面板与导出；Task 4 覆盖独立构建与发布包排除；Task 5 覆盖状态回写。
- **Ask 5 边界**：生产页无开关；实拍配置只存在于独立构建，发布包不包含。
- **确定性边界**：事件不进入 `State.log`，生产构建 `PLAYTEST_MODE=false` 死代码消除；release 100 组必须全等。
- **类型一致性**：`PlaytestConfig` / `PlaytestEvent` / `PlaytestEventStore` 在 Task 1 定义，Task 2/3 沿用；`PlaytestController` 在 Task 2 定义，Task 3 只消费。
- **测试真实性**：E2E 必须实际下载实拍 JSON 并断言事件内容；生产页必须断言无观察员文案。
- **占位符扫描**：无 TBD / implement later；所有代码步骤均给出实际接口或测试。
