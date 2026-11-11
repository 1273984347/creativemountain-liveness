# B75 · 装备与仲裁者否决：两个不可达目标的机制补齐 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `equip_count` 与 `veto_success` 两个规格目标从「机制缺失」变为可达成——新增 `EQUIP_CARD` 与 `COUNCIL_VETO` 两个动作，补齐计数写入与即时目标结算，并完成行为变更后的基线重标定。

**Architecture:** 两个动作都走既有「声明式动作 → 引擎入口 → 试跑枚举」三段式：装备复用 `performAction` 的新分支 `'equip'`（引用相等 = 拒绝），否决新增 `useCouncilVeto`（`{ok,note,state}`）。否决权通过 `Identity.rights` 数据驱动授予 `flags.canVeto`，并透传进 IR 由 parity-check 守住漂移。所有行为变更集中在本批，最后一次性重标定 balance-report 与发布基线。

**Tech Stack:** Node 24 ESM + TypeScript（`node --test` 跑 `.ts`）；纯 `.mjs` 里不得出现 TS 语法；13 道门禁；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-b75-equip-veto-mechanics-design.md`（权威；本计划是它的施工论证，冲突以 spec 为准）

## Global Constraints

- **动作 key 规范形**：`equip:<cardId>` 与 `council_veto`；`ActionType` 17 → **19**；`tests/engine/action-key.test.ts` 的 `SAMPLES` 21 → **23**（23 是样本总数，不等于成员数）。
- **双实现 + 三层漂移守卫**：`engine/core/legal.ts`（枚举）与 `web/legal-gate.ts`（UI 门禁）各自独立写；枚举层 / 候选层 / 判定形状层守卫必须全绿。
- **关隘 / 裂隙语义**：装备在 `pendingGate` / `pendingBarrier` 时**拒绝**（该手番已暂停、行动已用掉），因此 `'equip'` 分支必须在 `performAction` 开头两条早退**之后**；**待认证锁定**（`pendingCert`）下**允许**。
- **否决语义**：只能在「所有存活玩家都已投票」之后使用；`vetoCount` 只在**实际阻止了放逐**时 +1；`settleImmediateGoals` 必须在 `players` 更新后的最终状态上调用。
- **权限数据驱动**：不写 `identityId === 'arbiter'`；`rights` 必须进入 IR，由 parity-check 逐项比较。
- **重标定只在本批最后一次（Task 9）**：T1–T8 不得重生成 `docs/balance-report.md` / 发布基线。
- **Git**：只 stage 任务列出的确切路径；**禁止** `git add -A` / `.` / `git stash` / `git reset` / `git checkout --`。提交信息 `feat(B75): …` / `fix(B75): …`（中文）。
- **门 ② 令牌纪律**：门 ② 扫整个工作树（gitignore 不豁免）。落进工作树的日志/报告不得逐字出现那两个自检入口令牌；scratch 输出写 `$TEMP`。
- 模型/主题/死亡复活在本批**不做**（B76–B78）。

## 施工前已核对的事实（避免「对齐」变成「补定义」）

| 计划里的用法 | 已核实 |
|---|---|
| `installTheme(state, theme)` | 存在：`engine/core/setup.ts:228` |
| `createInitialState({ players, seed, deckSize })` | 存在（`tests/sim/policy.mjs` 同款调用） |
| `CouncilResult` / `fail` / `succeed` | 存在：`engine/core/council.ts:11/17/21` |
| `topVoted(state)` | 已导出（`b3.test.ts` 已 import） |
| `byFlag(ok, note, next, from)` | 参数顺序如此（`engine/core/probe.ts:83`） |
| `checkIrVsTheme(ir, theme): string[]` | 已导出（`tools/parity-check.mjs:17`，`.d.mts` 声明返回 `string[]`） |
| `record(...)` / `advanceWithDuel(...)` | 均在 `tests/sim/policy.mjs` 内（`playOne` 同文件调用） |
| `cardHasMovement` | **已在 `tests/sim/policy.mjs` 顶部 import**（B72，第 12 行），Task 7 无需新增 |
| `Player.counters` 初始形状 | `{}`（`state.ts:271` / `setup.ts:169`）⇒ 未触发的计数器是 `undefined`；断言用 `?? 0` |
| `Rng.next()` | **可变**（`engine/core/dice.ts:21`）⇒ 不得为决策额外抽随机数 |
| 门⑤ 失败判据 | `res.status !== 0`（`tools/gate.mjs:105`）⇒ `console.warn` 不阻断 |
| `actionFromKey` 的严格性 | 反解后重新编码逐字比较（`action-key.ts:52-56`），多余尾段必拒 |

> 行号只作当前快照参考；施工时一律用 `grep -n` 定位（源码会漂移）。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `engine/core/action.ts` | 动作契约（ActionType + Action 联合） | Modify |
| `engine/core/action-key.ts` | 动作 ↔ 稳定 key | Modify |
| `engine/types/theme.ts` | `Identity.rights` 类型 | Modify |
| `engine/types/ir.ts` | IR 身份字段（+ rights） | Modify |
| `engine/core/setup.ts` | 身份 rights → `flags.canVeto`；council 初值 | Modify |
| `engine/core/state.ts` | council 初值 | Modify |
| `engine/core/flow.ts` | `CouncilState.vetoBy` | Modify |
| `engine/core/council.ts` | `useCouncilVeto` + 结算否决 | Modify |
| `engine/core/turn-runner.ts` | `performAction('equip')` | Modify |
| `engine/core/legal.ts` | 枚举（装备 / 否决） | Modify |
| `engine/core/probe.ts` | 两个新动作分派 | Modify |
| `engine/goals/settle.ts` | 顶部过时注释更正 | Modify |
| `tools/theme-validate.mjs` | `rights` 白名单 + 软警告 | Modify |
| `build/build-ir.mjs` | IR 透传 `rights` | Modify |
| `tools/parity-check.mjs` | IR↔theme 比较 `rights` | Modify |
| `tools/ir-validate.mjs` | IR↔theme `rights` 一致性 | Modify |
| `themes/{xianxia2026,scifi-ai,hybrid,urban-psych}/theme.json` | 仲裁者 `rights` + `passiveText` | Modify |
| `web/legal-gate.ts` | `uiCandidates` / `uiBlockNotice` | Modify |
| `web/main.ts` | 装备模式 + 否决按钮接线 | Modify |
| `web/ui/council.ts` | 否决按钮 | Modify |
| `tests/sim/policy.mjs` | AI 装备 / 否决 | Modify |
| `tests/sim/run.mjs` | 报告静态注记更正 | Modify |
| `tests/engine/action-key.test.ts` | 样本 +2 | Modify |
| `tests/engine/action-contract.test.ts` | 成员 19 | Modify |
| `tests/engine/legal-probe.test.ts` | 枚举/漂移/形状矩阵 | Modify |
| `tests/engine/equip.test.ts` | 装备行为 | Create |
| `tests/engine/council-veto.test.ts` | 否决行为 | Create |
| `tests/engine/goals-reachability.test.ts` | 两目标达成发印记 | Create |
| `tests/engine/policy-ai.test.ts` | AI 决策助手 | Create |
| `docs/superpowers/specs/2026-11-07-...md` | §4.1/§5.6/§6.2/§6.3/§6.4/§6.7.1/§9.3 | Modify |
| `docs/balance-report.md`、`docs/baselines/trial-reserve-scan-B75.json` | 重标定产物 | Task 9 |
| `docs/批次/B75-装备与否决机制补齐-执行记录.md`、批次导航 | 批次记录 | Task 9 |

---

### Task 1: 动作契约与 key（19 成员 / 23 样本）

**Files:**
- Modify: `engine/core/action.ts`
- Modify: `engine/core/action-key.ts`
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（§6.3 ts 代码块）
- Test: `tests/engine/action-key.test.ts`、`tests/engine/action-contract.test.ts`

**Interfaces:**
- Produces: `ActionType` 含 `'EQUIP_CARD' | 'COUNCIL_VETO'`；`Action` 联合含对应两支；`actionKey` 对二者分别输出 `equip:<cardId>` / `council_veto`。

- [ ] **Step 1: 写失败测试（action-key）**

在 `tests/engine/action-key.test.ts` 的 `SAMPLES` 数组末尾追加两条（保持既有样本逐字不动）：

```ts
  { type: 'EQUIP_CARD', actor: 0, cardId: 'c_x' },
  { type: 'COUNCIL_VETO', actor: 0 },
```

并在文件顶部注释写明：

```ts
// ⚠️ 23 是当前样本总数，**不等于** ActionType 成员数（19）；根因守卫按「每个成员都有样本」覆盖。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/action-key.test.ts`
Expected: 编译期/运行期报 `EQUIP_CARD` 不属于 `Action`（TS 侧）或往返失败。

- [ ] **Step 3: 实现契约与编解码**

`engine/core/action.ts`：`ActionType` 联合末尾加两个成员，`Action` 联合末尾加两支：

```ts
  | 'EQUIP_CARD'
  | 'COUNCIL_VETO'
```

```ts
  | { readonly type: 'EQUIP_CARD'; readonly actor: number; readonly cardId: string }
  | { readonly type: 'COUNCIL_VETO'; readonly actor: number }
```

`engine/core/action-key.ts` 的 `actionKey` switch 加：

```ts
    case 'EQUIP_CARD': return `equip:${a.cardId}`;
    case 'COUNCIL_VETO': return 'council_veto';
```

`decodeKey` 的 `switch (head)` 加：

```ts
    case 'equip': return { type: 'EQUIP_CARD', actor: -1, cardId: need(parts[1]) };
    // `council_veto` 无冒号：head 即整串；多余尾段由 actionFromKey 的单射校验拒掉。
    case 'council_veto': return { type: 'COUNCIL_VETO', actor: -1 };
```

- [ ] **Step 4: 更新规格 §6.3 的 ts 代码块**

在 `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` 的 §6.3 ts 代码块末尾（`DUEL_SUBMIT_CARD` 那行之后、分号之前）追加：

```ts
  | { type: 'EQUIP_CARD'; actor: number; cardId: string }
  | { type: 'COUNCIL_VETO'; actor: number };
```

同时把 `tests/engine/action-contract.test.ts` 中标题里的「17 项」改为「19 项」，并在标题末尾补「、B75 装备与否决入枚举」。

- [ ] **Step 5: 跑聚焦测试与类型检查**

Run: `node --test tests/engine/action-key.test.ts tests/engine/action-contract.test.ts && npm run typecheck`
Expected: 全绿；`ActionType` 成员 19、规格表成员 19、样本 23。

- [ ] **Step 6: 提交**

```bash
git add engine/core/action.ts engine/core/action-key.ts docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md tests/engine/action-key.test.ts tests/engine/action-contract.test.ts
git commit -m "feat(B75): 动作契约新增 EQUIP_CARD 与 COUNCIL_VETO（key 规范形 + 19 成员守卫）"
```

---

### Task 2: 身份 rights（数据驱动的否决权）

**Files:**
- Modify: `engine/types/theme.ts`、`engine/core/setup.ts`、`tools/theme-validate.mjs`
- Modify: `themes/xianxia2026/theme.json`、`themes/scifi-ai/theme.json`、`themes/hybrid/theme.json`、`themes/urban-psych/theme.json`
- Test: `tests/engine/identity-rights.test.ts`（Create）

**Interfaces:**
- Consumes: 无（独立）
- Produces: `IdentityRight = 'council_veto'`；`Identity.rights?: readonly IdentityRight[]`；开局 `player.flags.canVeto === true` 仅授予持权身份。

- [ ] **Step 1: 写失败测试**

Create `tests/engine/identity-rights.test.ts`：

```ts
// B75：否决权必须由主题数据授予（不得硬编码 identityId === 'arbiter'）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';

const THEMES = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];

// ⚠️ 身份是**开局随机分配**的（8 个身份里只发出 4 个）⇒ 仲裁者可能不在场。
//   因此不能断言「每局都有人持权」，要按「在场才授予、且最多一人」判，并保证样本里至少出现一局仲裁者。
test('B75：四套主题的仲裁者声明 rights；开局只在仲裁者在场时授予 canVeto', () => {
  for (const id of THEMES) {
    const theme = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8'));
    const withRight = theme.identities.filter((i) => (i.rights ?? []).includes('council_veto'));
    assert.equal(withRight.length, 1, `${id}：必须恰好一个身份持有否决权`);
    assert.equal(withRight[0].id, 'arbiter', `${id}：否决权属于仲裁者`);

    let seenArbiter = false;
    for (let seed = 7; seed <= 30; seed += 1) {
      const s = installTheme(
        createInitialState({ players: 4, seed, deckSize: theme.counts.deckTotal }), theme);
      const holders = s.players.filter((p) => p.flags.canVeto === true);
      const arbiters = s.players.filter((p) => p.identityId === 'arbiter');
      if (arbiters.length === 0) {
        assert.equal(holders.length, 0, `${id}@${seed}：仲裁者不在场 ⇒ 无人持权`);
      } else {
        seenArbiter = true;
        assert.equal(holders.length, 1, `${id}@${seed}：恰一人持权`);
        assert.equal(holders[0]!.seat, arbiters[0]!.seat, `${id}@${seed}：持权者必须是仲裁者`);
      }
    }
    assert.equal(seenArbiter, true, `${id}：种子 7–30 内必须至少出现一局仲裁者`);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/identity-rights.test.ts`
Expected: 第一条因主题无 `rights` 失败（`withRight.length === 0`）。

- [ ] **Step 3: 类型与主题数据**

`engine/types/theme.ts`：

```ts
export type IdentityRight = 'council_veto';
export interface Identity {
  // …既有字段不动…
  /** 引擎可判定的身份特权（B75）；`passive` 是效果/被动，这里是**权限位**。 */
  readonly rights?: readonly IdentityRight[];
}
```

四套主题的 `identities` 中 `id === 'arbiter'` 的对象加：

```json
"rights": ["council_veto"],
```

并把其 `passiveText` 末尾补「；每局可否决 1 次放逐」（保留原有「山议中可投 2 票」表述，标点按主题现有风格）。

- [ ] **Step 4: setup 授予 flags**

`engine/core/setup.ts` 的 `flags` 组装处（`...goalFlags` 之前）加：

```ts
    // B75：否决权由身份数据授予（不硬编码 identityId）；整局有效，是否已用由 council.vetoUsed 记录。
    ...((identity?.rights ?? []).includes('council_veto') ? { canVeto: true } : {}),
```

- [ ] **Step 5: 主题校验（白名单 + 软警告）**

`tools/theme-validate.mjs` 在身份循环内加：

```js
    const RIGHTS = new Set(['council_veto']);
    if (id.rights !== undefined) {
      if (!Array.isArray(id.rights)) { err(`身份 ${id.id} 的 rights 必须是数组`); }
      else {
        for (const r of id.rights) { if (!RIGHTS.has(r)) { err(`身份 ${id.id} 的 rights 未知值：${String(r)}`); } }
      }
    }
    const textHasVeto = typeof id.passiveText === 'string' && id.passiveText.includes('否决');
    const dataHasVeto = Array.isArray(id.rights) && id.rights.includes('council_veto');
    if (textHasVeto !== dataHasVeto) {
      console.warn(`⚠️ 身份 ${id.id}：passiveText 与 rights 的否决口径不一致（文本=${textHasVeto} rights=${dataHasVeto}）`);
    }
```

- [ ] **Step 6: 跑聚焦测试**

> 门⑤ 只认退出码（`tools/gate.mjs:105`）⇒ `console.warn` 不会阻断；无需把 warning 改成 stdout。

Run: `node --test tests/engine/identity-rights.test.ts && node tools/theme-validate.mjs`
Expected: 2/2 pass；主题校验 PASS 且无 warning。

- [ ] **Step 7: 提交**

```bash
git add engine/types/theme.ts engine/core/setup.ts tools/theme-validate.mjs themes/xianxia2026/theme.json themes/scifi-ai/theme.json themes/hybrid/theme.json themes/urban-psych/theme.json tests/engine/identity-rights.test.ts
git commit -m "feat(B75): 身份 rights 数据驱动授予否决权 + 主题校验白名单与软警告"
```

---

### Task 3: 山议否决（状态 + 入口 + 结算）

**Files:**
- Modify: `engine/core/flow.ts`、`engine/core/state.ts`、`engine/core/setup.ts`、`engine/core/council.ts`、`engine/goals/settle.ts`
- Test: `tests/engine/council-veto.test.ts`（Create）、`tests/engine/state-contract.test.ts`（Modify）

**Interfaces:**
- Consumes: `flags.canVeto`（Task 2）
- Produces: `CouncilState.vetoBy: number | null`；`useCouncilVeto(state, actor): CouncilResult`；`resolveCouncil` 在「否决实际阻止放逐」时写 `vetoCount` 并结算即时目标。

- [ ] **Step 1: 写失败测试**

> 已核实：`CouncilResult` / `topVoted` / `castVote` 均已存在 ⇒ Step 2 的预期失败应是「`useCouncilVeto` 未导出」，不是模块缺失。

Create `tests/engine/council-veto.test.ts`（用 `fixtures.ts` 的 `councilScene()` 与 `castVote` 把票投完；用 `putPassive` 或直接改 `flags.canVeto` 造持权者；`mk()` 的 4 人局）：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castVote, useCouncilVeto, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

/** 让所有存活玩家投给同一目标（默认座 1），并把座 0 设为否决持有者。 */
function readyVeto(seat = 0, target = 1): State {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive && x.seat !== target)) {
    const r = castVote(s, p.seat, target);
    assert.ok(r.ok, '前提：投票必须成功：' + r.note);
    s = r.state;
  }
  return s;
}

test('B75：非持权者不能使用否决', () => {
  const s = readyVeto();
  const r = useCouncilVeto(s, 2);
  assert.equal(r.ok, false);
  assert.match(r.note, /否决特权/);
});

test('B75：投票未完成时不能使用否决', () => {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  const r = useCouncilVeto(s, 0);
  assert.equal(r.ok, false);
  assert.match(r.note, /等待所有玩家投票/);
});

test('B75：成功否决 ⇒ 无人被放逐 + vetoCount+1 + 每局一次', () => {
  const s = readyVeto();
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok);
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  assert.match(res.note, /仲裁者否决/);
  assert.equal(res.state.players[1]?.alive, true, '被否决者必须存活');
  assert.equal(res.state.players[0]?.counters.vetoCount, 1);
  assert.equal(useCouncilVeto(res.state, 0).ok, false, '每局只能一次');
});

test('B75：3 人局不受否决影响（扣灵枢分支）', () => {
  // 3 人局：councilScene(3, 7)，持权者用否决后 resolveCouncil 仍走扣灵枢分支
  let s = councilScene(3, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players) { const r = castVote(s, p.seat, p.seat === 0 ? 1 : 0); assert.ok(r.ok); s = r.state; }
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok);
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  // ⚠️ counters 初始是 `{}`（动态添加）⇒ 未触发时是 undefined；用 `?? 0` 兼容两种初始形状。
  assert.equal(res.state.players[0]?.counters.vetoCount ?? 0, 0, '3 人局不涉及放逐 ⇒ 不计数');
});

test('B75：否决后即时目标结算（veto_success 达成发印记）', () => {
  let s = readyVeto();
  s = { ...s, players: s.players.map((p) => (p.seat === 0
    ? { ...p, flags: { ...p.flags, canVeto: true, goal: { kind: 'veto_success', count: 1 } } }
    : p)) };
  const v = useCouncilVeto(s, 0);
  const res = resolveCouncil(v.state);
  assert.equal(res.state.players[0]?.hasMark, true, '成功否决 ⇒ 即时目标达成 ⇒ 发印记');
});
```

> 测试里直接改 `flags` 是**测试夹具**的手段；生产路径必须由 Task 2 的 `setup` 授予。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/council-veto.test.ts`
Expected: `useCouncilVeto` 未导出（模块加载失败）。

- [ ] **Step 3: 状态字段**

`engine/core/flow.ts` 的 `CouncilState` 加：

```ts
  /** 本局使用否决的座位（未使用为 null）。 */
  readonly vetoBy: number | null;
```

`engine/core/state.ts:312` 与 `engine/core/setup.ts:205` 的 council 字面量都补 `vetoBy: null`。

本仓**没有**集中式存档迁移（存档就是 JSON 化的 `State`）。读取侧容错**只有一处**：`council.ts` 里用 `state.council.vetoBy ?? null`（上面的结算代码已按此写）。在 `tests/engine/state-contract.test.ts` 加一条旧存档兼容用例：

```ts
test('B75：旧存档缺 council.vetoBy ⇒ 按未使用处理，不抛错', () => {
  const s = councilScene(4, 7);
  const legacy = { ...s, council: { ...s.council, vetoBy: undefined } as unknown as State['council'] };
  assert.doesNotThrow(() => resolveCouncil(legacy));
});
```

（`councilScene` / `resolveCouncil` 按该文件既有 import 补齐。）

- [ ] **Step 4: 实现 `useCouncilVeto` 与结算**

`engine/core/council.ts` 顶部 import 补：

```ts
import { bumpCounterOf } from './counters.ts';
import { settleImmediateGoals } from '../goals/settle.ts';
```

新增：

```ts
/** B75：仲裁者否决（每局 1 次）。只能在所有存活玩家投完票之后使用。 */
export function useCouncilVeto(state: State, actor: number): CouncilResult {
  const c = state.council;
  if (c.resolved) { return fail(state, '山议未在进行中'); }
  const p = state.players[actor];
  if (p === undefined || !p.alive) { return fail(state, '该玩家已出局'); }
  if (p.flags.canVeto !== true) { return fail(state, '你没有否决特权'); }
  if (c.vetoUsed) { return fail(state, '本局否决已使用'); }
  const allVoted = state.players.filter((x) => x.alive).every((x) => c.votes[x.seat] !== undefined);
  if (!allVoted) { return fail(state, '等待所有玩家投票后才能使用否决'); }
  return succeed({ ...state, council: { ...c, vetoUsed: true, vetoBy: actor } }, '仲裁者使用否决');
}
```

`resolveCouncil` 的放逐分支按下面顺序改写（保留既有注释与清印记逻辑）：

```ts
  const vetoBy = next.council.vetoBy ?? null;
  // 只有「本来会有人被放逐」时，否决才算成功 ⇒ 清空放逐名单
  const vetoed = exiled.length > 0 && next.council.vetoUsed === true && vetoBy !== null;
  if (vetoed) { exiled.length = 0; }
  if (exiled.length === 0) {
    if (vetoed && vetoBy !== null) {
      // ① 先写计数；② 在最终状态上结算即时目标（全局，不限于否决者）
      const counted = bumpCounterOf(next, vetoBy, 'vetoCount', 1);
      return succeed(settleImmediateGoals(counted), '山议裁定：仲裁者否决，本次无人被放逐');
    }
    if (next.council.vetoUsed === true && vetoBy !== null) {
      return succeed(next, '山议：无人被放逐（下限保护 / 凭证；本局否决已使用但未阻止放逐）');
    }
    return succeed(next, '山议：无人被放逐（下限保护 / 凭证）');
  }
  // ……既有 players 更新 / 清印记 / 认证终止不变……
```

- [ ] **Step 5: 更正 settle.ts 过时注释**

`engine/goals/settle.ts` 顶部把「`immediate` ⇒ **无生产调用点**」改为：

```ts
//   · `immediate`  ⇒ 即时结算（B61：质疑判不通过处；B75：仲裁者否决实际阻止放逐处）
```

- [ ] **Step 6: 跑测试**

Run: `node --test tests/engine/council-veto.test.ts tests/engine/b3.test.ts tests/engine/exile-floor.test.ts`
Expected: 全绿（既有山议用例不回归）。

- [ ] **Step 7: 提交**

```bash
git add engine/core/flow.ts engine/core/state.ts engine/core/setup.ts engine/core/council.ts engine/goals/settle.ts tests/engine/council-veto.test.ts tests/engine/state-contract.test.ts
git commit -m "feat(B75): 仲裁者否决入口与结算（成功才计数、即时目标结算、每局一次）"
```

---

### Task 4: 装备动作（`performAction('equip')`）

**Files:**
- Modify: `engine/core/turn-runner.ts`
- Test: `tests/engine/equip.test.ts`（Create）

**Interfaces:**
- Consumes: `equipsTotal` 计数器（既有）
- Produces: `performAction(state, seat, 'equip', { cardId })`；成功 ⇒ 手牌减少、`equipment` 增加、`equipsTotal+1`、日志。

- [ ] **Step 1: 写失败测试**

Create `tests/engine/equip.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performAction } from '../../engine/core/turn-runner.ts';
import { mk, lockedScene, gateScene } from './fixtures.ts';
import { cardHasMovement } from '../../engine/core/targeting.ts';

test('B75：装备把手牌移入装备区并计 equipsTotal', () => {
  const s = mk();
  const card = s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.notEqual(next, s, '装备必须被接受');
  assert.equal(next.players[0]!.hand.some((c) => c.id === card.id), false);
  assert.equal(next.players[0]!.equipment.some((c) => c.id === card.id), true);
  assert.equal(next.players[0]!.counters.equipsTotal, 1);
});

test('B75：牌不在手 ⇒ 引用相等拒绝', () => {
  const s = mk();
  assert.equal(performAction(s, 0, 'equip', { cardId: 'no_such_card' }), s);
  assert.equal(performAction(s, 0, 'equip', {}), s);
});

test('B75：待认证锁定下允许装备（不是位移）', () => {
  const s = lockedScene();
  const card = s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.notEqual(next, s);
  assert.equal(next.players[0]!.equipment.length, 1);
});

test('B75：关隘暂停时拒绝装备（该手番已用掉）', () => {
  const s = gateScene();
  const card = s.players[0]!.hand[0]!;
  assert.equal(performAction(s, 0, 'equip', { cardId: card.id }), s);
});

test('B75：装备不占手牌上限（equipment 不计入 hand）', () => {
  const s = mk();
  const card = s.players[0]!.hand.find((c) => !cardHasMovement(c)) ?? s.players[0]!.hand[0]!;
  const next = performAction(s, 0, 'equip', { cardId: card.id });
  assert.equal(next.players[0]!.equipment.length, 1);
  assert.equal(next.players[0]!.hand.length, s.players[0]!.hand.length - 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/equip.test.ts`
Expected: `'equip'` 不在 action 联合里（TS 编译失败）或引用相等（未实现）。

- [ ] **Step 3: 实现分支**

`engine/core/turn-runner.ts`：

1. 顶部 import 补 `bumpCounterOf`（`./counters.ts`）。
2. `performAction` 的 `action` 参数联合改为：

```ts
  action: 'move' | 'ask' | 'act' | 'equip',
```

3. 在 `switch (action)` 中、`case 'act'` 之后加：

```ts
    case 'equip': {
      // B75：把一张手牌移入装备区（不占手牌上限、公开可见、无被动效果）。
      // ⚠️ 本分支位于 pendingGate / pendingBarrier 早退之后 ⇒ 关隘/裂隙暂停期间拒绝（手番已用掉）；
      //   但不查 pendingCert（装备不是位移）。
      const cardId = payload.cardId;
      if (cardId === undefined) { return state; }
      const card = player.hand.find((c) => c.id === cardId);
      if (card === undefined) { return state; }
      const hand = player.hand.filter((c) => c.id !== cardId);
      let next: State = {
        ...state,
        players: state.players.map((p) => (p.seat === seat
          ? { ...p, hand, equipment: [...p.equipment, card] }
          : p)),
      };
      next = bumpCounterOf(next, seat, 'equipsTotal', 1);
      next = {
        ...next,
        log: [...next.log, {
          round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'equip',
          message: `装备「${card.name}」`,
        }],
      };
      break;
    }
```

- [ ] **Step 4: 跑测试**

Run: `node --test tests/engine/equip.test.ts tests/engine/card-cost.test.ts`
Expected: 全绿（未动 `act` 的付费路径）。

- [ ] **Step 5: 提交**

```bash
git add engine/core/turn-runner.ts tests/engine/equip.test.ts
git commit -m "feat(B75): 装备动作（手牌→装备区、计 equipsTotal、关隘暂停拒绝、锁定允许）"
```

---

### Task 5: 枚举 + 探针 + UI 门禁（三层同步）

**Files:**
- Modify: `engine/core/legal.ts`、`engine/core/probe.ts`、`web/legal-gate.ts`
- Test: `tests/engine/legal-probe.test.ts`

**Interfaces:**
- Consumes: `useCouncilVeto`（T3）、`performAction('equip')`（T4）、`flags.canVeto`（T2）
- Produces: 枚举在行动面/锁定位发 `EQUIP_CARD`、山议面给持权者发 `COUNCIL_VETO`；UI 侧逐条同形。

- [ ] **Step 1: 写失败测试**

在 `tests/engine/legal-probe.test.ts` 追加：

```ts
test('B75：行动面枚举装备候选（每张手牌一条）', () => {
  const s = mk();
  const keys = candidatesOf(s, 0).filter((a) => a.type === 'EQUIP_CARD');
  assert.equal(keys.length, s.players[0]!.hand.length);
  for (const a of getLegalActions(s, 0).filter((x) => x.type === 'EQUIP_CARD')) {
    assert.equal(probeAction(s, a).ok, true, '枚举出的装备必须被引擎接受');
  }
});

test('B75：待认证锁定仍发装备候选', () => {
  const s = lockedScene();
  const equip = candidatesOf(s, 0).filter((a) => a.type === 'EQUIP_CARD');
  assert.equal(equip.length, s.players[0]!.hand.length);
});

test('B75：山议面只给持权者发否决（且必须投完票）', () => {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  assert.equal(candidatesOf(s, 0).some((a) => a.type === 'COUNCIL_VETO'), false, '未投完票不发');
  for (const p of s.players.filter((x) => x.alive && x.seat !== 1)) {
    const r = castVote(s, p.seat, 1); assert.ok(r.ok); s = r.state;
  }
  assert.equal(candidatesOf(s, 0).some((a) => a.type === 'COUNCIL_VETO'), true);
  assert.equal(candidatesOf(s, 2).some((a) => a.type === 'COUNCIL_VETO'), false, '非持权者不发');
});
```


- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: 新增 3 条失败（枚举无装备/否决）。

- [ ] **Step 3: 引擎枚举**

`engine/core/legal.ts`：

- 正常窗口的手牌循环里，`PLAY_CARD` 之后加：

```ts
      out.push({ type: 'EQUIP_CARD', actor: seat, cardId: card.id });
```

- 待认证锁定分支的手牌循环里同样加一行（放在 `if (cardHasMovement(card)) { continue; }` **之前**，因为装备不限位移）：

```ts
      out.push({ type: 'EQUIP_CARD', actor: seat, cardId: card.id });
```

- `councilCandidates` 改写为：

```ts
function councilCandidates(state: State, seat: number): Action[] {
  if (state.council.resolved === true) { return []; }
  const me = state.players[seat];
  if (me === undefined || !me.alive) { return []; }
  const out: Action[] = [];
  if (state.council.votes[seat] === undefined) {
    for (const p of state.players) {
      if (p.alive && p.seat !== seat) { out.push({ type: 'VOTE', actor: seat, target: p.seat }); }
    }
  }
  const allVoted = state.players.filter((p) => p.alive)
    .every((p) => state.council.votes[p.seat] !== undefined);
  if (allVoted && state.council.vetoUsed !== true && me.flags.canVeto === true) {
    out.push({ type: 'COUNCIL_VETO', actor: seat });
  }
  return out;
}
```

- `probe.ts` 的 switch 加：

```ts
    case 'EQUIP_CARD': return byRef(performAction(s, action.actor, 'equip', { cardId: action.cardId }), s);
    case 'COUNCIL_VETO': { const r = useCouncilVeto(s, action.actor); return byFlag(r.ok, r.note, r.state, s); }
```

（顶部 import 补 `useCouncilVeto`。）

- [ ] **Step 4: UI 门禁同步**

`web/legal-gate.ts`：

- `uiCandidates` 的行动面手牌循环加 `EQUIP_CARD`（与引擎同形）；锁定分支的循环**先**加 `EQUIP_CARD`、再 `if (cardHasMovement(card)) { continue; }` 发 `PLAY_CARD`。
- 山议面把「已投票 ⇒ 不发任何候选」的结构改为「未投票发 VOTE；投完票后若持权且未用 ⇒ 发 COUNCIL_VETO」：

```ts
  if (state.council.resolved === false) {
    if (state.council.votes[seat] === undefined) {
      for (const p of state.players) {
        if (p.alive && p.seat !== seat) { out.push({ type: 'VOTE', actor: seat, target: p.seat }); }
      }
    }
    const allVoted = state.players.filter((p) => p.alive)
      .every((p) => state.council.votes[p.seat] !== undefined);
    if (allVoted && state.council.vetoUsed !== true && me.flags.canVeto === true) {
      out.push({ type: 'COUNCIL_VETO', actor: seat });
    }
  }
```

- **先把 `actionWindowRefusal` 改成结构化返回值**（消除对拒因文案的字符串匹配）：

```ts
type WindowRefusal = {
  readonly code: 'no_seat' | 'dead' | 'pending_cert' | 'duel' | 'phase' | 'round_end';
  readonly message: string;
};
function actionWindowRefusal(state: State, seat: number): WindowRefusal | null {
  const p = state.players[seat];
  if (p === undefined) { return { code: 'no_seat', message: '该座位不存在（人数档位与存档不一致）。' }; }
  if (!p.alive) { return { code: 'dead', message: '该玩家已出局。' }; }
  if (p.pendingCert) { return { code: 'pending_cert', message: '待认证锁定：不能主动移动，位移类牌与被动不可用（非位移牌仍可打出）。' }; }
  if (state.duel !== null) { return { code: 'duel', message: '对峙未结算：双方各自锁定亮牌后才能继续行动。' }; }
  if (state.phase !== '行动') { return { code: 'phase', message: '当前阶段不可行事（先完成山议/认证）。' }; }
  if (isRoundEnd(state)) { return { code: 'round_end', message: '本 round 已走完：等待回合结算。' }; }
  return null;
}
```

  `actionWindow` 改为 `return actionWindowRefusal(state, seat) === null;`；
  `uiBlockNotice` 里既有的 `MOVE` / `ROLL_WHEEL` / `ABILITY` / `PLAY_CARD` 分支把 `return window;` 改为 `return window.message;`（消息逐字不变，既有文案断言不受影响）。

- `uiBlockNotice` 加两个 case：

```ts
    case 'EQUIP_CARD': {
      const window = actionWindowRefusal(state, seat);
      // ⚠️ 锁定（pending_cert）**不是**装备的拒因（引擎 equip 分支不查 pendingCert）；
      //   其余窗口拒因照旧。按 code 判，**不得**匹配 message 文案。
      if (window !== null && window.code !== 'pending_cert') { return window.message; }
      return me?.hand.some((c) => c.id === action.cardId) ? null : '手牌里没有这张牌（可能已被弃掉或不属于你）。';
    }
    case 'COUNCIL_VETO': {
      if (state.council.resolved) { return '山议未在进行中。'; }
      if (me === undefined || !me.alive) { return '你已出局。'; }
      if (me.flags.canVeto !== true) { return '你没有否决特权。'; }
      if (state.council.vetoUsed === true) { return '本局否决已使用。'; }
      const allVoted = state.players.filter((p) => p.alive)
        .every((p) => state.council.votes[p.seat] !== undefined);
      return allVoted ? null : '等待所有玩家投票后才能使用否决。';
    }
```

- [ ] **Step 5: 跑聚焦测试（含三层漂移守卫）**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: 56+3 全绿；三层漂移守卫通过（UI 与引擎两侧集合相等）。

- [ ] **Step 6: 提交**

```bash
git add engine/core/legal.ts engine/core/probe.ts web/legal-gate.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B75): 装备与否决进入枚举/探针/UI 门禁（三层同步，漂移守卫绿）"
```

---

### Task 6: UI 交互（装备模式 + 否决按钮）

**Files:**
- Modify: `web/main.ts`、`web/ui/council.ts`
- Test: `tests/engine/legal-probe.test.ts`（UI 接线源码守卫）

**Interfaces:**
- Consumes: `uiCandidates` / `uiAllows` / `uiBlockNotice`（T5）、`useCouncilVeto`（T3）
- Produces: 手牌点击在装备模式下走 `performAction('equip')`；山议面板在持权且全投完后显示否决按钮。

- [ ] **Step 1: 写失败测试（源码接线守卫）**

在 `tests/engine/legal-probe.test.ts` 的接线区追加一条（与既有 R-1 的源码扫描同法）：

```ts
test('B75：装备与否决入口必须走同一道闸（uiAllows / uiBlockNotice）', () => {
  const src = readFileSync('web/main.ts', 'utf8');
  assert.match(src, /performAction\([^)]*'equip'/, '装备必须调用 performAction(...,\'equip\')');
  assert.match(src, /uiBlockNotice\([^)]*EQUIP_CARD|EQUIP_CARD[\s\S]{0,200}uiBlockNotice/, '装备入口必须先问 uiBlockNotice');
  assert.match(src, /useCouncilVeto/, '否决按钮必须调用 useCouncilVeto');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: 新用例失败（main.ts 尚无 equip/否决接线）。

- [ ] **Step 3: UI 状态与装备入口**

`web/main.ts`：

- `interface Ui` 加 `equipMode: boolean;`，`const ui: Ui = { … }` 加 `equipMode: false,`。
- 在 `renderActions` 的手牌区之前加按钮（仅当存在装备候选）：

```ts
  if (uiCandidates(ui.state, seat).some((a) => a.type === 'EQUIP_CARD')) {
    body.push(el('div', { class: 'btn-row' }, button(
      ui.equipMode ? '取消装备模式' : '装备手牌',
      () => { ui.equipMode = !ui.equipMode; ui.notice = ui.equipMode ? '装备模式：点击一张手牌装备它。' : null; render(); },
    )));
  }
```

- 新增：

```ts
/** B75：装备一张手牌。入口与出牌同闸（拒绝不沉默）。 */
function equipCard(cardId: string): void {
  const seat = ui.seat;
  const action: Action = { type: 'EQUIP_CARD', actor: seat, cardId };
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前不可装备该牌。';
    render();
    return;
  }
  ui.state = performAction(ui.state, seat, 'equip', { cardId });
  ui.state = advanceTurn(ui.state, ui.mode);
  ui.equipMode = false;
  render();
}
```

- 三处 `renderHand(...)` 的回调开头加：

```ts
    if (ui.equipMode) { equipCard(cardId); return; }
```

- 待认证锁定下把装备按钮降级：放在「其他操作」一行（沿用上面的按钮，但文案加提示「等待认证时仍可装备手牌」；实现时若 `player.pendingCert` 为真，把该按钮放在认证面板之后渲染）。

- [ ] **Step 4: 山议否决按钮**

`web/ui/council.ts`：

- 签名加 `onVeto: () => void`：

```ts
export function renderCouncil(
  state: State, theme: ThemePack, seat: number,
  onVote: (target: number) => void,
  onResolve: () => void,
  onVeto: () => void,
): HTMLElement {
```

- 在「结算山议」按钮之前加：

```ts
  const vetoAction = { type: 'COUNCIL_VETO' as const, actor: seat };
  if (uiAllows(state, seat, vetoAction)) {
    body.push(el('div', { class: 'btn-row' }, button('使用否决（每局 1 次）', () => { onVeto(); })));
  } else if (state.council.vetoUsed === true) {
    body.push(el('div', { class: 'muted', text: '本局否决已使用。' }));
  }
```

- `web/main.ts` 的 `renderCouncil` 调用处（先 `grep -n "renderCouncil(" web/main.ts` 定位；当前仅一处）补一个回调：

```ts
      () => {
        const s = ui.state;
        const r = useCouncilVeto(s, ui.seat);
        if (r.ok) { ui.state = r.state; } else { ui.notice = r.note; }
        render();
      },
```

并 import `useCouncilVeto`。

- [ ] **Step 5: 跑测试**

Run: `node --test tests/engine/legal-probe.test.ts && npm run typecheck`
Expected: 全绿；`main.ts` 的源码守卫通过。

- [ ] **Step 6: 提交**

```bash
git add web/main.ts web/ui/council.ts tests/engine/legal-probe.test.ts
git commit -m "feat(B75): UI 装备模式与山议否决按钮（入口同闸、锁定下降级）"
```

---

### Task 7: 模拟器 AI 与可达性

**Files:**
- Modify: `tests/sim/policy.mjs`
- Test: `tests/engine/policy-ai.test.ts`（Create）

**Interfaces:**
- Consumes: `performAction('equip')`、`useCouncilVeto`、`goalOf`（`engine/goals/settle.ts`）
- Produces: `shouldVeto(state, seat): boolean`、`pickEquipCard(state, seat): Card | undefined`（导出供单测）。

- [ ] **Step 1: 写失败测试**

> 已核实：`record` / `advanceWithDuel` 在 `policy.mjs` 内、`cardHasMovement` 已在顶部 import（B72）⇒ 本任务只需新增 `shouldVeto` / `pickEquipCard` 两个导出。

Create `tests/engine/policy-ai.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldVeto, pickEquipCard } from '../../tests/sim/policy.mjs';
import { castVote } from '../../engine/core/council.ts';
import { councilScene, mk } from './fixtures.ts';

test('B75：仲裁者被最高票且未用否决 ⇒ shouldVeto 为真', () => {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive && x.seat !== 0)) {
    const r = castVote(s, p.seat, 0);
    assert.ok(r.ok, '前提：投票必须成功：' + r.note);
    s = r.state;
  }
  assert.equal(shouldVeto(s, 0), true);
});
```

```ts
test('B75：pickEquipCard 只在 equip_count 目标、手牌≥2 时给出「最不需要打出」的牌', () => {
  const s = mk();
  const withGoal = { ...s, players: s.players.map((p) => (p.seat === 0
    ? { ...p, flags: { ...p.flags, goal: { kind: 'equip_count', count: 2 } } }
    : p)) };
  if (withGoal.players[0]!.hand.length >= 2) {
    const card = pickEquipCard(withGoal, 0);
    assert.ok(card !== undefined);
    assert.equal(withGoal.players[0]!.hand.some((c) => c.id === card.id), true);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/policy-ai.test.ts`
Expected: `shouldVeto` / `pickEquipCard` 未导出。

- [ ] **Step 3: 实现 AI 助手**

`tests/sim/policy.mjs`：

- import 补：

```js
import { topVoted, useCouncilVeto } from '../../engine/core/council.ts';
import { goalOf } from '../../engine/goals/settle.ts';
```

- 先做**纯重构**（行为不变）：把 `pickPlayableCard` 内的 `rank` 提为模块级函数，并把内部调用改掉：

```js
/** 牌的启发式优先级（3=位移 / 2=压制 / 1=其它）。装备选牌复用同一把尺。 */
function rankOf(card) {
  const ops = new Set();
  const collect = (list) => {
    for (const eff of list) {
      ops.add(eff.op);
      if (eff.op === 'sequence' && Array.isArray(eff.effects)) { collect(eff.effects); }
    }
  };
  collect(card.effects);
  for (const op of ['move_forward', 'move_by_dice', 'teleport', 'swap_position']) {
    if (ops.has(op)) { return 3; }
  }
  for (const op of ['damage', 'poison', 'slow', 'silence', 'skip_turn']) {
    if (ops.has(op)) { return 2; }
  }
  return 1;
}
```

  `pickPlayableCard` 内把 `const rank = (card) => {…}` 整段删掉、改用 `rankOf(card)`；其余逻辑逐字不动。

- 在 `pickPlayableCard` 附近加：

```js
/** 最不需要打出的一张可支付非位移牌（用于装备；手牌 < 2 时不装备）。 */
export function pickEquipCard(state, seat) {
  const p = state.players[seat];
  if (p === undefined || p.hand.length < 2) { return undefined; }
  // ⚠️ 位移判定用 `cardHasMovement`（引擎同源、覆盖 utility 与嵌套效果），**不用** `rankOf(c) < 3`：
  //   rankOf 只认 4 个位移 op（漏 move_backward / move_to_tile / move_relative_to / conditional / count）。
  const candidates = p.hand.filter((c) => c.cost <= p.resource && !cardHasMovement(c));
  if (candidates.length === 0) { return undefined; }
  return candidates.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
}

/** 裁决者是否应在本次山议使用否决：存活、持权、未用、已投完票、且自己被最高票。 */
export function shouldVeto(state, seat) {
  const c = state.council;
  if (c.resolved || c.vetoUsed || (c.vetoBy ?? null) !== null) { return false; }
  const p = state.players[seat];
  if (p === undefined || !p.alive || p.flags.canVeto !== true) { return false; }
  const allVoted = state.players.filter((x) => x.alive).every((x) => c.votes[x.seat] !== undefined);
  if (!allVoted) { return false; }
  return topVoted(state).includes(seat);
}
```

- `councilTurn`（签名 `async function councilTurn(s, policy, counters, hit)`）在**投票循环之后、`const rr = resolveCouncil(s);` 之前**插入：

```js
  // B75：仲裁者自保否决 —— 所有存活玩家已投完票，且仲裁者本人是最高票之一
  for (const p of s.players.filter((x) => x.alive)) {
    if (shouldVeto(s, p.seat)) {
      const v = useCouncilVeto(s, p.seat);
      if (v.ok) { s = v.state; }
      break;
    }
  }
```

- `playOne` 的 `roll >= 0.85` 分支：在 `pickPlayableCard` **之前**插入：

```js
      const g = goalOf(s, seat);
      // ⚠️ Rng.next() 是可变对象（engine/core/dice.ts:21）⇒ **不额外抽随机数**：
      //   把 0.85–1.0 的出牌带二分（roll < 0.925 ⇒ 装备），随机流零扰动。
      if (g !== null && g.kind === 'equip_count'
        && (s.players[seat]?.counters.equipsTotal ?? 0) < g.count
        && roll < 0.925) {
        const toEquip = pickEquipCard(s, seat);
        if (toEquip !== undefined) {
          record(s, seat, actionKey({ type: 'EQUIP_CARD', actor: seat, cardId: toEquip.id }));
          s = performAction(s, seat, 'equip', { cardId: toEquip.id });
          s = await advanceWithDuel(s, 'standard', { gateReserve });
          continue;
        }
      }
```

⚠️ 该分支自带 `advanceWithDuel` + `continue`，与锁定分支同款；**不得**再走普通出牌块。

- [ ] **Step 4: 跑测试**

Run: `node --test tests/engine/policy-ai.test.ts tests/engine/policy-injection.test.ts tests/gates/sim-record.test.ts`
Expected: 全绿。**若**有固定 seed 的策略用例因「equip_count 身份改走装备」而红：先确认差异可归因于本批的行为变更（记录器/终局读数），把该用例的期望值随行为一起更新并在批次记录里注明——**不得**为了保绿而关掉装备分支。

- [ ] **Step 5: 提交**

```bash
git add tests/sim/policy.mjs tests/engine/policy-ai.test.ts
git commit -m "feat(B75): 模拟器 AI —— equip_count 身份概率装备、仲裁者自保否决"
```

---

### Task 8: IR 透传 rights + 门禁⑥

**Files:**
- Modify: `engine/types/ir.ts`、`build/build-ir.mjs`、`tools/parity-check.mjs`、`tools/ir-validate.mjs`
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（§6.7.1 / §9.3）
- Test: `tests/gates/parity-check.test.ts`（追加 rights 负样本）

**Interfaces:**
- Consumes: `Identity.rights`（T2）
- Produces: `IrIdentity.rights: readonly string[]`；theme↔IR 的 rights 不一致 ⇒ 门⑥ 红。

- [ ] **Step 1: 写失败测试**

在 `tests/gates/parity-check.test.ts` 加：

```ts
test('B75：IR 与 theme 的 rights 不一致必须报错', async () => {
  const { checkIrVsTheme } = await import('../../tools/parity-check.mjs');
  const theme = JSON.parse(readFileSync('themes/xianxia2026/theme.json', 'utf8'));
  const ir = { identities: theme.identities.map((i: any) => ({
    id: i.id, name: i.name, passiveText: i.passiveText,
    goalKind: i.goal.kind, goalCount: i.goal.count ?? 1,
    goalText: '', rights: i.id === 'arbiter' ? [] : (i.rights ?? []),
  })) };
  const errors = checkIrVsTheme(ir, theme);
  assert.ok(errors.some((e: string) => e.includes('rights')), '缺 rights 必须报错');
});
```

（若 `checkIrVsTheme` 的签名/返回不是这样，按文件实际形状调整；该文件已导出该函数。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/gates/parity-check.test.ts`
Expected: 新用例失败（无 rights 比较）。

- [ ] **Step 3: 实现透传与比较**

`engine/types/ir.ts` 的 `IrIdentity` 加：

```ts
  /** 身份权限位（B75；从 theme.json 直接透传，供 parity-check 抓漂移）。 */
  readonly rights: readonly string[];
```

`build/build-ir.mjs` 的 identities 映射加：

```js
      rights: i.rights ?? [],
```

`tools/parity-check.mjs` 的 identity `pairs` 加：

```js
      ['rights', JSON.stringify(o.rights ?? []), JSON.stringify(i.rights ?? [])],
```

`tools/ir-validate.mjs` 的身份比对（`passiveText` 那行附近）加：

```js
    if (JSON.stringify(i.rights ?? []) !== JSON.stringify(src2.rights ?? [])) {
      err('身份 ' + i.id + ' 的 rights 与 theme.json 不一致');
    }
```

- [ ] **Step 4: 规格同步**

主规格 §6.7.1 的 IR 身份字段列表加 `rights`；§9.3 的「主比对字段白名单」补一句「身份 rights 逐项比较」。

- [ ] **Step 5: 跑门禁⑥相关**

Run: `npm run build:ir && node tools/ir-validate.mjs && node tools/parity-check.mjs && node --test tests/gates/parity-check.test.ts`
Expected: 全绿；负样本用例转绿（比较已生效）。

- [ ] **Step 6: 提交**

```bash
git add engine/types/ir.ts build/build-ir.mjs tools/parity-check.mjs tools/ir-validate.mjs docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md tests/gates/parity-check.test.ts
git commit -m "feat(B75): IR 透传 rights + 双轨一致性比较（门⑥ 抓权限漂移）"
```

---

### Task 9: 重标定、文档与批次记录

**Files:**
- Modify: `tests/sim/run.mjs`（静态注记）
- Modify: `docs/balance-report.md`（重生成）
- Create: `docs/baselines/trial-reserve-scan-B75.json`、`docs/批次/B75-装备与否决机制补齐-执行记录.md`
- Modify: `tools/release-check.mjs`、`docs/沉淀/compare-scan-baseline.mjs`（默认基线）
- Modify: `README.md`、主规格 §4.1/§5.6/§6.2/§6.4、`docs/沉淀/经验教训索引.md`、`docs/沉淀/批次导航.md`

**Interfaces:**
- Consumes: T1–T8 全部
- Produces: 新基线、报告计数 > 0、批次记录与导航。

- [ ] **Step 1: 更正报告生成器的静态注记**

先 `grep -n "恒为" tests/sim/run.mjs` 定位「`equip_count` 与 `veto_success` 恒为 **0** —— 不是漏写计数器，而是机制缺失」那一行，改为：

```js
  lines.push('> ⚠️ `equip_count` / `veto_success` 自 **B75** 起机制已补齐（装备动作 / 仲裁者否决）；');
  lines.push('>   仍为 0 才说明「机制虽接线但不可达」——按计数器最大值分档判读（见下）。');
```

再 `grep -n "机制缺失" tests/sim/run.mjs` 定位「本仓 equip/veto 的机制缺失另有独立证据」那一行，改为「B75 前」的历史说明。

- [ ] **Step 2: 重生成平衡报告并核对两目标**

```bash
node tests/sim/run.mjs --out docs/balance-report.md > "$TEMP/b75-balance.log" 2>&1
grep -nE "equip_count|veto_success" docs/balance-report.md
```

Expected: 两行的达成次数 **均 > 0**；异常 0。若为 0，**停下**：检查 Task 7 的 AI 分支是否真的被执行（计数器最大值列）、以及旗标授予。

- [ ] **Step 3: 复核门⑪/⑫/⑬**

```bash
node tests/sim/run.mjs --trial-rate --check
node tests/sim/run.mjs --position-spread --games 100 --check
node docs/沉淀/verify-trial-reserve-critical.mjs
```

Expected: 三条 PASS；把门⑫ 的实测极差/RMS 写进 `tests/sim/run.mjs` 的注释（阈值**不动**）。

- [ ] **Step 4: 更新发布基线（B35 流程）**

```bash
node tests/sim/run.mjs --scan-reserves 0,1,2,3,4   --scan-seeds 1000,5000,9000,13000,17000,21000,25000,29000,33000,37000,41000,45000,49000,53000,57000,61000,65000,69000,73000,77000   --games 125 --scan-json "$TEMP/b75-scan.json"
cp "$TEMP/b75-scan.json" docs/baselines/trial-reserve-scan-B75.json
```

把 `tools/release-check.mjs` 与 `docs/沉淀/compare-scan-baseline.mjs` 的默认基线改为 `trial-reserve-scan-B75.json`（B74 快照保留）。

- [ ] **Step 5: 文档同步**

- README 的「动作契约」段：补 `EQUIP_CARD` / `COUNCIL_VETO`；身份说明补「仲裁者每局可否决 1 次」。
- 主规格 §4.1 仲裁者特权补否决；§5.6 山议结算补否决分支；§6.2 身份字段补 `rights`；§6.4 目标表把两行「机制缺失」注记改为「B75 已接通」。
- `docs/沉淀/经验教训索引.md` 追加 E125：机制缺失分三环（入口 → 写入 → 判定），补入口与写入时才会暴露即时结算的接线点。
- 新增 `docs/批次/B75-装备与否决机制补齐-执行记录.md`（目标、裁定、读数、验收、遗留、提交）。
- `docs/沉淀/批次导航.md`：加 B75 行并更新计数。

- [ ] **Step 6: 全门禁 + 发布**

```bash
node tools/gate.mjs
npm run release
```

Expected: `== PASS：13 门全绿 ==`；发布检查 `逐组一致：100 / 100`；发布包生成。

- [ ] **Step 7: 提交**

```bash
git add tests/sim/run.mjs docs/balance-report.md docs/baselines/trial-reserve-scan-B75.json tools/release-check.mjs docs/沉淀/compare-scan-baseline.mjs README.md docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md docs/沉淀/经验教训索引.md docs/沉淀/批次导航.md docs/批次/B75-装备与否决机制补齐-执行记录.md
git commit -m "docs(B75): 重标定平衡与发布基线 + 规格/README/经验教训/批次记录同步"
```

---

## 完成定义（对照 spec §12）

- [ ] `node tools/gate.mjs` 末尾 `== PASS：13 门全绿 ==`。
- [ ] `docs/balance-report.md` 的 `equip_count` 与 `veto_success` 达成次数均 > 0，异常 0。
- [ ] `npm run release` 逐组比对 100/100（B75 基线）。
- [ ] `npm test` 全绿、`typecheck` 0 错、`doc-sync` 10/10。
- [ ] 三层漂移守卫 / action-key 往返 / 正向一致性全绿。
- [ ] 工作树干净（`dist/` 被忽略；发布包成功生成）。
- [ ] 明确未做：装备被动、否决选目标、死亡/复活、新主题、模型接入。
