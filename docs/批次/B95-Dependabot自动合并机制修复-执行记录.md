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
## 7. 提交、门禁与台账回填

- **门禁（提交前实跑）**：`node tools/gate.mjs` ⇒ **15 门全绿，exit 0**（门 ⑮ 平衡报告入库一致性 142.1 s；门 ② `node --test` 136.3 s 含新增守卫 14 条；整链 ≈ 5 min）。门数 **15 未增**（新增守卫由门 ② 的 `tests/**/*.test.ts` 自动纳入）。
- **本地提交**：主体 `9bdbc19`（`fix(deps): 修 Dependabot 自动合并机制——CI 判据改 run 口径 + 走 gh pr merge --auto`；3 文件 / +328 −30）；本批台账笔为第二个提交（显式 pathspec）。
- **与 B94 的叠放**：B94 由并行会话 `mvs_57ecedf8` 提交为 `4e938fe`（28 文件，显式 pathspec，零 B95 文件）⇒ 本地并列两批，**一次 push 带齐**（用户口径「一次 push 带齐全部内容」⇒ 1 轮 CI）。
- **台账回填**：沉淀 **E157**（归「一、机制可达性」⇒ 分类计数 25/26/17/71/18 = **157 ≡ 157**，`b79-t21-verify.mjs` exit 0）；批次导航加 B95 行（87 → **88/88/88/88**，`batch-nav-count.mjs` exit 0）；`AGENTS.md`(2 处) / `CLAUDE.md`(1 处) / `docs/沉淀/README.md`(5 处) / `HANDOVER.md` 的 E 区间与份数同步到 E1–E157 / 88 份；**订正 `TODOS.md` 的 T11 行**（原写「等 weekly 周期」，实为「合并指令不被受理」⇒ 活文档可改写）；`ROADMAP.md` 登记 B95 并把未决遗留的「14 门」订正为 **15 门**（B94 加门 ⑮ 时漏改的活文档读数）。
- **未验证（如实登记）**：新机制在 GitHub runner 上的真实行为 ⇒ 待 push 后 dispatch 实测；合并后 main 的 15 门与产物是否漂移 ⇒ 待 #9 合并后核验；Dependabot weekly 周期（仓库 11-25 创建，首次最早下周一 11-30）。
- **待回填（并入下一批，不单独成笔）**：push 后的远端提交哈希、CI run 读数、PR #9 的 auto-merge 实际结果 ⇒ 追加到 `HANDOVER.md`「平台侧处置记录」。
## 8. dispatch 实测与 D4' 补修（首测即误伤）

- **首测**：push 后 `gh workflow run dependabot-auto-merge.yml -f pr_number=9` ⇒ run `45828664828` **success**，但**秒级 exit 0**（若进 CI 轮询会 sleep 45 s×20 ⇒ 排除）、PR #9 仍 `OPEN`、`auto_merge` 仍 `null`、`merged_at` 为空 ⇒ 命中「PR 作者不是 dependabot[bot] ⇒ 不处理」分支。
- **根因（D4'，本批自己引入）**：`gh pr view --json author --jq .author.login` 对 Dependabot 开的 PR 返回 **`app/dependabot`**（不是 `dependabot[bot]`）⇒ 等值比较**必然假阴性** ⇒ **防 fork 校验把 Dependabot 自己的 PR 全部挡在门外**（讽刺的是它本意是防提权）。平台事件里的 `github.actor` 仍是 `dependabot[bot]`，所以旧 workflow 不受影响 —— 这是本批新引入的。
- **补修**：① 作者判据改为**白名单两种形式**（`dependabot[bot]` / `app/dependabot`）；② 真正的防 fork 判据换成 **head 仓库同源**（`headRepositoryOwner.login` == 仓库 owner）—— bot 命名会变，仓库归属不会；③ 判据抽成 **DEP-AUTHOR-OK 可执行块**，由守卫直接执行（不再靠文本正则）。
- **补修的自证**：守卫 **17 条**全绿；**八路注入 ⇒ 判红 ⇒ 按原字节还原 ⇒ 判绿**（新增 D4a「只认 `dependabot[bot]`」与 D4b「去掉 head 仓库校验」两路），还原后文件 SHA256 与注入前**逐字节一致**（`47f6c39f…` / 11925 bytes）。
- **教训归位**：这正是 **E150**「判据依赖数据源的命名约定 ⇒ 必须拿真实样本验证」的**第二次现身** ⇒ 并入 **E157**（不新增编号 ⇒ 不与 B96 的 E158 撞号）。
- **待办**：补修后再次 dispatch 实测；合并后 main 的 15 门与产物不漂移核验。
## 10. 平台侧读数与最终验收

- **PR #9 合并**：dispatch run `45832374173`（workflow_dispatch，pr_number=9）输出「PR #9 head=5a216496… 标题=build(deps-dev): bump playwright from 1.60.0 to 1.65.1 in the npm-patch group → **CI 全绿（第 1 次判定）** → **已为 PR #9 启用 auto-merge（squash）**」⇒ **PR #9 merged_at = 2026-11-26T13:46:27Z、state=closed**（挂起 20 h 后落地）⇒ **D1 / D2 / D4' 三处修法全部被真实样本验证**。
- **合并后的 commit**：`8a00de4`（`build(deps-dev): bump playwright (#9)`），改动面**只有** `package.json` + `package-lock.json`（playwright 1.60.0 → 1.65.1）。
- **合并后 main 的 15 门绿**：⚠️ 该 commit 的 push CI **不会触发**（GitHub 既定行为：Dependabot 身份推送的 commit 不触发 workflow）⇒ 改用 `gh workflow run ci.yml --ref main` **手动 dispatch**（run `45832937291`，head `8a00de4a`）⇒ **success** ✔。
- **产物与基线不漂移**：在临时 worktree（`8a00de4a`）上构建 ⇒ `dist/创界山-活人认证.html` = **212,032 bytes / SHA256 `80E5DA2EF72D188EFE51B8EDC2A2CBBABB2418B47DE0894F09C642BF9FDD6C78`** ⇒ **与 B89 基线逐字节相同**（playwright 只作 e2e 的 devDependency ⇒ 不进产物）⇒ T11 的验收口径达成。
- **CI 读数三连（如实留档，不掩盖）**：`3d065c5` = **failure**（门 ② 红 —— 本批自己打断的）→ `bcf9eed` = **cancelled**（并发组 cancel-in-progress，被后续 CI 顶掉）→ `8a00de4a` 手 dispatch = **success**（含 `bcf9eed` ⇒ 锚定修复有效）→ `90771f2` 的 push CI（run `45834151555`）= **success**（含 B96 全部改动 + playwright 1.65.1 的门 ⑩/⑭ 浏览器环节重验）。
- **销账**：**T11 关闭**（PR #9 已合并 + 合并后 15 门绿 + 产物逐字节相同）⇒ 从 `TODOS.md` 删除，核实确认写入 `HANDOVER.md`。
- **最终推送**：一次 push 带齐 B95 + B94 + B96 共十笔（远端 `90771f276c1dcae6d6de073c2785436df779a045`，逐笔 `git merge-base --is-ancestor` 全部 ANCESTOR）+ 本笔台账回填。- **本地环境缺口已消解（2026-11-26 22:5x，订正上文那一条）**：chromium 1255 已装好 —— 真因是 **playwright 1.65 起改用 Chrome-for-Testing 下载路径**（`builds/cft/159.0.8154.6/win64/…`，旧的 `builds/chromium/<rev>/…` 已不存在），且官方 `cdn.playwright.dev` 实测仅 **170 KB/s**（下载卡死在 57.7 MB 零增长 17 分钟）⇒ 改走 **npmmirror 镜像**（`PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright`，实测 **6.35 MB/s**，快 37 倍）⇒ **29 s 装完**（`chromium-1255` 451.9 MB + `chromium_headless_shell-1255` 286.7 MB + `ffmpeg-1013` 3.8 MB，`INSTALLATION_COMPLETE` 标记齐全）。**本地全量门禁 15 道全绿 exit 0**（门 ⑩ 浏览器端到端 5.7 s、门 ⑭ 浏览器走查 1.4 s、门 ⑮ 145.6 s）⇒ 上文那条「本地 992 例 / 6 个 e2e 败例」纯属**环境缺口**，**现已消解** ⇒ **CI（run `45837644741` success）与本地双读数皆绿**。
- **一条读数纪律的复发实证**：本轮我按 REST 读数判「CI 已跑 30 分钟还没完」，实际它 **6 分 59 秒就绿了**（15:10:11 → 15:17:10）⇒ 滞后的读数让我把「已绿」误判成「还在跑」⇒ 归入 **E151**（平台读数有缓存层级）的**反向复发**：判平台状态要同时看 `createdAt` 与结论字段，`updatedAt` 仍等于 `createdAt` ⇒ 那份读数就是创建瞬间的旧快照。
- **⇒ 连骗两次的升级版见 §11**（第二次是 push 后那轮 6 分 45 秒就绿，我仍报「跑了 30 分钟」）⇒ 教训升级为「**不能靠字段形态判断读数新旧，必须两端点交叉 + 看 `updatedAt` 是否变化**」。
- **本条已沉淀为 E160**（归「四、门禁与协作」⇒ 分类计数 72，E 行数 **160 ≡ 160**）⇒ 知识可跨项目复用（playwright 1.65 改走 Chrome-for-Testing 路径 + 官方 CDN 带宽不足 ⇒ 安装停滞不报错；解法 `PLAYWRIGHT_DOWNLOAD_HOST` 指向 npmmirror，实测快 37 倍）。
- **本地门禁的环境缺口（如实登记，不谎称本地全绿）**：本地 `node --test tests/gates/*.test.ts tests/engine/*.test.ts` = **992 例 / 985 过 / 6 败**，6 个败例**全部**是 e2e 相关（`Executable doesn't exist … chromium_headless_shell-1255…`）⇒ playwright 1.65.1 需要 chromium 1255、本机只有 1208/1223/1243 ⇒ **纯环境缺口，非代码/文档缺陷**（CI 每次自跑 `npx playwright install chromium`）⇒ 权威读数取 CI run `45834151555` = **success**。同轮局部判据：doc-sync **10/10**；E 行数 **159 ≡ 159**；导航 **89/89/89/89**。


## 9. 补修之二：连带打断 B90 守卫（抽取靠位置约定 ⇒ 治本改锚定）

- **现象**：D4' 补修提交（`3d065c5`）后，**门 ② 判红**：`tests/gates/dep-update-classify.test.ts` 报 `[eval]:9 # <<< DEP-AUTHOR-OK-END Expected '>', got '-'`（SyntaxError）。
- **根因（与初判不同，已复核）**：**不是**新块把注释放进了标记区间 —— 本批两个新抽取都用显式标记锚定，捕获组从 `node -e '` **之后**开始，注释不在捕获范围内。真凶是 **B90 守卫的抽取靠「位置约定」**：其正则是 `node -e '…' "$TITLE"`，从工作流里的**第一个** `node -e` 开始匹配 ⇒ 本批在 ⓪ 段插入了作者/仓库判据块（它排在最前）⇒ 抽取越过块边界，把 **yml 注释行**一起喂给 node ⇒ SyntaxError。
- **修法（治本）**：给 B90 的抽取加**显式标记锚定** `DEP-CLASSIFY-BEGIN` ⇒ 块边界由标记决定、**与插入顺序无关**（与本批两个新抽取同款）；并加一条常驻断言「抽出的代码不得含 `#` 注释行」⇒ 这类污染当场判红，而不是等人踩。
- **读数**：两个守卫文件 23/23 绿；**全量门禁 15 道全绿 exit 0**。
- **远端影响（如实登记）**：`3d065c5` 已 push ⇒ 该轮 CI（run `45830020361`）**门 ② 红**；本笔修正推送后应恢复绿 ⇒ 两轮 CI 读数都留档，不掩盖。



