// B79 T20（复算入口）：把「59 − 54 = 5」追到行。
// 对 web/main.ts 与 web/tutorial.ts，逐条列出「基线 7ab2995 的泄漏行」与「现在含占位符的行」，
// 看多出来的那行是从哪来的。跑法：node tools/presets/b79-t20-two-lines.mjs
//
// ⚠️ 这条为什么值得常驻：记录 §12.4 的第一版把它写成「施工中新写/拆出来的行」——那是**没核就下的结论**
//   （修正 #40）。逐行核对后五行全是 `glossary → terms` 硬依赖边：基线读 `theme.glossary.*`，
//   那不是字面量，所以从没进过 §2 的 54 张表。写「为什么」之前先跑取证脚本，正文只贴结果。
import { readFileSync } from 'node:fs';
import { at, BATCH_BASE, gitShow, walkSources } from './common.mjs';
import { leafWordsFromThemes } from '../theme-word-scan.mjs';

const words = leafWordsFromThemes().map((w) => w.word);
const PH = /\{(?:resource|gate|path|peak|hp)\}/;
const isComment = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
const hitsIn = (lines, test) => lines.map((l, i) => [i + 1, l]).filter(([, l]) => !isComment(l.trim()) && test(l));

for (const f of ['web/main.ts', 'web/tutorial.ts']) {
  const base = gitShow(BATCH_BASE, f).split('\n');
  const now = readFileSync(at(f), 'utf8').split('\n');
  const leaks = hitsIn(base, (l) => words.some((w) => l.includes(w)));
  const phs = hitsIn(now, (l) => PH.test(l));
  console.log(`\n===== ${f}：基线泄漏 ${String(leaks.length)} 行 · 现在占位符 ${String(phs.length)} 行 =====`);
  console.log('--- 基线泄漏行 ---');
  for (const [n, l] of leaks) console.log(`  ${String(n).padStart(4)} ${l.trim().slice(0, 110)}`);
  console.log('--- 现在占位符行 ---');
  for (const [n, l] of phs) console.log(`  ${String(n).padStart(4)} ${l.trim().slice(0, 110)}`);
}

// 另外三处 ui 硬依赖边（记录 §14.2 验收 4 的证据）：基线写法都是 theme.glossary.*
console.log('\n===== 其余 glossary→terms 硬依赖边（基线原文）=====');
for (const [f, re] of [
  ['web/ui/cert.ts', /申请复议/], ['web/ui/council.ts', /3 人局/], ['web/ui/hand.ts', /p-meta/],
]) {
  gitShow(BATCH_BASE, f).split('\n').forEach((l, i) => {
    if (re.test(l) && l.includes('glossary')) console.log(`  ${f}:${String(i + 1)} ${l.trim().slice(0, 110)}`);
  });
}
const stillGlossary = walkSources('web').filter((f) => /glossary\./.test(readFileSync(f, 'utf8')));
console.log(`  现在 web/** 仍读 glossary 的文件数 = ${String(stillGlossary.length)}`);
