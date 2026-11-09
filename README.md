# 创界山·活人认证（2026 重制版）

《爱情公寓 3》中陆展博桌游《创界山》的 2026 重制版：**实体 + 数字双轨**。
3–8 人，桌游策略 + 社交博弈；核心命题是——**登顶不是胜利**。

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
npm run gate           # 十三道门禁全跑
```

## 门禁（`node tools/gate.mjs`）

| # | 门 | 作用 |
|---|---|---|
| ① | 类型 | `tsc --noEmit`，TS strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes |
| ② | 测试 | `node --test`，单元 + 门禁自检（负样本常驻） |
| ③ | 文档口径 | 规格 ↔ 代码真值双向一致（C1–C10，含 **C8 覆盖边界逐条对应**） |
| ④ | 构建 | esbuild 单文件 HTML |
| ⑤ | 主题包校验 | 四套主题的结构、引用完整性、**参数取值域** |
| ⑥ | IR 契约 | 四套主题的 ir.json ↔ IR 类型契约 |
| ⑦ | 双轨一致性 | IR/SVG 精确比对 + 数值溯源 + PDF 粗检（4 套 × 4 级） |
| ⑧ | 主题差异化 | 规格 §10.1 两张清单的机械判定 + **跨主题术语串戏** |
| ⑨ | 规模与平衡 | 30 局冒烟：零异常 + 兜底触发率 < 15% |
| ⑩ | 对峙端到端 | Playwright 真浏览器：触发对峙 → 回合锁定 → 选牌 → 揭晓 → 解锁 |
| ⑪ | 试炼通过率平衡 | 12 张试炼牌实测通过率 vs 目标区间（单色≈95% / 单类型≈55% / 类型+颜色≈20%） |
| ⑫ | 位次极差回归锁 | 固定 seed + 固定局数 ⇒ 确定性：最大极差 ≤ 11pp 且 RMS 偏离 ≤ 4.5pp |
| ⑬ | 余量判定离线回归 | 用已发布的多 seed 数据重算 Welch t 与精确临界值 ⇒ 判定不漂移 |

## 目录

```
engine/     引擎：状态、回合机、57 算子、15 谓词、认证与山议
web/        数字轨 UI（单文件 HTML 入口）
themes/     四套主题包（数据）
build/      构建脚本：主题生成器、实体件管线、发布包
tools/      十三道门禁的实现
tests/      单元与门禁负样本；tests/sim/ 是规模与平衡模拟器
docs/       规格、实施计划、批次执行记录、平衡报告
print/      实体轨产物（按主题分目录）+ 规则书叙述模板
```

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
  观星者「每回合看牌堆顶 1 张」· 仲裁者「山议 2 票」· 守夜人「回合末 1 点护盾」·
  窃火者「每回合偷 1 枚灵枢」· 织梦者「每回合 1 次改自己的险径判定」· 山主「首次被质疑自动视为签印」。
  主动型被动在行动阶段「发动被动」按钮使用；触发统计见 `docs/balance-report.md` 的「身份被动触发统计」。
- **对峙已落地**（B13）：同格相遇 ⇒ 双方各自选 1 张牌、选完同时揭晓（红 > 黑 → 同色比点数 → 平局各弃 1 张 →
  败者后退 1 格并抽 1 张牌）；此前引擎里只有一个无人调用的半成品算子，对峙**完全不可达**。
  触发统计见 `docs/balance-report.md` 的「对峙统计」。
- **规则书尚未覆盖地形规则**：规格 §3.4 的福地 / 险径 / 裂隙 / 关隘 在实体规则书里仍无对应章节（待补）。
- 主题包的**全量差异化**（各自独立的卡牌池 / 事件池 / 身份设计）属 V1.1 范围。

### 动作契约层的未接线项（B15 登记，逐条现查于 2026-11-09）

> 这些是**「UI 与 AI 使用同一枚举」**这条契约的已知缺口：引擎动作契约与实际接线不同步的地方。
> 证据路径逐条给出，便于复核；括号内是本仓的缺陷编号。

| # | 事实 | 证据 |
|---|---|---|
| G-a | ~~**出牌费用无权威语义**：规格 §3.1 未写支付、引擎 `performAction` 的 `act` 分支**既不校验也不扣**、UI 手牌区只显示不拦、仅模拟器把 `cost <= resource` 当资格线 ⇒ 数字轨可**免费出牌**~~ ⇒ **已修**（B65 裁定为**出牌付费**：打出卡牌须支付该牌 `cost`（规格 §3.1「行事」/§4.3 已补）⇒ **灵枢不足即引擎拒绝**（不扣、不出牌）；UI `uiBlockNotice` 同款拒因并点名「灵枢不足」；枚举层由**引擎自己拒**、试跑如实反映（不另写 `cost` 镜像判据）。⚠️ 连带后果已处置：付费使资源成为真约束 ⇒ 8 人档出现**真实**位次偏差 ⇒ 门 ⑫ 与统计口径阈值已按跨 10 组独立样本**重校准**（规格 §5.8/§9.2 有 B65 补记）） | `engine/core/turn-runner.ts`（`act` 分支）；`engine/core/balance.ts`（阈值单一事实源）；`web/legal-gate.ts`；`tests/engine/card-cost.test.ts`；`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` |
| G-b | ~~**待认证锁定只在调用方生效**：引擎 `act` 分支**不查** `pendingCert`（`move` 分支查）⇒ 锁定者可用位移牌绕过 §5.1 锁定；枚举层按 UI 规则排除，但引擎本身未加固~~ ⇒ **已修**（B66 引擎层加固：规格 §5.1 早已写明「待认证者**不能使用移动类卡牌或位移能力**」⇒ 本批只补**实现**、规格零改动。`act` 分支查 `pendingCert` ⇒ 锁定者打**含位移**的牌被引擎拒绝（引用相等 = 探针认得的拒绝信号）；⚠️ **只拦位移类**（攻击 / 防御 / 资源牌照打 —— 规格只禁位移，不禁一切行动）；⚠️ 位移判据按 **op 语义**、**不只看 `card.type === 'motion'`**（主题包有一张 utility 类型的位移牌）） | `engine/core/turn-runner.ts`（`act` 分支）；`engine/core/targeting.ts`（`cardHasMovement`）；`tests/engine/pending-cert-lock.test.ts` |
| G-c | ~~**`gatesPassed` 无生产写入方**：四套主题各有一个身份目标是 `pass_gates`，而计数器只被**读取**（`engine/goals/registry.ts`）⇒ **4 个身份目标在数字轨永不可达**（B18 关隘接线后仍缺写入）~~ ⇒ **已修**（B60 补齐三环：计数写入 `markGatePassed` + 判定调用 `goals/settle.ts` + 达成即发【印记】；实测 `pass_gates` 达成 **498 次 / 24000 局** ⇒ 目标真实可达） | `engine/core/gate.ts`；`engine/goals/settle.ts`；`tests/engine/goals.test.ts` |
| G-d | **双人互验未接线**：`certifyMutualSign`（§5.5）**仅测试调用** ⇒ 双人互验在数字轨与模拟器均不可达 | `engine/core/certification.ts:431`；唯一调用方 `tests/engine/live-seats.test.ts` |
| G-e | ~~README 门禁表缺第 ⑩ 道（浏览器 E2E）~~ ⇒ **已修**（B51 补全，现为十三道门） | `README.md` 门禁表、`tools/gate.mjs` |
| G-f | **对峙选牌没有 `Action` 成员**：对峙未决时行动面整体关闭 ⇒ `candidatesOf` 对**所有座位**为空 ⇒ 真人必须选暗牌的时刻，AI/sidecar 拿到空动作表 | `engine/core/legal.ts`（行动窗口关闭条件）；`engine/core/duel.ts` |
| G-g | ~~**复议裁定无人调用**：`resolveAppeals` 在 `engine/**` 与 `web/**` **零调用方**（只有 `tests/sim/run.mjs`）⇒ 新增的复议票写入一个没人关闭的窗口~~ ⇒ **已修**（B63 接线：轮末结算 `advanceCertificationRound` 对每个已申请复议的待认证者调 `resolveAppeals` ⇒ **投票窗口必关闭**；且 `applyAppealOutcome` 裁定后清 `appealed` ⇒ 不会重复裁定。⚠️ 实测：修复前生产路径下待认证者**申请复议即永远不被结算**（卡在峰顶）。**B64 补 T2**：面板显示复议窗口状态（第三方人数 / 已投 / **未投点名谁** / 窗口**轮末**关闭）⇒ 玩家不再只能干等；且「独立第三方」口径收敛为引擎单一事实源（`appealThirdParties`）⇒ UI / 探针 / 裁定三处同源） | `engine/core/certification.ts`（`advanceCertificationRound` / `applyAppealOutcome` / `appealThirdParties`）；`web/ui/cert.ts`；`tests/engine/goals.test.ts`；`tests/engine/appeal-window.test.ts` |
| G-h | **少发牌是静默的**：`createInitialState` 默认 `deckSize=40`，而 `dealInitialHands` 需要 `players × handStart`（8 人 = 56）⇒ 高人数下座位手牌偏少 | `engine/core/state.ts:251`；`engine/core/hand.ts` |
| G-i | **其余 4 类身份目标仍不可达**，根因**分两类**（B61 实测 · 计数实际值分布）：① **机制缺失**：`equip_count`（`equip_card` 四套主题**零使用者**、规格无「装备」动作入口）、`veto_success`（**仲裁者否决放逐未实现**）⇒ **事件永不发生** ⇒ 补计数器只会造出「永远为 0 的**假可达**」；② **阈值/策略未达标**：`reroll_count`（阈值 3，实际计数最大 **2**）、`steal_count`（阈值 5，实际计数最大 **1**）⇒ **计数已在写**，只是没达标 | `engine/goals/settle.ts`；`docs/balance-report.md`（目标计数器的实际值） |

> ⚠️ **粗筛故意窄于引擎的五条**（`pendingCert` / 对峙未决 / `phase` / `isRoundEnd` / 死亡座位）是**登记过的口径**，
> 不是待修的 bug —— 枚举层刻意比引擎严，免得给模型一条玩家点不到的选项；逐条取证见
> `tests/engine/legal-probe.test.ts` 的「§7 粗筛窄于引擎五处·其一～其五」。

## 文档

- 规格：`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`
- 实施计划：`docs/superpowers/plans/2026-11-07-creative-mountain-liveness-implementation.md`
- 平衡报告：`docs/balance-report.md`（24000 局模拟，自动生成）
- 批次执行记录：`docs/批次/`