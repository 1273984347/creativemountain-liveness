// 把图集 HTML 渲染成 PNG，供人工目视复核（SKILL §9 的「渲染后自查」）。
//
// 用法：node docs/图示/build/shoot.mjs [--only 关键字]
// 产物：docs/图示/assets/<同名>.png（只截 <svg>，不含页眉页脚；另有 -page.png 全页）
//
// 为什么单独写脚本：图集的每一处改动都是**视觉**改动，探针数字不能代替看图。
// 本脚本只做「把浏览器真实渲染结果搬成 PNG」，判断留给看图的人。

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = resolve('docs', '图示');
const OUT = join(DIR, 'assets');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => (only ? f.includes(only) : true))
  .sort();

if (files.length === 0) {
  console.error('没有待截图的 HTML');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
for (const f of files) {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1400 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(pathToFileURL(join(DIR, f)).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const svg = await page.$('svg');
  const base = f.replace(/\.html$/, '');
  await svg.screenshot({ path: join(OUT, base + '.png') });
  await page.screenshot({ path: join(OUT, base + '-page.png'), fullPage: true });
  // 量测：节点盒与图例的实际外框（判「有没有溢出/压线」的第一手数字）
  const metrics = await page.evaluate(() => {
    const svgEl = document.querySelector('svg');
    const vb = svgEl.viewBox.baseVal;
    const out = { viewBox: [vb.width, vb.height], texts: svgEl.querySelectorAll('text').length, overflow: [] };
    for (const t of svgEl.querySelectorAll('text')) {
      const bb = t.getBBox();
      if (bb.x < 0 || bb.y < 0 || bb.x + bb.width > vb.width || bb.y + bb.height > vb.height) {
        out.overflow.push({ text: (t.textContent || '').slice(0, 24), x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) });
      }
    }
    return out;
  });
  console.log(`✓ ${base}.png  文本 ${metrics.texts} 个 · 溢出 ${metrics.overflow.length} 处${errors.length ? ' · 控制台错误 ' + errors.length : ''}`);
  for (const o of metrics.overflow.slice(0, 8)) console.log('    ⚠ 越界: ' + JSON.stringify(o));
  for (const e of errors.slice(0, 3)) console.log('    ⚠ ' + e);
  await page.close();
}
await browser.close();
console.log(`
共截图 ${files.length} 份。`);
