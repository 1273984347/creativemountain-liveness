# 创界山·活人认证 — 设计链路归档索引

> 本文件是 `spark-output/` 设计产物链路的归档导航。项目为《爱情公寓》虚构桌游「创界山」2026 重制的体验调优（命题：**登顶≠胜利，被全桌当场验明「是活人」才赢**）。

## ⚠️ 诚实标注（请先读）

- 本链路 **probe 采集 0 真人数据、项目未上线、无埋点**。除「范围纪律（out_of_scope 遵守）」外，方向 A 与关键假设 **验证结论一律为 inconclusive**。
- 下游/新团队消费时，**不得把假设性产物当已验证洞察**；Retro 的 outcome 判定均为待真人局回填。
- 唯一能证伪方向 A 的实验：**跑一场 6 人真人局 + 观察协议**（probe 已备好方案与大纲）。
- **2026-11-23 新增子链（§E）同样 0 真人数据**：其 NSM 是**减法**（A 组 − B 组），在 8 局实拍跑完之前**一个数都没有**；该子链的 `bench` 证据为**文档级、零截图**，不得表述为"实测过竞品界面"。
- 子链的**范围前提**：本方向与本文档 §A 的 `brief.out_of_scope` 第 4 条「不做 AI 陪练对手」及主规格 `:1055`「V1 不做 AI 陪练」**直接冲突**，改口径（Ask 3）尚未办理——**在 Ask 3 完成前开工即属违规施工**。

---

## A · 链式上下文（结构化，供下游 Skill / 下个项目复用）

目录：`spark-output/context/` — 17 个 JSON（下表 12 个为 2026-11-07 **主链**；2026-11-23 **AI 补位子链** 5 个见 §E）

| 文件 | 作用 |
| --- | --- |
| `frame.json` | 问题框定：persona 大林、方向 A/B/C、关键假设#1、压力测试 |
| `probe.json` | 研究方案与访谈大纲（**0 数据**，status=plan_ready_data_pending） |
| `brief.json` | 设计一页纸：业务目标/用户/3 策略维度/设计标准/约束 |
| `journey.json` | 单局体验旅程 6 stage、情感曲线、2 个 dropout-risk |
| `stories.json` | 6 个用户故事（P0 三支柱 + P1），含设计触点与 AC |
| `sitemap.json` | 多端 IA（Web 主屏 + 手机私牌端）、25 页、5 跨端 flow、existing/refactor/gap |
| `flow-web.json` | 主屏 4 flow / 14 屏结构、组件库=sparkdesign、技术栈、验证记录 |
| `check.json` | 设计走查 v2 findings（0 Blocker / 0 Major / 8 Minor）+ Mode C 一致性表 |
| `edge.json` | 异常态矩阵：14 屏 37 态（16 must 全落码 + 12 should/nice backlog） |
| `qa.json` | 还原度验收（0/0/5 minor）+ 修复状态 + Check 反向核对 |
| `retro.json` | 全链复盘：decision/assumption 验证、worked/didnt/surprises、recommendations |
| `_session-state.json` | 链路断点恢复通道（compaction 用） |

## B · 人类可读产物

| Skill | 文件 | 大小 | 说明 |
| --- | --- | --- | --- |
| Brief | `spark-output/brief/创界山-活人认证.html` | ~60KB | 一页纸 Chalk 横版，双击浏览器打开/可导 PNG |
| Journey | `spark-output/journey/创界山-活人认证.html` | ~16KB | 旅程地图 HTML（假设性红章 + 情感曲线） |
| Stories | `spark-output/stories/strategy-live-certification.md` | ~14KB | 6 故事全文 + 索引表 |
| Sitemap | `spark-output/sitemap/creativemountain-liveness.md` | ~15KB | 站点树 + Mermaid + 路由表 + 跨端 flow + 现状/缺口地图 |
| Check | `spark-output/check/创界山-活人认证-走查报告.md` | ~6KB | v2 走查报告（含 v1 三 Major 回归确认） |
| Edge | `spark-output/edge/创界山-活人认证-异常态.md` | ~18KB | 6 类状态矩阵 + 每态三件套 + critical_missing |
| QA | `spark-output/qa/创界山-活人认证-验收报告.md` | ~6KB | 9 维还原度 + Check finding 反向核对 |
| Retro | `spark-output/retro/creativemountain-liveness.md` | ~13KB | 全链复盘 + Lessons 卡片 + Recommendations |
| 链路面板 | `spark-output/dashboard.html` | ~30KB | 5 阶段 × 27 节点进度看板（当前 **15/27**，含 11-23 子链 bench/pitch/metric/prd） |

## E · 2026-11-23 子链：AI 补位座位（稳座档）

> 编号沿用子链内部命名（与 `spark-output/context/*` 里的 §E 交叉引用一致），**位置提前到 B 之后**便于与主链对照阅读；C（React 原型）与 D（既有工程）仍为主链件。

**命题**：约好的 6–8 人局差一个人时，由一个程序座位顶上——KPI 是「不塌」（合法、不卡轮、不冷场），**故意不最优**；买单的是大林，**打分的是桌上另外 5 个会玩的人**。主锚点仍是 `context/frame.json`（11-07），子链另立 `frame-ai-seat.json`，**未覆盖主锚点**（转正需显式拍板）。

### 上下文（`spark-output/context/`）

| 文件 | 作用 |
| --- | --- |
| `frame-ai-seat.json` | 子链方向锚点：疤痕因果链=凑数的人不会玩/撑不住、5 机会点、三方向（稳座/点名/装置）、押稳座、6 条压测条件 |
| `bench.json` | 6 竞品 × 4 维度、功能矩阵 T1–T7、18 条 takeaways（borrow 8/avoid 7/match 3）、lean-in（仅座位标识层）。⚠️ 文档级证据、零截图 |
| `pitch.json` | 6 段叙事（听众=签字人自己）+ **5 个 Asks 的四元字段** + `decision_outcomes[6]`（含"建议 B、用户选 A"的_override 记录_） |
| `metric.json` | NSM=补位名场面增益（A−B）、5 Drivers / 6 Counters / 5 Health、12 项埋点缺口（10 must）、4 条方法论危害、6 条失败阈值 |
| `prd.json` | 8 段工程交付摘要、5 个开工前置的**裁定值**、G3 冲突全记录、设计资产零命中核验、28 条 AC 反向链 |

### 人类可读产物

| 文件 | 说明 |
| --- | --- |
| `frame/ai-seat.md` | 子链 Frame 全文（persona 卡 + 机会点 + 我押 + 条件） |
| `bench/ai-seat-fill.md` | 竞品拆解全文（含证据类型声明与 D→C 对应表） |
| `pitch/ai-seat-fill.md` | Pitch 全文（6 段 + 5 Asks 表 + 判错信号） |
| `metric/ai-seat-fill.md` | 度量蓝图全文（NSM / 四层 / 埋点清单 / 验收反向链） |
| **`metric/playtest-field-sheet.md`** | **Ask 4 执行件：可打印当场表 + 局前 8 闸 + 8 局排期 + 判读表**（唯一能把子链从"已裁"推到"有数据"的东西） |
| `prd/ai-seat-fill.md` | 8 段 PRD（386 行 / 5 Story / 28 AC；§0.1 记 G3 冲突） |
| `prd/gates-decision-sheet.md` | 开工前置裁决单 + **✅ 已裁记录**（A / yes / 拆两态 120s）+ A 造成的判读规则修订 |

### 裁定与落地状态（裁定 2026-11-23T04:05，签字人=用户本人；Ask 3 落地 04:5x）

- ✅ **Ask 1 = A**（AI 无签印权、不持活人席）⇒ 不动 `engine/scales.ts`、**不重基线**；代价＝A−B 混入第二变量，故增益 ≤0 时必须补跑 **A′（B 选项）**，实拍局 6 局 → **8 局**。
- ✅ **Ask 2 = yes**（v1 只做稳座）⇒ 不碰 sidecar，三条红线一条不掀；与 B82 模型批**互不依赖、可并行**（B81/B82/B83 均已在编，补位须另取顺延号）。
- ✅ **G3 = 拆两态** `seat_offline_temporary` / `seat_filled_by_ai`，两旋钮各 **120s**。
- ✅ **G5 = web 单文件端落地**（Host 原型不接引擎，`mock-data.ts:1`）。
- ✅ **Ask 3 已办**（规格升 **v2.2**）：§7 范围裁定改写（三条理由逐条处置，v1.2 原文照录于「裁定沿革」块，**未推翻任何一条**）+ 新增 **§7.5 补位稳座**（定义 / KPI「不塌」/ 硬约束 C1–C10 / 验收判据 / 开放项）+ **四处范围条款同步**（概览 `:79`、§7 `HeuristicPolicy` 句、§13.2 范围表、§13.3 延后表）+ 修订记录 v2.2；`brief.out_of_scope` 第 4 条按 **(b)** 加限定语澄清、**不放宽**。
- ✅ **门禁工具修复**（提交 `d153af9`）：行尾负样本不再依赖源 EOL（`tests/gates/harness.ts` 单一口径 `toLf` / `toCrlf` / `assertCrlfInjected`）；补上 `doc-sync-c8-negative` 缺失的 prove-injection（原为**静默假绿**）；新增 `.gitattributes`（`* text=auto eol=lf` + 二进制豁免）。该发现登记为 **L-B80-4（收口后补登）**。验证：`tsc` 0 错、两文件合跑 20/20、`npm run gate` ⇒ **13 门全绿**。
- ⚠️ **仍待办**：Ask 4 定日期并按 8 局排期 · Ask 5 可 ban 开关 · G4 `seed` 可指定并进导出（现写死 42）· S1/S3 施工（G1–G3 已解锁，S3 的 `certifyAnswer` 替代方案仍是开放项）。

> **一句话给下一轮**：子链的工程缺口不在模型（启发式就够），在**宿主层三件**——统一提交口 `applyAction`、`Player.controlledBy`、墙钟计时；以及一个会让所有跨局结论作废的 `seed: 42`。



## C · 主屏 React 原型（flow-web 产物）

目录：`creativemountain-host/`

- 源码：`src/App.jsx`、`src/main.jsx`、`src/flows/host-screen/host-screen.tsx`、`src/flows/flow1..4-*.tsx`、`src/flows/shared/{types.ts,mock-data.ts}`
- 配置：`vite.config.js`、`package.json`、`index.html`
- 技术栈：React 19 + Vite 8 + Spark Design 0.4.11 + Tailwind 4（theme=parchment/style=compact）
- 运行：`cd creativemountain-host && npm install && npm run dev`（http://localhost:5173）
- 门禁：`npm run build` 与 `npm run lint`（oxlint）当前均 **0 错误**
- 说明：这是**设计原型**（探索/验证主屏 IA + 交互 + 异常态），与仓库既有的 `web/`（vanilla-TS 单文件热座）是两套 UI 栈；`engine/` 纯 TS 引擎可复用。

## D · 本链路之前的既有工程（非链产物）

`engine/`（纯 TS 引擎 + 9 道门禁）· `web/`（原 vanilla-TS 单文件热座 UI）· `tests/` · `print/` · `themes/` · `docs/` · 根 `dist/`

---

## 归档建议（版本库取舍）

- **纳入**：`spark-output/**`（context + 各报告 + dashboard + 本 README）、`creativemountain-host/` 的 `src` + 配置 + `package.json`/`package-lock.json`。
- **不纳入**：`node_modules/`（实测 ~429M）、两个 `dist/` 构建产物 —— 仓库 `.gitignore` 已忽略 `node_modules/` 与 `dist/`，按需重装/重建即可。
- **去重**：`creativemountain-host/spark-output/context/` 是 flow-web 初始化时从根 `spark-output/context/` 复制的副本；归档保留根目录一份即可，另一份可删或忽略。

## 结转的缺口（下一轮 / 下个项目）

- **真人 playtest 0 人** —— 假设#1 唯一证伪实验，最高优先。
- **metric 已跑，但只覆盖 AI 补位子链**（`context/metric.json`，2026-11-23）——主链「单局 ≥3 次全桌集中 / 铺垫人均分心 <2」两项仍无**无补位场景**下的埋点载体；且蓝图里 10 项 must 埋点**尚未落码**，Retro 的假设验证因此仍停在 inconclusive，直到 §E 的当场表跑完 8 局。
- **flow-mobile 未跑** —— 多端已定，手机私牌端（私密手牌/出题/签印/投票/复议/旁观）未落地。
- **host↔phone 实时同步层未实现** —— 原型用 mock，多端为纸面架构；须保留引擎与九道门禁、仅拆分 UI。

*生成于 2026-11-08 · product-design 链路（frame→probe→brief→journey→stories→sitemap→flow-web→check→edge→check v2→qa→retro）*
