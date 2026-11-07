// 发布包打包（B10 收官）：单文件 HTML + 4 套主题的实体件（PDF + 可编辑 SVG）+ README。
//
// 用法：node build/build-package.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'dist', '发布包');

if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(resolve(OUT, '数字轨'), { recursive: true });

// 1) 数字轨：单文件 HTML（离线可玩）
const html = resolve(ROOT, 'dist', '创界山-活人认证.html');
if (!existsSync(html)) {
  console.error('FAIL  缺少 dist/创界山-活人认证.html（先跑 npm run build）');
  process.exit(1);
}
cpSync(html, resolve(OUT, '数字轨', '创界山-活人认证.html'));

// 2) 实体件：每套主题的规则书 PDF + 实体件 PDF + 可编辑 SVG
const themeIds = readdirSync(resolve(ROOT, 'themes'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((id) => existsSync(resolve(ROOT, 'themes', id, 'theme.json')))
  .sort();

for (const themeId of themeIds) {
  const src = resolve(ROOT, 'print', themeId);
  const dst = resolve(OUT, '实体件', themeId);
  if (!existsSync(src)) {
    console.error('FAIL  缺少 print/' + themeId + '/（先跑 npm run build:print）');
    process.exit(1);
  }
  mkdirSync(dst, { recursive: true });
  for (const f of ['规则书.pdf', '实体件.pdf']) {
    if (existsSync(resolve(src, f))) { cpSync(resolve(src, f), resolve(dst, f)); }
  }
  cpSync(resolve(src, 'svg'), resolve(dst, 'svg'), { recursive: true });
}

// 3) README
const readme = resolve(ROOT, 'README.md');
if (existsSync(readme)) {
  cpSync(readme, resolve(OUT, 'README.md'));
}

console.log('发布包 → dist/发布包/');
console.log('  数字轨：创界山-活人认证.html（双击即玩，离线可用）');
console.log('  实体件：' + themeIds.length + ' 套主题 × （规则书 PDF + 实体件 PDF + 可编辑 SVG）');