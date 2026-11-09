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

## 4. 阶段 B（B16 · Task 11–17）仍未开始## 4. 阶段 B（B16 · Task 11–17）仍未开始

**阻塞**：Task 11 Step 2 需新建 `.laya-venv` + `pip install laya[serve]`（走网络、GB 级磁盘）；
Task 12 Step 2 起常驻本地服务 ⇒ **两项都必须先取得用户同意**（续作计划 §「外向副作用确认点」）。

⇒ P0–P6 读数**全部未跑**；三条可行性判定（接线 / 延迟 / 浏览器）**未出结论**；
**不得在没有读数时先写结论**。
