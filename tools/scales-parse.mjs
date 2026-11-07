// 规模表**从源码派生**的共享解析器（B11 引入）。
//
// ⚠️ 为什么有它：此前 `build/build-ir.mjs`、`tools/ir-validate.mjs`、`tools/parity-check.mjs`
//   **各自手抄一份** `engine/scales.ts` 的字段正则 ⇒ 加一个字段要改三处，漏一处就门禁判红
//   （B11 实测：新增 `seatWeight` 时 parity-check 漏改 ⇒ 溯源门禁 24 项误报）。
//   手抄清单本身就是**第二事实源** —— 现在改为**通用解析**：
//   只要值是数字的 `字段名: 数字` 都会被收下 ⇒ **加字段不用改任何解析器**。

// 数值本身的正确性由 doc-sync 的 **C2**（规格 §8 表格 ↔ engine/scales.ts）保证；
// 溯源路径与值的一致性由 parity-check 第 ③ 级保证。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 从 `engine/scales.ts` 的 `SCALES` 数组解析出全部规模行。
 *
 * @param {string} root 仓库根目录（默认 process.cwd()）
 * @returns {Array<Record<string, number>>} 每行含 `players` 与全部数值字段
 */
export function loadScalesFromSource(root = process.cwd()) {
  const src = readFileSync(resolve(root, 'engine', 'scales.ts'), 'utf8');
  const start = src.indexOf('export const SCALES');
  if (start < 0) { throw new Error('engine/scales.ts 里找不到 SCALES 定义'); }
  const end = src.indexOf('];', start);
  if (end < 0) { throw new Error('engine/scales.ts 的 SCALES 数组未闭合'); }
  const seg = src.slice(start, end);
  const rows = [];
  for (const m of seg.matchAll(/\{([^{}]*)\}/g)) {
    const row = {};
    for (const f of m[1].matchAll(/([a-zA-Z_][a-zA-Z_0-9]*):\s*(\d+)/g)) {
      row[f[1]] = Number(f[2]);
    }
    if (typeof row.players === 'number') { rows.push(row); }
  }
  if (rows.length === 0) { throw new Error('无法从 engine/scales.ts 解析规模表'); }
  return rows;
}
