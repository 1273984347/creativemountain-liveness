# 沉淀区（可沉淀、可复用内容）

本目录收纳**可沉淀、可复用**的内容：门禁纪律、负样本范式、构建自举、经验教训索引。
**生效代码不搬到这里** —— 搬动会破坏门禁路径与文档交叉引用；本目录只做**索引与范式说明**。

## 分类规则

| 类别 | 位置 | 说明 |
| --- | --- | --- |
| 门禁清单与纪律 | 本目录 `门禁清单.md` | 十三道门的职责、依赖顺序、负样本锚点、失败排查 |
| 负样本自证范式 | 本目录 `负样本自证范式.md` | 「违例必红、恢复必绿」的常驻自动化范式 |
| 从源码派生 | 本目录 `从源码派生避免第二事实源.md` | 字段清单/校验器不得手抄 |
| 经验教训索引 | 本目录 `经验教训索引.md` | B10–B67 实证坑 → 跨项目通用结论 |
| 可直接复制的骨架 | 本目录 `templates/` | 新门禁 / 新负样本 / 新批次记录的模板 |
| **生效代码** | 仓库原位（`tools/`、`tests/`、`engine/`、`build/`） | **不搬** —— 路径被门禁与文档引用 |

## 目录索引

- [门禁清单.md](门禁清单.md) —— 十三道门禁的职责、依赖顺序、负样本锚点、失败排查
- [负样本自证范式.md](负样本自证范式.md) —— 「违例必红、恢复必绿」的常驻自动化范式
- [从源码派生避免第二事实源.md](从源码派生避免第二事实源.md) —— 手抄清单的替代做法与已知反例
- [经验教训索引.md](经验教训索引.md) —— B10–B67 实证坑与通用化结论
- [clean-room-gate-check.mjs](clean-room-gate-check.mjs) —— 干净副本门禁自检脚本（可直接跑：`node docs/沉淀/clean-room-gate-check.mjs`）
- [balance-extract.mjs](balance-extract.mjs) —— 从平衡报告抽**位次胜率极差**（§9.2 口径；默认报告模式，`--strict` 才判红）
- [verify-trial-reserve-critical.mjs](verify-trial-reserve-critical.mjs) —— 用已发布的扫描数据**离线复核**判定（Welch t + 精确 t 临界值；无需重跑模拟）
- [compare-scan-baseline.mjs](compare-scan-baseline.mjs) —— **逐组**比对「按需重扫」产物与基线快照 ⇒ 验证可复现性（任一组不一致即红）
- `theme-*.mjs` —— 主题包改造工具（文本级替换，禁 JSON 往返）：
  - [theme-trial-challenges.mjs](theme-trial-challenges.mjs) —— 试炼批量改造为**挑战型** + 四池互不重复（B22）
  - [theme-board-expand.mjs](theme-board-expand.mjs) —— 棋盘扩展 + 关隘编排（B21）
  - [theme-neutral-rename.mjs](theme-neutral-rename.mjs) —— 中性格名批量改名（B21）
  - [theme-trial-swap.mjs](theme-trial-swap.mjs) —— 试炼牌替换（B19-b）
- `templates/` —— 可直接复制的骨架：
  - [负样本测试模板.md](templates/负样本测试模板.md) —— 常驻负样本测试（隔离副本 + 正负样本）
  - [门禁条目模板.md](templates/门禁条目模板.md) —— 新增一道门禁的 checklist
  - [批次执行记录模板.md](templates/批次执行记录模板.md) —— 批次执行记录骨架
  - [沉淀条目模板.md](templates/沉淀条目模板.md) —— 沉淀条目骨架

## 与其它载体的分工

- `docs/批次/` —— **过程**：某一批次的执行记录、验收数据、裁定
- 本目录 —— **方法与范式**：跨批次可复用的纪律与模板
- `AGENTS.md` / `HANDOVER` —— 规则正文与交接指针

> 纪律：**改机制就更新本目录对应条目**；本目录与代码不一致时，以代码 + `docs/批次/` 的实证为准，并回填本目录。
