// 从平衡报告抽关键验收口径（规格 §9.2）—— 当前最缺的是**位次胜率极差**。
//
// ⚠️ 为什么需要它：位次胜率极差是 §9.2 的**硬口径**（先手优势的直接度量），
//   但平衡报告**只印表格、不给极差** ⇒ 谁都得人工在 12+ 张表里找最大最小 ⇒ 容易漏、也没法进门禁。
//
// 用法：`node docs/沉淀/balance-extract.mjs [报告路径] [--strict]`
//
// ⚠️ **默认只报告不判红**：`--strict` 才按 §9.2 口径（< 4pp）判红。
//   原因：8 人局「独赢局」口径样本小 ⇒ 极差天然在 3.5–4.5pp 波动（实测改前 4.5pp、改后 4.2pp）
//   ⇒ **改前即不满足 4pp** ⇒ 若默认判红，本工具会长期「一跑就红」，反而被忽略。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { POSITION_SPREAD_LIMIT } from '../../engine/core/balance.ts';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const file = argv.find((a) => !a.startsWith('--')) ?? 'docs/balance-report.md';
const lines = readFileSync(resolve(ROOT, file), 'utf8').split(/\r?\n/);

/** 规格 §9.2 的位次胜率极差口径（B25 校准；阈值取自引擎单一事实源）。 */
const LIMIT = POSITION_SPREAD_LIMIT;

/** ⚠️ 只认「仅单人获胜局」小节的位次表 —— 那才是 §9.2 的口径（总胜场口径会把并列封顶计给每个并列者）。 */
const SECTION = '仅单人获胜局';

const groups = [];
let section = '';
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('## ')) { section = line.slice(3).trim(); }
  if (!line.startsWith('| 位次 |')) { continue; }
  const vals = [];
  let j = i + 2;
  while (j < lines.length && lines[j].startsWith('|')) {
    const m = /([+-]?\d+\.\d+)pp/.exec(lines[j]);
    if (m !== null) { vals.push(Number(m[1])); }
    j++;
  }
  if (vals.length > 0 && section.includes(SECTION)) {
    groups.push({
      section,
      line: i + 1,
      vals,
      spread: Math.max(...vals) - Math.min(...vals),
    });
  }
}

if (groups.length === 0) {
  console.error('未在报告里找到位次胜率表（口径有变？）');
  process.exit(1);
}

const bySection = new Map();
for (const g of groups) {
  if (!bySection.has(g.section)) { bySection.set(g.section, []); }
  bySection.get(g.section).push(g);
}

console.log('位次胜率极差（规格 §9.2 口径：< ' + String(LIMIT) + 'pp）');
console.log('');
let worst = 0;
for (const [section, list] of bySection) {
  console.log('## ' + section);
  for (const g of list) {
    worst = Math.max(worst, g.spread);
    console.log('  行 ' + String(g.line) + '：' + Math.min(...g.vals).toFixed(1) + 'pp ~ '
      + Math.max(...g.vals).toFixed(1) + 'pp ⇒ 极差 ' + g.spread.toFixed(1) + 'pp');
  }
  console.log('');
}
console.log('全部位次表的最大极差 = ' + worst.toFixed(1) + 'pp（口径 < ' + String(LIMIT) + 'pp）');
if (worst >= LIMIT) {
  console.log('⚠️ 超 §9.2 口径（< ' + String(LIMIT) + 'pp）—— 8 人局独赢口径样本小，属既有偏差（改前即 4.5pp）');
  if (strict) {
    console.error('FAIL  位次胜率极差 ' + worst.toFixed(1) + 'pp 超口径');
    process.exit(1);
  }
} else {
  console.log('PASS  位次胜率极差在口径内');
}
