# CLAUDE.md

> 本仓的**规则正文在 [AGENTS.md](AGENTS.md)**（唯一入口）。本文件**不复制**规则正文 ——
> 同一口径写两遍必然漂移，仓内历史上已因此红过多次。

## 速查

| 我要做 | 去哪 |
| --- | --- |
| 跑全量门禁 | `npm run gate`（十六道）｜细则 `docs/沉淀/门禁清单.md` |
| 改代码前先读 | `docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md`（规格真值） |
| 看现在在办什么 | `TODOS.md`（在办清单，每项带验收口径） |
| 看上次做到哪 | `HANDOVER.md`（已完成项的核实确认与读数） |
| 查踩过的坑 | `docs/沉淀/经验教训索引.md`（E1–E165，五类） |
| 查每批的过程 | `docs/批次/` ｜索引 `docs/沉淀/批次导航.md` |
| 提交 / push | 显式 pathspec；push、合并、开 PR、关 PR 需**用户当轮点名授权** |

## 环境

Node >= 22.18（CI 用 Node 24）。宿主原型 `creativemountain-host/` 的依赖不入库，
不在根仓门禁执行路径内，要单独跑它的走查脚本。
