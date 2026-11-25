// 图集构建器 —— 把 figures/*.mjs 的母版坐标渲染成 8×2 份自包含 HTML。
//
// 用法：node docs/图示/build/diagram-build.mjs [--only <slug>]
//
// 产出（docs/图示/）：
//   NN-图名-文档档.html   doc-inline 档（960×600，贴 README / 规格正文）
//   NN-图名-投屏档.html   slide-16x9 档（1280×720，评审与投屏）
//
// 契约：figures/*.mjs 导出 default 对象，含 render(ctx) ⇒ SVG 片段。
//   ctx 是 svg-kit 的 Ctx（母版坐标 → 档位坐标的换算 + 字号梯级）。
//   **只画图，别在 render 里写 HTML** —— 外壳由本文件统一生成，
//   这样两档之间的字体、页眉、页脚、无障碍契约才不会漂移。
//
// ⚠️ 产物是生成物：改图改 figures/*.mjs，然后重跑本脚本。

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ctx, FONT, PRESETS, svgDoc } from './svg-kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..');
const FIGURE_DIR = join(HERE, 'figures');

const PRESET_ORDER = ['doc-inline', 'slide-16x9'];
const PRESET_SUFFIX = { 'doc-inline': '文档档', 'slide-16x9': '投屏档' };

/** 单文件 HTML 外壳（SKILL.md §12：自包含，仅外链 Google Fonts）。 */
function htmlShell(fig, presetKey, svg) {
  const p = PRESETS[presetKey];
  const fontLink =
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@400;600&display=swap';
  const width = presetKey === 'doc-inline' ? 960 : 1280;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fig.title} · 创界山·活人认证</title>
  <link href="${fontLink}" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --color-paper: #f5f5f5;
      --color-ink: #2d3142;
      --color-muted: #4f5d75;
      --color-accent: #eb6c36;
      --font-sans: ${FONT.sans};
      --font-serif: ${FONT.serif};
      --font-mono: ${FONT.mono};
    }
    body {
      font-family: var(--font-sans);
      background: var(--color-paper);
      color: var(--color-ink);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2.5rem 2rem;
    }
    .frame { max-width: ${width + 240}px; width: 100%; }
    .eyebrow {
      font-family: var(--font-mono);
      font-size: 0.66rem;
      font-weight: 500;
      letter-spacing: 0.18em;
      color: var(--color-muted);
      margin-bottom: 0.5rem;
    }
    h1 {
      font-family: var(--font-serif);
      font-size: clamp(1.5rem, 2.2vw + 0.75rem, ${presetKey === 'doc-inline' ? '2rem' : '2.6rem'});
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: var(--color-ink);
      margin-bottom: 0.6rem;
    }
    .tagline {
      font-size: 0.95rem;
      color: var(--color-muted);
      max-width: 62ch;
      margin-bottom: 1.5rem;
      line-height: 1.6;
    }
    svg { width: 100%; min-width: ${width}px; display: block; }
    footer {
      margin-top: 1.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(45,49,66,0.12);
      font-family: var(--font-mono);
      font-size: 0.66rem;
      letter-spacing: 0.08em;
      color: var(--color-muted);
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">${fig.eyebrow} · 创界山·活人认证</p>
    <h1>${fig.title}</h1>
    <p class="tagline">${fig.subtitle}</p>

${svg}

    <footer>
      <span>创界山·活人认证 · 图集 ${fig.index}/${fig.total} · ${fig.typeLabel}</span>
      <span>${p.footer} · diagram-design v2.6</span>
    </footer>
  </div>
</body>
</html>
`;
}

/** 载入全部图模块（按 index 排序）。 */
const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

async function loadFigures() {
  const all = readdirSync(FIGURE_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const files = only ? all.filter((f) => f.includes(only)) : all;
  const out = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(FIGURE_DIR, f)).href);
      out.push({ file: f, fig: mod.default });
    } catch (err) {
      console.error(`✗ 跳过 ${f}：${err.message.split('\n')[0]}`);
    }
  }
  return out;
}

const loaded = await loadFigures();
const figs = loaded
  .map(({ file, fig }) => ({ ...fig, file }))
  .filter((f) => (only ? f.slug === only : true))
  .sort((a, b) => String(a.index).localeCompare(String(b.index)));

if (figs.length === 0) {
  console.error(`没有可构建的图（--only ${only}）`);
  process.exit(1);
}

let count = 0;
for (const fig of figs) {
  for (const presetKey of PRESET_ORDER) {
    const ctx = new Ctx(presetKey);
    const body = fig.render(ctx);
    const svg = svgDoc({
      slug: fig.slug,
      preset: presetKey,
      title: fig.title,
      desc: fig.desc,
      body,
      legendItems: fig.legend ?? [],
    });
    const file = join(OUT_DIR, `${fig.index}-${fig.name}-${PRESET_SUFFIX[presetKey]}.html`);
    writeFileSync(file, htmlShell(fig, presetKey, svg), 'utf8');
    console.log(`✓ ${fig.index}-${fig.name}-${PRESET_SUFFIX[presetKey]}.html`);
    count += 1;
  }
}
console.log(`\n共写出 ${count} 份产物。`);
