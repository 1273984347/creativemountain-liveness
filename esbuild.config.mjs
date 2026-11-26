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
//
// ⚠️ `CM_BUILD_ROOT` 可覆盖 root（B13 负样本自证用）：隔离副本里用**本脚本**构建
//    **副本的** bundle（读副本的 web/ + engine/ + themes/，输出到副本 dist/）——
//    脚本仍在仓库里 ⇒ `import 'esbuild'` 正常解析，无需在副本里准备 node_modules。
//    默认行为不变（不设该变量时 root 仍是脚本所在目录）。
const root = process.env.CM_BUILD_ROOT !== undefined
  ? resolve(process.env.CM_BUILD_ROOT)
  : here;

// ⚠️ **输出根**（B98 · 门 ⑯ 专用）：不设时写 `root/dist`（默认行为一字未改）。
//   门 ⑯ 需要「把产物构建到**独立临时目录**」⇒ 才能枚举出「本次构建产出了哪些文件」
//   （集合层判据：产出集合必须 == 基线登记集合）。
//   ⇒ 与 `CM_BUILD_ROOT` 配对使用：源根与输出根分离（源在副本、产物在副本的 .tmp/）。
//   ⚠️ 相对路径按 **root** 解析（不是 cwd）⇒ 与 `CM_BUILD_ROOT` 的语义一致。
const outRoot = process.env.CM_BUILD_OUT !== undefined
  ? resolve(root, process.env.CM_BUILD_OUT)
  : resolve(root, 'dist');

await mkdir(outRoot, { recursive: true });

// 样式外置到 web/styles.css，构建时内联进单文件。
const css = await readFile(resolve(root, 'web/styles.css'), 'utf8');

async function buildHtml(entry, define, outName, title) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    minify: true,
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    loader: { '.json': 'json' },
    define,
  });
  const js = result.outputFiles[0].text;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
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
  const outPath = resolve(outRoot, outName);
  await writeFile(outPath, html, 'utf8');
  console.log(`built → ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
  return outPath;
}

await buildHtml('web/main.ts', { PLAYTEST_MODE: 'false' }, '创界山-活人认证.html', '创界山·活人认证');
await buildHtml('web/playtest-main.ts', { PLAYTEST_MODE: 'true' }, '创界山-活人认证-实拍.html', '创界山·活人认证（实拍）');
