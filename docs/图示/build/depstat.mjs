// 一次性：统计 engine/ 内真实的模块 import 关系（供 06 依赖图取数）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = resolve('engine');
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(ROOT);

const dep = new Map();   // 'core/x.ts' -> Set(被依赖者)
const indeg = new Map(); // 'core/x.ts' -> 被依赖次数
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const from = relative(ROOT, f).replace(/\\/g, '/');
  const re = /from\s+'(\.[^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    const abs = resolve(dirname(f), spec);
    let target = relative(ROOT, abs).replace(/\\/g, '/');
    if (!target.startsWith('.')) target = target.replace(/\.ts$/, '.ts');
    const key = target.endsWith('.ts') ? target : target + '.ts';
    if (!dep.has(from)) dep.set(from, new Set());
    dep.get(from).add(key);
    indeg.set(key, (indeg.get(key) || 0) + 1);
  }
}
const rows = [...indeg.entries()].sort((a, b) => b[1] - a[1]);
console.log('=== 被依赖次数（engine 内部）===');
for (const [k, v] of rows.slice(0, 22)) console.log(String(v).padStart(3), k);
console.log('\n=== 总览 ===');
console.log('文件数', files.length, '· 被依赖者', indeg.size);
console.log('\n=== engine/core 内部互引（谁引谁）===');
for (const [from, tos] of [...dep.entries()].sort()) {
  const inCore = [...tos].filter((t) => t.startsWith('core/'));
  if (inCore.length) console.log(from.padEnd(26), '→', inCore.join(', '));
}
