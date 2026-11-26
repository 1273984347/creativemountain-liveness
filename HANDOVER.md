# HANDOVER · 交接记录

> **纪律**：每完成一项 ⇒ 在此追加**核实确认**（做了什么 · 读数 · 证据位置），并从 [TODOS.md](TODOS.md) 删除该项。
> 记录**只追加、不改写历史行**（与 `docs/沉淀/经验教训索引.md` 同一纪律）。

## 交接状态

| 项 | 值 |
| --- | --- |
| `main` | `373aad7`（本地主体提交；**远端仍在 `5218c97`** ⇒ 本地领先 1 笔 ⇒ **未 push**，推送需用户当轮点名授权） |
| 门禁 | **16 道**，全绿（B98 新增门 ⑯「dist 产物字节基线一致性」；其余门未变） |
| 批次档案 | **91** 份（`docs/批次/`） |
| 沉淀条目 | **E1–E165**（五类；E 行数 ≡ 分类声明之和） |
| 导航互洽 | 总览 / 小节标题 / 实际行数 / 目录文件数 = **91/91/91/91** |
| 未修复告警 | **0**（Security 页 Open 0 / Closed 4） |

### B98 · 沉淀补登与产物基线守卫（E164 + E151 补注 + 门 ⑯）

- **做了什么**：三件事同批交付 —— ① **E164** 落进沉淀索引（= B96 登记的 **L-B96-1**）：**否定性断言前必须当场重读**；本条含**两例**（B96 轮的「裁定未落笔、实施在先」高风险误提示 ⇒ 并行会话正确撤回；**开批前我自己的第二例** —— 据「沉淀索引只到 E163」断言「**E164 是缺口**」⇒ 实为 B96 §遗留**明写**「E164（编号已预留，**下一批第一笔落进沉淀索引**）」⇒ 它不是缺口，而是「**已预留、待落笔**」的第三种状态）；② **E151 第四次现身**：滞水面**又下沉一层** —— 连 **Actions 页 HTML**（用户可见面本身）都会滞后于真实终态 ⇒「以界面为准」**不足以**判终态 ⇒ **判终态以 job 级 + 日志正文为准**；③ **新增门 ⑯「dist 产物字节基线一致性」**：产物字节基线此前**只以文字形式**记在批次文档里（E153 同族）⇒ 现在有**入库基线** + **机器守卫**。
- **门 ⑯ 口径（先定后写）**：**独立重建**到临时目录（**不复用**门 ④ 的 `dist/`、**不就地覆盖** ⇒ 非同义反复）⇒ 算 **SHA256 + 字节数** ⇒ 与**入库基线** `docs/baselines/dist-artifact.sha256.json` **逐字节比对**（**容差 0**）⇒ **集合层**也判（本次产出集合必须 == 基线登记集合 ⇒ 构建入口新增输出格式却忘登记基线不会静默成盲区）⇒ **失败关闭**（基线缺失 / 不可解析 / 构建失败 / 零产出 ⇒ 一律判红）；基线刷新走**独立脚本**（`node tools/dist-artifact-baseline.mjs`，**不在门禁路径内**、CLI **无刷新开关** ⇒ 不存在能让门禁恒绿的通路）。
- **核实读数**：**三次独立构建** SHA256 与字节数**全等**（main `a0a85ee5…` / **212,032** bytes · play `094ca56a…` / **239,955** bytes）⇒ 容差 0 有据；门 ⑯ 单跑 **exit 0**；**我的独立复核**（隔离副本内改 `engine/core/statuses.ts`）⇒ **exit 1** 且**逐条点名**两产物的期望 / 实测 SHA256 与字节数；负样本 **判据级 18/18 + 端到端 6/6**（含「CLI **不得**提供刷新基线的开关」防回归）；doc-sync **C8 覆盖边界 18 条**逐条同序；沉淀 **E1–E165（165 ≡ 165）**；导航复算 **91/91/91/91**（`batch-nav-count.mjs` exit 0）；门数 **15 → 16**。全量门禁：**16 门全绿 exit 0**（`node tools/gate.mjs`；新增门 ⑯ **0.3 s** · 门 ⑮ 99.4 s · 门 ② 112.2 s ⇒ 门 ⑯ 纳入门禁链且**不拖慢**门禁链）
- **本批的一处失误已留痕**：全量门禁**首跑红在门 ①** —— 新增的 `tools/dist-artifact-lock.mjs` **缺 `.d.mts` 声明** ⇒ TS7016（无声明）+ **6 条**连带 TS7006（隐式 any）⇒ 报出来像 7 个独立缺陷，实为 1 个根因 ⇒ 补 `tools/dist-artifact-lock.d.mts` 后 **tsc exit 0** ⇒ 沉淀 **E165**（仓内已有先例 `tools/ir-validate.d.mts`，这条是**没沿用既有做法**）。
- **图示同步**：图集 03「门禁全景」**改源重生成**（源：`docs/图示/build/figures/03-gate-panorama.mjs`）⇒ 两档均为十六道门 / 门 9–16；**本人目视核对两档截图** ⇒ 第一版的排版缺陷（「· 字节锁」落在行首、「门 / 16」被拆词）**探针两轮都报「溢出 0」却只有看图才发现** ⇒ 改用 `svg-kit` 的 `wrapText` **算**断点后重排 ⇒ 两档断点**逐字一致**。
- **遗留**：**L-B98-1** —— 门 ⑯ 的基线由本地实测生成 ⇒ **CI 首跑须验证产物字节一致**（CI 跑 `windows-latest`，与本地同平台 ⇒ 无跨 OS 差异面；剩余未证项 = runner 上的 Node / esbuild 实际版本）⇒ 若判红，处置是**定位差异字节**，**禁止**放宽容差或刷新基线掩盖。
- **提交**：主体 **`373aad7`**（`feat(gates): B98 沉淀补登与产物基线守卫…`，30 files · 1069 insertions）⇒ 本地领先远端 1 笔；收官回填见下一笔（**只改台账数字，不含代码改动**）。
- **未做（需授权）**：**未 push / 未开 PR / 未合并**（外部可见动作须用户当轮点名授权）。

### B97 · 力竭可见性增强（T22 / L-B93-2 收口）

- **做了什么**：把 B96 登记的「力竭稀有度未改善」落成**已实施**的增强 ⇒ 四问裁定（**强档** + 目标读数 **每百局 ≥ 6.0** + 低档 **3–6 人 ≥ 2.5** + **加数据契约守卫**）⇒ **四套主题的 2 张毒牌层数上移（1 层牌 → 2 层、2 层牌 → 3 层）且牌面文案同改**（数据层 ⇒ 规则书「中毒 N 层：按层数扣体力」口径**不变**）⇒ 平衡报告重生成 + 规格 v2.5 + 新增 `tools/poison-card-contract.mjs`（+ `.d.mts` 类型声明）与 `tests/gates/poison-strength-contract.test.ts`。
- **核实读数**：**力竭触发 162 → 2107 人次 / 每百局 0.675 → 8.78**（**12.8×**，实施后 24000 局口径 ⇒ 与实施前精测 `dataA_s1000` **逐位一致**）；**低档分档实测**（各 4000 局）：3 人 **7.85** · 4 人 **5.20** · 5 人 **3.35** · 6 人 **5.10** 每百局（基线 0.10–0.22 ⇒ 低档第一次真正可见）⇒ **目标读数 X 与低档 Y 均达标**。
- **约束层（不改变胜负）**：身份最大偏离 **3.69 / 3.61pp**（记录线 15pp）· 位次极差 **4.33 / 5.52pp**（阈值 14）· RMS **2.01 / 2.46**（阈值 6.5）· 异常 **0** · 无席位兜底率持平 ⇒ 属「**可见张力**」而非平衡改动；解算三路径仍真实发生（自恢 24.3% / **救援 35.7%** / 自然 20.1%）且**未解除 19.8%**（悬到终局）⇒「救与不救」的社交互动保留。
- **方向为什么必然落到掉血侧（实测）**：回血侧四个变体（封顶 1 点 / 封顶 2 点 / 低档封顶 1 点 / 低档封顶 2 点）读数与基线**逐位相同** ⇒ `heal` 是**「回满型」**（`Math.min(hpMax, hp+amount)`）⇒ 只要回血总量 > 0，HP 就回得到接近满 ⇒ 削弱回血对「HP 见底」**零杠杆**（要有效须把回血压到 0 = 废掉治疗牌）⇒ 而掉血侧主力触发源是 **poison**（8 人档 65 / damage 19 / 险径 0）⇒ 四组精测各 24000 局 × 2 组独立 seed 基后由用户裁定强档。
- **两处判断失误已留痕（不 amend 掉错误结论）**：① **「引擎 +1 ≡ 数据层 1→2、2→3」的等价性判断错了**（忽略了**层数会衰减** ⇒ 层数 = 持续回合数 ⇒ 两者实测差 **2.2 倍**：8.62 vs 4.00 每百局）⇒ 沉淀 **E162**；② **实验台第一轮全组假绿**（六个变体读数逐位相同 ⇒ 实为 **ESM 静态 `import` 早于补丁求值 ⇒ 补丁从未进入运行路径**，而哨兵只验到文件层）⇒ 沉淀 **E163**。
- **门禁与台账**：本地全量 **15 道全绿** + **CI run `45855909552` success**（headSha `dea81bb`，日志「== PASS：15 门全绿 ==」，16:15:49Z；⚠️ run 级 `status` 在完成前会返回**旧快照**「in_progress」⇒ 以 **job 级 + 日志正文**为准，E151 同类）（门数未增；新守卫由门 ② 纳入）· 守卫 **6/6**（2 正例 + 4 路负样本：退回 1 层 / 只改数值不改文案 / 删牌 / 强档核心丢失，各判红）· 导航复算 **90/90/90/90**（`batch-nav-count.mjs` exit 0）· 沉淀 **E162 / E163**（E 行数 ≡ 分类声明之和）。
- **单文件产物基线（本批重登记）**：`dist/创界山-活人认证.html` = **212,032 bytes / SHA256 `A0A85EE5615C3249F794C44F6F625979B2F5F3DA3FC5672462D2A910F922CBF4`** ⇒ ⚠️ **B89 基线 `80E5DA2E…` 至此失效**（差异来源 = **牌面文案**改动：毒牌「中毒 1/2 层」→「2/3 层」⇒ **字节数不变、哈希变**；**引擎逻辑零改动** ⇒ 非构建漂移）⇒ 新基线在此登记，避免下次拿旧基线误判。⚠️ **两个原因分开**：**playwright 1.60→1.65.1 不影响产物**（只作 e2e devDependency、不进产物）⇒ 使旧基线失效的**只有本批牌面文案**；且**同字节数不同哈希 ⇒ 必须比 SHA256，只比字节数会漏判**。
- **遗留**：读数侧**无机器锁**（本批只钉数据侧）⇒ 已登记 **T23**。
- **证据位置**：`docs/批次/B97-力竭可见性增强-执行记录.md`

### B96 · 力竭触发稀有度现查（T20 / L-B93-2）

- **做了什么**：现查规格 §13.3 的遗留「**力竭触发稀有度**」⇒ **三组独立 seed 基**（每组 24000 局：基线 seed 1000 族 + seed 5000 + seed 9000）得 **162 / 136 / 137 人次 = 0.68 / 0.57 / 0.57 每百局**（**样本标准差 0.061 / 相对波动 10.1% ⇒ 三样本同向**）；另**分人数档**各跑 4000 局（6 档）⇒ **7+9+4+6+53+83 = 162**，与基线报告总览**逐位吻合**（两套跑法互证）。
- **核实读数**：**解算三路径全部真实发生**（合并 自恢 35.6% / **救援 45.4%** / 自然 19.0% ⇒ 救援占比最高，正合 B76「救与不救成为真实社会互动」）；分档 **6 档全非零**但**极不均**（3–6 人 0.10–0.22 vs **7–8 人 1.32–2.08** 每百局）⇒ 成因已取证：**三个触发点与人数档无关**（damage op / poison 结算 / 险径黑牌，一律「HP 归零 ⇒ 力竭」）⇒ 差异来自**每局玩家行动总次数**（回合数 × 人数：3 人 36 次 vs 8 人 **136 次** = 3.8 倍）⇒ 人多时攻击牌有更多目标 ⇒ **设计内生，非机制 bug**；6 人档「自然恢复 = 0」是**小样本稀疏**（该档仅 6 人次，2 自恢 + 3 救援全部在 2 round 内被主动解开）⇒ 不判机制缺失。
- **★ 结论反转（本批的判断失误，已留痕）**：首轮拿 **B76 的 0.02/百局**当对照 ⇒ 得出「高约 30 倍 ⇒ 已不偏少 ⇒ 关闭」；**错** —— 那 30 倍来自 **B77 把 poison 路径接上**（**机制扩展**，不是稀有度改善）⇒ 正确对照是 **B77 登记待办时的 162 人次 / 0.68 每百局** ⇒ 现查与之**逐位相同** ⇒ **稀有度完全未改善** ⇒ B77「绝对量仍稀」**未被推翻** ⇒ 按 T20 验收口径「若仍偏少则登记为专门平衡批次」⇒ **登记 T22**（不关闭、不动手）。**订正方式**：订正提交 + 失误留痕（**不 amend 掉错误结论**）⇒ 沉淀 **E159**。
- **零引擎改动**：`engine/**` 未动 ⇒ `docs/balance-report.md` **逐字节未变**（SHA256 仍 `F93087C8…`）⇒ 纯现查批。
- **证据位置**：`docs/批次/B96-力竭触发稀有度现查-执行记录.md`

### B94 · 平衡报告入库一致性门（门 ⑮）

- **做了什么**：销账 **L-B92-4 / T18** —— 新增第 **⑮** 道门「平衡报告入库一致性」，让 `docs/balance-report.md` **进入门禁的比对面**（起因：R8 的教训是「报告入库却没人看着」⇒ 引擎演进后它悄悄过期，引用它的文档一起过期，且无门会报）。做法：按报告的生成口径（默认参数 = 4 主题 × 6 人数档 × 1000 局 = **24000 局**）**重跑一份新的到 `.tmp/`**（**绝不覆盖入库版**），与**入库版逐字节比对**（**容差 0**，仅归一化行尾 LF）。**口径与容差由实测导出，非拍脑袋**：容差 0 的依据是「三次独立产出 SHA256 全等」；比对面取「独立重跑」而非「自己重生成出来的自己」——后者必然相等、门禁永绿。门禁编号追加在**末尾** ⇒ **⑨/⑫/⑬ 编号不变**（L-B92-1 重标定可直接引用）。
- **核实读数**：现查 ⇒ 重跑 A / 重跑 B / 入库版**三者 SHA256 全等**（`F93087C8…`，25,797 bytes / 621 行，`git diff --no-index` 输出 0 行）⇒ **当前无漂移**且**逐字节可复现**；端到端自证（隔离副本注入 `statuses.ts` poison 扣血 +1）⇒ 未漂移 **exit 0** → 漂移 **exit 1**（**167 处差异**；24000 局口径下 **266 处**，含「力竭触发 162 → 954 人次」）→ 按原字节恢复 **exit 0** ⇒ **违例必红、恢复必绿**；门 ⑮ 单跑 **exit 0 / 139–211 s**（空闲机 ~139 s、有并发负载 ~211 s）、入库版**零改动**；**全量门禁 15 门全绿**（定稿复验：门 ⑮ 150.9 s · 整链 ≈ 4.5 分钟）；判据级负样本 **19/19** + 端到端 **4/4**；判据级负样本 **13/13**、端到端负样本 **4/4**（隔离副本，共享工作树全程只读）；doc-sync **10/10**（C8 覆盖边界 **17 条**逐条对应）；导航复算 **87/87/87/87**；沉淀 **E156**，E 行数 ≡ 分类声明之和；门数 **14 → 15**（全仓 fan-out 0 残留）。
- **两处判断失误（留痕）**：① 端到端自证**首轮假绿** —— CLI 用 `process.cwd()` 定位根 ⇒ 副本里跑的仍是**原仓引擎** ⇒ 改为按**脚本自身位置**定位根后即得 167 处差异；② 我在副本里生成基线时用了**相对 `--out`** ⇒ 该路径按 **cwd** 解析 ⇒ **覆盖了仓内的 `docs/balance-report.md`**（30 局口径）⇒ 已按**原字节**恢复（恢复后 SHA256 与原值全等 ⇒ 工作树干净）⇒ 改用绝对路径重做。两条均已沉淀进 **E156**。
- **证据位置**：`docs/批次/B94-平衡报告入库一致性门-执行记录.md`

### B95 · Dependabot 自动合并机制修复（D1 / D2 / D3）

- **做了什么**：修掉让 PR #9（playwright 1.60→1.65）挂起 **19 h** 的三处机制缺陷：① **D1「等 CI 全绿」从未生效** —— 判据查 `check-runs`，CI 的 check-run 尚未创建时查到的是**空列表** ⇒ pending=0 ⇒ 直接判绿（run `45667433870` 日志：17:41:45 打印「CI 全绿」、17:41:46 发指令，而 gate chain 17:46:43 才完成 ⇒ **CI 红了也照发合并指令**）⇒ 改看 **workflow run**（`actions/runs?head_sha=`，排除本工作流自己；无 run ⇒ `wait`、未完成 ⇒ `wait`、有失败 ⇒ `fail`、全绿且含 CI 工作流 ⇒ `green`）；② **D2 指令不被受理** —— 旧实现发 `@dependabot merge` 评论，发评论的是 `GITHUB_TOKEN`（github-actions[bot]，**无仓库写权限**）⇒ 平台侧不受理（PR 的 `auto_merge` 恒为 `null`，从未进队列）⇒ 改走 GitHub 官方路径 **`gh pr merge --auto --squash`** + **`permissions: contents: write`**（auto-merge 由 GitHub **服务端**执行 ⇒ 合并后照常触发 CI；用 token 直接 merge 不会触发 CI）；③ **D3 `| head -5` 在 `set -euo pipefail` 下因 SIGPIPE 让脚本误退出变红**，并跳过本该走的「保持人工审」分支 ⇒ 改 `grep -E -m 5`。另加固：工作流带 `contents: write` ⇒ **手动触发也必须校验 PR 作者是 `dependabot[bot]` 且非草稿**（防 fork 提权）。B90 的三重闸门（major / 分组 unknown / 预发布依赖）原样保留。
- **核实读数**：新增守卫 `tests/gates/dependabot-merge-path.test.ts` **14 条**（**直接执行 yml 里那段判据代码**，非复刻）全绿；**七路注入 ⇒ 判红 ⇒ 按原字节还原 ⇒ 判绿**（D1 判绿 / D2 去 `--auto` / D3 不排除自身 run / D4 去作者校验 / D5 降级 `contents` / D6 拿旁证充 CI / D7 回灌 `| head`），还原后文件 SHA256 与注入前**逐字节一致**（`a941c92d…` / 10106 bytes）；既有 B90 分类守卫 5/5 未受影响、`discipline` 6/6 绿；YAML 语法用 pyyaml 解析通过（`on` / `permissions` / `jobs` / `steps` 结构读出）；**门数 15 未增**（新守卫由门 ② 自动纳入）；导航复算 **88/88/88/88**；沉淀 **E157**，E 行数 ≡ 分类声明之和（**157 ≡ 157**）。
- **自证中发现并修掉的守卫缺口（留痕）**：合并路径断言原先用全文正则 `gh pr merge --auto`，而**文件头注释里恰好也写着这句话** ⇒ 把执行行改成 `gh pr merge --squash` 注入时守卫**没红**（守卫生了鉴别力缺口，等于没守）⇒ 改为只认「**可执行行**」（剔除整行注释）后 D2 才真正判红。
- **dispatch 实测与 D4'（本批自己引入的缺陷，已补修）**：push 后 `gh workflow run dependabot-auto-merge.yml -f pr_number=9` ⇒ run `45828664828` **success** 但**秒级 exit 0**（若进 CI 轮询会 sleep 45 s×20 ⇒ 排除）、PR #9 仍 `OPEN`、`auto_merge` 仍 `null` ⇒ 命中「作者不是 dependabot[bot] ⇒ 不处理」分支。根因：`gh pr view --json author --jq .author.login` 对 Dependabot PR 返回 **`app/dependabot`** ⇒ 等值比较**假阴性** ⇒ **防 fork 校验把 Dependabot 自己的 PR 全挡在门外**（正是 E150「判据依赖命名约定」的第二次现身）。补修：作者**白名单两种形式** + 防 fork 改用 **head 仓库同源**（bot 命名会变、仓库归属不会），判据同样抽成可执行块由守卫直接执行；守卫 17 条 + **D4a/D4b 两路注入自证**（只认 `dependabot[bot]` ⇒ 判红；去掉 head 仓库校验 ⇒ 判红）。
- **未验证**：补修后新机制在 GitHub runner 上的真实行为（首测即 D4' 误伤，见上 ⇒ 待再次 dispatch 实测）；合并后 main 的 15 门与产物是否漂移；Dependabot weekly 周期（仓库 11-25 创建，首次最早下周一 11-30）。
- **证据位置**：`docs/批次/B95-Dependabot自动合并机制修复-执行记录.md`
- **最终验收（2026-11-26 22:0x，销账 T11）**：dispatch run `45832374173` 输出「PR #9 head=5a216496… → **CI 全绿（第 1 次判定）** → **已为 PR #9 启用 auto-merge（squash）**」⇒ **PR #9 merged_at = 2026-11-26T13:46:27Z、state=closed**（挂起 20 h 后落地）⇒ D1 / D2 / D4' 三处修法**被真实样本验证**；合并 commit `8a00de4`（`build(deps-dev): bump playwright (#9)`）改动面**只有** `package.json` + `package-lock.json`；⚠️ 该 commit 的 push CI **不会触发**（Dependabot 身份推送不触发 workflow）⇒ 改用 `gh workflow run ci.yml --ref main` 手动 dispatch（run `45832937291`）⇒ **success**；产物在 worktree 上按 `8a00de4a` 构建 = **212,032 bytes / SHA256 `80E5DA2E…D6C78`** ⇒ **与 B89 基线逐字节相同** ⇒ **T11 关闭**（从 `TODOS.md` 删除）。CI 读数三连留档：`3d065c5` = failure（门 ② 红）→ `bcf9eed` = cancelled（并发组被顶掉）→ `8a00de4a` 手 dispatch = success（⇒ 锚定修复有效）→ `90771f2` 的 push CI（run `45834151555`）= success（含 B96 全部改动 + playwright 1.65.1 的门 ⑩/⑭ 重验）。

## 平台侧处置记录

### 2026-11-26 19:56 · 并行会话的只读复核（**非本批产物**· 但避免据此误判仓库状态）

- **来源**：并行会话（`mvs_beb4763024e14d64b5e890b0ca7db708`）本轮只读复核，**未改任何文件、未提交**。
- **并发提示**：它曾在 19:56–19:58 跑过一次 `node tools/gate.mjs`（约 300 s 被宿主 wall-clock 中止）⇒ 与本批的门禁运行**可能重叠** ⇒ 本批已**重跑一次门禁**排除并发污染（读数见 B94 段）。
- **三条仓库侧读数**（供台账参照，**本批不处理**）：
  ① **PR #9**（playwright 1.60→1.65）**仍未合并**，挂起约 26 h；`auto_merge=null`、检查全绿、`mergeable_state=clean` ⇒ **不是 CI 红、不是冲突**（T11 的观察项继续挂着）。
  ② **自动合并 workflow 两处缺陷已坐实**：D1「等 CI 全绿」在 check-run **尚未创建**时误判绿（run `45667433870` 日志：17:41:45 打印「CI 全绿」，而 gate chain 17:46:43 才完成）；D2 合并指令由 **GITHUB_TOKEN**（无 push 权限）发出，而 GitHub 官方推荐路径是 `gh pr merge --auto` + `permissions: contents: write`。
  ③ **Dependabot weekly 周期至今未触发**（仓库 11-25 创建，首次最早下周一）⇒ T9 的 security job 结论仍待该周期；host 那 7 条 security-update 失败发生在 `b7ac750` 的 overrides 落地**之前**，落地后唯一一次 host 运行是 version update 且 success。
- **处置**：**本批不动这些**（属另一条工作线，且 auto-merge 缺陷修复会改 CI 行为 ⇒ 需独立批次）⇒ 仅登记读数，避免后续会话据旧读数误判。
- **提交顺序留痕**：B95 已由并行会话**单独提交**为 `9bdbc19`（"fix(deps): 修 Dependabot 自动合并机制——CI 判据改 run 口径 + 走 gh pr merge --auto"）⇒ 本地 `main` **ahead origin/main 1**；本批 B94 提交将**叠在 B95 之上**（用**显式 pathspec**，只提交本批 28 个文件，不含 B95 任何路径）。

### 2026-11-26 · github.com:443 临时阻断 ⇒ 改用 Git REST 数据接口完成 push

- **现象**：`git push` 报 `Failed to connect to github.com:443`；而 `api.github.com:443` / `github.com:80` / `github.com:22` / `ssh.github.com:443` **全通**，hosts 干净、DNS 正常 ⇒ 该链路 443 的**临时阻断**（约 30 分钟后自行恢复）。
- **处置**：走 `POST /git/blobs` → `/git/trees`（base_tree）→ `/git/commits` → `PATCH /git/refs` 逐个重建 3 个台账提交。
- **正确性取证**：每个提交的 **blob sha 与 tree sha 与本地逐字节一致**；远端 main 的 tree 与本地 tree 相同 ⇒ **整个仓库内容逐字节一致**（远端 TODOS.md / HANDOVER.md 的 blob sha = 本地工作树 sha = 本地 HEAD blob sha，三者全等）。
- **副作用与消解**：REST 生成的 commit 对象与本地 git 的**不是同一个**（GitHub 规范化日期偏移与 message 尾换行，差异项不可枚举）⇒ 远端 hash 与本地不同 ⇒ 本地 ahead 3、下次 push 会 non-fast-forward。通道恢复后 `git fetch origin && git reset --hard origin/main` ⇒ 本地**对齐到平台那个 commit 对象**（工作树内容 sha 不变）⇒ 两边**同一 hash**、历史完整（`227a88b` / `88de023` / `5eca4dc`）。
- **沉淀**：**E154**。
- **遗留**：备用 SSH key 已生成（`~/.ssh/id_ed25519_gh_creativemountain`）但**未加入 GitHub 账号 ⇒ 未生效** ⇒ 若 443 再被阻断，需你点名授权把公钥加到账号（账号权限变更），之后 push/fetch 走 SSH 即免疫该阻断。
- **✅ 遗留已消解（2026-11-26 18:2x）**：SSH 备用通道**已启用**
- **✅ 作用域已收窄（2026-11-26 19:1x）**：原写法 `Host github.com` + `HostName ssh.github.com:443` 会对**本机所有 SSH 客户端**的 github.com 访问生效 ⇒ 已改为 GitHub 官方转发写法：`Host 127.0.0.1`（HostName ssh.github.com / Port 443 / IdentityFile 指向本仓库专用 key / IdentitiesOnly yes），remote 改为 `ssh://git@127.0.0.1:443/1273984347/creativemountain-liveness.git` ⇒ **本机其它 github.com 的 SSH 行为完全恢复原状**，这把 key 只对本仓库生效。实测：本仓库 ssh -T 认证成功、git ls-remote exit 0、git push exit 0；普通 git@github.com 的 Offering key 列表里**已不含**本仓库专用 key。⚠️ 已知折中：该 key **无口令**（Windows 的 ssh-agent 服务为 Disabled ⇒ 带口令 key 需管理员启用 agent 才能免交互使用）⇒ 以「作用域严格限定到单仓库」替代「口令保护」。 —— 公钥已加入账号（key id 171192097；初版 171191754 因生成时误带口令已删除），~/.ssh/config 固定「github.com → HostName ssh.github.com / Port 443 + IdentityFile 自定义私钥 + IdentitiesOnly」，remote 已切为 git@github.com:… 。**实测**：ssh -T git@github.com ⇒ 「Hi 1273984347! You have successfully authenticated」；git ls-remote origin ⇒ exit 0（读到 d0035b0）；git push origin main ⇒ exit 0（Everything up-to-date）⇒ **SSH 通道可用且已实测**，此后 push/fetch 不再受 github.com:443 阻断影响。
- ⚠️ 过程留痕：初版私钥因 PowerShell 把 -N 传成**两个字面引号**（等于设了口令）⇒ BatchMode 认证被拒；已改为**参数数组直传**（-N 的值是真正的空串）重新生成，并以 ssh-keygen -y 可无口令导出、且与 .pub 一致作校验。

### 2026-11-26 22:0x · B95 机制修复上线并让 PR #9 真正合并

- **远端**：`main` = `90771f276c1dcae6d6de073c2785436df779a045`；一次 push 带齐 B95 + B94 + B96 共十笔 ⇒ 逐笔 `git merge-base --is-ancestor` 全部 ANCESTOR（`9bdbc19` / `4e938fe` / `010aca7` / `3d065c5` / `bcf9eed` / `8a00de4a` / `9013a2c` / `e6ae90f` / `87d70bf` / `90771f2`）⇒ 本地与远端同一 commit 对象。
- **PR #9**：merged_at `2026-11-26T13:46:27Z`、state `closed` ⇒ 挂起 **20 h** 后由**新机制自己合并**（旧机制挂起 20 h 零动作）。
- **合并后的 CI**：Dependabot 身份推送不触发 workflow ⇒ 合并 commit `8a00de4a` 的 push CI **不存在**（不是失败）；改 `gh workflow run ci.yml --ref main` 手动 dispatch（run `45832937291`）⇒ **success**（15 门全绿）。
- **产物**：worktree（`8a00de4a`）构建 ⇒ `dist/创界山-活人认证.html` **212,032 bytes / SHA256 `80E5DA2EF72D188EFE51B8EDC2A2CBBABB2418B47DE0894F09C642BF9FDD6C78`** ⇒ 与 B89 基线**逐字节相同** ⇒ playwright 升级**不进产物**（只作 e2e 的 devDependency）。
- **CI 读数三连（如实留档）**：`3d065c5` **failure**（门 ② 红 —— 本批自己打断的）→ `bcf9eed` **cancelled**（并发组 cancel-in-progress 被顶掉）→ `8a00de4a` 手 dispatch **success**（含 `bcf9eed` ⇒ 锚定修复有效）→ `90771f2` push CI **success**（含 B96）。
- **新 PR 自动保持人工审**：合并后 Dependabot 另开 `@types/node` / `typescript` 更新 PR，auto-merge run `45832812731` 判 major ⇒ 保持人工审（**B90 的判定在真实样本上复验通过**）。

### 2026-11-26 22:5x · 本地浏览器环境补齐 ⇒ 本地 15 门全绿（与 CI 互为旁证）

- **装上了什么**：playwright 1.65.1 需要的 **chromium revision 1255**（= Chromium 159.0.8154.6）+ ffmpeg 1013。
- **真因**：playwright 1.65 起改用 **Chrome-for-Testing** 下载路径（`builds/cft/159.0.8154.6/win64/…`），旧的 `builds/chromium/<rev>/…` 路径已不存在；官方 `cdn.playwright.dev` 实测仅 **170 KB/s** ⇒ 下载卡死在 57.7 MB 零增长 17 分钟（此前 B96 会话那次下载被并发抢 `__dirlock` 中断，两次同因）。
- **解法**：走 **npmmirror 镜像**（`PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright`，实测 **6.35 MB/s**，快 37 倍）⇒ **29 s 装完**；目录 `chromium-1255`（451.9 MB）/ `chromium_headless_shell-1255`（286.7 MB）/ `ffmpeg-1013`（3.8 MB），`INSTALLATION_COMPLETE` 标记齐全。
- **读数**：**本地全量门禁 15 道全绿 exit 0**（门 ⑩ 浏览器端到端 5.7 s、门 ⑭ 浏览器走查 1.4 s、门 ⑮ 145.6 s）⇒ 此前登记的「本地 6 个 e2e 败例 = chromium 1255 缺失」**环境缺口已消解** ⇒ **CI（run `45837644721` success）与本地双读数皆绿**。

## 已完成（核实确认）

### L-B90-3 / T9 · Dependabot security job 的**根因消除**（不等 weekly）

- **销账理由**：原验收口径是「下一次 weekly 周期后 `Dependabot Updates` runs 无 failure」—— 但 **weekly 由平台调度，本地无法加速，定时提醒也等不来** ⇒ 改为当场证明「**失败条件已不成立**」：Dependabot 的 security-update 当年之所以失败，是因为「**有 advisory + 依赖树里没有修复版本 + 无法自动升级**」（它当年的提示原文就是「Add an override/resolution to pin katex to a non-vulnerable version」）⇒ 现在这三条**都不成立**。
- **当场取证（2026-11-26 23:4x）**：host 目录 `npm audit --json` ⇒ `vulnerabilities: {}`，**info/low/moderate/high/critical 全 0**；`npm ls katex i18next diff --all` ⇒ **当初失败的那几条传递边**（`sparkdesign@0.4.11 → mermaid / rehype-katex / micromark-extension-math → katex`）现已解析为 **katex 0.18.10**（修复版 ≥ 0.18.2）· **i18next 26.7.2**（≥ 26.3.4）· **diff 8.0.4**（≥ 8.0.3），与 `package-lock.json` 逐项一致 ⇒ **overrides 生效**；且 Dependabot 能正常解析 host 依赖树（11-25 17:40:44 的 host 版本更新 run = success ⇒ overrides 没让解析炸）。
- **结论**：**当前依赖树零已知漏洞 + 三条历史失败路径的包都已是修复版 ⇒ Dependabot security-update 的失败条件不成立 ⇒ 该 job 不会因这三条再失败** ⇒ **T9 销账**，weekly 首次运行**降级为例行观察**（不再占用待办与提醒）。
- **配套留档**：① 11-25 16:47–16:49 那 7 条 failure 是 **overrides 落地前**的历史（根因 = `sparkdesign` 经 mermaid / rehype-katex / micromark-extension-math 钉住 katex / i18next / diff 旧版）；② 11-25 17:40 之后 host 目录**零新的 security update 运行、零失败**（告警已 open 0 / closed 4 ⇒ 无待修项 ⇒ 不会触发）；③ weekly **至今未观测到**（最近两次 Dependabot 活动 = 11-25 17:40 push 带来的版本更新、11-26 13:47 PR #9 合并触发的依赖检查 ⇒ **都不是周期运行**；仓库 11-25 创建 ⇒ 首次 weekly 应在 11-30 周一）—— **此项不影响销账**。
- **证据位置**：本段 + `docs/沉淀/经验教训索引.md` E161


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
- **CI 终态**：run `45679560620`（headSha `bf125e6`）⇒ **success**（门禁链 job success）⇒ 本轮**四批（B89 / B90 / B91 / B92）连续四次 push 的 CI 全绿**。
- **PR #9 观察**：推送后仍 `OPEN` 未合并（评论数 1 = 那条 `@dependabot merge`）⇒ 继续挂起等 Dependabot 下次检查时 rebase；**未发生任何自动合并**。
- **观察窗口复核（2026-11-26 17:41）**：距 B92 推送 **13.6 小时**仓库完全静止 —— `main` 仍是 `bf125e6`、未修复告警 **0**、PR **#8 / #10**（`deps-major`）仍 `OPEN` 且**零 `@dependabot merge` 评论**、PR **#9** 已 **rebase**（head `5044397` → `5a21649`，已含 B89–B92）但仍**未合并** ⇒ 判定 Dependabot 在等**它自己的下一次检查周期**（weekly）⇒ 机制无异常、**无误合并**。Dependabot 的 **weekly 周期尚未触发**（最后一批是 17:40 push 带来的 version update）⇒ T9 的 security job 结论仍待该周期。
- **SSH 通道下的 CI 也绿**：run `45800687863`（head `8899be5`，**经 SSH 通道推送**）⇒ **success** ⇒ 本轮**连续五次 push 的 CI 全绿**；顺带实证 SSH 通道推送链路在 CI 侧也正常。
- **观察窗口延长（2026-11-26 18:31）**：PR #9 仍 `OPEN`、head `5a21649` 自 11-25 17:41 起**未变**；Dependabot 的 **weekly 周期仍未触发**（最近 20 条运行里只有 11-25 17:40 的 github_actions 一条）⇒ 判定为**等它自己的周期**，机制无异常、无误合并；T9 的 security job 结论同样待该周期。
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
