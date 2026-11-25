// 05 句子层占位符管线 —— 数据流图（角色化）。
//
// 讲的是本项目 B79/B80 的核心主张：**引擎与界面不持有任何一套主题的词**，
// 只写 {resource}/{gate}/{path}/{peak}/{hp}/{rift}/{hazard}/{player} 八叶占位符；
// 唯一替换实现在 engine/core/theme-text.ts，取词只发生在四个显示出口。
//
// 事实来源：engine/core/theme-text.ts（TERM_TOKENS 八叶、expandThemeWords、缺叶抛错）、
//          web/ui/log.ts（logLineText 全 kind 展开）、web/ui/terms.ts（termExpander）、
//          web/ui/dom.ts（notice / alert）、README.md「句子层自 B79 起不持有任何一套主题的词」段。
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有值必须是 4 的倍数。
// ⚠️ 出口盒高 48（12 的倍数）⇒ 两档下 Y(顶)+L(高)/2 严格等于 Y(中心)，D→出口 必为水平直线。

import { nodeBox, connector, callout } from '../svg-kit.mjs';

const SRC_X = 40;
const SRC_W = 200;
const HUB_X = 280;
const HUB_W = 280;
const HUB_TOP = 48;
const HUB_H = 320;
const OUT_X = 600;
const OUT_W = 280;
const OUT_H = 48;
const OUT_TOPS = [88, 152, 216, 280];

export default {
  slug: 'token-pipeline',
  index: '05',
  name: '句子层占位符管线',
  total: 8,
  typeLabel: '数据流图',
  eyebrow: '机制 · 句子层主题词',
  title: '句子层占位符管线',
  subtitle:
    '引擎与界面只写八叶占位符，唯一替换实现把它变成玩家看到的词 —— 缺叶直接抛错，不留静默回落。',
  desc:
    '数据流图：引擎规则句、界面文案与八叶占位符词表汇入 engine/core/theme-text.ts 的 expandThemeWords 唯一实现，再从日志、notice、alert 与面板按钮四个显示出口送出。',
  legend: [
    { kind: 'input', label: '来源' },
    { kind: 'store', label: '占位符词表' },
    { kind: 'focal', label: '唯一替换实现' },
    { kind: 'step', label: '显示出口' },
  ],
  render(ctx) {
    const parts = [];

    // ── 来源（左列）─────────────────────────────────────────────
    parts.push(
      nodeBox(ctx, {
        x: SRC_X, y: 48, w: SRC_W, h: 64, kind: 'input',
        label: '引擎规则句', sub: 'engine/**',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: SRC_X, y: 152, w: SRC_W, h: 64, kind: 'input',
        label: '界面文案', sub: 'web/**',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: SRC_X, y: 256, w: SRC_W, h: 112, kind: 'store',
        label: '八叶占位符',
        sub: '{resource} {gate} {path} {peak} {hp} {rift} {hazard} {player}',
      }),
    );

    // ── 唯一实现（中列，焦点）────────────────────────────────────
    parts.push(
      nodeBox(ctx, {
        x: HUB_X, y: HUB_TOP, w: HUB_W, h: HUB_H, kind: 'focal',
        label: 'expandThemeWords',
        sub: 'engine/core/theme-text.ts · 缺叶即抛错，不留静默回落',
      }),
    );

    // ── 四个显示出口（右列）─────────────────────────────────────
    const exits = [
      { top: OUT_TOPS[0], label: '日志', sub: 'web/ui/log.ts · logLineText' },
      { top: OUT_TOPS[1], label: 'notice', sub: 'web/ui/dom.ts' },
      { top: OUT_TOPS[2], label: 'alert()', sub: 'web/ui/dom.ts' },
      { top: OUT_TOPS[3], label: '面板与按钮', sub: 'web/ui/terms.ts · termExpander' },
    ];
    for (const e of exits) {
      parts.push(
        nodeBox(ctx, {
          x: OUT_X, y: e.top, w: OUT_W, h: OUT_H, kind: 'step',
          label: e.label, sub: e.sub,
        }),
      );
    }

    // ── 连线（先画箭头，后画节点）──────────────────────────────
    // 来源三路 → 唯一实现：出点分列 D 左缘 t=1/4,2/4,3/4（互不相等、间隔 ≥12px）。
    const hubLeftTs = [0.25, 0.5, 0.75];
    const srcs = [80, 184, 312];
    srcs.forEach((sy, i) => {
      parts.push(
        connector(ctx, {
          from: { x: SRC_X + SRC_W, y: sy },
          to: { x: HUB_X, y: HUB_TOP + HUB_H * hubLeftTs[i] },
          route: 'hvh',
        }),
      );
    });

    // 唯一实现 → 四个出口：出点 t=1/5..4/5，与出口盒中心严格对齐（水平直线）。
    exits.forEach((e, i) => {
      const t = (i + 1) / 5;
      parts.push(
        connector(ctx, {
          from: { x: HUB_X + HUB_W, y: HUB_TOP + HUB_H * t },
          to: { x: OUT_X, y: e.top + OUT_H / 2 },
          route: 'hvh',
        }),
      );
    });

    // ── 编辑批注：反向守卫 R1（唯一允许的额外说明）──────────────
    parts.push(
      callout(ctx, {
        x: SRC_X,
        y: 404,
        maxWidth: 460,
        text:
          '反向守卫 R1：engine/** 与 web/** 的非注释行出现任何一套主题词字面量即判红 —— 禁字表由四套 theme.json 派生，加第五套自动纳入。',
      }),
    );

    return parts.join('\n');
  },
};
