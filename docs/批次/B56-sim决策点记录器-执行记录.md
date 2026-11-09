# B56 · Task 14 · sim 决策点记录器（`--record-decisions`，默认关闭且报告逐字不变）

> 批次号 B56 · 日期 2026-11-09 · 主题：给**影子决策探针**（Task 15）准备数据源 —— 把「启发式在每个决策点实际选了什么」记下来。
> 上游：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar-continuation.md`（Task 14）
> 前置：B55（`d53be0f`）已提交，其批次记录的提交哈希回填**并入本批首个提交**

## 1. 目标与范围

- **做**：`tests/sim/run.mjs` 加 `--record-decisions <path>`（**默认关闭**）；在**十个决策点**插 `record()`（**只加行、不改任何决策**）；JSONL 落盘；`tests/gates/sim-record.test.ts` 三条常驻测试；冒烟数据 `docs/预研/data/decisions-smoke.jsonl`。
- **不做**：Task 15（影子决策探针 P1·P2·P3·P6）、Task 16（浏览器可达性 P4）、Task 17（报告落盘 P5）。
- **不变量（第一优先）**：**报告文件逐字不变** —— 记录器是纯旁路，开了它也不得改变任何对局行为。

## 2. 执行前计划

| 计划项 | 验收口径 | 结果 |
|---|---|---|
| 报告逐字不变 | 同一参数，带/不带开关两次跑的 `--out` 文件 **diff 为空** | ✅ |
| 默认关闭 | 不带开关 ⇒ **不产出**任何 JSONL | ✅ |
| 字段 | 恰 11 个、顺序固定、`seq` 从 0 开始、`themeId` 正确 | ✅ |
| 落盘位置 | 主题循环之后、`summarize(cells)` 之前（计划口径） | ✅ |
| 类别覆盖 | 十类决策点都有数据 | ✅（5 人 × 30 局实测） |

## 3. 关键裁定

| # | 争议点 | 裁定 | 理由 |
|---|---|---|---|
| 1 | `seq` 从 0 还是 1 开始？ | **从 0**（⇒ `seq` == 行号） | 计划原文写 `lines[1].seq === 1` ⇒ 字面即从 0 开始 |
| 2 | `face` 记什么？ | **引擎产生的骰面点数**（move 1–6 / ask 1–20 / 无则 null），**动作后回填** | 字段名暗示骰面；最初实现记的是 rng 原始浮点（0.489…）⇒ **误导** ⇒ 改为动作后回填真实骰面（只改记录字段，不改 state 与决策） |
| 3 | 决策点清单用计划的「九个」还是代码的？ | **以代码为准：十个** | 计划原文说「九个」但列举了 11 类 ⇒ 计划自身不一致 ⇒ 现查现用 |
| 4 | 对峙选牌记不记？ | **记不到，如实登记** | 由引擎 `autoResolveDuel` **内部**决定 ⇒ sim 侧拿不到；`pickDuelCard` 是死代码 |
| 5 | 记录器用模块级还是传参？ | **模块级 recorder + 每局上下文** | 决策函数（`councilTurn` / `certificationTurn` / …）**不知道**主题与 seed ⇒ 改签名会波及 4 个函数；模块级上下文改动面最小且不改任何控制流 |

## 4. 实测数据

| 指标 | 值 | 判据 |
|---|---|---|
| 冒烟（2 局）决策点数 | **114** | — |
| 长样本（5 人 × 30 局）决策点数 | **2000+** | 十类全覆盖 |
| 报告逐字 diff | **0 行** | 带/不带开关两次跑 |
| 默认关闭产物 | **0 个文件** | 不带开关 |
| `face` 实测 | move⇒3/4/6/1/2/5、ask⇒7、无骰面⇒null | 真骰面 |
| `heuristic` 形态 | `move` / `ask` / `vote:<座>` / `cert:sign\|challenge\|answer\|appeal\|appealvote:<座>` / `ability:<op>[-><座>]` / `play:<card>[-><座>]` | 全部由 `actionKey` 生成 |
| 门禁 | **13 / 13 全绿** | `node tools/gate.mjs` |
| 全量测试 | **461 项：460 通过 / 0 失败 / 1 既存 todo** | `node --test` |

## 5. 验收

- 门禁 `node tools/gate.mjs`：**13 / 13 全绿**（门 ⑨ 平衡冒烟读数不变 ⇒ 记录器确实是旁路）。
- `node --test tests/gates/sim-record.test.ts`：**3 / 3**。
- `node --test "tests/**/*.test.ts"`：460/461 通过（1 既存 todo）。
- `tsc --noEmit`：0 错（本批曾红两次：catch 参数 `unknown` 的 TS2339、`unknown ?? ''` 仍是 `{}` 的 TS2339）。
- **冒烟数据**：完整 2 局记录 **114 条 / 8.22 MB** ⇒ **超仓内 2 MB 上限** ⇒ 不入库（`.gitignore` 记为生成物）；
  仓内留 `docs/预研/data/decisions-sample.jsonl`（**2 条 / 120 KB**）作格式契约样本。
- **提交后门禁曾红一次**（本批自查发现）：B51 的「无已入库文件超过体积上限」守卫判红 ⇒ 上面这条修正即由此而来。

## 6. 复盘与经验沉淀

- **「纯旁路」的第一不变量是「产物逐字不变」**：判据必须选**文件 diff**（不是 stdout 计数行）⇒ 否则「加了记录」很容易悄悄改掉某个分支的随机消耗顺序。本批用文件 diff 钉住。
- **字段名与内容必须一致**：`face` 最初填的是 rng 原始浮点（0.489…）⇒ 名字骗人 ⇒ 改为动作后回填**真骰面**（只改记录字段）。⇒ 「字段名误导」也是一种隐性缺陷。
- **`.mjs` 里不得出现 TS 语法**：本批写了 `recorder[i]!.face`（非空断言）⇒ 直接 SyntaxError（E22 同款）⇒ 纯 JS 写法 `const row = arr[i]; if (row !== undefined) {...}`。
- **写完先静态校验**：`node --check` 秒级 ⇒ 本批两次因手写长文件漏逗号/多括号而崩（一次是多行替换误伤了相邻片段）⇒ 已把「写完先 `node --check`」当行事。
- 已写入 `docs/预研/2026-11-08-laya-sidecar.md`（§3.8）。

## 7. 遗留（如实登记）

| # | 现象 | 归属 |
|---|---|---|
| T1 | **对峙选牌记不到**（引擎 `autoResolveDuel` 内部决定 ⇒ sim 侧拿不到） | 归 Task 15：若要比「模型 vs 启发式」在峙面，需引擎层暴露选择（或改由探针侧决策） |
| T2 | `run.mjs` 的 `pickDuelCard` 是**死代码**（定义了从未被调用） | 登记；删除属独立清理批次 |
| T3 | JSONL 的 `state` 含 **rng 内部状态** ⇒ 直接喂模型会让模型预测随机流 | 已在代码注释与落档**显式登记**；喂模型前必须经 `state-text.mjs` 的可见性受限文本化 |
| T4 | 阶段 B 剩余 Task 15–17 未做（影子决策探针 / 浏览器可达性 P4 / 报告落盘 P5） | 下一批起按 Task 15 推进（Task 13 反代 + Task 12 编排已就位） |

## 8. 提交

- 提交：`<hash>` feat(B16): sim 决策点记录器（--record-decisions 默认关闭，影子决策数据源）
- 显式 pathspec：`tests/sim/run.mjs`、`tests/gates/sim-record.test.ts`、`docs/预研/data/decisions-smoke.jsonl`、`docs/预研/2026-11-08-laya-sidecar.md`、`docs/批次/B55-*.md`（**B55 哈希回填并入本批首个提交**）、`docs/批次/B56-*.md`
