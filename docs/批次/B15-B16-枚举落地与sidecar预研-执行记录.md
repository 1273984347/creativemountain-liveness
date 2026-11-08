# B15/B16 — §7 枚举落地 + Laya sidecar 预研 执行记录

> 状态：**阶段 A（B15）已完成并逐个审查通过；阶段 B（B16）未开始**（用户 2026-11-08 指示 T8 收尾即停）。
> 续作执行文档：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar-continuation.md`（Task 9–17，含对原计划 9 处错误期望的更正）
> 上游：设计 `docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`
> 总纲：`docs/superpowers/specs/2026-11-08-creativemountain-ai-prespike-overview.md`
> 原计划：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md`（Task 1–8 的代码原文保留在此）

## 1. 目标

起点是「给本项目加 Laya 判断模型 sidecar，做 V2 预研」。探上下文后收敛为三问，**只答工程可行性，不答强度**：

| # | 问题 | 出口 |
|---|---|---|
| ① | 引擎状态能否喂给本地判断模型、再稳定回解成合法动作 | P1 / P2 / P3 |
| ② | 规格 §7「UI 与 AI 使用同一枚举」能否变成可机械验证的契约 | 四条常驻测试 |
| ③ | `file://` 双击即玩的单文件数字轨能否叫到本地模型而不破坏离线承诺 | P4 |

## 2. 裁定（用户拍板）

> 执行期由控制器作出的 10 条裁定（含「不放宽断言而是补 surface」「严格规范形反解」「P3 读 dropped」等）逐条记录在
> 续作计划 §7「已完成会话留下的裁定」；台账里另有每条的代价说明。

| 议题 | 裁定 | 影响 |
|---|---|---|
| 预研首要问题 | 先答工程可行性（非强度、非裁判） | 判据表 P0–P6 |
| 接线终点 | 两段都要：Node 为主，浏览器只做探针 | Task 16 |
| 关隘这一面 | **本批一起接线** ⇒ 探明其改对局行为后**单独成批 B14**、单独 spec | 计划不含关隘实现 |
| 枚举合法性来源 | **意图层 ∧ 执行层两层取交**（纯试跑不够：引擎不校验费用） | Task 5 / Task 7 |
| UI 门禁 | 下沉为 `web/legal-gate.ts` 独立表达 + 漂移守卫 | Task 7 |
| G-a / G-b | 只登记不裁定（G-b 修复成本极低，执行时可一句话收进） | §3、§9 |
| sidecar 形态 | 两跳：官方 `laya.serve` 应用（不动一行）+ Node 反代（补 CORS/对拍/SKIP） | Task 12 / 13 |
| 探针方式 | **状态采样 + 影子决策**，模型不驱动对局（避免第二份回合机与污染第 ⑨ 门） | Task 14 / 15 |

## 3. 探上下文时查实的问题

**架构级**

| # | 事实 | 证据 | 处置 |
|---|---|---|---|
| ① | `getLegalActions` 只枚举 13 类里的 8 类，缺 出牌/被动/问天/关隘/认证作答；UI 与 sim 都不调用它 | `engine/core/legal.ts:11-68`、`engine/core/action.ts:24-36`、`web/main.ts:243`、`tests/sim/run.mjs:240` | B15 |
| ② | `CERTIFY_VALIDATE_QUESTION` 对应算子**全仓零调用方**，却被枚举 | `engine/core/certification.ts:305` | 移出契约 |
| ③ | `certifyAppealVote` 被 sim 使用，却没有 Action 类型；UI 也投不了复议票 | `engine/core/certification.ts:228`、`tests/sim/run.mjs:136` | 新增 `CERTIFY_APPEAL_VOTE` |
| ④ | 旧手写镜像把 `CERTIFY_APPEAL` 的 target 写成「别人」，而引擎要求 `target === actor` | `engine/core/legal.ts:31-37` ↔ `certification.ts:206-222` | 纠正并留证 |
| ⑤ | `certifyAnswer` 无重复判定守卫（`judgments` 以判定人为键）⇒ 去重只能由粗筛承担 | `certification.ts:157-178` | 粗筛承担 |

**缺陷级（登记，不在本批裁）**

| # | 缺陷 | 后果 |
|---|---|---|
| G-a | 出牌费用四方不一致：规格 §3.1 未写支付、引擎不校验不扣、UI 不拦、仅 sim 当资格线 | 数字轨可以免费出牌 |
| G-b | 引擎 `act` 分支不检查 `pendingCert` | 待认证者可用位移牌绕过 §5.1 锁定（现仅靠 UI 禁用行动区挡） |
| G-c | `gatesPassed` 无写入方，而四套主题各有一个身份目标是 `pass_gates`；关隘逻辑 `engine/core/gate.ts` 全仓零引用 | **4 个身份目标永不可达**，关隘在数字轨不可达（与 B13 之前的对峙同形）；修复归 B14 |
| G-d | `certifyMutualSign`（§5.5 双人互验）仅测试调用，数字轨与 sim 未接线 | 双人互验在数字轨不可达 |
| G-e | README 门禁表漏第 ⑩ 道（浏览器 E2E） | 文档口径缺口，Task 9 补 |
| G-f | 对峙选牌 `submitDuelCard` 没有 `Action` 成员；对峙未决时行动面整体关闭 ⇒ `candidatesOf` 对所有座位为空 | 真人要选暗牌的时刻，AI/sidecar 拿到空动作表；Task 9 登记，V2 决定 |
| G-g | `resolveAppeals` 在 `engine/**` 与 `web/**` 零调用方（只有 `tests/sim/run.mjs`），`applyAppealOutcome` 不清 `appealed` | 新增的复议票写进一个没人关闭的窗口 |
| G-h | `createInitialState` 默认 `deckSize=40`，而 `dealInitialHands` 需要 `players × handStart`（8 人 = 56）；`drawCards` 空堆无警告地停 | 高人数下座位手牌静默偏少；`tests/engine/exile-floor.test.ts` 等既有测试踩此坑 |

## 3+. 执行中新查实并已在代码里纠正的（都有常驻测试钉住）

| # | 查实内容 | 纠正落在哪个提交 |
|---|---|---|
| ⑥ | `CERTIFY_APPEAL` 的旧手写镜像把 target 写成「别人」，而引擎要求 `target === actor`（本人申请、需 2 资源）⇒ 枚举出的动作必被引擎拒 | `0009643` |
| ⑦ | `certifyAnswer` **没有**重复判定守卫、且 `judgments` 以判定人为键 ⇒ 判定去重只能由粗筛承担；同时判定权只属于「已质疑且未判定」的座位 | `0009643` |
| ⑧ | `PASS` 的原判据「turnIndex/round 是否推进」会把「结算时立起对峙＝已接受但挂起」误判为非法；该路径就是普通的「停在有人格子上」，不是边角 | `c78371d` |
| ⑨ | **粗筛漏发两处**（一致性测试是单向的，看不见这类问题）：同时 pending ∧ challenged 的座位失去判定权；共同待认证的第三方失去复议投票权。两处引擎都接受 | `8b4fb9d` |
| ⑩ | 反解对空段/缺段/多余尾段取值「猜」出 `target: 0` / `cardId: ''` ⇒ 严格规范形（重编码必须逐字相等） | `fd3503c` |
| ⑪ | `truncated = candidates > CAP` 会在「超上限但结果未被丢弃」时假阳性 ⇒ 增 `dropped`，P3 判据改读 `dropped` | `8b4fb9d` |
| ⑫ | 「UI 可点性唯一来源」在三处旁路下不成立：被动按钮、需目标出牌的选靶/提交路径、认证面板显隐；另有一处（`web/ui/council.ts`）留待 Task 9 收口 | `b8bf07b`（+ Task 9 续） |
| ⑬ | 禁止集守卫的两个失明模式：`.hand` 行级匹配放过解构/括号记法；整词边界放过粘连 id ⇒ 改为出现次数级白名单 + 封闭词表分词 | `323e768` |

## 4. 阶段 A 实施记录（Task 1–10）

| Task | 内容 | 提交 | 验收证据 | 审查结果 |
|---|---|---|---|---|
| 1 | Action 契约修正（+`CERTIFY_APPEAL_VOTE`／−`CERTIFY_VALIDATE_QUESTION`／`CERTIFY_ANSWER{actor,target,passed}`） | `817a001` | `tests/engine/action-contract.test.ts` 3/3；typecheck 全绿 | 1 轮通过（抓到简报正则必然失配，已纠正） |
| 2 | `engine/core/action-key.ts` 动作 key 可逆编码 | `4ee3a9c` + `fd3503c` | `tests/engine/action-key.test.ts` 5/5；17 样本 key 互异 | 1 轮通过（修掉反解读错段、`'undefined'` 拼造；裁定：只认规范形） |
| 3 | `isolatedState` + `tests/engine/fixtures.ts` 局面唯一来源 | `24c5099` + `71c5f5f` | 常驻「rng 隔离」双向可失败；`mk(3..8)` 每座满手牌 | 1 轮通过（补后置断言；裁定：局面一律经 `enterPendingCertification`/`advanceCertificationRound`） |
| 4 | `probeAction` 三种拒绝表达 | `a1d4e3a` + `c78371d` | focused 9/9；PASS 三条真拒路径 + 一条「已接受但挂起」 | 1 轮通过（复审做过过度接受分析） |
| 5 | 五面试跑式枚举 | `0009643` + `8b4fb9d` | focused 30/30；`npm run gate` 10/10 | 1 轮通过（补齐两处粗筛漏发；确立「漂移守卫也要断言候选层」） |
| 6 | `getLegalActionStats{candidates,enumerated,truncated,dropped}` | `23865ef` + `8b4fb9d` | 上限截断由 `wideHandScene(128)` 变为可失败 | 同上（与 Task 5 合并派发、合并评审） |
| 7 | `web/legal-gate.ts` + 三层漂移守卫 + **新增复议票入口** | `71d76a7` + `b8bf07b` | focused 38/38；门 ⑩ E2E `ok:true`、`consoleErrors: []`；17 项变异 | 1 轮通过（裁定「补 surface 而非放宽断言」；被动/需目标出牌/认证面板旁路已封） |
| 8 | `tools/laya-probe/state-text.mjs` + 禁止集 | `693c37f` + `323e768` | focused 47/47；13 项变异（含「事后擦除只在结构层变红」的可执行证明）；gate 10/10 | 1 轮通过（守卫升级为出现次数级 + 封闭词表） |
| 9 | 口径同步（规格 §6.3/§7/§5.3、README G-a…G-h、`council.ts` 收口） | **未执行** | —— | 用户指示 T8 收尾即停；判据与逐条清单已写入续作计划 Task 9 |
| 10 | 第 ⑨ 门逐字等价回归（默认参数重生成 + `diff` 为空） | **未执行** | —— | 同上；注意 sim 无 `--seed`，回归只能用默认参数 |

## 5. 阶段 B 实施记录（Task 11–17）

**全部未开始**（用户 2026-11-08 指示停在阶段 A）。重启前必须先取得两项同意：Task 11 Step 2 建 `.laya-venv` + `pip install laya[serve]`（走网络、GB 级磁盘）；Task 12 Step 2 起常驻本地服务。

| Task | 内容 | 状态 | 阻塞原因 / 前置 |
|---|---|---|---|
| 11 | P0 环境自检（对拍 / venv 决策树 / `create_app` API 面） | 未开始 | 需用户同意安装；候选环境 ② 的自检**不得**用 `python -I`（会排除 user site 的 `_torch_drive.pth`） |
| 12 | `launch.py`（官方 app + 本地权重 + 硬绑 `127.0.0.1:8712`） | 未开始 | 依赖 Task 11 的路线 A/B 判定 |
| 13 | Node 反代（CORS / 对拍 / SKIP） | 未开始 | 官方 serve 无 CORS ⇒ 反代是必需项；测试须三条各占独立端口 |
| 14 | sim `--record-decisions`（默认关闭） | 未开始 | 不变量 = 报告文件逐字一致（不是 stdout 计数行） |
| 15 | 影子决策探针 P1/P2/P3/P6 | 未开始 | 三条硬修正：严格反解必须 try/catch、P3 读 `dropped`、词表按主题派生（真实主题「御风·远」等会让封闭词表误判合规实现为泄漏） |
| 16 | 浏览器可达性 P4 | 未开始 | `page.on` 必须早于 `goto`，否则拿不到失败层次 |
| 17 | P5 降级 + `package.json` 脚本 + 报告落盘 | 未开始 | `SKIP` + 退出码 0；不得引入任何 Python 依赖 |

## 6. P0–P6 读数

**全部未跑**（阶段 B 未开始）。P0 未跑原因：未建 venv、未安装 `laya[serve]`，权重 sha256 对拍尚未由本项目执行。
判据口径更正：**P3 的下调信号是 `dropped` 之和为 0，不是 `truncated`**（`truncated = candidates > 64` 会在「超上限但结果未被丢弃」时假阳性）。其余判据见续作计划 §2.3。

## 7. 三条可行性判定与 V2 建议

**未出结论**。阶段 A 只交付了「契约与其机器验证」，不含接线结论；三条判定（接线／延迟／浏览器）与对 V2 的建议必须由 Task 15–17 的实测读数支撑，不得在没有读数时先写结论。

## 8. 红线自证

- [x] `npm run gate` 十道全绿 —— 由 Task 5/7/8 的实现与复审分别记录（末次记录：Task 8 修复轮，10/10，门 ⑩ E2E `ok:true`、`consoleErrors: []`）；控制器本人独立复跑的是 `npm run typecheck`（静默通过）与 `npm test`（0 fail / 1 todo）。**门级独立复跑归 Task 10。**
- [ ] 第 ⑨ 门用默认参数重新生成报告后 `diff docs/balance-report.md` 无输出（逐字等价）—— 归 Task 10
- [x] `git status --short dist/` 为空（发布包零增量）—— 控制器 2026-11-08 复跑，输出为空
- [x] `package.json` 无 Python 依赖（`dependencies` = `{}`），且尚无 `*:laya` 脚本（归 Task 17 添加）；`tools/gate.mjs` 未新增需要 sidecar 的条目
- [x] 四条常驻测试绿：一致性-正向 / 漂移守卫（三层）/ rng 隔离 / 禁止集 —— `node --test tests/engine/legal-probe.test.ts` = 47/47

## 9. 遗留（如实）

- **B14 关隘接线未做**：`payGate`/`drawTrial` 仍零引用、`gatesPassed` 仍无写入方 ⇒ G-c 未修，4 个身份目标仍不可达；`COMPARE` 在枚举里继续标「入口待接线」。
- **G-a** 出牌费用语义未裁（引擎不扣不校验、UI 不拦、仅 sim 当资格线；`uiAllows` 里两条资源镜像已被测试钉住）。
- **G-b** 引擎 `act` 分支不查 `pendingCert`：本批仅在枚举层按 UI 规则排除，引擎本身未加固；取证行钉住了现状，一旦引擎加固那两行会大声变红。
- **G-d** 双人互验 `certifyMutualSign` 仍只有测试调用。
- **G-f** 对峙选牌无 `Action` 成员 ⇒ 对峙期 `candidatesOf` 对所有座位为空（Task 15 的分桶与 P1 读数的解释力都受它影响）。
- **G-g** 复议裁定在数字轨无人调用 ⇒ 新增的复议票控件写入没人关闭的窗口；流程层接线需先决定「投票窗口何时关闭」。
- **G-h** 少发牌在引擎层仍是静默的（默认 `deckSize=40` vs 8 人需 56；`drawCards` 空堆无警告停）；本批只把 `mk` 夹具按 `scales.deckTotal` 修好，既有测试的坑未动。
- **一处文档超售待收口**：`web/ui/council.ts` 的面板显隐仍自带规则，未消费 `uiAllows` ⇒ `web/legal-gate.ts` 头部「唯一来源」这句话目前不成立，Task 9 Step 5 负责把它收口（而不是改窄声称）。
- **封闭词表按 ASCII 测试主题校准**：真实主题的中文牌名与 8 种被动 op 尚未纳入词表数据侧，Task 15 必须先按主题派生再加真实主题场景。
- `noLegalActions` 是单个布尔量，混淆了 ≥3 种空候选成因（待认证锁定 / 对峙未决 / 非行动阶段）；Task 15 目前只能靠题面文本分桶。
- 强度结论、sidecar 进产品、发布包内任何增量：**明确不做**。
