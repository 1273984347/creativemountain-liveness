# ROADMAP · 路线图

> **口径**：本文件只写**可从仓内事实派生**的内容（已发布 / 在途 / 未决遗留）。
> 方向性计划属**项目 owner 的决策**，不写进来以免变成第二事实源 —— 需要时由 owner 在本文件追加小节。

## 已发布

| 版本 | 日期 | 内容 | 依据 |
| --- | --- | --- | --- |
| **v0.1.0** | 2026-11-25 | 首个公开版本：规则引擎 + 四套主题 + 离线单文件 HTML（数字轨）+ 可打印 PDF/SVG（实体轨）+ 十四道门禁；GPL-3.0 | [Release](https://github.com/1273984347/creativemountain-liveness/releases/tag/v0.1.0) ｜ `docs/releases/v0.1.0.md` |

## 在途

| 批次 | 主题 | 状态 |
| --- | --- | --- |
| **B91** | 开源文档入口补齐：`AGENTS.md` / `CLAUDE.md` / `ROADMAP.md` | 本批施工中 |
| B90 | 自动合并的 major 误判修复（判据 + 守卫 + 配置分组） | 已推送 |
| B89 | 依赖安全告警清收（esbuild + host 三条 overrides） | 已推送（4 条告警全部转 closed） |

## 未决遗留（逐条登记在批次记录里）

| 事项 | 归属 |
| --- | --- |
| host 三条 overrides 是「未经上游测试的组合」⇒ 随 `sparkdesign` 上游跟进 | 待上游 |
| katex 0.18 的嵌套 commander 要求 node >= 22.12 ⇒ 若下调 `engines` 下限需复查 | 待触发 |
| Dependabot 的 security job 是否在 weekly 周期彻底停止失败 | 待观察 |
| PR #9（playwright 1.60→1.65）自动合并后 14 门是否仍绿 | 待观察 |

## 已知约束（影响发版与自动化）

- 宿主原型 `creativemountain-host/` 的依赖**不入库** ⇒ 不在根仓门禁执行路径内，只能跑自己的走查脚本。
- 数字轨与实体轨**必须同时产出**且由门禁保证不漂移 ⇒ 任何改引擎 / 数值 / 主题的改动都要走全量门禁。
- 安全告警的**可修性分三类**（直接依赖可自升 / 上游已修可自动 / 上游未修只能本仓 overrides）
  ⇒ 上游未修的那类会长期挂在告警列表里，直到上游修好或本仓显式 overrides。
- 自动合并只对 **patch / minor** 生效；**major 一律人工审**（判据与守卫见
  `.github/workflows/dependabot-auto-merge.yml` 与 `tests/gates/dep-update-classify.test.ts`）。
