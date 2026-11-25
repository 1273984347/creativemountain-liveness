# HANDOVER · 交接记录

> **纪律**：每完成一项 ⇒ 在此追加**核实确认**（做了什么 · 读数 · 证据位置），并从 [TODOS.md](TODOS.md) 删除该项。
> 记录**只追加、不改写历史行**（与 `docs/沉淀/经验教训索引.md` 同一纪律）。

## 交接状态

| 项 | 值 |
| --- | --- |
| `main` | `b7ac750`（B89 已推送；B90 修复待推） |
| 门禁 | **14 道**，全绿 |
| 批次档案 | **83** 份（`docs/批次/`） |
| 沉淀条目 | **E1–E151**（五类；E 行数 ≡ 分类声明之和） |
| 导航互洽 | 总览 / 小节标题 / 实际行数 / 目录文件数 = **83/83/83/83** |
| 未修复告警 | **0**（Security 页 Open 0 / Closed 4） |

## 已完成（核实确认）

### B90 · 自动合并的 major 误判修复

- **做了什么**：修掉 `dependabot-auto-merge.yml` 把 major 当 patch/minor 合并的判定缺陷。判定改为**解析标题里的 `from A to B` 版本跨度**（主版本号不同即 major ⇒ 人工审），`deps-major` 标记仍命中，**分组 PR（解析不出 from/to）一律保守人工审**；配置侧给三个更新目录补 `deps-major` 分组；新增常驻守卫 `tests/gates/dep-update-classify.test.ts`（**直接执行 yml 里那段分类代码**，不另写复刻）。
- **核实读数**：守卫 **5/5 绿**；注入旧判定 ⇒ **当场判红**（点名「标题分类错：build(deps-dev): bump typescript from 5.9.3 to 7.0.2」）；按**原字节**还原（字节一致 = true）⇒ 复跑 5/5 绿；`npx tsc --noEmit` **exit 0**；导航复算 **83/83/83/83**；`doc-sync` **10/10**。
- **止血读数**：两个 auto-merge run 终态 **cancelled**；4 个 major PR 全部 `OPEN`、`mergedAt: null`、**零 `@dependabot merge` 评论**；`main` 仍是 `b7ac750`（**未被污染**）。
- **证据位置**：`docs/批次/B90-自动合并major判定修复-执行记录.md`

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
