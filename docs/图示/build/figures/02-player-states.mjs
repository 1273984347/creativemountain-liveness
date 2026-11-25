// 02 玩家状态机 —— 状态迁移图（角色化）。
//
// 讲的是一局之内**单个玩家**的状态与迁移：正常 / 待认证 / 认证通过 / 力竭 / 放逐，
// 外加负面状态五件套（中毒 / 减速 / 封口 / 停手番 / 免疫）作为一组并列状态。
//
// 事实来源：engine/core/state.ts（Player.pendingCert / exhaustedRounds / statuses / alive）、
//          engine/core/exhaustion.ts（HP 归零 ⇒ exhaustedRounds=2；解除时 hp = max(hp, ceil(hpMax/2))）、
//          engine/core/statuses.ts（家族 B 结算锚在「该玩家自己手番末」；放逐侧收口）、
//          engine/core/certification.ts（登顶进入待认证；签印达门槛封顶 ⇒ 活人席 +1 并回山道起点；
//          判不通过 ⇒ 后退 1 格离开峰顶 ⇒ 认证终止）、
//          engine/core/council.ts（山议放逐：alive=false，唯一出局通道）、
//          README.md「力竭（B76）」与「负面状态家族（B77）」两段（结算锚点分两族）。
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有 x / y / w / h 必须是 4 的倍数。
// ⚠️ 连线一律走 connector()：正交圆角，标签 ≤14 字。

import { nodeBox, connector, callout } from '../svg-kit.mjs';

// ── 节点矩形（母版坐标）────────────────────────────────────────
const A = { x: 380, y: 180, w: 200, h: 96 };  // 正常
const B = { x: 380, y: 48, w: 200, h: 64 };   // 待认证
const C = { x: 700, y: 48, w: 200, h: 64 };   // 认证通过
const D = { x: 60, y: 180, w: 200, h: 72 };   // 力竭
const E = { x: 60, y: 320, w: 240, h: 88 };   // 负面状态五件套
const F = { x: 700, y: 320, w: 200, h: 72 };  // 放逐

export default {
  slug: 'player-states',
  index: '02',
  name: '玩家状态机',
  total: 8,
  typeLabel: '状态迁移图',
  eyebrow: '机制 · 玩家状态与迁移',
  title: '玩家状态机',
  subtitle:
    '一个玩家在一局之内的五种处境与它们的迁移：登顶待认证、认证通过取席、力竭不是出局、放逐才是唯一出局通道。',
  desc:
    '状态迁移图：以正常状态为中心，正常可进入待认证、力竭、负面状态五件套与放逐；待认证可达成认证通过取一个活人席并回到山道起点，也可被判罚后退离峰顶回到正常；力竭与放逐用不同节点样式区分，力竭会在回合末自行倒数解除，放逐则直接出局。',
  legend: [
    { kind: 'step', label: '常规状态' },
    { kind: 'focal', label: '待认证' },
    { kind: 'store', label: '力竭' },
    { kind: 'input', label: '负面状态组' },
    { kind: 'security', label: '放逐（出局）' },
  ],
  render(ctx) {
    const parts = [];

    // ── 节点 ──────────────────────────────────────────────────
    parts.push(
      nodeBox(ctx, {
        ...A, kind: 'step', tag: 'STATE',
        label: '正常',
        sub: 'alive=true · hp>0 · 未力竭',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        ...B, kind: 'focal', tag: 'CERT',
        label: '待认证',
        sub: 'pendingCert=true · 峰顶锁定',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        ...C, kind: 'step', tag: 'PASS',
        label: '认证通过',
        sub: '活人席 +1 · 回山道起点',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        ...D, kind: 'store', tag: 'EXHAUST',
        label: '力竭',
        sub: 'exhaustedRounds=2 → 0',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        ...E, kind: 'input', tag: 'NEGATIVE',
        label: '负面状态五件套',
        sub: '中毒 / 减速 / 封口 / 停手番 / 免疫\n递减锚点：该玩家自己手番末',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        ...F, kind: 'security', tag: 'EXILE',
        label: '放逐',
        sub: 'alive=false · 唯一出局通道',
      }),
    );

    // ── 连线（先画箭头，后画节点）──────────────────────────────
    // ① 正常 → 待认证（登顶）：竖直，出点在两盒底/顶的中点。
    parts.push(
      connector(ctx, {
        from: { x: A.x + A.w / 2, y: A.y },
        to: { x: B.x + B.w / 2, y: B.y + B.h },
        route: 'hvh',
        label: '登顶进入待认证',
        labelAt: { x: 540, y: 146 },
        labelSide: 'right',
      }),
    );

    // ② 待认证 → 认证通过（签印达门槛）：水平直线。
    parts.push(
      connector(ctx, {
        from: { x: B.x + B.w, y: B.y + B.h / 2 },
        to: { x: C.x, y: C.y + C.h / 2 },
        route: 'hvh',
        label: '签印达门槛',
        labelAt: { x: 640, y: 80 },
      }),
    );

    // ③ 认证通过 → 正常（活人席 +1，回到山道起点 ⇒ 仍是正常态）。
    parts.push(
      connector(ctx, {
        from: { x: C.x + C.w / 2, y: C.y + C.h },
        to: { x: A.x + A.w, y: A.y + A.h * 0.25 },
        route: 'hvh',
        label: '回山道起点',
        labelAt: { x: 635, y: 200 },
      }),
    );

    // ④ 待认证 → 正常（判罚后退 1 格离开峰顶 ⇒ 认证终止）：竖直。
    parts.push(
      connector(ctx, {
        from: { x: B.x + B.w * 0.25, y: B.y + B.h },
        to: { x: A.x + A.w * 0.25, y: A.y },
        route: 'hvh',
        label: '判罚后退离峰',
        labelAt: { x: 390, y: 146 },
      }),
    );

    // ⑤ 正常 → 力竭（{hp} 归零）：两条同向盒边用不同出点，间距 67px。
    parts.push(
      connector(ctx, {
        from: { x: A.x, y: A.y + A.h * 0.15 },
        to: { x: D.x + D.w, y: D.y + D.h * 0.15 },
        route: 'hvh',
        label: '{hp} 归零',
        labelAt: { x: 320, y: 192 },
        labelShift: { y: -12 },
      }),
    );

    // ⑥ 力竭 → 正常（自恢 / 救援 / 自然恢复，回到半血）。
    parts.push(
      connector(ctx, {
        from: { x: D.x + D.w, y: D.y + D.h * 0.85 },
        to: { x: A.x, y: A.y + A.h * 0.85 },
        route: 'hvh',
        label: '恢复（自恢/救援）',
        labelAt: { x: 320, y: 251 },
        labelShift: { y: -24 },
      }),
    );

    // ⑦ 正常 → 负面状态组（被授予）。
    parts.push(
      connector(ctx, {
        from: { x: A.x + A.w * 0.25, y: A.y + A.h },
        to: { x: E.x + E.w / 2, y: E.y },
        route: 'hvh',
        label: '被授予负面状态',
        labelAt: { x: 242, y: 380 },
      }),
    );

    // ⑧ 负面状态组 → 正常（自己手番末递减至 0）。
    parts.push(
      connector(ctx, {
        from: { x: E.x + E.w, y: E.y + E.h * 0.8 },
        to: { x: A.x + A.w * 0.85, y: A.y + A.h },
        route: 'hvh',
        label: '自己手番末递减',
        labelAt: { x: 360, y: 380 },
      }),
    );

    // ⑨ 正常 → 放逐（山议最高票放逐；被放逐者状态与印记一并作废）。
    parts.push(
      connector(ctx, {
        from: { x: A.x + A.w, y: A.y + A.h * 0.85 },
        to: { x: F.x, y: F.y + F.h / 2 },
        route: 'hvh',
        label: '山议放逐',
        labelAt: { x: 640, y: 309 },
      }),
    );

    // ── 编辑批注 ──────────────────────────────────────────────
    parts.push(
      callout(ctx, {
        x: 60,
        y: 428,
        maxWidth: 440,
        text:
          '结算锚点刻意分两族：负面状态族在「该玩家自己手番末」递减，力竭仍按 round 末倒数 —— 两族各挂各的锚点。',
      }),
    );
    parts.push(
      callout(ctx, {
        x: 540,
        y: 428,
        maxWidth: 380,
        text:
          '力竭不是出局：{hp} 归零只置 exhaustedRounds=2，手牌上限减半、封锁主动被动、不可发起质疑；放逐是唯一出局通道。',
      }),
    );

    return parts.join('\n');
  },
};
