// 图集统一验收 —— 把 SKILL.md §9 品味门禁里**能机器判**的部分逐份判掉。
//
// 用法：node docs/图示/build/verify.mjs [--only <文件名片段>]
// 退出码：0 全过；1 有硬失败（硬失败清单打印在末尾）。
//
// ⚠️ 本脚本只判「机器能判的」：结构契约、无障碍、几何（正交/留缝/不压盒）、
//    栅格、预算、两档一致性。**版面好不好看仍要人看渲染图** ——
//    探针全绿不等于图能看（见 shoot.mjs 与 docs/图示/README.md 的自检说明）。
//
// 判定口径（每条都对应 SKILL.md 的明文要求，不自创标准）：
//   §12 无障碍 SVG 契约：role=img / aria-labelledby 可解析 / title 是首个子元素 / desc 非空 / ID 带图与档前缀
//   §6 规则 1：连线必须是正交（每段水平或垂直），禁止斜线
//   §6 规则 2：箭头标签掩码底边与笔画之间留 ≥6px 可见缝
//   §6 规则 6：标签掩码不得与节点盒重叠
//   §7 栅格：坐标/盒宽高为 4 的倍数（描边宽度、透明度、图例条带除外）
//   §7 预算：节点 ≤9、连线 ≤12、橘红 ≤2、图例 ≤5、批注 ≤2
//   §3 档位：viewBox 与档位一致；字号梯级与档位一致（标准 12/9/8 vs 投屏 16/12/12）
//   §5 字体：无 JetBrains Mono；中文挂 CJK 回退
//   两档一致：同一张图的两档，节点/连线/图例/文本集合必须一致

import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = resolve('docs', '图示');
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

const PRESET_OF = (name) => (name.includes('-投屏档') ? 'slide-16x9' : 'doc-inline');
const EXPECT = {
  'doc-inline': { vw: 960, vh: 600, node: 12, sub: 9, arrow: 8 },
  'slide-16x9': { vw: 1280, vh: 720, node: 16, sub: 12, arrow: 12 },
};

/** 页面内执行的全部检查，返回结构化结果。 */
const PAGE_CHECK = (preset) => {
  const out = { fail: [], warn: [], info: {} };
  const svg = document.querySelector('svg');
  if (!svg) { out.fail.push('没有 <svg>'); return out; }
  const exp = preset === 'slide-16x9'
    ? { vw: 1280, vh: 720, node: 16, sub: 12, arrow: 12 }
    : { vw: 960, vh: 600, node: 12, sub: 9, arrow: 8 };
  const px = (v) => Number.parseFloat(v);

  // ── viewBox 与档位 ──────────────────────────────────────────
  const vb = svg.viewBox.baseVal;
  if (vb.width !== exp.vw || vb.height !== exp.vh) {
    out.fail.push(`viewBox ${vb.width}×${vb.height} 与档位 ${preset} 期望 ${exp.vw}×${exp.vh} 不符`);
  }

  // ── 无障碍 SVG 契约（SKILL §12）──────────────────────────────
  if (svg.getAttribute('role') !== 'img') out.fail.push('svg 缺 role="img"');
  const labelled = (svg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (labelled.length < 2) out.fail.push('aria-labelledby 未同时命名 title 与 desc');
  for (const id of labelled) {
    if (!document.getElementById(id)) out.fail.push(`aria-labelledby 指向不存在的 id: ${id}`);
  }
  const titleEl = svg.querySelector('title');
  const descEl = svg.querySelector('desc');
  if (!titleEl || !(titleEl.textContent || '').trim()) out.fail.push('<title> 缺失或为空');
  if (!descEl || !(descEl.textContent || '').trim()) out.fail.push('<desc> 缺失或为空');
  if (svg.firstElementChild && svg.firstElementChild.tagName.toLowerCase() !== 'title') {
    out.fail.push('<title> 不是 <svg> 的首个子元素');
  }
  for (const el of svg.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    if (id === 'title' || id === 'desc') out.fail.push(`裸 id ${id}（两图同页会撞车）`);
    const inDefs = el.closest('defs') !== null;
    if (!id.includes('-') && !inDefs) out.fail.push(`id ${id} 未带图与档前缀`);
    if (inDefs && !id.includes('-')) out.warn.push(`defs 内 id ${id} 未带前缀：两图内联同一页时 marker 会撞车`);
  }

  // ── 收集元素 ────────────────────────────────────────────────
  const all = Array.from(svg.querySelectorAll('rect, path, text, line'));
  const num = (v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const isPaper = (r) => (r.getAttribute('fill') || '').toLowerCase() === '#f5f5f5';

  // 节点掩码 = 纸色且高 > 20；标签掩码 = 纸色且高 ≤ 20
  const paperRects = all.filter((r) => r.tagName === 'rect' && isPaper(r) && num(r.getAttribute('height')) !== null);
  const nodeMasks = paperRects.filter((r) => num(r.getAttribute('height')) > 20);
  const labelMasks = paperRects.filter((r) => num(r.getAttribute('height')) <= 20 && num(r.getAttribute('width')) < 400);
  // 节点盒体 = 有 stroke 且宽 > 40 的矩形（排除图例小色块 16×10 与 tag 标签）
  const nodeRects = all.filter((r) => r.tagName === 'rect' && r.getAttribute('stroke') && num(r.getAttribute('width')) > 40 && num(r.getAttribute('height')) > 20);
  const connectors = all.filter((r) => r.tagName === 'path' && r.getAttribute('marker-end'));
  const lifelines = all.filter((r) => r.tagName === 'path' && !r.getAttribute('marker-end') && r.getAttribute('stroke-dasharray') === '4,4');
  const zoneRects = all.filter((r) => r.tagName === 'rect' && (r.getAttribute('fill') || '').toLowerCase() === '#ececec');
  const texts = Array.from(svg.querySelectorAll('text'));

  out.info.nodes = nodeRects.length;
  out.info.edges = connectors.length;
  out.info.zones = zoneRects.length;
  out.info.labelMasks = labelMasks.length;

  // ── 橘红预算（SKILL §7：≤2）─────────────────────────────────
  const accentEls = all.filter((el) => {
    const s = (el.getAttribute('stroke') || '').toLowerCase();
    const f = (el.getAttribute('fill') || '').toLowerCase();
    return s === '#eb6c36' || f === '#eb6c36' || s === 'rgba(235,108,54,0.50)';
  });
  // 边框含橘红但底色不是橘红的 ⇒ 一个「橘红元素」；纯橘红描边的小 tag 不单算
  const accentNodes = nodeRects.filter((r) => (r.getAttribute('stroke') || '').toLowerCase() === '#eb6c36');
  if (accentNodes.length > 2) out.fail.push(`橘红节点 ${accentNodes.length} 个 > 2（SKILL §7）`);
  if (accentEls.length > 24) out.warn.push(`橘红相关元素 ${accentEls.length} 个，确认没有滥用`);

  // ── 正交性（SKILL §6 规则 1）────────────────────────────────
  const nonOrtho = [];
  for (const p of connectors) {
    const d = p.getAttribute('d') || '';
    const toks = d.match(/[MLAZ]|-?\d+(\.\d+)?/g) || [];
    let i = 0;
    let cx = null; let cy = null;
    while (i < toks.length) {
      const cmd = toks[i];
      if (cmd === 'M' || cmd === 'L') {
        const x = Number.parseFloat(toks[i + 1]);
        const y = Number.parseFloat(toks[i + 2]);
        if (cx !== null && x !== cx && y !== cy) nonOrtho.push(d.slice(0, 90));
        cx = x; cy = y;
        i += 3;
      } else if (cmd === 'A') {
        // 圆弧：端点相对当前点必然是斜的（这就是圆角），不判；只更新当前点
        const x = Number.parseFloat(toks[i + 6]);
        const y = Number.parseFloat(toks[i + 7]);
        cx = x; cy = y;
        i += 8;
      } else {
        i += 1;
      }
    }
  }
  if (nonOrtho.length > 0) out.fail.push(`${nonOrtho.length} 条连线含斜段（SKILL §6 规则 1）：${nonOrtho[0]}`);

  // ── 连线不得共享同一笔路径（SKILL §6 规则 3）──────────────────
  const seen = new Map();
  for (const p of connectors) {
    const d = p.getAttribute('d') || '';
    if (seen.has(d)) { out.fail.push('两条连线共用同一笔路径（SKILL §6 规则 3）'); break; }
    seen.set(d, true);
  }

  // ── 箭头标签留缝（SKILL §6 规则 2）───────────────────────────
  // 标签 = mono + soft 色 + 箭头档字号
  const labelTexts = texts.filter((t) => {
    const fill = (t.getAttribute('fill') || '').toLowerCase();
    const fam = (t.getAttribute('font-family') || '');
    const fs = Number.parseFloat(t.getAttribute('font-size') || '0');
    return fill === '#7a8399' && fam.includes('Geist Mono') && fs === exp.arrow && t.getAttribute('fill-opacity') === null;
  });
  const pathSamples = connectors.map((p) => {
    const len = p.getTotalLength();
    const n = Math.max(24, Math.ceil(len / 6));
    const pts = [];
    for (let k = 0; k <= n; k += 1) {
      const pt = p.getPointAtLength((len * k) / n);
      pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  });
  for (const t of labelTexts) {
    const tb = t.getBBox();
    // 找包含它的掩码
    const mask = labelMasks.find((m) => {
      const mb = m.getBBox();
      // 下伸部（descender）探出掩码 4px 内属正常排版，不算缺掩码
      return mb.x <= tb.x + 1 && mb.x + mb.width >= tb.x + tb.width - 1 && mb.y <= tb.y + 1 && mb.y + mb.height >= tb.y + tb.height - 4;
    });
    if (!mask) { out.fail.push(`箭头标签「${(t.textContent || '').slice(0, 16)}」没有纸色掩码`); continue; }
    const mb = mask.getBBox();
    // 掩码下方最近的笔画点（只看横向落在掩码 x 区间内的点）
    let minGap = Infinity;
    for (const pts of pathSamples) {
      for (const pt of pts) {
        if (pt.x >= mb.x - 2 && pt.x <= mb.x + mb.width + 2 && pt.y >= mb.y + mb.height - 1) {
          minGap = Math.min(minGap, pt.y - (mb.y + mb.height));
        }
      }
    }
    if (minGap !== Infinity && minGap < 6) {
      out.fail.push(`箭头标签「${(t.textContent || '').slice(0, 16)}」与笔画只隔 ${minGap.toFixed(1)}px < 6px（SKILL §6 规则 2）`);
    }
    // 规则 6：掩码不得压在节点盒上
    for (const nr of nodeRects) {
      const nb = nr.getBBox();
      const ox = Math.min(mb.x + mb.width, nb.x + nb.width) - Math.max(mb.x, nb.x);
      const oy = Math.min(mb.y + mb.height, nb.y + nb.height) - Math.max(mb.y, nb.y);
      if (ox > 1 && oy > 1) {
        out.fail.push(`箭头标签「${(t.textContent || '').slice(0, 16)}」的掩码压住节点盒（SKILL §6 规则 6）`);
        break;
      }
    }
  }

  // ── 4px 栅格（SKILL §7）：节点盒与连线坐标 ────────────────────
  const offGrid = [];
  const checkGrid = (el) => {
    for (const attr of ['x', 'y', 'width', 'height', 'cx', 'cy']) {
      const v = el.getAttribute && el.getAttribute(attr);
      const n = num(v);
      if (n !== null && Math.abs(n % 4) > 0.001) offGrid.push(`${el.tagName}.${attr}=${n}`);
    }
  };
  nodeRects.forEach(checkGrid);
  for (const p of connectors) {
    const d = p.getAttribute('d') || '';
    const toks = d.match(/[MLAZ]|-?\d+(\.\d+)?/g) || [];
    for (let i = 0; i < toks.length;) {
      const cmd = toks[i];
      if (cmd === 'M' || cmd === 'L') {
        [toks[i + 1], toks[i + 2]].forEach((s) => {
          const n = Number.parseFloat(s);
          if (Math.abs(n % 4) > 0.001) offGrid.push(`path d 坐标 ${n}`);
        });
        i += 3;
      } else if (cmd === 'A') {
        // 只查终点坐标；旋角与两个标志位（0/1）不是坐标
        [toks[i + 6], toks[i + 7]].forEach((s) => {
          const n = Number.parseFloat(s);
          if (Math.abs(n % 4) > 0.001) offGrid.push(`path d 坐标 ${n}`);
        });
        i += 8;
      } else {
        i += 1;
      }
    }
  }
  if (offGrid.length > 0) out.fail.push(`${offGrid.length} 处坐标不在 4px 栅格上（SKILL §7）：${offGrid.slice(0, 3).join('、')}`);

  // ── 字号梯级（SKILL §3 / output-spec §2）────────────────────
  const sizes = texts.map((t) => Number.parseFloat(t.getAttribute('font-size') || '0'));
  const allowed = new Set([exp.node, exp.sub, exp.arrow, 8, 14]);
  const bad = sizes.filter((s) => !allowed.has(s));
  if (bad.length > 0) out.fail.push(`出现档位外的字号：${[...new Set(bad)].join('、')}`);

  // ── 字体：禁 JetBrains Mono；中文须有 CJK 回退 ───────────────
  const html = document.documentElement.outerHTML;
  if (html.includes('JetBrains Mono')) out.fail.push('出现 JetBrains Mono（SKILL §5）');
  if (!html.includes('Noto Sans SC')) out.fail.push('未挂 Noto Sans SC 中文字体回退');
  const sansTexts = texts.filter((t) => (t.getAttribute('font-family') || '').includes('Geist'));
  for (const t of sansTexts) {
    const fam = t.getAttribute('font-family') || '';
    if (!fam.includes('Noto Sans SC') && /[\u4e00-\u9fff]/.test(t.textContent || '')) {
      out.fail.push(`中文文本「${(t.textContent || '').slice(0, 12)}」的字体栈缺 CJK 回退`);
      break;
    }
  }

  // ── 样式禁令 ────────────────────────────────────────────────
  if (html.includes('box-shadow')) out.fail.push('出现 box-shadow（SKILL §4 禁用阴影）');
  if (html.includes('writing-mode')) out.fail.push('出现 writing-mode（SKILL §6 禁竖排字）');
  if (html.includes('font-style:italic') && /<text[^>]*font-style="italic"/.test(html)) {
    // 批注用衬线斜体是允许的（primitive-annotation），仅提示
  }

  // ── 图例条带位置（SKILL §6 末段：底部横向条带）──────────────
  const legendText = texts.filter((t) => (t.textContent || '').trim() === 'LEGEND');
  if (legendText.length !== 1) {
    out.fail.push(`图例标题数 ${legendText.length}（应为 1）`);
  } else {
    const lb = legendText[0].getBBox();
    const legendY = legendText[0].getAttribute('y');
    if (legendY !== null && Number.parseFloat(legendY) < exp.vh * 0.6) {
      out.fail.push(`图例不在底部条带（y=${legendY}）`);
    }
    if (legendText[0].getAttribute('x') !== '40') out.fail.push('图例左边距不是 40px');
  }
  const legendItems = all.filter((r) => r.tagName === 'rect' && num(r.getAttribute('width')) === 16 && num(r.getAttribute('height')) === 10);
  if (legendItems.length > 5) out.fail.push(`图例项 ${legendItems.length} > 5（SKILL §7）`);
  const legendYs = new Set(legendItems.map((r) => r.getAttribute('y')));
  if (legendItems.length > 1 && legendYs.size > 1) out.fail.push('图例不是同一条横向条带');

  // ── 批注预算（≤2）───────────────────────────────────────────
  const italicLines = texts.filter((t) => (t.getAttribute('font-style') || '') === 'italic');
  // 同一处批注的多行：x 相同且 y 间隔 < 24px ⇒ 归一组
  const groups = [];
  for (const t of italicLines) {
    const x = Number.parseFloat(t.getAttribute('x') || '0');
    const y = Number.parseFloat(t.getAttribute('y') || '0');
    const g = groups.find((gp) => Math.abs(gp.x - x) < 2 && y >= gp.yTop - 6 && y <= gp.yTop + 60);
    if (g) { g.n += 1; g.yTop = Math.max(g.yTop, y); } else { groups.push({ x, yTop: y, n: 1 }); }
  }
  if (groups.length > 2) out.fail.push(`批注 ${groups.length} 处 > 2（SKILL §7）`);

  // ── 预算（SKILL §7）─────────────────────────────────────────
  if (nodeRects.length > 9) out.fail.push(`节点 ${nodeRects.length} 个 > 9（SKILL §7）`);
  if (connectors.length > 12) out.fail.push(`连线 ${connectors.length} 条 > 12（SKILL §7）`);

  // ── 文本集合（供两档一致性比对）──────────────────────────────
  out.info.texts = texts.map((t) => (t.textContent || '').trim()).filter((s) => s !== '');
  out.info.nodeCount = nodeRects.length;
  out.info.edgeCount = connectors.length;
  out.info.legendCount = legendItems.length;
  out.info.lifelines = lifelines.length;
  return out;
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.html')).filter((f) => (only ? f.includes(only) : true)).sort();
if (files.length === 0) { console.error('没有可验收的 HTML'); process.exit(1); }

const browser = await chromium.launch({ headless: true });
const results = new Map();
for (const f of files) {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1400 } });
  await page.goto(pathToFileURL(join(DIR, f)).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(PAGE_CHECK, PRESET_OF(f));
  results.set(f, r);
  const tag = r.fail.length === 0 ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${f}  节点 ${r.info.nodeCount} · 连线 ${r.info.edgeCount} · 图例 ${r.info.legendCount} · 生命线 ${r.info.lifelines}`);
  for (const x of r.fail) console.log('    ✗ ' + x);
  for (const x of r.warn) console.log('    ! ' + x);
  await page.close();
}
await browser.close();

// ── 两档一致性：同一张图的两档，文本集合与结构必须一致 ──────────
const byFigure = new Map();
for (const f of files) {
  const base = f.replace(/-文档档\.html$/, '').replace(/-投屏档\.html$/, '');
  if (!byFigure.has(base)) byFigure.set(base, []);
  byFigure.get(base).push(f);
}
for (const [base, list] of byFigure) {
  if (list.length < 2) continue;
  const a = results.get(list.find((f) => f.includes('-文档档')));
  const b = results.get(list.find((f) => f.includes('-投屏档')));
  if (!a || !b) continue;
  const setA = a.info.texts.join('').replace(/\s+/g, '');
  const setB = b.info.texts.join('').replace(/\s+/g, '');
  if (setA !== setB) {
    const onlyA = a.info.texts.filter((t) => !b.info.texts.includes(t));
    const onlyB = b.info.texts.filter((t) => !a.info.texts.includes(t));
    console.log(`FAIL  ${base}：两档文本集合不一致`);
    console.log('    ✗ 仅文档档有: ' + onlyA.slice(0, 6).join(' / '));
    console.log('    ✗ 仅投屏档有: ' + onlyB.slice(0, 6).join(' / '));
  } else if (a.info.nodeCount !== b.info.nodeCount || a.info.edgeCount !== b.info.edgeCount) {
    console.log(`FAIL  ${base}：两档结构数不一致（节点/连线）`);
  } else {
    console.log(`PASS  ${base}：两档一致（${a.info.nodeCount} 节点 / ${a.info.edgeCount} 连线）`);
  }
}

let hard = 0;
for (const [, r] of results) hard += r.fail.length;
console.log(`\n验收 ${files.length} 份产物，硬失败 ${hard} 项。`);
process.exit(hard > 0 ? 1 : 0);
