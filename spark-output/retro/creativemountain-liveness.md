# Retro — 创界山·活人认证

- **生成时间**：2026-11-07T20:51:08.133Z
- **复盘口径**：设计过程复盘（非上线后复盘）
- **项目周期**：2026-11-07 → 2026-11-08（单会话 frame→qa→retro 连续 10 个 Skill + 3 轮修复迭代（约 20+ 轮））
- **上线状态**：未上线；0 真人 playtest；无埋点；metric Skill 未跑
- **团队规模**：1 owner-designer + AI 链式套件

> 无上线/埋点/真人数据：decision/assumption outcome 一律 inconclusive；仅 out_of_scope 遵守可脱离数据验证(validated)；架构决策记 partially-validated（过程价值成立、UX 结果未证）。未硬塞 validated。

## 📊 Project Summary
- 交付时间：2026-11-07 → 2026-11-08；里程碑：原计划无明确交付时限；实际在「设计探索+可运行原型」阶段收口，工程实现/真人验证未开始

## ⚖️ Decision Validation

### ✅ Validated — 1

| 决策 | 来源 | 实际结果 | 判定 | Lesson |
| --- | --- | --- | --- | --- |
| out_of_scope 守住：不做线上异步验活人 / 不做纯派对 / 不做 AI 陪练 / 不做主题全量差异化 | brief.out_of_scope | 全链与原型均未出现越界功能；房间码/同步属**局域网实时**非线上异步，未违反；check/QA 反向核对确认 | validated | 范围纪律是本次唯一可脱离上线数据即验证的决策——靠「产物里有没有出现 out_of_scope 的东西」即可判，应继续用「可观测即验证」的项对冲「outcome 待验证」的项。 |

### ⚠️ Partially Validated — 1

| 决策 | 来源 | 实际结果 | 判定 | Lesson |
| --- | --- | --- | --- | --- |
| 中途把主屏从「热座单屏」升级为「Web 主屏 + 手机私牌端」多端架构 | sitemap Step1 用户选择 | 决策确实重定义了 flow-web/qa 边界，并暴露出「热座手牌无隐私」「同步层缺失」等 11 个 gap；但多端 UX 是否更优未验证 | partially-validated | 过程上「早期暴露平台分叉」有价值（把风险显式化）；代价是引入未做的 host↔phone 实时同步（技术可行性未证）。架构级决策应连同其隐性成本（同步层）一起在锁定时估清。 |

### ❌ Refuted — 0

| 决策 | 来源 | 实际结果 | 判定 | Lesson |
| --- | --- | --- | --- | --- |
（无）

### ❓ Inconclusive — 4

| 决策 | 来源 | 实际结果 | 判定 | Lesson |
| --- | --- | --- | --- | --- |
| 押方向 A：保留完整策略桌游 + 认证高潮，调优让高潮更密/铺垫更轻/名场面即胜利（不押 B 派对快节奏 / C 双模式） | frame.lean_direction | 无真人局，无法证 A 优于 B/C | inconclusive | 方向锚定自洽，但其成立完全系于假设#1（愿为 ~10min 高潮忍 ~60min 铺垫）——该假设至今 0 数据。下个动作必须是真人局，不是再加设计层。 |
| 策略维度「情感化设计」让认证成为可反复出现的高潮（降门槛提密度/名场面即胜利） | brief.strategy_dimensions | flow2 三方判定+签印进度、flow3 名场面即胜利排名已落码，但「≥3 次全桌集中」未观测 | inconclusive | 机制层已备好密度弹药（门槛 N、多方参与 UI），但「有没有真的产生名场面」只能真人局回答。 |
| 策略维度「交互设计」铺垫轻量 + 待认证锁定防混淆 | brief.strategy_dimensions | flow1 状态看板 + flow2 待认证 Banner 落码；「铺垫可熬」未验证 | inconclusive | 「轻」≠「短」的张力（砍深度会杀重量）未用数据找平衡点。 |
| edge 把 should/nice 异常态（离线冻结/并列/溢出）延后到 v1.1 | edge.remediation | 延后项在真实场景重要性未知（未上线） | inconclusive | 延后决策的可逆性依赖于尽早真人局回归；若无回归节点，延后即等于遗忘。 |

## 🎯 Assumption Validation

#### 假设：假设#1（Frame 关键假设）：聚会整活型玩家愿为 ~10min 现场认证高潮忍受 ~60min 策略竞速铺垫
- 目标度量：brief.design_criteria：单局全桌注意力集中 ≥3 次 / 铺垫期人均分心 <2 次
- 实际度量：无（probe 0 人，metric 未跑，无埋点）
- 判定：**inconclusive**
- 下一步：跑 6 人局 playtest + 观察协议（probe 已备好方案与大纲）；用 design_criteria 定量项直接判 holds / holds-with-conditions / rejected。这是整条链唯一能证伪方向 A 的实验。

#### 假设：假设#4：名场面即胜利——贡献最精彩的人应赢下整局，高潮不被终局消解
- 目标度量：结算排名里名场面贡献者居首且全桌觉得实至名归
- 实际度量：无（seatWeight 权重已过引擎回归测试，但「名场面者实际是否赢/是否觉得值」需真人）
- 判定：**inconclusive**
- 下一步：真人局观察结算反应（虽败犹荣 vs 白演）；公式已就绪，缺的是人。

## ✨ What Worked（4）

1. **零真人数据下守住诚实基线：每个产物显式标 hypothesis / probe 0 人 / 待验证，未伪造任何用户引语**
   - Why：Brief 约束、Journey 红章、Stories 警告、flow-web mock 声明全程一致；Retro 才能据此判 inconclusive 而非假 validated
   - Keep doing：假设性链路必须把「未验证」写进产物本身（非仅口头），下游才不会误当已验证消费
2. **Check→Edge→flow-web 落码→Check v2→QA→修复 闭环：揪出 3 Major + 16 must 异常态，逐条改代码并 build+lint+浏览器回归**
   - Why：不是停在清单：oxlint 从 6 warning→0、异常态运行态真实渲染、v1 三 Major 在 v2 复核确认守住
   - Keep doing："发现问题"与"驱动修复"连体；自检产物要能被下一环反向核对（check.findings↔qa.check_finding_status）
3. **先 grounding 真实 web/ 实现（vanilla-TS 单文件热座）再定 sitemap/flow**
   - Why：让 sitemap 的 existing/refactor/gap 清单落在事实上、flow-web 的「React 原型 ≠ 现有 web/」范式分叉被提前讲清、避免凭空造页面
   - Keep doing：改版类项目第一步读现有实现代码，不凭对话推 IA
4. **单源生成器模式（一份 data → MD+JSON+dashboard+self-checks）**
   - Why：sitemap 25 页/flow 37 态/edge/qa summary 全部程序化派生，零手抖、跨产物一致
   - Keep doing：链路型产出用脚本单源生成 + 强制 summary 自动 derive，禁止手写估算计数

## ⚠️ What Didn't（4）

1. **零真人数据却一路绿灯跑完 10 个 Skill 并产出可运行原型**
   - Root cause：链路缺少「probe 未回填即设验证闸门」的机制，假设性产物自洽到 QA 都没被强制回头补真人局
   - Avoid next time：在 Frame 标 critical_assumption 后，链路应在进入 flow 前要求一次最小真人回归（哪怕 3 人），否则后续全部价值悬置
2. **架构从热座升级到多端（主屏+手机）在中途才定，牵动 flow-web/qa 边界且引入未做的同步层**
   - Root cause：平台/架构在 sitemap Step1 才由用户选择确定，其隐性成本（host↔phone 实时同步、技术可行性）当时未量化
   - Avoid next time：把平台/端形态作为 brief.constraints 早期锚点显式锁定；若中途变更，强制重估被牵动的下游 Skill 与新基础设施成本
3. **Metric Skill 从未跑，导致 Retro 无法回填 NSM、design_criteria 定量项（≥3/分心<2）无埋点载体**
   - Root cause：flow-web 后直接进 check/edge/qa 打磨实现，跳过了把设计标准翻成可跟踪事件的环节
   - Avoid next time：flow 完成即接 Metric，把 design_criteria 落成埋点/观察协议；否则假设验证永远停在 inconclusive
4. **10 个「模拟…」异常态调试按钮一度进入可见交付面（直至 QA 后 dev-gate 才从生产剔除）**
   - Root cause：原型异常态用手动触发而非真实 async，且未从一开始用 import.meta.env.DEV 门控
   - Avoid next time：异常态从设计时就约定接真实 async 或首版即 DEV 门控，避免调试态泄漏到交付面

## 💡 Surprises（4）

1. **零真人数据竟能跑出一条内部完全自洽的链，还产出可运行 React 原型**
   - Learning：自洽 ≠ 正确——恰恰相反，越是漂亮闭环越易掩盖「地基假设没验」这一最大风险。链路产出的完成度会给人一种「差不多可以上线」的错觉，必须用显式 hypothesis 标注 + 验证闸门对抗它
2. **sitemap 阶段一个平台选择（主屏+手机私牌端）就重定义了整条链的范围、gap 清单、甚至 QA 维度**
   - Learning：早期一个架构决策的下游杠杆远超预期；设计者（用户）在推荐「单屏热座」时选了更激进的目标态，说明链路要能承接中途改架构，并把连锁成本当场摊开
3. **把 Check/Edge/QA 的清单真的回灌去改代码后，才暴露「发现≠解决」的差距（toast 一直 0 调用、setTimeout 未清理等）**
   - Learning：自检的价值不在清单而在闭环；只有逐条落码 + 重新 build/浏览器回归，才知道哪些是纸面问题、哪些是真问题
4. **真实 web/ 引擎（纯 TS、9 门禁）与 flow-web 的 React 原型是两套 UI 栈，但引擎层完全可复用**
   - Learning：双轨项目「设计原型」与「真实实现」技术栈分叉是常态；关键是划清哪些产物可直接迁移（引擎/状态）、哪些仅用于探索（React 稿），别让评审误以为原型即成品

## 🛠 Skill Usage（用了 10 / 未跑 3）

| Skill | 用了 | 价值 | 痛点 | 建议 |
| --- | --- | --- | --- | --- |
| frame | ✅ | high | — | 方向 + 关键假设显式化，是全链诚实性的源头；保留 |
| probe | ✅ | low（方案就绪但 0 人未采） | 用户"找不到参与者"，研究未真正执行 | 招募困难时应更早触发降级：至少 3 人非正式 playtest，而非让链在 0 数据上推进 |
| brief | ✅ | high | — | 一页纸锚 + 把关键假设写进约束，供下游反复引用，值得保留 |
| journey | ✅ | high | — | 单局体验旅程把 2 个流失风险可视化，直接喂给 Stories P0；口径选择（单局 vs 全周期）正确 |
| stories | ✅ | high | — | P0 三支柱正好对应旅程断点；「全写按优先级」一次到位 |
| sitemap | ✅ | high | 中途用户改选多端架构，牵动下游 | 平台/架构选择前置到 Brief，减少中途重定义 |
| flow-web | ✅ | high | 现有 vanilla-TS 与 React 原型范式分叉需先讲清；组件 API 需 grep 核验防白屏 | 保留 grep 核验 + build 作为白屏最强校验的做法；原型交付即带 dev-gate 约定 |
| check | ✅ | high | — | Mode C 一致性 + Mode A 静态双跑；v1→修复→v2 回归确认形成闭环，是该链最大增值点 |
| edge | ✅ | high | — | 6 类矩阵 + must/should 分层，把「异常态」从 Check 的被动发现变主动穷举 |
| qa | ✅ | high | 设计源与实现同源，QA 退化为还原度+反向核对 | 原型即实现的场景，QA 用运行态 computed-style + Check 反向核对仍有价值（发现图标尺寸离散、rail 固定等） |
| metric | ❌ | n/a | — | 本次最大缺口——没它 Retro 无法回填 NSM、假设永远 inconclusive；flow 完成即应接 |
| flow-mobile | ❌ | n/a | — | 多端架构已定但手机私牌端未做；rail 折叠/真实 async/私密操作应尽早补，否则多端只是纸面 |
| pitch / board / access / chart / bench / signal / scope / extract | ❌ | n/a | — | 未跑合理：无汇报节点(pitch)、无视觉系统需求(board)、无合规场景(access)；改版下个项目应先 audit |

## 🎯 Recommendations

### 给自己
- 下次跑链：只要 critical_assumption 未被真人验证，就不要让流程"完成"到 QA——在 flow 后强制插一次最小真人回归 + Metric 埋点再谈验收
  - 依据：本次全链自洽却 0 数据，Retro 只能整片 inconclusive，价值被悬置

### 给团队
- 建立「假设性 vs 已验证」产物标注规范 + 「probe 未回填即验证闸门」的流程约束；平台/端形态决策连同隐性成本（如本例同步层）在 Brief 阶段锁定并量化
  - 依据：本次两处最大成本后置：0 数据跑全程、中途改多端架构引出未做的实时同步

### 给下个项目
- 若为 v1→v2 改版先跑 Audit（勿直接 Frame）；新链在 flow-web 完成后立刻接 Metric；原型异常态首版即用 import.meta.env.DEV 门控
  - 依据：本次 Metric 缺失使 Retro 无法回填；调试按钮曾泄漏到交付面

### 给组织
- 沉淀「设计决策案例库」，收录本次可观测即验证的项（out_of_scope 纪律=validated）与教训项（零数据全绿灯）作为组织记忆
  - 依据：Retro 是链路终端，经验若不入组织库则下个团队项目仍从零踩

---

## Lessons Learned 卡片（一页摘要）

1. 自洽 ≠ 正确：0 真人数据也能跑出漂亮闭环，越顺越要警惕地基假设未验——把「未验证」写进产物 + 设验证闸门。
2. 早期架构决策杠杆极大：一个平台选择能重定义整链范围与隐性成本，变更时当场摊开连锁代价。
3. 自检的价值在闭环不在清单：Check/Edge/QA 必须回灌改码 + 重新回归，才发现"发现≠解决"。
