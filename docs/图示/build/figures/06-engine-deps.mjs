// 06 引擎依赖图 —— 依赖图（分层 + 扇入角标 + 循环回边）。
//
// 讲的是 engine/ 内部真实存在的 import 结构（不是手画的架构意图）：
// 四层依赖深度 —— 回合编排 → 机制模块 → 状态底座 → 类型契约；
// 角标是被依赖次数（in）；唯一的循环依赖 state ↔ hand 用橘红虚线回边标出。
//
// 事实来源：engine/ 下 46 个 .ts 文件的 import 语句逐条聚合（只认 from './*' 的
// 相对 import ⇒ engine 内部关系，不含 web/tests）。关键计数：core/state.ts 被 29 处
// 引用、types/theme.ts 20 处、scales.ts 8 处、core/counters.ts 7 处、core/duel.ts 6 处、
// core/gate.ts 与 core/certification.ts 各 5 处、core/hand.ts 与 core/turn-runner.ts 各 4 处。
// 循环依赖实证：core/state.ts import './hand.ts'，core/hand.ts import './state.ts'。
//
// 母版坐标：内容区 x 40..920、y 40..480；所有 x/y/w/h 必须是 4 的倍数。
// 层间带里多条连线必须错层并行（via 参数指定跨层高度），否则共用同一水平段。

import { T, FONT, nodeBox, connector, callout, textWidth } from '../svg-kit.mjs';

const NW = 160;
const NH = 56;

/** 扇入角标：右上角小芯片，写「N in」（type-dependency 的 fan-in badge）。 */
function fanIn(ctx, node, text) {
  const size = 8;
  const tw = textWidth(text, size, true) + 8;
  const bx = ctx.X(node.x + node.w) - ctx.L(tw) - 8;
  const by = ctx.Y(node.y) + 8;
  return [
    `    <rect x="${bx}" y="${by}" width="${ctx.L(tw)}" height="12" rx="2" fill="transparent" stroke="${T.soft}" stroke-width="0.8"/>`,
    `    <text x="${bx + ctx.L(tw) / 2}" y="${by + 10}" fill="${T.muted}" font-size="${size}" font-family="${FONT.mono}" text-anchor="middle">${text}</text>`,
  ].join('\n');
}

const NODES = {
  turn: { x: 372, y: 48, w: 216, h: NH, label: '回合编排', sub: 'core/turn-runner.ts · 引 16 个模块', badge: '4 in', kind: 'step' },
  gate: { x: 40, y: 168, w: NW, h: NH, label: '关隘', sub: 'core/gate.ts', badge: '5 in', kind: 'step' },
  duel: { x: 240, y: 168, w: NW, h: NH, label: '对峙', sub: 'core/duel.ts', badge: '6 in', kind: 'step' },
  cert: { x: 440, y: 168, w: NW, h: NH, label: '认证', sub: 'core/certification.ts', badge: '5 in', kind: 'step' },
  hand: { x: 640, y: 168, w: NW, h: NH, label: '手牌', sub: 'core/hand.ts', badge: '4 in', kind: 'step' },
  counters: { x: 40, y: 288, w: NW, h: NH, label: '计数器', sub: 'core/counters.ts', badge: '7 in', kind: 'step' },
  state: { x: 300, y: 288, w: 240, h: 72, label: '状态底座', sub: 'core/state.ts · 全引擎共享', badge: '29 in', kind: 'step' },
  theme: { x: 40, y: 408, w: NW, h: NH, label: '类型契约', sub: 'types/theme.ts', badge: '20 in', kind: 'store' },
};

export default {
  slug: 'engine-deps',
  index: '06',
  name: '引擎依赖图',
  total: 8,
  typeLabel: '依赖图',
  eyebrow: '架构 · engine 内部依赖',
  title: '引擎依赖图',
  subtitle:
    'engine/ 内部真实 import 结构：编排层 → 机制模块 → 状态底座 → 类型契约；角标是被依赖次数。',
  desc:
    '依赖图：按依赖深度分四层的引擎模块依赖图，core/state.ts 被 29 处引用是全图枢纽，core/state.ts 与 core/hand.ts 之间存在一条循环依赖，以橘红虚线回边标出。',
  legend: [
    { kind: 'step', label: '内部模块' },
    { kind: 'store', label: '无出边叶子' },
    { kind: 'security', label: '循环依赖' },
  ],
  render(ctx) {
    const parts = [];

    // R0 编排层 → R1 机制层：四条在层间带里错层并行（116/128/140/152），
    // 保证任意两条的水平段既不重叠也不交叉。
    parts.push(connector(ctx, { from: { x: 426, y: 104 }, to: { x: 120, y: 168 }, via: { y: 116 } }));
    parts.push(connector(ctx, { from: { x: 453, y: 104 }, to: { x: 320, y: 168 }, via: { y: 128 } }));
    parts.push(connector(ctx, { from: { x: 480, y: 104 }, to: { x: 720, y: 168 }, via: { y: 140 } }));
    parts.push(connector(ctx, { from: { x: 507, y: 104 }, to: { x: 520, y: 168 }, via: { y: 152 } }));

    // R1 机制层 → R2 底座层
    parts.push(connector(ctx, { from: { x: 120, y: 224 }, to: { x: 120, y: 288 } }));
    parts.push(connector(ctx, { from: { x: 320, y: 224 }, to: { x: 360, y: 288 }, via: { y: 240 } }));
    parts.push(connector(ctx, { from: { x: 720, y: 224 }, to: { x: 500, y: 288 }, via: { y: 252 } }));
    parts.push(connector(ctx, { from: { x: 520, y: 224 }, to: { x: 480, y: 288 }, via: { y: 264 } }));

    // 同层内相邻模块：计数器 → 状态底座
    parts.push(connector(ctx, { from: { x: 200, y: 316 }, to: { x: 300, y: 316 } }));

    // R2 → R3：状态底座 → 类型契约
    parts.push(connector(ctx, { from: { x: 340, y: 360 }, to: { x: 120, y: 408 }, via: { y: 384 } }));

    // 唯一的循环依赖：state → hand（反向回边），绕在节点栈外侧
    parts.push(connector(ctx, {
      from: { x: 540, y: 320 }, to: { x: 800, y: 200 }, via: { x: 860 },
      kind: 'accent', dash: '5,4', label: 'CYCLE', labelAt: { x: 580, y: 320 },
    }));

    // 节点 + 扇入角标
    for (const key of ['turn', 'gate', 'duel', 'cert', 'hand', 'counters', 'state', 'theme']) {
      const n = NODES[key];
      parts.push(nodeBox(ctx, {
        x: n.x, y: n.y, w: n.w, h: n.h, kind: n.kind, label: n.label, sub: n.sub,
      }));
      parts.push(fanIn(ctx, n, n.badge));
    }

    // 编辑批注（≤2）
    parts.push(callout(ctx, {
      x: 220, y: 436, maxWidth: 340,
      text: '唯一的循环依赖：core/state.ts ↔ core/hand.ts —— 状态持有手牌、手牌回写状态，二者互引。',
    }));
    parts.push(callout(ctx, {
      x: 580, y: 436, maxWidth: 320,
      text: '分层按依赖深度排（非手画架构）；角标 N in = engine 内引用它的地方数。',
    }));

    return parts.join('\n');
  },
};
