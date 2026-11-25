// 04 双轨构建管线 —— 数据流图。
//
// 讲的是本项目的「实体 + 数字双轨」：**一套主题包分出两条轨**，
// 数字轨产出单文件离线 HTML，实体轨产出规则书 PDF 与实体件 PDF；
// 两条轨由门禁⑦（IR↔SVG 精确比对）锁在一起，任何一侧漂移即判红。
//
// 事实来源：
//   · themes/<主题>/theme.json            —— 四套主题包数据（web/theme.ts 静态 import 进数字轨）
//   · build/build-themes.mjs               —— 三套非基准主题由基准派生（themes/<id>/theme.json）
//   · build/build-ir.mjs                   —— theme.json → print/<主题>/ir.json（只搬运、不现编）
//   · build/build-print-all.mjs            —— 按主题批量：build-ir.mjs → build/.build-print.mjs
//   · build/build-print.ts                 —— ir.json → svg/*.svg + 规则书.html + 实体件.html
//                                            → headless Edge 的 page.pdf() → 规则书.pdf + 实体件.pdf
//   · esbuild.config.mjs                   —— web/main.ts → dist/创界山-活人认证.html（单文件离线）
//   · build/build-package.mjs              —— dist/发布包/（数字轨/ + 实体件/<主题>/ + README.md）
//   · tools/gate.mjs 第 7 位 + tools/parity-check.mjs —— 门禁⑦ 双轨一致性：四级比对
//   · README.md「快速开始」「构建」两节 —— 产物清单与 npm run 脚本语义
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有值必须是 4 的倍数。
// ⚠️ 分叉点是**主题包本身**：数字轨由 web/theme.ts 静态 import 主题包直接打包，不经过 IR；
//    IR 只服务实体轨与门禁⑦的比对 —— 故 IR 不画在分叉之后（这是事实，不是省略）。
// ⚠️ 标签定位：connector 把标签压在**最长水平段**上方（纵向边则贴线左侧），
//    故每条带标签的边都留出一段够长的水平段，掩码才落得到空处。

import { nodeBox, connector, callout } from '../svg-kit.mjs';

const C1_X = 40; const C1_W = 160;
const C2_X = 236; const C2_W = 180;
const C3_X = 460; const C3_W = 200;
const C4_X = 700; const C4_W = 220;

export default {
  slug: 'dual-track-pipeline',
  index: '04',
  name: '双轨构建管线',
  total: 8,
  typeLabel: '数据流图',
  eyebrow: '构建 · 实体与数字双轨',
  title: '双轨构建管线',
  subtitle:
    '一套主题包分出两条轨：数字轨是单文件离线 HTML，实体轨是规则书与实体件 PDF；门禁⑦把 IR 与 SVG 逐字比对，锁住两轨不许各说各话。',
  desc:
    '数据流图：四套主题包 theme.json 向右分出两条轨 —— 上轨经 web/theme.ts 静态 import 与 esbuild 打包为单文件 HTML，下轨经 build-ir.mjs 生成 IR、再由 build-print.ts 产出 SVG 实体件与打印页并转 PDF；两轨汇入 dist/发布包/。IR 与实体件 SVG 一路汇入门禁⑦的 parity-check 节点做精确比对。',
  legend: [
    { kind: 'input', label: '主题包' },
    { kind: 'store', label: 'IR 中间数据' },
    { kind: 'step', label: '构建产物' },
    { kind: 'security', label: '双轨一致性门' },
  ],
  render(ctx) {
    const parts = [];

    // ── 连线（先画箭头，后画节点）──────────────────────────────
    // ① 主题包 → IR：build/build-ir.mjs
    parts.push(
      connector(ctx, {
        from: { x: C1_X + C1_W, y: 212 },
        to: { x: C2_X, y: 212 },
        route: 'hvh',
      }),
    );

    // ② 主题包 → 数字轨：web/theme.ts 静态 import（不经 IR）；长水平段让标签落得下
    parts.push(
      connector(ctx, {
        from: { x: 120, y: 176 },
        to: { x: 560, y: 124 },
        route: 'vhv',
        label: '静态 import',
        labelAt: { x: 300, y: 150 },
      }),
    );

    // ③ IR → 实体件：build/build-print.ts
    parts.push(
      connector(ctx, {
        from: { x: C2_X + C2_W, y: 212 },
        to: { x: C3_X, y: 212 },
        route: 'hvh',
      }),
    );

    // ④ 实体件 → PDF：headless Edge page.pdf()
    parts.push(
      connector(ctx, {
        from: { x: C3_X + C3_W, y: 212 },
        to: { x: C4_X, y: 212 },
        route: 'hvh',
      }),
    );

    // ⑤ PDF → 发布包：build/build-package.mjs（纯纵向 ⇒ 标签贴线左侧）
    parts.push(
      connector(ctx, {
        from: { x: 810, y: 168 },
        to: { x: 810, y: 128 },
        route: 'hvh',
        label: '打包',
        labelAt: { x: 810, y: 148 },
      }),
    );

    // ⑥ 数字轨 → 发布包
    parts.push(
      connector(ctx, {
        from: { x: C3_X + C3_W, y: 88 },
        to: { x: C4_X, y: 88 },
        route: 'hvh',
      }),
    );

    // ⑦ 实体件 SVG → 双轨一致性门（辅比对 SVG↔ir）
    parts.push(
      connector(ctx, {
        from: { x: 560, y: 248 },
        to: { x: 560, y: 336 },
        route: 'hvh',
        label: 'SVG 入参',
        labelAt: { x: 560, y: 284 },
      }),
    );

    // ⑧ IR → 双轨一致性门（主比对 ir↔theme）：先下后右再下，从门禁盒**上边**进入
    parts.push(
      connector(ctx, {
        from: { x: 326, y: 252 },
        to: { x: 470, y: 336 },
        route: 'vhv',
        label: 'ir 入参',
        labelAt: { x: 400, y: 294 },
      }),
    );

    // ── 节点 ──────────────────────────────────────────────────
    parts.push(
      nodeBox(ctx, {
        x: C1_X, y: 176, w: C1_W, h: 72, kind: 'input',
        label: '四套主题包',
        sub: 'themes/*/theme.json',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C2_X, y: 172, w: C2_W, h: 80, kind: 'store',
        label: 'IR 中间数据',
        sub: 'print/<主题>/ir.json · build/build-ir.mjs',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C3_X, y: 52, w: C3_W, h: 72, kind: 'step',
        label: '数字轨 · 单文件 HTML',
        sub: 'esbuild.config.mjs → dist/创界山-活人认证.html',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C3_X, y: 176, w: C3_W, h: 72, kind: 'step',
        label: '实体轨 · SVG 与打印页',
        sub: 'build-print.ts → svg/*.svg · 规则书.html · 实体件.html',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C4_X, y: 168, w: C4_W, h: 88, kind: 'step',
        label: '规则书 PDF 与实体件 PDF',
        sub: 'headless Edge → print/<主题>/*.pdf',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C3_X, y: 336, w: C3_W, h: 96, kind: 'security',
        label: '双轨一致性门 ⑦',
        sub: 'tools/parity-check.mjs · IR↔SVG 精确比对 · 4 套 × 4 级',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: C4_X, y: 48, w: C4_W, h: 80, kind: 'store',
        label: 'dist/发布包/',
        sub: 'build-package.mjs → 数字轨/、实体件/<主题>/、README.md',
      }),
    );

    // ── 编辑批注（≤2）─────────────────────────────────────────
    parts.push(
      callout(ctx, {
        x: 40,
        y: 384,
        maxWidth: 380,
        text:
          '门禁⑦（tools/gate.mjs 第 7 位）跑 tools/parity-check.mjs：四套主题 × 四级 —— ① ir↔theme 主比对 ② SVG↔ir 辅比对 ③ 数值溯源 data-src↔scales ④ PDF 粗检；任一级不过即判红。',
      }),
    );
    parts.push(
      callout(ctx, {
        x: 700,
        y: 296,
        maxWidth: 216,
        text:
          '分叉点在主题包：数字轨由 web/theme.ts 静态 import 后直接打包，不经 IR；IR 只服务实体轨与门禁⑦的比对。',
      }),
    );

    return parts.join('\n');
  },
};
