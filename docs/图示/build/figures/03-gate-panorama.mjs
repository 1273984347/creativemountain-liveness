// 03 门禁全景 —— 层级依赖图（十五道门禁）。
//
// 讲的是本项目的一键门卫纪律：**上游红，下游不必再跑**。
// 十五道门按 tools/gate.mjs 的 GATES 数组顺序串行执行，任一失败即 exit 1；
// 只有写了前置的门才依赖上游：门 6/门 7 需 print/<theme>/ 产物（自举生成），
// 门 10 与门 14 需门 4 已构建的 dist/。
//
// 事实来源：
//   tools/gate.mjs —— GATES 数组（13 道门的真实名称与顺序）、ensurePrintArtifacts、
//                     门禁自断言（门数声明 == 实跑门数）；
//   README.md「门禁（node tools/gate.mjs）」表 —— ①～⑭ 的门名；
//   docs/沉淀/门禁清单.md —— 职责 / 依赖顺序 / 负样本锚点 / 失败排查。
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有值必须是 4 的倍数。
// ⚠️ 硬约束：节点 6 ≤9、连线 6 ≤12、橘红 1 ≤2、图例 3 ≤5、批注 1 ≤2。

import { nodeBox, connector, callout } from '../svg-kit.mjs';

// ── 母版几何 ────────────────────────────────────────────────
// 左列四层门禁带（宽 432 ⇒ 子标内宽 408）；右列两处前置产物（宽 300）；
// 中间 x 472..620 是走线通道：三条「层 → 前置产物」折线的竖直段都落在 x=546，
// 三段区间互不重叠（70..170 / 180..292 / 340..404）。
const BAND_X = 40;
const BAND_W = 432;
const LANE_TOP = 40;
const LANE_H = 80;
const LANE_GAP = 28;

const ART_X = 620;
const ART_W = 300;

const laneTop = (i) => LANE_TOP + i * (LANE_H + LANE_GAP); // 40 / 148 / 256 / 364

export default {
  slug: 'gate-panorama',
  index: '03',
  name: '门禁全景',
  total: 8,
  typeLabel: '层级依赖图',
  eyebrow: '机制 · 十五道门禁',
  title: '十五道门禁全景',
  subtitle:
    '上游红，下游不必再跑：十五道门按 GATES 数组顺序执行，只有标注前置的门（门 6/门 7 需 print/ 产物、门 10 与门 14 需门 4 的 dist/）才依赖上游。',
  desc:
    '层级依赖图：四层门禁自上而下按 GATES 数组顺序执行 —— 基础层（门 1–4）、契约层（门 5–6）、一致性层（门 7–8）、终验层（门 9–15）；右侧两处前置产物分别是门 6、门 7 与门 10、门 14 的依赖项。',
  legend: [
    { kind: 'focal', label: '最上游层（红在此 ⇒ 下游不必跑）' },
    { kind: 'step', label: '门禁层' },
    { kind: 'store', label: '前置产物（print/ · dist/）' },
  ],
  render(ctx) {
    const parts = [];

    // ── 左列：四层门禁 ────────────────────────────────────────
    // 终验层的门名子标在 408 内宽下正好断在「门 12 / 门 13」之间（两档同断点），
    // 不会出现「门 13」被甩在上一行、门名孤零零落到下一行的情形。
    const lanes = [
      {
        kind: 'focal',
        tag: 'L1',
        label: '基础层：类型 · 测试 · 文档 · 构建',
        sub: '门 1 类型 · 门 2 测试 · 门 3 文档口径 · 门 4 构建',
      },
      {
        kind: 'step',
        tag: 'L2',
        label: '契约层：主题包校验 · IR 契约',
        sub: '门 5 主题包校验 · 门 6 IR 契约',
      },
      {
        kind: 'step',
        tag: 'L3',
        label: '一致性层：双轨一致性 · 主题差异化',
        sub: '门 7 双轨一致性 · 门 8 主题差异化',
      },
      {
        kind: 'step',
        tag: 'L4',
        label: '终验层：规模 · 端到端 · 通过率 · 极差 · 余量 · 界面走查 · 报告入库锁',
        sub:
          '门 9 规模与平衡 · 门 10 对峙端到端 · 门 11 试炼通过率平衡 · 门 12 位次胜率回归锁 · 门 13 余量判定离线回归 · 门 14 浏览器走查与可观测断言 · 门 15 平衡报告入库一致性',
      },
    ];
    lanes.forEach((ln, i) => {
      parts.push(
        nodeBox(ctx, {
          x: BAND_X, y: laneTop(i), w: BAND_W, h: LANE_H,
          kind: ln.kind, tag: ln.tag, label: ln.label, sub: ln.sub,
        }),
      );
    });

    // ── 右列：两处前置产物 ────────────────────────────────────
    parts.push(
      nodeBox(ctx, {
        x: ART_X, y: 40, w: ART_W, h: 160, kind: 'store',
        label: 'print/ 产物',
        sub:
          'print/<theme>/ir.json · 规则书.html · *.pdf ⇒ 被门 6/门 7 依赖 · 缺失才生成（ensurePrintArtifacts → build/build-print-all.mjs）',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: ART_X, y: 300, w: ART_W, h: 160, kind: 'store',
        label: 'dist/ 产物',
        sub:
          '门 4 的 esbuild 单文件 HTML（dist/）⇒ 被门 10 与门 14 依赖（对峙端到端与界面走查都需先 npm run build）',
      }),
    );

    // ── 连线（先画箭头，后画节点）──────────────────────────────
    // 层间执行顺序：L1 → L2 → L3 → L4，竖直段落在层间空隙（28px）。
    for (let i = 0; i < 3; i += 1) {
      parts.push(
        connector(ctx, {
          from: { x: 100, y: laneTop(i) + LANE_H },
          to: { x: 100, y: laneTop(i + 1) },
          route: 'hvh',
        }),
      );
    }

    // 层 → 它所依赖的前置产物（箭头方向＝「谁依赖谁」）。
    // 末段水平线自左向右 ⇒ 标签可落在段中段的空白画布上（不压任何盒边）；
    // labelAt 取母版坐标 x=583（= 末段中点），两档由工具换算。
    const needs = [
      { from: { x: BAND_X + BAND_W, y: 170 }, to: { x: ART_X, y: 70 }, label: '门 6' },
      { from: { x: BAND_X + BAND_W, y: 292 }, to: { x: ART_X, y: 180 }, label: '门 7' },
      { from: { x: BAND_X + BAND_W, y: 404 }, to: { x: ART_X, y: 340 }, label: '门 10' },
    ];
    for (const n of needs) {
      parts.push(
        connector(ctx, {
          from: n.from,
          to: n.to,
          route: 'hvh',
          label: n.label,
          labelAt: { x: 583, y: n.to.y },
        }),
      );
    }

    // ── 编辑批注：执行纪律 ────────────────────────────────────
    parts.push(
      callout(ctx, {
        x: 40,
        y: 470,
        maxWidth: 620,
        text: '上游红，下游不必再跑：按 GATES 数组顺序执行，只有标注前置的门依赖上游。',
      }),
    );

    return parts.join('\n');
  },
};
