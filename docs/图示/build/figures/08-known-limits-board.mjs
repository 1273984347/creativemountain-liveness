// 08 已知限制与待办看板 —— 看板图（状态普查，全图无连线）。
//
// 讲的是本仓「已知限制（如实登记）」整节的真实状态：哪些已解决（README 原文带
// 删除线）、哪些是仍存在的限制、哪些待接线 / 待校准、哪些是设计取舍（不是待办）。
//
// 事实来源：README.md 第 70 行起的「已知限制（如实登记）」整节（含带删除线条目与
//          「动作契约层的未接线项（B15 登记）」表）、docs/沉淀/批次导航.md。
//          批次号只取自这两处真实记录；未查证的结论一律不写。
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有 x/y/w/h 都是 4 的倍数。
// ⚠️ 节点预算 ≤9：9 张卡片各占 1 个节点盒；列容器只画底色不描边（不计节点），
//    WIP 计数小片宽 24（不计节点），图例小色块 16×10（不计节点）。
// ⚠️ 折行口径：卡片文字按「字宽预算 em 数」折行（标题 13em、子标 17em），
//    不按盒内像素宽折行 —— 两档字号梯级是 12/16、盒宽是 4/3 倍，按像素折行会
//    在两档断成不同的行，验收的两档文本集合一致性就会判红。

import { T, FONT, KIND_STYLE, wrapText, callout } from '../svg-kit.mjs';

const COL_X = [40, 264, 488, 712];
const COL_W = 208;
const COL_TOP = 40;
const COL_H = 388;
const CARD_TOP = 88;
const CARD_H = 100;
const CARD_GAP = 12;
const CARD_W = 184;
const PAD = 12;
const CAP_TITLE = 13; // 字宽预算（em）
const CAP_SUB = 18;   // 字宽预算（em）

/** 四列状态：卡片 = 批次号 + 一句话；kind 复用工具库的语义类型。 */
const COLUMNS = [
  {
    title: '已解决',
    kind: 'store',
    cards: [
      {
        kind: 'store',
        title: 'B16 · 规则书补齐地形规则',
        sub: '原文带删除线 ⇒ 已补（B16）：福地/险径/裂隙/关隘/峰顶各有章节与要点关键词；doc-sync C10 常驻核对（规格 §3.4 逐类对应）',
      },
      {
        kind: 'store',
        title: 'B65 · 出牌改为付费',
        sub: 'G-a 原文带删除线 ⇒ 已修：灵枢不足即引擎拒绝，UI 同款拒因并点名「灵枢不足」；连带后果：门⑫ 阈值按跨 10 组独立样本重校准',
      },
    ],
  },
  {
    title: '待接线',
    kind: 'optional',
    cards: [
      {
        kind: 'optional',
        title: 'B70 · 模型未接入生产',
        sub: '三决策面评估已完成、模型未接入生产：play / council 面未检出改善 ⇒ 保持贪心；policy 缺省 undefined（失败必回落），评估器不进生产门禁',
      },
      {
        kind: 'optional',
        title: 'B80 · 棋盘格名仍印裂隙',
        sub: '遗留 L-B80-1：hybrid 棋盘格名仍印「裂隙」，与图例「崩口」在印品上自相矛盾 ⇒ 交 B81；另 L-B80-2：新格名不得与 崩口/险坡/行道者 互为子串',
      },
      {
        kind: 'optional',
        title: 'B15 · 少发牌是静默的',
        sub: 'B15 登记的未接线项 G-h：牌堆默认 40 张，dealInitialHands 需要 players×handStart（8 人 = 56）⇒ 高人数下手牌偏少',
      },
    ],
  },
  {
    title: '待校准',
    kind: 'input',
    cards: [
      {
        kind: 'security',
        blocked: true,
        title: 'B74 · certify 值得接入',
        sub: '两组独立扩样（各1900局/臂）均显著改善：χ²=3.926/7.834 ⇒ 判定该面值得接入，另立批次做门⑨ 重校准，本批仍不接入',
      },
      {
        kind: 'input',
        title: 'B75.2 · 开拓者削弱已登记',
        sub: '回合末清零接线让「每回合首移 +1」真正生效：12.6% → ~22%，身份锁 12 → 15pp（用户裁定）；削弱归专门批次，位次锁 5.5pp 保留',
      },
    ],
  },
  {
    title: '设计取舍',
    kind: 'step',
    cards: [
      {
        kind: 'step',
        title: 'B11 · 登顶不再等于赢',
        sub: '活人席计分制：认证通过不再直接终局，改为「获得 1 席 → 回到山道起点 → 可再取席」；终局按得分 = 席位数 × 活人席权重 − 距峰顶格数排名',
      },
      {
        kind: 'step',
        title: 'B20 · 实体棋盘出 4 版',
        sub: '实体件按人数出 4 版棋盘（24/28/32/36格），与数字轨共用一份 fitBoard；README 另记「实体件棋盘 4 人局 28 格版」',
      },
    ],
  },
];

/** 看板卡片：盒体 + 可选橘红阻塞条 + 标题 + 子标（两档断行完全一致）。 */
function card(ctx, o) {
  const { x, y, w, h, kind, title, sub, blocked = false } = o;
  const X = ctx.X(x);
  const Y = ctx.Y(y);
  const W = ctx.L(w);
  const H = ctx.L(h);
  const st = KIND_STYLE[kind] ?? KIND_STYLE.step;
  const nodeSize = ctx.F('node');
  const subSize = ctx.F('sub');
  const parts = [];

  parts.push(
    `    <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="6" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.sw}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`,
  );
  if (blocked) {
    parts.push(`    <rect x="${X}" y="${Y}" width="${ctx.L(4)}" height="${H}" rx="2" fill="${T.accent}"/>`);
  }

  const titleLines = wrapText(title, CAP_TITLE * nodeSize, nodeSize, false);
  const subLines = sub ? wrapText(sub, CAP_SUB * subSize, subSize, true) : [];
  const blockH =
    titleLines.length * (nodeSize + 4) +
    (subLines.length > 0 ? 4 + subLines.length * (subSize + 3) : 0);
  let cursorY = Y + (H - blockH) / 2 + nodeSize;
  const tx = X + ctx.L(PAD);

  for (const line of titleLines) {
    parts.push(
      `    <text x="${tx}" y="${cursorY}" fill="${T.ink}" font-size="${nodeSize}" font-weight="600" font-family="${FONT.sans}">${line}</text>`,
    );
    cursorY += nodeSize + 4;
  }
  if (subLines.length > 0) {
    cursorY += 4;
    for (const line of subLines) {
      parts.push(
        `    <text x="${tx}" y="${cursorY - 2}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}">${line}</text>`,
      );
      cursorY += subSize + 3;
    }
  }
  return parts.join('\n');
}

export default {
  slug: 'known-limits-board',
  index: '08',
  name: '已知限制与待办',
  total: 8,
  typeLabel: '看板',
  eyebrow: '状态 · 已知限制与待办',
  title: '已知限制与待办',
  subtitle:
    '按状态盘点：README 原文带删除线的归「已解决」，其余是仍存在的限制、待接线与待校准项；设计取舍单列，不冒充待办。',
  desc:
    '看板图：四列状态——已解决、待接线、待校准、设计取舍，共九张卡片，每张写明真实批次号与一句结论；事实取自 README「已知限制（如实登记）」整节与批次档案导航。',
  legend: [
    { kind: 'store', label: '已解决' },
    { kind: 'optional', label: '待接线' },
    { kind: 'input', label: '待校准' },
    { kind: 'step', label: '设计取舍' },
    { kind: 'security', label: '阻塞：待另立批次' },
  ],
  render(ctx) {
    const parts = [];

    COLUMNS.forEach((col, ci) => {
      const cx = COL_X[ci];

      // 列容器：只画底色不描边（看板列无边框），因此不占节点预算
      parts.push(
        `    <rect x="${ctx.X(cx)}" y="${ctx.Y(COL_TOP)}" width="${ctx.L(COL_W)}" height="${ctx.L(COL_H)}" rx="8" fill="rgba(45,49,66,0.03)"/>`,
      );

      // 列标题
      parts.push(
        `    <text x="${ctx.X(cx + PAD)}" y="${ctx.Y(60)}" fill="${T.ink}" font-size="${ctx.F('node')}" font-weight="600" font-family="${FONT.sans}">${col.title}</text>`,
      );

      // 计数小片（矩形 rx=2，非胶囊）
      const chipW = 24;
      const chipX = ctx.X(cx + COL_W - PAD - chipW);
      const chipY = ctx.Y(48);
      const chipH = ctx.L(16);
      parts.push(
        `    <rect x="${chipX}" y="${chipY}" width="${ctx.L(chipW)}" height="${chipH}" rx="2" fill="#ffffff" stroke="${T.soft}" stroke-width="1"/>`,
      );
      parts.push(
        `    <text x="${chipX + ctx.L(chipW) / 2}" y="${chipY + chipH - 5}" fill="${T.muted}" font-size="${ctx.F('eyebrow')}" font-family="${FONT.mono}" text-anchor="middle">${col.cards.length}</text>`,
      );

      // 列头下的细线
      parts.push(
        `    <line x1="${ctx.X(cx)}" y1="${ctx.Y(72)}" x2="${ctx.X(cx + COL_W)}" y2="${ctx.Y(72)}" stroke="${T.rule}" stroke-width="0.8"/>`,
      );

      // 卡片
      col.cards.forEach((c, i) => {
        parts.push(
          card(ctx, {
            x: cx + PAD,
            y: CARD_TOP + i * (CARD_H + CARD_GAP),
            w: CARD_W,
            h: CARD_H,
            kind: c.kind,
            title: c.title,
            sub: c.sub,
            blocked: c.blocked === true,
          }),
        );
      });
    });

    // ── 口径与来源（编辑批注，全图 2 处）──────────────────────────
    parts.push(
      callout(ctx, {
        x: 40,
        y: 444,
        maxWidth: 560,
        text:
          '口径：README「已知限制（如实登记）」整节逐条读；原文带删除线者归「已解决」，其余为仍存在的限制或待办。批次号只取自 README 与 docs/沉淀/批次导航.md。',
      }),
    );
    parts.push(
      callout(ctx, {
        x: 640,
        y: 444,
        maxWidth: 280,
        text: '事实截至 2026-11-09 现查；读数与结论以批次记录原文为准。',
      }),
    );

    return parts.join('\n');
  },
};
