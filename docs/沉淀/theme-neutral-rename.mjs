// 主题包中性格名批量改名（可复用工具）。
//
// ⚠️ 为什么需要：中性名会进**实体件**（棋盘格名）⇒ 若含某个主题的术语，
//   门⑧（主题差异化核对）会判「跨主题术语串戏」——实测「山道 N」里的「山道」
//   是 hybrid 主题的术语 ⇒ 科幻/都市两套被判串戏。
// ⇒ 中性名必须**不含任何主题词**：统一用「第 N 段」。
//
// 用法：node docs/沉淀/theme-neutral-rename.mjs <主题id...>（默认四套全改）

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const themes = process.argv.slice(2);
const list = themes.length > 0
  ? themes
  : ['xianxia2026', 'scifi-ai', 'urban-psych', 'hybrid'];

for (const id of list) {
  const path = resolve('themes', id, 'theme.json');
  const raw = readFileSync(path, 'utf8');
  const out = raw.replace(/"name": "山道 (\d+)"/g, '"name": "第 $1 段"');
  if (out === raw) { console.log(id + ': 无「山道 N」中性名，跳过'); continue; }
  writeFileSync(path, out, 'utf8');
  console.log(id + ': 中性名已改为「第 N 段」');
}
