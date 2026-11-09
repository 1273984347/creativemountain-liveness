# Laya sidecar V2 预研 · 阶段 A 回归（B53 落档）

> 落档时间：2026-11-09（B53 · 阶段 A 收尾）  
> 上游：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar-continuation.md`（Task 10）  
> 批次记录：`docs/批次/B15-B16-枚举落地与sidecar预研-执行记录.md`（阶段 A 施工）、`docs/批次/B53-*.md`（本阶段收口）

## 1. 本次回归的**判据重裁**（重要：原判据的前提已消失）

Task 10 原文的判据是「**证明 B15 未改对局行为**」⇒ 做法是「默认参数重跑 sim，与 `docs/balance-report.md` **逐字一致**」。

⚠️ **该判据的前提在本批已不成立**：B15 阶段 A 之后又经历了 **B16–B52 共 37 批**，
其中 B18 关隘接线、B24 关隘余量规则、B26 条件型试炼、B29–B32 余量阈值标定等**都刻意改变了引擎行为**。
⇒ 「与 B15 时的对局行为逐字一致」**既不可能、也不应该**成立（那等于要求后续所有批次都没改引擎）。

**重裁后的判据**：从「证明 B15 未改对局行为」改为
**「证明 sim 默认参数可复现 + 当前基线自洽」** —— 即：

- ① **可复现性**：同参数跑两次 ⇒ 输出逐字相同（确定性）；
- ② **基线自洽**：默认参数重跑 ⇒ 与**当前入库**的 `docs/balance-report.md` 逐字一致（基线没漂）。

> 这与 E71 的结论一致：「可复现」需要**实证**（逐字一致），不能靠「汇总看起来没变」。
> 而**基线自洽**是发布前的必要条件：基线与代码漂了就说明有人改了引擎却没重生成基线。

## 2. 阶段 A 回归（B53 完成时点）

### 2.1 门禁

```
== PASS：13 门全绿 ==          ← 本批自测

> ⚠️ **如实登记**：独立盲审同期实跑为 **12 / 13** —— 门 ② 内 `tests/gates/pdf-normalize.test.ts` 红，
> 单跑该文件 4/4 绿 ⇒ **跨秒时序 flake**，与本批零关联（本批未触碰 `tools/pdf-normalize.mjs`）。
> ⇒ 此处**不写成「已复现的全绿截图」**：两方实测都列出，成因仍未确定。
```

（B15 阶段 A 当时为 **10 道门**；B23/B25/B33 与 B51 又新增 3 道 ⇒ 现为 13 道。
「十道门」是计划原文的过时表述，**以实跑为准**。）

### 2.2 第 ⑨ 门逐字等价（默认参数重跑 vs 当前基线）

```
node tests/sim/run.mjs --out <临时目录>/balance-after.md   # exit=0
Compare-Object docs/balance-report.md <临时目录>/balance-after.md
→ 报告逐字一致（行数=561，差异行数=0）
```

> ⚠️ sim **没有** `--seed` 参数（`parseArgs` 只认 `--games/--check/--out/--themes/--players`），
> 每局 seed 由 `runCell` 的 `1000 + g*97 + players*13 + themeSeed` 生成 ⇒ **同参数即逐字可复现**。
> 任何命令都**不要**加 `--seed`（会被静默忽略，让人误以为换了随机流）。

### 2.3 四条常驻护栏

| 护栏 | 落点 | 状态 |
|---|---|---|
| 一致性-正向（枚举出的动作必被引擎接受） | `tests/engine/legal-probe.test.ts` | ✅ |
| 漂移守卫（**四层**：枚举层 / 候选层 / 门禁层 / **面板层**） | 同上 | ✅（面板层为 B53 新增） |
| rng 隔离（试跑不推进原 state 的随机源） | 同上 | ✅ |
| 禁止集（文本化不泄漏他人手牌 / 牌堆顺序 / 对峙暗牌） | 同上 | ✅ |

## 3. 本阶段（B53）修正与登记的既有缺陷

### 3.1 规格与代码脱节（B15 遗留，本次修正）

| # | 规格 §6.3 旧稿 | 代码真值 | 处置 |
|---|---|---|---|
| 1 | `CERTIFY_VALIDATE_QUESTION`（孤儿动作） | 已移除 | 规格删除该行并注明原因（算子零调用方） |
| 2 | 缺 `CERTIFY_APPEAL_VOTE` | 有 | 规格补入（`{actor, target, overturn}`） |
| 3 | `CERTIFY_ANSWER { questionIndex, ok }` | `{ target, passed }` | 规格更正（旧字段从未存在过） |
| 4 | `PLAY_CARD` 无 `target` | `target?: number` | 规格补上 |

⇒ **ActionType 成员数：规格 15 项 == 代码 15 项**（B18 关隘接线加了 `GATE_RESOLVE`/`BARRIER_RESOLVE`，
故**不是**原计划写的 13 项 —— 计划写于 2026-11-08，早于 B18 ⇒ **现查现用，不得照抄**）。

⚠️ 新增**机器守护（两层）**：`tests/engine/action-contract.test.ts` 的「§6.3 规格表的 ActionType 成员 == 代码」
与「§6.3 规格表的**字段形状** == 代码」（第二层补做：只比成员集合时，改字段名这一类脱节**无信号**）
⇒ 规格再脱节即红（此前只有「代码 == 契约表」一条 ⇒ **规格**脱节无人报警）。

### 3.2 粗筛「故意窄于引擎」的**第四条 → 五条**

`engine/core/legal.ts` 的注释与四条取证用例此前只登记了 **四处**
（`pendingCert` / 对峙未决 / `phase` / `isRoundEnd`）⇒ **漏登记「死亡座位」**
（`candidatesOf` 的 `alive !== true ⇒ 整表清零`，而 `performAction` 只查 `player === undefined`、**不查 `alive`**）。

⇒ B53 补：注释改「五处」+ 表格加 e 行 + 新增第 5 条取证用例（`fixtures.ts` 新增 `exiledScene()`，
用**真实引擎入口** `damage` 算子打死目标来构造出局局面，不用手拼 `alive` 字段）+ 同步四条旧用例标题。

### 3.3 山议面板旁路收口（`web/ui/council.ts`）

该文件原先**自算**「存活 ∧ 非自己」（自带一套规则）⇒ 与 `web/legal-gate.ts` 的 `uiBlockNotice` 并列两处口径，
使 `legal-gate.ts` 头部「UI 可点性的唯一来源」这句话在该文件上**不成立**。

⇒ B53 收口：渲染与点击**都**走 `uiAllows` / `uiBlockNotice`；
并把「面板可投目标集合」抽成可测的纯函数 `councilVoteTargets(state, seat)`（渲染函数需要 DOM，测试跑不了）；
新增**面板层**漂移守卫：面板可投集合 == 引擎枚举的 `VOTE` 集合。

### 3.4 缺陷登记表（逐条现查于 2026-11-09）

| # | 状态 | 说明 |
|---|---|---|
| G-a | 仍成立 | 引擎 `act` 分支既不校验也不扣 `card.cost`；UI 不拦；仅模拟器把 `cost <= resource` 当资格线 ⇒ 数字轨可免费出牌 |
| G-b | 仍成立 | 引擎 `act` 分支**不查** `pendingCert`（`move` 分支查）⇒ 待认证锁定只在调用方生效 |
| G-c | 仍成立 | `gatesPassed` 只有**读取方**（`engine/goals/registry.ts`），**无生产写入方** ⇒ 4 个 `pass_gates` 身份目标在数字轨永不可达（B18 关隘接线后仍缺） |
| G-d | 仍成立 | `certifyMutualSign` 仅 `tests/engine/live-seats.test.ts` 调用 ⇒ 双人互验在数字轨与模拟器均不可达 |
| G-e | **已修** | README 门禁表已补全（现 13 道门） |
| G-f | 仍成立 | 对峙选牌无 `Action` 成员 ⇒ 对峙未决时 `candidatesOf` 对所有座位为空 |
| G-g | 仍成立 | `resolveAppeals` 在 `engine/**` 与 `web/**` 零调用方（只有 `tests/sim/run.mjs`） |
| G-h | 仍成立 | `createInitialState` 默认 `deckSize=40`，而 8 人局需 `players × handStart = 56` ⇒ 少发牌静默 |

## 3.5 B53 追加发现并修复的**实质缺陷**（写出规格时查代码真相查出）

| # | 缺陷 | 影响 |
|---|---|---|
| X1 | `engine/core/probe.ts` 同一 switch 里两个 `case 'COMPARE'`（B18 占位 `reject` + B19 真实试跑）⇒ **占位分支永远生效** | 出牌比对通道**永远被拒** ⇒ 枚举里没有 COMPARE，而 UI 有该入口 ⇒ 「UI 与 AI 同一枚举」在关隘面破口 |
| X2 | 两条测试把「COMPARE 必拒、拒因点名 B19」**固化成预期行为** | 把 bug 写进了验收基线 |
| X3 | `web/legal-gate.ts` 的 `uiCandidates` 关隘面**只发 GATE_RESOLVE**，漏掉 15 条 COMPARE | UI 侧候选集 ≠ 引擎侧 |
| X4 | UI 侧 `uiBlockNotice` 的 COMPARE 分支不查 `gate_pay_<index>`（B24 试炼失败后改为付费） | 又一处「UI 允许 / 引擎拒绝」 |
| X5 | `driftScenes` 里**没有关隘局面**（默认棋盘是直线山道、无关隘）⇒ 关隘面在漂移守卫中**恒为空集** | X1–X4 长期无人发现（E87「空集 ≠ 有效」） |

> ⇒ B53 全部修复；修复过程中**漂移守卫当场判红**并列出两侧 17 vs 16 条 ⇒ 证明该面从空集变为真在比对。
> 新增夹具 `gateScene()`（关隘格 + 玩家位置 + 一张试炼牌进 `decks.trial`，否则试炼通道必拒）。

## 3.6 B54 · Task 11（P0 环境自检）已执行 —— **通过，路线 = A**

> 执行授权：用户 2026-11-09 明确授权「安装所需 Python 依赖并启动常驻本地服务，完成 P0 环境自检」。
> 产物：`tools/laya-sidecar/env-check.mjs` + `docs/预研/data/p0-env.md`（脚本自动生成）。

### ① 权重对拍（通过）

| 项 | 期望 | 实测 |
|---|---|---|
| 路径 | `D:/<local-libs>/laya-multilingual/model.safetensors` | 同 |
| 字节数 | 643835514 | **643835514** ✅ |
| sha256 前缀 | `9d628fd9` | **`9d628fd971b70038…`** ✅ |

### ② 解释器探测（候选② 胜出，**无跨项目耦合**）

| 候选 | laya | torch | torch 来源 | CUDA | 判定 |
|---|---|---|---|---|---|
| ② 本仓 `.laya-venv` | 0.4.21 | 2.6.0+cu124 | `D:\<local-libs>\torch-cu124\torch\__init__.py` | **true** | **采用** ✅ |
| ③ 邻居仓 venv | 0.4.21 | 2.6.0+cu124 | `D:\<other-repo>\experiments\venv\…` | true | 备选（**跨项目耦合**） |

### ③ API 面与路线判定

- `serve.create_app(router: Optional[Any] = None)` ⇒ 首参接受 router ✅
- `laya.Router.__init__(models: Optional[Dict[str, str]] = None, device, …, default='multilingual', …)` ⇒ `models` 是**模型名 → 本地路径**映射 ✅ ⇒ **A 路成立**
- `laya.load(model_id_or_path='convaiinnovations/laya', …)` ⇒ B 路亦成立（但优先 A）
- **launch 路线 = A**（官方 app 指向本地权重）

### ④ 常驻服务的**起停验证**（超出 P0 的额外实证）

按 A 路写了 `tools/laya-sidecar/launch.py`（硬绑 `127.0.0.1`、`LAYA_SERVE_PORT=8712`、进程内设 `USE_TF=0`/`HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1`/`HF_HOME=D:\<local-libs>\hf-home`）并**起停一轮**：

| 项 | 实测 |
|---|---|
| 启动 | `Uvicorn running on http://127.0.0.1:8712`，device=cuda ✅ |
| `/health` | `{"status":"ok","device":"cuda",…}` ✅ |
| 端点面 | `/health`(GET)、`/v1/route`(POST)、`/v1/systemone`(POST)、`/v1/systemone/batch`(POST) ✅ |
| **真实推理** | `POST /v1/systemone` ⇒ **200**：`choice=play:test_card_0`，概率 `{move:0.0387, ask:0.0114, play:test_card_0:0.9499}`，confidence 0.7945 ✅ |
| **本地权重确实被用上** | `routing.repo = D:\<local-libs>\laya-multilingual`；路由理由「non-Latin script (han, 100%) ⇒ English checkpoint 读不了」⇒ **A 路在真实推理上确认成立** ✅ |
| token 口径 | `input_tokens=147`、`state_tokens=91`、`truncated=false` ⇒ P3 的 token 预算读数**有真实来源** |
| 收尾 | 服务已停止、**8712 端口已释放**（常驻属 Task 12 的交付物，本批只做起停验证） |

> ⚠️ **形状要点（探针 Task 15 必读）**：`/v1/systemone` 的请求体是
> `{ state: <字符串或结构>, questions: { qid: { type: 'choice', instructions: <题面>, criteria: { <label>: <描述> } } } }`
> ⇒ **不是** `{instructions, criteria}` 平铺（那是 B15 `buildChoice` 的内部形状，**不是** HTTP 形状）。
> `questions` 的 value 缺 `criteria`（或 `type` 非 `choice`）⇒ 服务端 400/422 并**点名**缺什么。

## 3.7 B55 · Task 12 + Task 13（反代 + 常驻编排）已执行 —— **通过**

> 执行授权：用户 2026-11-09 授权「实现反代（补 CORS、对拍、SKIP 开关）与常驻编排」。
> 产物：`tools/laya-sidecar/serve.mjs`（反代）、`tools/laya-sidecar/up.mjs`（编排）、`tools/laya-sidecar/weights.mjs`（共享对拍口径）、`tests/gates/sidecar-guard.test.ts`（3 条常驻测试）、`docs/预研/data/p0-smoke-choice.json`。

### ① 反代（Task 13）

| 项 | 实测 |
|---|---|
| 端口 | `LAYA_PROXY_PORT` 默认 **8711**（绑定**硬编码** `127.0.0.1`） |
| CORS | 三头**恒带**：`access-control-allow-origin: *` / `allow-headers: content-type` / `allow-methods: POST, GET, OPTIONS`（逐字） |
| 预检 | `OPTIONS /v1/systemone` ⇒ **204** |
| 权重对拍 | `--weights` 指向字节数不符的文件 ⇒ **退出码非 0** + stderr「对拍失败」 |
| 无服务 SKIP | 上游不可达 ⇒ **503** + body `{"unavailable":true}` + **仍带 ACAO**，**进程不退** |
| 超时 | 30s（计划锁定值） |
| 决策逻辑 | **零**（只搬运：上游有响应即**原样透传**状态码与正文） |

> **共享对拍口径**：期望字节数与 sha256 前缀抽到 `tools/laya-sidecar/weights.mjs` ⇒
> `env-check.mjs`（P0）与 `serve.mjs`（反代）**共用一处**，不各写一份。

### ② 常驻编排（Task 12）

`node tools/laya-sidecar/up.mjs --weights <path>` ⇒ 一条命令拉起两层并**测量就绪秒数**：

| 阶段 | 实测 |
|---|---|
| 官方 serve 监听就绪 | **5.27s** |
| **预热（权重冷加载）** | **17.18s** |
| 反代就绪 | 1.69s |
| **总就绪** | **24.25s**（含冷加载） |

⚠️ **预热是必需的**（本批实测）：模型权重是**懒加载**的 ⇒ 第一次推理才真正加载 ⇒
冷加载耗时（**17.2s**，且实测有一次**超过 30s**）⇒ **不预热的话第一个用户请求必被反代的 30s 超时砍成 503**。
⇒ 编排在 READY 之前**主动预热一次** ⇒ 「就绪」意味着「能立刻应答」。

### ③ choice 冒烟（Task 12 Step 3）

`docs/预研/data/p0-smoke-choice.json`（原始响应）：

| 项 | 值 |
|---|---|
| `answers.act.choice` | **`move`** ✅ ∈ {move, ask} |
| `probabilities` | `{move: 0.8376, ask: 0.1624}` |
| `confidence` | 0.36 |
| `usage` | `input_tokens=129`、`state_tokens=91`、`truncated=false` |
| 经反代 vs 直连 | choice 与 confidence **完全一致**（0.068s vs 0.268s）⇒ 反代不改写决策 |

### ④ 本批修掉的两个真缺陷

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| D1 | **反代把上游的失败原因吞成沉默的 503** | 运维分不清「上游没起」「上游超时」「上游崩了」 | 区分**连接失败 / 超时 / 上游有响应但非 2xx**（后者原样透传，不折叠），并把原因写进 stderr；**加了回归锁**（测试 ② 断言 stderr 含「上游不可达」） |
| D2 | **常驻测试依赖环境状态** | 测试 ② 假设「上游恰好没在跑」⇒ 本批验证时编排进程正占着 8712 ⇒ 断言「503」失败 ⇒ **用例与环境耦合** | 显式指向**专用死端口 18999** ⇒ 结果与环境无关（实测：编排在跑时仍 3/3 绿） |

> ⚠️ D2 是本批的第二个「纪律用在自己头上」：上一批刚立下「不能靠环境恰好如何」，
> 转头就写了一条依赖环境的用例。

## 3.8 B56 · Task 14（sim 决策点记录器）已执行 —— **通过**

> 执行授权：用户 2026-11-09 授权「实现 sim 决策点记录器（`--record-decisions`，默认关闭且报告逐字不变）」。
> 产物：`tests/sim/run.mjs`（`--record-decisions`）、`tests/gates/sim-record.test.ts`（3 条常驻测试）、`docs/预研/data/decisions-sample.jsonl`（**小样本** 2 条 / 120 KB）。
>
> ⚠️ **完整记录不入库**：2 局的完整 JSONL 实测 **8.22 MB**（每条含全量 state）⇒ 超过仓内
> 「已入库文件 ≤ 2 MB」纪律（B51 的扫描盲区守卫）⇒ **门 ② 会判红** ⇒ 完整文件按**生成物**处理
> （`docs/预研/data/decisions-*.jsonl` 已进 `.gitignore`），仓内只留小样本作**格式契约**。
> 重新生成命令：`node tests/sim/run.mjs --themes xianxia2026 --players 4 --games 2 --record-decisions docs/预研/data/decisions-smoke.jsonl --out <tmp>.md`。

### ① 两个不变量（都被常驻测试钉住）

| 不变量 | 实测 |
|---|---|
| **报告逐字不变**（判据是**文件 diff 为空**，不是 stdout） | 带开关与不带开关跑同一组参数 ⇒ 报告**逐字相同** ✅ |
| **默认关闭** | 不带开关 ⇒ **不产出任何 JSONL**、报告照常生成、sim 退出码 0 ✅ |
| 默认路径开销 | `record()` 首行即 `return -1` ⇒ **零开销、零产物** |

### ② 记录格式（11 个字段，顺序固定）

`seq`（**从 0 开始 ⇒ seq == 行号**）· `themeId` · `players` · `seed`（**本局**的 seed）· `round` · `turnIndex` · `seat` · `phase` · `face` · `heuristic` · `state`（`stateToJson` 文本）

> ⚠️ **`face` 是引擎产生的骰面点数**（move ⇒ 移动骰 1–6；ask ⇒ 指令骰 1–20；无骰面的决策点 ⇒ `null`）
> ⇒ 它在**动作执行后**才有 ⇒ 记录时先占位、动作后**回填该条的 face**（只改记录字段，不改 state 与决策）。

### ③ 十个决策点（现查现用：计划写「九个」但列举了 11 类 ⇒ 以代码为准）

| # | 决策点 | `heuristic` 形状 |
|---|---|---|
| 1 | 山议落票 | `vote:<座>` |
| 2 | 认证签印 | `cert:sign:<座>` |
| 3 | 认证质疑 | `cert:challenge:<座>` |
| 4 | 认证判定 | `cert:answer:<座>:pass\|fail` |
| 5 | 认证复议申请 | `cert:appeal:<座>` |
| 6 | 认证复议票 | `cert:appealvote:<座>:overturn\|uphold` |
| 7 | 被动发动 | `ability:<op>`（需目标时带 `-><座>`） |
| 8 | 行棋 | `move` |
| 9 | 问天 | `ask` |
| 10 | 出牌 | `play:<cardId>` / `play:<cardId>-><座>` |

实测（5 人 × 30 局 ⇒ 2000+ 条）**十类全部有数据**，含复议与复议票。

> ⚠️ **对峙选牌记不到**：它由引擎的 `autoResolveDuel` **内部**决定 ⇒ sim 侧拿不到「模型选了什么」；
> 另发现 `run.mjs` 里的 `pickDuelCard` 是**死代码**（定义了从未被调用）⇒ 一并登记为遗留。

### ④ ⚠️ 可见性红线（喂模型前必读）

`state` 字段是 `stateToJson(state)` 的**全量**状态 ⇒ **含 rng 内部状态**（`initialSeed` / `s`）
⇒ **直接把它喂给模型，模型就能预测后续随机流**。
⇒ 本文件是**本地中间产物**；喂模型前**必须**经 `tools/laya-probe/state-text.mjs` 的可见性受限文本化（它只取公开字段、**不读 rng**）。

## 3.9 B57 · Task 15（影子决策探针 P1/P2/P3/P6）已执行 —— **通过**

> 执行授权：用户 2026-11-09 授权「实现影子决策探针（P1/P2/P3/P6），并先解决峙面启发式不可观测问题」。
> 产物：`tools/laya-probe/run.mjs`（探针）、`engine/core/duel.ts` + `engine/core/advance.ts`（**只读**观测回调）、`tests/sim/run.mjs`（对峙观测）、`tests/engine/legal-probe.test.ts`（词表按主题派生 + 真实主题场景）。

### ① 峙面启发式**不可观测**问题 ⇒ 已解决

| 项 | 事实 | 处置 |
|---|---|---|
| 根因 | 对峙在**同一次 `advanceAuto` 内**立起并结算（`engine/core/advance.ts`）⇒ 「对峙未决的局面」从外部**只存在一瞬、不可得**；且选牌策略在引擎内部 ⇒ 调用方拿不到「启发式选了什么」 | 引擎加**只读观测回调** `onDuelPick(seat, cardId, stateAtPick)`（`autoResolveDuel` → `advanceAuto` 的 `opts` 透传）⇒ **不改 state / 不改 log / 不改任何行为**（报告**逐字不变**已实测） |
| 观测结果 | 12 局样本里取到 **10 条** `duel_card:<牌id>`（双方各一条） | 探针读数里「对峙未决」**7 条** ⇒ 观测**确实生效** |
| ⚠️ 语义边界 | 对峙期 `candidatesOf` **整表清零**（G-f）⇒ **没有候选** ⇒ 模型无题可问 | 这些样本**进 `noLegalActions` 桶**、**不参与** P1/P6 的对比（并列出原因） |

### ② 读数（4 人 + 8 人混合采样 240 条）

| 读数 | 值 | 判据 | 结论 |
|---|---|---|---|
| **P1** answerRate | **100%**（232/232） | ≥99% 拿到 choice 且 key 反解成功 | ✅ |
| **P1** illegal | **0 例** | 非法提交 0 例 | ✅ |
| **P1** errors | 0 | — | ✅ |
| **P1** 分桶 | 无候选 **8** 条：**对峙未决 7 + 待认证锁定 1** | 单独计数并列出原因 | ✅ |
| **P2** p50 / p95 | **50 ms / 63.45 ms** | GPU p95 ≤ 300 ms | ✅ **达标** |
| **P3** maxCandidates / mean | **51 / 15.1** | — | — |
| **P3** **dropped 之和** | **0** | 只有 `dropped` 非 0 才下调 `LEGAL_ACTION_CAP` | ✅ **不需下调** |
| **P6** agreeRate | **40.52%**（94/232） | 与启发式一致的比例 | 启发式是简单规则 ⇒ 分歧大属预期；**不构成缺陷** |

> ⚠️ **判据未被改**：P1/P2/P3/P6 的口径按计划写死，结果照实记（E99 的纪律）。

### ③ 本批抓到的三个真缺陷

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| D1 | `describeAction` **漏了** `GATE_RESOLVE` / `BARRIER_RESOLVE`（B18 引入的关隘/裂隙通道） | 遇到它们直接抛「未知动作类型」⇒ `buildChoice` 崩 ⇒ **探针在 8 人局（关隘更常出现）整个崩掉** | 补两个分支（语义照规格 §3.5 / §3.4 定案） |
| D2 | 泄漏守卫的**词表**只按 ASCII 测试主题校准 | 真实主题的**间隔号牌名**（「御风·远」分词成两段 ⇒ 整段入表匹配不上）与 **8 种被动 op**（词表只列 2 种）⇒ **合规实现被误判为泄漏** | 词表**数据侧从主题包派生**（牌名按同一 token 规则分段 + 被动 op 全集）并新增**真实主题场景**的常驻断言 |
| D3 | 决策点 JSONL **94 MB / 222 MB** | 超仓内 2 MB 上限（E107） | 按生成物处理（已在 `.gitignore`）；仓内留 `probe-raw.json`（0.1 MB） |

### ④ 探针的纪律（逐条落地）

- **严格反解入 try/catch**：畸形 key 计成「未回答 + err」，不让脚本崩；
- **可见性红线**：喂模型的 `state` 一律经 `describeState`（受限文本化）⇒ **绝不**送记录里的全量状态（含 rng 内部状态）；
- **分桶**：`noLegalActions` 样本单独计数**并列出原因**（对峙未决 / 待认证锁定 / 非行动阶段）；
- **P3 读 `dropped`**（不是 `truncated`）⇒ 汇总同时给 `dropped` 之和与 `truncated` 计数；
- **采样排除小样本**：`decisions-sample.jsonl` 只有 2 条 ⇒ 会被字典序掺进正式读数 ⇒ 排除；
- **4 人与 8 人轮流取** ⇒ 否则后一个文件一条都进不来（读数只代表一种规模）。

## 4. 阶段 B（B16 · Task 16–17）仍未开始## 4. 阶段 B（B16 · Task 15–17）仍未开始## 4. 阶段 B（B16 · Task 14–17）仍未开始## 4. 阶段 B（B16 · Task 11–17）仍未开始## 4. 阶段 B（B16 · Task 11–17）仍未开始

**阻塞**：Task 11 Step 2 需新建 `.laya-venv` + `pip install laya[serve]`（走网络、GB 级磁盘）；
Task 12 Step 2 起常驻本地服务 ⇒ **两项都必须先取得用户同意**（续作计划 §「外向副作用确认点」）。

⇒ P0–P6 读数**全部未跑**；三条可行性判定（接线 / 延迟 / 浏览器）**未出结论**；
**不得在没有读数时先写结论**。
