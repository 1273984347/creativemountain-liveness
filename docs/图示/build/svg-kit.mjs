// 图集 SVG 工具库 —— 把 diagram-design 的硬规则固化成可复用函数。
//
// 为什么要工具库而不是手写 16 份 HTML：
//   1. 本批要出 8 张图 × 2 档（doc-inline / slide-16x9）= 16 份产物。
//      手写 16 份 ⇒ 两档之间的字号、配色、无障碍契约必然漂移。
//   2. SKILL.md §6 的六条连线硬规则（圆角直角、标签留缝、互不重叠、
//      共享边分散出点、不穿非端点盒、掩码不压后画节点）逐张手写极易漏。
//      工具库把它们做成「只有一条正确写法」的函数。
//   3. 坐标换算：母版空间 960×600（= doc-inline viewBox），
//      slide-16x9 档由工具按 4/3 数值换算并对齐到 4px 栅格，
//      字体走投屏档（节点 16 / 子标 12 / 箭头标签 12）。
//
// 母版坐标约定（图表作者只写母版坐标）：
//   - 内容区 x 40..920、y 40..480；图例由工具画在底部条带。
//   - 所有坐标、盒宽高必须是被 4 整除的数（SKILL §7 栅格）。
//
// 依据：SKILL.md §2/§3/§6/§7/§9、references/style-guide.md（默认皮肤）、
//      references/output-spec.md（档位与字号梯级）。
//
// ⚠️ 本文件是**生成器**，不是产物真相源：产物在 docs/图示/*.html，
//    改本文件后必须重跑 `node docs/图示/build/diagram-build.mjs`。

/** 语义色（style-guide.md 默认皮肤：白烟纸 + 原子橘红）。 */
export const T = {
  paper: '#f5f5f5',
  paper2: '#ececec',
  ink: '#2d3142',
  muted: '#4f5d75',
  soft: '#7a8399',
  rule: 'rgba(45,49,66,0.12)',
  ruleSolid: '#bfc0c0',
  accent: '#eb6c36',
  accentTint: 'rgba(235,108,54,0.08)',
  link: '#2e5aa8',
};

/** 多系列色（仅雷达等需要区分多条系列的图型；1-focal 规则仍成立）。 */
export const SERIES = ['#7c8f6f', '#5e7a9b', '#b8915a', '#9c6b50', '#6e6479'];

/** 档位参数（output-spec.md §2）。k = 母版 → 输出的换算系数。 */
export const PRESETS = {
  'doc-inline': {
    key: 'doc-inline',
    label: '文档档',
    vw: 960,
    vh: 600,
    k: 1,
    ramp: 'standard',
    font: { node: 12, sub: 9, arrow: 8, eyebrow: 8 },
    legendTop: 528,
    footer: 'doc-inline · 960×600 · 节点 12px',
  },
  'slide-16x9': {
    key: 'slide-16x9',
    label: '投屏档',
    vw: 1280,
    vh: 720,
    k: 4 / 3,
    ramp: 'presentation',
    font: { node: 16, sub: 12, arrow: 12, eyebrow: 8 },
    legendTop: 648,
    footer: 'slide-16x9 · 1280×720 · 节点 16px',
  },
};

/** 节点类型 → 填充/描边（SKILL.md §5 节点类型表）。 */
export const KIND_STYLE = {
  focal: { fill: T.accentTint, stroke: T.accent, sw: 1, dash: null },
  step: { fill: '#ffffff', stroke: T.ink, sw: 1, dash: null },
  store: { fill: 'rgba(45,49,66,0.05)', stroke: T.muted, sw: 1, dash: null },
  external: { fill: 'rgba(45,49,66,0.03)', stroke: 'rgba(45,49,66,0.30)', sw: 1, dash: null },
  input: { fill: 'rgba(79,93,117,0.10)', stroke: T.soft, sw: 1, dash: null },
  optional: { fill: 'rgba(45,49,66,0.02)', stroke: 'rgba(45,49,66,0.20)', sw: 1, dash: '4,3' },
  security: { fill: 'rgba(235,108,54,0.05)', stroke: 'rgba(235,108,54,0.50)', sw: 1, dash: '4,4' },
  zone: { fill: T.paper2, stroke: 'rgba(45,49,66,0.16)', sw: 1, dash: null },
};

/** CJK 安全的字体栈：Geist / Instrument Serif 不含汉字，必须挂本地与网络回退。 */
export const FONT = {
  sans: "'Geist', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  serif: "'Instrument Serif', 'Noto Serif SC', 'Songti SC', serif",
  mono: "'Geist Mono', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace",
};

const round4 = (v) => Math.round(v / 4) * 4;

/** 是否 Unicode 宽字符（全角/宽字符，1em 宽）。 */
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** 组合记号 / 零宽字符不占宽。 */
function isZeroWidth(cp) {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x20e3
  );
}

/**
 * 文本宽度估算（output-spec.md §4 宽度预算）：
 * 宽字符 1em、拉丁 0.60em（等宽 0.62em）、组合记号 0。
 */
export function textWidth(str, size, mono = false) {
  let em = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (isZeroWidth(cp)) continue;
    em += isWide(cp) ? 1 : mono ? 0.62 : 0.6;
  }
  return em * size;
}

/**
 * 按宽度预算折行：CJK 可任意断行，拉丁按空格断。
 * 返回行数组；单行放不下且无空格时按字符硬断。
 */
export function wrapText(str, maxWidth, size, mono = false) {
  const text = String(str);
  if (textWidth(text, size, mono) <= maxWidth) return [text];
  const lines = [];
  let cur = '';
  const tokens = text.match(/[^\s]+\s*|\s+/g) ?? [text];
  for (const tk of tokens) {
    if (textWidth(cur + tk, size, mono) <= maxWidth) {
      cur += tk;
      continue;
    }
    if (cur.trim() !== '') {
      lines.push(cur.trimEnd());
      cur = '';
    }
    let rest = tk.trimStart();
    while (textWidth(rest, size, mono) > maxWidth) {
      let cut = 0;
      let acc = 0;
      for (const ch of rest) {
        const w = textWidth(ch, size, mono);
        if (acc + w > maxWidth) break;
        acc += w;
        cut += ch.length;
      }
      if (cut === 0) cut = 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    cur = rest;
  }
  if (cur.trim() !== '') lines.push(cur.trimEnd());
  return lines.length > 0 ? lines : [''];
}

/** 输出坐标换算上下文：母版坐标 → 目标档位坐标（对齐 4px 栅格）。 */
export class Ctx {
  constructor(presetKey) {
    const p = PRESETS[presetKey];
    if (!p) throw new Error(`未知档位：${presetKey}`);
    this.p = p;
    this.key = p.key;
  }

  X(v) { return round4(v * this.p.k); }
  Y(v) { return round4(v * this.p.k); }
  L(v) { return round4(v * this.p.k); }
  /** 字号按档位直接取值（不做比例缩放 —— 字号梯级由 output-spec 定死）。 */
  F(role) { return this.p.font[role]; }
  get vw() { return this.p.vw; }
  get vh() { return this.p.vh; }
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 三个箭头标记（颜色与描边配套：muted / accent / link）。 */
export function defs() {
  return `    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${T.muted}"/></marker>
      <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${T.accent}"/></marker>
      <marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="${T.link}"/></marker>
    </defs>`;
}

/**
 * 节点盒（SKILL.md §6 完整模式）：
 *   ① 不透明纸色掩码 → ② 样式盒 → ③ 矩形类型标签（rx=2）→ ④ 节点名 → ⑤ 技术子标。
 * 节点名按宽度预算折行并垂直居中。
 */
export function nodeBox(ctx, o) {
  const {
    x, y, w, h, label, sub = '', tag = '', kind = 'step',
    align = 'middle', labelFill = T.ink,
  } = o;
  const st = KIND_STYLE[kind] ?? KIND_STYLE.step;
  const X = ctx.X(x);
  const Y = ctx.Y(y);
  const W = ctx.L(w);
  const H = ctx.L(h);
  const nodeSize = ctx.F('node');
  const subSize = ctx.F('sub');
  const tagSize = ctx.F('eyebrow');
  const inner = W - 24;
  const lines = wrapText(label, inner, nodeSize);
  const lineH = nodeSize + 4;
  const hasSub = sub !== '';
  const subLineCount = hasSub ? wrapText(sub, inner, subSize, true).length : 0;
  const blockH = lines.length * lineH + (hasSub ? subLineCount * (subSize + 2) + 2 : 0);
  let cursorY = Y + (H - blockH) / 2 + nodeSize;

  const parts = [];
  // ① 掩码
  parts.push(`    <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="6" fill="${T.paper}"/>`);
  // ② 盒体
  parts.push(
    `    <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="6" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.sw}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`,
  );
  // ③ 类型标签
  if (tag) {
    const tagW = Math.max(28, textWidth(tag.toUpperCase(), tagSize, true) + 12);
    parts.push(
      `    <rect x="${X + 8}" y="${Y + 6}" width="${ctx.L(tagW)}" height="12" rx="2" fill="transparent" stroke="${st.stroke}" stroke-opacity="0.40" stroke-width="0.8"/>`,
    );
    parts.push(
      `    <text x="${X + 8 + ctx.L(tagW) / 2}" y="${Y + 15}" fill="${st.stroke}" fill-opacity="0.8" font-size="${tagSize}" font-family="${FONT.mono}" text-anchor="middle" letter-spacing="0.08em">${esc(tag.toUpperCase())}</text>`,
    );
  }
  // ④ 节点名（可折行）
  const textX = align === 'middle' ? X + W / 2 : X + 12;
  const anchor = align === 'middle' ? 'middle' : 'start';
  for (const line of lines) {
    parts.push(
      `    <text x="${textX}" y="${cursorY}" fill="${labelFill}" font-size="${nodeSize}" font-weight="600" font-family="${FONT.sans}" text-anchor="${anchor}">${esc(line)}</text>`,
    );
    cursorY += lineH;
  }
  // ⑤ 技术子标（可折行：CJK 长子标必须换行，否则溢出盒外）
  if (hasSub) {
    const subLines = wrapText(sub, inner, subSize, true);
    for (const line of subLines) {
      parts.push(
        `    <text x="${textX}" y="${cursorY - 2}" fill="${T.muted}" font-size="${subSize}" font-family="${FONT.mono}" text-anchor="${anchor}">${esc(line)}</text>`,
      );
      cursorY += subSize + 2;
    }
  }
  return parts.join('\n');
}

/** 区域容器（faithful 档 >9 节点时必须分区）：paper-2 底 + 细边 + 左上角单色标签。 */
export function zone(ctx, o) {
  const { x, y, w, h, label = '' } = o;
  const X = ctx.X(x);
  const Y = ctx.Y(y);
  const W = ctx.L(w);
  const H = ctx.L(h);
  const parts = [
    `    <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="8" fill="${KIND_STYLE.zone.fill}" stroke="${KIND_STYLE.zone.stroke}" stroke-width="1"/>`,
  ];
  if (label) {
    parts.push(
      `    <text x="${X + 12}" y="${Y + 20}" fill="${T.soft}" font-size="${ctx.F('eyebrow')}" font-family="${FONT.mono}" letter-spacing="0.14em">${esc(label)}</text>`,
    );
  }
  return parts.join('\n');
}

/** 端点：盒边的某个位置。t = 沿该边的比例（0=起角，1=止角）。 */
export function attachPoint(rect, side, t = 0.5) {
  const { x, y, w, h } = rect;
  const c = Math.min(0.92, Math.max(0.08, t));
  switch (side) {
    case 'top': return { x: x + w * c, y };
    case 'bottom': return { x: x + w * c, y: y + h };
    case 'left': return { x, y: y + h * c };
    case 'right': return { x: x + w, y: y + h * c };
    default: throw new Error(`未知边：${side}`);
  }
}

/**
 * 共享边的出点分散（SKILL.md §6 规则 4）：
 * 同一节点的同一条边被多条连线占用时，按 k/(n+1) 均分，禁止两点重合。
 * 就地写回 edge.fromT / edge.toT。
 */
export function autoAttach(edges, rects) {
  const byFrom = new Map();
  const byTo = new Map();
  for (const e of edges) {
    const fk = `${e.from}|${e.fromSide}`;
    const tk = `${e.to}|${e.toSide}`;
    if (!byFrom.has(fk)) byFrom.set(fk, []);
    if (!byTo.has(tk)) byTo.set(tk, []);
    byFrom.get(fk).push(e);
    byTo.get(tk).push(e);
  }
  const spread = (groups, key) => {
    for (const list of groups.values()) {
      const n = list.length;
      list.forEach((e, i) => {
        const t = (i + 1) / (n + 1);
        e[key] = t;
      });
    }
  };
  spread(byFrom, 'fromT');
  spread(byTo, 'toT');
  return edges;
}

/** 圆角直角折线（SKILL.md §6 规则 1）：r=8 四分之一圆弧，禁止斜线。 */
export function elbowPoints(p1, p2, mode = 'hvh') {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (dx === 0 || dy === 0) return [p1, p2];
  return mode === 'vhv'
    ? [p1, { x: p1.x, y: (p1.y + p2.y) / 2 }, { x: p2.x, y: (p1.y + p2.y) / 2 }, p2]
    : [p1, { x: (p1.x + p2.x) / 2, y: p1.y }, { x: (p1.x + p2.x) / 2, y: p2.y }, p2];
}

export function elbowPath(p1, p2, { r = 8, mode = 'hvh' } = {}) {
  if (p1.x === p2.x || p1.y === p2.y) {
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }
  return roundedPolyline(elbowPoints(p1, p2, mode), r);
}

function roundedPolyline(pts, r) {
  const norm = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, len };
  };
  let d = `M ${round4(pts[0].x)} ${round4(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const t1 = norm(prev, cur);
    const t2 = norm(cur, next);
    const rr = Math.min(r, t1.len / 2, t2.len / 2);
    const start = { x: cur.x - t1.x * rr, y: cur.y - t1.y * rr };
    const end = { x: cur.x + t2.x * rr, y: cur.y + t2.y * rr };
    const cross = t1.x * t2.y - t1.y * t2.x;
    const sweep = cross > 0 ? 1 : 0;
    d += ` L ${round4(start.x)} ${round4(start.y)}`;
    d += ` A ${round4(rr)} ${round4(rr)} 0 0 ${sweep} ${round4(end.x)} ${round4(end.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${round4(last.x)} ${round4(last.y)}`;
  return d;
}

/**
 * 连线 + 箭头标签（SKILL.md §6 规则 2/3/5/6）：
 *   - 标签掩码与笔画之间保留 6–10px 可见缝（gap 参数，默认 8）。
 *   - `labelAt` 与 `from`/`to` 同一坐标系（母版坐标），内部做档位换算。
 *   - 标签遮罩用纸色，位于节点之间的空画布上。
 *   - kind 决定描边色与箭头标记。
 */
/**
 * 箭头标签掩码宽度：几何估算 + 16px 内边距 + **letter-spacing 的额外占位**。
 * letter-spacing 0.06em 会给每个字符再加 0.06em 宽 —— 不算进去的话，
 * 投屏档（12px 字号）的中文标签会撑出纸色掩码。
 */
function labelMaskWidth(label, size) {
  return textWidth(label, size, true) + 16 + Math.ceil(label.length * size * 0.07);
}

export function connector(ctx, o) {
  const {
    from, to, kind = 'default', label = '', labelAt = null, gap = 8,
    route = 'hvh', dash = null, marker = true, labelFill = T.paper,
    labelSide = 'auto', labelShift = null, via = null,
  } = o;
  const color = kind === 'accent' ? T.accent : kind === 'link' ? T.link : T.muted;
  const markerId = kind === 'accent' ? 'arrow-accent' : kind === 'link' ? 'arrow-link' : 'arrow';
  const p1 = { x: ctx.X(from.x), y: ctx.Y(from.y) };
  const p2 = { x: ctx.X(to.x), y: ctx.Y(to.y) };
  // via：指定折线的跨层位置（母版坐标）。多层依赖图里多条连线要在层间带里错层并行，
  // 否则它们会共用同一条水平段（SKILL §6 规则 3）。
  const pts = via
    ? (via.y !== undefined
      ? [p1, { x: p1.x, y: ctx.Y(via.y) }, { x: p2.x, y: ctx.Y(via.y) }, p2]
      : [p1, { x: ctx.X(via.x), y: p1.y }, { x: ctx.X(via.x), y: p2.y }, p2])
    : elbowPoints(p1, p2, route);
  const d = roundedPolyline(pts, 8);
  const parts = [
    `    <path d="${d}" fill="none" stroke="${color}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${markerId})"` : ''}/>`,
  ];
  if (label) {
    const size = ctx.F('arrow');
    const tw = labelMaskWidth(label, size);
    const maskH = size + 6;
    // 标签定位三原则（SKILL §6 规则 2）：
    //   ① 必须落在**路径实际存在的水平段**上，不能用两端算术中点（折线时中点在空白处）；
    //   ② labelAt 与 from/to 同一坐标系（母版坐标），内部只换算一次；
    //   ③ 文字必须完全落在纸色掩码内，掩码底边与笔画留 gap 可见缝。
    const hSegs = [];
    const vSegs = [];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.y === b.y) hSegs.push({ x1: a.x, x2: b.x, y: a.y });
      else if (a.x === b.x) vSegs.push({ x: a.x, y1: a.y, y2: b.y });
    }
    const anchor = labelAt ? { x: ctx.X(labelAt.x), y: ctx.Y(labelAt.y) } : null;
    let maskX;
    let maskY;
    if (hSegs.length > 0) {
      const seg = anchor
        ? hSegs.reduce((best, s) => (Math.abs(s.y - anchor.y) < Math.abs(best.y - anchor.y) ? s : best))
        : hSegs.reduce((best, s) => (Math.abs(s.x2 - s.x1) > Math.abs(best.x2 - best.x1) ? s : best));
      // ⚠️ 水平段可能从右往左（x1 > x2）⇒ 夹取必须用 min/max 归一
      const lo = Math.min(seg.x1, seg.x2);
      const hi = Math.max(seg.x1, seg.x2);
      const mx = anchor ? Math.min(Math.max(anchor.x, lo), hi) : (seg.x1 + seg.x2) / 2;
      maskX = mx - tw / 2;
      maskY = labelSide === 'below' ? seg.y + gap : seg.y - maskH - gap;
    } else if (vSegs.length > 0) {
      const seg = vSegs[0];
      const my = anchor ? anchor.y : (seg.y1 + seg.y2) / 2;
      // 纵向段：默认放线左侧（'right' 翻到右侧），文字始终在掩码内
      maskX = labelSide === 'right' ? seg.x + gap : seg.x - gap - tw;
      maskY = my - maskH / 2;
    } else {
      maskX = (p1.x + p2.x) / 2 - tw / 2;
      maskY = p1.y - maskH - gap;
    }
    // labelShift：母版坐标的微调量，用于把标签挪进空画布（单位母版 px）
    if (labelShift) {
      maskX += ctx.L(labelShift.x ?? 0);
      maskY += ctx.L(labelShift.y ?? 0);
    }
    const mX = Number.isFinite(maskX) ? round4(maskX) : 0;
    const mW = Number.isFinite(tw) ? round4(tw) : 0;
    parts.push(`    <rect x="${mX}" y="${round4(maskY)}" width="${mW}" height="${maskH}" rx="2" fill="${labelFill}"/>`);
    parts.push(`    <text x="${mX + mW / 2}" y="${round4(maskY + size)}" fill="${T.soft}" font-size="${size}" font-family="${FONT.mono}" text-anchor="middle" letter-spacing="0.06em">${esc(label)}</text>`);
  }
  return parts.join('\n');
}

/** 水平消息箭头（时序图用）：箭头在右端，标签在箭头上方并留 8px 缝。 */
export function message(ctx, o) {
  const { x1, x2, y, label = '', kind = 'default', dash = null, selfLoop = false } = o;
  const color = kind === 'accent' ? T.accent : kind === 'link' ? T.link : T.muted;
  const markerId = kind === 'accent' ? 'arrow-accent' : kind === 'link' ? 'arrow-link' : 'arrow';
  const X1 = ctx.X(x1);
  const X2 = ctx.X(x2);
  const Y = ctx.Y(y);
  const parts = [];
  if (selfLoop) {
    const w = ctx.L(28);
    const h = ctx.L(18);
    parts.push(
      `    <path d="M ${X1} ${Y} h ${w} v ${h} h ${-w}" fill="none" stroke="${color}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#${markerId})"/>`,
    );
    if (label) {
      const size = ctx.F('arrow');
      const tw = labelMaskWidth(label, size);
      const mX = round4(X1 + w / 2 - tw / 2);
      const mW = round4(tw);
      parts.push(`    <rect x="${mX}" y="${round4(Y + h + 8)}" width="${mW}" height="${size + 6}" rx="2" fill="${T.paper}"/>`);
      parts.push(`    <text x="${mX + mW / 2}" y="${round4(Y + h + 8 + size)}" fill="${T.soft}" font-size="${size}" font-family="${FONT.mono}" text-anchor="middle" letter-spacing="0.06em">${esc(label)}</text>`);
    }
    return parts.join('\n');
  }
  parts.push(
    `    <path d="M ${X1} ${Y} L ${X2} ${Y}" fill="none" stroke="${color}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ''} marker-end="url(#${markerId})"/>`,
  );
  if (label) {
    const size = ctx.F('arrow');
    const tw = labelMaskWidth(label, size);
    const mx = (X1 + X2) / 2;
    const maskH = size + 6;
    const mX = round4(mx - tw / 2);
    const mW = round4(tw);
    parts.push(`    <rect x="${mX}" y="${round4(Y - maskH - 8)}" width="${mW}" height="${maskH}" rx="2" fill="${T.paper}"/>`);
    parts.push(`    <text x="${mX + mW / 2}" y="${round4(Y - 8)}" fill="${T.soft}" font-size="${size}" font-family="${FONT.mono}" text-anchor="middle" letter-spacing="0.06em">${esc(label)}</text>`);
  }
  return parts.join('\n');
}

export function lifeline(ctx, o) {
  const { x, top, bottom, actor, sub = '', w = 120 } = o;
  const X = ctx.X(x);
  const parts = [];
  parts.push(
    `    <rect x="${round4(X - ctx.L(w) / 2)}" y="${ctx.Y(top)}" width="${ctx.L(w)}" height="${ctx.L(48)}" rx="6" fill="#ffffff" stroke="${T.ink}" stroke-width="1"/>`,
  );
  parts.push(
    `    <text x="${round4(X)}" y="${ctx.Y(top) + 22}" fill="${T.ink}" font-size="${ctx.F('node')}" font-weight="600" font-family="${FONT.sans}" text-anchor="middle">${esc(actor)}</text>`,
  );
  if (sub) {
    parts.push(
      `    <text x="${round4(X)}" y="${ctx.Y(top) + 38}" fill="${T.muted}" font-size="${ctx.F('sub')}" font-family="${FONT.mono}" text-anchor="middle">${esc(sub)}</text>`,
    );
  }
  parts.push(
    `    <path d="M ${round4(X)} ${ctx.Y(top + 48)} L ${round4(X)} ${ctx.Y(bottom)}" fill="none" stroke="${T.ruleSolid}" stroke-width="1" stroke-dasharray="4,4"/>`,
  );
  return parts.join('\n');
}

/** 时序图激活条：竖条，贴在生命线上。 */
export function activation(ctx, o) {
  const { x, top, height, w = 12 } = o;
  const X = round4(ctx.X(x) - ctx.L(w) / 2);
  return `    <rect x="${X}" y="${ctx.Y(top)}" width="${ctx.L(w)}" height="${ctx.L(height)}" rx="3" fill="rgba(45,49,66,0.08)" stroke="${T.muted}" stroke-width="1"/>`;
}

/** 泳道：竖条背景 + 左侧标签栏。 */
export function lane(ctx, o) {
  const { x, y, w, h, label, index = 0 } = o;
  const X = ctx.X(x);
  const Y = ctx.Y(y);
  const W = ctx.L(w);
  const H = ctx.L(h);
  const fill = index % 2 === 0 ? 'rgba(45,49,66,0.03)' : 'rgba(45,49,66,0.015)';
  const parts = [
    `    <rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="6" fill="${fill}" stroke="${T.rule}" stroke-width="1"/>`,
  ];
  if (label) {
    const size = ctx.F('node');
    const lines = wrapText(label, ctx.L(96), size);
    let cy = Y + H / 2 - ((lines.length - 1) * (size + 4)) / 2 + size;
    for (const line of lines) {
      parts.push(
        `    <text x="${round4(X + 16)}" y="${round4(cy)}" fill="${T.ink}" font-size="${size}" font-weight="600" font-family="${FONT.sans}">${esc(line)}</text>`,
      );
      cy += size + 4;
    }
  }
  return parts.join('\n');
}

/** 底部图例：横向条带 + 细线分隔（SKILL.md §6 末段）。 */
export function legend(ctx, items) {
  if (!items || items.length === 0) return '';
  const y = ctx.p.legendTop;
  const size = ctx.F('eyebrow');
  const parts = [
    `    <line x1="40" y1="${y - 8}" x2="${ctx.vw - 40}" y2="${y - 8}" stroke="${T.rule}" stroke-width="0.8"/>`,
    `    <text x="40" y="${y + 8}" fill="${T.muted}" font-size="${size}" font-family="${FONT.mono}" letter-spacing="0.14em">LEGEND</text>`,
  ];
  let x = 40 + ctx.L(72);
  for (const it of items) {
    const sw = it.kind && KIND_STYLE[it.kind] ? KIND_STYLE[it.kind] : null;
    const fill = sw ? sw.fill : it.fill ?? T.paper;
    const stroke = sw ? sw.stroke : it.stroke ?? T.muted;
    const dash = sw && sw.dash ? ` stroke-dasharray="${sw.dash}"` : '';
    parts.push(
      `    <rect x="${round4(x)}" y="${round4(y - 1)}" width="16" height="10" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash}/>`,
    );
    parts.push(
      `    <text x="${round4(x + 24)}" y="${round4(y + 8)}" fill="${T.muted}" font-size="${size}" font-family="${FONT.mono}" letter-spacing="0.06em">${esc(it.label)}</text>`,
    );
    x += 24 + textWidth(it.label, size, true) + 36;
  }
  return parts.join('\n');
}

/**
 * 组装完整 <svg>：无障碍契约（role=img + aria-labelledby + 首个 <title> + <desc>，
 * ID 按图与档位加前缀），箭头先画、节点后画。
 */
export function svgDoc(o) {
  const { slug, preset, title, desc, body, legendItems = [] } = o;
  const ctx = new Ctx(preset);
  const prefix = `${slug}-${preset}`;
  const idTitle = `${prefix}-title`;
  const idDesc = `${prefix}-desc`;
  return `    <svg viewBox="0 0 ${ctx.vw} ${ctx.vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${idTitle} ${idDesc}">
      <title id="${idTitle}">${esc(title)}</title>
      <desc id="${idDesc}">${esc(desc)}</desc>
${defs()}

      <rect width="100%" height="100%" fill="${T.paper}"/>

${body}

${legend(ctx, legendItems)}
    </svg>`;
}

/** 节点盒的锚点（连线起点/终点用），供 connector 使用。 */
export function portOf(rect, side, t = 0.5) {
  const p = attachPoint(rect, side, t);
  return { x: p.x, y: p.y };
}

/** 编辑批注（SKILL.md §6 可选原语）：Instrument Serif 斜体，斜杠线引出。 */
export function callout(ctx, o) {
  const { x, y, text, maxWidth = 320, anchor = 'start' } = o;
  const size = 14;
  const lines = wrapText(text, maxWidth, size, false);
  const parts = [];
  lines.forEach((line, i) => {
    parts.push(
      `    <text x="${round4(ctx.X(x))}" y="${round4(ctx.Y(y) + i * (size + 6))}" fill="${T.muted}" font-size="${size}" font-style="italic" font-family="${FONT.serif}" text-anchor="${anchor}">${esc(line)}</text>`,
    );
  });
  return parts.join('\n');
}
