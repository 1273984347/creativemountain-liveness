# Laya sidecar V2 预研 · 设计（B15 §7 枚举落地 + B16 sidecar 探针）

> 日期：2026-11-08｜状态：待复核｜切分与红线见 `2026-11-08-creativemountain-ai-prespike-overview.md`
> 本文覆盖 B15 与 B16。**B14 关隘接线不在本文范围**（它改对局行为，需独立的平衡验收设计）。

## 1. 范围与非目标

**做**：把规格 §7 的「UI 与 AI 使用同一枚举」落成可机械验证的契约；建一个本地 Laya sidecar 与影子决策探针，量出接线的可行性、延迟、token 预算与浏览器可达性。

**不做**：AI 强度、AI 驱动对局、发布包内任何增量、`npm run gate` 内任何模型调用、sim 决策逻辑改动、关隘接线（B14）、`pass_gates` 目标修复（B14）、出牌费用语义裁定（G-a，待 B14 一并裁）、引擎侧 `pendingCert` 加固（G-b，仅登记，见 §6-3）。

## 2. 架构总览

```
                    ┌─ 127.0.0.1:8712  laya-serve（官方 FastAPI，不动一行）
  Node 探针 ────────┤
  tools/laya-probe  └─ 127.0.0.1:8711  Node 反代（本项目唯一新增服务代码）
       ▲                              │ 绑环回 · CORS/OPTIONS · sha256 对拍
       │                              │ 超时 · 无服务 SKIP · 请求日志
  浏览器探针（file:// 发布的单文件 HTML）─┘
                    │
  引擎侧（B15）：engine/core/legal.ts 试跑式枚举 → 动作 key ↔ Action 可逆映射 → 文本化器
```

数据流（影子决策，模型不驱动对局）：

`tests/sim/run.mjs --record-decisions`（默认关闭）→ 落盘决策点 `{stateId, serializedState, heuristicChoice}` → 探针逐点重放：`getLegalActions` → 文本化 → `/v1/systemone` `choice` → key 反解 → 记录 `{layaChoice, confidence, latency, tokens}` → 汇总 P1–P6 读数。

采用影子决策而非注入策略的原因：注入策略要把 sim 的决策权交给模型，等于重写一份回合机（两份真相源、立刻漂移），且模型一旦参与对局路径就触碰红线 1。影子决策在**同一状态**上比较两种选择，顺带免费得到 P6 分歧率。形态与 GateKeeper `t3-shadow-real-batch` 先例同构。

## 3. B15 · §7 枚举落地

### 3.1 现状：三层真值不一致（实测）

| 规则 | 规格 | 引擎执行器 | sim | UI |
|---|---|---|---|---|
| 出牌费用 | §3.1 未写支付（付费仅见于 §3.5） | 不校验、不扣（`turn-runner.ts:221-232`） | 当门槛 `c.cost<=resource`（`run.mjs:232`） | 不校验，仅显示（`web/ui/hand.ts:24`） |
| 待认证锁定 | §5.1 | `move` 拦、`ask`/`act` 不拦 | 主动过滤 motion 牌 | 禁用整块行动区（`main.ts:302`） |
| 攻击牌需目标 | ✓ | 校验，无 target ⇒ 不出牌 | 靠 `pickTarget` | 点击选择 |

结论：试跑（引擎背书）与意图（规格 + 现行调用方约定）**必须取交集**，缺一即错。

### 3.2 Action ↔ 执行入口 ↔ 枚举决策（13 类逐条）

拒绝表达有三种，试跑判据必须分别适配：

- `performAction(...)` 无返回标记 ⇒ **返回引用 `=== state` 即非法**（各拒绝分支均为 `return state`）
- `performAbility` / `castVote` / `certify*` 返回 `{ok, state, note?}` ⇒ 取 `ok`，`note` 作 reason
- `PASS` 不是 `performAction` 的动作 ⇒ 执行即 `advanceTurn`，判据为 `turnIndex` 或 `round` 是否推进

| Action 类型 | 执行入口 | 实际调用方 | 本批枚举 |
|---|---|---|---|
| `MOVE{steps}` | `performAction(s,seat,'move')` | UI + sim | ✅（`steps` 恒 0，步数由骰子定，玩家不可选） |
| `PLAY_CARD{cardId}` | `performAction(s,seat,'act',{cardId,target?})` | UI + sim | ✅ 新增 |
| `ABILITY{abilityId,target?}` | `performAbility(s,seat,target?)` | UI + sim | ✅ 新增 |
| `ROLL_WHEEL{actor}` | `performAction(s,seat,'ask')`（`rollD20`+`applyInstruction`） | UI + sim | ✅ 新增（类型名与入口语义不对齐，登记为命名债，本批不改名） |
| `PASS{actor}` | `advanceTurn(s,mode)` | UI + sim | ✅ |
| `VOTE{target}` | `castVote(s,actor,target)` | UI + sim | ✅ 保留 |
| `CERTIFY_SIGN/CHALLENGE/ABSTAIN{target}` | 同名函数 | UI + sim | ✅ 保留 |
| `CERTIFY_APPEAL{target}` | `certifyAppeal(s,actor,target)` | UI + sim | ✅ 保留 |
| `CERTIFY_ANSWER{questionIndex,ok}` | `certifyAnswer(s,actor,target,passed)`（`certification.ts:157`） | UI + sim | ✅ **新增枚举**，并修正字段契约：`{actor,target,passed}` 贴合唯一真实入口（`questionIndex` 全仓无消费者）。属 Action 契约变更，需同步规格 §5.3 附表与门 ③ |
| `CERTIFY_VALIDATE_QUESTION{target,valid}` | `certifyValidateQuestion(...)` **全仓零调用方** | 无 | ❌ **从枚举移除**（枚举一个执行不了的动作） |
| （缺）`CERTIFY_APPEAL_VOTE` | `certifyAppealVote(s,actor,target,overturn)`（`certification.ts:228`） | sim 在用、UI 未接 | ➕ **新增类型并枚举**。顺带暴露数字轨缺陷：玩家能在 UI 申请复议，却投不了复议票 |
| `COMPARE{cardId,target}` | 无入口（`engine/core/gate.ts` 全仓零引用） | 无 | ❌ 待 B14 给出 `passGate(s,seat,{via})` 单一入口后并入 |

附带登记：`certifyMutualSign`（§5.5 双人互验）仅 `tests/engine/live-seats.test.ts` 调用，数字轨与 sim 均未接线 —— 与关隘、对峙同类的第五个「有实现未接线」，归入缺口清单，不在本批处理。

### 3.3 试跑式枚举的实现约束

`getLegalActions(state, playerId): Action[]` **签名不变**（§7 与 `b3.test.ts` 已依赖）。内部改为三段式：候选粗筛 → rng 隔离试跑 → 判定收集。

rng 隔离：State 并非深度不可变，`rng` 是可变类实例（`dice.ts` 的 `next()` 写内部 `s`，`readonly rng` 只锁引用）。因此探针 state 必须携带**新建**的 `Rng.fromSnapshot(state.rng.initialSeed, state.rng.snapshot())`，原实例天然不被触碰。配套常驻测试断言：枚举前后 `state` 引用字段与 `state.rng.snapshot()` 逐字不变——这是门 ⑨ 确定性的护栏。

候选粗筛（仅为防止笛卡尔爆炸，合法性由试跑裁定）：出牌 = `player.hand` ×（`cardNeedsTarget(card)` ? `targetCandidates(state,seat)` : [无目标]）；被动 = `abilityAvailability(state,seat)`（`passives.ts:89`）+ 需目标者走 `targetCandidates`；认证/山议 = 沿用现有粗筛。候选数超过 **64** 时按稳定顺序截断并计数上报（对齐官方 serve 的 `MAX_CHOICE_OPTIONS=100` / `MAX_TOTAL_OPTIONS=512`，留余量）。

### 3.4 UI 门禁下沉

`web/legal-gate.ts`（新）导出纯函数 `uiAllows(state, seat, action): boolean`，把现在内联在 `renderActions` / `hand.ts` 里的「可点性」判断（存活、对峙阻塞、待认证锁定、三选一）收敛为唯一来源，UI 改为消费它。目的只有一个：让「UI 允许的动作集合 == getLegalActions 结果」这条**漂移守卫**写得出来。下沉过程**不得**改变 UI 现有可见行为（费用门槛维持现状，属 G-a 待裁，如需改动须显式另行裁定）。

### 3.5 测试

进 `npm test`（纯 TS，不依赖模型）的常驻四条：

1. **一致性-正向**：枚举出的每个动作，按对应入口试跑必 `ok`。
2. **一致性-反向**（漂移守卫）：若干 fixture 上 UI 允许集合与枚举集合相等。
3. **rng 隔离不变性**：枚举前后 state 引用与 `rng.snapshot()` 不变。
4. **可见性禁止集**：文本化输出中不得出现他人手牌 / 牌堆顺序 / `duel.pickA` / `duel.pickB` 的字样。

`tests/engine/b3.test.ts:303-331` 现有四条枚举断言：若与试跑语义冲突，**以引擎执行为准**并修订断言（口径变更，进门 ③）。`tests/sim/run.mjs` 只加默认关闭的 `--record-decisions` 开关（纯记录，不参与决策、不掷骰），默认路径逐字不变；门 ⑨ 以现有 720 局冒烟重跑作回归背书，关键读数须与 `docs/balance-report.md` 一致。

## 4. B16 · sidecar 与探针

### 4.1 官方 serve 的已验证事实（2026-11-08 实测）

`laya 0.4.21`（Apache 2.0），入口脚本 `laya-serve = laya.serve:main`。路由：`POST /v1/systemone`、`POST /v1/systemone/batch`（≤64 states）、`POST /v1/route`、`GET /health`；`LAYA_API_KEY` 可选 bearer；`LAYA_HOST` **默认 `0.0.0.0`**、`LAYA_PORT` 默认 8000。上限：`MAX_CHOICE_OPTIONS=100`、`MAX_QUESTIONS=64`、`MAX_TOTAL_OPTIONS=512`、`MAX_STATE_CHARS=50000`。**`create_app` 中无 CORS 中间件**（`add_middleware` / `allow_origin` 全无）⇒ 浏览器 `file://`（opaque origin + JSON POST 必预检）直连必然失败，这是可断言的事实而非待测项。依赖 fastapi/uvicorn 当前未装，PyPI 直连可用（2026-11-08 测得 `pypi.org` 返回 200）。模型侧：`rl_agent_config.json` 为 `max_len=1024` / `head_max_len=256` / `max_prefixes=6`，编码器 `jhu-clsp/mmBERT-base`（ModernBERT，22 层、hidden 768、vocab 256000），权重 `D:\<local-libs>\laya-multilingual\model.safetensors` 共 643,835,514 字节，sha256 `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`（同目录 `.sha256` 文件为镜像对拍依据）。

### 4.2 反代（`tools/laya-sidecar/serve.mjs`）

Node 内置 `http`，约 60 行，职责固定：绑 `127.0.0.1:8711`；`OPTIONS *` 应答 + 对所有响应补 `Access-Control-Allow-Origin`（`file://` 请求头是 `Origin: null`）与 `Access-Control-Allow-Headers`；转发 `/v1/systemone`；启动前对拍权重 sha256，不符即拒绝启动；请求超时与错误统一折叠为 `{unavailable:true}` 以便调用方 SKIP。`LAYA_HOST=127.0.0.1` 由反代在 spawn 子进程时注入，绝不依赖官方默认值。端口 8711/8712 避开 GateKeeper 占用的 8000。

### 4.3 环境与启动纪律

- `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、`USE_TF=0`（防 transformers/TF abseil 死锁，GateKeeper `t1_bench.py:7` 先例）。
- 锁版本：`laya==0.4.21` + 固定模型 revision；反代依赖官方 serve 的无 CORS 行为属版本事实，升级须重跑 P4。
- 本机既有纪律：`D:\<local-libs>\torch-cu124` 通过 user site 的 `_torch_drive.pth` 挂载，仅对 Python 3.12 生效；`sentence_transformers` 必须先于 `torch` 导入，否则进程 ACCESS_VIOLATION（本项目不导入 ST，但 P0 需确认 venv 内 torch 来源，避免半坏环境）。
- **P0 决策树（venv 三选一）**：新建 venv 带 `--system-site-packages`，若 `import torch` 落到 `D:\<local-libs>\torch-cu124` 且 `cuda.is_available()` 为真 ⇒ 走它（零额外磁盘，符合本机 D 盘托管设计）；若 venv 内 user site 未被处理 ⇒ 临时复用 `D:\<other-repo>\experiments\venv`（已含 torch 2.6.0+cu124 与 laya 0.4.21，`include-system-site-packages = false`）并在报告里登记跨项目耦合；全量新建 venv 装 torch（约 4.4GB）仅在前两者都不成立时考虑。

### 4.4 决策题构造与可逆映射

每手一个 `choice` 题：`criteria` 的 key = 探针生成的**稳定动作 id**，value = 一句话语义。id 文法（唯一、可逆、不含自由文本）：

```
move · ask · pass · play:<cardId> · play:<cardId>-><seat>
ability:<abilityId> · ability:<abilityId>-><seat> · vote:<seat>
cert:sign:<target> · cert:challenge:<target> · cert:abstain:<target>
cert:answer:<target>:<pass|fail> · cert:appeal:<target> · cert:appealvote:<target>:<overturn|uphold>
```

回传只取选中 key 与置信度，用 key 反解为 `Action` 后交对应入口执行 ⇒ 不解析模型输出文本（Laya 本身不生成文本）。置信度分布落盘，供 V2 判断是否需要阈值或降级策略。

### 4.5 文本化器与可见性红线

`tools/laya-probe/state-text.mjs`：输入 state + seat，输出 `state` 描述文本与 `criteria` 文本，二者合计受 token 预算约束（`head_max_len=256` / `max_len=1024`）。做法是把可见性做成**硬约束而非约定**：文本化器只接受显式标注为公开的字段，禁止集（他人手牌、牌堆顺序、`duel.pickA/pickB`）在类型上不可达，并由 §3.5 第 4 条测试断言输出文本不含禁止字样。公开集：棋盘格位与地形、各家资源/HP/位次/身份/阵营、认证 pending 与票数、山议已投票、自己手牌、已公开的关隘试炼牌、本局日志摘要。

### 4.6 探针读数与判据（P0–P6）

| # | 读数 | 采样 | 通过线 | 不达标的含义 |
|---|---|---|---|---|
| P0 | 环境自检 | venv 决策树 + CUDA + sha256 对拍 + `laya-serve` 启动 | 全过 | 停在环境层，先修环境不出结论 |
| P1 | 端到端打通率 | 4 主题 × 3–8 人，决策点目标 ≥100、上限 300；超 300 时按时序等距抽样 | ≥99% 拿到 choice 且 key 反解成功，**非法提交 0 例** | 枚举契约有洞，先补 B15 |
| P2 | 延迟 | CPU / GPU 分别测加载耗时与 p50/p95 | GPU p95 ≤300ms、CPU p95 ≤1.5s | 只能做异步预研，进不了真人桌局 |
| P3 | token 预算 | 每面候选数 mean/p95/max、文本长度分布 | 默认候选阈值下截断率 = 0 | 下调候选上限，顺带定出 V2 的候选数上限 |
| P4 | 浏览器可达性 | `file://` 打反代 :8711 | 通；或给出失败层次（OPTIONS 405 / 缺 ACAO / PNA 预检 / 混合内容）与代价结论 | 结论改为「V2 必须走 http 预览，放弃双击即玩」 |
| P5 | 无服务降级 | 反代与服务都不在 | SKIP、退出码 0、十道门零污染 | 隔离没做到，返工 |
| P6 | 分歧率（附带，不设判据） | Laya 选择 vs 同状态启发式选择 | 只记录 + 前 20 条分歧样本画像 | ——强度不在本批，但这是「值不值得做 B15 完整版」最便宜的信号 |

P4 复用第 ⑩ 道门骨架：`tests/e2e/duel-e2e.mjs` 已用 headless chromium 打开 `file:///` 构建产物（第 24-33 行），浏览器探针在同一 harness 内加一段 `page.evaluate(fetch)` 即可，不必新增测试基建。

### 4.7 交付物

```
tools/laya-sidecar/serve.mjs        反代 + 对拍 + 子进程生命周期
tools/laya-probe/state-text.mjs     可见性受限的文本化器
tools/laya-probe/run.mjs            P0–P3、P6 读数
tools/laya-probe/browser.mjs        P4（file:// 探针）
tools/laya-probe/skip.mjs           P5（无服务自证）
engine/core/legal.ts                试跑式重写 + 契约表
web/legal-gate.ts                   UI 门禁下沉
tests/engine/legal-probe.test.ts    常驻四条
tests/sim/run.mjs                   仅新增 --record-decisions（默认关）
package.json                        sidecar:laya / probe:laya / probe:laya:browser
docs/预研/2026-11-08-laya-sidecar.md  读数报告（raw JSON 同目录入仓）
```

`.gitignore` 追加 venv 与模型缓存目录；Python 依赖不写入 `package.json` / `package-lock.json`；`esbuild.config.mjs` 与 `build/build-package.mjs` 不得引用上述任何新文件。

## 5. 门禁影响矩阵

| 门 | 影响 | 处置 |
|---|---|---|
| ① 类型 | `legal.ts` 重写、`web/legal-gate.ts`、`CERTIFY_ANSWER` 字段变更、新增 `CERTIFY_APPEAL_VOTE` | 必须全绿 |
| ② 测试 | 新增常驻四条 + `b3.test.ts` 断言可能修订 | 全绿；负样本纪律延续 B13 |
| ③ 文档口径 | `SPEC_PATH` 固定指向主规格，新文档不参与比对；需改主规格 §5.3 附表与 §7 措辞（当前那句「UI 与 AI 使用同一枚举」是 aspirational） | 主规格改动须与代码同批 |
| ④ 构建 / ⑩ E2E | 构建产物零增量；E2E 仅被 P4 复用骨架，门 ⑩ 本身不变 | 逐字不变 |
| ⑤⑥⑦⑧ 主题/IR/双轨/差异化 | 不涉及 | 不变 |
| ⑨ 规模与平衡 | sim 默认路径未改 | 重跑，关键读数须与现有 `docs/balance-report.md` 一致 |

## 6. 风险登记（按危险度）

1. **G-c `gatesPassed` 无写入方 ⇒ 四身份目标永不可达**。线上缺陷，B14 不落地就一直挂着；预研报告须显式催办。
2. **G-a 出牌费用四方不一致**（§3.1）。意味着数字轨玩家现在能免费出牌。本批只登记，建议随 B14 裁定。
3. **G-b 待认证者可用位移牌绕过 §5.1**（引擎 `act` 不检查，仅靠 UI 禁用行动区挡着）。**本批仅登记、不修**（§1 非目标）。修复路径已明确：`turn-runner.ts` 的 `act` 分支补 `pendingCert` 检查 ⇒ sim 本就过滤 motion 牌、UI 本就禁用行动区，两者都不提交该动作，行为近似不变，由门 ⑨ 回归比对背书。成本极低，批次执行时你若要收进 B15，说一句即可。
4. **`choice` 题型在 20+ 选项上的表现未验证**（`max_prefixes=6`、`head_max_len=256` 均为约束）。若 P3/P6 显示不行，V2 须改为分层决策（先选面再选牌）——该结论由 P3 候选分布 + P6 分歧率共同支撑。
5. **反代依赖官方 serve 的无 CORS 事实**：升级 laya 版本须重跑 P4；已用锁版本 + 固定 revision 收敛。
6. **CPU 推理可能慢到不可用**：P2 判据直接给结论，不做乐观假设（官方宣称 ~33ms 属 GPU 单次前向）。
7. **跨项目 venv 耦合**：若 P0 判定复用 GateKeeper venv，须在报告中登记「对方升级或删 venv 会打断本预研」。
8. **回滚面**：`tools/laya-*`、`web/legal-gate.ts` 可整体摘除；唯一需谨慎回滚的是 `legal.ts` 重写，由常驻四条兜底。

## 7. 本批完成的定义

P0–P6 全部有读数、预研报告落盘并给出三条判定（接线 / 延迟 / 浏览器）、常驻四条测试进 `npm test` 且绿、`npm run gate` 十道全绿且第 ⑨ 门关键读数与既有基线一致、发布包内容物与 `dist/` 逐字不变（红线 2 自证）。**不包含**：AI 强度结论、sidecar 进产品、关隘可玩。
