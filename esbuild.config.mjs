// 单文件构建（规格 §6.6）：引擎 + UI + 主题数据内联进一个 HTML，双击即玩、离线可用。
//
// 注意：**esbuild 不做类型检查**（实施计划 §0.1 规则 1）。
// 类型门禁由 `npm run typecheck`（tsc --noEmit）独立承担，
// `npm run build` 的顺序是「先 tsc 通过 → 再 esbuild」，红色即中断。

import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// esbuild.config.mjs 位于项目根，here 即 root
const root = here;

await mkdir(resolve(root, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'web/main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  write: false,
  charset: 'utf8',
  legalComments: 'none',
  loader: { '.json': 'json' },
});

const js = result.outputFiles[0].text;

// 样式外置到 web/styles.css，构建时内联进单文件。
const css = await readFile(resolve(root, 'web/styles.css'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>创界山·活人认证</title>
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
${js}
</script>
</body>
</html>`;

const outPath = resolve(root, 'dist/创界山-活人认证.html');
await writeFile(outPath, html, 'utf8');
console.log(`built → ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
