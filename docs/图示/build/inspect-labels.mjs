// 一次性探针：把「箭头标签 ↔ 掩码 ↔ 笔画 ↔ 节点盒」的几何关系打出来，用于定位版面问题。
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = resolve('docs', '图示', process.argv[2]);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1400 } });
await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const dump = await page.evaluate(() => {
  const svg = document.querySelector('svg');
  const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };
  const rects = Array.from(svg.querySelectorAll('rect'));
  const paper = rects.filter((r) => (r.getAttribute('fill') || '').toLowerCase() === '#f5f5f5' && num(r.getAttribute('height')) !== null);
  const masks = paper.filter((r) => num(r.getAttribute('height')) <= 20 && num(r.getAttribute('width')) < 400);
  const nodes = rects.filter((r) => r.getAttribute('stroke') && num(r.getAttribute('width')) > 40 && num(r.getAttribute('height')) > 20);
  const paths = Array.from(svg.querySelectorAll('path')).filter((p) => p.getAttribute('marker-end'));
  const texts = Array.from(svg.querySelectorAll('text')).filter((t) =>
    (t.getAttribute('fill') || '').toLowerCase() === '#7a8399'
    && (t.getAttribute('font-family') || '').includes('Geist Mono')
    && t.getAttribute('fill-opacity') === null);
  const bb = (el) => { const b = el.getBBox(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const out = [];
  for (const t of texts) {
    const tb = bb(t);
    const m = masks.find((r) => { const b = r.getBBox(); return b.x <= tb.x + 1 && b.x + b.width >= tb.x + tb.w - 1 && b.y <= tb.y + 1 && b.y + b.height >= tb.y + tb.h - 4; });
    const mb = m ? bb(m) : null;
    let near = [];
    for (const p of paths) {
      const len = p.getTotalLength();
      const n = Math.max(20, Math.ceil(len / 5));
      let best = Infinity; let bestPt = null;
      for (let k = 0; k <= n; k += 1) {
        const pt = p.getPointAtLength((len * k) / n);
        if (mb && pt.x >= mb.x - 2 && pt.x <= mb.x + mb.w + 2 && pt.y >= mb.y + mb.h - 1) {
          const d = pt.y - (mb.y + mb.h);
          if (d < best) { best = d; bestPt = { x: Math.round(pt.x), y: Math.round(pt.y) }; }
        }
      }
      if (best !== Infinity) near.push({ gap: Math.round(best * 10) / 10, at: bestPt, d: (p.getAttribute('d') || '').slice(0, 40) });
    }
    const hits = [];
    if (mb) {
      for (const n of nodes) {
        const nb = bb(n);
        const ox = Math.min(mb.x + mb.w, nb.x + nb.w) - Math.max(mb.x, nb.x);
        const oy = Math.min(mb.y + mb.h, nb.y + nb.h) - Math.max(mb.y, nb.y);
        if (ox > 1 && oy > 1) hits.push({ node: nb, overlapX: Math.round(ox), overlapY: Math.round(oy) });
      }
    }
    out.push({ label: (t.textContent || '').trim(), text: tb, mask: mb, near, hits });
  }
  return out;
});
for (const d of dump) {
  console.log('标签「' + d.label + '」');
  console.log('   文字 ' + JSON.stringify(d.text) + '  掩码 ' + JSON.stringify(d.mask));
  for (const n of d.near) console.log('   笔画 ' + JSON.stringify(n.at) + ' 距掩码底 ' + n.gap + 'px  ' + n.d);
  for (const h of d.hits) console.log('   ✗ 压住节点 ' + JSON.stringify(h.node) + ' 重叠 ' + h.overlapX + '×' + h.overlapY);
}
await browser.close();
