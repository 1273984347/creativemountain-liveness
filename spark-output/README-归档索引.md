# 创界山·活人认证 — 设计链路归档索引

> 本文件是 `spark-output/` 设计产物链路的归档导航。项目为《爱情公寓》虚构桌游「创界山」2026 重制的体验调优（命题：**登顶≠胜利，被全桌当场验明「是活人」才赢**）。

## ⚠️ 诚实标注（请先读）

- 本链路 **probe 采集 0 真人数据、项目未上线、无埋点**。除「范围纪律（out_of_scope 遵守）」外，方向 A 与关键假设 **验证结论一律为 inconclusive**。
- 下游/新团队消费时，**不得把假设性产物当已验证洞察**；Retro 的 outcome 判定均为待真人局回填。
- 唯一能证伪方向 A 的实验：**跑一场 6 人真人局 + 观察协议**（probe 已备好方案与大纲）。

---

## A · 链式上下文（结构化，供下游 Skill / 下个项目复用）

目录：`spark-output/context/` — 12 个 JSON

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
| 链路面板 | `spark-output/dashboard.html` | ~30KB | 5 阶段 × 27 节点进度看板（当前 11/27） |

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
- **metric 未跑** —— `brief.design_criteria` 定量项（单局 ≥3 次全桌集中 / 铺垫人均分心 <2）无埋点载体，导致 Retro/假设验证停在 inconclusive。
- **flow-mobile 未跑** —— 多端已定，手机私牌端（私密手牌/出题/签印/投票/复议/旁观）未落地。
- **host↔phone 实时同步层未实现** —— 原型用 mock，多端为纸面架构；须保留引擎与九道门禁、仅拆分 UI。

*生成于 2026-11-08 · product-design 链路（frame→probe→brief→journey→stories→sitemap→flow-web→check→edge→check v2→qa→retro）*
