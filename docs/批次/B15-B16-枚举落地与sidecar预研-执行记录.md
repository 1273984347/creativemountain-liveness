# B15/B16 — §7 枚举落地 + Laya sidecar 预研 执行记录

> 状态：**待执行**（本文件先固化目标、裁定与既有缺陷；§4–§8 由各任务执行时填写）
> 上游：设计 `docs/superpowers/specs/2026-11-08-creativemountain-laya-sidecar-design.md`
> 总纲：`docs/superpowers/specs/2026-11-08-creativemountain-ai-prespike-overview.md`
> 计划：`docs/superpowers/plans/2026-11-08-creativemountain-laya-sidecar.md`（17 个任务，阶段 A=1–10，阶段 B=11–17）

## 1. 目标

起点是「给本项目加 Laya 判断模型 sidecar，做 V2 预研」。探上下文后收敛为三问，**只答工程可行性，不答强度**：

| # | 问题 | 出口 |
|---|---|---|
| ① | 引擎状态能否喂给本地判断模型、再稳定回解成合法动作 | P1 / P2 / P3 |
| ② | 规格 §7「UI 与 AI 使用同一枚举」能否变成可机械验证的契约 | 四条常驻测试 |
| ③ | `file://` 双击即玩的单文件数字轨能否叫到本地模型而不破坏离线承诺 | P4 |

## 2. 裁定（用户拍板）

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

## 4. 阶段 A 实施记录（Task 1–10）

| Task | 内容 | 提交号 | 结果 | 备注 |
|---|---|---|---|---|
| 1 | Action 契约修正 | | | |
| 2 | 动作 key 可逆编码（engine） | | | |
| 3 | rng 隔离 + 测试局面唯一来源 | | | |
| 4 | `probeAction` 三种拒绝表达 | | | |
| 5 | 五面试跑式枚举 | | | |
| 6 | `getLegalActionStats` | | | |
| 7 | UI 门禁下沉 + 漂移守卫 | | | |
| 8 | 可见性文本化 + 禁止集 | | | |
| 9 | 口径同步（规格 + README） | | | |
| 10 | 第 ⑨ 门回归比对 | | | |

## 5. 阶段 B 实施记录（Task 11–17）

| Task | 内容 | 提交号 | 结果 | 备注 |
|---|---|---|---|---|
| 11 | P0 环境自检（venv 决策树 / 对拍 / API 面） | | | |
| 12 | `launch.py`（官方 app + 硬绑环回） | | | |
| 13 | Node 反代（CORS / 对拍 / SKIP） | | | |
| 14 | sim 决策点记录器（默认关闭） | | | |
| 15 | 影子决策探针 P1/P2/P3/P6 | | | |
| 16 | 浏览器可达性探针 P4 | | | |
| 17 | P5 降级自证 + 脚本入口 + 报告落盘 | | | |

## 6. P0–P6 读数（执行时填，每格必须是实测值）

| # | 读数 | 实测 | 判据 | 判定 |
|---|---|---|---|---|
| P0 | 环境 / venv / 对拍 | | 对拍通过 + serve 起得来 | |
| P1 | 端到端打通率 | | `answerRate ≥ 0.99` 且 `illegal = 0` | |
| P2 | 延迟 p50/p95 | | GPU ≤300ms / CPU ≤1500ms | |
| P3 | 候选与截断 | | `truncated = 0` | |
| P4 | 浏览器 `file://` | | 通，或给出失败层次 | |
| P5 | 无服务降级 | | `SKIP` + 退出码 0 | |
| P6 | 分歧率 | | 仅记录，不设判据 | — |

环境缺失时该格写「未跑：本机无权重 / 无 CUDA / `create_app` 不接受本地权重」，不留空、不下调判据。

## 7. 三条可行性判定与 V2 建议（执行后填）

- 接线：
- 延迟：
- 浏览器：
- 是否值得做 AI 陪练（引 P1/P2/P6 与规格 §7 的三条 V1 后置理由）：
- 是否需要分层决策（先选面再选牌；引 P3 候选分布与 P6 分歧画像）：
- B14 后关隘并入枚举的剩余成本：

## 8. 红线自证

- [ ] `npm run gate` 十道全绿（尾行：______）
- [ ] 第 ⑨ 门用默认参数重新生成报告后 `diff docs/balance-report.md` 无输出（逐字等价）
- [ ] `git status --short dist/` 为空（发布包零增量）
- [ ] `package.json` 无 Python 依赖；`tools/gate.mjs` 未新增需要 sidecar 的条目
- [ ] 四条常驻测试绿：一致性-正向 / 漂移守卫 / rng 隔离 / 禁止集

## 9. 遗留（如实）

- B14 关隘接线：`payGate` / `drawTrial` 未接线、`gatesPassed` 无写入方 ⇒ G-c 未修，四身份目标仍不可达；`COMPARE` 在枚举里继续标记「入口待接线」。
- G-a 出牌费用语义待与 B14 一并裁定（同时动 §3.1 与 §3.5 的资源口径，需重跑第 ⑨ 门）。
- G-b 引擎 `act` 分支的 `pendingCert` 加固未做（本批仅在枚举层按 UI 规则排除）。
- G-d 双人互验未接线。
- 强度结论、sidecar 进产品、发布包内任何增量：**明确不做**。
