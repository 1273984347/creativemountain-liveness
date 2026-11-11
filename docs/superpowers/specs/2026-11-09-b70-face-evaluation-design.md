# B70 · 决策面模型评估器 + 两处已坐实缺陷修正 · 设计

> 日期：2026-11-09｜路径裁定：架构级（新建可复跑评估子系统 + 重构 sim 决策层为可注入策略）
> 状态：待用户复核
> 上游：`docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`（sidecar 预研）、`docs/预研/2026-11-08-laya-sidecar.md`（P0–P6 读数）
> 立项证据：本文件 §1（两次 spike 的实测数据，原始 JSON 在 `docs/预研/data/tmp/`，gitignore 内）

## 1. 立项证据（为什么不做「让模型驱动对峙选牌」）

### 1.1 头对头 spike（44 场独立对峙，取自仓内 3320 个决策点中的 88 个对峙行）

| 指标 | 臂1：现行题面 | 臂2：富题面（补颜色/点数/规则 + 候选限定为对峙牌） |
|---|---|---|
| 模型选牌落在自己手牌内 | A 侧 **13/44 答的是关隘动作**（`gate:…`） | **88/88 全部合法** |
| 与启发式分歧率 | 86.4% | 80.7%（A 38/44、B 33/44） |
| 选中自己最强牌 | — | 模型 **A 6/44、B 11/44**；启发式 **44/44、44/44** |
| 单场胜负（换模型一侧） | A 4 胜 27 负 / B 1 胜 41 负 | A 9 胜 35 负 / B 5 胜 39 负（基线 A 27 胜 15 负 2 平） |
| 延迟 | p50 65ms / p95 73ms | p50 64ms / p95 71ms |

### 1.2 整局驱动 spike（480 局 = 3 臂 × 160；4 主题 × 40 seed × 4 人；0 异常）

驱动由 `tests/sim/run.mjs` 的 helper 与 `playOne` **原样抽取**生成，只替换 `advanceWithDuel` 的对峙选牌 ⇒ 两臂只差一个变量。

| 臂 | 座0 胜率 | 无人取席兜底局 | 平均回合 | 模型调用 | 合法率 | 延迟 p50/p95 |
|---|---|---|---|---|---|---|
| 全贪心（基线） | **32.5%**（52/160） | 12 | 13.0 | 0 | — | — |
| 只有座0 用模型 | 26.9%（43/160） | **21** | 13.0 | 91 | **100%** | 59 / 69ms |
| 双方都用模型 | **26.3%**（42/160） | 13 | 13.0 | 264 | **100%** | 54 / 61ms |

配对 McNemar（连续性校正，χ² 临界 3.841）：只有座0 用模型 b=17/c=8、**χ²=2.560 ⇒ 不显著**；双方都用模型 b=14/c=4、**χ²=4.500 ⇒ p<0.05 显著变差**。胜者变化率 20.6% / 22.5%。

### 1.3 结论

1. **工程可行性成立**：264 次调用零非法、p50 54ms、0 异常。
2. **对峙选牌不该交给模型**：贪心在该子博弈是近视最优（44/44 出最强牌），且整局胜率也更高；「模型可能在做卡牌取舍」的假设被整局数据否掉（兜底局反而从 12 升到 21）。
3. **两处缺陷与模型能力无关、必须修**：题面缺颜色/点数/规则且未限定决策面；记录器 key 格式与 codec 不一致。
4. ⇒ B70 的目标改为：**修这两处缺陷 + 把模型评估转向有取舍的决策面**（出牌目标 / 山议投票 / 认证），对峙保持贪心。

## 2. 目标与非目标

**做**：① 把 sim 的决策层抽成可复用模块并支持**默认关闭**的策略注入；② 建入库可复跑的三面评估器；③ 修题面与 key 格式两处缺陷；④ 出三面读数与判定。

**不做**：把模型接入生产或 sim 默认路径；改变得分公式/席位权重；关隘与复议裁定的流程层接线；微调模型；新增门禁道次；发布包任何增量。

## 3. 架构与组件

| 组件 | 职责 | 硬约束 |
|---|---|---|
| `tests/sim/policy.mjs`（新） | 承载从 `run.mjs` **原样搬出**的 9 个函数：`checkState`/`pickTarget`/`councilTurn`/`certificationTurn`/`maybeUseAbility`/`pickPlayableCard`/`playOne`/`advanceWithDuel`/`record`，连同 `recorder`/`recordSeq`/`recordCtx` 三个模块级变量与一个 `setRecorder()` 导出；新增可选 `policy` 参数 | `policy` 缺省 ⇒ 行为**逐字不变**；`playOne` 改 `async`；注入失败一律回落启发式，**绝不卡死回合**。⚠️ **B72 更新**：锁定分支的启发式过滤由 `type !== 'motion'` 改为 `cardHasMovement`（B71 遗留的两臂差异；旧过滤会挑中引擎必拒的位移牌）⇒ 默认路径**不再**逐字等价，`docs/balance-report.md` 已按 B72 重标定（见 B72 批次记录） |
| `tests/sim/run.mjs`（改） | 只保留 CLI 解析、跑批（`runCell`/`summarize`）、报告生成与门⑨/⑪/⑫ 的断言；从 `policy.mjs` import 上述函数，`await playOne`，用 `setRecorder()` 装记录器。**`runCell` 随之 async 化，其三处调用点全部加 `await`** | **CLI 不新增开关**；门 ⑨/⑪/⑫ 的命令与默认路径不变。已核实**没有任何外部模块 import `run.mjs`** ⇒ 搬移其导出是安全的 |
| `tools/laya-probe/game-arms.mjs`（新） | 三面各跑两臂、同 seed 配对、算 McNemar 与附带读数、落 raw JSON + md | 不进 `tools/gate.mjs`；无服务即 `SKIP` 且退出码 0；不引入第三方 npm 依赖 |
| `tools/laya-probe/state-text.mjs`（改） | `DUEL_SUBMIT_CARD` 描述补颜色/点数；`buildChoice` 指令**按候选所属决策面**生成 | 同步封闭词表与 40 字符预算测试；白名单结构性不得破（禁止集仍不得出现字段访问） |
| `tools/laya-probe/run.mjs`（改） | P6 比较时归一化历史样本的 `duel_card:` → `duel:card:` | 新旧样本都能比；归一化本身有测试 |

**单一真相源纪律**：评估器与生产 sim 共用 `policy.mjs` 的同一套决策逻辑，**不得**复制第二份回合机（B11 的 E9 教训：扫描副本曾与生产差 9pp）。

**为什么连 `advanceWithDuel`/`record`/recorder 一起搬**：`playOne` 调用 `advanceWithDuel`，而 `advanceWithDuel` 调用 `record`。若只搬 `playOne`，`policy.mjs` 就要反向 import `run.mjs`，而 `run.mjs` 又 import `policy.mjs` ⇒ **循环依赖**，且 `run.mjs` 的模块级主流程会在 import 时被执行（跑一整轮模拟）。把这三者与 recorder 状态一并搬入 `policy.mjs`、由 `run.mjs` 通过 `setRecorder()` 装配，依赖方向才是单向的：`run.mjs → policy.mjs → engine/*`，`game-arms.mjs → policy.mjs → engine/*`。

## 4. 策略注入契约（精确签名）

```js
/** @typedef {'play'|'council'|'certify'} Face */
/**
 * @typedef {Object} FacePolicy
 * @property {Face} face                      只在该面改道，其余面与其余座位走原逻辑
 * @property {number} seat                    只有该座位用模型（本批固定 0）
 * @property {(state: State, seat: number, candidates: Action[]) => Promise<string|null>} decide
 *                                            返回 actionKey；null / 非法 key / 抛错 / 超时 ⇒ 回落启发式并计数
 */
async function playOne(theme, players, seed, gateReserve, policy /* 可选，缺省 undefined */)
```

三个注入点（**只在 `policy.face` 命中且 `seat === policy.seat` 时改道**）：

| face | 现有代码位置 | 改道后 |
|---|---|---|
| `play` | `playOne` 里 `pickPlayableCard(...)` + `pickTarget(...)` 两处（含待认证锁定分支） | 候选 = `getLegalActions(state, seat).filter(a => a.type === 'PLAY_CARD')` → `decide` → `actionFromKey` + `withActor` → `performAction(...,'act',payload)`。**范围界定**：本面只决定「出哪张牌 + 打谁」，**不含**「行棋/问天/行事」三选一——后者仍由现行 `s.rng.next()` 阈值（0.16 / 0.75 / 0.85）决定，两臂完全相同 |
| `council` | `councilTurn(s)` | 候选 = `getLegalActions(...).filter(VOTE)` → `decide` → `castVote` |
| `certify` | `certificationTurn(s)` | 候选 = `getLegalActions(...).filter(a => a.type ∈ {CERTIFY_SIGN, CERTIFY_CHALLENGE, CERTIFY_ABSTAIN})` → `decide` → 对应 `certify*` |

**回落规则（逐条可测）**：`decide` 返回 `null`、返回不在候选集里的 key、反解抛错、调用超时（30s）、或 fetch 失败 ⇒ 走原启发式路径，`fallbackCount += 1`，对局继续。**不得**因注入失败而跳过该手番或死循环。

**候选集为空**时不调用模型，直接走原逻辑，并计 `emptyCandidateCount`。

## 5. 两处缺陷的精确修法

### 5.1 题面（`state-text.mjs`）
- `describeAction` 的 `DUEL_SUBMIT_CARD` 分支：由 `对峙锁定亮牌：出「<name>」` 改为含**颜色与点数**的形式（例：`对峙亮牌「<name>」（红·点数14）`），仍受 `ONE_LINE_MAX = 40` 截断约束。
- `buildChoice` 的 `instructions`：由固定的「现在轮到该玩家行动，应选哪个动作？」改为**按候选集所属面**生成。候选全为 `DUEL_SUBMIT_CARD` 时必须写明规则与限定：「对峙规则：红牌胜黑牌；同色则点数大者胜；同点平局各弃一张。亮牌不回手牌；败者退1格并抽1张。只能从下列自己的手牌里选一张锁定，选哪张？」
- 其余面沿用现行指令；**不得**把他人手牌、牌堆顺序、`duel.pickA/pickB` 写进任何题面。
- 同步 `tests/engine/legal-probe.test.ts` 的封闭词表（`TEMPLATE_WORDS`/`TEMPLATE_SKELETONS`）与 40 字符预算断言。**不得为过测试而放宽词表**；新增词必须是公开集里的词。

### 5.2 记录器 key 格式（随 `advanceWithDuel` 搬入 `policy.mjs`）
- 现状：`tests/sim/run.mjs` 的 `advanceWithDuel` 里 `record(stateAtPick, seat, 'duel_card:' + cardId)`，与 `actionKey` 的 `duel:card:<id>` 不一致 ⇒ P6 在对峙样本上把**格式差异**算成分歧。
- 改为：`record(stateAtPick, seat, actionKey({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId }))`；同步说明该格式的注释（原 `run.mjs` 里 `@param {string} heuristic` 那行随函数一起搬）。
- 探针侧（`tools/laya-probe/run.mjs`）在比较 P6 前把历史样本的 `duel_card:` 归一化为 `duel:card:`，使新旧样本可比；归一化函数须有单测（含「已是规范形则不变」「非对峙 key 不动」两条）。
- 仓内既有 `decisions-4p.jsonl` / `decisions-8p.jsonl` **不改写**（历史数据保留），靠读侧归一化兼容。

## 6. 评估协议与判据

- **三面独立**：`play` / `council` / `certify` 各自一轮，互不混合（否则归因不清）。
- **每面两臂**：基线（全启发式）vs 模型臂（**只有座0** 在该面用模型；其余座位、其余面全启发式）。
- **样本**：4 主题（`xianxia2026`/`scifi-ai`/`hybrid`/`urban-psych`）× 4 人 × **100 seed** = **400 局/臂**；每面 800 局，三面共 **2400 局**。seed 公式固定为 `7000 + i*31`（i = 0..99），两臂同 seed 配对。
- **统计**：座0 胜率的**配对 McNemar**，连续性校正 `χ² = (|b−c|−1)² / (b+c)`，临界 **3.841**（p<0.05）。`b` = 基线赢而模型臂输的局数，`c` = 反之。`b+c = 0` 时记「无可配对差异」，不得报显著。
- **判定措辞固定**：
  - `χ² > 3.841` 且模型臂座0 胜率更高 ⇒ **「该面值得接入，另立批次做门 ⑨ 重校准」**
  - `χ² ≤ 3.841` ⇒ **「未检出改善」**（禁止写成「模型无用」）
  - `χ² > 3.841` 且模型臂更低 ⇒ **「该面模型劣于启发式，保持贪心」**
- **附带必记读数（不设判据）**：无人取席兜底局数、平均回合、模型调用次数、合法率、回落次数、空候选次数、延迟 p50/p95、胜者变化率、异常数（必须为 0）。
- **成本预算**：出牌面每局约 10–20 次决策 ⇒ 约 4000–8000 次调用 ≈ 4–8 分钟；山议/认证面更少；三面合计约 **10–20 分钟** GPU 占用（含权重冷加载）。若单面超过 30 分钟，停下来报告而不是无声跑下去。

## 7. 门禁影响与等价性证明

| 门 | 影响 | 证明方式 |
|---|---|---|
| ⑨ 规模与平衡 | sim 默认路径必须逐字不变 | 抽模块 + async 化后，跑 `node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after-B70.md`（**默认参数，不加 --games/--themes/--players**），再 `diff docs/balance-report.md docs/预研/data/tmp/balance-after-B70.md` **必须为空**；非空 ⇒ 定位求值顺序/漏搬 helper，**禁止**重生成基线掩盖 |
| ② 测试 | 新增四类测试（见 §8） | `npm test` 0 fail |
| ③ 文档口径 | 规格 §7 补「策略注入点与评估器」口径；README 登记 B70 结论 | `npm run doc-sync` 通过 |
| ①④⑤⑥⑦⑧⑩⑪⑫⑬ | 不应受影响 | `node tools/gate.mjs` **13 门全绿** |

评估器**不进** `tools/gate.mjs`；`package.json` 只加脚本键 `eval:faces`，**不加任何依赖**；`esbuild.config.mjs` / `build/build-package.mjs` 不得引用 `tools/laya-probe/**`（红线 2）。

## 8. 测试清单（全部进 `npm test`，不依赖模型）

1. **缺省等价**：同 seed 下 `playOne(theme, 4, seed)`（省略后两参）与 `playOne(theme, 4, seed, undefined, undefined)`（显式传空）结果逐字相同（winners/rounds/reason 全等）；并断言 `run.mjs` 源码内**不再保留**被搬走的 9 个函数定义（`checkState`/`pickTarget`/`councilTurn`/`certificationTurn`/`maybeUseAbility`/`pickPlayableCard`/`playOne`/`advanceWithDuel`/`record`），防漏搬与防回流；另断言 `policy.mjs` **不 import** `run.mjs`（防循环依赖）。
2. **注入回落**：`decide` 分别返回 `null`、返回不在候选集的 key、抛错、超时 ⇒ 对局仍正常结束、`fallbackCount` 递增、异常数 0。
3. **面隔离**：`policy.face='council'` 时 `play`/`certify` 面的决策与基线逐字相同（用记录器或计数断言）。
4. **题面**：`DUEL_SUBMIT_CARD` 描述含颜色与点数；对峙面 `instructions` 含规则关键词；40 字符预算仍成立；封闭词表同步后禁止集守卫仍绿（含粘连泄漏与解构/括号访问两个既有失明模式）。
5. **key 归一化**：`duel_card:x` → `duel:card:x`；`duel:card:x` 不变；`play:x`/`cert:sign:0` 不受影响。

## 9. 交付物

```
tests/sim/policy.mjs                         新：决策层单一真相源 + 可注入策略
tests/sim/run.mjs                            改：import/await/记录器规范形
tools/laya-probe/game-arms.mjs               新：三面两臂评估器（可复跑）
tools/laya-probe/state-text.mjs              改：题面颜色/点数 + 面感知指令
tools/laya-probe/run.mjs                     改：P6 历史 key 归一化
tests/engine/policy-injection.test.ts        新：§8 的 1–3
tests/engine/legal-probe.test.ts             改：§8 的 4（词表/预算/禁止集）
tests/gates/key-normalize.test.ts            新：§8 的 5（B73 起）
package.json                                 改：加 eval:faces 脚本
docs/预研/2026-11-09-b70-face-evaluation.md   新：三面读数与判定
docs/批次/B70-决策面评估与题面修正-执行记录.md  新：批次记录
docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md  改：§7 口径
README.md                                    改：B70 结论登记
```

运行方式（写进批次记录，供复跑）：
```bash
node tools/laya-sidecar/up.mjs --weights "D:/<local-libs>/laya-multilingual/model.safetensors"   # 前台，Ctrl+C 停两层
npm run eval:faces            # 三面 × 两臂 × 400 局；无服务时 SKIP 退出码 0
node tools/gate.mjs           # 13 门
```

## 10. 风险与登记

| # | 风险 | 处置 |
|---|---|---|
| 1 | async 化改变求值顺序 ⇒ 门 ⑨ 读数漂移 | `diff` 为空作为硬证据；非空必须定位，禁止重生成基线 |
| 2 | 抽模块漏搬 helper | §8.1 的源码断言 + 门 ② |
| 3 | 题面改动撞封闭词表 | 同步 `TEMPLATE_WORDS`，**不得放宽词表**；禁止集守卫必须仍绿 |
| 4 | 400 局仍检不出小效应 | 判定措辞固定为「未检出改善」，不得升级为「模型无用」 |
| 5 | 模型超时/失败 | 回落启发式并计数；对局不得卡死；异常数必须 0 |
| 6 | 评估器被误接进生产 | 本批**只评估不接入**；`policy` 缺省 undefined，sim CLI 无新开关 |
| 7 | GPU 长时间占用 | 单面 >30 分钟即停下报告；跑完必须停服务并确认端口释放 |

**沿用的既有登记**（不在本批修）：G-a 出牌费用语义、G-b 引擎 `act` 的 `pendingCert`、G-c 关隘与 `gatesPassed`、G-d 双人互验、G-f 对峙选牌无 Action 成员已于 B68 修、G-g 复议裁定无人调用、G-h 少发牌静默。

## 11. 完成定义

- [ ] `tests/sim/policy.mjs` 落地，`run.mjs` 不再保留被搬走的定义，`playOne` 为 async 且 `policy` 缺省时行为逐字不变（`diff` 为空为证）
- [ ] 两处缺陷修好且各有测试；禁止集守卫与 40 字符预算仍绿
- [ ] `game-arms.mjs` 可复跑，三面各 400 局/臂读数齐全，判定措辞按 §6 固定
- [ ] `node tools/gate.mjs` **13 门全绿**；`git status --short dist/` 为空；`package.json` 无新依赖
- [ ] 评估报告与批次记录落档，含原始 JSON 路径与复跑命令
- [ ] 服务已停、端口 8711/8712 释放、工作树干净（除本批提交）
- [ ] **不包含**：模型接入生产/sim 默认路径、得分公式改动、微调
