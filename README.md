# 创界山·活人认证（2026 重制版）

[![CI](https://github.com/1273984347/creativemountain-liveness/actions/workflows/ci.yml/badge.svg)](https://github.com/1273984347/creativemountain-liveness/actions/workflows/ci.yml)

> **English** version: [README.en.md](README.en.md).

《爱情公寓 3》中陆展博桌游《创界山》的 2026 重制版：**实体 + 数字双轨**。
3–8 人，桌游策略 + 社交博弈；核心命题是——**登顶不是胜利**。

## 验证状态与非目标

**CI 当前验证的环境组合**：Windows（`windows-latest`）× Node.js 22 × Chromium（Playwright）——
`npm run gate` 的**十四道门**在这套组合下全绿。CI 工作流只跑这一套组合。

**明确的非目标**：

- ⚠️ **不保证 Linux / macOS 可用**——CI 只验证 Windows；
- Python 侧车（Laya）只是**可选实验**（评估 AI 决策策略），**不在 CI 里跑**，也不是游戏运行的前提；
- 本仓**不提供**在线服务、账号或联机——数字轨是**纯离线单文件**；
- 平衡数值以**本仓自带的基线快照**为准，不适用于其他实现；
- 实体件是**生成物**（`print/`、`dist/` 不入库），需本地执行 `npm run build:print` 产出。

## 四套主题

| 主题 | 资源 / 牌 / HP | 气质 |
|---|---|---|
| 仙侠·2026（基准） | 灵枢 / 符箓 / 灵力 | 灵气复苏的末法时代 |
| 科幻·AI 纪元 | 算力 / 指令 / 机体完整度 | 算法接管一切审批，只有一件事它做不了 |
| 融合·道械双修 | 灵能 / 道箓 / 气血 | 灵气与芯片在同一具身体里打架 |
| 都市·异能纪 | 异能点 / 异能牌 / 精神值 | 城市里总有人突然变得不一样 |

## 快速开始

**数字轨**：打开 `dist/发布包/数字轨/创界山-活人认证.html`——单文件、离线可用、双击即玩。

**实体轨**：打印 `dist/发布包/实体件/<主题>/` 下的

- `规则书.pdf` —— A4 双面规则书（含规模适配表，数值带溯源标记）；
- `实体件.pdf` —— 棋盘 + 48 张卡 + 8 张身份牌 + 4 张阵营牌 + 认证题卡 + 筹码；
- `svg/` —— 全部实体件的**可编辑 SVG 源文件**。

## 构建

```bash
npm install
npm run typecheck      # 类型门禁（tsc --noEmit）
npm test               # 单元与门禁自检
npm run build          # 类型门禁 + esbuild 打包单文件 HTML
npm run build:print    # 四套主题的 IR → SVG → HTML → PDF
npm run build:package  # 打包 dist/发布包/
npm run release:check  # 发布前检查：门禁 + 全量重扫 + 逐组比对（漂移即失败，约 10 分钟）
npm run release        # release:check + build + build:print + build:package
npm run gate           # 十四道门禁全跑
```

## 门禁（`node tools/gate.mjs`）

| # | 门 | 作用 |
|---|---|---|
| ① | 类型 | `tsc --noEmit`，TS strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes |
| ② | 测试 | `node --test`，单元 + 门禁自检（负样本常驻） |
| ③ | 文档口径 | 规格 ↔ 代码真值双向一致（C1–C10，含 **C8 覆盖边界逐条对应**） |
| ④ | 构建 | esbuild 单文件 HTML |
| ⑤ | 主题包校验 | 四套主题的结构、引用完整性、**参数取值域**、**试炼题面==判定**（B77：`terms` 逐叶必填 + `fallback` 数钉 0）；**B78：试炼牌 name 判据**（必填/≤6字/合并禁字表/套内不撞名）+ `terms.statuses` 三叶 ⇒ `terms` 共 **15 叶**（B79 §3.1 补 `path`/`peak`：句子层 `{path}` `{peak}` 的取词地基）；**B80 §2.1 补 `rift`/`hazard`/`player` ⇒ 18 叶**；**B79：`terms`↔`glossary` 判等**（B80 由五键扩到**八对**：`HP`/`resource`/`gate`/`path`/`peak`/`rift`/`hazard`/`player` 逐键等值、`deck` 豁免并写明理由「牌库名 ≠ 单张牌名」）⇒ 句子层与印刷层不许说两个词（B79 §3.3 销掉 B78 留的空守卫 E136；B80 r1.3 因这把闸判红而裁定 hybrid 的 `glossary` 三键同步换词） |
| ⑥ | IR 契约 | 四套主题的 ir.json ↔ IR 类型契约；**B78**：`trials[].name` 与 `board.tiles[].{name,gateFee,branchTo}` 逐字可追溯、顶层键**覆盖差集元守卫**（未认领的键即红）、指令表 20 条 ∧ 升序 ∧ ≡ 快照 |
| ⑦ | 双轨一致性 | IR/SVG 精确比对 + 数值溯源 + PDF 粗检（4 套 × 4 级） |
| ⑧ | 主题差异化 | 规格 §10.1 两张清单的机械判定 + **跨主题术语串戏** + **句子层叶跨套两两不同**（`checkThemesMutuallyDistinct`，B79 R8 立时是**五叶** `resource`/`gate`/`path`/`peak`/`hp`；B80 §2.1 扩到**八叶** `+ rift`/`hazard`/`player`——只判「与基准不同」会放过融合套撞科幻套那一类）。⚠️ 串戏判据的入参是**三套非基准主题**（基准套不参与），所以"某套正文残留基准词"这类只有把基准也纳入才看得见——B80 实测过这条边界，见其记录 §2.6 |
| ⑨ | 规模与平衡 | 30 局冒烟：零异常 + 兜底触发率 < 15% |
| ⑩ | 对峙端到端 | Playwright 真浏览器：触发对峙 → 回合锁定 → 选牌 → 揭晓 → 解锁 |
| ⑪ | 试炼通过率平衡 | 12 张试炼牌实测通过率 vs 目标区间（单色≈95% / 单类型≈55% / 类型+颜色≈20%） |
| ⑫ | 位次极差回归锁 | 固定 seed + 固定局数 ⇒ 确定性：最大极差 ≤ 14pp 且 RMS 偏离 ≤ 6.5pp（B65 重校准） |
| ⑬ | 余量判定离线回归 | 用已发布的多 seed 数据重算 Welch t 与精确临界值 ⇒ 判定不漂移 |
| ⑭ | 浏览器走查 | Playwright 真浏览器（**file://** 单文件）：四套主题 UI 契约（玩家行数 / 棋盘格数 == `scales[players].boardLength` / 面板标题取 `terms.path` / 零占位符残留 / 面板非空）+ 几何与响应式（无横向溢出、棋盘格盒子非零、手牌不越界、窄屏 390 无横向滚动）+ 非法 seed 的可见错误信号（`aria-invalid`）+ 行棋后日志增加 + **console/page 零错误**（B86） |

## 目录

```
engine/     引擎：状态、回合机、58 算子、16 谓词、认证与山议
web/        数字轨 UI（单文件 HTML 入口）
themes/     四套主题包（数据）
build/      构建脚本：主题生成器、实体件管线、发布包
tools/      十四道门禁的实现
tests/      单元与门禁负样本；tests/sim/ 是规模与平衡模拟器
docs/       规格、实施计划、批次执行记录、平衡报告
print/      实体轨产物（按主题分目录）+ 规则书叙述模板
docs/图示/   技术图集：8 张图 × 2 档（文档档 / 投屏档），自包含 HTML
AGENTS.md  Agent / 协作者入口：纪律清单与「去哪看」索引
CLAUDE.md  Claude 系工具入口（指向 AGENTS.md）
ROADMAP.md 路线图：已发布 / 在途 / 未决遗留
```

## 图集（技术图）

把原本只有文字与表格的关键结构画成可离线打开的自包含 HTML（内联 SVG + CSS，除 Google Fonts 外无外链）。
每张图两档：**文档档** 960×600 贴正文，**投屏档** 1280×720 评审投屏。

| # | 图 | 看什么 |
| --- | --- | --- |
| 01 | 回合流程 | 一次回合怎么跑：出牌 → 结算 → 骰子指令表 → 对峙 → 解锁 |
| 02 | 玩家状态机 | 正常 / 待认证 / 认证通过 / 力竭 / 放逐 + 负面状态五件套 |
| 03 | 门禁全景 | 十四道门禁的分层与执行先后 |
| 04 | 双轨构建管线 | 主题包 → IR → 数字轨 / 实体轨 → 发布包 |
| 05 | 句子层占位符管线 | 八叶占位符如何变成玩家看到的词 |
| 06 | 引擎依赖图 | engine/core 的真实 import 关系与枢纽 |
| 07 | 四套主题平衡画像 | 四套主题在真实读数上的定位差异 |
| 08 | 已知限制与待办 | 已解决 / 待接线 / 待校准 / 设计取舍 |

索引与构建方式见 [docs/图示/README.md](docs/图示/README.md)。

## 已知限制（如实登记）

- **数字轨棋盘按人数自适应**（规格 §8 的 boardLength 24–36），**实体件棋盘是 4 人局 28 格版**；
  换人数时需自行裁剪/扩展实体棋盘。
- 出牌目标由玩家**点选**（攻击类牌需再点一名对手；点自己或再次点该牌取消）；
  引擎侧「需要目标却未选目标则不出牌」，不会误伤主题包里的占位座位。
- 身份与阵营**开局随机分配**、**行动顺序开局随机决定**（B10，固定 seed 可复现）
  ⇒ 结构性**座位**偏差已消除：8 人局座位胜率极差 20.7pp → **1.3pp**（无趋势）。
- **先手优势已消除**（B11 活人席计分制）：认证通过**不再直接终局** —— 改为「获得 1 席 → 回到山道起点 → 可再取席」，
  终局按**得分 = 席位数 × 活人席权重 − 距峰顶格数**排名（一个活人席抵得上爬半座山）。
  位次胜率极差 **13.0pp → 1.1–2.8pp**（3–8 人局）；「首个登顶者直接获胜」从 77.6% 降到 **17–35%**
  ⇒ 登顶不再等于赢。读数见 `docs/balance-report.md` 的「按行动顺序位次」与「先手优势的传导路径」两节。
- 8 个身份的被动**已全部接入触发点**（B12）：开拓者「每回合首次移动 +1 格」· 匠师「每场 1 次免费造物」·
  观星者「每回合看牌堆顶 1 张」· 仲裁者「山议 2 票 + 每局 1 次否决放逐（只可救他人，不可自救）」· 守夜人「回合末 1 点护盾」·
  窃火者「每回合偷 1 枚灵枢」· 织梦者「每回合 1 次改自己的险径判定」· 山主「首次被质疑自动视为签印」。
  主动型被动在行动阶段「发动被动」按钮使用；触发统计见 `docs/balance-report.md` 的「身份被动触发统计」。
- **力竭（B76）**：体力（HP）归零 ⇒ 「力竭」而非出局（放逐仍是唯一出局通道）——手牌上限减半 / 行棋骰面 -1 /
  主动被动封锁 / 不可发起质疑；自恢 2 灵枢或由任意位置的队友花 1 灵枢救援，恢复时回到半血。
- **负面状态家族（B77）**：中毒 / 减速 / 封口 / 停手番 / 免疫五件此前**只有算子没有消费点**（主题包数据 56 处发放点全部空转：每套 14 处 = poison 2 / slow 1 / silence 1 / skip_turn 1 / immunity 9），
  现已全部生效。结算锚点刻意分两族：**状态族在「该玩家自己手番末」递减**（否则在自己手番内挂上的状态会在下次行动前蒸发），
  力竭仍按 round 末倒数。玩家侧措辞：封口 = 立刻弃**最左边 1 张**手牌 + N 个手番不能出牌与发动被动（行棋/问天/装备照做）；
  停手番 = 只能按「结束手番」，但收入与地形结算照常；免疫 = **预防不是解药**（不清已有层数）。
  「N 个手番」= 接下来 **N 个完整手番**（B77 r5）：在自己手番内中招时，当前剩余也被封但不占额度。
  24000 局生效侧读数（`docs/balance-report.md` 总览六行）：中毒扣血 21214 · 减速生效 2747 · 封口拦截 4595 ·
  封口弃牌 4924 · 停手番 13552 · 被免疫拦截 54。
- **对峙已落地**（B13）：同格相遇 ⇒ 双方各自选 1 张牌、选完同时揭晓（红 > 黑 → 同色比点数 → 平局各弃 1 张 →
  败者后退 1 格并抽 1 张牌）；此前引擎里只有一个无人调用的半成品算子，对峙**完全不可达**。
  触发统计见 `docs/balance-report.md` 的「对峙统计」。
- **三决策面模型评估已完成、模型未接入生产**（B70；certify 面经 B74 扩样复验）：sim 决策层抽成 `tests/sim/policy.mjs`
  单一真相源，`playOne` 支持默认关闭的 `FacePolicy` 注入（失败必回落）；评估器 `npm run eval:faces` 不进门禁、无服务即 SKIP。
  主表每面 400 局/臂（4 主题 × 100 seed，模型座 0，配对 McNemar 临界 3.841；play 面只接管「选哪张牌 + 打谁」）：
  **play / council 未检出改善**（χ²=0.355 / 0.028；座0 胜率 31.0%→29.0% / →30.3%）⇒ 保持贪心；
  **certify 面经 B74 两组独立扩样（各 1900 局/臂）均显著改善**（χ²=3.926 / 7.834；29.2%→31.1% / 24.2%→26.9%）
  ⇒ 判定「该面值得接入，**另立批次**做门 ⑨ 重校准」，**本批仍不接入**（`policy` 缺省 undefined）。
  读数见 `docs/预研/2026-11-09-b70-face-evaluation.md`；生成物 `docs/预研/data/b70-face-readings.md`、
  扩样 `docs/预研/data/b70-face-arms-certify-475*.json`。
- ~~**规则书尚未覆盖地形规则**~~ ⇒ **已补（B16）**：福地 / 险径 / 裂隙 / 关隘 / 峰顶均有章节与要点关键词，
  由 doc-sync **C10** 常驻核对「规格 §3.4 每类地形 ∈ 规则书」⇒ 再漏即红。
- **试炼牌自 B78 起正式具名**（`trials[].name`，48 条见规格 §2.4）：进 IR、印在卡面（类目行下独立一行）、进双轨比对；
  牌名与题面的语义同侧由人工对照管，机器只判撞名/禁字/长度。
- **指令骰 20 面表自 B78 起只有一个出处**（`engine/core/instruction-table.ts`）：引擎不再持有指令文案，
  `ask` 日志只报骰面与指令序号，UI 用既有 `diceRoll` 按主题词表展开；规则书与 IR 同源，20 条内容由快照钉住。
  - **B79 结账 face 15**：那句按**豁免窗真值**改写为「免疫「封口」至下一个完整手番结束」
    （`grantImmunity` 加层 + `tickPlayerStatuses` 在自己手番末衰减 ⇒ 窗 = 当前剩余 + 1 个完整手番）。
    表 / 主规格 §3.2 / 四套快照 / IR 派生四处同词，常驻守卫 `tests/gates/face15-wording.test.ts`（含跑引擎核窗长那条）。
- **句子层自 B79 起不持有任何一套主题的词**（本批的主张）：引擎与 UI 写 `{resource}`/`{gate}`/`{path}`/`{peak}`/`{hp}`
  五个占位符，取词只发生在**四个显示出口**（日志 `logLineText` 全 kind、notice 单点、`alert()`、面板与按钮 `termExpander`），
  替换实现唯一化（`engine/core/theme-text.ts` 的 `expandThemeWords`，缺叶**抛错**、不留静默回落——
  `?? '体力'` 那类兜底词正是「四套都不叫这名字却替四套说话」的元凶）。
  主守卫是**反向**的：`engine/**`+`web/**` 非注释行出现任何一套主题词字面量即红（R1，禁字表从四套 `theme.json`
  派生 ⇒ 加第五套自动纳入，不必改守卫）；配合 R3 运行时按本主题取词（引擎回显自己套的牌名是合法的）。
  机制名同形词（`关隘` / `山道`）按 §5.1.1 甲′ 保留，域级豁免声明一次（**B80 起这张表只管 tests 域并改名
  `TESTS_DOMAIN_EXEMPT_WORDS`，另加 `裂隙` / `险径`——见下一条 B80 三条**）。
- **B80：句子层再加三叶 + 第四个占位符 `{identity:N}`（销 L-B79-4）**。`terms` 补 `rift`/`hazard`/`player`（18 叶），
  引擎与界面里的 裂隙/险径/玩家称谓 全部转占位符；称谓一类更狠——引擎只报**座位号**，`{identity:3}` 由出口按当前
  state 查「几号座是谁 → 本套身份表」，**越界与查无本人都抛错**，不做「默认取当前手番」的兜底（那正是
  `council.ts:190` 会喊错人的形状：行使否决的人是 `vetoBy`，不是正在发言的人）。
  非仙侠主题从此不再听到「守夜人 / 山主 / 织梦者」这些**别人世界的角色名**。
- **B80：主域禁字表长成 58 词 = 叶词 32 ∪ 身份名 26，全部派生**。身份名以前不在任何禁字表里 ⇒ R1 对「引擎替某套喊人名」全盲；
  现在 `fullBanWords()` 只喂主域（`engine`+`web`），**tests 域仍用 `pureLeafWords()`**——测试标题写「仲裁者」是在说机制角色，
  与源码写「仲裁者」是两类缺陷，一张 58 词表喂给两边会把前者一并判红。
- **B80：机制名同形词的豁免表改名 `TESTS_DOMAIN_EXEMPT_WORDS`**（原名 `MECHANISM_HOMOGRAPHS`，旧名删除不留别名）。
  语义从「全域豁免」窄成「仅 tests 域豁免」⇒ 名字必须跟着变（名字活着、含义换了就是 E135/E136 同族）。
  表内 `关隘` / `山道` / `裂隙` / `险径` 在主域照判红；`峰顶` **不在**此表——它不是任何一套的叶词，管它的是 `FALLBACK_BAN` 那张兜底词网。
- **B78 留过一条从不存在的守卫（E136）**：`ir-validate.mjs` 注释、B78 规格 §4 R6、验收 12 的 ✅ 三处互指
  「`glossary`↔`terms` 三键一致由门⑤ 判」，实现零行——探针「只改 `glossary.gate`」得 0 条错误。
  B79 T2 补成 `checkTermsGlossaryAgreement`（五键判等、`deck` 豁免带理由）并做改前/改后变异对拍。
  **教训入索引**：守卫存在性的唯一取证是跑一遍变异看它红不红，grep 到注释不算证据。
- `rift`「裂隙」13 处与 `hazard`「险径」2 处曾是句子层字面量 ⇒ **B80 已销**（加 `{rift}` `{hazard}` `{player}` 三叶 + `{identity:N}`；
  当年与本批「只有五个 token」的裁定冲突属边界不是漏改，见 B79 规格 §7.1 **L-B79-4** 与 B80 规格 §2）。
- **试炼牌题面自 B77 起由判定机械派生**（`build/trial-text.mjs`）：好处是「牌面写的条件 == 引擎判的条件」有门 ⑤ 常驻守卫、
  四套不再串戏；代价是题面变成「条件句 + 奖励句」的朴素句式，**叙事性（「立誓」「抄经」这类花名）已消失**，
  当时留给 B78 主题批在不动判定与守卫的前提下补文案层 ⇒ **已交付**（B78：48 条牌名进 IR 与卡面，题面判定一字未动）。
- 主题包的**全量差异化**（各自独立的卡牌池 / 事件池 / 身份设计）属 V1.1 范围。

### 动作契约层的未接线项（B15 登记，逐条现查于 2026-11-09）

> 这些是**「UI 与 AI 使用同一枚举」**这条契约的已知缺口：引擎动作契约与实际接线不同步的地方。
> 证据路径逐条给出，便于复核；括号内是本仓的缺陷编号。

| # | 事实 | 证据 |
|---|---|---|
| G-a | ~~**出牌费用无权威语义**：规格 §3.1 未写支付、引擎 `performAction` 的 `act` 分支**既不校验也不扣**、UI 手牌区只显示不拦、仅模拟器把 `cost <= resource` 当资格线 ⇒ 数字轨可**免费出牌**~~ ⇒ **已修**（B65 裁定为**出牌付费**：打出卡牌须支付该牌 `cost`（规格 §3.1「行事」/§4.3 已补）⇒ **灵枢不足即引擎拒绝**（不扣、不出牌）；UI `uiBlockNotice` 同款拒因并点名「灵枢不足」；枚举层由**引擎自己拒**、试跑如实反映（不另写 `cost` 镜像判据）。⚠️ 连带后果已处置：付费使资源成为真约束 ⇒ 8 人档出现**真实**位次偏差 ⇒ 门 ⑫ 与统计口径阈值已按跨 10 组独立样本**重校准**（规格 §5.8/§9.2 有 B65 补记）） | `engine/core/turn-runner.ts`（`act` 分支）；`engine/core/balance.ts`（阈值单一事实源）；`web/legal-gate.ts`；`tests/engine/card-cost.test.ts`；`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` |
| G-b | ~~**待认证锁定只在调用方生效**：引擎 `act` 分支**不查** `pendingCert`（`move` 分支查）⇒ 锁定者可用位移牌绕过 §5.1 锁定；枚举层按 UI 规则排除，但引擎本身未加固~~ ⇒ **已修**（B66 引擎层加固：规格 §5.1 早已写明「待认证者**不能使用移动类卡牌或位移能力**」⇒ 本批只补**实现**、规格零改动。`act` 分支查 `pendingCert` ⇒ 锁定者打**含位移**的牌被引擎拒绝（引用相等 = 探针认得的拒绝信号）；⚠️ **只拦位移类**（攻击 / 防御 / 资源牌照打 —— 规格只禁位移，不禁一切行动）；⚠️ 位移判据按 **op 语义**、**不只看 `card.type === 'motion'`**（主题包有一张 utility 类型的位移牌）） | `engine/core/turn-runner.ts`（`act` 分支）；`engine/core/targeting.ts`（`cardHasMovement`）；`tests/engine/pending-cert-lock.test.ts` |
| G-c | ~~**`gatesPassed` 无生产写入方**：四套主题各有一个身份目标是 `pass_gates`，而计数器只被**读取**（`engine/goals/registry.ts`）⇒ **4 个身份目标在数字轨永不可达**（B18 关隘接线后仍缺写入）~~ ⇒ **已修**（B60 补齐三环：计数写入 `markGatePassed` + 判定调用 `goals/settle.ts` + 达成即发【印记】；实测 `pass_gates` 达成 **498 次 / 24000 局** ⇒ 目标真实可达） | `engine/core/gate.ts`；`engine/goals/settle.ts`；`tests/engine/goals.test.ts` |
| G-d | ~~**双人互验未接线**：`certifyMutualSign`（§5.5）**仅测试调用** ⇒ 双人互验在数字轨与模拟器均不可达~~ ⇒ **已修**（B67 端到端接线：① **新增 Action 成员** `CERTIFY_MUTUAL_SIGN`（待认证者本人给另一位待认证者签印 —— 与 `CERTIFY_SIGN` 语义不同、不可复用）；② 引擎 `certifyMutualSign` 守卫收紧（双方都在待认证 ∧ 非自己 ∧ **本轮未用过机会**）；③ 枚举层 + 面板层 + UI 按钮 + 模拟器策略**四层齐备** ⇒ 机制真正可达；④ 双方互签即各自达标 ⇒ **不产生死锁**（规格 §5.5）。⚠️ 平衡影响：平均席位 1.71 → **2.10**（双人局不再卡死）） | `engine/core/action.ts`；`engine/core/certification.ts`；`engine/core/legal.ts`；`web/legal-gate.ts`；`web/ui/cert.ts`；`tests/engine/mutual-sign.test.ts` |
| G-e | ~~README 门禁表缺第 ⑩ 道（浏览器 E2E）~~ ⇒ **已修**（B51 补全，现为十四道门） | `README.md` 门禁表、`tools/gate.mjs` |
| G-f | ~~**对峙选牌没有 `Action` 成员**：对峙未决时行动面整体关闭 ⇒ `candidatesOf` 对**所有座位**为空 ⇒ 真人必须选暗牌的时刻，AI/sidecar 拿到空动作表~~ ⇒ **已修**（B68 端到端接线：① **新增 Action 成员** `DUEL_SUBMIT_CARD {actor, cardId}`；② 引擎枚举层在**对峙面**发候选（**取代**行动面）⇒ 对峙参与者拿到「锁定自己手牌里的一张」的候选；③ **可见性边界**（预研红线 3）：候选**只发给对峙参与者**且**只含自己手牌** ⇒ 拿不到对方手牌 id ⇒ 无法看到对方将出什么牌；④ 探针补该动作的一句话语义 ⇒ 影子决策不再在峙面崩） | `engine/core/action.ts`；`engine/core/legal.ts`；`engine/core/probe.ts`；`web/legal-gate.ts`；`tools/laya-probe/state-text.mjs`；`tests/engine/duel-action.test.ts` |
| G-g | ~~**复议裁定无人调用**：`resolveAppeals` 在 `engine/**` 与 `web/**` **零调用方**（只有 `tests/sim/run.mjs`）⇒ 新增的复议票写入一个没人关闭的窗口~~ ⇒ **已修**（B63 接线：轮末结算 `advanceCertificationRound` 对每个已申请复议的待认证者调 `resolveAppeals` ⇒ **投票窗口必关闭**；且 `applyAppealOutcome` 裁定后清 `appealed` ⇒ 不会重复裁定。⚠️ 实测：修复前生产路径下待认证者**申请复议即永远不被结算**（卡在峰顶）。**B64 补 T2**：面板显示复议窗口状态（第三方人数 / 已投 / **未投点名谁** / 窗口**轮末**关闭）⇒ 玩家不再只能干等；且「独立第三方」口径收敛为引擎单一事实源（`appealThirdParties`）⇒ UI / 探针 / 裁定三处同源） | `engine/core/certification.ts`（`advanceCertificationRound` / `applyAppealOutcome` / `appealThirdParties`）；`web/ui/cert.ts`；`tests/engine/goals.test.ts`；`tests/engine/appeal-window.test.ts` |
| G-h | **少发牌是静默的**：`createInitialState` 默认 `deckSize=40`，而 `dealInitialHands` 需要 `players × handStart`（8 人 = 56）⇒ 高人数下座位手牌偏少 | `engine/core/state.ts:251`；`engine/core/hand.ts` |
| G-i | **身份目标可达性（B61 登记 · B75 收敛两类 · B75.1 收口强度）**，根因**分两类**：① ~~**机制缺失**：`equip_count`（无「装备」动作入口）、`veto_success`（**仲裁者否决放逐未实现**）⇒ 事件永不发生，补计数器只会造出「永远为 0 的**假可达**」~~ ⇒ **已修（B75）**：新增 `EQUIP_CARD`（`performAction(…, "equip")`：手牌→装备区、免费、不占手牌上限、关隘/裂隙暂停中不可用）与 `COUNCIL_VETO`（`useCouncilVeto`：每局 1 次，硬前置是**所有存活玩家都已投票**；只有**真的阻止了一次放逐**才写 `vetoCount` 并即时结算目标）⇒ 实测 `veto_success` 达成 3512 人次、`equip_count` 1040 人次（B74 报告恒 0）；⚠️ **B75.1 追加「只可救他人、不可自救」**（R7 方案 3）：自救等于每局一次的放逐免疫，曾把仲裁者胜率抬到 24–28%（身份极差 18.6pp）；禁掉自救后回落到 **11.9–13.4%**、身份极差 **4.3–4.6pp** ⇒ 身份锁收回原值 12pp、位次锁保留 5.5pp（实测已贴近上沿）；② ~~**阈值/策略未达标**~~ ⇒ **B75.2 收口（根因更正）**：真正根因是 **B1 契约回合末清零从未接线**（`clearTurnStates` 零调用方 ⇒「每回合 1 次」类被动实际每局 1 次，阈值 5/3 策略层面不可达）；`endRound` 接线 + `moveBonus` 改用后清零 + AI 追goal分支（goalPursuit，全程 p=0.2 占位概率）⇒ 实测 `reroll_count` 达成 **9763** / `steal_count` **3275** 人次（24000 局）；连带 **R8**：清零接线让开拓者「每回合首移 +1」首次真正生效（12.6% → ~22%），身份锁 12 → 15pp（用户裁定），开拓者削弱归专门批次 | `engine/core/action.ts`；`engine/core/turn-runner.ts`；`engine/core/council.ts`；`engine/core/legal.ts`；`engine/goals/settle.ts`；`tests/engine/goals-reachability.test.ts`；`docs/balance-report.md` |

> ⚠️ **粗筛故意窄于引擎的五条**（`pendingCert` / 对峙未决 / `phase` / `isRoundEnd` / 死亡座位）是**登记过的口径**，
> 不是待修的 bug —— 枚举层刻意比引擎严，免得给模型一条玩家点不到的选项；逐条取证见
> `tests/engine/legal-probe.test.ts` 的「§7 粗筛窄于引擎五处·其一～其五」。

## 文档

- 规格：`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`
- 实施计划：`docs/superpowers/plans/2026-11-07-creative-mountain-liveness-implementation.md`
- 平衡报告：`docs/balance-report.md`（24000 局模拟，自动生成）
- 批次执行记录：`docs/批次/`
- 协作者入口：`AGENTS.md`（纪律与索引）· `CLAUDE.md` · `HANDOVER.md`（交接）· `TODOS.md`（在办清单）
- 路线图：`ROADMAP.md`（已发布 / 在途 / 未决遗留）

## 许可证

本项目采用 **GNU General Public License v3.0（GPL-3.0）**，完整文本见 [LICENSE](LICENSE)。

> ⚠️ GPL-3.0 是**传染性**许可：分发本项目的**衍生作品**必须同样以 GPL-3.0 开源。
> 第三方依赖保留各自许可（例如可选的 Laya sidecar 为 Apache-2.0、host 原型的 `sparkdesign` 为 MIT）。

## 参与贡献

欢迎 Issue 与 PR。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)（含**门禁纪律**与**负样本规范**）、
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；安全问题见 [SECURITY.md](SECURITY.md)。

- 改动清单见 [CHANGELOG.md](CHANGELOG.md)；
- 门禁口径与职责见 [docs/沉淀/门禁清单.md](docs/沉淀/门禁清单.md)（**十四道门**）。