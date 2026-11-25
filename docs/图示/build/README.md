# 图集构建契约（子代理照此写图）

本目录的每个 `figures/NN-<slug>.mjs` 是**一张图**的定义模块。
构建器 `diagram-build.mjs` 会把它渲染成两份自包含 HTML：

| 档位 | 文件名 | viewBox | 字号梯级 |
| --- | --- | --- | --- |
| 文档档 | `NN-图名-文档档.html` | 960×600 | 节点 12 / 子标 9 / 箭头标签 8 |
| 投屏档 | `NN-图名-投屏档.html` | 1280×720 | 节点 16 / 子标 12 / 箭头标签 12 |

## 模块契约

```js
export default {
  slug: 'token-pipeline',     // 英文短标识，用于 --only 过滤与 HTML 的 id 前缀
  index: '05',                // 序号，字符串
  name: '句子层占位符管线',     // 中文短名，进文件名
  total: 8,                   // 图集总数
  typeLabel: '数据流图',       // 图型名（页脚显示）
  eyebrow: '机制 · 句子层主题词', // 页眉小标签
  title: '句子层占位符管线',    // 页眉 H1
  subtitle: '一句话读懂这张图',  // 页眉副标题
  desc: '无障碍描述：这张图在讲什么（不是形状描述）',
  legend: [{ kind: 'step', label: '图例项' }],
  render(ctx) { /* 返回 SVG 片段字符串 */ },
};
```

## 母版坐标约定

**只写母版坐标**（= 文档档的 960×600 空间）。投屏档由工具按 4/3 数值换算，
换算后所有坐标重新对齐到 4px 栅格，字号走投屏梯级 —— **不要写两套坐标**。

- 内容区：`x 40..920`、`y 40..480`；图例由工具画在底部条带，别自己画。
- 所有 x / y / w / h 必须是 **4 的倍数**（SKILL §7 栅格）。
- 想让「水平直线」在两档都严格水平：出口盒高取 **48**（12 的倍数），
  此时 `Y(顶) + L(高)/2 === Y(中心)` 在两档都成立。

## 工具库（`../svg-kit.mjs`）

| 导出 | 用途 |
| --- | --- |
| `nodeBox(ctx, {x,y,w,h,label,sub,tag,kind})` | 节点盒（掩码+盒体+类型标签+名称+可折行子标） |
| `zone(ctx, {x,y,w,h,label})` | 区域容器（分区用） |
| `connector(ctx, {from,to,route,kind,label,dash,via,labelSide,labelShift})` | 正交圆角连线（r=8）+ 可选箭头标签 |
| `message(ctx, {x1,x2,y,label,selfLoop})` | 时序图水平消息箭头 |
| `lifeline(ctx, {x,top,bottom,actor,sub,w})` | 时序图生命线 + 顶部执行者盒 |
| `activation(ctx, {x,top,height,w})` | 时序图激活条 |
| `lane(ctx, {x,y,w,h,label,index})` | 泳道 |
| `legend(ctx, items)` | 底部图例条带 |
| `callout(ctx, {x,y,text,maxWidth})` | 编辑批注（衬线斜体，全图 ≤2 处） |
| `textWidth(str,size,mono)` / `wrapText(str,maxWidth,size,mono)` | CJK 宽度度量与折行 |
| `ctx.X/Y/L(v)` | 母版坐标 → 当前档位坐标（已按 4px 对齐） |
| `ctx.F(role)` | 当前档位的字号（'node'/'sub'/'arrow'/'eyebrow'） |
| `T` `KIND_STYLE` `SERIES` `FONT` `PRESETS` | 语义色 / 节点类型样式 / 系列色 / 字体栈 / 档位参数 |

节点类型 `kind`：`focal`（焦点，橘红，全图 ≤2）/ `step`（白底墨框）/ `store` /
`external` / `input` / `optional`（虚线）/ `security`（橘红虚线）/ `zone`。

需要工具库没有的形状（雷达多边形、层叠条、甘特条）时，
**用 `ctx.X/Y/L` 自己算坐标并直接吐 SVG 字符串**，但仍须遵守下面的硬约束。

### connector() 的三个位置参数（标签与走线都要落在空画布上）

| 参数 | 作用 | 用法 |
| --- | --- | --- |
| `labelAt` | 标签锚点，**与 from/to 同一坐标系（母版坐标）**，内部只换算一次 | 标签要落在某条具体水平段上时给 |
| `labelSide` | 标签放在线的哪一侧：`above`（横向段默认）/ `below` / `left`（纵向段默认）/ `right` | 线的上方/下方/侧面有节点时换边 |
| `labelShift` | 标签整体微调，母版 px（缺省分量为 0） | 把标签挪进空画布的最后手段 |
| `via` | **走线**的跨层位置（母版坐标）：`via.y` 指定水平段所在的层间高度、`via.x` 指定竖直段所在的横向位置 | 一层里有多条连线时必须错层，否则共用同一水平段（SKILL §6 规则 3） |

> ⚠️ 两个坐标系别混：`from/to/labelAt/via/labelShift` 全是**母版坐标**；
> `ctx.X/Y/L` 才是换算后的档位坐标。对 `labelAt` 再套一次 `ctx.X()` 会二次换算（投屏档偏 1/3）。

## 硬约束（SKILL §6/§7/§9）

1. 节点 ≤9、连线/转移 ≤12、橘红元素 ≤2、图例 ≤5 项、批注 ≤2 处。
2. 连线一律用 `connector()` / `message()`：**禁止斜线**，一律正交圆角（r=8）。
3. 箭头标签：≤14 字、有纸色掩码、掩码底边与笔画留 6–10px 可见缝、不得压在节点上。
4. 同一节点同一条边的多个出点，间距 ≥12px（connector 的 t 参数手动给）。
5. 连线不得从非端点节点背后穿过。
6. 文字颜色：名称墨色、子标 muted、箭头标签 soft；中文必须走工具库给的字体栈。
7. 事实必须来自真实源文件：**不许编造文件名、机制、数字**。

## 本目录的脚本

| 脚本 | 作用 |
| --- | --- |
| `diagram-build.mjs` | 构建器：把 `figures/*.mjs` 渲染成两份自包含 HTML |
| `svg-kit.mjs` | 共用工具库：节点盒 / 正交连线 / 时序图 / 泳道 / 图例 / 批注 / 档位换算 |
| `verify.mjs` | **统一验收**：把 SKILL §9 里能机器判的部分逐份判掉（无障碍契约、正交性、标签留缝与压盒、4px 栅格、预算、两档一致性） |
| `shoot.mjs` | 渲染成 PNG + 越界量测（供人工目视） |
| `depstat.mjs` | 统计 `engine/` 内部的真实 import 关系 —— **06 引擎依赖图的数字出处**（可复算） |
| `inspect-labels.mjs` | 标签几何诊断：打印每条箭头标签的掩码框、文字框、最近笔画点与被压住的节点 |

## 自查（必须自己跑、自己看）

```bash
node docs/图示/build/diagram-build.mjs --only <slug>   # 只重建自己的两张
node docs/图示/build/shoot.mjs --only <文件名片段>        # 截图 + 越界量测
```

截图落在 `docs/图示/assets/`。**必须用 read 工具打开 PNG 自己看**，
修掉：文字出盒、连线压盒、标签压线、留白失衡、字号不齐。
探针显示「溢出 0 处」不等于图能看 —— 空格、错位、视觉重心都要自己判断。
