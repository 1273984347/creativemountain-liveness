// State 字段真相源（**从 state.ts 自动派生**，不是手抄清单）。
//
// 用途：doc-sync 的 C9 检查——`State` 接口的字段集必须与规格 §6.2 登记的字段一致。
// 起因（实证）：并行会话做 B3 时给 State 加了 `certification` / `council` / `outcome`，
// 规格 §6.2 未同步 ⇒ 契约冻结形同虚设。
//
// **为什么用扫描而不是手抄**：手抄清单本身会成为第二事实源——改了 state.ts 忘了改清单，
// C9 就会误判「一致」。扫描源码是唯一不会漂移的做法。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_SRC = resolve('engine/core/state.ts');

/**
 * 解析 `export interface State { ... }` 的字段名。
 *
 * 只取**顶层**字段（深度 1）——嵌套对象（如 `decks`）算一个字段。
 * 用大括号配平扫描，跳过注释与字符串。
 */
export function parseStateFields(source) {
  const start = source.indexOf('export interface State {');
  if (start < 0) {
    return [];
  }
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(bodyStart + 1, end);
  // 去掉行注释与块注释，避免注释里的字段名被误抓
  const cleaned = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const fields = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[?:]/);
    if (m !== null) {
      fields.push(m[1]);
    }
  }
  return fields;
}

/** State 接口的字段名列表（从源码派生）。 */
export const STATE_FIELD_NAMES = parseStateFields(readFileSync(STATE_SRC, 'utf8'));
