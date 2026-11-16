// 门 ⑧ 的句子层五叶差异化（B79 §3.6 / R8）。
//
// ⚠️ 判据是**跨套两两不同**，不是「与基准不同」：本轮实测 `path` 撞词正是「基准 vs 融合套」，
//   改词后若仍只比基准，**下次两套非基准主题撞词就看不见**（现口径的盲区）。
//   ⇒ 两个方向各一条负样本：②′（与基准相同）与两两互异（非基准两套相同）。
//
// ⚠️ 自包含：违例全在**内存副本**上制造，不碰工作区主题包（node:test 跨文件并发会互踩）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkThemeDiff, checkThemesMutuallyDistinct } from '../../tools/theme-diff-check.mjs';

const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];
const LEAVES = ['resource', 'gate', 'path', 'peak', 'hp'] as const;
const read = (id: string): any => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8'));
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v)) as any;

test('B79：五叶取值跨套两两不同（基准「山道」与融合套「索桥」不再撞词）', () => {
  for (const leaf of LEAVES) {
    const seen = new Map<string, string>();
    for (const id of IDS) {
      const v = read(id).terms[leaf] as string;
      assert.ok(!seen.has(v), `${leaf}：${seen.get(v)} 与 ${id} 同为「${v}」⇒ 界面会串戏`);
      seen.set(v, id);
    }
  }
});

test('B79：hybrid 的 terms.path ≡ glossary.path ≡ 索桥（两表一起改，判等才绿）', () => {
  const h = read('hybrid');
  assert.equal(h.terms.path, '索桥');
  assert.equal(h.glossary.path, h.terms.path, '⇒ 句子层与印刷层在说两个词');
});

// r1.3 实测教训：门⑧ 的串戏判据是**子串包含**，而 `branches[].label` 是四套逐字复用的
//   （`board.tiles[11].branches[1].label = 栈道` 在四套里各出现 1 次），格名则每套不同
//   （基准「石阶」/ 融合套「石阶前」「碎云阶」）⇒ 凡已被当作**具体地名**的词都不能当术语词。
//   这条把「为什么不能图省事选个山岳词」钉成实测计数，免得下一个人重新踩。
test('B79 负样本：path 选词不得撞复用正文与格名（栈道/云阶/石阶出局的原因）', () => {
  const raw = Object.fromEntries(IDS.map((id) => [id, readFileSync(resolve('themes', id, 'theme.json'), 'utf8')]));
  const count = (id: string, w: string) => (raw[id] ?? '').split(w).length - 1;
  const byId = (w: string) => Object.fromEntries(IDS.map((id) => [id, count(id, w)]));

  // ①「栈道」：四套各 1 次，且位置就是复用的岔路标签 ⇒ 谁拿它当术语，另三套全判串戏
  assert.deepEqual(byId('栈道'), { hybrid: 1, 'scifi-ai': 1, 'urban-psych': 1, xianxia2026: 1 },
    '前提：「栈道」仍是四套复用的岔路标签');
  // ②「云阶 / 石阶」：基准正文里就有（格名「碎云阶」「石阶」）⇒ hybrid 取其一，基准立刻判红
  for (const w of ['云阶', '石阶']) {
    assert.ok(count('xianxia2026', w) >= 1, `前提：基准正文含「${w}」⇒ 它不能当任何别套的术语词`);
  }
  // ③ 定稿词：只在 hybrid 的两张表里各 1 次（terms.path + glossary.path），别处零出现
  assert.deepEqual(byId('索桥'), { hybrid: 2, 'scifi-ai': 0, 'urban-psych': 0, xianxia2026: 0 },
    '⇒ 「索桥」应只出现在 hybrid 的 terms 与 glossary；别处出现即串戏判据会红');
});

test('B79 R8 负样本：把 hybrid 的 terms.path 改回「山道」⇒ 门⑧ ②′ 判红', () => {
  const base = read('xianxia2026');
  const bad = clone(read('hybrid'));
  bad.terms.path = '山道';
  const r = checkThemeDiff(base, bad);
  assert.ok(r.errors.some((e: string) => e.includes('terms.path')), `实际：${JSON.stringify(r.errors)}`);
});

test('B79 R8 负样本：删掉一套主题的 terms.peak ⇒ 门⑧ ②′ 判红（缺叶=占位符无词可展开）', () => {
  const base = read('xianxia2026');
  const bad = clone(read('scifi-ai'));
  delete bad.terms.peak;
  const r = checkThemeDiff(base, bad);
  assert.ok(r.errors.some((e: string) => e.includes('terms.peak')), `实际：${JSON.stringify(r.errors)}`);
});

test('B79 R8 负样本：两套**非基准**主题撞词 ⇒ 两两互异必须抓到（只比基准的盲区）', () => {
  const base = read('xianxia2026');
  const a = clone(read('hybrid'));
  const b = clone(read('urban-psych'));
  b.terms.path = a.terms.path;   // 与基准都不同 ⇒ ②′ 看不见，只有两两互异能抓
  assert.ok(!checkThemeDiff(base, b).errors.some((e: string) => e.includes('terms.path')),
    '前提：这套撞词确实躲得过「与基准不同」——正因如此才需要两两互异');
  const r = checkThemesMutuallyDistinct([base, a, b], base);
  assert.ok(r.errors.some((e: string) => e.includes('terms.path')), `实际：${JSON.stringify(r.errors)}`);
});
