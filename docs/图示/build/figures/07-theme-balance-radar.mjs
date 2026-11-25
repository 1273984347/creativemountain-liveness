// 07 四套主题平衡画像 —— 画像图（雷达）。
//
// 讲的是：四套主题包在**同一批真实读数**上的定位差异 —— 24000 局规模模拟（balance-report）
//          + 12 张试炼牌 × 400 次定向长跑（trial-pass-rate）。
// 结论口径与 balance-report「主题间一致性」一致：四套主题共享通用卡牌池，读数应当几乎重合。
//
// 事实来源（数字全部来自这两份自动生成报告，模块内不做任何估计）：
//   docs/balance-report.md
//     · 「分主题 · 分人数档」      → 5 人局 / 8 人局 无人封顶率
//     · 「身份胜率（分主题）」      → 身份胜率极差（max−min，pp）
//     · 「阵营胜率（分主题）」      → 阵营胜率极差（max−min，pp）
//   docs/trial-pass-rate.md
//     · 12 张试炼牌 × 400 次定向长跑 → 通过次数求差 = 失败次数（4800 次抽取为分母）
//
// ⚠️ 五轴**同向**：每轴都是「越低越平」的失衡量（封顶率、胜率离散度、试炼失败次数）。
//    半径 = 实测值 ÷ 该轴满刻度 ⇒ 半径只比形状，不比绝对值；满刻度写在轴标签第二行。
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；盒与文字坐标取 4 的倍数。
//    多边形顶点按几何取整（雷达几何量，参考 diagram-design/references/type-radar.md）。

import { T, SERIES, FONT } from '../svg-kit.mjs';

// ── 数据（原始读数，逐条来自上面的源文件）────────────────────────────
const THEMES = [
  {
    name: '仙侠·2026',
    color: SERIES[0],
    vals: [2300, 21.4, 3.3, 5.9, 1.2],
  },
  {
    name: '科幻·AI 纪元',
    color: SERIES[1],
    vals: [2300, 21.8, 4.1, 6.8, 1.6],
  },
  {
    name: '融合·道械双修',
    color: T.accent,
    focal: true,
    vals: [2271, 21.1, 4.4, 5.6, 0.9],
  },
  {
    name: '都市·异能纪',
    color: SERIES[2],
    vals: [2335, 20.6, 4.4, 7.2, 0.4],
  },
];

const AXES = [
  { name: '试炼失败次数', cap: 4800, capLabel: '满刻 4800 次', row: '试炼失败次数（次）' },
  { name: '5 人局封顶率', cap: 25, capLabel: '满刻 25%', row: '5 人局封顶率（%）' },
  { name: '8 人局封顶率', cap: 25, capLabel: '满刻 25%', row: '8 人局封顶率（%）' },
  { name: '身份胜率离散', cap: 15, capLabel: '满刻 15pp', row: '身份胜率离散（pp）' },
  { name: '阵营胜率离散', cap: 4, capLabel: '满刻 4pp', row: '阵营胜率离散（pp）' },
];

// ── 雷达几何（母版坐标）────────────────────────────────────────────
const CX = 272;
const CY = 250;
const R = 148;
const N = AXES.length;
// 首轴在正上方，顺时针等分
const UNIT = [
  [0, -1],
  [0.9511, -0.309],
  [0.5878, 0.809],
  [-0.5878, 0.809],
  [-0.9511, -0.309],
];
// 轴标签落点（母版坐标，4 的倍数）
const LABELS = [
  { anchor: 'middle', x: 272, y: 76, capY: 92 },
  { anchor: 'start', x: 428, y: 196, capY: 212 },
  { anchor: 'start', x: 372, y: 384, capY: 400 },
  { anchor: 'end', x: 172, y: 384, capY: 400 },
  { anchor: 'end', x: 124, y: 196, capY: 212 },
];

// ── 读数表（右侧面板）──────────────────────────────────────────────
const TBL_X = 540;
const COLS = [636, 712, 788, 860];
const HEAD_Y = 128;
const ROW_Y = [164, 200, 236, 272, 308];

const fmt = (v, i) => (i === 0 ? String(v) : v.toFixed(1));

export default {
  slug: 'theme-balance-radar',
  index: '07',
  name: '四套主题平衡画像',
  total: 8,
  typeLabel: '雷达图',
  eyebrow: '平衡 · 四套主题读数',
  title: '四套主题平衡画像',
  subtitle:
    '同一批真实读数（24000 局模拟 + 12 张试炼牌定向长跑）上，四套主题的画像几乎重合 —— 差异只来自 2 张标志卡与文案。',
  desc:
    '雷达图：仙侠·2026、科幻·AI 纪元、融合·道械双修、都市·异能纪四条多边形在五条同向轴上比较 —— 试炼失败次数、5 人局无人封顶率、8 人局无人封顶率、身份胜率极差、阵营胜率极差；每条轴越低越平，半径为实测值除以该轴满刻度，四套主题的形状高度重合。',
  legend: [
    { fill: 'rgba(124,143,111,0.18)', stroke: SERIES[0], label: '仙侠·2026' },
    { fill: 'rgba(94,122,155,0.18)', stroke: SERIES[1], label: '科幻·AI 纪元' },
    { fill: 'rgba(235,108,54,0.18)', stroke: T.accent, label: '融合·道械双修（焦点）' },
    { fill: 'rgba(184,145,90,0.18)', stroke: SERIES[2], label: '都市·异能纪' },
  ],
  render(ctx) {
    const parts = [];
    const X = (v) => ctx.X(v);
    const Y = (v) => ctx.Y(v);
    const nodeSize = ctx.F('node');
    const subSize = ctx.F('sub');

    const pt = (i, f) => [
      Math.round(CX + f * R * UNIT[i][0]),
      Math.round(CY + f * R * UNIT[i][1]),
    ];
    const ringPts = (f) =>
      UNIT.map((_, i) => {
        const [x, y] = pt(i, f);
        return `${X(x)},${Y(y)}`;
      }).join(' ');

    // ── 网格环（内四环淡，外环略实）────────────────────────────
    for (const f of [0.2, 0.4, 0.6, 0.8]) {
      parts.push(
        `    <polygon points="${ringPts(f)}" fill="none" stroke="rgba(45,49,66,0.10)" stroke-width="1"/>`,
      );
    }
    parts.push(
      `    <polygon points="${ringPts(1)}" fill="none" stroke="rgba(45,49,66,0.20)" stroke-width="1"/>`,
    );

    // ── 轴线 ────────────────────────────────────────────────────
    for (let i = 0; i < N; i += 1) {
      const [ex, ey] = pt(i, 1);
      parts.push(
        `    <line x1="${X(CX)}" y1="${Y(CY)}" x2="${X(ex)}" y2="${Y(ey)}" stroke="rgba(45,49,66,0.20)" stroke-width="1"/>`,
      );
    }

    // ── 系列多边形（先非焦点、后焦点；焦点描边更实 + 顶点圆点）──
    const order = [...THEMES].sort((a, b) => Number(Boolean(b.focal)) - Number(Boolean(a.focal)));
    for (const th of order) {
      const pts = th.vals
        .map((v, i) => {
          const [x, y] = pt(i, v / AXES[i].cap);
          return `${X(x)},${Y(y)}`;
        })
        .join(' ');
      parts.push(
        `    <polygon points="${pts}" fill="${th.color}" fill-opacity="${th.focal ? 0.18 : 0.10}" stroke="${th.color}" stroke-width="${th.focal ? 1.8 : 1.5}"/>`,
      );
    }
    const focal = THEMES.find((t) => t.focal);
    const dotR = ctx.key === 'doc-inline' ? 4 : 5;
    for (let i = 0; i < N; i += 1) {
      const [vx, vy] = pt(i, focal.vals[i] / AXES[i].cap);
      parts.push(
        `    <circle cx="${X(vx)}" cy="${Y(vy)}" r="${dotR}" fill="${focal.color}" stroke="${T.paper}" stroke-width="1"/>`,
      );
    }

    // ── 轴标签（名称 + 满刻度）──────────────────────────────────
    for (let i = 0; i < N; i += 1) {
      const L = LABELS[i];
      parts.push(
        `    <text x="${X(L.x)}" y="${Y(L.y)}" fill="${T.ink}" font-size="${nodeSize}" font-weight="600" font-family="${FONT.sans}" text-anchor="${L.anchor}">${AXES[i].name}</text>`,
      );
      parts.push(
        `    <text x="${X(L.x)}" y="${Y(L.capY)}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}" text-anchor="${L.anchor}">${AXES[i].capLabel}</text>`,
      );
    }

    // ── 右侧读数表 ──────────────────────────────────────────────
    parts.push(
      `    <text x="${X(TBL_X)}" y="${Y(76)}" fill="${T.ink}" font-size="${nodeSize}" font-weight="600" font-family="${FONT.sans}">各轴原始读数</text>`,
    );
    parts.push(
      `    <text x="${X(TBL_X)}" y="${Y(96)}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}">半径 = 实测值 ÷ 该轴满刻度 · 越低越平</text>`,
    );
    parts.push(
      `    <text x="${X(TBL_X)}" y="${Y(HEAD_Y)}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}">轴</text>`,
    );
    THEMES.forEach((th, i) => {
      parts.push(
        `    <text x="${X(COLS[i])}" y="${Y(HEAD_Y)}" fill="${th.color}" font-size="${subSize}" font-weight="600" font-family="${FONT.sans}">${th.name}</text>`,
      );
    });
    parts.push(
      `    <line x1="${X(TBL_X)}" y1="${Y(136)}" x2="${X(916)}" y2="${Y(136)}" stroke="${T.rule}" stroke-width="1"/>`,
    );
    AXES.forEach((ax, r) => {
      parts.push(
        `    <text x="${X(TBL_X)}" y="${Y(ROW_Y[r])}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.sans}">${ax.row}</text>`,
      );
      THEMES.forEach((th, c) => {
        parts.push(
          `    <text x="${X(COLS[c])}" y="${Y(ROW_Y[r])}" fill="${T.ink}" font-size="${subSize}" font-family="${FONT.mono}">${fmt(th.vals[r], r)}</text>`,
        );
      });
    });
    const NOTES = [
      '封顶率 = 无人取得任何席位的局占比（balance-report 分主题·分人数档）',
      '离散 = 该主题内最高 − 最低胜率（身份胜率 / 阵营胜率表）',
      '试炼失败 = 4800 次抽取 − 通过次数（trial-pass-rate.md 定向长跑）',
      '来源：docs/balance-report.md · docs/trial-pass-rate.md',
    ];
    NOTES.forEach((t, i) => {
      parts.push(
        `    <text x="${X(TBL_X)}" y="${Y(344 + i * 20)}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}">${t}</text>`,
      );
    });

    // ── 编辑批注（≤2 处，用 1 处）───────────────────────────────
    parts.push(
      `    <text x="${X(40)}" y="${Y(440)}" fill="${T.muted}" font-size="14" font-style="italic" font-family="${FONT.serif}">读法：五轴同向（越低越平），各轴按自身满刻度归一，半径只比形状、不比绝对值；</text>`,
    );
    parts.push(
      `    <text x="${X(40)}" y="${Y(464)}" fill="${T.muted}" font-size="14" font-style="italic" font-family="${FONT.serif}">四套画像几乎重合，与 balance-report「主题间一致性：差异只来自 2 张标志卡与文案」的结论一致。</text>`,
    );

    return parts.join('\n');
  },
};
