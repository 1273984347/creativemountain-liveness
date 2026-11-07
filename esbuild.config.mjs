// 单文件构建（规格 §6.6）：引擎 + UI + 主题数据内联进一个 HTML，双击即玩、离线可用。
//
// 注意：**esbuild 不做类型检查**（实施计划 §0.1 规则 1）。
// 类型门禁由 `npm run typecheck`（tsc --noEmit）独立承担，
// `npm run build` 的顺序是「先 tsc 通过 → 再 esbuild」，红色即中断。

import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
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
});

const js = result.outputFiles[0].text;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>创界山·活人认证</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family: system-ui, 'Microsoft YaHei', sans-serif;
         background:#14110f; color:#e8e0d4; padding:24px; }
  h1 { font-size:20px; margin:0 0 16px; }
  .board { display:flex; flex-wrap:wrap; gap:6px; max-width:900px; }
  .tile { width:44px; height:44px; border-radius:6px; display:flex;
          align-items:center; justify-content:center; font-size:11px;
          background:#2a2420; border:1px solid #3d342d; position:relative; }
  .tile.peak { background:#6b4a2a; border-color:#c08b3e; }
  .marker { position:absolute; bottom:2px; font-size:10px; color:#ffd9a0; }
  .meta { margin-top:16px; font-size:13px; color:#b6a894; line-height:1.8; }
  code { background:#2a2420; padding:1px 5px; border-radius:3px; }
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
