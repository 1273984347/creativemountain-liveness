# B69 · 对峙 key 反解缺口（`duel:card:<id>`）+ ActionType 全成员往返守卫

> 批次号 B69 · 日期 2026-11-09 · 主题：B68 把「对峙选牌」接到了**编码侧与枚举层**，却漏了**反解侧**与该类型的**往返测试** ⇒ 模型每输出一次 `duel:card:<id>`，探针就记一次「反解失败」。本批补反解分支 + 加**根因守卫**（枚举成员 ↔ 往返样本一对一）。
> 授权原文（用户批准的方案）：「补反解分支 + 加根因守卫」，严格 TDD（先红后绿），bounded 修复。
> 前置：B68（`3aefff0`）已提交，收官哈希已由 `a5c7127` 回填 ⇒ 本批**不含**上批哈希回填。

## 1. 目标与范围

- **做**：① `engine/core/action-key.ts` 的 `decodeKey` 补 `duel` 分支（`duel:card:<cardId>` → `{ type:'DUEL_SUBMIT_CARD', actor:-1, cardId }`）；② `tests/engine/action-key.test.ts` 补该类型的往返样本 + key 唯一性 + 四条 bad-key；③ 加**常驻根因守卫**：`ActionType` 的每个成员都必须在 SAMPLES 里有往返样本（成员真值从 `engine/core/action.ts` **源码文本解析**，不手抄清单）；④ 守卫做**变异自证**（删样本 ⇒ 红，还原 ⇒ 绿）。
- **不做**：不改 `engine/core/action.ts`、`legal.ts`、`probe.ts`、`web/**`、`tests/sim/run.mjs`、`tools/**`；不动 sim 与引擎行为（门 ⑨ 基线不变）；**不重跑探针**（控制器负责复测）。
- **归因（一句话）**：B68 补了**编码侧**（`actionKey` 的 `DUEL_SUBMIT_CARD` 分支）与**枚举层**，漏了**反解侧**（`decodeKey` 无 `duel` 头段）与**该类型的往返测试**（SAMPLES 里没有它）⇒ 缺陷一路放行到 CPU 探针。
- **性质**：与 B67/B68 同族的「**中间层漏接**」，但这次漏在**可逆编码的下半程**——上游 tsc 逼不出（见 §3 裁定 1）。

## 2. 取证：缺陷直接复现 + 探针原始证据

### 2.1 端到端复现（修复前，RED）

```bash
node --input-type=module -e "
import { actionFromKey, actionKey } from './engine/core/action-key.ts';
const key = 'duel:card:c_windstep';
const a = actionFromKey(key);
console.log('actionFromKey =>', JSON.stringify(a), '| roundtrip ===', actionKey(a) === key);
"
```

实际输出（node exit=1）：

```
engine/core/action-key.ts:136
    default: throw new Error(`未知动作 key：${key}`);
                   ^
Error: 未知动作 key：duel:card:c_windstep
    at decodeKey (engine/core/action-key.ts:136:20)
    at actionFromKey (engine/core/action-key.ts:47:18)
```

### 2.2 探针原始证据（只读复核，未重跑）

证据文件：`docs/预研/data/tmp/probe-cpu-raw.json`（gitignore 内）。逐条统计 `results`：

| 量 | 实测值 |
| --- | --- |
| 样本总数 | 232 |
| `answered` | 221 ⇒ `answerRate = 0.9526`（判据 ≥0.99 ⇒ 红） |
| `err` 非空 | **11** |
| 其中 `未知动作 key：duel:card:*` | **7**（seq 3/4/6/7/12/14/15） |
| 其中 `未知认证动作：cert:mutual:*` | **4**（seq 46/47/55/56） |

⚠️ **关键发现（修正任务书归因）**：11 条反解失败**不是全部来自对峙**——其中 4 条是 **B67 的 `CERTIFY_MUTUAL_SIGN` 同款缺口**（`cert:mutual:<target>` 也没有反解分支）。
⇒ 若只补 `duel`：`answered` 只能到 228/232 = **0.9828**，**仍低于 0.99 判据**。两条都补才可能回到 1.0。这不是顺手扩权，而是**判据要求的必要范围**（详见 §3 裁定 2）。

## 3. 关键裁定（5 项）

| # | 争议点 | 裁定 | 理由 |
| --- | --- | --- | --- |
| 1 | 为什么 tsc 没逼出这个分支？ | `decodeKey` 的 switch 判别式是**字符串头段** `head`，不是 `Action['type']` ⇒ **穷尽检查管不到** | `actionKey(a)` 那侧判别式是 `a.type`，新增成员必被 tsc 逼出分支（B67/B68 记录里写的「三处穷尽 switch 由 tsc 逼出」**只覆盖编码侧**）⇒ 反解侧的唯一报警源只能是**测试守卫**，故本批把守卫做成常驻 |
| 2 | 要不要连带补 `cert:mutual` 反解？ | **补**（同一文件、同一缺口族） | ①根因守卫要求「每个 ActionType 成员都有**能往返**的样本」⇒ 不补它守卫必红；②探针 11 条失败里有 4 条是它 ⇒ 只补 duel 达不到 ≥0.99；③改动仍严格落在授权的两个文件内，未碰引擎/枚举/sim |
| 3 | 守卫的成员真值从哪来？ | 从 `engine/core/action.ts` **源码文本解析**（`/export type ActionType =([\s\S]*?);/` + `/'([A-Z_]+)'/g`），与 `tests/engine/action-contract.test.ts`、门 ③ 的 `unionMembers` **同法** | 手抄清单会随枚举增补而漂 ⇒ 守卫自己先失效（那正是本次漏检的形状）。另加 `members.length > 0` 断言：解析式失效时必须红，不得静默变成「零成员 ⇒ 恒绿」 |
| 4 | SAMPLES 从 17 条变 21 条，算不算放宽断言？ | **不算**：钉死值同步 17 → 21，且**只增不减** | 原钉死值的用意是「样本被误删 ⇒ 唯一性断言不得空转」；本批补齐 4 个历史无样本成员（`GATE_RESOLVE`/`BARRIER_RESOLVE`/`CERTIFY_MUTUAL_SIGN`/`DUEL_SUBMIT_CARD`）⇒ 覆盖面变大，钉死值随之上调，语义不变 |
| 5 | 要不要顺手补 `GATE_RESOLVE`/`BARRIER_RESOLVE` 的反解？ | **不需要**：它们的反解早在（B18/B18-b 实测可往返），缺的只是**样本** | 守卫照出的是「四个成员无样本」，其中两个是**纯测试欠账**、两个是**真缺口**⇒ 分开处置，不做无谓改动 |

## 4. 实现（两处分支 + 一处根因注释 + 四项测试）

| 位置 | 改动 | 纪律 |
| --- | --- | --- |
| `engine/core/action-key.ts` · `decodeKey` | 新增 `case 'duel'`：`kind = need(parts[1])`，`kind !== 'card'` ⇒ 抛 `未知对峙动作`；`cardId = need(parts[2])` | 与 `cert` 同款：缺段（`duel:card`）/ 空 id（`duel:card:`）/ kind 拼错（`duel:bogus:x`）一律抛；多余尾段（`duel:card:a:b`）由 `actionFromKey` 既有**单射校验**（重编码逐字相等）拒掉 ⇒ **未新增宽松路径** |
| 同上 · `cert` 内层 switch | 新增 `case 'mutual'` → `{ type:'CERTIFY_MUTUAL_SIGN', actor:-1, target }` | `target` 仍走既有 `num(parts[2])`（空段/非整数必抛）⇒ 严格度与 `cert:sign` 完全一致 |
| 同上 · `decodeKey` 函数头 | 加根因注释：本 switch 判别式是字符串头段 ⇒ tsc 管不到 ⇒ 唯一报警源是常驻守卫，**不得删、不得改成手抄清单** | 把「为什么会漏」写在漏点上，而不是只写在批次记录里 |
| `tests/engine/action-key.test.ts` · SAMPLES | 补 4 条（含 `DUEL_SUBMIT_CARD { actor:0, cardId:'c_windstep' }`）；钉死值 17 → 21 | 往返 + key 唯一性两条既有断言自动覆盖新样本 |
| 同上 · bad-key 列表 | 补 `duel:card:`、`duel:card`、`duel:bogus:x`、`duel:card:a:b`（任务书要求的四条）+ `cert:mutual:`、`cert:mutual:0:junk` | 全部必须抛错，且沿用既有 `/key|动作/` 匹配（**未放宽**） |
| 同上 · CANONICAL 正例 | 补 `gate:resolve:trial`、`barrier:resolve:skip`、`cert:mutual:0`、`duel:card:c_windstep` | 收紧不得误伤规范形：正例钉住三段文法与 `actor:-1` 形状 |
| 同上 · **新增常驻守卫** | 「ActionType 每个成员都在 SAMPLES 里有往返样本」：解析源码 → `missing` 必为 `[]` → 再逐成员做 `withActor(actionFromKey(actionKey(a)), a.actor)` 深比较 | 两层：①**有没有样本**（漏测即红）②**样本能不能往返**（漏反解即红） |

## 5. 验收（TDD 先红后绿 + 四条命令 + 变异取证）

### 5.1 RED（只写测试、未写实现时）

```bash
node --test tests/engine/action-key.test.ts     # node exit=1
```

```
✖ key 往返：withActor(decode(encode(a)), a.actor) 与 a 等价
✔ key 唯一：SAMPLES 互不相同 ⇒ key 集合大小相等（actor 不入 key）
✖ play 两式互异 + key 自洽：需选目标的牌打不同座位不得塌成同一 key
✔ 未知 key 必须抛错，绝不猜
✖ 规范形正例：0 号座位与各文法正形仍是合法 key（收紧不得误伤规范形）
✖ 根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红）
ℹ tests 6 / pass 2 / fail 4
  Error: 未知认证动作：cert:mutual:0        ← 四条失败都停在这个成员（枚举序在 duel 之前）
```

针对本批主缺陷的**定点 RED**（同一断言形状，只跑 duel 样本）：

```bash
node --input-type=module -e "
import assert from 'node:assert/strict';
import { actionKey, actionFromKey, withActor } from './engine/core/action-key.ts';
const a = { type: 'DUEL_SUBMIT_CARD', actor: 0, cardId: 'c_windstep' };
assert.deepEqual(withActor(actionFromKey(actionKey(a)), a.actor), a, '往返失败：' + actionKey(a));
"                                                # node exit=1
# Error: 未知动作 key：duel:card:c_windstep
```

> 说明：bad-key 那一条在 RED 阶段就是绿的——因为**未接线时走 `default` 也抛错**。它的价值在 GREEN 之后：证明新分支**没有把严格规范形放宽**（空段/缺段/多余段仍抛）。

### 5.2 GREEN（补两条反解分支后）· 端到端直接证明

```bash
node --input-type=module -e "
import { actionFromKey, actionKey } from './engine/core/action-key.ts';
const key = 'duel:card:c_windstep';
const a = actionFromKey(key);
console.log('actionFromKey =>', JSON.stringify(a));
console.log('type ===', a.type === 'DUEL_SUBMIT_CARD', '| actor ===', a.actor);
console.log('actionKey(decode) =>', actionKey(a), '| 逐字相等 ===', actionKey(a) === key);
"
```

实际输出（node exit=0）：

```
actionFromKey => {"type":"DUEL_SUBMIT_CARD","actor":-1,"cardId":"c_windstep"}
type === true | actor === -1
actionKey(decode) => duel:card:c_windstep | 逐字相等 === true
cert:mutual:0 => {"type":"CERTIFY_MUTUAL_SIGN","actor":-1,"target":0} | 逐字相等 === true
```

### 5.3 四条验收命令（最终状态实跑，尾部输出原样）

**① `node --test tests/engine/action-key.test.ts`**

```
✔ key 往返：withActor(decode(encode(a)), a.actor) 与 a 等价 (1.293ms)
✔ key 唯一：SAMPLES 互不相同 ⇒ key 集合大小相等（actor 不入 key） (0.1318ms)
✔ play 两式互异 + key 自洽：需选目标的牌打不同座位不得塌成同一 key (0.2387ms)
✔ 未知 key 必须抛错，绝不猜 (1.2293ms)
✔ 规范形正例：0 号座位与各文法正形仍是合法 key（收紧不得误伤规范形） (0.2566ms)
✔ 根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红） (0.5991ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 122.7634
```

**② `npm run typecheck`**（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals` 全开）

```
> creativemountain-liveness@0.1.0 typecheck
> tsc --noEmit

（静默通过，exit=0）
```

**③ `npm test`**

```
✔ 工具自检：deepEqual 与键序无关 (0.2791ms)
ℹ tests 558
ℹ suites 0
ℹ pass 557
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 22006.0465
```

> 基线对照（改动前实跑）：`tests 557 / pass 556 / fail 0 / todo 1` ⇒ 本批**净增 1 项**（根因守卫），**0 fail**，既存 1 项 todo 属正常。

**④ `node tools/gate.mjs 2>&1 | tail -20`**

```
== 创界山·活人认证 一键门卫 ==
[门1] ✓ 语法与类型（tsc --noEmit） (1.6s)
[门2] ✓ 单元与门禁自检（node --test） (22.2s)
[门3] ✓ 文档口径（doc-sync） (0.1s)
[门4] ✓ 单文件构建（esbuild） (0.1s)
[门5] ✓ 主题包校验（theme-validate） (0.1s)
[门6] ✓ IR 契约校验（ir-validate） (0.1s)
[门7] ✓ 双轨一致性（parity-check） (0.3s)
[门8] ✓ 主题差异化核对（theme-diff-check，规格 §10.1） (0.1s)
[门9] ✓ 规模与平衡冒烟（tests/sim/run.mjs --check） (0.7s)
[门10] ✓ 对峙浏览器端到端（tests/e2e/duel-e2e.mjs） (1.6s)
[门11] ✓ 关隘试炼通过率专项平衡（tests/sim/run.mjs --trial-rate --check） (0.7s)
[门12] ✓ 位次胜率极差回归锁（tests/sim/run.mjs --position-spread --check） (1.5s)
[门13] ✓ 余量判定离线回归（docs/沉淀/verify-trial-reserve-critical.mjs） (0.1s)

== PASS：13 门全绿 ==
```

> 门 ⑨（sim 逐字等价基线）**未变**：本批只动 `decodeKey`（反解），而 sim 与门 ⑨ 只消费 `actionKey`（编码）；`actionFromKey` 在生产侧的唯一消费点是 `tools/laya-probe/run.mjs:188`（探针，未改）。

### 5.4 变异取证：守卫**可失败**（删样本 ⇒ 红，还原 ⇒ 绿）

用 `--test-name-pattern` 隔离守卫，避免「样本数钉死」那条先红而掩盖守卫自己的判据。

**变异 A**：从 SAMPLES 删掉 `{ type: 'DUEL_SUBMIT_CARD', actor: 0, cardId: 'c_windstep' }`

```bash
node --test --test-name-pattern="根因守卫" tests/engine/action-key.test.ts   # node exit=1
```

```
✖ 根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红） (2.0067ms)
ℹ tests 1 / pass 0 / fail 1
  AssertionError [ERR_ASSERTION]: ActionType 有成员没有往返样本：DUEL_SUBMIT_CARD ⇒ 编码/反解任一侧漏接线都无人报警（B69 根因）
    actual: [ 'DUEL_SUBMIT_CARD' ],
    expected: [],
    operator: 'deepStrictEqual',
```

**变异 B**（证明守卫不是 duel 专属）：在 A 的基础上再删 `CERTIFY_MUTUAL_SIGN` 样本

```bash
node --test --test-name-pattern="根因守卫" tests/engine/action-key.test.ts   # node exit=1
```

```
✖ 根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红） (2.1496ms)
ℹ tests 1 / pass 0 / fail 1
  AssertionError [ERR_ASSERTION]: ActionType 有成员没有往返样本：CERTIFY_MUTUAL_SIGN, DUEL_SUBMIT_CARD ⇒ 编码/反解任一侧漏接线都无人报警（B69 根因）
    actual: [ 'CERTIFY_MUTUAL_SIGN', 'DUEL_SUBMIT_CARD' ],
    expected: [],
```

**还原**（两条样本写回）

```bash
node --test --test-name-pattern="根因守卫" tests/engine/action-key.test.ts   # node exit=0
```

```
✔ 根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红） (1.8366ms)
ℹ tests 1 / pass 1 / fail 0
```

还原后全文件复跑：`tests 6 / pass 6 / fail 0`；`git diff --stat` 只剩预期的两文件（`69 insertions(+), 3 deletions(-)`）⇒ 变异残留为零。

## 6. 遗留（如实登记，不靠绿灯掩盖）

| # | 现象 | 归属 |
| --- | --- | --- |
| T1 | **本批未重跑探针**（授权明确：探针复测由控制器做）⇒ `P1.answerRate` 是否回到 1.0 **尚无本批实测** | 控制器负责。预期：11 条反解失败（7 duel + 4 mutual）全部消除 ⇒ 232/232；若仍有非反解类失败，属另一议题 |
| T2 | **CPU 延迟读数 p50=340ms / p95=452ms（n=221）** 已由控制器测得（本批从 `probe-cpu-raw.json` 只读复核一致），**待写入预研报告** | 本批不改 `docs/预研/**`（不在授权 pathspec 内）⇒ 如实登记为待办 |
| T3 | 任务书称 `ActionType` 现有 **14** 个成员，实测源码为 **17** 个（`action-contract.test.ts` 的契约表也是 17 项） | 口径差异已按**源码真值**处置：守卫从源码解析 ⇒ 成员数变化不影响守卫正确性，无需人工对齐 |
| T4 | `GATE_RESOLVE`/`BARRIER_RESOLVE` 的样本各只有**一个通道**（`pay` / `place`），另一通道（`trial`/`skip`）只在 CANONICAL 正例里钉了反解 | 守卫的判据是「每个**成员**有往返样本」，已满足；通道级双取值覆盖属可选加强，未做（bounded） |
| T5 | 自由文本段（`cardId`）仍只校验**非空**，不做空白/字符集规范化（`duel:card: ` 这类含空格 id 会被接受） | 与既有 `play`/`ability` 的 `need()` 纪律**完全一致**，本批未放宽也未收紧；若要收紧须全族同改，属独立议题 |
| T6 | B65/B66/B67/B68 一路登记的**位次偏差**与 **AI 对峙选牌仍走 `autoResolveDuel`** 两项 | 本批未触及（与 key 反解无关），沿用前批登记 |

## 7. 复盘与经验沉淀

- **「编码侧被 tsc 逼出分支」不等于「可逆编码齐备」**：判别式是字符串的 switch 天然不受穷尽检查保护 ⇒ 凡是「A→B 由编译器守、B→A 由人手写」的成对函数，必须有一条**从类型真值出发**的往返守卫，否则漏的是下半程。
- **根因守卫的真值必须来自源码，不能手抄**：手抄清单与被守护对象一起漂 ⇒ 守卫变成装饰。本批守卫与 `action-contract.test.ts`、门 ③ 同法解析，并加「解析结果非空」断言防止静默空转。
- **守卫上线的第一刻就照出了第二个真缺口**（B67 的 `cert:mutual`）与两个纯测试欠账（关隘/裂隙通道）⇒ 证明它不是为本次缺陷定制的装饰；也说明**只修被报告的那一个成员**会让判据继续红（0.9828 < 0.99）。
- **变异取证要隔离目标断言**：样本数钉死那条会先红，若只看「测试红了」就无法证明**守卫本身**可失败 ⇒ 用 `--test-name-pattern` 单跑守卫，判据落在守卫专属措辞（`没有往返样本：<成员>`）上。

## 8. 提交

- 提交（施工 + 测试 + 本记录）：`<hash>` fix(B69): 补 DUEL_SUBMIT_CARD 反解分支 + ActionType 全成员往返守卫
  - ⚠️ **本行哈希待回填**（提交时无法预知自己的哈希）。按既定口径：**回填并入下一批首个提交，不单独开提交**。
  - 显式 pathspec（只 stage 这三条，未用 `git add -A`/`.`）：`engine/core/action-key.ts`、`tests/engine/action-key.test.ts`、`docs/批次/B69-对峙key反解缺口-执行记录.md`。
  - 未改动：`engine/core/action.ts`、`engine/core/legal.ts`、`engine/core/probe.ts`、`web/**`、`tests/sim/run.mjs`、`tools/**`、`.superpowers/sdd/**`、共享任务清单。