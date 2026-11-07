# 《创界山·活人认证》实施计划

> 对应规格：`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` v1.3
> 计划版本：v1.0　　日期：2026-11-07
> 技术栈：**TypeScript（strict）** + esbuild + 原生 DOM，零运行时依赖

---

## 0. 全局约定

### 0.1 技术栈与三条硬性执行细节

**TypeScript 不是偏好，是四层契约的强制对齐工具**：`State` 的不可变性、`Action` 的可辨识联合、`ops` 的参数变体、`goal` 的 kind 枚举——任何一层用纯 JS 写，B2 的「能表达 4 套主题包全部效果」验收都会退化成人工肉眼核对。esbuild 原生支持 TS，构建成本接近零。

| # | 规则 | 原因 | 落位 |
|---|---|---|---|
| 1 | **构建链两条独立命令**：`tsc --noEmit`（类型门禁）+ `esbuild`（打包）。**esbuild 不做类型检查**，门禁先跑 `tsc`，红了不许打包 | 类型错误若只在运行时暴露，B2 验收就失去机械判据 | B1 验收 |
| 2 | **`tsconfig` 开 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** | `board[i]`、`deck[0]`、`players[activePlayer]` 是高频操作；不开 `noUncheckedIndexedAccess` 等于把「越界返回 undefined」的运行时炸弹全留给测试 | B1 tsconfig 基线 |
| 3 | **主题包类型与校验器同源**：`engine/types/theme.ts` 定义 `ThemePack`，`tools/theme-validate.mjs` 从该类型生成 JSON Schema | 否则类型与校验各写一套，必然漂移 | B4 验收 |

### 0.2 依赖关系

```
B1 ──► B2 ──► B3 ──► B5
 │      │      │
 │      ▼      ▼
 └──► B4 ──► B6 ──► B7
        │
        ▼
       B8 ──► B9 ──► B10
```

- **串行关键路径**：B1 → B2 → B3 → B4 → B6 → B7 → B8 → B9 → B10
- **可并行**：B5 在 B3 完成后独立推进（用最小测试主题）；B9 模拟框架可在 B3 后先搭骨架。
- **B6 与 B7 必须并行设计、串行验收**：`ir.json` schema（规格 §6.7.1）在 B6 开工前定稿，B7 依此实现；B6 先交 ir.json，B7 再验漂移。**不可颠倒。**

### 0.3 门禁体系（V1 已落地）

| 门 | 工具 | 作用 | 负样本常驻化 |
|---|---|---|---|
| ① 类型 | `tsc --noEmit` | TS strict 全量类型检查 | ✅ |
| ② 测试 | `node --test` | 单元 + 门禁自检 | ✅ |
| ③ 文档口径 | `tools/doc-sync.mjs` | 规格 ↔ 代码真值双向一致 | ✅ |
| ④ 构建 | `esbuild.config.mjs` | 单文件 HTML | — |
| ⑤ 主题包校验 | `tools/theme-validate.mjs` | **全部**主题包的结构 + 引用完整性（无参即全扫） | ✅ |
| ⑥ IR 契约校验 | `tools/ir-validate.mjs` | ir.json ↔ IR 类型契约 | ✅ |
| ⑦ 双轨一致性 | `tools/parity-check.mjs` | IR/SVG 精确比对 + 数值溯源 + PDF 粗检 | ✅ |
| ⑧ 主题差异化核对 | `tools/theme-diff-check.mjs` | 规格 §10.1 两张清单的机械核对 | ✅ |

> 门数从 5 → 8：PDF 归一化本就是 ⑦ parity-check 内部的一环（`tools/pdf-normalize.mjs`），不算独立门；
> ⑤⑥⑦⑧ 为 B6–B8 陆续接入。**门数声明 == 实跑门数**由 `tools/gate.mjs` 自断言。

一键：`node tools/gate.mjs`（串行、全绿 exit 0、任一红 exit 1，且**门数声明 == 实跑门数**否则自断言失败）。

三条纪律（均来自实测踩坑）：

1. **管道会吞退出码** —— 门禁不经 shell 管道，退出码直取。
2. **Windows 上 `shell:false` 不能 spawn `.cmd`** —— 门禁直接跑底层工具（node / tsc），不走 npm 包装层。
3. **在 test runner 内再 spawn 一个 test runner，必须清 `NODE_TEST_CONTEXT`** —— 否则内层 `node --test` 会误以为自己是子测试进程，**不扫 glob**，负样本假绿。

### 0.4 批次间门禁

每批次结束必须满足 **`node tools/gate.mjs` 全绿**（4 门：类型 / 测试 / 文档口径 / 构建），且该批次新增规则在规格文档已有对应条款（**无「代码先行、文档后补」**）。

门禁本身的纪律见 §0.3——其中「管道会吞退出码」「Windows 不能 spawn `.cmd`」「test runner 内再 spawn test runner 要清 `NODE_TEST_CONTEXT`」三条都是本项目实测踩出来的，不是理论。

---

## 1. 批次总表与工期

| 批次 | 目标 | 预估 | 并行性 |
|---|---|---|---|
| B1 | 引擎骨架 | 3–4 天 | 串行起点 |
| B2 | 机制原语 | 5–7 天 | 依赖 B1 |
| B3 | 核心玩法闭环 | 6–8 天 | 依赖 B2 |
| B4 | 主题包 ×1（仙侠 2026） | 4–5 天 | 依赖 B2，**可与 B3 并行** |
| B5 | 数字轨 UI | 7–10 天 | 依赖 B3，**可与 B6 并行** |
| B6 | 实体轨管线 | 5–7 天 | 依赖 B4 |
| B7 | parity-check | 2–3 天 | 依赖 B6 |
| B8 | 主题包 ×3（最小可行） | 6–9 天 | 依赖 B4 |
| B9 | 规模与平衡 | 3–5 天 | 依赖 B3/B4/B8 |
| B10 | 收官 | 2–3 天 | 依赖全部 |

- **关键路径**（全串行）：≈ **36–49 天**
- **乐观并行**（B3∥B4、B5∥B6、B8∥B9 前半段）：≈ **28–38 天**
- 单人开发按乐观并行估：**约 6–8 周**

---
## 2. B1 — 引擎骨架

**目标**：State / Action / 回合机 / 骰子 / 移动 / 资源 / 手牌 / 地形，能在 Node 里空跑一局（无卡牌、无关隘、无认证）。

### 2.1 关键文件

| 文件 | 内容 |
|---|---|
| `tsconfig.json` | strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（§0.1 规则 2） |
| `esbuild.config.mjs` | 入口 `web/main.ts` → `dist/创界山-活人认证.html`，`--bundle --minify --format=iife` |
| `engine/types/theme.ts` | `ThemePack` 类型定义（B4 复用，§0.1 规则 3） |
| `engine/core/state.ts` | 不可变 `State` 与构造器 |
| `engine/core/action.ts` | 可辨识联合 `Action` 类型 |
| `engine/core/round.ts` | **round / turn 区分逻辑**（规格 §3.1 术语定义落地） |
| `engine/core/dice.ts` | 可复现随机源（seeded）、6 面移动骰、20 面指令骰 |
| `engine/core/board.ts` | 山道序列、分支、格位索引 |
| `engine/core/resource.ts` | 灵枢收支、上限、强制消耗 |
| `engine/core/hand.ts` | 手牌、牌库循环、裁牌 |
| `engine/core/terrain.ts` | 地形效果分派 |
| `tests/engine/smoke.test.ts` | 空跑一局 |

### 2.2 验收

- [ ] `tsc --noEmit` 零错误
- [ ] `node --test tests/engine/` 全绿
- [ ] esbuild 产出可加载的 HTML 骨架（棋盘空白、玩家位置可见）
- [ ] 空跑一局在 15 回合内结束，日志显示 `round` 与 `turnIndex` 正确推进
- [ ] **山议 / 认证检查仅在 round 末触发一次**（§3.1 术语定义的直接测试）
- [ ] **类型门禁独立于打包**：`tsc --noEmit` 失败时 `npm run build` 必须中断（脚本自检）
- [ ] **B1 State 契约已冻结**：`PlayerTurnState`（`moveBonus` / `usedAsk` / `movedThisTurn`）落地并有测试——回合末**一并**清零、且清零不误伤玩家其他状态（规格 §6.2）
- [ ] `State` / `Player` / `Decks` / `PlayerTurnState` 字段集**自此不再变更**：B2/B3 只实现逻辑，不新增或改名 State 字段

**预估**：3–4 天。

> **开工第一件事**：先写 `tsconfig.json` 与 `engine/types/theme.ts`，**不要先写逻辑**。类型契约定下来，后面每个批次都在这个骨架上长肉。

---
## 3. B2 — 机制原语

**目标**：ops registry + predicates + goal registry + 组合器，能表达 4 套主题包的全部效果。

### 3.1 关键文件

| 文件 | 内容 |
|---|---|
| `engine/ops/registry.ts` | 规格 §6.4 全部算子，每个含类型签名 + 实现 + 单测 |
| `engine/predicates.ts` | 规格 §6.4 全部谓词 + 单测 |
| `engine/goals/registry.ts` | §6.4 的 8 个 goal kind，每个含判定时机 + 计数器 + 单测 |
| `tests/engine/ops/` | 每个算子至少 1 用例 |

### 3.2 验收

- [ ] 8 个 goal kind 全部注册，各有单测，「达成即发印记」逻辑正确
- [ ] 13 + 2 个谓词全部注册，各有单测
- [ ] 用一份**临时测试主题**（覆盖所有 op 类型）跑通 `theme-validate`
- [ ] **参数盘点结论全部落地**：`docs/superpowers/plans/2026-11-07-ops-parameter-audit.md` 的 5 个新增算子 + 2 个新增谓词 + 作用域约定（target 可选 / amount 缺省 / 负数非法 / 失败 `ok=false` 且状态不变）全部实现，签名与该文档 §13 逐字段一致
- [ ] `getLegalActions()` 返回的每种 Action 都有对应枚举逻辑（无「返回了但引擎不认」的空洞）
- [ ] 组合器 `sequence` / `conditional` / `count` / `random_from_deck` 边界正确（空数组、无 else 分支、嵌套条件）

**依赖**：B1。　**预估**：5–7 天（算子多但各自独立，可并行）。

> **开工前动作（已完成）**：参数盘点已产出 —— `docs/superpowers/plans/2026-11-07-ops-parameter-audit.md`（379 行）。含 52 算子 + 13 谓词逐条参数表、作用域约定、签名草案，以及**盘点中发现的 7 处规格缺口**（已回写规格 §6.4）。
>
> **开工前 11 项裁定已全部落地**（规格 v1.4）：G1 `move_by_dice`（不引入参数求值器）；造物走**独立造物牌堆** `decks.creation`、`equip_card` 只计数不占手牌上限且无被动；**复活机制 V1 删除**（无死亡机制）；`NegativeStatus = 'poison'|'slow'|'silence'|'skip_turn'`；`CardFilter` 五字段 AND 且四算子共用；`CardType` 固定四值；**新增 `rank: number`（A=14）+ `rankLabel?`**（比较只读 rank）。另补**位移结算语义**三条：分段结算到达即停 / 行棋必须走满 / 待认证锁定，移动为**跳到位只结算终点格**。
>
> **B1 已按此回改**：`State.decks`（含 `creation`）、`Player.equipment`、`Card.rank`/`rankLabel` 均已落地（提交见仓库历史），类型门禁与 28 条测试全绿。

---
## 4. B3 — 核心玩法闭环

**目标**：关隘、山议（含 3 人局裁定）、活人认证全流程、胜负判定、回合上限兜底。

### 4.1 关键文件

| 文件 | 内容 |
|---|---|
| `engine/core/gate.ts` | 付费 / 试炼双路径 + 失败惩罚 |
| `engine/core/council.ts` | 山议投票 + 3 人局裁定 + 凭证 + 仲裁者否决 + 放逐下限 |
| `engine/core/certification.ts` | §5.2 门槛公式（含步骤 0 前置分支）+ §5.3.1–5.3.4 全流程 + §5.5 双人互验 |
| `engine/core/victory.ts` | §5.7 + §5.8 兜底排名 |
| `tests/engine/certification.test.ts` | §5.3 / §5.8 每条规则至少 1 用例 |

### 4.2 验收

- [ ] 3 人局完整跑通（含山议裁定、单次认证、兜底排名）
- [ ] §5.2 门槛公式的**步骤 0 前置分支**（双人同时待认证 → `base = 1`，不走印记减半）有专门测试
- [ ] §5.3.4 质疑成本对称：发起扣 1、失败再扣 1；**灵枢不足时 `getLegalActions` 不返回 `CERTIFY_CHALLENGE`**
- [ ] §5.3.2 复议：第三方多数决 / 平票视为成功 / 3 人局掷 6 面骰（4–6 成功）三条分支齐全
- [ ] §5.3.3 出题合规：全场裁定 → 换题 / 必须回答两条分支齐全
- [ ] §5.6 3 人局山议裁定：得票最高扣 2 灵枢、并列各扣 1、**不淘汰**
- [ ] §5.8 超限兜底：按「距峰顶 → 签印数 → 灵枢」排名，完全相同则并列

**依赖**：B1, B2。　**预估**：6–8 天（认证是全项目最复杂的规则块，宁可多花时间写测试）。

---
## 5. B4 — 主题包 ×1（仙侠 2026）

**目标**：仙侠 2026 全量数据 + 校验器。

### 5.1 关键文件

| 文件 | 内容 |
|---|---|
| `themes/xianxia2026/theme.json` | §6.5 全字段：4 阵营、8 身份、48 张卡、12 试炼、16 认证题、天机牌、棋盘 28 格 |
| `tools/theme-validate.mjs` | 从 `engine/types/theme.ts` 生成 JSON Schema + 引用完整性 + ops 白名单 + goal kind 白名单 |

### 5.2 验收

- [ ] `theme-validate` 通过
- [ ] 用仙侠主题跑 B3 的 3 人局完整对局，无引擎报错
- [ ] **类型同源验证**：改 `engine/types/theme.ts` → schema 自动变 → 故意写错主题 → 校验报错（写最小测试证明这条链路成立）

**依赖**：B2。　**预估**：4–5 天（数据量大但结构固定，可脚本辅助生成）。

---
## 6. B5 — 数字轨 UI

**目标**：单文件 HTML + 牌桌 UI + 认证面板 + 教学演示脚本。

### 6.1 关键文件

| 文件 | 内容 |
|---|---|
| `web/main.ts` | 入口，esbuild 打包 |
| `web/board.ts` / `hand.ts` / `log.ts` | 牌桌视图、牌库/手牌区、日志 |
| `web/council-panel.ts` / `cert-panel.ts` | 山议投票面板、**活人认证面板**（出题输入 + 判罚流程） |
| `web/tutorial.ts` | 2 虚拟玩家跑 5 回合迷你流程，**走真实引擎** |
| `build/build-single-file.mjs` | 内联 4 套主题 + 引擎 + UI |

### 6.2 验收

- [ ] 断网可玩，控制台无报错
- [ ] 4 人局体验完整：主题切换、人数切换、**新手/标准模式切换**、山议投票、认证面板、日志、存档导出/导入
- [ ] 教学演示 3 分钟内跑完，阶段顺序与真实对局一致
- [ ] 单文件产物**无外部请求**（断网 + 清缓存后仍可玩）

**依赖**：B3（B4 可用最小测试主题替代，不阻塞）。　**预估**：7–10 天（UI 工作量最大，可与 B6 并行）。

---
## 7. B6 — 实体轨管线

**目标**：SVG 模板 + 打印 HTML → PDF + 规则书生成 + `print/ir.json`。

### 7.1 关键文件

| 文件 | 内容 |
|---|---|
| `build/build-print.mjs` | 读 theme.json → 产出 ir.json → 渲染 SVG → 打印 HTML → headless Edge 出 PDF |
| `print/templates/` | 棋盘 A4×4 拼接、卡牌 63×88mm、身份牌/阵营牌/认证题卡、筹码 25mm、规则书 A4 双面 |
| `print/ir.json` | **schema 见规格 §6.7.1，B6 开工前必须定稿** |

### 7.2 验收

- [ ] ir.json 生成，且**逐字节确定性输出**（同 theme.json 两次构建 → 哈希相同）
- [ ] **PDF 归一化口径落地**：用 `tools/pdf-normalize.mjs` 归一化后两次构建摘要相同；且 **build-print 的 HTML 显式输出 `<title>`**（否则 Chromium 会把模板文件名写进 `/Title`，导致归一化后仍不一致）
- [ ] PDF 产出：棋盘 4 张 A4 可拼接、卡牌 63×88mm 套壳即用、规则书 A4 双面
- [ ] 规则书表格段落由 ir.json 生成，手写章节仅限规则叙述
- [ ] 卡牌含 3mm 出血 + 3mm 圆角；棋盘含 3mm 出血；筹码直径 25mm
- [ ] **规则书表格数值单元格全部带 `data-src` 溯源标记**（规格 §6.7.2），且 ir.json 的 `scales` 各项带 `srcRefs` 声明
- [ ] 溯源路径符合 §8 字段名契约（`scales[<players>].<fieldName>`），`<players>` 与该行一致

**依赖**：B4。　**预估**：5–7 天。

> **开工前动作**：定稿 `ir.json` schema（规格 §6.7.1 已给结构，但要逐字段确认**够 B7 比对**）。schema 一旦定稿，B6 与 B7 就能真正并行。
>
> **一并定稿**：数值溯源方案（§6.7.2 + §9.3 第四级）。`data-src` 属性名、路径格式、字段名白名单三者必须在 B6 开工前一起定死——B7 依此实现比对逻辑。

---
## 8. B7 — parity-check

**目标**：ir.json 主比对 + SVG 文本节点辅比对 + PDF 粗检。

### 8.1 关键文件

| 文件 | 内容 |
|---|---|
| `tools/parity-check.mjs` | **四级比对**（主比对 / SVG 辅比对 / PDF 粗检 / 数值溯源），任一不一致 **exit 1** |

### 8.1.1 四级比对结构

| 级 | 比对对象 | 覆盖 | 判红条件 |
|---|---|---|---|
| ① 主比对 | `print/ir.json` vs theme.json / 数字轨内联数据 | 卡牌、阵营、身份、指令表、规模表、认证题 | 任一字段不等 |
| ② 辅比对 | 产出 SVG 的文本节点 | 验证关键字段确实渲染进实体件 | 字段缺失或文本不等 |
| ③ 粗检 | PDF 文件本身 | 可打开、页数、字体嵌入 | 任一不符 |
| ④ **数值溯源** | 规则书表格单元格的 `data-src` → `engine/scales.ts` | 规模表全部数值列 + 其他表格数值 | 缺标记 / 路径非法 / 渲染值 ≠ 源值 |

### 8.2 验收（每条都要**实测判红**）

- [ ] 人为制造一处漂移（改主题包一张卡的名字，不重新构建）→ 主比对判红
- [ ] 人为制造一处模板漏印（IR 正确但 SVG 缺文本）→ 辅比对判红
- [ ] 人为制造 PDF 页数错误 → 粗检判红
- [ ] **数值溯源（第四级）**：人为改 `engine/scales.ts` 中 `players: 5` 的 `threshold` 为 4，**不重新生成规则书** → 溯源比对判红
- [ ] **溯源存在性**：人为删掉规则书某个数值单元格的 `data-src` → 判红（该数字是手写死的）
- [ ] **溯源可解析性**：人为写一个非法路径（如 `scales[9].threshold` 或不存在的字段名）→ 判红
- [ ] 正常构建 → 全绿
- [ ] **负样本常驻化**：上述三条判红路径固化为 `tests/gates/` 下的常驻用例（不是一次性验收动作）

**依赖**：B6。　**预估**：2–3 天。

---
## 9. B8 — 主题包 ×3（最小可行）

**目标**：科幻 / 融合 / 都市异能，按规格 §10.1 两张清单执行。

### 9.1 关键文件

| 文件 | 内容 |
|---|---|
| `themes/scifi-ai/theme.json` | 主题标识 + glossary 四术语 + ≥8 主题化认证题 + 1–2 标志卡 |
| `themes/hybrid/theme.json` | 同上 |
| `themes/urban-psych/theme.json` | 同上 |

### 9.2 验收

- [x] 4 套主题均通过 `theme-validate` 与 3 人局对局
- [x] 规格 §10.1「**必须差异化 4 项**」逐项核对通过（**由第 ⑧ 道门机械判定**，不靠人眼）
- [x] 「**允许复用 3 项**」未被过度设计——检查：没有出现主题独立卡牌池、独立事件池、独立身份设计
- [x] 认证题卡**是换场景不是换措辞**（仙侠题不得只把「都市」二字换成「仙门」）

### 9.3 B8 落地要点（实际做法）

| 项 | 落地方式 |
|---|---|
| 主题包怎么产生 | `build/build-themes.mjs` 从仙侠基准**继承效果**，只替换名称/文本/花色/点数标签 ⇒「换名不换效果」是机械保证 |
| 卡面文案 | 由 `build/theme-render.mjs` 从 `effects` **派生**（不手写 144 条）⇒ 文本与效果永不漂移 |
| 差异化怎么判 | 第 ⑧ 道门 `tools/theme-diff-check.mjs`：①主题标识 ②glossary 四词 ③认证题（逐字不同 + 命中专属名词表）④标志卡 1–2 张；反向核对「允许复用 3 项」 |
| 「换场景」怎么机械化 | 主题自带 `domainWords`（专属名词表）；每张认证题须命中 ≥8 张中的至少一个 ⇒ 通用题无法蒙混 |
| 主题数据放哪 | `build/theme-data/<id>.mjs`（源）→ `themes/<id>/theme.json`（产物） |

**依赖**：B4。　**预估**：每套 2–3 天，共 6–9 天。

---
## 10. B9 — 规模与平衡

**目标**：3–8 人规模表落地 + 1000 局模拟 + 平衡记录。

### 10.1 关键文件

| 文件 | 内容 |
|---|---|
| `engine/scales.ts` | §8 规模表全部数值，**字段名必须与规格 §8 字段名契约逐字一致**（`players` / `boardLength` / `gateCount` / `initialResource` / `handStart` / `deckTotal` / `trialTotal` / `certTotal` / `threshold` / `thresholdWithMark` / `councilIntervalStandard` / `councilIntervalNewbie` / `exileFloor` / `globalRoundLimit` / `estimatedMinutes`）——溯源门禁依赖它 |
| `tests/sim/run.mjs` | 固定 seed × 各人数档位 × 1000 局 |
| `docs/balance-report.md` | 认证轮次分布、兜底触发率、各身份/阵营胜率 |

### 10.2 验收

- [ ] 1000 局全绿：无异常、无死循环、无非法状态、**无局超出全局回合上限**
- [ ] 兜底触发率 **< 15%**（超标则回 B3 调门槛或山道长度）
- [ ] 各身份/阵营胜率偏离 **> 15pp** 的项记录在案并讨论
- [ ] `engine/scales.ts` 字段名与规格 §8 契约逐字一致（改字段名会让溯源门禁全体判红）

**依赖**：B3, B4, B8。　**预估**：3–5 天（模拟框架搭好后跑数很快，分析占大头）。

---
## 11. B10 — 收官

**目标**：规则书定稿、README、发布包。

### 11.1 关键文件

| 文件 | 内容 |
|---|---|
| `print/规则书.pdf` | 由 ir.json 生成表格 + 手写叙述 |
| `README.md` | 项目简介、构建命令、双轨使用说明 |
| `dist/创界山-活人认证.html` | 最终单文件 |
| `dist/print/` | 最终 PDF / SVG 包 |

### 11.2 验收

- [ ] 规格 §9.5 验收清单**全勾**
- [ ] `npm run typecheck && npm test && npm run build && npm run parity-check` 全绿
- [ ] 发布包内含：单文件 HTML、棋盘 PDF、卡牌 PDF、规则书 PDF、可编辑 SVG 源文件

**依赖**：全部。　**预估**：2–3 天。

---

## 12. 风险登记（实施期）

| 风险 | 触发信号 | 应对 |
|---|---|---|
| ops 表达力不足（主题效果拼不出来） | B4 写主题时卡住 | **扩 registry，不放开主题包内联代码**（规格 §6.4 铁律） |
| B6 与 B7 串行等待 | B7 开工时 ir.json 尚未定稿 | ir.json schema 在 B6 开工前定稿，两批并行设计 |
| 兜底触发率过高 | B9 统计 > 15% | 回 B3 调 N 值 / 山道长度 / 山议间隔 |
| 主题包内容膨胀 | B8 单套超 5 天 | 严守 §10.1「允许复用 3 项」，膨胀即打回 |
| 类型门禁被绕过 | CI 只跑 esbuild | 门禁脚本必须先 `tsc --noEmit` 再打包，红了中断 |
| 溯源标记被手工绕过 | 规则书表格出现无 `data-src` 的数字 | 溯源门禁的「存在性」检查判红；任何新增数值列必须同时加字段名契约 |
| TS strict 成本拖慢进度 | B1 超出预估 | 允许 `@ts-expect-error` 但**必须附理由注释**，B10 前清零 |

---

## 13. 立即可执行的三件事

1. **B1 第一天先写 `tsconfig.json` 与 `engine/types/theme.ts`**，不要先写逻辑。
2. **B2 开工前把规格 §6.4 的 ops 表逐条过一遍**，标记参数需求（target / amount / 无参），提前补齐文档缺口。
3. **B6 开工前定稿 `ir.json` schema**（§6.7.1），确认字段够 B7 比对。

---

*实施计划结束。下一步：B1 开工。*