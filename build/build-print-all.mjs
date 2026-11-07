// B10：按主题批量产出实体轨（IR → SVG → 打印 HTML → PDF）。
//
// 每套主题一个输出目录 print/<themeId>/：
//   print/<themeId>/ir.json      —— 该主题的中间渲染数据
//   print/<themeId>/svg/*.svg    —— 可编辑实体件源文件
//   print/<themeId>/*.html      —— 打印页
//   print/<themeId>/*.pdf       —— 成品 PDF
//
// 用法：node build/build-print-all.mjs [主题id,主题id...]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 跑一条命令（不经 shell，退出码直取）。 */
function run(args, label) {
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    shell: false,
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error('FAIL  ' + label + '\n' + (res.stdout ?? '') + '\n' + (res.stderr ?? ''));
    process.exit(1);
  }
  const out = (res.stdout ?? '').trim().split(/\r?\n/).filter((l) => l.length > 0);
  for (const l of out) { console.log('  ' + l); }
}

const argThemes = process.argv.slice(2);
const themeIds = argThemes.length > 0
  ? argThemes
  : readdirSync(resolve(ROOT, 'themes'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((id) => existsSync(resolve(ROOT, 'themes', id, 'theme.json')))
      .sort();

for (const themeId of themeIds) {
  const themePath = 'themes/' + themeId + '/theme.json';
  const outDir = 'print/' + themeId;
  mkdirSync(resolve(ROOT, outDir), { recursive: true });
  console.log('== ' + themeId + ' ==');
  run([resolve('build', 'build-ir.mjs'), themePath, outDir + '/ir.json'], '生成 IR');
  run([resolve('build', '.build-print.mjs'), outDir, outDir + '/ir.json'], '生成实体件');
}

console.log('\n全部主题实体轨完成：' + themeIds.length + ' 套');