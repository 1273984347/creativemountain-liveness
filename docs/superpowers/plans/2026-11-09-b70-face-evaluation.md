# B70 决策面模型评估器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 sim 决策层抽成单一真相源并支持默认关闭的策略注入，建成可复跑的三面模型评估器，同时修掉对峙题面与记录器 key 格式两处已坐实缺陷。

**Architecture:** `tests/sim/policy.mjs` 承载 9 个决策函数 + recorder（依赖单向：`run.mjs → policy.mjs → engine/*`，`game-arms.mjs → policy.mjs → engine/*`）；`playOne` 改 async 并接受可选 `FacePolicy`，缺省时行为逐字不变；评估器只让座0 在指定面用模型，同 seed 配对跑 McNemar。

**Tech Stack:** Node 24 ESM（`.mjs`，**不得用 TS 非空断言 `!`**，见仓内 E22）、`node --test` 跑 `.ts` 测试、既有 Laya sidecar（`tools/laya-sidecar/up.mjs`，环回 :8712 + 反代 :8711）、无新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-11-09-b70-face-evaluation-design.md`（权威；本计划是它的施工论证，冲突以 spec 为准）

## Global Constraints

- **门 ⑨ 等价性硬证据**：抽模块与 async 化之后，`node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after-B70.md`（默认参数，不加 `--games/--themes/--players`）生成的报告与 `docs/balance-report.md` **`diff` 必须为空**。非空 ⇒ 定位求值顺序或漏搬，**禁止**重生成基线掩盖。
- **13 门全绿**：`node tools/gate.mjs` 末行必须是 `== PASS：13 门全绿 ==`。
- **发布包零增量**：`esbuild.config.mjs` / `build/build-package.mjs` 不得引用 `tools/laya-probe/**`；`git status --short dist/` 必须为空；`package.json` 只加脚本键，**不加任何依赖**。
- **模型只见公开信息**：禁止集 = 他人手牌 id、牌堆顺序、`duel.pickA`、`duel.pickB`；`state-text.mjs` 内**不得出现这些字段访问**（结构性白名单，不是事后擦除）。
- **服务只绑环回**：`127.0.0.1:8712`（官方）/ `:8711`（反代）；权重 `D:/<local-libs>/laya-multilingual/model.safetensors` = 643835514 字节、sha256 `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`。要测 CPU 用 `CUDA_VISIBLE_DEVICES=-1`（**空串在本机是病态组合**：`is_available()=True` 且 `device_count()=0`）。
- **判据不得下调**：每面 ≥400 局/臂、同 seed 配对 McNemar 连续性校正 `χ²=(|b−c|−1)²/(b+c)`、临界 **3.841**；措辞固定为「值得接入」/「未检出改善」/「劣于启发式」。
- **注入失败必须回落**：`decide` 返回 null / 非法 key / 抛错 / 超时(30s) / fetch 失败 ⇒ 走原启发式并计数，对局不得卡死，异常数必须 0。
- **本批不接入生产**：`policy` 缺省 `undefined`，sim CLI **不新增开关**。
- `.mjs` 里不得用 TS 语法（非空断言、类型标注）；测试用 `.ts` 走 `node --test`。
- Git：只 stage 任务列出的确切路径；**禁止** `git add -A`/`.`/`git stash`/`git reset`/`git checkout --`。提交信息 `feat(B70): …` / `fix(B70): …` / `docs(B70): …`（中文）。
- 不要编辑 `.superpowers/sdd/**` 台账或共享任务清单（控制器负责）；不要派发子代理或审查者。

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `tests/sim/policy.mjs` | 决策层单一真相源：9 个函数 + recorder + `setRecorder` + `FacePolicy` 注入 | Create（Task 1 搬移，Task 3 加注入） |
| `tests/sim/run.mjs` | CLI / 跑批 / 报告 / 门禁断言；import policy | Modify |
| `tools/laya-probe/state-text.mjs` | 可见性受限题面（颜色/点数 + 面感知指令） | Modify（Task 4） |
| `tools/laya-probe/key-normalize.mjs` | 历史 `duel_card:` → 规范形 `duel:card:` | Create（Task 2） |
| `tools/laya-probe/run.mjs` | P6 比较前归一化 | Modify（Task 2） |
| `tools/laya-probe/game-arms.mjs` | 三面两臂评估器 + McNemar | Create（Task 5） |
| `tests/engine/policy-extraction.test.ts` | 搬移完整性 / 无循环依赖 / 缺省等价 | Create（Task 1） |
| `tests/engine/policy-injection.test.ts` | 注入回落 / 面隔离 / 空候选 | Create（Task 3） |
| `tests/engine/key-normalize.test.ts` | 归一化三条 | Create（Task 2） |
| `tests/engine/game-arms-stats.test.ts` | McNemar 与配对逻辑（不依赖模型） | Create（Task 5） |
| `tests/engine/legal-probe.test.ts` | 题面词表 / 预算 / 禁止集同步 | Modify（Task 4） |
| `package.json` | 加 `eval:faces` | Modify（Task 5） |
| `docs/预研/2026-11-09-b70-face-evaluation.md`、`docs/批次/B70-*.md`、主规格 §7、`README.md` | 读数与口径 | Task 6 |

**任务顺序即依赖顺序**：1 → 2 → 3 → 4 → 5 → 6。

---

### Task 1: 抽出 `tests/sim/policy.mjs`（机械搬移 + async 化 + 删死代码）

**Files:**
- Create: `tests/sim/policy.mjs`
- Modify: `tests/sim/run.mjs`
- Test: `tests/engine/policy-extraction.test.ts`

**Interfaces:**
- Produces: `policy.mjs` 导出 `checkState(s,label)`、`pickTarget(s,seat)`、`councilTurn(s)`、`certificationTurn(s)`、`pickPlayableCard(hand,resource)`、`maybeUseAbility(s,seat)`、`advanceWithDuel(s,mode,opts)`、`async playOne(theme,players,seed,gateReserve)`、`record(state,seat,heuristic,face=null)`、`setRecorder(value)`、`getRecorder()`
- Consumes（Task 3/5 依赖）：`playOne` 的第 5 参 `policy` 在 Task 3 才加；本任务签名保持 4 参

- [ ] **Step 1: 写失败测试（搬移完整性 + 无循环依赖 + 缺省等价）**

```ts
// tests/engine/policy-extraction.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MOVED = ['checkState', 'pickTarget', 'councilTurn', 'certificationTurn',
  'maybeUseAbility', 'pickPlayableCard', 'playOne', 'advanceWithDuel', 'record'];

test('policy.mjs 存在且导出全部 9 个被搬函数', async () => {
  assert.ok(existsSync('tests/sim/policy.mjs'), 'policy.mjs 必须存在');
  const mod = await import('../../tests/sim/policy.mjs');
  for (const name of MOVED) { assert.equal(typeof mod[name], 'function', `缺导出：${name}`); }
  assert.equal(typeof mod.setRecorder, 'function');
});

test('run.mjs 不再保留被搬走的定义（防漏搬/防回流）', () => {
  const src = readFileSync('tests/sim/run.mjs', 'utf8');
  for (const name of MOVED) {
    assert.equal(new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\s*\\(`, 'm').test(src), false,
      `run.mjs 仍定义 ${name}`);
  }
});

test('policy.mjs 不 import run.mjs（防循环依赖 + 防 import 时误跑主流程）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*run\.mjs['"]/);
  assert.doesNotMatch(src, /require\([^)]*run\.mjs/);
});

test('两个死函数已删除（B18 委托引擎后零调用方）', () => {
  for (const f of ['tests/sim/run.mjs', 'tests/sim/policy.mjs']) {
    const src = readFileSync(f, 'utf8');
    for (const dead of ['pickDuelCard', 'resolveDuelByAI']) {
      assert.equal(src.includes(dead), false, `${f} 仍含死代码 ${dead}`);
    }
  }
});

test('缺省等价：省略后两参 与 显式传 undefined 结果逐字相同', async () => {
  const { playOne } = await import('../../tests/sim/policy.mjs');
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));
  const a = await playOne(theme, 4, 4242);
  const b = await playOne(theme, 4, 4242, undefined, undefined);
  assert.deepEqual({ winners: a.winners, rounds: a.rounds, reason: a.reason },
                   { winners: b.winners, rounds: b.rounds, reason: b.reason });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/policy-extraction.test.ts`
Expected: FAIL —— `policy.mjs 必须存在`（其余用例连带失败）

- [ ] **Step 3: 用抽取脚本做机械搬移（不要手抄 400 行）**

把下面脚本存为 `docs/预研/data/tmp/extract-policy.mjs`（gitignore 内，一次性）并运行。它按大括号配平切出函数、搬走 recorder 段、删两个死函数、生成 `policy.mjs`，并把 `run.mjs` 里对应源码片段替换为 import 与 `setRecorder` 装配。

```js
// docs/预研/data/tmp/extract-policy.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'tests/sim/run.mjs';
const src = readFileSync(P, 'utf8');
const MOVED = ['record', 'checkState', 'pickTarget', 'councilTurn', 'certificationTurn',
  'pickPlayableCard', 'maybeUseAbility', 'advanceWithDuel', 'playOne'];
const DEAD = ['pickDuelCard', 'resolveDuelByAI'];

function span(name) {
  const m = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
  if (m === null) { throw new Error(`找不到 ${name}`); }
  const start = m.index;
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') { depth += 1; }
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { return [start, i + 1]; } }
  }
  throw new Error(`括号未配平：${name}`);
}
const spans = [...MOVED, ...DEAD].map((n) => ({ n, r: span(n) })).sort((a, b) => a.r[0] - b.r[0]);
const bodies = MOVED.map((n) => {
  const s = spans.find((x) => x.n === n);
  return src.slice(s.r[0], s.r[1]).replace(/^export\s+/, '');
});
// recorder 三个模块级变量（连同 record 一起搬）
const recorderBlock = ['let recorder = null;', 'let recordSeq = 0;', 'let recordCtx = null;']
  .map((decl) => { const i = src.indexOf(decl); if (i < 0) { throw new Error('找不到 ' + decl); } return decl; }).join('\n');

// run.mjs：从后往前切除片段，避免索引位移
let out = src;
for (const s of [...spans].reverse()) { out = out.slice(0, s.r[0]) + out.slice(s.r[1]); }
for (const decl of ['let recorder = null;', 'let recordSeq = 0;', 'let recordCtx = null;']) {
  out = out.replace(decl + '\n', '');
}
// run.mjs 顶部补 import 与装配
const anchor = "import { actionKey } from '../../engine/core/action-key.ts';";
if (!out.includes(anchor)) { throw new Error('找不到 import 锚点'); }
out = out.replace(anchor, anchor + "\nimport { playOne, setRecorder } from './policy.mjs';");
out = out.replace('if (args.record !== null) { recorder = []; }', 'if (args.record !== null) { setRecorder([]); }');
// runCell 与其三处调用点 async 化
out = out.replace('function runCell(', 'async function runCell(');
out = out.replace('results.push(playOne(theme, players, seed, gateReserve));', 'results.push(await playOne(theme, players, seed, gateReserve));');
out = out.replaceAll('runCell(theme, players, args.games, args.seedBase, args.gateReserve)', 'await runCell(theme, players, args.games, args.seedBase, args.gateReserve)');
out = out.replaceAll('runCell(theme, players, args.games, seedBase, reserve)', 'await runCell(theme, players, args.games, seedBase, reserve)');
writeFileSync(P, out);

// policy.mjs：复制 run.mjs 原有 import 段（路径深度相同，均在 tests/sim/ 下）+ recorder + 9 个函数
const importEnd = src.indexOf('// ⚠️ B56：决策点记录器用到的两个**只读**工具');
const imports = src.slice(src.indexOf("import { readFileSync"), importEnd === -1 ? src.indexOf('const ROOT') : importEnd);
const header = `// 决策层单一真相源（B70 从 run.mjs 原样搬出）。
// ⚠️ 依赖必须单向：run.mjs → policy.mjs → engine/*；本文件**不得** import run.mjs
//   （run.mjs 有模块级主流程，被 import 就会跑一整轮模拟）。
// ⚠️ playOne 为 async：Task 3 起可注入需要 await 的模型策略；缺省 policy 时行为与搬移前逐字相同。
${imports}
import { stateToJson } from '../../engine/core/serialize.ts';
import { actionKey } from '../../engine/core/action-key.ts';

${recorderBlock}

/** 由 run.mjs 装配记录器（null = 关闭，record 为空操作）。 */
export function setRecorder(value) { recorder = value; recordSeq = 0; }
export function getRecorder() { return recorder; }

`;
const asynced = bodies.map((b) => b
  .replace('function playOne(', 'async function playOne(')
  .replaceAll('s = advanceWithDuel(', 's = await advanceWithDuel(')
  .replace('function advanceWithDuel(', 'async function advanceWithDuel('));
const exported = asynced.map((b) => 'export ' + b);
writeFileSync('tests/sim/policy.mjs', header + exported.join('\n\n') + '\n');
console.log('已生成 tests/sim/policy.mjs；run.mjs 已切除搬移片段并接线');
```

Run: `node docs/预研/data/tmp/extract-policy.mjs && node --check tests/sim/policy.mjs && node --check tests/sim/run.mjs`
Expected: 两个 `node --check` 均静默通过。若 `run.mjs` 里还有遗漏的 `recorder`/`recordSeq`/`recordCtx` 引用，`node --check` 不会报（运行时才报）⇒ 下一步用 grep 兜：

Run: `grep -nE "\brecorder\b|\brecordSeq\b|\brecordCtx\b" tests/sim/run.mjs`
Expected: 只剩注释里的字样与 `setRecorder([])` 那一行；任何**代码**引用都要改成 `getRecorder()` 或搬进 `policy.mjs`，并在报告里逐条列出改了什么。

- [ ] **Step 4: 补 run.mjs 里 recorder 说明注释的指向**

`run.mjs` 顶部原有一段解释 recorder 的注释（搬移后成了孤儿）。把它的首行改为指向新位置，其余保留：

```js
// ⚠️ B70：决策点记录器已随决策层搬入 tests/sim/policy.mjs（recorder/recordSeq/recordCtx/record）；
//   本文件只通过 setRecorder([]) 装配、通过 getRecorder() 读取。以下原说明保留作口径依据。
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/engine/policy-extraction.test.ts`
Expected: 5/5 PASS

- [ ] **Step 6: 门 ⑨ 逐字等价（本任务的核心验收）**

```bash
mkdir -p docs/预研/data/tmp
node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after-B70.md > docs/预研/data/tmp/sim-after-B70.log 2>&1
diff docs/balance-report.md docs/预研/data/tmp/balance-after-B70.md && echo "报告逐字一致"
```
Expected: 打印「报告逐字一致」。若有差异：先查 `runCell` 三处调用点是否都加了 `await`（漏一个会让 `cells` 里塞进 Promise 而不是结果），再查是否漏搬 helper；**不得**重生成 `docs/balance-report.md`。

- [ ] **Step 7: 全门禁 + 提交**

```bash
npm run typecheck && npm test && node tools/gate.mjs 2>&1 | tail -4
git add tests/sim/policy.mjs tests/sim/run.mjs tests/engine/policy-extraction.test.ts
git commit -m "refactor(B70): sim 决策层抽成 policy.mjs 单一真相源（async 化 + 删两个死函数，门⑨报告逐字等价）"
```
Expected: 13 门全绿；报告里贴 `diff` 为空与门禁尾行作为证据。

---

### Task 2: 记录器 key 规范形 + 探针读侧归一化

**Files:**
- Modify: `tests/sim/policy.mjs`（`advanceWithDuel` 内的 duel 记录行）
- Create: `tools/laya-probe/key-normalize.mjs`
- Modify: `tools/laya-probe/run.mjs`
- Test: `tests/engine/key-normalize.test.ts`

**Interfaces:**
- Produces: `normalizeLegacyKey(key: string): string`（`duel_card:<id>` → `duel:card:<id>`；其余原样返回）
- Consumes: `actionKey`（`engine/core/action-key.ts`）

- [ ] **Step 1: 写失败测试**

```ts
// tests/engine/key-normalize.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLegacyKey } from '../../tools/laya-probe/key-normalize.mjs';

test('历史 duel_card: 归一化为规范形', () => {
  assert.equal(normalizeLegacyKey('duel_card:c_windstep'), 'duel:card:c_windstep');
});
test('已是规范形则不变', () => {
  assert.equal(normalizeLegacyKey('duel:card:c_windstep'), 'duel:card:c_windstep');
});
test('非对峙 key 一律不动', () => {
  for (const k of ['play:c_fang->3', 'cert:sign:0', 'move', 'ask', 'vote:2', 'cert:mutual:1']) {
    assert.equal(normalizeLegacyKey(k), k);
  }
});
test('记录器不再手拼 duel_card:（改用 actionKey）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /'duel_card:'\s*\+/);
  assert.match(src, /actionKey\(\{\s*type:\s*'DUEL_SUBMIT_CARD'/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/key-normalize.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现归一化 + 改记录行**

```js
// tools/laya-probe/key-normalize.mjs
// 历史样本兼容：B70 之前 sim 记录器手拼 `duel_card:<id>`，而 actionKey 的规范形是 `duel:card:<id>`。
// 只在**读侧**归一化，历史 JSONL 不改写（保留原始数据）。
export function normalizeLegacyKey(key) {
  const s = String(key);
  return s.startsWith('duel_card:') ? 'duel:card:' + s.slice('duel_card:'.length) : s;
}
```

`tests/sim/policy.mjs` 的 `advanceWithDuel` 内，把
```js
record(stateAtPick, seat, 'duel_card:' + cardId);
```
改为
```js
record(stateAtPick, seat, actionKey({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId }));
```
并把该函数上方 `@param {string} heuristic` 注释里「对峙选牌用 `duel_card:<id>`」改为「对峙选牌用 `actionKey` 的规范形 `duel:card:<id>`」。

- [ ] **Step 4: 探针 P6 读侧接上归一化**

`tools/laya-probe/run.mjs`：顶部加 `import { normalizeLegacyKey } from './key-normalize.mjs';`，在构造每行结果时把启发式侧归一化（找到写 `heuristic:` 的那一处，改为 `heuristic: normalizeLegacyKey(rec.heuristic)`），并确保 `agree` 的比较两侧都用规范形。

- [ ] **Step 5: 跑测试 + 门禁**

Run: `node --test tests/engine/key-normalize.test.ts && npm test && node tools/gate.mjs 2>&1 | tail -3`
Expected: 4/4 PASS；13 门全绿（门 ⑨ 不受影响：记录器只在 `--record-decisions` 开启时才写）

- [ ] **Step 6: 提交**

```bash
git add tools/laya-probe/key-normalize.mjs tools/laya-probe/run.mjs tests/sim/policy.mjs tests/engine/key-normalize.test.ts
git commit -m "fix(B70): 对峙记录改用 actionKey 规范形 + 探针读侧归一化历史 duel_card（P6 不再被格式差异虚高）"
```

---

### Task 3: 策略注入（FacePolicy + 三个注入点 + 回落）

**Files:**
- Modify: `tests/sim/policy.mjs`
- Test: `tests/engine/policy-injection.test.ts`

**Interfaces:**
- Consumes: `getLegalActions`（`engine/core/legal.ts`）、`actionFromKey`/`withActor`（`engine/core/action-key.ts`）
- Produces: `playOne(theme, players, seed, gateReserve, policy?)`，`policy = { face: 'play'|'council'|'certify', seat: number, decide: (state, seat, candidates) => Promise<string|null>, timeoutMs?: number }`（`timeoutMs` 缺省 30000，仅为让超时测试不必真等 30 秒）；`playOne` 返回值新增 `injection: { calls, fallbacks, emptyCandidates }`

- [ ] **Step 1: 写失败测试（回落 / 面隔离 / 空候选 / 计数）**

```ts
// tests/engine/policy-injection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';

const theme = () => JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));

test('decide 返回 null ⇒ 回落启发式、对局正常结束、fallbacks 递增', async () => {
  const r = await playOne(theme(), 4, 4242, undefined, { face: 'play', seat: 0, decide: async () => null });
  assert.ok(r.rounds > 0);
  assert.ok(r.injection.calls > 0, '该面必须真的被问到');
  assert.equal(r.injection.fallbacks, r.injection.calls);
  assert.deepEqual(r.anomalies ?? [], []);
});

test('decide 抛错 / 返回非法 key ⇒ 同样回落且不死循环', async () => {
  for (const decide of [async () => { throw new Error('boom'); }, async () => 'bogus:key']) {
    const r = await playOne(theme(), 4, 4242, undefined, { face: 'council', seat: 0, decide });
    assert.ok(r.rounds > 0);
    assert.equal(r.injection.fallbacks, r.injection.calls);
  }
});

test('面隔离：face=council 时 play/certify 面不被调用', async () => {
  const seen: string[] = [];
  const r = await playOne(theme(), 4, 4242, undefined, {
    face: 'council', seat: 0,
    decide: async (s, seat, cands) => { seen.push(...cands.map((c) => c.type)); return null; },
  });
  assert.ok(r.injection.calls > 0);
  for (const t of seen) { assert.equal(t, 'VOTE', `越面调用：${t}`); }
});

test('decide 超时 ⇒ 回落（用 timeoutMs 缩短等待，避免测试真等 30s）', async () => {
  const r = await playOne(theme(), 4, 4242, undefined, {
    face: 'play', seat: 0, timeoutMs: 20,
    decide: () => new Promise(() => {}),        // 永不 resolve
  });
  assert.ok(r.rounds > 0, '超时必须回落，不得卡死');
  assert.equal(r.injection.fallbacks, r.injection.calls);
});

test('只有指定座位被问：seat=0 时 decide 收到的 seat 恒为 0', async () => {
  const seats = new Set<number>();
  await playOne(theme(), 4, 4242, undefined, {
    face: 'play', seat: 0, decide: async (_s, seat) => { seats.add(seat); return null; },
  });
  assert.deepEqual([...seats], [0]);
});

test('缺省 policy ⇒ injection 计数全 0，且结果与显式 undefined 相同', async () => {
  const a = await playOne(theme(), 4, 4242);
  const b = await playOne(theme(), 4, 4242, undefined, undefined);
  assert.deepEqual(a.injection, { calls: 0, fallbacks: 0, emptyCandidates: 0 });
  assert.deepEqual(a.winners, b.winners);
  assert.equal(a.reason, b.reason);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/policy-injection.test.ts`
Expected: FAIL —— `r.injection` 为 undefined

- [ ] **Step 3: 实现注入基础设施（policy.mjs 内）**

在 `policy.mjs` 顶部 import 追加：
```js
import { getLegalActions } from '../../engine/core/legal.ts';
import { actionFromKey, withActor } from '../../engine/core/action-key.ts';
```

加入下面这段（放在 `playOne` 之前）：
```js
/** 面 → 该面的动作类型集合（certify 面只含签印/质疑/弃权，判定与复议仍走原逻辑）。 */
const FACE_TYPES = {
  play: ['PLAY_CARD'],
  council: ['VOTE'],
  certify: ['CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN'],
};

/**
 * 问一次策略；任何失败都回落（返回 null），并计数。
 * ⚠️ 绝不抛错到调用方：注入失败不得让对局卡死或丢样本。
 */
async function askPolicy(policy, state, seat, counters) {
  const types = FACE_TYPES[policy.face];
  const candidates = getLegalActions(state, seat).filter((a) => types.includes(a.type));
  if (candidates.length === 0) { counters.emptyCandidates += 1; return null; }
  counters.calls += 1;
  try {
    const key = await Promise.race([
      policy.decide(state, seat, candidates),
      new Promise((_, rej) => setTimeout(() => rej(new Error('policy-timeout')), policy.timeoutMs ?? 30000)),
    ]);
    if (typeof key !== 'string') { counters.fallbacks += 1; return null; }
    const action = withActor(actionFromKey(key), seat);
    const match = candidates.find((c) => actionKey(c) === actionKey(action));
    if (match === undefined) { counters.fallbacks += 1; return null; }
    return match;
  } catch { counters.fallbacks += 1; return null; }
}
```

- [ ] **Step 4: 三个注入点接线（只加改道分支，原逻辑保留为回落路径）**

`playOne` 签名改为 `async function playOne(theme, players, seed, gateReserve, policy)`，函数体开头加：
```js
  const counters = { calls: 0, fallbacks: 0, emptyCandidates: 0 };
  const hit = (seat) => policy !== undefined && policy !== null && policy.seat === seat;
```
返回值对象里加 `injection: counters`。

① **play 面**：`playOne` 里两处选牌（待认证锁定分支与普通分支）。

**待认证锁定分支**（该分支原本就以 `advanceWithDuel` + `continue` 收尾，故改道分支自带推进）：在 `const card = pickPlayableCard(lockedHand, ...)` 之前插入：
```js
      if (hit(seat)) {
        const picked = await askPolicy(policy, s, seat, counters);
        if (picked !== null && picked.type === 'PLAY_CARD') {
          const payload = picked.target === undefined ? { cardId: picked.cardId } : { cardId: picked.cardId, target: picked.target };
          record(s, seat, actionKey(picked));
          s = performAction(s, seat, 'act', payload);
          s = await advanceWithDuel(s, 'standard', { gateReserve });
          continue;
        }
      }
```

**普通分支**：⚠️ **不得用 `continue`** —— 该分支尾部还有 `s = await advanceWithDuel(...)` 与 `firstPendingSeat` 统计，跳过会让模型臂少记「首个登顶者」传导数据。改用标志位把原决策块整体包起来：
```js
    let injected = false;
    if (hit(seat)) {
      const picked = await askPolicy(policy, s, seat, counters);
      if (picked !== null && picked.type === 'PLAY_CARD') {
        const payload = picked.target === undefined ? { cardId: picked.cardId } : { cardId: picked.cardId, target: picked.target };
        record(s, seat, actionKey(picked));
        s = performAction(s, seat, 'act', payload);
        injected = true;
      }
    }
    if (!injected) {
      const roll = s.rng.next();
      // …原有的 0.16 / 0.75 / 0.85 三段决策**整块**移进这里，逐字不改…
    }
    s = await advanceWithDuel(s, 'standard', { gateReserve });
    // …原有 firstPendingSeat 统计保持不动…
```
改道命中时**不消耗** `s.rng.next()`（原决策块被跳过）⇒ 模型臂随机流自首个分歧起与基线分叉，这是策略注入的固有效应，必须写进批次记录。

② **council 面**：`councilTurn(s)` 改为 `async function councilTurn(s, policy, counters, hit)`，在其投票分支前插入：
```js
    if (hit(p.seat)) {
      const picked = await askPolicy(policy, s, p.seat, counters);
      if (picked !== null && picked.type === 'VOTE') {
        record(s, p.seat, actionKey(picked));
        const v = castVote(s, p.seat, picked.target);
        if (v.ok) { s = v.state; continue; }
      }
    }
```
`playOne` 内调用点改为 `s = await councilTurn(s, policy, counters, hit);`

③ **certify 面**：`certificationTurn(s)` 改为 `async function certificationTurn(s, policy, counters, hit)`，在 `const challenger = p.resource >= 2 && s.rng.next() < 0.2;` **之前**插入：
```js
      if (hit(p.seat)) {
        const picked = await askPolicy(policy, s, p.seat, counters);
        if (picked !== null) {
          record(s, p.seat, actionKey(picked));
          const r = picked.type === 'CERTIFY_CHALLENGE' ? certifyChallenge(s, p.seat, target)
            : picked.type === 'CERTIFY_ABSTAIN' ? certifyAbstain(s, p.seat, target)
            : certifySign(s, p.seat, target);
          if (r.ok) { s = r.state; continue; }
        }
      }
```
`playOne` 内调用点改为 `s = await certificationTurn(s, policy, counters, hit);`
⚠️ `certifyAbstain` 需加进 `policy.mjs` 的 certification import 列表（原文件只 import 了 sign/challenge/answer/appeal/appealVote/mutualSign）。
⚠️ 改道命中时**不再消耗** `s.rng.next()` 的那次 0.2 判定 ⇒ 模型臂的随机流与基线臂从此分叉，这是策略注入的固有效应，**必须在批次记录里写明**，不得声称两臂随机流一致。

- [ ] **Step 5: 跑测试 + 门 ⑨ 等价 + 全门禁**

```bash
node --test tests/engine/policy-injection.test.ts
node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after-B70.md > docs/预研/data/tmp/sim-after-B70.log 2>&1
diff docs/balance-report.md docs/预研/data/tmp/balance-after-B70.md && echo "报告逐字一致"
npm run typecheck && npm test && node tools/gate.mjs 2>&1 | tail -3
```
Expected: 注入测试 6/6；`diff` 为空（缺省 policy 路径未变）；13 门全绿

- [ ] **Step 6: 提交**

```bash
git add tests/sim/policy.mjs tests/engine/policy-injection.test.ts
git commit -m "feat(B70): playOne 支持默认关闭的 FacePolicy 注入（三面改道 + 失败必回落 + 计数）"
```

---

### Task 4: 对峙题面补颜色/点数 + 面感知指令

**Files:**
- Modify: `tools/laya-probe/state-text.mjs`
- Modify: `tests/engine/legal-probe.test.ts`（词表与预算同步）

**Interfaces:**
- Consumes: 既有 `describeState`/`describeAction`/`buildChoice` 签名不变
- Produces: `buildChoice(state, seat).instructions` 现在随候选所属面变化

- [ ] **Step 1: 写失败测试（追加到 legal-probe.test.ts）**

```ts
test('B70：对峙候选描述含颜色与点数', async () => {
  const { describeAction } = await import('../../tools/laya-probe/state-text.mjs');
  const { mk } = await import('./fixtures.ts');
  const { startDuel } = await import('../../engine/core/duel.ts');
  const s = startDuel(mk(4, 7), 0, 1);
  const seat = s.duel.seatA;
  const card = s.players[seat].hand[0];
  const text = describeAction(s, { type: 'DUEL_SUBMIT_CARD', actor: seat, cardId: card.id }, seat);
  assert.ok(text.includes(card.color === 'red' ? '红' : '黑'), `缺颜色：${text}`);
  assert.ok(text.includes(String(card.rank)), `缺点数：${text}`);
  assert.ok(text.length <= 40, `超预算：${text.length}`);
});

test('B70：对峙面 instructions 写明规则并限定只能选亮牌', async () => {
  const { buildChoice } = await import('../../tools/laya-probe/state-text.mjs');
  const { mk } = await import('./fixtures.ts');
  const { startDuel } = await import('../../engine/core/duel.ts');
  const s = startDuel(mk(4, 7), 0, 1);
  const q = buildChoice(s, s.duel.seatA);
  assert.ok(Object.keys(q.criteria).length > 0, '对峙参与者必须有候选');
  for (const k of Object.keys(q.criteria)) { assert.ok(k.startsWith('duel:card:'), `混入别面：${k}`); }
  assert.match(q.instructions, /红/);
  assert.match(q.instructions, /点数/);
  assert.match(q.instructions, /只能/);
});

test('B70：非对峙面 instructions 不含对峙规则（面感知不得污染其它面）', async () => {
  const { buildChoice } = await import('../../tools/laya-probe/state-text.mjs');
  const { mk } = await import('./fixtures.ts');
  const q = buildChoice(mk(4, 7), 0);
  assert.doesNotMatch(q.instructions, /红牌胜黑牌/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/legal-probe.test.ts`
Expected: 新增 3 条 FAIL（描述缺颜色/点数、指令不含规则）

- [ ] **Step 3: 改 `describeAction` 的对峙分支**

`tools/laya-probe/state-text.mjs` 里：
```js
    case 'DUEL_SUBMIT_CARD': {
      const card = cardOf(action.cardId);
      return cut(`对峙锁定亮牌：出「${card.name}` + '」');
    }
```
改为：
```js
    case 'DUEL_SUBMIT_CARD': {
      const card = cardOf(action.cardId);
      return cut(`对峙亮牌「${card.name}」（${card.color === 'red' ? '红' : '黑'}·点数${card.rank}）`);
    }
```

- [ ] **Step 4: 让 `buildChoice` 的面感知指令**

把 `buildChoice` 里固定的 `instructions` 改为按候选集推导：
```js
export function buildChoice(state, seat) {
  const actions = getLegalActions(state, seat);
  const criteria = {};
  for (const a of actions) { criteria[actionKey(a)] = describeAction(state, a, seat); }
  const onlyDuel = actions.length > 0 && actions.every((a) => a.type === 'DUEL_SUBMIT_CARD');
  const instructions = onlyDuel
    ? '对峙规则：红牌胜黑牌；同色则点数大者胜；同点平局各弃一张。亮牌不回手牌；败者退1格并抽1张。只能从下列自己的手牌里选一张锁定，选哪张？'
    : '现在轮到该玩家行动，应选哪个动作？';
  return { instructions, criteria, noLegalActions: actions.length === 0 };
}
```
⚠️ 若原实现的 `noLegalActions` 计算方式不同，保留原语义（等价即可），不得改其含义。

- [ ] **Step 5: 同步封闭词表（不得放宽）**

新描述引入了 `对峙亮牌`、`点数`、`·` 等词形。跑测试看词表守卫报哪些 token 不在词表，然后**只把公开集里的词**加进 `TEMPLATE_WORDS`/`TEMPLATE_SKELETONS`：
Run: `node --test tests/engine/legal-probe.test.ts 2>&1 | grep -A3 "词表外"`
按输出逐条补词（例如 `对峙亮牌`、`点数`），**不得**为了让测试过而删除断言或把整类 token 放行。补完再跑，禁止集守卫（粘连泄漏 / 解构 / 括号访问）必须仍绿。

- [ ] **Step 6: 全门禁 + 提交**

```bash
node --test tests/engine/legal-probe.test.ts && npm run typecheck && npm test && node tools/gate.mjs 2>&1 | tail -3
git add tools/laya-probe/state-text.mjs tests/engine/legal-probe.test.ts
git commit -m "fix(B70): 对峙题面补颜色/点数与规则、指令按候选面生成（词表同步不放宽）"
```

---

### Task 5: 评估器 `game-arms.mjs` + 统计单测

**Files:**
- Create: `tools/laya-probe/game-arms.mjs`、`tools/laya-probe/face-stats.mjs`
- Modify: `package.json`
- Test: `tests/engine/game-arms-stats.test.ts`

**Interfaces:**
- Consumes: `playOne(theme, players, seed, gateReserve, policy)`（Task 3）、`describeState`/`buildChoice`（Task 4）、反代 `LAYA_PROXY_URL ?? http://127.0.0.1:8711`
- Produces: `mcnemar(b, c) → { b, c, chi2, significant }`、`pairWinners(base, arm) → { b, c, both, neither, changed }`；CLI `npm run eval:faces`

- [ ] **Step 1: 写失败测试（统计逻辑，不依赖模型）**

```ts
// tests/engine/game-arms-stats.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcnemar, pairWinners, verdictOf } from '../../tools/laya-probe/face-stats.mjs';

test('McNemar 连续性校正与临界值', () => {
  const r = mcnemar(14, 4);
  assert.equal(r.chi2, Number(((Math.abs(14 - 4) - 1) ** 2 / 18).toFixed(6)));
  assert.equal(r.significant, r.chi2 > 3.841);
  assert.equal(r.significant, true);          // 4.5 > 3.841
  assert.equal(mcnemar(17, 8).significant, false);   // 2.56 < 3.841
});

test('b+c=0 ⇒ 无可配对差异，不得报显著', () => {
  const r = mcnemar(0, 0);
  assert.equal(r.chi2, 0);
  assert.equal(r.significant, false);
  assert.equal(r.noDiscordant, true);
});

test('配对计数：b=基线赢而模型输，c=反之', () => {
  const base = [[0], [1], [0], [2]];
  const arm  = [[1], [1], [0], [0]];
  const p = pairWinners(base, arm, 0);
  assert.equal(p.b, 1);      // 第1局：基线含0、臂不含
  assert.equal(p.c, 1);      // 第4局：基线不含0、臂含
  assert.equal(p.both, 1);   // 第3局
  assert.equal(p.neither, 1);// 第2局
  assert.equal(p.changed, 2);
});

test('判定措辞固定三种，不得自由发挥', () => {
  assert.equal(verdictOf({ significant: true, improved: true }), '该面值得接入，另立批次做门 ⑨ 重校准');
  assert.equal(verdictOf({ significant: false, improved: true }), '未检出改善');
  assert.equal(verdictOf({ significant: false, improved: false }), '未检出改善');
  assert.equal(verdictOf({ significant: true, improved: false }), '该面模型劣于启发式，保持贪心');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/engine/game-arms-stats.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `face-stats.mjs`**

```js
// tools/laya-probe/face-stats.mjs
// 纯统计，无 IO、无模型 ⇒ 可单测。临界 3.841 = χ²(1) 的 p=0.05。
export const CHI2_CRITICAL = 3.841;

export function mcnemar(b, c) {
  const n = b + c;
  const chi2 = n === 0 ? 0 : Number(((Math.abs(b - c) - 1) ** 2 / n).toFixed(6));
  return { b, c, chi2, significant: chi2 > CHI2_CRITICAL, noDiscordant: n === 0 };
}

/** winners 数组里是否含该座位。 */
const won = (winners, seat) => Array.isArray(winners) && winners.includes(seat);

export function pairWinners(baseWinners, armWinners, seat) {
  let b = 0, c = 0, both = 0, neither = 0;
  const n = Math.min(baseWinners.length, armWinners.length);
  for (let i = 0; i < n; i += 1) {
    const x = won(baseWinners[i], seat), y = won(armWinners[i], seat);
    if (x && !y) { b += 1; } else if (!x && y) { c += 1; } else if (x && y) { both += 1; } else { neither += 1; }
  }
  return { b, c, both, neither, changed: b + c, paired: n };
}

export function verdictOf({ significant, improved }) {
  if (!significant) { return '未检出改善'; }
  return improved ? '该面值得接入，另立批次做门 ⑨ 重校准' : '该面模型劣于启发式，保持贪心';
}
```

- [ ] **Step 4: 跑统计测试确认通过**

Run: `node --test tests/engine/game-arms-stats.test.ts`
Expected: 4/4 PASS

- [ ] **Step 5: 实现 `game-arms.mjs`（评估器主体）**

```js
// tools/laya-probe/game-arms.mjs
// 三面两臂评估器（B70）。可复跑；不进门禁；无服务即 SKIP 退出码 0。
// 用法：先起 node tools/laya-sidecar/up.mjs --weights <权重路径>，再 npm run eval:faces
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

const themeObjs = THEMES.map((id) => JSON.parse(readFileSync(resolve(ROOT, 'themes', id, 'theme.json'), 'utf8'));
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
  const q = (p) => sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const row = {
    face, gamesPerArm: arms.baseline.length, seeds: SEEDS, players: PLAYERS, themes: THEMES,
    baselineSeat0Wins: wins(arms.baseline), modelSeat0Wins: wins(arms.model),
    baselineWinRate: Number(baseRate.toFixed(4)), modelWinRate: Number(modelRate.toFixed(4)),
    improved: modelRate > baseRate, ...p, ...stat,
    changedRate: Number((p.changed / Math.max(1, p.paired)).toFixed(4)),
    verdict: verdictOf({ significant: stat.significant, improved: modelRate > baseRate }),
    modelCalls: timings.length, latencyMs: { p50: q(0.5), p95: q(0.95) },
    fallbackGames: { baseline: arms.baseline.filter((g) => g.reason === 'fallback').length, model: arms.model.filter((g) => g.reason === 'fallback').length },
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
```

- [ ] **Step 6: 加脚本键 + 验证 SKIP 与语法**

`package.json` 的 `scripts` 内加一行（不加任何依赖）：
```json
    "eval:faces": "node tools/laya-probe/game-arms.mjs"
```
Run: `node --check tools/laya-probe/game-arms.mjs && node --check tools/laya-probe/face-stats.mjs && npm run eval:faces; echo "exit=$?"`
Expected: 两个 `--check` 静默；**服务未起时**输出 `SKIP {"reason":"no-sidecar",...}` 且 `exit=0`

- [ ] **Step 7: 提交**

```bash
node --test tests/engine/game-arms-stats.test.ts && npm test && node tools/gate.mjs 2>&1 | tail -3
git add tools/laya-probe/game-arms.mjs tools/laya-probe/face-stats.mjs tests/engine/game-arms-stats.test.ts package.json
git commit -m "feat(B70): 三面两臂评估器 + McNemar 统计（可复跑、无服务即 SKIP、不进门禁）"
```

---

### Task 6: 跑三面评估 + 口径同步 + 批次记录

**⚠️ 外向副作用：本任务要起本地模型服务并占用 GPU 约 10–20 分钟。执行前先取得用户同意。**

**Files:**
- Create: `docs/预研/2026-11-09-b70-face-evaluation.md`（由 Task 5 的脚本生成，本任务补判定与结论）
- Create: `docs/批次/B70-决策面评估与题面修正-执行记录.md`
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` §7、`README.md`

- [ ] **Step 1: 起服务并跑评估**

```bash
node tools/laya-sidecar/up.mjs --weights "D:/<local-libs>/laya-multilingual/model.safetensors"   # 前台，另开一个终端跑下一步
npm run eval:faces
```
Expected: 三面各打印一行读数；`docs/预研/data/b70-face-arms.json` 与报告生成；三面 `anomalies` 均为 0。跑完 **Ctrl+C 停服务**，并确认端口释放：
```bash
for p in 8711 8712; do curl -s -o /dev/null -w "$p → %{http_code}\n" --max-time 2 http://127.0.0.1:$p/health; done
```
Expected: 两个都是 `000`（无响应）。

- [ ] **Step 2: 核对判据未被下调**

Run: `node -e "const r=require('./docs/预研/data/b70-face-arms.json').results; for(const x of r){if(x.gamesPerArm<400)throw new Error(x.face+' 局数不足');} console.log('三面均 ≥400 局/臂')"`
Expected: 打印「三面均 ≥400 局/臂」。若某面因 30 分钟预算中断 ⇒ 如实登记「未跑满」，**不得**把判定写成达标。

- [ ] **Step 3: 补报告的结论段**

在生成的报告末尾追加：三面各自的判定（照抄脚本给出的固定措辞）、`b/c/χ²` 与胜率、回落与空候选计数、延迟（若脚本未记则从 sidecar 日志取）、以及「本批只评估不接入」的声明。若某面判为「值得接入」，写明**下一步是另立批次做门 ⑨ 重校准**，不在本批接入。

- [ ] **Step 4: 口径同步**

主规格 §7 追加一段：`tests/sim/policy.mjs` 是决策层单一真相源；`playOne` 的第 5 参 `FacePolicy` 默认关闭；评估器 `tools/laya-probe/game-arms.mjs` 不进门禁；对峙选牌保持贪心（引 B70 实测依据）。`README.md` 登记 B70 结论与「模型未接入生产」。

- [ ] **Step 5: 写批次记录**

`docs/批次/B70-决策面评估与题面修正-执行记录.md`，照仓内体例（目标 / 裁定 / 实现 / 验收 / 复盘 / 遗留 / 提交）。必须包含：门 ⑨ `diff` 为空的证据、13 门尾行、三面读数表、随机流分叉的口径注记、两个死函数已删、以及提交哈希按口径写 `<hash>` 待回填（并入下一批首个提交）。

- [ ] **Step 6: 最终验收 + 提交**

```bash
npm run doc-sync && npm run typecheck && npm test && node tools/gate.mjs 2>&1 | tail -3
git status --short dist/
git add docs/预研/2026-11-09-b70-face-evaluation.md docs/预研/data/b70-face-arms.json "docs/批次/B70-决策面评估与题面修正-执行记录.md" docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md README.md
git commit -m "feat(B70): 三面评估读数落档 + 规格/README 口径同步 + 批次记录"
```
Expected: doc-sync 通过、13 门全绿、`git status --short dist/` 为空。
⚠️ `b70-face-arms.json` 入库前先量体积（仓内纪律：已入库文件 ≤2MB，见 E107）；超限则改为 gitignore + 在记录里写重新生成命令，仓内只留小样本。

---

## 完成定义（对照 spec §11）

- [ ] `policy.mjs` 落地、`run.mjs` 不再保留 9 个被搬定义、`policy.mjs` 不 import `run.mjs`、两个死函数已删
- [ ] 门 ⑨ 默认参数报告 `diff` 为空；`node tools/gate.mjs` 13 门全绿
- [ ] 记录器用 `actionKey` 规范形；探针读侧归一化有测试；历史 JSONL 未改写
- [ ] `FacePolicy` 三面注入 + 四类失败必回落 + 面隔离 + 只有指定座位被问，全部有测试
- [ ] 对峙题面含颜色/点数/规则、指令面感知；词表同步且禁止集守卫仍绿
- [ ] 评估器可复跑、无服务 SKIP 退出码 0、三面各 ≥400 局/臂、判定措辞按 spec 固定
- [ ] 报告 + 批次记录 + 规格 §7 + README 落档；`dist/` 无增量；`package.json` 无新依赖
- [ ] 服务已停、端口释放、工作树干净（除本批提交）
- [ ] **不含**：模型接入生产/sim 默认路径、得分公式改动、微调
