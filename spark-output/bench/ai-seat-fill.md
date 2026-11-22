# Bench — 创界山·活人认证 — AI 补位座位

- **生成时间**：2026-11-23T01:58:00+08:00
- **拆解目的**：全面对标
- **聚焦维度**：信息架构 / 交互模式 / 内容策略 / 性能体感（视觉语言仅覆盖「程序座位标识」一层；无障碍、移动端本轮砍掉）
- **时间预算**：深拆（1–2 天当量）
- **上游**：`spark-output/context/frame-ai-seat.json`（第二锚点，persona 大林，押「稳座」）
- **竞品清单**：
  - 🎯 直接：Automa Factory 补位族（Charterstone / Root Clockwork / Euphoria / Tapestry / Pendulum）、Board Game Arena（zombie bot 与 solo automa）、王者荣耀 AI 托管
  - 🔄 间接：雀魂自动摸切 / 天凤 60 秒强制摸切 + AI 隔离政策；社交发言类的 App 旁白路径（Bezier One Night / Werwörter）
  - ⭐ 标杆：Meta CICERO + LLM 社交推理复算群（Among Them / WOLF / MultiMind）

## ⚠️ 证据类型声明（必须先读）

本轮**没有任何竞品真实界面截图**。BGA 的 bot 配置屏在登录墙后，王者托管弹窗只存在于视频与攻略转述。`annotated_references[]` 的 8 条全部是**文档级 / 公告级 / 访谈级 / 论文级**证据，逐条标注了来源类型与可信度分层。下游（Audit / Brief / Pitch）引用时**不得表述为「实测过竞品界面」**。这是深拆的降级交付，不是等价交付。

---

## 一句话结论

> **行业三家（桌游自动机、数字桌游平台、亿级手游）在同一个技术选择上撞车：别做真 AI，做保底。**
> 而**没有一家把程序座位放进需要发言和信任的桌子上**——我们的高潮恰好在这一族里。

| 独立来源 | 原话 |
| --- | --- |
| 腾讯 2019 官方公告 | 「并不希望 AI 能够 CARRY 比赛…比对应挂机的玩家**水平低一些但看起来会更"聪明"**…更偏防御性但也**绝不会拖队伍的后腿**」 |
| BGA 官方开发者文档 | 「**You do not need to develop a full artificial intelligence**」 |
| Automa 六原则（Pedersen） | 「在实现上述目标的同时，**Automa 规则必须尽可能精简**」；「玩家不得代表 Automa 做出决定」 |

三种介质、十年跨度、互不引用，结论同一句。这不是我的偏好，是收敛点。

---

## 本次最重要的发现：「补位」可能是第三条路的误名

T6 那一行我在 Frame 阶段说过「可能是空行，而空行本身就是结论」。它确实是空的，而且空得比预期彻底：

- **Pedersen 明文否掉了这一族**：「They work **horribly** for games that rely on humans as social animals. While I have made an Automa for The Mind just for the sheer silliness of the idea, the end result **unsurprisingly sucked**. Games like **Werewolf, Charades, and Telestrations** are obvious examples where an Automa **won't cut it**」——他点名的三个游戏，全都是"人要为自己在场负责"的那一族，正是活人认证的家族。
- **BGA 的上线列表里没有 Diplomacy / Battlestar Galactica / Avalon / The Resistance**；含隐藏身份的 Coup / Werewolves / Decrypto 里只有 Conspiracy 有 bot，且官方注明「不是真 AI」。
- **CICERO 是历史上唯一真做了发言层的先例**，仓库 2025-04-17 归档只读，从未产品化。
- **行业实际找到的两条绕行路**：① 程序当主持人，不当玩家（Bezier「automates the night time narration…provides a timer」、Werwörter「Die App übernimmt die Funktion des Spielleiters」）；② **把人数下限做低**（One Night 系靠规则把下限从 8 压到 3，无需 GM）。
- 「Fill the empty seats with bots」这句话只出现在**电子端**（Three Nights: Moonfall）。

**对我们最扎心的一条推论**：我们的 `engine/scales.ts:12` 已经写死 `PlayerCount = 3|4|5|6|7|8`。也就是说——**"差一个人"在机制上今天就能解决：直接按 5 人规模表开局。** AI 补位的正当性因此不是"否则开不了局"，而只剩一条：**保住 6 人规模才有的名场面密度与座位互动**（少一个人会让认证/山议变薄，规格 :1055 的「放逐下限恒 3」是同一件事的另一面）。

这条改变的是**需求边界**，不是方向对错。它必须进 Brief 的策略维度：把「5 人规模表开局（零新代码）」和「AI 补位（要新契约）」并列做取舍，而不是默认后者。已记为 `takeaway-18`（action=avoid）。

---

## 功能矩阵（7 行）

### T1 缺席一个人的座位怎么被顶上（触发权在谁手上）

| 竞品 | 支持 | 步数 | UX | 独特做法 |
| --- | --- | --- | --- | --- |
| 王者荣耀 | full | 2 | 4/5 | **触发权给留在局内的队友**：跟随我 / 回基地 / AI托管，约 30–90s 挂机后出现，不点则维持挂机 |
| BGA zombie | full | 0 | 3/5 | 全自动不可拒；bot 不作为注册玩家、不能成为 active player，动作 `$player_id` 传参 |
| Charterstone | full | 1 | 4/5 | 开局前声明可 stand in for players who can't make it；明确可 ban |
| Root Clockwork | full | 1 | 3/5 | 「fill out the player count in dozens of configurations」+「**At least one player will need to keep it in check!**」 |
| 天凤 | partial | 0 | 2/5 | 不补位：60s 强制摸切 + 掉线标红 + 照常计入 Rate |
| **我们** | **none** | — | — | 热座 `ui.seat`，`Player` 无 `controlledBy`/`isAI` |

### T2 桌友如何被告知「这不是人」

| 竞品 | 支持 | UX | 独特做法 |
| --- | --- | --- | --- |
| 天凤 | full | 4/5 | 「途中落ちプレーヤは名前を**赤色**で表示」——公开、不可关闭、全员一致，最省的范式 |
| BGA | partial | 2/5 | 框架只给 `iconClass`，**无强制 Bot/AI 角标**，查不到必须标识的政策 → The Last Droids 被投诉 bot invisible |
| 王者荣耀 | partial | 2/5 | 局内无公开角标，玩家靠行为特征识别（不聊天、出装离谱）；2025「巅峰赛塞人机」争议正源于未告知 |
| CICERO | none | 3/5 | 反向样本：私信无标识、40 局无人当场识破 → 学界据此提 **bot-or-not laws** |

### T3 AI 回合的操作开销（谁替它动手）

| 竞品 | 支持 | 步数 | UX | 独特做法 |
| --- | --- | --- | --- | --- |
| Automa 手法族 | full | 1 | 4/5 | 翻一张牌 + 顶/中/底降级 + 即时结算；无个人版图；Grand Austria Hotel 明文砍掉 guest 卡的后续收益（**取消引擎收益、只留交互**） |
| Pendulum | full | 0 | 4/5 | 实时段把两个 bot 并成一个「只占位不计分」的玩家，专门降负担 |
| 波多黎各典藏版 | partial | 3 | 2/5 | 反面：「需要替自动机结算」 |
| 王者荣耀 | full | 0 | 5/5 | 实时制天然零操作开销——**实体桌做不到这一格，必须用机制换** |
| **我们** | **none** | — | — | 热座下任何程序座位**默认由桌主任代操作**，正落在被骂最狠的那一格 |

### T4 AI 回合的等待体感

| 竞品 | 支持 | UX | 独特做法 |
| --- | --- | --- | --- |
| Root Clockwork | full | 4/5 | 实测 bot 不长考，反而比真人更快 |
| BGA 框架 | **none** | — | 对 bot 回合时长/思考提示**没有任何要求**（只有 `giveExtraTime()` 面向真人）——这是行业空白，不是标准 |
| 天凤 | full | 3/5 | 不等待：60s 超时执行最保守动作，把「等人」变成「等计时器」 |
| **我们（实测）** | partial | 2/5 | GPU p50 33.5ms / p95 52.2ms；**CPU p50 498.5ms / p95 703.2ms**；**READY 17.2s（实测 >30s）**——单次决策可接受，**开局那一次冷场不可接受** |

### T5 强度/难度的可调与验收

| 竞品 | 支持 | UX | 独特做法 |
| --- | --- | --- | --- |
| Automa（Pedersen） | full | 4/5 | 控分不控智能 + **删行动**（AI 不做收入/建造/酿酒）+ 难度档与特质卡 + Turczi 的 difficulty/personality 双轴；验收：Scythe 自动机 **300+ 外部测试**，人类胜率判据 **25–30%** |
| 王者荣耀 | full | 3/5 | 官方定调「比本人弱但看起来更聪明、偏防御、不拖后腿」；**未见专门改弱的公告** |
| BGA | partial | 2/5 | 平台层无难度选择器，靠各游戏自建；元数据规则「混档取最低」 |
| **我们** | partial | — | P6 与启发式 agreeRate **37.08%**，预研 §2.4 明令不下强度结论 ⇒ **目前无可用的强度验收口径** |

### T6 发言/谈判/辩护环节 AI 怎么处理（我们的高潮所在）

| 竞品 | 支持 | UX | 独特做法 |
| --- | --- | --- | --- |
| Automa Factory | **none** | — | 「work horribly…unsurprisingly sucked…**an Automa won't cut it**」（点名 Werewolf / Charades / Telestrations） |
| BGA | **none** | — | 无 Diplomacy/BSG/Avalon；隐藏身份类只有 Conspiracy 有 bot 且「不是真 AI」 |
| One Night 系 | partial | 4/5 | **把人数下限从 8 压到 3**，用规则消掉「差人」而不是补人 |
| Bezier / Werwörter App | partial | 4/5 | 只自动化**夜晚旁白与计时**，内容留给真人 |
| CICERO / LLM 群 | partial | 2/5 | 唯一做了发言层：humor 0/25、说服力 10.9% < 人类 21.1%、agent 更早被票出 |
| **我们** | **none** | — | `certifyAnswer` 题面依赖真人语义判断；规格 :1055 理由 1 正是冲这条写的 |

### T7 中途真人回来了怎么交还座位（迟到 ≠ 缺席）

| 竞品 | 支持 | UX | 独特做法 |
| --- | --- | --- | --- |
| BGA zombie | full | 3/5 | 接管期结果**不计入统计**（results no longer count toward statistics），归属问题从根上消掉 |
| 王者荣耀 | full | 2/5 | 本人照样扣信誉分、成绩不还给本人（百里守约 14-7-8 仍被罚）；重连交还的界面文案**未验证** |
| 雀魂 / 天凤 | full | 1/5 | 自动打出的牌**不可撤销且照常计入战绩**（实录：听牌时掉线，回来发现录像里自动打了别张放双响）；天凤限再入场 5 次 |
| **我们** | **none** | — | 无归属/计分/交还口径；且认证与山议是**不可回退的历史事件**，一旦被 AI 说掉就还不回来 |

---

## Castle vs Shack

> **Tanguy Crusson 提醒**：以下判断基于竞品**已发布**的形态。他们背后的研究、数据与试错我们看不到——**不要因为竞品 ship 了就以为他们想清楚了**。Root 的补位配置能 ship，不代表它不苦；BGA 的 zombie 不记分，也不代表这是最优解。

### 🏰 结构性壁垒（绕开走，别硬刚）

1. **Automa Factory 的十年方法论 + 300+ 局外部测试样本库**，以及 BGG 上玩家自制自动机的社区生态。这是 know-how 与测试时间的双重壁垒，一个人在 v1 内追不平——只能借它**公开的原则**，不能借它的手感。
2. **绝悟的训练基建**（RL、GPU 集群、相当于人类数百年对局量的自我对弈）。本地单 HTML 离线包场景完全不可复现。
3. **webDiplomacy 的 5 分钟 blitz 匿名联赛生态**——CICERO 能"上桌"的前提是平台允许匿名快节奏。实体桌游没有等价分发面，这也是**CICERO 的伦理教训不可直接类比**我们的原因。
4. **BGA 的框架级契约**（bot 作为 game state action、不计统计、不占 active player）是多年平台演进的产物，能借模式不能借实现。

### 🏚️ 可借鉴的表层优势（11 条）

三级降级链 / 零隐藏状态与空壳化 / 手番时长上限（翻 1 张 + ≤3 步）/ 难度=控分+删行动 / 在场者决定接管 / 公开不可关闭的标识 / 接管期成绩不计入本人 / 超时执行保守动作 / 「看管 AI」分配给某个真人的显式职责 / 程序只做旁白与计时 / 把人数下限做低。

---

## 视觉策略决策

**选择**：lean-in（**仅限「程序座位标识」这一层**）
**理由**：座位标识在行业里已形成共识语义——公开、不可关闭、一眼可辨（天凤标红、Charterstone 把 Automas 当具名实体写进规则书、BGA 独立面板）。这层做差异化没有收益、只有成本；标识不显眼换来的正是「到底谁才是真人」那类信任反噬。真正该 diverge 的是牌面与主题层（我们有 4 套主题包 + B79 句子层），与座位标识无关。
**声明**：`visual-language` 维度本轮被砍，此判断是从 IA/内容证据**推断**的，不得当作整体视觉策略基线消费。

---

## Takeaways（18 条：borrow 8 / avoid 7 / match 3）

### ✅ Borrow

| # | 结论 | 3 问校验（why work / 上下文 / 副作用） | 落点 |
| --- | --- | --- | --- |
| 1 | AI 手番 = 翻一张卡 + ≤3 步即时结算，无收入阶段、无个人版图、复用本体图标 | 三源撞车说"别做真 AI" / yes / 会显得可预测（Becky 教训），需靠牌库构造造"渐进策略感" | `engine/core` 决策器 + web 座位面板 |
| 2 | 每个 AI 动作写成三级降级链；验收=构造"所有目标已被占/已死"的极端局仍能出牌 | 消灭"AI 卡住"这一最致命失败 / yes（`probeAction`/`isolatedState` 天然适配）/ 兜底档需自带可被起哄的公开效果 | `legal.ts` + `probe.ts` + 缺失的 `applyAction` |
| 3 | AI 座位零隐藏状态（公开或空壳化）；依赖私密信息的环节改「结果型公开」 | 机器人有的东西玩家必须知道才能执行；同时命中既有红线「模型只见公开信息」/ yes / 失去策略纵深，但按 MultiMind 它本就会被优先票出 | 状态可见性 + 主题 IR |
| 4 | AI 的价值锚定在 denial/占位/抢先达标，不锚定得分效率；判据="真人因它在场而改变一次决策" | Automa 只做会让真人改动作的那部分 / **partial**（我们是竞速+认证，"占位"等价物要重定义）/ 纯 denial 会变成"讨厌但无害"，触发集火 | 关隘/裂隙/山议/对峙 + `scales.ts` `seatWeight`/`threshold` |
| 5 | 「要不要 AI 入座」交给在场的人；且补位局不给缺席本人记成绩 | 消除被塞机器的愤怒 + 切断"不如让 AI 替我打"的套利 / yes（面对面桌天然有全桌同意这道程序）/ 补位无代价可能稀释到场承诺 | 开局流程 + 终局结算 §5.7/§5.8 |
| 6 | 超时兜底优先于智能：超过 T 秒执行"最不动别人利益"的动作 | 天凤跑二十年；同时消掉冷场与"太聪明"两个抱怨 / **partial**（认证/对峙/投票不可回退，保守动作必须是"弃权"）/ 弃权需设上限 | 回合系统（`advanceAuto` 语义相反，要另做） |
| 7 | 有戏档两条硬约束：台词必须能回指已登记意图/动作键，对不上直接丢弃；长度与条数限量 | CICERO 有一致性过滤器仍被复核出预谋欺骗；数据说话多有害 / yes（`actionKey` 有现成锚点）/ 限量会让存在感低，与"被起哄"冲突 | 台词层 + `termExpander`/句子层 |
| 8 | 补位座位必须有恩怨计数（谁违约、谁帮过它） | 人类对"不记仇"的 AI 撒谎率 3.7% vs 对人 0.6%；WOLF 显示怀疑会纵向记账 / yes（计数器与人缘线已有）/ 记仇会开始针对特定玩家，可能触发集火 | 计数器 + 山议/认证 |

### ❌ Avoid

- **9** 不做"看不见是什么"的座位：标识公开、不可关闭、全桌一致（BGA invisible 投诉、王者 2025 信任崩塌、bot-or-not laws）。
- **10** 不让任何真人替 AI 抽/选/弃/结算——**热座模式下这是默认结局**；凡需要人类判断的分支直接从 AI 行动集删除。
- **11** 不造"全桌被迫集火才压得住"的座位（Root Automated Alliance = least fun faction；MultiMind 1.18 vs 0.90 票）。
- **12** 不把 AI 简化成"翻牌加战力/半随机分数"（Rolling Realms 设想被否、沙丘、远古大陆随机造天敌）。
- **13** **v1 不让 AI 参与发言层**（Pedersen 点名 Werewolf/Charades/Telestrations 一族 won't cut it；BGA 系统性缺席；CICERO 未产品化）。
- **14** 规则书不能写过简（Tapestry「too succinct…learning from examples」）；验收须含"5 名真人无讲解按规则书跑通补位局"。
- **18** **别把补位当唯一解**：5 人规模表今天就能开局（`PlayerCount` 已支持 3–8），"差一个人"的第三条路是先试零代码方案。

### 🟰 Match（行业标配，不做会被认为不专业）

- **15** 补位能力必须是**开关**、可 ban，不能是默认（Charterstone 可 ban、Root 是独立扩展、Jamey 要求"只用几张卡"）。
- **16** 难度 2–3 档，档间差异只体现在分数阈值或多移动一枚标记（Root 难度+特质、Tiwanaku、BGA 混档取最低）。
- **17** 验收靠分阶段真人外部测试与量化胜率线（co-designers → 每次几位新眼睛 → 规则书自足性；Scythe 300+；人类胜率 25–30%）——**我们至少要给出缩放后的量化验收线，不能只用"跑通 100 组模拟"交差**。

---

## 标注引用（8 条，全部文档级，见 `bench.json` 的 `annotated_references[]`）

ref-1 Automa 手法族（pattern）· ref-2 BGA 框架契约（pattern）· ref-3 王者公告（strength）· ref-4 天凤/雀魂说明书（pattern）· ref-5 CICERO 与复算群（anti-pattern）· ref-6 发言类绕行路径（pattern，**本方向最直接的挑战证据**）· ref-7 自动机失败样本集（anti-pattern）· ref-8 信任侵蚀样本（anti-pattern）

## Handoff

- **→ Audit**：takeaway-9（标识是否公开不可关闭）、takeaway-10（是否有任何环节要真人替 AI 结算）——热座 web 端必查两条；takeaway-6/1 的兜底与手番时长上限；takeaway-14 的规则书可自学性。
- **→ Brief**：lean-in（仅标识层，非整体视觉策略）；Castle 四条明确"v1 绕开不硬刚"；**takeaway-18 必须作为策略维度候选与 AI 补位并列**。
- **→ Pitch**：ref-1（三源撞车"别做真 AI"）、ref-3（王者强度声明 + 在场者授权）、ref-4（天凤标红与 60s 兜底）、ref-6（Pedersen 点名发言类不可做）、ref-5（有戏档能力数据）。
