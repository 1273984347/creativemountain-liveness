# TODOS · 在办清单

> **纪律**（每完成一项都要走完这三步）：
> ① 在 [HANDOVER.md](HANDOVER.md) 追加一条**核实确认**（做了什么 · 读数 · 证据位置）
> ② **从本文件删除该项**
> ③ 提交时两个文件**一并更新**（回填类改动并入下一次在途批，不单独开 PR）。
>
> 本文件**只放尚未完成的事**；已完成的全部移交 `HANDOVER.md`。

## 现在在办

| # | 事项 | 验收口径 | 状态 |
| --- | --- | --- | --- |
| **T1** | B90 修复 push 到 `origin/main` | 远端 `refs/heads/main` = 本地 HEAD | 待执行（已获授权） |
| **T2** | 关闭 4 个 major PR（#3 @types/node 22→26、#4 setup-node 4→7、#5 checkout 4→7、#6 typescript 5→7） | 4 个 PR 均 `CLOSED`、零 `@dependabot merge` 评论 | 待执行（已获授权） |
| **T3** | 推送后复核：#3 / #6 的 auto-merge run 在**判定阶段**直接退出（分类 major） | run 日志出现「major 版本变更 ⇒ 保持人工审」 | 待推送后复核 |
| **T4** | 推送后复核：B90 的 CI | 该 run 终态 `success` | 待推送后复核 |
| **T5** | 推送后复核：4 条告警仍为 Closed | Security 页 **Open 0 / Closed 4** | 待推送后复核 |
| **T6** | 把 L-B89-1 的实测结论回填进 `docs/批次/B89-依赖安全告警清收-执行记录.md`（告警全清 · overrides 被平台尊重 · REST 读数滞后 vs UI 权威） | B89 记录 §6.3 的 L-B89-1 改为已证实 | 待下批（回填类并入在途批） |
| **T7** | L-B89-2：host 三条 overrides 是「**未经上游测试的组合**」⇒ 随 `sparkdesign` 上游跟进 | 上游发布含 katex ≥ 0.18.2 / i18next ≥ 26.3.4 / diff ≥ 8.0.3 的版本后，改用上游声明并撤掉 overrides | 待上游 |
| **T8** | L-B89-3：katex 0.18 的嵌套 `commander` 15.1.0 要求 node ≥ 22.12 ⇒ 本仓 `engines` 为 `>=22.18`、CI Node 24 ⇒ 相容；但**若下调 engines 下限**需复查 | engines 下限变更时复查该依赖 | 待触发 |
| **T9** | L-B90-3：Dependabot 每周的 security job 是否停止失败 | 下一次 weekly 周期后 `Dependabot Updates` runs 无 failure | 待观察（weekly） |
| **T10** | 下一批取号（B91）与主题 | 批次导航加一行 + `batch-nav-count.mjs` 复算互洽 | 待开批 |

## 长期约定（不随批次清空）

- 提交一律**显式 pathspec**，禁 `git add -A` / `git commit -a`；`git add` 与 `git commit` 连着执行。
- **外部可见动作逐次点名授权**：push / 合并 / 开 PR / 关 PR / 账号与仓库设置变更。
- 门禁纪律 A4：不得 `shell: true`、不得接管道；退出码直取 `spawnSync(...).status`。
- 单一事实源：期望值一律派生，不手抄。
- 视觉改动必须**本人目视核对截图**（探针全绿 ≠ 版面没坏）。
- 平台状态读数要**双源交叉**，以**用户可见面**为准（REST 读数可能有滞后缓存）。
