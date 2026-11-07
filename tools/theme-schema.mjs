// 主题包 Schema 派生器 —— **从 engine/types/theme.ts 源码派生**，不是手抄清单。
//
// 为什么必须派生：实施计划 §0.1 规则 3 ——「主题包类型定义与校验器同源」。
// 手抄的 op 清单本身会成为**第二事实源**：改了 EffectMap 忘了改清单，
// 校验器就会把非法主题包判为合法。派生是唯一不会漂移的做法。
//
// 解析方式与 doc-sync 的 `unionMembers` 同一套思路（扫描源码文本）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const THEME_SRC = resolve('engine/types/theme.ts');
const COMMON_SRC = resolve('engine/types/common.ts');

/** 读取 theme.ts 源码。 */
export function readThemeSource() {
  return readFileSync(THEME_SRC, 'utf8');
}

/** 读取 common.ts 源码（CardType / NegativeStatus 等共享枚举在此）。 */
export function readCommonSource() {
  return readFileSync(COMMON_SRC, 'utf8');
}

/** 去掉注释与字符串字面量，避免注释里的名字被误抓。 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * 解析 `export type X = 'a' | 'b';` 的成员名。
 * 支持跨行联合（`|` 续行）。
 */
export function unionMembers(source, typeName) {
  const i = source.indexOf(`export type ${typeName}`);
  if (i < 0) {
    return [];
  }
  const end = source.indexOf(';', i);
  const seg = source.slice(i, end < 0 ? undefined : end);
  return [...seg.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
}

/**
 * 解析 `export interface EffectMap { ... }` 的每个算子及其参数。
 *
 * 返回 `{ [opName]: { required: string[], optional: string[] } }`。
 * 参数名从源码的 `readonly name: type` 形态提取；带 `?` 的是可选参数。
 */
export function parseEffectMap(source) {
  const cleaned = stripComments(source);
  const start = cleaned.indexOf('export interface EffectMap {');
  if (start < 0) {
    return {};
  }
  const bodyStart = cleaned.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') { depth += 1; }
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = cleaned.slice(bodyStart + 1, end);
  const result = {};
  // 每个算子一行：`name: { readonly a: T; readonly b?: T };`
  const opRe = /([a-z_0-9]+)\s*:\s*\{([^}]*)\}/g;
  for (const m of body.matchAll(opRe)) {
    const opName = m[1];
    const params = m[2];
    if (opName === undefined || params === undefined) { continue; }
    const required = [];
    const optional = [];
    for (const pm of params.matchAll(/readonly\s+([a-zA-Z_0-9]+)(\??)\s*:/g)) {
      const pname = pm[1];
      if (pname === undefined) { continue; }
      if (pm[2] === '?') { optional.push(pname); } else { required.push(pname); }
    }
    result[opName] = { required, optional };
  }
  return result;
}

/** 派生出的主题包 Schema（校验器据此工作）。 */
export function deriveThemeSchema() {
  const source = readThemeSource();
  const common = readCommonSource();
  return {
    ops: parseEffectMap(source),
    opNames: unionMembers(source, 'OpName'),
    predicateNames: unionMembers(source, 'PredicateName'),
    goalKinds: unionMembers(source, 'GoalKind'),
    cardTypes: unionMembers(common, 'CardType'),
    negativeStatuses: unionMembers(common, 'NegativeStatus'),
  };
}
