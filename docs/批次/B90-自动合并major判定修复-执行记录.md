# B90 自动合并的 major 误判修复（工作流判定 + Dependabot 分组）· 执行记录

## 1. 目标与范围

- 批次号：B90（B89 已在 `b7ac750` 提交并推送；`docs/批次/` 无 B90 占用）
- 主题：修掉「Dependabot 自动合并把 **major** 当成 patch/minor 合并」的判定缺陷
- 本批**不做**：不改引擎/UI、不改任何依赖版本、不新增门禁（门数仍 **14**）、不升级 `sparkdesign`、不合并或关闭任何 PR（关 PR 是外部可见动作 ⇒ 需单独点名授权）
- 涉及共享面：
  - `.github/workflows/dependabot-auto-merge.yml`（版本跨度判定）
  - `.github/dependabot.yml`（三个更新目录的 `deps-major` 分组）
  - `tests/gates/dep-update-classify.test.ts`（新增守卫：分类逻辑 + 配置结构）

## 2. 执行前计划

| # | 计划项 | 验收口径 |
| --- | --- | --- |
| 1 | 定位误判根因 | 读工作流判定代码 + 读**真实** Dependabot PR 标题 ⇒ 指出「哪些标题会绕过判据」 |
| 2 | 判定改造 | 分类结果只有三种：`major`（人工审）/ `safe`（可自动合并）/ `unknown`（保守人工审） |
| 3 | 配置侧对齐 | `.github/dependabot.yml` 的**每个**更新目录都把 major 单独分组 ⇒ Dependabot 自己给 major PR 打标记 |
| 4 | 守卫 + 自证 | 新增守卫用**真实出现过的标题**做样本；并做「注入旧逻辑 ⇒ 必红、还原 ⇒ 必绿」自证 |
| 5 | 类型与门禁 | `tsc --noEmit` 通过；14 门全绿 |

## 3. 关键裁定

| # | 争议点 | 裁定 | 理由 | 落地位置 |
| --- | --- | --- | --- | --- |
| 1 | major 到底怎么判 | **解析标题里的 `from A to B` 主版本号**（主版本号不同即 major），并保留 `deps-major` 标记命中；**分组 PR（解析不出 from/to）一律 `unknown` ⇒ 人工审** | 旧判定只认「标题含 `deps-major`」，而 Dependabot 对**未分组的 major 更新根本不会写那个标记** ⇒ 实测 4 个 major PR 全部绕过判据 | 工作流 ① 段 |
| 2 | 判定逻辑放在哪 | **内联在 yml 的 `DEP-CLASSIFY` 标记块**里，用 runner 自带的 `node -e` 执行；守卫测试**直接抽出那段代码来跑** | ① `pull_request_target` **不 checkout 仓库代码** ⇒ 放仓库文件取不到；② 放仓库文件+测试里复刻一份 ⇒ 又是「同一口径两份实现」（E94）⇒ 测试直接执行 yml 里那段才是单一事实源 | 工作流 + `tests/gates/dep-update-classify.test.ts` |
| 3 | 分组 PR 怎么处理 | 一律 `unknown` ⇒ 人工审 | 分组 PR 标题形如「bump the X group … with N updates」，**没有 from/to**，且组内可能混进 major（分组名很乐观，B87 已在 beta 那条吃过亏）⇒ 保守 | 工作流 `unknown)` 分支 |
| 4 | 配置侧要不要一起改 | **要**：三个更新目录（根 npm / host npm / github-actions）都加 `deps-major` 组（只含 major） | 不改配置 ⇒ major 永远是「未分组独立 PR」⇒ 标题永远不带标记 ⇒ 规则 a 永远不命中；改配置后 Dependabot 自己给 major PR 打标记 | `.github/dependabot.yml` |
| 5 | 已开着的 4 个 major PR | **本批不自动处置**（关闭 PR 属外部可见动作 ⇒ 需单独点名授权）；本批只保证「**下次不再被误合并**」 | 用户的授权口径：外部可见动作逐次点名授权 | 见 §6.3 |
| 6 | 误合并怎么止血 | **中止两个正在跑的 auto-merge run**（不评论、不合并），而不去改 PR 状态 | 中止一次自动执行**不改变仓库内容**、可逆；关闭 PR 会改仓库状态 ⇒ 留给用户决定 | `gh run cancel` |

## 4. 实测数据

| 指标 | 改前 | 改后 | 判据 |
| --- | --- | --- | --- |
| 真实 major PR 的分类 | **4 个全判成「可自动合并」**（typescript 5→7、@types/node 22→26、setup-node 4→7、checkout 4→7） | **全部判 `major` ⇒ 保持人工审** | 守卫测试用真实标题逐条判定 |
| 分组 PR 的分类 | 无此分支 | `unknown` ⇒ 人工审 | 同上（`host-npm-patch` 分组样本） |
| 单依赖非 major PR | — | `safe`（esbuild 0.24.2→0.28.1 等）⇒ 仍可自动合并 | 同上 |
| 守卫条数 | 无 | **5 条** | `node --test tests/gates/dep-update-classify.test.ts` |
| 守卫自证（违例必红） | — | 注入**旧判定**（只判 `deps-major`）⇒ **守卫判红**，首条报错点名为「标题分类错：build(deps-dev): bump typescript from 5.9.3 to 7.0.2」；**按原字节还原**（字节一致 = true）⇒ 复跑 **5/5 绿** | 注入 → 必红 → 还原 → 必绿 |
| 类型检查 | — | `npx tsc --noEmit` ⇒ **exit 0** | 门 ① 同判据 |
| 配置结构 | 3 个更新目录均无 major 分组 | 3 个目录都有 `deps-major`（仅 major）；且 `deps-major` **不落在 `ignore:` 块内**（首版插入错位，已当场修掉并加结构守卫） | 守卫测试第 4 / 5 条 |
| 误合并的实际后果 | 两个 auto-merge run 已进入「等 CI 全绿」轮询（PR #3 / #6），CI 一绿即会合并 major | **run 已中止**；4 个 PR 全部 `OPEN`、`mergedAt: null`、**零 `@dependabot merge` 评论**；`main` 仍是 `b7ac750` | `gh pr view` + `gh api repos/…/commits/main` |
| B89 自身的 CI | — | run `45664749850` ⇒ **success**（门禁链 job success，headSha `b7ac750`） | GitHub Actions |

## 5. 验收

- **守卫**：`node --test tests/gates/dep-update-classify.test.ts` ⇒ **5/5 绿**；注入旧逻辑 ⇒ **判红**；还原 ⇒ 字节一致 + 5/5 绿。
- **类型**：`npx tsc --noEmit` ⇒ exit 0。
- **门禁**：`node tools/gate.mjs` ⇒ **14 门全绿**（门数不变）。
- **配置**：三个更新目录的 `deps-major` 分组到位，且与 `ignore:` 块无结构错位。
- **止血**：4 个 major PR 仍 OPEN 且未被评论合并；main 未被污染。

## 6. 复盘与经验沉淀

### 6.1 沉淀

- **E150**：**判据依赖数据源的「命名约定」时，必须用真实样本验证那个约定** —— 本工作流假设「Dependabot 对 major 会把分组名写成 `deps-major`」，但**未分组的 major 更新根本不会写那个标记** ⇒ 实测 4 个真实 major PR（typescript 5→7、@types/node 22→26、setup-node 4→7、checkout 4→7）全部绕过判据进入自动合并队列。教训：① 判据若依赖数据源的命名约定，**必须拿真实出现过的样本跑一遍**，不能凭文档或直觉；② 守卫的样本要用**真实标题**，并做「注入旧逻辑 ⇒ 必红」的自证，否则守卫自己就是摆设；③ 更稳的判据是**解析量本身**（版本跨度）而不是解析名字（分组名）—— 名字会变，量不会。
- **E151**：**平台状态读数有缓存层级，用户可见面才是权威** —— 依赖修复推送后，REST `dependabot/alerts?state=open` **仍返回那 4 条 open**（滞后缓存），而网页 Security 页已是 **Open 0 / Closed 4**；push 时 remote 提示的「found 4 vulnerabilities」同样是 push 前的快照。⇒ 凡是「平台侧状态」，必须**双源交叉**并以**用户能在界面上看到的那一面**为准，否则会把「已修好」误判成「没修好」（或反之）。
- 复用既有教训：**E139**（回读校验 ⇒ 全部插入用锚点 + 回读）、**E143**（改完立刻跑 ⇒ 注入旧逻辑当场抓红）、**E94**（同一口径两份实现必然漂移 ⇒ 守卫**直接执行 yml 里那段代码**而不是复刻一份）、**E138**（撤销注入按原字节写回，禁 `git checkout`）。

### 6.2 本批的判断失误（留痕）

| # | 失误 | 修正 |
| --- | --- | --- |
| 1 | 配置插入时用「走到空行为止」当块边界 ⇒ 根目录的 `deps-major` 落进了 `ignore:` 块内（结构错位） | 改用「缩进小于组名即块尾」定位；并补**结构守卫**（`deps-major` 不得落在 `ignore:` 之后） |
| 2 | 守卫的抽取正则要求「换行后紧跟 `'`」，而工作流里结束标记是**换行 + 缩进 + `'`** ⇒ 抽不出代码 | 正则改为 `\r?\n\s*'`；并让失败信息直接说「标记或结构被改了」 |
| 3 | tsc 报 `m[1]` 可能是 `undefined`（本仓开了 `noUncheckedIndexedAccess`） | 显式判 `undefined` 后再返回 |

### 6.3 仍需后续处理

| # | 事项 | 归属 |
| --- | --- | --- |
| **L-B90-1** | 已开着的 4 个 major PR（#3 @types/node 22→26、#4 setup-node 4→7、#5 checkout 4→7、#6 typescript 5→7）**仍是 OPEN** ⇒ 本批修好的是「判定」，这 4 个是修好之前开的 | 需**用户点名授权**后关闭（可逆，reopen 即恢复）；否则它们下次 synchronize 时会走**新**判定 ⇒ 判 major ⇒ 自动跳过（不再误合并） |
| **L-B90-2** | 本批的修复要**推送后**才对存量 PR 生效（工作流定义取自 base 分支） | 推送后复核：#3 / #6 的 auto-merge run 应在判定阶段直接退出（分类 major） |
| **L-B90-3** | Dependabot 每周的 security job 是否停止失败 | 依赖已在 B89 修好；weekly 周期才见分晓 |

## 7. 提交

- 提交：见本批提交 `fix(ci): 修掉自动合并把 major 当 patch/minor 的判定缺陷`
- 显式 pathspec 清单：`.github/dependabot.yml`、`.github/workflows/dependabot-auto-merge.yml`、`tests/gates/dep-update-classify.test.ts`、`docs/批次/B90-自动合并major判定修复-执行记录.md`、`docs/沉淀/批次导航.md`、`docs/沉淀/经验教训索引.md`、`docs/沉淀/README.md`、`CHANGELOG.md`、`docs/releases/v0.1.0.md`
- 明确排除的他人改动：无（开工时工作树干净，`HEAD == origin/main == b7ac750`）
