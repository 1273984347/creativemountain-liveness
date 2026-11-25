# HANDOVER · 交接记录

> **纪律**：每完成一项 ⇒ 在此追加**核实确认**（做了什么 · 读数 · 证据位置），并从 [TODOS.md](TODOS.md) 删除该项。
> 记录**只追加、不改写历史行**（与 `docs/沉淀/经验教训索引.md` 同一纪律）。

## 交接状态

| 项 | 值 |
| --- | --- |
| `main` | `7941fe8`（远端；**B92 已本地提交待推**） |
| 门禁 | **14 道**，全绿 |
| 批次档案 | **85** 份（`docs/批次/`） |
| 沉淀条目 | **E1–E153**（五类；E 行数 ≡ 分类声明之和） |
| 导航互洽 | 总览 / 小节标题 / 实际行数 / 目录文件数 = **85/85/85/85** |
| 未修复告警 | **0**（Security 页 Open 0 / Closed 4） |

## 已完成（核实确认）

### B90 · 自动合并的 major 误判修复

- **做了什么**：修掉 `dependabot-auto-merge.yml` 把 major 当 patch/minor 合并的判定缺陷。判定改为**解析标题里的 `from A to B` 版本跨度**（主版本号不同即 major ⇒ 人工审），`deps-major` 标记仍命中，**分组 PR（解析不出 from/to）一律保守人工审**；配置侧给三个更新目录补 `deps-major` 分组；新增常驻守卫 `tests/gates/dep-update-classify.test.ts`（**直接执行 yml 里那段分类代码**，不另写复刻）。
- **核实读数**：守卫 **5/5 绿**；注入旧判定 ⇒ **当场判红**（点名「标题分类错：build(deps-dev): bump typescript from 5.9.3 to 7.0.2」）；按**原字节**还原（字节一致 = true）⇒ 复跑 5/5 绿；`npx tsc --noEmit` **exit 0**；导航复算 **83/83/83/83**；`doc-sync` **10/10**。
- **止血读数**：两个 auto-merge run 终态 **cancelled**；4 个 major PR 全部 `OPEN`、`mergedAt: null`、**零 `@dependabot merge` 评论**；`main` 仍是 `b7ac750`（**未被污染**）。
- **推送与止血读数**：提交 `d3aecf0`（修复）+ `0ba0403`（台账）**已 push** ⇒ 远端 `main` = `0ba0403`；4 个 major PR（#3 / #4 / #5 / #6）**全部 CLOSED**、`mergedAt: null`、零 `@dependabot merge` 评论（可逆：reopen 即恢复）。
- **平台侧验证新判定生效**：手动 dispatch auto-merge 处理 PR #6 ⇒ run `45667296931` 日志输出「**major 版本变更 ⇒ 保持人工审：build(deps-dev): bump typescript from 5.9.3 to 7.0.2**」⇒ 在**判定阶段**直接退出，**未评论、未合并**。
- **拦下 major 真的救了 main（红证）**：PR #3（@types/node 22→26）的 CI **判红**（run `45665156289`）—— 红因是类型检查失败：`tests/engine/exhaustion.test.ts(173,44) TS2769`、`tests/engine/legal-probe.test.ts(365,13) TS7022` ⇒ 若当初被自动合并，main 会直接红。
- **CI 终态**：run `45667268412`（headSha `0ba0403`）⇒ **success**（门禁链 job success）；push 后 Dependabot 重跑的 3 个 Updates 任务（`45667278777` github_actions / `45667277376` **host npm** / `45667277331` 根 npm）⇒ **全部 success** ⇒ host 目录那个**此前每周固定失败**的任务**转为成功**（依赖树现在能被正常解析）。
- **新判定的三分行为（平台侧实测）**：PR **#8 / #10**（`deps-major` 分组）⇒ 日志「major 版本变更 ⇒ 保持人工审」⇒ **零 `@dependabot merge` 评论、未合并**；PR **#9**（playwright 1.60→1.65，npm-patch 组）⇒ 日志「已评论 @dependabot merge（PR #9）」⇒ **patch/minor 自动合并链正常工作**（设计意图，且 CI 全绿才会真合并）。⇒ **Dependabot 重分组后，major PR 标题自带 `deps-major` 标记 ⇒ 配置侧与判定侧真正接上了**。
- **告警复核**：REST `state=open` = **0** / `state=closed` = **4**（与先前 UI 侧读数一致）。
- **新一轮 CI**：headSha `140724d` 的 run `45668506997` ⇒ **success**。
- **PR #9 的状态观察**：`@dependabot merge` 已发出、其 CI 已全绿，但 Dependabot **尚未执行合并**（PR 分支基于 `b7ac750`，而 `main` 已前进两次 ⇒ 推测需等下次检查时先 rebase）⇒ 属**挂起**而非误合并；观察项 T11。
- **证据位置**：`docs/批次/B90-自动合并major判定修复-执行记录.md`

### B91 · 开源文档入口补齐（AGENTS / CLAUDE / ROADMAP）

- **做了什么**：补齐仓根三个开源入口文件，并给「**指针不许空转**」加机械守卫。起因是实测发现 `docs/沉淀/README.md` **早已声称有 `AGENTS.md`**，而**实物并不存在** ⇒ 纪律散落、无单一入口，且这种缺口**不会报错**。
- **内容边界**：`AGENTS.md` 只写不可协商的纪律清单与「去哪看」指针（细则一律留在既有文件，不复制）；`CLAUDE.md` 只做指针；`ROADMAP.md` 只写可派生事实（已发布 / 在途 / 未决遗留），方向性计划留给 owner。
- **核实读数**：全量门禁 **14 门全绿**（CI run `45670557208`，headSha `509d7e7` ⇒ success）；入口守卫 **5/5 绿**；**注入「指针空转」⇒ 当场判红**、**按原字节还原**（字节一致 = true）⇒ 复跑 5/5 绿；`doc-sync` **10/10**；`tsc` **exit 0**；导航复算 **84/84/84/84**；沉淀 **E 行 152 ≡ 分类声明之和 152**。
- **远端可见性**：四个新文件经 GitHub contents API 实测可见 —— `AGENTS.md` 5687 B、`CLAUDE.md` 1067 B、`ROADMAP.md` 2258 B、`tests/gates/entry-docs.test.ts` 3461 B。
- **刻意未建**：`SUPPORT.md`（内容已被 CONTRIBUTING / README 覆盖，单开会分叉）、`GOVERNANCE.md`（单人维护无治理对象）。
- **连续三次 push 的 CI 全绿**：`140724d`（run `45668506997`）· `509d7e7`（run `45670557208`）· `7941fe8`（run `45671822237`）⇒ 全部 success ⇒ 本轮三批（B89 / B90 / B91）**每次 push 都有 CI 背书**。
- **证据位置**：`docs/批次/B91-开源文档入口补齐-执行记录.md`


### B92 · 双轨一致性收口与策略接线

- **做了什么**：① 修实体件**降级关隘格误印过路费**（渲染判据加 `kind === gate`，与引擎同看 kind）；② 修**棋盘 PDF 尺寸**（`preferCSSPageSize: true` ⇒ CSS 的 `@page board` 生效）；③ 门 ⑦ 新增第 ⑤ 级「棋盘比对」+ 覆盖边界 `print-board-gate-fee` **同序**登记；④ certify 策略**接线能力**（`--policy-module`，**默认关闭**）；⑤ README「已知限制」段 **5+ 处过期读数**清零 + 手抄读数守卫 + 门禁阈值口径订正（15% → 25%）。
- **核实读数**：24 格版「过路」**4 → 2**（28/32/36 版 3/3/**4** 全部对上）；实体件 PDF **9 页 A3 横向 + 7 页 A4 纵向**（原 16 页同尺寸）；目视核对 4 版棋盘**无裁切**、降级格无过路费；门 ⑦ **5 级全绿**；守卫 **5 + 4 + 3 全绿**（含「注入即红、恢复即绿」自证）；平衡报告重生成 **仅头部 1 行变化**（数值逐字未变 ⇒ 实证 B1 接线零影响）；doc-sync **10/10**（C8 覆盖边界 16 条）；导航复算 **85/85/85/85**；沉淀 **E 行 153 ≡ 分类声明 153**。
- **证据位置**：`docs/批次/B92-双轨一致性收口与策略接线-执行记录.md`

### B89 · 依赖安全告警清收（根仓 esbuild + host 三条 overrides）

- **做了什么**：清掉公开发布后扫出的 **4 条**未修复 Dependabot 告警。根仓 `esbuild` `^0.24.0` → `^0.28.2`（GHSA-67mh-4wv8-2f99）；host 侧 `katex` / `i18next` / `diff` 三条**上游未修**的传递依赖用 npm `overrides` 强提（GHSA-238p-pmpm-9mq7 / GHSA-6jcc-5g8w-32mx / GHSA-73rr-hh4g-fpgx）。
- **核实读数**：单文件产物 SHA256 `80E5DA2EF72D188EFE51B8EDC2A2CBBABB2418B47DE0894F09C642BF9FDD6C78`、212,032 bytes ⇒ 与升级前**逐字节相同**（0.24.2 / 0.28.1 / 0.28.2 三版一致）；**14 门全绿**；host 走查 **chromium / firefox / webkit 三引擎均 exit 0**（`failures=[]`、`knownErrors=[]`）；`npm ls --all` **0 invalid / 0 extraneous**；oxlint **0 告警**；依赖树变更面无无关 churn。
- **平台读数**：提交 `b7ac750` 已推送；CI run `45664749850` **success**；GitHub Security 页 **Open 0 / Closed 4**（4 条告警全部转 closed ⇒ **overrides 被平台尊重**）；SBOM 里四版本 = 0.28.2 / 0.18.10 / 8.0.4 / 26.7.2。
- **口径留痕**：`gh api …/dependabot/alerts?state=open` 在修复后**仍返回 4 条 open**（滞后缓存）⇒ 平台状态必须**双源交叉**，以**用户可见面**为准（沉淀 E151）。
- **证据位置**：`docs/批次/B89-依赖安全告警清收-执行记录.md`

### B88 · 遗留项收尾（宿主四项）

- **核实读数**：host 走查 **chromium / firefox / webkit 三引擎实跑全绿**；flow3 窄屏排名表改三列（内部无横向滚动宿主）；导航条触控宽度 **40 → 44px**；干净副本门禁 **14/14 全绿**（首次）；全量 14/14；导航 81/81。
- **证据位置**：`docs/批次/B88-遗留项收尾-执行记录.md`

### B87 · 遗留项收口

- **核实读数**：host 窄屏主区 **166 → 390px**；走查改用 `data-testid` 唯一事实源；release 链 7 文件 11 处负样本改指入库基线；根仓静态守卫 **10/10**；14 门全绿；导航 80/80。
- **证据位置**：`docs/批次/B87-遗留项收口-执行记录.md`

### B86 · 浏览器走查与可观测断言

- **核实读数**：新增门禁第 **⑭** 道「数字轨浏览器走查」（file:// 单文件，**54 条断言**）；负样本 4/4 绿；host 5 页 × 2 视口 exit 0；C8 13 条。
- **证据位置**：`docs/批次/B86-浏览器走查与可观测断言-执行记录.md`
