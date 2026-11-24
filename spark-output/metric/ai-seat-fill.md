# Metric Blueprint — 创界山·活人认证 / AI 补位座位

- **生成时间**：2026-11-23T02:55:00+08:00
- **数据工具**：自建（`State.log` 引擎内建事件源 + `web/main.ts:175` 导出存档 + B85 独立实拍页的 `PlaytestEventStore` / 观察员面板）。**不引入任何第三方分析 SDK** —— 离线单 HTML 双击即玩、发布包零增量、sidecar loopback-only 三条红线会同时被违反；合规上也不收集个人字段
- **现有埋点覆盖**：**partial**（`State.log` 现有 **68** 个 `kind`，按 `engine/**/*.ts` 的 `withLog` 第 3 参、`LogEntry.kind` 字面量与 `statuses.ts::LOG_KIND` 派生，完整清单见文末；B85 已补齐实拍墙钟、接管、同频、面板注视与局后自报；真人数据仍为 0）
- **复盘节奏**：每局一次，当场结
- **Owner**：设计师自己 —— 且 owner = 观察员 = 参与者，三重角色未分离，是本蓝图最大的风险项（见下）

## 实拍就绪（B85）

- **构建**：`npm run build` → `dist/创界山-活人认证-实拍.html`。
- **URL 配置**：打开实拍 HTML 后追加 `?playtest=1&seed=<uint32>&aiSeat=<0..5>`；固定 6 人局，`aiSeat` 为程序座位。
- **导出**：观察员侧栏「导出实拍记录」生成 `创界山-实拍-<seed>-<aiSeat>.json`，含 `schema/config/metadata/events/snapshot`；`snapshot` 保留序列化 `State.log`，墙钟与观察事件不写回 `State.log`。
- **Ask 4 = `ready_to_schedule`（ready to schedule once date, 5 participants, and recruitment questions are set）**：采集工具已就绪，仍缺确定日期、5 位真人参与者与 K8 两道招募问题。
- **Ask 5 仍未拍板**：生产 AI 座位选择器 / 可 ban 开关未实现；独立实拍页不是生产功能，也不进入发布包。

---

## ⚠️ 方法论危害（先读，这四条决定数据可不可信）

| # | 危害 | 为什么致命 | 蓝图里的处置 |
| --- | --- | --- | --- |
| H1 | **测量工具进入被测量系统**：你选了实时面板，而面板本身是新的注视点 | NSM 的核心事件是"全桌朝向同一人"。屏幕上有计数器，"看屏幕"就会与"看答题者"混淆 —— 既能抬高也能压低计数 | 面板**只给观察员看**、折叠侧栏；「记一次同频」**必须人按，不得由面板事件自动计入**；导出 JSON 是唯一真值源。**做不到侧栏隔离就退回导出离线扫，不要实时面板** |
| H2 | **观察员正在打牌** | "全桌注意力集中"要求你看向另外 5 个人，而你那一局在管自己的手牌和认证题面。漏记的方向还不可控：你越投入，漏得越多 | 把外部视角转成**内部自报 + 日志锚点**：机器从 log 给出锚点轮次，局后每人回答「刚才第 4 轮那次质疑，你是不是全桌都在看谁」。你只按一次键 + 收 5 份自报，不占任何座位 |
| H3 | **历史默认 seed=42；多局复用同一 seed 仍会失去样本独立性** | B84 前 UI 无 seed 入口；现在 `web/main.ts` 已提供 seed 输入，B85 实拍 URL 也可显式指定。若实拍仍复用同一 seed，得到的只是同一分布的复现，跨局稳定性结论作废 | **B84 已补 seed UI/export；B85 实拍 URL 必须显式带 `seed` 并写入 `config.seed`**。A/B 至少 2 个不同 seed；未记录的局仍降级为"单局个案" |
| H4 | **引擎 log 是逻辑时间，没有墙钟时间** | "不卡轮"是本方向的 KPI，但 `LogEntry` 只有 `round`/`turnIndex`，测不出桌上真正等了多久 —— 而这正是被替代者（新手人类）最被嫌弃的地方 | **B85 已在独立实拍页新增 `ai_turn_duration_ms` 与 `human_turn_duration_ms`**，随实拍 JSON 导出且不写回 `State.log`；没有这条，Driver 1 仍为空话 |

---

## 🌟 North Star Metric

**补位名场面增益（Fill Uplift）**

```
mean(每局全桌同频时刻数 | A 组：5 真人 + 1 程序座位，按 6 人档)
− mean(同指标 | B 组：5 真人，按 5 人档)
```

- **目标**：≥ **+1.0 次/局**，且 A 组「想换回真人」人次 **= 0**
- **时点**：3 周内 6 局（3A + 3B，同一批 5 位真人，≥2 个不同 seed）
- **业务对齐**：`brief.business_goal[1]`「单局产出 ≥3 次全桌名场面」/ `brief.design_criteria.quantitative[0]`「单局全桌注意力集中 ≥3 次」/ `pitch.the_bet` 第二判据
- **为什么是这个**：这个减法**直接判掉本方向唯一的生死问题** —— 补位买到的是 6 人档多出来的那两格强度旋钮（签印门槛 3→4、seatWeight 16→20），还是"按 5 人档开局就够了"。**B 组就是 Pitch 第 4 备选（bench.takeaway-18）—— 把它做成对照组，而不是口头承认它。** Ask 1=A 下增益 ≤0 不能直接归因于补位无效，必须先补跑 A′；A′ 仍 ≤0 才判免费方案胜出并关闭。比 AI 胜率高，因为胜率不是价值交换；比满意度分好，因为它是行为计数；比名场面绝对值好，因为绝对值分不清"补位带来的"和"这批人本来就玩得开"。

---

## 🚀 Driver Metrics（5 个）

| # | 指标 | 公式 | 目标 | 埋点 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D1 | AI 手番墙钟耗时中位 | `median(ai_turn_duration_ms)` vs `median(human_turn_duration_ms)` | ≤ 人类同局中位 1.0×，绝对 ≤ 3000ms | `ai_turn_duration_ms`, `human_turn_duration_ms` | ✅ exists（B85 实拍页） |
| D2 | 真人代操作次数 | `count(human_takeover_click)/局` | **= 0**（底线非优化项） | `human_takeover_click`, `seat_control_assigned` | ✅ exists（B84/B85） |
| D3 | AI 参与的认证/质疑事件数 | `count(cert_event where actor/target == aiSeat)/局` | ≥ 1.0（低于 1 判"隐形座位"） | `cert_event` | ⚠️ partial（待验签印是否落 log） |
| D4 | 非法动作率 + 降级深度 | `count(ai_forfeit.reason ∈ {illegal_choice, engine_rejected}) / count(ai_turn_start)`；`degradeLevel` 分布 | 非法率 **0**；兜底档占比 ≤ 25% | `ai_forfeit`, `ai_turn_start`, `ai_action_committed` | ✅ exists（`ai_action_committed` 只收合法动作；120s timeout 对 B85 同步自动步 N/A） |
| D5 | 组局兑现率 | `因补位开成的局 / 原计划缺人的局` | ≥ 60%（3 周内 ≥2 场是真实缺人场景） | `game_start`, `new_player_introduced` | ⚠️ partial（`game_start` 已存在；局外分母仍缺） |

切片维度统一按：A/B 组、决策面（move/gate/trial/duel/山议/认证）、主题包（4 套）、seed、真人新手在场与否、第 1/2/3 局。

D5 特别说明：分母（谁本来要来、实际来了几个）**只能局外记录**，是整套蓝图里唯一拿不到机器字段的指标 —— 用一行当场表解决，别写成需求。

---

## ⚠️ Counter Metrics（6 个，含 D→C 对应）

| 保护哪个 Driver | Counter | 防止的坏做法 | 阈值 |
| --- | --- | --- | --- |
| NSM | **新奇衰减率** | 用第一次的新奇抬高第 1 局，误判方向成立 | `1 − 第3局/第1局 ≤ 30%`，超过则 NSM 判定作废 |
| D1、D4 | **AI 弃权率** | 把超时兜底做成弃权来"解决"卡轮，座位隐形（bench.takeaway-6 警告过的退化路径） | ≤ 15%；连续两局 > 25% 判该档不可用 |
| D2 | **桌友纠错/申诉次数** | **为了把代操作刷成 0 而禁掉按钮** —— 代操作归零但没人知道它在干什么。零代操作有两种来源：契约清晰，或座位黑箱 | 每局 **≥ 1** 次；为 0 且代操作也为 0 时**不判好，判"不可解释"**，该局须补一次口头核对才计入样本 |
| D3 | **单座位笑声占比** | 为拉名场面计数把 AI 调成搞笑输出，5 人变观众 —— 恰好摧毁"全桌同频"的定义 | ≤ 40% |
| D5 | **真人新手上桌次数** | 补位一旦可用，"拉不熟的人凑数"这条入坑路径就消失（Frame 显式记录的隐形档代价） | ≥ 1/4 局；连续 4 局为 0 就把"邀请真人新手"写进组局规则，不靠自觉 |
| 测量有效性 | **面板注意力窃取比** | 面板成为新注视点，把要测的东西测没了 | `count(gaze_panel)/count(table_attention_peak) ≤ 0.3`，超过退回离线扫 |

**B85 弃权口径**：实拍 AI 走同步 `runSeatStep`，不经过 120s 等待；`reason=='timeout'` 对 B85 为 **N/A**。弃权率 = `count(ai_forfeit) / count(ai_turn_start)`，分子统计 `blocked` / `illegal_choice` / `engine_rejected` / `wrong_turn` 等全部同步弃权，不能只数 timeout 而把指标结构性算成 0。

**B85 非法动作口径**：`ai_action_committed` 只记录 `legal=true`，不能用它统计非法动作。非法动作率 = `count(ai_forfeit where reason ∈ {illegal_choice, engine_rejected}) / count(ai_turn_start)`，分母覆盖全部 AI 尝试。

---

## 💊 Health Metrics（5 个，阈值全部来自仓库既有数值，不是我编的）

| 指标 | 保护什么 | 阈值 | 告警条件 |
| --- | --- | --- | --- |
| 位次胜率极差（补位档**单列**） | B80 平衡底线 | `balance.ts:28` 报告口径 **≤8pp**；`:41` 门禁 **≤14pp**；`:49` RMS **≤6.5pp**（固定 seed 1000 × 每档 100 局） | >8pp 单列告警；>14pp 阻断发布。⚠️ 复述 `scales.ts:44-50`：seatWeight ≥ 山道长度时席位成绝对优势，极差会从 1–3pp 反弹到 **13pp**（实测标定） |
| 关隘试炼通过率 | B26 标定区间 | 逐牌区间：`t_mirror [85,100]`、`t_sword [85,100]`、`t_oath [45,70]`（`balance.ts:60`） | 任一越界即停，先归因再谈数值 |
| **门⑨ 冒烟 + release 100 组基线一致性** | 确定性复现路径不被补位/模型污染 | **逐字节一致**（不是"接近"） | 漂移即按 E116 停下归因；**若 Ask 1 裁定要改 scales 数值，必须显式申报重基线并写进规格，禁止悄悄过** |
| 导出可测性 | 该局数据是否作废 | 含 `config.seed` + `metadata.themeId` + 可解析且含 `log` 的 `snapshot` ⇒ **100%** | 任意一局作废即当场补跑，不留到攒样本 |
| 非法动作率 | 引擎契约（`performAction` 拒绝时返回引用相等） | **0** | 出现 1 次按缺陷处理，门禁红而非回归阈值红 |

---

## 🔧 埋点状态清单（原缺口，共 12 项 = 10 must + 2 should；must 覆盖 11 类事件名，因墙钟一行含 AI 与人类两个事件）

### 🔴 Must

| 事件 | 触发时机 | 字段 | 频率 | 位置 / 待办 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `game_start` | B85 实拍页 `newGame()` 与 AI 座位配置后 | seed/aiSeat；metadata 另含 themeId/players/mode | 每局 1 | `web/main.ts` 实拍初始化 + `web/playtest-events.ts`；B84 seed UI/export 已存在 | ✅ exists（实拍事件，不进 `State.log`） |
| `seat_control_assigned` | 开局装配及实拍 aiSeat 配置 | seat/controlledBy（无 policyId） | 每局 N | `engine/core/state.ts` 的 `Player.controlledBy` + `web/main.ts::applyPlaytestAiSeat`；随 State/snapshot 导出，不是独立 LogEntry | ✅ exists |
| `ai_action_committed` | AI 动作落账 | round/turnIndex/seat/actionKey/durationMs/**degradeLevel**/seatMode/legal/source | 每次 | `engine/core/seat-runner.ts` 经 `applyAction` 写引擎日志；`web/playtest-controller.ts` 写完整实拍事件（source 当前 heuristic） | ✅ exists |
| `ai_forfeit` | 同步无合法动作或被拒绝；120s timeout 对 B85 同步自动步 **N/A** | round/turnIndex/seat/reason/durationMs/**seatMode** | 事件即报 | `engine/core/seat-runner.ts` 写含 seatMode 的引擎日志；`web/playtest-controller.ts` 写含 durationMs 的实拍事件 | ✅ exists（同步弃权；timeout N/A） |
| `ai_turn_duration_ms` / `human_turn_duration_ms` | 轮到→产出动作 | round/seat/durationMs | 每手番 | `web/playtest-controller.ts` UI 侧墙钟；只进实拍事件表 | ✅ exists |
| `human_takeover_click` | 真人替非自己控制的座位点按钮 | seat/control | 事件即报 | `web/playtest-controller.ts`；面板/工具栏内部点击不计入；只进 `PlaytestEventStore`，不进 `State.log` | ✅ exists |
| `cert_event` | 质疑启动/签印落账/判定 | round/actor/target/signs_count/threshold/result/**ai_participated** | 事件即报 | `certification.ts` —— **先验签印计数是否已完整落 log**（当前仅见 `[被动:certify_free_pass]` 一处 `kind:'passive'`）；B85 不合成该事件 | ⚠️ 待验（不在 B85 范围） |
| `table_attention_peak` | 观察员判定全桌朝向同一人 ≥3s | **anchorRound/anchorLogIndex**/focusSeat/durationSec | 事件即报 | 可折叠观察员侧栏「记一次同频」；锚点指回 `State.log` | ✅ exists |
| `post_game_poll` | 局后 15 分钟内每位真人 3 题 | seat/wantHumanBack/wouldReplay/feltRobotic/recalledPeakCount/oneLineAnomaly | 每局×每人 | 实拍侧栏局后自报表；草稿跨重渲染保留 | ✅ exists |
| `game_export_snapshot` | 点「导出实拍记录」 | schema/config/metadata/events/snapshot | 每局 1+ | `web/playtest-panel.ts` → `创界山-实拍-<seed>-<aiSeat>.json`；含实拍事件与序列化 State | ✅ exists |

### 🟠 Should

| `gaze_panel`（seat/durationMs，**显式「开始看面板 / 结束看面板」，不自动监听注意力**）· `new_player_introduced`（局外一行表） |

现有可复用事件源（**68** 个 `State.log.kind`，按 `engine/**/*.ts` 写入点派生）：`add_to_deck / ai_action_committed / ai_forfeit / ask / barrier / cancel_vote / card / certify / certify_extra_round / certify_extra_signer / certify_forbid_challenge / certify_free_pass / clear_flag / compare_cards / create_card / damage / disarm / discard_opponent / discard_self / double_next_vote / draw_cards / duel / equip / equip_card / exempt_from_vote / exhaust_card / exhaustion / extra_roll / extra_signatures_required / extra_vote / gain_card / gain_resource / gate / gate_fallback_pay / goal / heal / heaven / keep_die / modify_judgement / move / move_backward / move_by_dice / move_forward / move_relative_to / move_to_tile / passive / peak / peek_deck / place_barrier / random_from_deck / remove_from_deck / reroll / roll_opponent / set_die_result / set_flag / set_phase / set_resource / setup / shield / spend_resource / spirit_wheel / status / swap_deck_top / swap_position / teleport / transfer_resource / trial / vote_modifier`，`actor` = 座位号，`-1` = 系统行。`certify` 来自 `engine/core/certification.ts` 的 AI 认证完成说明，不再漏记。

---

## 🔗 验收标准 ↔ 可观测埋点（反向链）

| 验收标准 | 观测 | 缺口 |
| --- | --- | --- |
| 散场无人要求换回真人（Pitch 判据） | `post_game_poll.wantHumanBack == false` × 5 | must |
| 全桌注意力集中 ≥3 次/局（Brief 定量） | `table_attention_peak`/局 | must |
| 铺垫期人均分心 <2 次（Brief 定量） | `handset_peek`/`gaze_panel` 人次 | should |
| 人类胜率 25–30%（外部基准 takeaway-17） | 模拟 + 实拍名次分布；⚠️ P6 agreeRate 37.08% 且预研明令不下强度结论 ⇒ v1 只能以启发式档给数 | must |
| 5 名真人无讲解按规则书跑通（takeaway-14/17） | 记"讲解次数"与"翻规则书页次数"，任一 >0 未达 | must（纯当场表，无需代码） |
| AI 手番不得要真人代结算（takeaway-10） | `human_takeover_click == 0` | must |
| 补位局不给本人记成绩（takeaway-5） | 终局结算日志里 aiSeat 成绩归属标记 | must（**依赖 Ask 1**） |

---

## 🚨 失败信号阈值（什么数值算方向错，而不是算没达标）

| 信号 | 判读 | 动作 |
| --- | --- | --- |
| NSM 增益 ≤ 0 | **不得直接关批次**；Ask 1=A 使 6 人档两格强度对真人不可用，A−B 混入第二变量 | 先补跑第 7–8 局 **A′**（可被签印但不计入 N，不改 scales）。A′ 仍 ≤0 才判零代码按 5 人档开局够用并关闭；A′ >0 判「A 太弱而非补位没用」，升级为 B 并重跑 A 组基线；C 永不试 |
| 代操作任意一次 > 0 | 补位体验判负（比新手人类更差） | 先修交互与统一提交口，**暂停一切平衡讨论** |
| 非法动作率 > 0 | 工程缺陷，不是体验问题 | 门禁红，阻断发布，不进产品评审 |
| 一局"想换回真人" ≥ 2 人次 | 用户明确不接受 | 立即转 B 组，该场作为反例存档 |
| 弃权率连续两局 > 25% | "不卡轮"被做成"不玩了" | 重设兜底语义，并复核 D3 是否随之失效 |
| 为兑现签印/席位而改 scales | 口径决策而非数值微调 | 显式申报重基线 + 规格 §8 同步，禁止悄悄过门⑨ |

---

## 📊 看板建议

**首屏**：🌟 名场面增益（A−B）· 🚀 D1 手番耗时对比 · 🚀 D2 代操作（红/绿底线）· 🚀 D3 认证参与数 · ⚠️ 单座位笑声占比 · 💊 位次极差 + 门⑨ 一致性状态

**钻取**：A/B 组、决策面、主题包（4 套）、seed、真人新手在场、第 1/2/3 局
**节奏**：每局当场结（15 分钟：导出 → 按锚点回填同频次数 → 收 5 份自报）
**当场表（一张，8 格）**：seed / A-B 组 / 缺人类型与是否带来真人新手 / 同频时刻数（含锚点轮次）/ 弃权次数 / 代操作次数 / 5 份自报 / 讲解与翻书次数

---

## 实拍前状态核对（采集条件就绪，排期输入仍待齐）

1. **✅ seed 可指定并进导出（B84）**；B85 实拍 URL 还必须显式带 `seed`，否则所有跨局结论作废（H3）。
2. **✅ `seat_control_assigned.controlledBy` 与 `aiSeat` 可识别（B84）**；否则 A/B 无法分组，NSM 无法计算。
3. **⚠️ 验清签印/认证事件是否完整落 log** —— 决定 D3 可不可测；这是一次读代码就能定的事，不要靠猜。
4. **✅ 观察员面板已折叠进侧栏（B85）**；同频必须人按，注视面板必须显式开始/结束，实拍 JSON 是唯一真值源。
5. **⚠️ Ask 4 = `ready_to_schedule`（ready to schedule once date, 5 participants, and recruitment questions are set）**：采集链路已就绪，仍缺确定日期、5 位真人参与者与 K8 两道招募问题；齐备后按 8 局排期。**Ask 5 生产开关仍未拍板、未实现，实拍页不是生产功能。**

> 另需向下游申报的一条：`tools/` 的取证脚本纪律是「不收敛、不依赖 CWD、argv 数组调 git、历史锚点固定 `BATCH_BASE=7ab2995`」。**新增的日志扫描脚本要按同一把尺登记**，否则今天量出的增益数，下个批次无法复算 —— 这正是 B79 里已经踩过的坑。
