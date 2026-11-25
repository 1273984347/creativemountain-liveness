# B86 浏览器走查与可观测断言 · 实施计划

> **批号 B86**（B85 已被 git 历史占用；`docs/` 内无 B86+ 命中 → 本号可用）。
> **本批不做**：不改引擎规则、不改平衡阈值、不改 UI 视觉设计、不 push、不开 PR。

**Goal:** 为数字轨 `web/` 与 React host `creativemountain-host/` 补**浏览器走查 + 可观测断言**，并把数字轨走查纳入门禁（第 ⑭ 道）。

**Architecture:**
- 数字轨走查入口 `tests/e2e/ui-walkthrough.mjs`：以 `file://` 打开 `dist/创界山-活人认证.html`（产品承诺是「双击即玩」⇒ 不得改成 http 预览），对**四套主题矩阵 + 人数档 + 两个视口**跑一组**可观测断言**（DOM 契约 / 几何 / 响应式 / console 错误 / 交互后状态变化 / 非法输入的可见错误信号）。
- 断言的期望值一律**从 `themes/*/theme.json` 派生**（主题名、`terms.path`），不手抄（E98：计划里的具体值一律现查现用）。
- React host 走查 `creativemountain-host/scripts/walkthrough.mjs`：**在 host 子项目内自跑**（host 依赖不入库 ⇒ 根仓门禁在干净副本里跑不起 vite），根仓用**静态契约守卫**（`tests/gates/host-walkthrough-contract.test.ts`）防脚本被删/腐化；「host 真浏览器走查不在根仓门禁执行路径内」作为**覆盖边界**如实登记。
- 门禁第 ⑭ 道 = 数字轨走查；位置在 esbuild（门 ④）之后（依赖 `dist/`）。

**Tech Stack:** TypeScript strict / Node 22 / `node:test` / Playwright（根仓 devDep，浏览器二进制已装）/ esbuild 单文件 HTML / Vite 8 + React 19（host）。

**Spec:** `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` §9.3（门禁覆盖边界）/ §9.5（验收清单）/ §13（变更记录）；`docs/沉淀/门禁清单.md`（新增门禁 checklist 五项登记）。

## Global Constraints

- **门禁纪律 A4**：门禁脚本不得 `shell: true`、不得接管道；退出码直取。
- **门禁纪律 A5**：新增覆盖边界必须**同序**登记在 `tools/coverage-boundaries.mjs` 与规格 §9.3 表（doc-sync C8 逐条对应）。
- **负样本隔离**：一律在 `tmpdir` 隔离副本里改副本（改共享工作树会让并行门 ② 假红）；副本自建 bundle（`CM_BUILD_ROOT`）+ `CM_E2E_BUNDLE` 指向副本产物 + `CM_REPO_ROOT` 指回真实仓取 playwright。
- **行尾纪律（E138）**：撤销临时注入**按原字节写回**，禁 `git checkout`（会改工作树行尾）；注释里避免 `*/` 连续（E91）。
- **提交纪律**：显式 pathspec，禁 `git add -A`；**本批只做本地提交，不 push / 不开 PR**（外部可见动作须逐次点名授权）。
- **不新增生产依赖**：走查只用根仓既有 playwright。
- **单一事实源**：主题期望值从 `theme.json` 派生；门数表述四处同步（README / 门禁清单 / 沉淀 README / 图示 03 生成器）。

## Tasks

### Task 1 · 数字轨走查脚本 `tests/e2e/ui-walkthrough.mjs`

- **Files:** 新建 `tests/e2e/ui-walkthrough.mjs`
- **验收口径（逐条可机器判定）:**
  1. `<title>` == `创界山·活人认证`；
  2. 四套主题各跑一局：`.players .player` 数 == 人数档；`.board .tile` 数 ∈ [24,36]（规格 §8 boardLength）且 `.tile-idx` 连续；`.hand .card` 数 > 0；
  3. `.panel-title` 集合含该主题 `terms.path`（山道/轨道/索桥/街区）；
  4. 正文无 `{leaf}` 占位符残留（正则 `/\{[a-z_]+\}/i`）；
  5. **无 console error / pageerror**（监听必须在 goto 之前注册）；
  6. 几何：`documentElement.scrollWidth <= clientWidth + 1`；每个 `.tile` 盒子宽高 > 0；每张 `.card` 右边界不越界；
  7. 每个 `.panel-body` 文本非空（无空白面板）；
  8. 错误路径：seed 填非法值 ⇒ `input[aria-label="Seed"]` 出现 `aria-invalid="true"` 且 `title` 含 `4294967295`；填回合法值 ⇒ 该属性消失；
  9. 响应式：390×844 视口下无横向溢出、首个 tile 完整在视口内；
  10. 交互路径：点「新开一局」⇒ `.status` 含当前座/回合；把操作者切到当前手番座 ⇒ 点「行棋」⇒ `.log-line` 数量增加。
- **输出:** stdout JSON 摘要 + 失败明细；任一失败 ⇒ exit 1。

### Task 2 · 门禁第 ⑭ 道接入 + 门数表述同步

- **Files:** `tools/gate.mjs`（GATES 追加，注释写明前置依赖）、`README.md`、`docs/沉淀/门禁清单.md`、`docs/沉淀/README.md`
- **验收口径:** `node tools/gate.mjs` 打印「PASS：14 门全绿」；**全仓**所有「十三道」表述改为「十四道」（含 `tools/release-check.mjs`，不只文档）；README 门禁表新增第 ⑭ 行。

### Task 3 · 负样本与静态守卫

- **Files:** `tests/gates/ui-walkthrough-negative.test.ts`、`tests/gates/host-walkthrough-contract.test.ts`
- **验收口径:** 负样本 A（副本里让占位符不展开 ⇒ 走查必红且信息点名「占位符」）、负样本 B（副本里让棋盘超宽 ⇒ 必红且点名「横向溢出」）、负样本 C（副本里改坏走查断言 ⇒ 必红）；正样本（未破坏 ⇒ 绿）；跑完 `git status` 前后一致。

### Task 4 · host 走查脚本（子代理并行，本会话只验收）

- **Files:** `creativemountain-host/scripts/walkthrough.mjs`（+ `creativemountain-host/package.json` 新增 script）
- **验收口径:** 脚本在本机跑绿且输出 JSON 摘要；自起自收 vite（finally 必杀进程）；违例必红、恢复必绿；静态守卫锚点齐全。

### Task 5 · 规格与覆盖边界登记

- **Files:** 规格 §9.3 表 + §9.5 + §13；`tools/coverage-boundaries.mjs`
- **验收口径:** 新增边界 1 条（host 真浏览器走查不在根仓门禁执行路径内），两处**同序**；`node tools/doc-sync.mjs` 全 PASS（C8 逐条对应不红）。

### Task 6 · 图示 03 门禁全景级联

- **Files:** `docs/图示/build/figures/03-gate-panorama.mjs`（生成器）→ 重跑 `node docs/图示/build/diagram-build.mjs --only gate-panorama` → 两档 HTML 入库
- **验收口径:** 产物含「十四道」与门 ⑭；`node docs/图示/build/verify.mjs` 全 PASS（预算/正交/留缝/两档一致）。

### Task 7 · 收官（执行记录 + 导航复算 + 沉淀 + 提交）

- **Files:** `docs/批次/B86-浏览器走查与可观测断言-执行记录.md`、`docs/沉淀/批次导航.md`、`docs/沉淀/经验教训索引.md`（如有新坑）
- **验收口径:** 先加行 → 跑 `node tools/presets/batch-nav-count.mjs` → 按它报的行数改声明（互洽即绿）；本地提交带显式 pathspec。
