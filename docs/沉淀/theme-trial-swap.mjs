// 主题包试炼牌替换（可复用工具）——把某张试炼牌整体换成另一张。
//
// 为什么要用脚本而不是逐处 edit：四套主题包的同一张牌**逐字相同**（§10.1 允许试炼结构复用），
//   逐处改要动 4 × 3 = 12 处；脚本一次改完并**断言替换次数**，改不到就报错。
// ⚠️ 脚本只做**文本替换**（不解析再序列化 JSON）⇒ 保留原文件的缩进与换行，diff 干净。
//
// 用法：node docs/沉淀/theme-trial-swap.mjs <主题id...>
//
// 改一张牌要三处同步：① 牌本身的 id/text/effects；② 关隘 `trialIds` 里的引用。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 旧牌（回答问题）⇒ 新牌（出示 4 枚资源；不足则本关改为付费）。 */
const OLD_ID = 't_riddle';
const NEW_ID = 't_toll';
const OLD_TEXT = '回答在场任意一人的 1 个问题。';
const NEW_TEXT = '出示 4 枚资源（不足则本关改为付费）。';

const themes = process.argv.slice(2);
if (themes.length === 0) {
  console.error('用法：node docs/沉淀/theme-trial-swap.mjs <主题id...>（例：xianxia2026 scifi-ai urban-psych hybrid）');
  process.exit(2);
}

for (const id of themes) {
  const path = resolve('themes', id, 'theme.json');
  const src = readFileSync(path, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let out = src;
  // ① 牌本身：id + text + effects 一次替换（effects 用与原文相同的缩进）。
  const oldBlock = [
    `      "id": "${OLD_ID}",`,
    `      "text": "${OLD_TEXT}",`,
    '      "effects": [',
    '        {',
    '          "op": "draw_cards",',
    '          "count": 1',
    '        }',
    '      ]',
  ].join(eol);
  const newBlock = [
    `      "id": "${NEW_ID}",`,
    `      "text": "${NEW_TEXT}",`,
    '      "effects": [',
    '        {',
    '          "op": "conditional",',
    '          "pred": { "kind": "resource_at_least", "amount": 4 },',
    '          "then": { "op": "draw_cards", "count": 1 },',
    '          "else": { "op": "gate_fallback_pay" }',
    '        }',
    '      ]',
  ].join(eol);
  if (!out.includes(oldBlock)) {
    throw new Error(`${id}: 未找到旧牌块（缩进/换行不匹配？）`);
  }
  out = out.replace(oldBlock, newBlock);
  // ② 关隘 trialIds 引用。
  const refs = (out.match(new RegExp(`"${OLD_ID}"`, 'g')) ?? []).length;
  if (refs === 0) { throw new Error(`${id}: 未找到 ${OLD_ID} 的引用`); }
  out = out.replaceAll(`"${OLD_ID}"`, `"${NEW_ID}"`);
  if (out.includes(`"${OLD_ID}"`)) { throw new Error(`${id}: 仍有 ${OLD_ID} 残留`); }
  writeFileSync(path, out, 'utf8');
  console.log(`${id}: ${OLD_ID} → ${NEW_ID}（引用 ${String(refs)} 处已同步）`);
}
