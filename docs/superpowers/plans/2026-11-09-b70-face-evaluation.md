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

## 事实来源与干跑证据（可追踪）

本计划的锚点、行号、词表清单**不是推测**，来源如下（新会话可复核）。

⚠️ `docs/预研/data/tmp/**` 被 `.gitignore:23` 忽略（`git check-ignore -v docs/预研/data/tmp/` 可证）⇒ 下面提到的干跑脚本与日志**不入库、随时可能不在**。因此每行的「复核方式」只给**从仓内已提交内容直接重算**的命令，不依赖 tmp 里的一次性脚本；一次性脚本的正文凡是本计划需要的都写在对应 Task 里（落到任意临时路径即可复跑）。行号会随施工漂移，**以锚点字符串为准**。

| 事实 | 首次坐实于 | 复核方式（只需已提交的仓内文件） |
|---|---|---|
| 9 个可搬函数、2 个零调用死函数、`run.mjs` 无 ES importer | 只读调研 + 干跑 | `grep -nE "^(export )?function " tests/sim/run.mjs`；`grep -rn "pickDuelCard\|resolveDuelByAI" --include=*.mjs --include=*.ts --include=*.js .`（排除 node_modules）应只有定义行、无调用 |
| `runCell` 调用点 = 定义 562 + 调用 881/948/1084；`runPositionSpread` 876、`runGateReserveScan` 935、其调用点 1058/1063 | 干跑脚本（tmp，已失效） | `grep -nE "(async )?function (runCell\|runPositionSpread\|runGateReserveScan)\|(await )?runCell\(|runPositionSpread\(|runGateReserveScan\(" tests/sim/run.mjs` |
| `recorder` 搬出后 `run.mjs` 仍剩代码引用 = 落盘段 `if (args.record !== null && recorder !== null) {` 与 `const lines = recorder.map(...)` | 同上 | 搬移前 `grep -nE "\brecorder\b" tests/sim/run.mjs` 实测 10 命中（50/62/78/80/93/453/458/1050/1094/1095）；其中 1050 与 1094–1095 在搬移后留在 `run.mjs`，必须按 Task 1 Step 3 改写（`setRecorder([])` / `getRecorder()`），否则 `--record-decisions` 运行期 `ReferenceError` |
| 搬后 22 个 import 绑定零使用 | 同上 | Task 1 Step 4b 的 prune 脚本会打印实际清单（脚本正文在本文件内，可直接复跑） |
| `councilTurn` 178–190、循环头 `for (const p of alive) {`、`castVote(s, p.seat, t)` | 只读调研 | `sed -n '178,190p' tests/sim/run.mjs` |
| `certificationTurn` 的 `const challenger = …` 在 198、内层循环头 196；`certifyAbstain` 导出于 `certification.ts:135` 且原 import 列表（32–35）不含它 | 只读调研 | `grep -n "const challenger" tests/sim/run.mjs`（应 1 命中） |
| `playOne` 锁定分支 421–436、待包裹范围 437–474、475 推进、476–480 firstPending | 只读调研 | `sed -n '421,481p' tests/sim/run.mjs` |
| `buildChoice` 249–266 含 key 撞车抛错，被 `legal-probe.test.ts:2154` 钉住 | 只读调研 | `sed -n '249,266p' tools/laya-probe/state-text.mjs` |
| 词表缺失**恰好 10 条**（8 WORDS + 2 SKELETONS） | 实算脚本（tmp，已失效）+ 同名日志 | **不依赖脚本**：按 Task 4 Step 3–4 改完题面后跑 `node --test tests/engine/legal-probe.test.ts`，词表守卫（`scannedText` 1563、`generalize` 1395、`TOKEN_RUN` 1385）会把**实际缺失的 token 逐条打印**，与 Task 4 Step 5 的 10 条清单比对；不一致 ⇒ 以实跑输出为准并在报告里说明差异 |
| 完整事实汇编（1235 行，含原文片段） | `.superpowers/sdd/2026-11-08-creativemountain-laya-sidecar/b70-hardening-facts.md` | 该目录被 `.superpowers/sdd/.gitignore` 的 `*` 忽略，不入库；丢失时按上表命令重查 |

**干跑已证伪并修正的四条原计划假设**（施工时不得回退到旧写法）：
1. 只把 `runCell` 改 async ⇒ 881/948 的 `await` 落在同步的 `runPositionSpread`/`runGateReserveScan` 里 ⇒ `SyntaxError: Unexpected reserved word`。**必须三个函数一起 async**。
2. 漏改落盘段的 `recorder` 引用 ⇒ 带 `--record-decisions` 时 `ReferenceError`，门 ②（`tests/gates/sim-record.test.ts:57/73`）必红。**必须改 `getRecorder()`**。
3. recorder 注释块首行是 `/**`（44 行），标题在 45 行 ⇒ 「替换首行」会锚错。**必须用 45 行那句作 old_string**。
4. `buildChoice` 的简化替换体会删掉 key 撞车抛错 ⇒ 常驻用例红。**必须保留该 throw 逐字不动**。

**硬化后的搬移脚本已在沙箱干跑通过**（不碰仓内文件）。复跑步骤（沙箱只是一个临时目录，仓内文件保持不动）：

```bash
mkdir -p /tmp/b70-sandbox/tests/sim
cp tests/sim/run.mjs /tmp/b70-sandbox/tests/sim/
# 把 Task 1 Step 3 的代码块（以 `const P = 'tests/sim/run.mjs'` 开头的那段）
# 原样存为 /tmp/b70-sandbox/extract.mjs —— 该脚本用相对路径读写，故必须在沙箱目录下执行
cd /tmp/b70-sandbox && node extract.mjs
node --check tests/sim/policy.mjs && node --check tests/sim/run.mjs   # 两者均静默通过
```

再在**沙箱目录**下跑下面这个核验脚本（存为 `/tmp/b70-sandbox/verify.mjs`），11 项必须与实测输出逐字一致：

```js
import fs from 'node:fs';
const base = 'tests/sim/';
const pol = fs.readFileSync(base + 'policy.mjs', 'utf8');
const run = fs.readFileSync(base + 'run.mjs', 'utf8');
const want = ['checkState', 'pickTarget', 'councilTurn', 'certificationTurn', 'maybeUseAbility', 'pickPlayableCard', 'playOne', 'advanceWithDuel', 'record'];
const has = (src, n) => new RegExp('function\\s+' + n + '\\s*\\(').test(src);
console.log('9 函数都在 policy.mjs:', want.every((n) => has(pol, n)));
console.log('export 个数:', (pol.match(/^export /gm) || []).length, '(期望 11)');
console.log('playOne async:', /async\s+function\s+playOne\s*\(/.test(pol), '| advanceWithDuel async:', /async\s+function\s+advanceWithDuel\s*\(/.test(pol));
console.log('policy 不 import run.mjs:', !/from\s+'[^']*run\.mjs'/.test(pol));
for (const f of ['runCell', 'runPositionSpread', 'runGateReserveScan']) {
  console.log(f, 'async:', new RegExp('async\\s+function\\s+' + f + '\\s*\\(').test(run));
}
console.log('run.mjs await 次数:', (run.match(/await /g) || []).length);
console.log('死函数已删:', !/pickDuelCard|resolveDuelByAI/.test(pol + run));
console.log('getRecorder 接线:', run.includes('const rec = getRecorder();'));
console.log('run.mjs 仍定义被搬函数:', want.filter((n) => new RegExp('^\\s*(export\\s+)?(async\\s+)?function\\s+' + n + '\\s*\\(', 'm').test(run)));
console.log('policy.mjs 保留了函数上方注释:', /\/\*\*|\/\//.test(pol.slice(0, pol.indexOf('export'))));
```

实测输出（11 项全 true / 符合期望）：`9 函数都在 policy.mjs: true`、`export 个数: 11`、`playOne async: true`、`advanceWithDuel async: true`、`policy 不 import run.mjs: true`、`runCell/runPositionSpread/runGateReserveScan async: true`、`run.mjs await 次数: 6`、`死函数已删: true`、`getRecorder 接线: true`、`run.mjs 仍定义被搬函数: []`、`policy.mjs 保留了函数上方注释: true`。
⚠️ 沙箱内**不能** `import policy.mjs` 做运行时核验（沙箱没有 `engine/`，会 `ERR_MODULE_NOT_FOUND`）⇒ 运行时核验必须在真实仓内按 Task 1 Step 5–7 做；沙箱干跑只证明**文本层面**的搬移正确。

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
/** 函数体 + 其上方紧邻的注释块（否则注释会留在 run.mjs 成孤儿）。
 *  遇到分节分隔线（`// ----------` / `// =====`）就停，避免把属于留存代码的节标题搬走。 */
function spanWithComments(name) {
  const [s0, e0] = span(name);
  const pre = src.slice(0, s0).split('\n');
  let i = pre.length - 2;                       // slice  ending at line start ⇒ 末元素是空串
  while (i >= 0) {
    const t = pre[i].trim();
    if (t === '' ) { break; }
    if (/^\/\/\s*(-{3,}|={3,})/.test(t)) { break; }
    if (!/^(\/\/|\/\*|\*\/|\*)/.test(t)) { break; }
    i -= 1;
  }
  const cut = i + 1;
  const s1 = cut === 0 ? 0 : pre.slice(0, cut).join('\n').length + 1;
  return [s1, e0];
}
const spans = [...MOVED, ...DEAD].map((n) => ({ n, r: spanWithComments(n) })).sort((a, b) => a.r[0] - b.r[0]);
const bodies = MOVED.map((n) => {
  const s = spans.find((x) => x.n === n);
  return src.slice(s.r[0], s.r[1]).replace(/\bexport\s+function\s+/, 'function ');
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
out = out.replace(anchor, anchor + "\nimport { playOne, setRecorder, getRecorder } from './policy.mjs';");
out = out.replace('if (args.record !== null) { recorder = []; }', 'if (args.record !== null) { setRecorder([]); }');
// runCell  async 化；**它的两个调用方也必须 async**（干跑实证：只改 runCell 会在 881/948 产生
// `SyntaxError: Unexpected reserved word`，因为 runPositionSpread/runGateReserveScan 当时仍是同步函数）
out = out.replace('function runCell(', 'async function runCell(');
out = out.replace('function runPositionSpread(', 'async function runPositionSpread(');
out = out.replace('function runGateReserveScan(', 'async function runGateReserveScan(');
out = out.replace('results.push(playOne(theme, players, seed, gateReserve));', 'results.push(await playOne(theme, players, seed, gateReserve));');
out = out.replaceAll('runCell(theme, players, args.games, args.seedBase, args.gateReserve)', 'await runCell(theme, players, args.games, args.seedBase, args.gateReserve)');
out = out.replaceAll('runCell(theme, players, args.games, seedBase, reserve)', 'await runCell(theme, players, args.games, seedBase, reserve)');
// 这两个调用点在模块顶层（ESM 支持 top-level await），逐字替换即可
out = out.replace('  runPositionSpread(args);', '  await runPositionSpread(args);');
out = out.replace('  runGateReserveScan(args);', '  await runGateReserveScan(args);');
// recorder 残留（干跑实证：原计划漏了这两行 ⇒ 带 --record-decisions 时 ReferenceError，门② 必红）
out = out.replace('if (args.record !== null && recorder !== null) {\n  const lines = recorder.map((r) => JSON.stringify(r));',
  'const rec = getRecorder();\nif (args.record !== null && rec !== null) {\n  const lines = rec.map((r) => JSON.stringify(r));');
if (out.includes('recorder.map') || /&&\s*recorder\s*!==/.test(out)) { throw new Error('recorder 残留未清干净'); }
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

- [ ] **Step 4: 改 recorder 注释块的标题行（确切锚点）**

搬移后 `run.mjs` 第 44–59 行的 recorder 说明注释成了孤儿。**第 44 行是 `/**`，不是标题**；唯一可命中的标题是第 45 行。用 Edit 做精确替换：

old_string（逐字）：
```
 * ---------- 决策点记录器（B56）----------
```
new_string（逐字）：
```
 * ---------- 决策点记录器（B56；B70 起实体已搬入 tests/sim/policy.mjs）----------
 * ⚠️ B70：recorder/recordSeq/recordCtx/record 均在 policy.mjs；本文件只通过
 *   setRecorder([]) 装配、getRecorder() 读取。以下原说明保留作口径依据。
```

- [ ] **Step 4b: 清掉搬移后零使用的 import 绑定（干跑实测 22 个）**

存为 `docs/预研/data/tmp/prune-imports.mjs` 并运行：

```js
// docs/预研/data/tmp/prune-imports.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'tests/sim/run.mjs';
const src = readFileSync(P, 'utf8');
// 先把所有 import 语句整体剥掉，只在**剩余代码**里查引用，避免 import 之间互相「证明有用」
const body = src.replace(/import\s+[\s\S]*?from\s+'[^']+';\n?/g, '');
const re = /import\s+\{([^}]+)\}\s+from\s+'([^']+';)/g;
let out = src, m, removed = [];
while ((m = re.exec(src)) !== null) {
  const names = m[1].split(',').map((s) => s.trim()).filter((s) => s !== '');
  const kept = names.filter((n) => new RegExp(`\\b${n}\\b`).test(body));
  const dead = names.filter((n) => !kept.includes(n));
  removed.push(...dead);
  if (kept.length === 0) { out = out.replace(m[0] + '\n', '').replace(m[0], ''); }
  else if (dead.length > 0) { out = out.replace(m[0], `import { ${kept.join(', ')} } from '${m[2]}`); }
}
writeFileSync(P, out);
console.log(`移除 ${removed.length} 个零使用绑定：${removed.join(', ')}`);
```

Run: `node docs/预研/data/tmp/prune-imports.mjs && node --check tests/sim/run.mjs && grep -cE "^import" tests/sim/run.mjs`
Expected: 打印移除清单（数量应 >0；干跑基线为 22，实际以输出为准并记进批次记录）；`node --check` 静默；import 行数减少。
⚠️ 若 `node --check` 通过但运行时报 `X is not defined`，说明某个绑定被误删 ⇒ 用 `git diff tests/sim/run.mjs` 找回该 import，并在报告里记下误删原因（通常是该名字只出现在字符串或注释里）。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/engine/policy-extraction.test.ts`
Expected: 5/5 PASS

- [ ] **Step 6: 门 ⑨ 逐字等价 + 记录器路径可用（本任务的核心验收）**

```bash
mkdir -p docs/预研/data/tmp
node --check tests/sim/run.mjs && node --check tests/sim/policy.mjs && echo "两个文件语法 OK"
node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after-B70.md > docs/预研/data/tmp/sim-after-B70.log 2>&1
diff docs/balance-report.md docs/预研/data/tmp/balance-after-B70.md && echo "报告逐字一致"
node tests/sim/run.mjs --themes xianxia2026 --players 4 --games 2 --record-decisions docs/预研/data/tmp/rec-after-B70.jsonl --out docs/预研/data/tmp/rec-after-B70.md > docs/预研/data/tmp/rec-after-B70.log 2>&1
node --test tests/gates/sim-record.test.ts
```
Expected（四条全部成立）：① 打印「两个文件语法 OK」；② 打印「报告逐字一致」；③ 第三条命令退出码 0 且 `docs/预研/data/tmp/rec-after-B70.jsonl` 行数 >10（证明 `getRecorder()` 接线正确、无 ReferenceError）；④ `sim-record` 测试全绿。
失败定位顺序（按干跑实证的经验）：`SyntaxError: Unexpected reserved word` ⇒ `runPositionSpread`/`runGateReserveScan` 没加 `async`（`await` 落在同步函数里）；`recorder is not defined` ⇒ 落盘段那两行没改成 `getRecorder()`；`diff` 非空 ⇒ 先查 `runCell` 三处调用点（881/948/1084）是否都加了 `await`（漏一个会让 `cells` 里塞进 Promise 而不是结果），再查是否漏搬 helper。**不得**重生成 `docs/balance-report.md`。

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

**普通分支**：⚠️ **不得用 `continue`** —— 该分支尾部还有 `s = await advanceWithDuel(...)` 与 `firstPendingSeat` 统计，跳过会让模型臂少记「首个登顶者」传导数据。改用标志位把原决策块整体包起来。

确切边界（搬移前 `run.mjs` 行号，施工时以锚点字符串复核）：**待认证锁定分支 = 421–436**（434 推进、435 `continue`、436 右花括号）；**要包进 `if (!injected)` 的范围 = 437–474**（即从 `const roll = s.rng.next();` 到三段决策结束）；**475 的 `s = advanceWithDuel(s, 'standard', { gateReserve });` 与 476–480 的 `firstPendingSeat` 统计必须留在包裹之外**（481 是 while 收尾）。形状：
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

② **council 面**：`councilTurn` 现位于 `run.mjs:178–190`（搬移后在 `policy.mjs`，行号会变，**以锚点字符串定位**）。签名改为 `async function councilTurn(s, policy, counters, hit)`；注入点在循环头 `for (const p of alive) {` 内、锚点行 `const t = pickTarget(s, p.seat);` **之前**（该循环同层已有 `continue`，故 `continue` 合法）。插入：
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
`playOne` 内调用点（锚点 `if (needsCouncilVote(s)) { s = councilTurn(s); }`）改为 `if (needsCouncilVote(s)) { s = await councilTurn(s, policy, counters, hit); }`。

③ **certify 面**：`certificationTurn` 签名改为 `async function certificationTurn(s, policy, counters, hit)`。注入锚点 = 逐字唯一的那一行（现 `run.mjs:198`，`grep -c` 应为 1）：
```js
      const challenger = p.resource >= 2 && s.rng.next() < 0.2;
```
它所在循环头是 `    for (const p of s.players) {`（现 196 行，外层是 `for (const target of targets) {`）。在该锚点行**之前**插入：
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
`playOne` 内调用点（锚点 `if (needsCertificationAction(s)) { s = certificationTurn(s); }`）改为 `if (needsCertificationAction(s)) { s = await certificationTurn(s, policy, counters, hit); }`。
⚠️ **必须补 import**：`certifyAbstain` 已由 `engine/core/certification.ts:135` 导出，但原 `run.mjs:32–35` 的 certification import 列表**不含它** ⇒ 搬移后要在 `policy.mjs` 的该 import 列表里加上 `certifyAbstain`，否则运行时报 `certifyAbstain is not defined`（`node --check` 查不出来）。
⚠️ 改道命中时**不再消耗** `s.rng.next()` 的那次 0.2 判定 ⇒ 模型臂的随机流与基线臂从此分叉，这是策略注入的固有效应，**必须在批次记录里写明**，不得声称两臂随机流一致。
⚠️ 本面只改道「签印/质疑/弃权」三选；`certificationTurn` 后续的判定（`certifyAnswer`）、互签（`certifyMutualSign`）、复议申请与复议票**一律保持原逻辑不动**。

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

- [ ] **Step 4: 让 `buildChoice` 的指令面感知（必须保留 key 撞车抛错）**

现状 `tools/laya-probe/state-text.mjs:249–266`：循环里有 `if (Object.hasOwn(criteria, key)) { throw new Error(...) }`，**该抛错被 `tests/engine/legal-probe.test.ts:2154` 的常驻用例钉住**，替换体若删掉它必红。只改 `instructions` 的来源，其余逐字保留。把整个函数替换为：

```js
export function buildChoice(state, seat) {
  const actions = getLegalActions(state, seat);
  const criteria = {};
  for (const a of actions) {
    const key = actionKey(a);
    if (Object.hasOwn(criteria, key)) {
      throw new Error(`buildChoice：座${String(seat)} 的候选 key「${key}」撞车 ——`
        + '两条不同动作编出同一个 key，题面会静默少一个选项。'
        + '要修的是 id 唯一性（主题副本 id 带 #dupN 后缀即为此），不得在这里给 key 加后缀：'
        + 'key 必须能原样反解回动作。');
    }
    criteria[key] = describeAction(state, a, seat);
  }
  // B70：指令按候选所属面生成。对峙面必须写明比较规则并限定只能选亮牌，
  //   否则模型只看到牌名 ⇒ 按名字语义猜（实测：13/44 答到关隘面去了）。
  const onlyDuel = actions.length > 0 && actions.every((a) => a.type === 'DUEL_SUBMIT_CARD');
  const instructions = onlyDuel
    ? '对峙规则：红牌胜黑牌；同色则点数大者胜；同点平局各弃一张。亮牌不回手牌；败者退1格并抽1张。只能从下列自己的手牌里选一张锁定，选哪张？'
    : '现在轮到该玩家行动，应选哪个动作？';
  return {
    instructions,
    criteria,
    noLegalActions: Object.keys(criteria).length === 0,
  };
}
```

Run: `node --test tests/engine/legal-probe.test.ts 2>&1 | tail -6`
Expected: key 撞车那条常驻用例仍绿；新增的 3 条 B70 用例里「描述含颜色点数」与「面感知」两条转绿，词表那条仍红（Step 5 处理）。

- [ ] **Step 5: 同步封闭词表（确切清单，已实算；不得放宽词表）**

词表校验扫描**四路字符串**：`describeState` 输出、`buildChoice().instructions`、criteria 的 **key 与 value**（`tests/engine/legal-probe.test.ts:1563–1567` 的 `scannedText`）。分词规则 = `TOKEN_RUN`（1385 行，id 字符 ∪ CJK），数字按 `generalize`（1395–1396）换成哨兵 `NUM = '\u0000'`。

新题面引入的 token 已用一次性脚本实算（`docs/预研/data/tmp/b70-vocab-probe.mjs`，输出同名 `.log`），**缺失恰好 10 条**，照下面补：

① `TEMPLATE_WORDS`（1463–1498）末尾、在 `'plain', 'boon', 'hazard', 'rift', 'junction', 'peak',` 那一行**之后**、闭合 `];` 之前插入：
```ts
  // B70：对峙题面补颜色/点数/规则后引入的公开措辞（逐条实算得出，不得整类放行）
  '对峙亮牌', '对峙规则', '红牌胜黑牌', '同色则点数大者胜', '同点平局各弃一张',
  '亮牌不回手牌', '只能从下列自己的手牌里选一张锁定', '选哪张',
```
② `TEMPLATE_SKELETONS`（1501–1508）末尾、在 `` `座${NUM}推翻`, `座${NUM}维持`, `判定座${NUM}通过`, `判定座${NUM}不通过`, `` 那一行**之后**、闭合 `];` 之前插入：
```ts
  // B70：对峙描述与规则里的「中文夹数字」形状
  `点数${NUM}`, `败者退${NUM}格并抽${NUM}张`,
```
③ **不需要补**的：牌名（如 `御风`/`缩地`）由 `vocabularyFor` 的 `themeDataWords` 从主题包派生覆盖；`红`/`黑` 已在既有词表里。

Run: `node --test tests/engine/legal-probe.test.ts 2>&1 | tail -6`
Expected: 全绿（含既有的粘连泄漏、解构/括号访问、key 撞车、40 字符预算四类守卫）。
若仍报「词表外的 token」：把该 token 原样记进报告，**先判断它是否属于公开集**——是则按上面同样方式逐条补；不是则说明题面泄漏了禁止集，必须改题面而不是补词表。**禁止**删除断言、禁止把整类 token 放行、禁止改 `TOKEN_RUN`。

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

`package.json` 现状：`scripts` 共 20 键、**无** `eval:faces`、**无 `dependencies` 键**，末键在第 27 行且**无尾逗号**。用 Edit 精确替换：

old_string（逐字）：
```
    "probe:laya:skip": "node tools/laya-probe/skip.mjs"
```
new_string（逐字）：
```
    "probe:laya:skip": "node tools/laya-probe/skip.mjs",
    "eval:faces": "node tools/laya-probe/game-arms.mjs"
```

Run: `node --check tools/laya-probe/game-arms.mjs && node --check tools/laya-probe/face-stats.mjs && node -e "const p=require('./package.json');if(p.dependencies)throw new Error('不得新增 dependencies');console.log('eval:faces =',p.scripts['eval:faces'])" && npm run eval:faces; echo "exit=$?"`
Expected: 两个 `--check` 静默；打印 `eval:faces = node tools/laya-probe/game-arms.mjs`；**服务未起时**输出 `SKIP {"reason":"no-sidecar",...}` 且 `exit=0`。

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

- [ ] **Step 1: 起服务、跑评估、停服务（三段都要留证）**

```bash
# ① 后台起两层服务（日志落 gitignore 的 tmp）
node tools/laya-sidecar/up.mjs --weights "D:/<local-libs>/laya-multilingual/model.safetensors" > docs/预研/data/tmp/up-b70.log 2>&1 &
# ② 等就绪（最多 180s；就绪标志是日志里出现 READY）
for i in $(seq 1 60); do grep -q "READY" docs/预研/data/tmp/up-b70.log && break; sleep 3; done
grep -E "device=|READY|Traceback" docs/预研/data/tmp/up-b70.log | head -3
# ③ 跑三面评估
npm run eval:faces 2>&1 | tee docs/预研/data/tmp/eval-b70.log
```
Expected：② 打印 `device=cuda`（或 `cpu`）与 `[up] READY …`，**不得出现 `Traceback`**；③ 三面各打印一行 `[face] 400 局/臂｜座0 …｜b=… c=… χ²=…｜<判定>｜… 分钟`，并生成 `docs/预研/data/b70-face-arms.json` 与 `docs/预研/2026-11-09-b70-face-evaluation.md`；三面 `anomalies` 均为 **0**。

跑完**必须停服务并验证端口释放**（`up.mjs` 是前台设计，后台起的那份要显式结束）：
```bash
pkill -f "tools/laya-sidecar/up.mjs" ; pkill -f "tools/laya-sidecar/launch.py" ; pkill -f "tools/laya-sidecar/serve.mjs"
for p in 8711 8712; do curl -s -o /dev/null -w "$p → %{http_code}\n" --max-time 2 http://127.0.0.1:$p/health; done
```
Expected: 两行都是 `8711 → 000` 与 `8712 → 000`（无响应）。若仍是 200/503 ⇒ 有残留进程，必须查到并结束，**不得**留着无人看管的常驻服务（B54 教训）。

- [ ] **Step 2: 核对判据未被下调**

Run: `node -e "const r=require('./docs/预研/data/b70-face-arms.json').results; for(const x of r){if(x.gamesPerArm<400)throw new Error(x.face+' 局数不足');} console.log('三面均 ≥400 局/臂')"`
Expected: 打印「三面均 ≥400 局/臂」。若某面因 30 分钟预算中断 ⇒ 如实登记「未跑满」，**不得**把判定写成达标。

- [ ] **Step 3: 补报告的结论段（逐项必填，不得留空）**

脚本已生成读数表；你要在 `docs/预研/2026-11-09-b70-face-evaluation.md` 末尾追加「结论」小节，**每面一段**，每段必须含下列 8 项（全部取自 `docs/预研/data/b70-face-arms.json`，不得手填估计值）：
1. 判定原文（只能是 `verdictOf` 的三种固定措辞之一）；2. `b` / `c` / `χ²` 与临界 3.841 的比较；3. 座0 胜率基线→模型（百分比，一位小数）；4. 胜者变化率 `changedRate`；5. 模型调用数 `modelCalls` 与延迟 `latencyMs.p50/p95`；6. 回落数 `injection.fallbacks` 与空候选数 `injection.emptyCandidates`；7. 兜底局数与平均回合（基线→模型）；8. `anomalies`（必须 0）。

追加两条固定声明：① 「本批**只评估不接入**：`policy` 缺省 undefined、sim CLI 无新开关、门 ⑨ 基线未动」；② 随机流口径注记（模型臂改道命中时不消耗那次 `s.rng.next()` ⇒ 两臂自首个分歧起分叉；配对比较仍成立，因为同 seed 起点相同）。
若某面判为「值得接入」，必须写明**下一步是另立批次做门 ⑨ 重校准**，本批不接入。若某面因 30 分钟预算中断，如实写「未跑满 N 局/臂」，**不得**写成达标。

- [ ] **Step 4: 口径同步**

主规格 §7 追加一段：`tests/sim/policy.mjs` 是决策层单一真相源；`playOne` 的第 5 参 `FacePolicy` 默认关闭；评估器 `tools/laya-probe/game-arms.mjs` 不进门禁；对峙选牌保持贪心（引 B70 实测依据）。`README.md` 登记 B70 结论与「模型未接入生产」。

- [ ] **Step 5: 写批次记录（七节，逐节必填）**

新建 `docs/批次/B70-决策面评估与题面修正-执行记录.md`，节名与必填内容照此（体例对齐 `docs/批次/B68-对峙选牌接线-执行记录.md`）：
1. **目标**：修两处缺陷 + 建三面评估器；引 spec 路径与本计划路径。
2. **裁定**：逐条记本批作出的决定（对峙保持贪心的实测依据、`policy` 默认关闭、只评估不接入、词表只补 10 条不放宽）。
3. **实现**：搬移的 9 个函数与 recorder、删除的 2 个死函数、async 化的 3 个函数与 5 个 await 点、三个注入点、题面与词表改动、归一化函数。
4. **验收**：贴 ① 门 ⑨ `diff` 为空的命令与输出；② `node tools/gate.mjs` 尾行 `== PASS：13 门全绿 ==`；③ 各任务新增测试的通过计数；④ `--record-decisions` 路径可用的证据（jsonl 行数）；⑤ 端口释放验证的两行 `000`。
5. **复盘与经验沉淀**：必须记「干跑证伪的四条假设」（见本计划「事实来源与干跑证据」）；并**必须**往 `docs/沉淀/经验教训索引.md` 追加一条编号条目（编号 = 现有最大 E 编号 + 1，先 `grep -oE "E[0-9]+" docs/沉淀/经验教训索引.md | sort -t E -k2 -n | tail -1` 查出），内容为「跨文件搬移函数时必须连注释一起搬、async 化要顺着调用链一路改到顶、搬移后必须清残留引用与零使用 import」，并引本批干跑证据。
6. **遗留**：如实登记未做项（模型未接入生产、得分公式未动、G-a…G-h 中本批未触及的条目）。
7. **提交**：逐条列本批提交 SHA 与主题；**本记录自身的收官哈希写 `<hash>` 待回填**，并按既定口径注明「回填并入下一批首个提交，不单独开提交」。

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
