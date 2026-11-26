# B95 — Dependabot 自动合并机制修复（D1 / D2 / D3）执行记录

> 取号：B95（B94 已被并行会话 mvs_57ecedf8 占用，本批不并批）
> 施工：主会话 mvs_beb4763024e14d64b5e890b0ca7db708
> 起因：PR #9（playwright 1.60.0 → 1.65.1）挂起 26 小时未被合并；用户裁定「先修机制再合并」

## 1. 起因与现场读数（2026-11-26 复核）

| 读数 | 值 |
| --- | --- |
| PR #9 state / merged | OPEN / false |
| auto_merge | null（**从未进入自动合并队列**） |
| head | 5a216496…（11-25 17:41:46 起未变） |
| 检查 | gate chain (14 gates) success（17:46:43 完成）、commitlint success |
| mergeable_state | clean |
| 仓库 allow_auto_merge | true |
| main 分支保护 | 无（404） |

⇒ 既不是 CI 红，也不是冲突 ⇒ 根因在工作流本身，不在平台或依赖上。

## 2. 三个真缺陷

### D1「等 CI 全绿」从未生效（CI 红了也会照发合并指令）

原判据查该 head 的 check-runs：pending=0 且 bad=0 即判绿。
但 CI workflow 的 check-run **还没创建**时，查到的列表是空的 ⇒ pending=0 ⇒ 直接判绿。

证据（run 45667433870 日志）：

- 17:41:44 打印 PR #9 head=5a216496…
- **17:41:45 打印「CI 全绿」**
- 17:41:46 已评论 @dependabot merge
- 而 gate chain 的 check-run 17:41:43 才开始、**17:46:43 才完成**

### D2 合并指令由 GITHUB_TOKEN 发出 ⇒ Dependabot 侧不受理

旧实现发 `@dependabot merge` 评论，发评论的是 GITHUB_TOKEN（github-actions[bot]）。
该身份**没有仓库写权限** ⇒ 指令无法被受理：PR #9 收到评论后挂起 26 小时，
auto_merge 字段始终为 null，从未进队列。

GitHub 官方文档给出的做法是 `gh pr merge --auto` + `permissions: contents: write`
（docs.github.com … /automating-dependabot-with-github-actions）。
auto-merge 由 GitHub **服务端**执行 ⇒ 合并后照常触发 CI；
（用 GITHUB_TOKEN 直接 merge 不会触发 CI。）

### D3 顺手修：管道被 head 截断 ⇒ pipefail 下脚本误退出

`set -euo pipefail` 之下 `… | grep -E … | head -5`：head 提前关闭管道 ⇒ grep 收到 SIGPIPE ⇒
整条管道返回非 0 ⇒ 脚本在该行退出（workflow 变红），并跳过本该走的「保持人工审」分支。
改为 `grep -E -m 5`（grep 自己限条数，不截断管道）。

## 3. 修法

1. **CI 判据换成 workflow run 口径**（`actions/runs?head_sha=…`），并排除本工作流自己：
   - 该 head 上没有任何 run ⇒ wait（CI 还没启动 ⇒ 绝不判绿）
   - 有 run 未全部 completed ⇒ wait
   - 有 run conclusion 非 success ⇒ fail（不合并）
   - 全部 success 且其中至少一条属于 CI 工作流 ⇒ green
2. **合并动作换成 `gh pr merge --auto --squash`**（服务端执行 ⇒ 合并触发 CI）。
3. **权限提升为 `contents: write`**（否则 auto-merge 设不上）。
4. **安全加固**：手动触发也必须校验 PR 作者是 dependabot[bot] 且非草稿 ——
   本工作流带 contents: write，若被指到别人的 fork PR 即等于给 fork 提权。
5. 保留 B90 的三重闸门不变：major / 分组 unknown ⇒ 人工审；新增预发布依赖 ⇒ 人工审。

## 4. 守卫与负样本自证

新增 `tests/gates/dependabot-merge-path.test.ts`（14 条），**直接执行工作流里那段 CI 判据代码**
（从 DEP-CI-GREEN 标记块抽出）⇒ 测的是被测实现本身，不是另写一份近似实现。

自证：7 路注入 ⇒ 判红 ⇒ 按原字节还原 ⇒ 判绿（字节 SHA 不变）

| 注入 | 结果 |
| --- | --- |
| D1 把「CI 未启动」判成 green | 判红（3 条挂） |
| D2 去掉 --auto | 判红 |
| D3 不排除自身 run | 判红 |
| D4 去掉作者校验 | 判红 |
| D5 contents 降级为 read | 判红 |
| D6 拿别的 workflow 的绿灯充 CI | 判红（4 条挂） |
| D7 回灌 `| head -5` | 判红 |
| 还原 | 判绿；文件 SHA 与注入前逐字节一致 |

**自证中发现并修掉了守卫自身的鉴别力缺口**：原先用全文正则断言 `gh pr merge --auto`，
而文件头注释里恰好也写着这句话 ⇒ 把执行行改成 `gh pr merge --squash` 注入时守卫**没红**。
改为只认「可执行行」（剔除整行注释）后 D2 才真正判红。

## 5. 验证口径与未验证项

- YAML 语法：pyyaml 解析通过（on / permissions / jobs / steps 结构已读出）。
- 守卫：19/19 绿（含既有 B90 分类守卫 5 条未被破坏）；discipline 6/6 绿。
- **未验证**：新机制在 GitHub runner 上的真实行为（需 push 后 dispatch 实测）。
- **未验证**：Dependabot weekly 周期（仓库 11-25 创建，首次最早下周一 11-30）。

## 6. 平台侧观察记录（cron 复核）

- host 目录 7 条 security-update 失败（UTC 16:47–16:49）发生在 b7ac750 的 overrides 落地
  （UTC 17:19）**之前**；失败原因是 sparkdesign@0.4.11 经 mermaid / rehype-katex 钉住
  katex@^0.16.x，Dependabot 自己的建议就是「Add an override/resolution」—— 正是 B89 做的事。
- overrides 落地后唯一一次 host 运行是 version update ⇒ success。
- 告警：open 0 / closed 4（esbuild→0.25.0、i18next→26.3.4、katex→0.18.2、diff→8.0.3）。
- 精确口径：**修复后未观测到 host 的 security-update 运行**（当前无待修漏洞 ⇒ 不会触发），
  不能说该 job「已通过」。
