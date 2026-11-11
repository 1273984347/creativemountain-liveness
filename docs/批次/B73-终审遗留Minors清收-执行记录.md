# B73 · 终审遗留 Minors 打磨（非阻塞项清收）

## 1. 范围

B70 全分支终审列出的非阻塞 Minors 中，价值高的几条已在 B70 合并前修复波处理；本批清收剩余**代码级**项，
纯风格/目录类项按评审原分类保留。

## 2. 逐项落点

| # | 原发现 | 处置 | 落点 |
|---|---|---|---|
| 1 | `key-normalize.mjs` 的 `String(key)` 会把 `undefined` 洗成 `'undefined'`（与仓内纪律相左） | **修**：非字符串抛 `TypeError`；探针两处调用改传原始值；补边界与非字符串用例 | `tools/laya-probe/key-normalize.mjs`、`tools/laya-probe/run.mjs:204`、`tests/engine/key-normalize.test.ts` |
| 2 | `setRecorder` 归零 `recordSeq` 但不重置 `recordCtx` | **修**：一并归零 + 注释说明 | `tests/sim/policy.mjs` |
| 3 | 抽模块时丢失 `recordSeq`/`recordCtx` 的注释口径（「跨主题/档位」「playOne 设置」） | **补回**两行注释 | `tests/sim/policy.mjs` |
| 4 | `policy.d.mts` 的 `AdvanceOpts` 标题写「透传选项」，与「`onDuelPick` 被实现占用」字段注不一致 | **修**：标题改为「转发给 `advanceAuto` 的选项（`onDuelPick` 除外）」 | `tests/sim/policy.d.mts` |
| 5 | `key-normalize.d.mts` 的「三条口径」交叉引用已过期 | **修**：改为六条并补非字符串契约 | `tools/laya-probe/key-normalize.d.mts` |
| 6 | `policy.mjs` 因整条删 import 留下多余空行 | **修** | `tests/sim/policy.mjs` |
| 7 | `policy-extraction.test.ts` 的定义正则挡不住箭头函数回流；死函数用 `src.includes` 判定过脆（注释提一次名字就红） | **修**：正则加 `const/let/var name =` 形态；死函数改为「剥注释后按标识符边界」判定 | `tests/engine/policy-extraction.test.ts` |
| 8 | `sim-record.test.ts` 的 12 局与「对峙桶非空」前提绑定，局数散落在参数里 | **修**：抽 `DUEL_BUCKET_GAMES` 常量 + 前提注记（失败信息带实际局数） | `tests/gates/sim-record.test.ts` |
| 9 | `recorder`/`recordSeq`/`recordCtx` 是模块级可变量，并发调用 `playOne` 会串号（B70 复审登记） | **修**：`policy.mjs` 头部加「禁止并发」警告 | `tests/sim/policy.mjs` |

## 3. 明确**不做**（保留原分类）

- `export /** … */ function` 的导出顺序（提取脚本机械产物，纯风格）。
- `SimGameResult` 的索引签名放行其余读数（有意的契约松动，消费者是 `.mjs`）。
- 测试目录从 `tests/engine/` 迁到 `tests/gates/`（简报指定路径，且只 import 纯函数）。
- `game-arms.mjs` 的 30 分钟预算检查只在每面结束后执行（本次每面 < 1 分钟，属预留安全阀）。
- 一次性报告的 grep 行数误差（不参与任何判定）。

## 4. 验收

| 项 | 结果 |
|---|---|
| 聚焦测试 | `policy-extraction` + `key-normalize` + `sim-record` = 17/17 pass |
| 类型 | `npm run typecheck` 0 错 |
| 13 门 | `node tools/gate.mjs` → `== PASS：13 门全绿 ==` |
| 基线 | 本批不动 sim 决策路径（`normalizeLegacyKey` 仅在探针读侧；`setRecorder` 行为不变）⇒ `docs/balance-report.md` 未变 |
| 端口/发布包 | 未起服务；`dist/` 零增量 |

## 5. 提交

| 提交 | 标题 |
|---|---|
| 见 `git log`（本批为单笔） | chore(B73): 清收终审遗留 Minors（key 归一化严格化 / 记录器上下文 / 测试守卫加固） |
