# Laya sidecar V2 预研 · 续作计划（Task 9–17）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务逐个执行。步骤用 checkbox（`- [ ]`）跟踪。
> 本文是**自足**的执行文档：新会话、跨 session、或另一个读者不需要读任何其他对话即可执行。

**Goal:** 把本批已落地的 §7 动作枚举契约同步进文档并证明对局行为逐字未变（Task 9–10），再建起本地 Laya sidecar 与影子决策探针，量出工程可行性读数 P0–P6（Task 11–17）。

**Architecture（不变）:** 三段式枚举（候选粗筛 → rng 隔离试跑 → 判定收集）在引擎内自证合法；`web/legal-gate.ts` 独立表达 UI 判据，由三层漂移守卫（枚举层 / 候选层 / 判定形状层）断言两个实现集合相等；sidecar 走两跳（官方 `laya.serve` 应用硬绑环回 :8712 + Node 反代 :8711 补 CORS/权重对拍/SKIP）；探针用**状态采样 + 影子决策**，模型不驱动对局。

**Tech Stack:** TypeScript strict（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals`）、Node 24（`node --test` 直接跑 `.ts`）、esbuild 单文件打包、Playwright（既有依赖，不新增）、Python 3.12 + `laya==0.4.21`（FastAPI/uvicorn）。

**Spec（权威文档，冲突时以设计为准）:**
- 设计：`docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`
- 总纲与红线：`docs/superpowers/specs/2026-11-08-creativemountain-ai-prespike-overview.md`
- 原计划（Task 1–17，含已完成任务的完整代码）：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md`
- 本续作计划只覆盖 **Task 9–17**，并**取代**原计划中同名任务的描述（原计划有若干处已被证伪，见 §2.5 与 §5.6）。

---

## 0. 冷启动协议（新会话第一次进来时按顺序做）

1. 读工作目录与分支：`cd "D:/<repo>" && git status --short && git log --oneline -1`
   期望 HEAD = `323e768`（或其后继，若 Task 9 已开始）。
2. 读台账：`.superpowers/sdd/2026-11-08-creativemountain-laya-sidecar/progress.md`。
   台账首行必须是 `# SDD ledger — plan: docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md`；若首行是别的计划名，说明是别人的进度，**原地保留**，本计划另建自己的台账。
   台账里出现 `Task <N>: complete` 的任务 = 已完成，**不得重派**；出现 `fix round <R>/5` 而无 complete 的任务 = 停在修复循环中，从下一轮续。
3. 确认基线可复算（三条命令，全部必须绿）：
   ```bash
   npm run typecheck                      # 期望：无输出（tsc --noEmit 静默通过）
   npm test                               # 期望：338 pass / 0 fail / 1 todo
   node --test tests/engine/legal-probe.test.ts   # 期望：47 pass / 0 fail
   ```
   唯一 todo 是 `tests/engine/balance-regression.test.ts` 里的 V1.1 主题差异化项，不是失败。
4. 工作区里有**不属于本计划**的他人未提交改动，必须原样保留、绝不裹进任何提交：
   `engine/core/victory.ts`、`tests/engine/live-seats.test.ts`、`tests/engine/endgame-score.test.ts`、`docs/名场面流程脚本.md`、`creativemountain-host/spark-output/`。
   **禁止** `git add -A`、`git add .`、`git stash`、`git reset`、`git checkout --`；只 stage 任务 Files 段列出的确切路径。
5. 子代理执行协议（若继续用 SDD）：
   ```bash
   SK="C:/Users/<user>/.qoder-cn/plugins/cache/qoder-marketplace/superpowers/6.3.0/skills/subagent-driven-development/scripts"
   $SDD/sdd-workspace 不存在则用： "$SK/sdd-workspace" "docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md"
   "$SK/task-brief" "docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md" N   # N=9..17，抽原任务文本
   "$SK/review-package" "docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md" BASE HEAD
   ```
   **注意**：`task-brief` 抽的是**原计划**文本。原计划有 9 处已被证伪（§5.6 列出全部），派发时必须把本文件的对应修正一并附进 dispatch，否则子代理会照抄错的期望值。
6. 外向副作用确认点（必须先问用户）：Task 11 Step 2（新建 `.laya-venv` + `pip install`，走网络、GB 级磁盘）、Task 12 Step 2（常驻本地服务）。

---

## 1. 已完成事实（Task 1–8，禁止重做）

| Task | 提交 | 交付 | 验收证据（可复算） |
|---|---|---|---|
| 1 | `817a001` | `ActionType` = 13 项（+`CERTIFY_APPEAL_VOTE`，−`CERTIFY_VALIDATE_QUESTION`）；`CERTIFY_ANSWER{actor,target,passed}`；`legal.ts` 删除孤儿枚举 | `node --test tests/engine/action-contract.test.ts` 3/3 |
| 2 | `4ee3a9c` + `fd3503c` | `engine/core/action-key.ts`：`actionKey`/`actionFromKey`/`withActor`；`PLAY_CARD` 补可选 `target`；反解**只认规范形**（空段/缺段/多余尾段一律抛错） | `node --test tests/engine/action-key.test.ts` 5/5 |
| 3 | `24c5099` + `71c5f5f` | `engine/core/probe.ts` 的 `isolatedState`；`tests/engine/fixtures.ts` 六个引擎构造局面 + 后置断言；`mk` 的 `deckSize` 按人数取 `scales.deckTotal` | 常驻「rng 隔离」测试双向可失败 |
| 4 | `a1d4e3a` + `c78371d` | `probeAction` 适配三种拒绝表达；`PASS` 判据补「结算时立起对峙＝已接受但挂起」 | focused legal-probe 当时 9/9，含 3 条 PASS 真拒路径 |
| 5+6 | `0009643` + `23865ef` + `8b4fb9d` | `legal.ts` 五面试跑式枚举；`activeAbilityId` 唯一被动标识；`LEGAL_ACTION_CAP=64`；`getLegalActionStats{candidates,enumerated,truncated,dropped}`；补齐两处「粗筛窄于引擎」的漏发；「故意窄」契约成文 | focused 30/30；`npm run gate` 10/10 |
| 7 | `71d76a7` + `b8bf07b` | `web/legal-gate.ts`（`actionWindow`/`uiBlockNotice`/`uiAllows`/`uiHasLegalTarget`/`uiCandidates`/`uiAllowedSet`）；`main.ts`/`cert.ts` 消费；三层漂移守卫；**补上数字轨缺失的复议票入口** | focused 38/38；gate 10/10 且门 ⑩ E2E `ok:true`、`consoleErrors: []` |
| 8 | `693c37f` + `323e768` | `tools/laya-probe/state-text.mjs`（`describeState`/`describeAction`/`buildChoice`）+ `.d.mts`；禁止集靠**不写字段访问**达成；封闭词表分词判据；题面补齐 §4.5 | focused 47/47；13 项变异取证；gate 10/10 |

---

## 2. 全局约束（每条都必须可验证；违反即返工）

### 2.1 四条红线（总纲 §四）
1. **确定性不被模型污染**：`tools/gate.mjs` 的十条命令里不得出现任何需要 sidecar 的条目；十道门与 `docs/balance-report.md` 的固定 seed 复现路径上不得有模型调用。
2. **发布包零增量**：`esbuild.config.mjs` 与 `build/build-package.mjs` 不得引用 `tools/laya-sidecar/**`、`tools/laya-probe/**`；Python 依赖不写入 `package.json`/`package-lock.json`。验收命令：`git status --short dist/` 输出为空。
3. **模型只见公开信息**：禁止集 = 他人手牌 id、牌堆顺序、`duel.pickA`、`duel.pickB`；由 `tests/engine/legal-probe.test.ts` 的常驻词表/结构守卫断言（Task 8 已交付，不得削弱）。
4. **本地服务只绑环回**：`LAYA_HOST` 在 `launch.py` 内硬编码 `127.0.0.1`（官方默认 `0.0.0.0` 不可接受）；权重 sha256 对拍不符即拒绝启动，退出码非 0。

### 2.2 精确值（逐字使用，不得改写）
- `LAYA_SERVE_PORT=8712`、`LAYA_PROXY_PORT=8711`（避开 GateKeeper 的 8000）。
- 权重：`D:/<local-libs>/laya-multilingual/model.safetensors`，`643835514` 字节，sha256 `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`。
- 版本锁：`laya==0.4.21`；模型 revision 固定。
- 环境变量：`USE_TF=0`、`HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、`HF_HOME=D:\<local-libs>\hf-home`。
- `LEGAL_ACTION_CAP = 64`（官方 `MAX_CHOICE_OPTIONS=100`，留余量）；每个候选语义文案 ≤ 40 字符（`state-text.mjs` 的 `ONE_LINE_MAX`）。
- 提交信息格式：`<type>(B15): 中文` / `<type>(B16): 中文`。

### 2.3 判据数字（P0–P6，不得为变绿而下调）
| 读数 | 判据 | 不达标的结论（固定措辞） |
|---|---|---|
| P0 | 权重对拍通过 且 `laya-serve` 起得来 且 `/health` 200 | 停在环境层，不出任何后续结论 |
| P1 | `answerRate ≥ 0.99` 且 `illegal = 0` | 「枚举契约有洞，先补 B15」 |
| P2 | GPU `p95 ≤ 300ms`；CPU `p95 ≤ 1500ms` | 「只能做异步预研，进不了真人桌局」 |
| P3 | **`dropped` 之和 = 0**（不是 `truncated`，见 §5.6 第 3 条） | 下调 `LEGAL_ACTION_CAP` 并复跑，把候选数安全区写进报告 |
| P4 | `reachable = true`；否则必须给出失败层次之一 | 「V2 必须走 http 预览服务，放弃双击即玩」 |
| P5 | 输出首词 `SKIP` 且退出码 = 0 | 隔离没做到，返工 |
| P6 | 仅记录，不设判据 | —— |

### 2.4 本批不做（越界即返工）
AI 强度结论、AI 驱动对局、sidecar 进发布包、关隘接线（B14）、`gatesPassed` 写入（B14）、出牌费用语义裁定（G-a）、引擎 `act` 分支的 `pendingCert` 加固（G-b）、复议裁定的流程层接线（G-g）。

### 2.5 已由实测确定的既有事实（写给后续任务的硬前提）
- **sim 没有 `--seed` 参数**：`parseArgs` 只认 `--games/--check/--out/--themes/--players`；每局 seed 由 `tests/sim/run.mjs` 的 `runCell` 公式 `1000 + g*97 + players*13 + themeSeed` 生成 ⇒ 同 `--themes/--players/--games` 即逐字可复现。**任何命令都不要加 `--seed`**（会被静默忽略，让人误以为换了随机流）。
- **sim 默认每档 1000 局**；`docs/balance-report.md` 由默认参数生成（4 主题 × 3–8 人 × 1000 局 = 24000 局）。
- **官方 `laya.serve` 无 CORS 中间件** ⇒ 浏览器 `file://` 直连官方端口必然失败，反代是必需项而非优化。
- **Laya 不生成文本**：只返回 `choice`/`score`/`noul` 的选型与校准概率 ⇒ 回解必须靠 key，不得解析自由文本。
- **Python 侧 `-I`（isolated）会排除 user site**，而候选环境 ② 依赖 user site 的 `_torch_drive.pth` 递来 `D:\<local-libs>\torch-cu124` ⇒ 自检脚本不得用 `-I`。

---

## 3. 环境与命令事实速查（不得凭记忆改写）

| 项 | 值 / 命令 |
|---|---|
| 权重目录 | `D:/<local-libs>/laya-multilingual/`（`model.safetensors`、`rl_agent_config.json`、`encoder/config.json`、`tokenizer/tokenizer.json`、`.sha256` 文件） |
| 模型配置 | `max_len=1024`、`head_max_len=256`、`max_prefixes=6`、`amp_dtype=bf16`、编码器 `jhu-clsp/mmBERT-base`（ModernBERT 22 层、hidden 768、vocab 256000） |
| 邻居 venv（已含依赖） | `D:/<other-repo>/experiments/venv/Scripts/python.exe`：`laya 0.4.21`、`torch 2.6.0+cu124`、`include-system-site-packages = false` |
| 官方 serve 路由 | `POST /v1/systemone`、`POST /v1/systemone/batch`（≤64 states）、`POST /v1/route`、`GET /health`；可选 `LAYA_API_KEY` bearer |
| 官方 serve 上限 | `MAX_QUESTIONS=64`、`MAX_STATE_CHARS=50000`、`MAX_BATCH_STATES=64`、`MAX_BODY_BYTES=2 MiB`、`MAX_CHOICE_OPTIONS=100`、`MAX_TOTAL_OPTIONS=512` |
| 官方入口脚本 | `laya-serve = laya.serve:main`；`create_app(router=None)` |
| PyPI | 2026-11-08 实测 `https://pypi.org/simple/fastapi/` → 200（可达） |
| 门 ⑨/⑩ | `npm run gate` 全跑；门 ⑨ = sim 冒烟 + 异常断言；门 ⑩ = `tests/e2e/duel-e2e.mjs`（headless chromium 打开 `file:///` 构建产物） |
| 文档口径门 ③ | `npm run doc-sync`；比对对象由 `tools/doc-sync-lib.mjs` 的 `SPEC_PATH` 固定为**单一主规格文件**，新增 spec/plan 不参与比对 |
| 既有 API 面 | `engine/core/legal.ts`：`LEGAL_ACTION_CAP`、`actionWindowOpen`、`candidatesOf`、`getLegalActions`、`getLegalActionStats`、`LegalActionStats`；`engine/core/probe.ts`：`isolatedState`、`probeAction`、`ProbeResult`；`engine/core/action-key.ts`：`actionKey`、`actionFromKey`、`withActor`；`engine/core/passives.ts`：`activeAbilityId`；`web/legal-gate.ts`：`actionWindow`、`uiBlockNotice`、`uiAllows`、`uiHasLegalTarget`、`uiCandidates`、`uiAllowedSet`、`UiTargetedShape`；`web/ui/cert.ts`：`certPanelActions`、`certClickableActions`；`tools/laya-probe/state-text.mjs`：`describeState(state,seat)`、`describeAction(state,action,seat)`（seat **必填**）、`buildChoice(state,seat)` → `{instructions, criteria, noLegalActions}`；`engine/core/serialize.ts`：`serializeState`、`deserializeState`、`stateToJson`、`stateFromJson` |
| 动作 key 文法 | `move` · `ask` · `pass` · `play:<cardId>[-><seat>]` · `ability:<op>[-><seat>]` · `vote:<seat>` · `cert:sign:<t>` · `cert:challenge:<t>` · `cert:abstain:<t>` · `cert:appeal:<t>` · `cert:appealvote:<t>:<overturn\|uphold>` · `cert:answer:<t>:<pass\|fail>` · `gate:<cardId>-><seat>`；`actor` 不入 key |

> 表中不带「实测」字样的行号或细节，落文档时**必须现查现用**（`grep -n`），不得照抄本文。

---

## 4. 待登记缺陷表（Task 9 的输入；逐条都要有代码证据）

| # | 事实 | 证据（写入时复核） | 归属 |
|---|---|---|---|
| G-a | 出牌费用无权威语义：规格 §3.1 未写支付；引擎 `performAction` 的 `act` 分支既不校验也不扣；UI 手牌区只显示不拦；仅 sim 把 `cost <= resource` 当资格线 ⇒ 数字轨可免费出牌。`uiAllows` 另镜像了 `certifyChallenge ≥1`、`certifyAppeal ≥2` 两条资源前置并被测试钉住 | `engine/core/turn-runner.ts` 的 `act` 分支；`web/ui/hand.ts`；`tests/sim/run.mjs`；`web/legal-gate.ts` | 与 B14 一并裁定 |
| G-b | 待认证锁定只在调用方生效：引擎 `act` 分支不查 `pendingCert`（`move` 分支查），UI 靠禁用行动区、sim 靠过滤位移牌；枚举层按 UI 规则排除，但 `probeAction` 实测对锁定座位的出牌给 `ok:true` | `engine/core/turn-runner.ts`（`move` 有、`act` 无）；取证行在 `tests/engine/legal-probe.test.ts` | 引擎加固，待裁定 |
| G-c | `gatesPassed` 无写入方，四套主题各有一个身份目标是 `pass_gates` ⇒ **4 个身份目标永不可达**；`engine/core/gate.ts` 的 `payGate`/`drawTrial` 全仓零引用 | `engine/goals/registry.ts`（只读）、`themes/*/theme.json` 的 `pass_gates` | B14 |
| G-d | `certifyMutualSign`（§5.5 双人互验）仅 `tests/engine/live-seats.test.ts` 调用 ⇒ 双人互验在数字轨与模拟器均未接线 | `engine/core/certification.ts` | B14 相邻批次 |
| G-e | README 门禁表缺第 ⑩ 道（浏览器 E2E），而 `tools/gate.mjs` 有第十条 | `tools/gate.mjs`、`README.md` 门禁表 | Task 9 已含修法 |
| G-f | 对峙选牌（`submitDuelCard`）没有 `Action` 成员；对峙未决时行动面整体关闭 ⇒ `candidatesOf` 对**所有座位**为空 ⇒ 真人必须选暗牌的时刻，AI/sidecar 拿到空动作表 | `engine/core/legal.ts` 的行动窗口关闭条件；`engine/core/duel.ts` | Task 9 登记 + V2 决定 |
| G-g | `resolveAppeals` 在 `engine/**` 与 `web/**` **零调用方**（只有 `tests/sim/run.mjs`），`applyAppealOutcome` 不清 `appealed` ⇒ 新增的复议票写入一个没人关闭的窗口 | `grep -rn "resolveAppeals"`；`engine/core/certification.ts` | Task 9 登记；流程层另立任务 |
| G-h | 少发牌是静默的：`createInitialState` 默认 `deckSize=40`，`dealInitialHands` 需要 `players × handStart`（8 人 = 56），`drawCards` 空堆无警告地停 ⇒ 高人数下座位手牌偏少；多处既有测试踩此坑（如 `tests/engine/exile-floor.test.ts`） | `engine/core/state.ts`、`engine/core/hand.ts` | 引擎层把它变成显式失败，待裁定 |

**另需 Task 9 记录的三项「故意窄/口径」**：粗筛比引擎更严的**五**条（死亡座位、`pendingCert`、对峙未决、`phase ≠ 行动`、`isRoundEnd`）；`truncated` 与 `dropped` 的分工；`noLegalActions` 把 ≥3 种成因混在一个布尔里（Task 15 必须分桶）。

---

## 5. 任务

### Task 9 · 文档口径同步（规格 + README + 设计更正 + 一处代码旁路）

**Files:**
- Modify: `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（仅 §6.3、§7、§5.3）
- Modify: `README.md`（门禁表补第 ⑩ 行；已知限制补 G-a…G-h 八条 + 三条 UI 行为变化）
- Modify: `docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`（§4.5 公开集更正）
- Modify: `engine/core/legal.ts`（**仅注释**：把「四处故意窄」改成五处并补死亡座位那条的引擎真相）
- Modify: `web/ui/council.ts` + `tests/engine/legal-probe.test.ts`（收口最后一处旁路，见 Step 5）

**Interfaces:** 消费 `uiAllows`、`candidatesOf`、`LegalActionStats`；不新增公开 API。

- [ ] **Step 1 · §6.3 的 ActionType 清单改为 13 项**
写死的成员集合（顺序照此）：`MOVE`、`PLAY_CARD`、`ABILITY`、`ROLL_WHEEL`、`COMPARE`、`PASS`、`VOTE`、`CERTIFY_SIGN`、`CERTIFY_CHALLENGE`、`CERTIFY_ABSTAIN`、`CERTIFY_APPEAL`、`CERTIFY_APPEAL_VOTE`、`CERTIFY_ANSWER`。
同时更正字段：`PLAY_CARD = {actor, cardId, target?}`；`CERTIFY_ANSWER = {actor, target, passed}`（旧文写的 `questionIndex/ok` 已废）；`CERTIFY_APPEAL_VOTE = {actor, target, overturn}`；`CERTIFY_VALIDATE_QUESTION` 整条删除并注明原因（算子零调用方）。
验收：`node --test tests/engine/action-contract.test.ts` 仍 3/3；`grep -c "CERTIFY_VALIDATE_QUESTION" engine/core/action.ts` = 0。

- [ ] **Step 2 · §7 由承诺改为已实现契约**
必须包含以下六点，逐条写清「谁保证、哪个测试钉住、命令是什么」：
① 三段式 = 候选粗筛 → rng 隔离试跑 → 判定收集；② 合法性权威是引擎执行入口，`probeAction` 不得掺规则校验（不查 `card.cost`、不查 `act` 的 `pendingCert`、不查 target 越界）；③ 三层漂移守卫（枚举层 `uiAllowedSet == getLegalActions`、候选层 `uiCandidates == candidatesOf`、判定形状层对 `uiBlockNotice` 的形状矩阵）；④ `LEGAL_ACTION_CAP = 64`，`getLegalActionStats` 四字段，**P3 读 `dropped` 不读 `truncated`**；⑤ 被动标识唯一来源 `activeAbilityId`；⑥ 不枚举项三条：`PASS`（UI 无结束手番入口）、`COMPARE`（入口待 B14）、对峙选牌（无 Action 成员 = G-f）。
验收：`npm run doc-sync` 通过（ActionType 不在比对项内，故必须靠人核：把 §6.3 与 §7 的成员名与 `engine/core/action.ts` 逐字比对，差异为 0）。

- [ ] **Step 3 · §5.3 与「故意窄」成文**
§5.3 写明：判定权属于**已质疑且尚未判定**的座位（`judgments` 以判定人为键，引擎无重复判定守卫，去重由粗筛承担）；复议由待认证者**本人**申请（`target === actor`，需 2 资源）；复议票发给非当事人（判定人与待认证者都被引擎拒）。
§7 附「粗筛故意窄于引擎的五条」列表，每条给出引擎真实行为 + 为什么这样收 + 对应取证测试标题。
验收：`grep -n "四处" engine/core/legal.ts` = 0 命中；`npm test` 全绿。

- [ ] **Step 4 · README**
门禁表补一行第 ⑩ 门（浏览器端到端，依赖门 ④ 产物）；已知限制补 G-a…G-h 八条（用 §4 表的措辞，逐条给证据路径）；再补三条 UI 行为变化并写明机器证据只有门 ⑩：(1) 越阶段门禁扩到被动与需目标出牌路径；(2) 被拒点击现在给拒因文案；(3) `resource<1` 的「质疑」与 `resource<2` 的「申请复议」两个死按钮消失。
验收：`node -e "const t=require('fs').readFileSync('README.md','utf8');['G-a','G-b','G-c','G-d','G-e','G-f','G-g','G-h'].forEach(k=>{if(!t.includes(k))throw new Error('缺 '+k)})"` 无输出。

- [ ] **Step 5 · 收口 `web/ui/council.ts` 旁路（代码，最小改动）**
现状：山议面板自行判定显隐（`alive` 过滤 + 直接摆按钮），不消费 `uiAllows` ⇒ `web/legal-gate.ts` 头部「UI 可点性的唯一来源」在该文件上不成立。
改法：投票行的显隐改为 `uiAllows(state, seat, { type:'VOTE', actor: seat, target })`；点击被拒时走 `uiBlockNotice` 给拒因（与其它已收口路径一致）。
在 `tests/engine/legal-probe.test.ts` 加一条断言：山议面板的可选投票集合 == `getLegalActions(state, seat).filter(VOTE)`（用现有 driftScenes，勿新建手拼局面）。
验收：`npm run gate` 10/10（门 ⑩ 对峙 E2E 必须仍 `ok:true`、`consoleErrors: []`）。

- [ ] **Step 6 · 设计 §4.5 更正（以裁定代替沉默）**
两条决定写进设计文档：(1) **本局日志摘要不输出**给模型，理由是日志文案无法静态证明无泄漏且封闭词表将被迫纳入任意文本；(2) **已公开关隘试炼牌本批不输出**，归入 B14（因 G-c 关隘根本未接线）；(3) 探针层用中性词「资源」而非主题词「灵枢」，因序列化状态不带主题 glossary，并写明这对 P6 人工阅读分歧样本的影响。
验收：`grep -n "日志摘要" docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md` 命中处附近必须能看到「不输出」的裁定句。

- [ ] **Step 7 · 提交**
```bash
git add docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md README.md docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md engine/core/legal.ts web/ui/council.ts tests/engine/legal-probe.test.ts
git commit -m "docs(B15): 规格 §6.3/§7/§5.3 与代码对齐 + README 登记 G-a…G-h + 收口山议面板旁路"
```

---

### Task 10 · 第 ⑨ 门逐字等价回归（证明 B15 未改对局行为）

**Files:** Create/Modify `docs/预研/2026-11-08-laya-sidecar.md`（「阶段 A 回归」小节）

- [ ] **Step 1 · 十道门**
Run: `npm run gate 2>&1 | tail -30`
期望：末行含 `PASS`，10 道门全绿（原样贴进报告）。

- [ ] **Step 2 · 逐字等价（不是"读数接近"，是 diff 为空）**
```bash
mkdir -p docs/预研/data/tmp
node tests/sim/run.mjs --out docs/预研/data/tmp/balance-after.md > docs/预研/data/tmp/sim-after.log 2>&1
diff docs/balance-report.md docs/预研/data/tmp/balance-after.md && echo "报告逐字一致"
```
期望：`diff` 无输出并打印「报告逐字一致」。
若有差异：这是 B15 改了执行路径的证据 ⇒ 用 `git stash push -- <自己的文件>` 逐段回退定位（先怀疑 `advanceTurn` 调用顺序与牌序访问）；**禁止**用重新生成 `docs/balance-report.md` 的方式掩盖差异。
- [ ] **Step 3 · 落档**：把 Step 1 的尾行、Step 2 的 diff 结果、四条常驻测试名（一致性-正向 / 漂移守卫 / rng 隔离 / 禁止集）与实际通过计数写进报告。
- [ ] **Step 4 · 提交**：`git add docs/预研/2026-11-08-laya-sidecar.md && git commit -m "test(B15): 第 ⑨ 门逐字等价回归 + 阶段 A 常驻护栏落档"`

---

### Task 11 · P0 环境自检（定 venv 与 launch 路线）

**⚠️ 外向副作用：Step 2 会新建 `.laya-venv` 并走网络 pip 安装。执行前先取得用户同意。**

**Files:** Create `tools/laya-sidecar/env-check.mjs`、`docs/预研/data/p0-env.md`；Modify `.gitignore`
**Interfaces:** Produces 环境变量 `LAYA_PY`（解释器绝对路径）与路线判定 `A`/`B`。

- [ ] **Step 1** 实现 `env-check.mjs`，逻辑固定为三段（顺序不可换）：
  1. 权重对拍：字节数 `643835514` + sha256 前缀 `9d628fd9`；不符 ⇒ 写结论、退出码 1，不做后续任何探测。
  2. 候选解释器依序探测：`$LAYA_PY` → `D:/<repo>/.laya-venv/Scripts/python.exe` → `D:/<other-repo>/experiments/venv/Scripts/python.exe`；打印 `laya.__version__`、`inspect.signature(serve.create_app)`、`inspect.signature(laya.Router.__init__)`、`inspect.signature(laya.load)`、`torch.__version__`、`torch.__file__`、`torch.cuda.is_available()`。**命令不得带 `-I`**（理由见 §2.5）。
  3. 判定规则成文：候选 ② 的 `torch.__file__` 含 `D:\<local-libs>\torch-cu124` 且 CUDA 为 True ⇒ 采用 ②；否则采用 ① 并在报告登记跨项目耦合。
- [ ] **Step 2** 建候选 ② 并跑：
  ```bash
  python -m venv --system-site-packages .laya-venv
  .laya-venv/Scripts/python.exe -m pip install "laya==0.4.21" "laya[serve]"
  node tools/laya-sidecar/env-check.mjs
  ```
  期望：`docs/预研/data/p0-env.md` 首段含「对拍通过」，且三行签名都打印出来了（不是 FAIL）。
- [ ] **Step 3** 在 `p0-env.md` 末尾补四行结论，取值全部来自 Step 2 的实际输出：`采用环境=<绝对路径>`、`torch来源=<...>`、`CUDA可用=<True|False>`、`launch路线=<A|B>`。
  A 路条件：`create_app` 首参接受 router/agent 实例 **且** `Router` 签名含本地目录或缓存路径参数。
  B 路条件：`laya.load` 能返回可用推理对象（GateKeeper 的 `experiments/scripts/t1_bench.py:47` 已验证此用法），但不满足 A 路条件。
  两者都不满足：结论写「官方 app 无法指向本地权重」，Task 12 不实现启动器，P1–P4 标「未跑：环境不支持」，**不得**改成自研推理层。
- [ ] **Step 4** `.gitignore` 追加 `.laya-venv/`、`tools/laya-sidecar/__pycache__/`、`docs/预研/data/tmp/`。
- [ ] **Step 5** 提交：`git add tools/laya-sidecar/env-check.mjs docs/预研/data/p0-env.md .gitignore && git commit -m "chore(B16): P0 环境自检（权重对拍 + venv 决策树 + create_app/Router/load API 面）"`

---

### Task 12 · `launch.py`（官方 app + 本地权重 + 硬绑环回）

**Files:** Create `tools/laya-sidecar/launch.py`、`docs/预研/data/p0-smoke-choice.json`

- [ ] **Step 1** 按 Task 11 定的路线写启动器，硬性要求逐条落地：`HOST="127.0.0.1"`（不接受任何环境变量改绑定）、`PORT=int(os.environ.get("LAYA_SERVE_PORT","8712"))`、进程内设置 `USE_TF/HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE/HF_HOME`、参数名照 `p0-env.md` 记录的真实签名写（**不得**照抄本文占位参数名）。
- [ ] **Step 2** 起服务并验健康：
  ```bash
  mkdir -p docs/预研/data/tmp
  "<LAYA_PY>" tools/laya-sidecar/launch.py > docs/预研/data/tmp/serve.log 2>&1 &
  curl -s http://127.0.0.1:8712/health
  ```
  期望：JSON 含计算设备字段、`serve.log` 无 traceback；把实际就绪秒数记进报告（P2 的加载耗时）。
- [ ] **Step 3** 打一次 `choice`（两选项 `move`/`ask`）并把原始响应存 `p0-smoke-choice.json`。
  期望：`answers.act.choice ∈ {move, ask}` 且带置信度字段。
- [ ] **Step 4** 提交：`git add tools/laya-sidecar/launch.py docs/预研/data/p0-smoke-choice.json && git commit -m "feat(B16): launch.py 官方 serve 应用 + 本地权重 + 硬绑 127.0.0.1:8712"`

---

### Task 13 · Node 反代（CORS / 权重对拍 / SKIP）

**Files:** Create `tools/laya-sidecar/serve.mjs`；Test `tests/gates/sidecar-guard.test.ts`（新建）
**Interfaces:** Produces `LAYA_PROXY_PORT`（默认 8711）上的 `GET /health`、`POST /v1/systemone`；响应恒带 `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: content-type`、`Access-Control-Allow-Methods: POST, GET, OPTIONS`；`OPTIONS` ⇒ 204；上游不可达 ⇒ 503 `{"unavailable":true}` 且进程不退。

- [ ] **Step 1** 三条常驻测试（**每条用独立端口**，禁止三条共用 8711）：
  ① `--weights` 指到一个字节数不符的临时文件 ⇒ 退出码 ≠ 0 且 stderr 含「对拍失败」；
  ② 官方服务不在 ⇒ `GET /health` 返回 503、body `{"unavailable":true}`、响应头含 ACAO；
  ③ `OPTIONS /v1/systemone` ⇒ 204 且 `access-control-allow-methods == "POST, GET, OPTIONS"`。
  期望 RED：文件不存在。
- [ ] **Step 2** 实现 `serve.mjs`（Node 内置 `http`，禁第三方包），职责严格限于：对拍 → 绑 `127.0.0.1` → CORS/OPTIONS → 转发 → 30s 超时 → 503 折叠。**不写任何决策逻辑**。
- [ ] **Step 3** `node --test tests/gates/sidecar-guard.test.ts` 3/3；`npm test` 全绿。
  若执行机无权重导致 ②③ 拒启而失败：这是**预期失败**，在报告登记「本机无权重，P4/P5 未跑」，不得放宽对拍（红线 4）。
- [ ] **Step 4** 提交：`git add tools/laya-sidecar/serve.mjs tests/gates/sidecar-guard.test.ts && git commit -m "feat(B16): Node 反代补 CORS/OPTIONS + 权重对拍拒启 + 无服务 SKIP 形状"`

---

### Task 14 · sim 决策点记录器（默认关闭）

**Files:** Modify `tests/sim/run.mjs`；Test `tests/gates/sim-record.test.ts`（新建）
**Interfaces:** Produces `--record-decisions <path>`；JSONL 行字段恰为 `seq, themeId, players, seed, round, turnIndex, seat, phase, face, heuristic, state`（`heuristic` 是 `actionKey`，`state` 是 `stateToJson`）。

- [ ] **Step 1** 写失败测试（不变量 = **报告文件逐字一致**，不是 stdout）：
  ```bash
  node tests/sim/run.mjs --themes xianxia2026 --players 4 --games 2 --out <tmp>/on.md              # 不带开关
  node tests/sim/run.mjs --themes xianxia2026 --players 4 --games 2 --record-decisions <tmp>/on.jsonl --out <tmp>/on-rec.md
  diff <tmp>/on.md <tmp>/on-rec.md    # 期望：无输出
  ```
  再加一条：不带开关时不产出 JSONL；带开关时 `lines.length > 10`、`lines[1].seq === 1`、`lines[0].themeId === "xianxia2026"`、11 个字段齐全。
- [ ] **Step 2** `parseArgs` 加 `record`（与 `--out` 同风格），`record()` 在 `recorder === null` 时是空操作；落盘位置在主题循环之后、`const summary = summarize(cells)` 之前。
- [ ] **Step 3** 在九个决策点各插一行 `record(...)`（只加行，不改任何决策）：山议落票；认证签印/质疑/弃权/判定/复议票；被动发动成功分支；对峙选牌选定处；`move` 分支；`ask` 分支；出牌分支（需目标时带 `target`，否则不写该键）。
- [ ] **Step 4** `node --test tests/gates/sim-record.test.ts` 绿；`npm run gate` 10/10；生成一份 2 局的 `docs/预研/data/decisions-smoke.jsonl`。
- [ ] **Step 5** 提交：`git add tests/sim/run.mjs tests/gates/sim-record.test.ts docs/预研/data/decisions-smoke.jsonl && git commit -m "feat(B16): sim 决策点记录器（--record-decisions 默认关闭，影子决策数据源）"`

---

### Task 15 · 影子决策探针（P1 / P2 / P3 / P6）

**Files:** Create `tools/laya-probe/run.mjs`、`docs/预研/data/decisions-4p.jsonl`、`decisions-8p.jsonl`、`probe-raw.json`
**前置：** Task 13 的反代在跑；Task 12 的官方服务在跑。

**必须带上这三条修正（原计划文本里的是错的或过时的）：**
1. **`actionFromKey` 必须包在 try/catch 里**。反解现在是严格规范形，模型给一个畸形 key 会让脚本整体崩溃而不是计成「未回答」。把反解与 `withActor` 一起放进 `try`，失败计入 `P1` 的未回答样本并记 `err`。
2. **P3 的下调判据读 `dropped`，不是 `truncated`**（原计划第 1808/1828/1853/2006 行是旧口径，别照抄）。汇总里同时给 `dropped` 之和与 `truncated` 计数，只有前者非 0 才触发「下调 `LEGAL_ACTION_CAP` 复跑」。
3. **采样前先删 `decisions-smoke.jsonl`**：`readdirSync` 的字典序会让它混进 `LIMIT` 截断，把 2 局的样本掺进正式读数。

- [ ] **Step 1** 实现：读 `docs/预研/data/decisions-*.jsonl` → `stateFromJson` → `buildChoice`（带 `noLegalActions`）→ `describeState` → `POST /v1/systemone` → 取 `answers.act.choice` → 严格反解（try/catch）→ `probeAction` 复核是否合法 → 记 `{seq,face,themeId,players,ms,candidates,enumerated,dropped,truncated,answered,err,illegal,laya,heuristic,agree}`。
  统计口径写死：`P1.answerRate = answered/n`，`P1.illegal = count(illegal)`；`P2` 用已回答样本的 p50/p95；`P3` 用 `dropped` 之和与 `maxCandidates`；`P6.agreeRate` 与分歧前 20 条。
  **分桶要求**：`noLegalActions === true` 的样本单独计数并列出原因（待认证锁定 / 对峙未决 / 非行动阶段——目前只能靠题面文本区分，见 §4 末），不得混进 `answerRate` 的分母而不说明。
- [ ] **Step 2** 采样与跑数（**不加 `--seed`**）：
  ```bash
  node tests/sim/run.mjs --themes xianxia2026,scifi-ai,hybrid,urban-psych --players 4 --games 6 --record-decisions docs/预研/data/decisions-4p.jsonl
  node tests/sim/run.mjs --themes xianxia2026,scifi-ai,hybrid,urban-psych --players 8 --games 3 --record-decisions docs/预研/data/decisions-8p.jsonl
  node tools/laya-sidecar/serve.mjs &
  node tools/laya-probe/run.mjs
  ```
  期望：决策点 ≥100；打印 P1/P2/P3/P6；`P1.illegal === 0`。
- [ ] **Step 3 词表陷阱（Task 8 留下的必修项）**：真实主题（如 `themes/xianxia2026`）的中文牌名含间隔号（如「御风·远」）、被动 op 有 8 种，而 `tests/engine/legal-probe.test.ts` 的封闭词表只按 ASCII 测试主题校准过 ⇒ 加真实主题场景时词表会把**合规实现**误判为泄漏。修法是让词表的数据侧从主题自带的牌名/牌 id/被动 op 全集派生（按构造即公开），并加一条真实主题场景；「字段没进白名单」与「真的泄漏」必须可区分。
- [ ] **Step 4** 按 §2.3 判据写结论；任一不过就按给定的「不达标含义」措辞写，**不得改判据**。
- [ ] **Step 5** 提交：`git add tools/laya-probe/run.mjs docs/预研/data/probe-raw.json docs/预研/data/decisions-4p.jsonl docs/预研/data/decisions-8p.jsonl tests/engine/legal-probe.test.ts && git commit -m "feat(B16): 影子决策探针 P1/P2/P3/P6（严格反解入 try/catch、P3 读 dropped、词表按主题派生）"`

---

### Task 16 · 浏览器可达性探针（P4）

**Files:** Create `tools/laya-probe/browser.mjs`、`docs/预研/data/p4-browser.json`

- [ ] **Step 1** 实现要求（两条硬约束，缺一即无效）：
  ① `page.on('console')` 与 `page.on('pageerror')` 必须在 `page.goto(...)` **之前**注册，否则收不到 CORS/PNA 报错——而报错正是失败层次的唯一证据；
  ② 页面必须用 `pathToFileURL` 以 `file://` 打开 `dist/发布包/数字轨/创界山-活人认证.html`（门 ④ 产物），不得改用 http 预览（那等于把要验的东西换掉）。
  在页面里 `fetch` 反代两次：`GET /health`、`POST /v1/systemone`（两选项 choice），并收集 console 错误。
- [ ] **Step 2** 跑：
  ```bash
  npm run build:only
  node tools/laya-sidecar/serve.mjs &
  node tools/laya-probe/browser.mjs > docs/预研/data/p4-browser.json
  ```
  期望：`health.reachable === true` 且 `post.status === 200`（反代在、官方服务不在时 `post.status === 503` 也算可达层通过）。
  失败必须归类到四种之一：`OPTIONS 405` / 缺 `Access-Control-Allow-Origin` / 私有网络访问（PNA）预检被拒 / 混合内容；分类依据写进 `consoleErrors` 原文。
- [ ] **Step 3** 结论措辞固定：不可达 ⇒ 「V2 必须走 http 预览服务，放弃双击即玩」（产品级取舍，不做技术绕过）。
- [ ] **Step 4** 提交：`git add tools/laya-probe/browser.mjs docs/预研/data/p4-browser.json && git commit -m "feat(B16): P4 浏览器可达性探针（file:// + 预检前先挂 console 监听）"`

---

### Task 17 · P5 降级自证 + 脚本入口 + 报告落盘

**Files:** Create `tools/laya-probe/skip.mjs`、`tests/gates/laya-skip.test.ts`；Modify `package.json`、`docs/预研/2026-11-08-laya-sidecar.md`

- [ ] **Step 1** 常驻负样本（不依赖模型、不依赖权重）：`LAYA_PROXY_PORT=1` 跑 `skip.mjs`，断言首词 `SKIP`、JSON 可解析、`reason` 是字符串、`records` 是整数。
- [ ] **Step 2** `skip.mjs`：探 `http://127.0.0.1:${LAYA_PROXY_PORT}/health`（3s 超时），三种输出形状固定为
  `SKIP {"reason":"sidecar-ready","status":<int>,"records":<int>}` /
  `SKIP {"reason":"proxy-says-unavailable","status":<int>,"records":<int>}` /
  `SKIP {"reason":"no-sidecar","error":"<≤120字符>","records":<int>}`；
  结尾 `process.exit(0)`（无服务不是失败）。
- [ ] **Step 3** `package.json` 的 `scripts` 加五项（键名照此）：`env:laya`、`sidecar:laya`、`probe:laya`、`probe:laya:browser`、`probe:laya:skip`。**不加任何 Python 依赖**。
- [ ] **Step 4** 报告落盘：`docs/预研/2026-11-08-laya-sidecar.md` 必须含（a）P0–P6 七行表，每格填**实测值**，环境缺失时按固定措辞写不跑原因（`未跑：本机无权重 / 无 CUDA / create_app 不接受本地权重`），不留空、不下调判据；（b）接线/延迟/浏览器三条判定；（c）对 V2 的三条建议（值不值得做 AI 陪练、是否需要分层决策、B14 后关隘并入枚举的剩余成本）；（d）红线自证三行（`npm run gate` 尾行、`git status --short dist/` 为空、`node -e` 打印 dependencies 无 Python 项）。
- [ ] **Step 5** 最终验收（全部必须成立）：
  ```bash
  npm test                                   # 期望 0 fail
  npm run gate 2>&1 | tail -20               # 期望 10 门全绿
  git status --short dist/                   # 期望：空
  npm run probe:laya:skip; echo "exit=$?"    # 期望：SKIP 开头且 exit=0
  ```
- [ ] **Step 6** 提交：`git add tools/laya-probe/skip.mjs tests/gates/laya-skip.test.ts package.json docs/预研/2026-11-08-laya-sidecar.md && git commit -m "feat(B16): P5 无服务降级常驻负样本 + 探针脚本入口 + 预研读数报告落盘"`

---

## 6. 停止条件（只有这四类可停）

1. 不可逆或破坏性操作（例：需要删他人未提交的文件、需要 `git reset`）。
2. 安全敏感动作（例：要把服务绑到非环回地址、要放宽权重 sha256 对拍）。
3. 规范之外的副作用（例：Task 11 的 pip 安装、Task 12/13 的常驻服务、任何 `git push`）。
4. 计划本身错到「所有前进路径都是猜」（例：Task 11 得出 A/B 两路都不成立）。

其余冲突、歧义、计划缺陷：**自行裁定并留证**，不要停下来问。台账里以 `Task <N>: Ruling: <发现> — <怎么决定与为什么> — <错了代价多大>` 记录。

## 7. 已完成会话留下的裁定（后续任务必须遵守，不要重新讨论）

| # | 裁定 | 影响的任务 |
|---|---|---|
| 1 | 合法性两层取交：意图层（UI 现行规则）∧ 执行层（引擎试跑）；**费用不作门槛**（G-a 未裁） | 9, 15 |
| 2 | `probeAction` 永远只做引擎镜子，不得加规则校验 | 9, 15 |
| 3 | P3 读 `dropped` 不读 `truncated` | 9, 15 |
| 4 | 反解严格 ⇒ 调用方必须 try/catch | 15 |
| 5 | 漂移守卫要三层（枚举/候选/判定形状），且比较双方各自独立构造候选 | 9 |
| 6 | 测试局面一律来自 `tests/engine/fixtures.ts`（引擎调用构造，禁手拼 certification/council/duel） | 13, 14, 15 |
| 7 | sim 无 `--seed`；确定性回归用「默认参数重生成 + `diff`」 | 10, 14, 15 |
| 8 | 封闭词表按主题派生，勿把合规实现误判为泄漏 | 15 |
| 9 | `uiAllows` 里 `certifyChallenge ≥1` / `certifyAppeal ≥2` 两条资源镜像保留并被测试钉住 | 9 |
| 10 | `web/ui/council.ts` 的显隐必须收口到 `uiAllows`，否则 `legal-gate.ts` 头部声称超售 | 9 |
