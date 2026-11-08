// 主题包试炼判定改造（B26）：条件型试炼从「有 ≥1 张」升级为「至少 N 张」。
//
// ⚠️ **文本级替换**（禁 JSON 往返：本仓主题包是手工紧凑排版，往返会把全文变成 diff）。
// ⚠️ 只替换每个试炼牌的 `pred` 块 ⇒ `then` / `else` / 文案 / 关隘试炼池**一律不动** ⇒ diff 最小。
//
// 用法：`node docs/沉淀/theme-trial-harden.mjs`（可重复执行 ⇒ 幂等）。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const THEMES = ['xianxia2026', 'scifi-ai', 'urban-psych', 'hybrid'];

/**
 * 10 张条件型试炼的新判定（`has_card_count`）—— 每张用**不同**的匹配组合，
 * 并按关隘难度递进（6 号最易 → 30 号最难）。
 *
 * ⚠️ `t_wind` / `t_star` **保持骰子型**（`dice_is_at_least`）⇒ 保留玩法多样性，
 *   且它们有**解析理论期望** ⇒ 仍按「偏差 ≤ 10pp」判定。
 */
const NEW_PREDS = {
  t_mirror: { filter: { color: 'red' }, count: 2 },
  t_sword: { filter: { color: 'black' }, count: 2 },
  t_oath: { filter: { type: 'motion' }, count: 2 },
  t_sutra: { filter: { type: 'defense' }, count: 2 },
  t_stone: { filter: { type: 'utility' }, count: 2 },
  t_mantra: { filter: { type: 'utility' }, count: 2 },
  t_silent: { filter: { type: 'motion', color: 'red' }, count: 2 },
  t_vital: { filter: { type: 'utility', color: 'black' }, count: 2 },
  t_empty: { filter: { type: 'attack', color: 'black' }, count: 2 },
  t_toll: { filter: { type: 'defense', color: 'red' }, count: 2 },
};

/** 定位 `{` 起的**配对**括号结束下标（filter 有嵌套对象 ⇒ 正则不够）。 */
function blockEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') { depth += 1; }
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) { return i; }
    }
  }
  return -1;
}

/** 生成新的 `pred` 块文本（缩进对齐主题包的紧凑排版）。 */
function predBlock(pred, eol) {
  const lines = [];
  lines.push('{');
  lines.push('            "kind": "has_card_count",');
  lines.push('            "filter": {');
  const entries = Object.entries(pred.filter);
  entries.forEach(([k, v], i) => {
    // ⚠️ 最后一个键**不能**带尾逗号（JSON 非法）
    lines.push('              "' + k + '": "' + v + '"' + (i < entries.length - 1 ? ',' : ''));
  });
  lines.push('            },');
  lines.push('            "count": ' + String(pred.count));
  lines.push('          }');
  return lines.join(eol);
}

let changed = 0;
for (const id of THEMES) {
  const path = resolve(ROOT, 'themes', id, 'theme.json');
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let text = raw;
  let n = 0;
  for (const [tid, pred] of Object.entries(NEW_PREDS)) {
    const idIdx = text.indexOf('"id": "' + tid + '"');
    if (idIdx < 0) { throw new Error(id + '：找不到试炼牌 ' + tid); }
    const predIdx = text.indexOf('"pred": {', idIdx);
    if (predIdx < 0) { throw new Error(id + '/' + tid + '：找不到 pred 块'); }
    const brace = text.indexOf('{', predIdx);
    const end = blockEnd(text, brace);
    if (end < 0) { throw new Error(id + '/' + tid + '：pred 块未闭合'); }
    text = text.slice(0, brace) + predBlock(pred, eol) + text.slice(end + 1);
    n += 1;
  }
  // 断言：替换数正确 + JSON 仍可解析 + 每张牌的 pred 已是新形态
  const parsed = JSON.parse(text);
  if (n !== Object.keys(NEW_PREDS).length) { throw new Error(id + '：替换数不符'); }
  for (const t of parsed.trials ?? []) {
    const kind = t.effects?.[0]?.pred?.kind;
    const want = NEW_PREDS[t.id] !== undefined ? 'has_card_count' : 'dice_is_at_least';
    if (kind !== want) { throw new Error(id + '/' + t.id + '：pred.kind = ' + kind + '（应为 ' + want + '）'); }
  }
  writeFileSync(path, text, 'utf8');
  changed += n;
  console.log(id + '：替换 ' + String(n) + ' 张试炼的判定');
}
console.log('完成：共替换 ' + String(changed) + ' 处（' + String(THEMES.length) + ' 套主题 × 10 张）');
