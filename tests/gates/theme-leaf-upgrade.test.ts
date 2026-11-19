// B79 §3.1：`path` / `peak` 升格为 `ThemeTerms` 的必填叶。
//
// 为什么必须升格而不是继续从 `glossary` 取：句子层（引擎 note / UI 拒因 / 面板标题）要写
// `{path}`、`{peak}` 占位符，而取词只许有一个来源（规格 §3）。`glossary` 是**开放索引签名**
// （`engine/types/theme.ts:408`）——`path` 缺键不红 ⇒ 展开器只能静默兜底或抛错打断正常文案。
// 闭合枚举 `terms` 由门 ⑤ 逐叶校验，缺叶当场红，这才是句子层能依赖的地基。
//
// 三条负样本对应 E136 的纪律：守卫存在性的取证是**跑一遍变异看它红不红**，不是 grep 到字段名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateTheme } from '../../tools/theme-validate.mjs';
import { deriveThemeSchema } from '../../tools/theme-schema.mjs';

const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];
const schema = deriveThemeSchema();
const read = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as Record<string, unknown>;

test('B79：四套主题的 terms.path / terms.peak 都是非空字符串', () => {
  for (const id of IDS) {
    const terms = read(id).terms as Record<string, unknown>;
    for (const leaf of ['path', 'peak']) {
      assert.equal(typeof terms[leaf], 'string', `${id} 的 terms.${leaf} 缺失 ⇒ 句子层 {${leaf}} 无词可展开`);
      assert.ok((terms[leaf] as string).length > 0, `${id} 的 terms.${leaf} 为空串`);
    }
  }
});

test('B79 负样本：抹掉 terms.path ⇒ 门⑤ 判红（不再是静默回落「山道」）', () => {
  const bad = read('scifi-ai');
  (bad.terms as Record<string, unknown>).path = undefined;
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e: string) => e.includes('terms.path')), `实际错误：${JSON.stringify(r.errors)}`);
});

test('B79 负样本：抹掉 terms.peak ⇒ 门⑤ 判红', () => {
  const bad = read('hybrid');
  (bad.terms as Record<string, unknown>).peak = undefined;
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e: string) => e.includes('terms.peak')), `实际错误：${JSON.stringify(r.errors)}`);
});

// B80 §2.1：三新叶同规格——`TERM_LEAVES` 从 15 升到 18，缺任一键门⑤ 必须点名。
// 写成循环而不是三条复制粘贴：少写一条的代价是「那一叶以后又能静默缺失」，
// 而循环的覆盖面由 `NEW_LEAVES` 一处决定（与门⑤ 的表同形，漂了会被上面的八键测试抓住）。
const NEW_LEAVES = ['rift', 'hazard', 'player'];

test('B80：四套主题的 terms.rift / hazard / player 都是非空字符串', () => {
  for (const id of IDS) {
    const terms = read(id).terms as Record<string, unknown>;
    for (const leaf of NEW_LEAVES) {
      assert.equal(typeof terms[leaf], 'string', `${id} 的 terms.${leaf} 缺失 ⇒ 句子层 {${leaf}} 无词可展开`);
      assert.ok((terms[leaf] as string).length > 0, `${id} 的 terms.${leaf} 为空串`);
    }
  }
});

test('B80 负样本：逐叶抹掉 terms.rift / hazard / player ⇒ 门⑤ 每叶都要点名（验收 1）', () => {
  for (const leaf of NEW_LEAVES) {
    const bad = read('hybrid');
    (bad.terms as Record<string, unknown>)[leaf] = undefined;
    const r = validateTheme(bad, schema);
    assert.ok(r.errors.some((e: string) => e.includes(`terms.${leaf}`)),
      `${leaf} 缺失未被判红 ⇒ 实际：${JSON.stringify(r.errors)}（门⑤ 的 TERM_LEAVES 没升到 18）`);
  }
});

test('B80 §2.1.2 负样本：只改 hybrid 的 glossary 三键 ⇒ 判等抓三条（裁定不是口头承诺）', () => {
  for (const leaf of NEW_LEAVES) {
    const bad = read('hybrid') as unknown as { glossary: Record<string, string> };
    bad.glossary[leaf] = '基准旧词';
    const r = validateTheme(bad, schema);
    assert.ok(r.errors.some((e: string) => e.includes(`terms.${leaf}`) && e.includes(`glossary.${leaf}`)),
      `hybrid glossary.${leaf} 漂移未被判红 ⇒ 实际：${JSON.stringify(r.errors)}`);
  }
});

// ---------- B79 §3.3：补 B78 R6 欠的 `terms ↔ glossary` 判等（E136）；B80 §2.1 把五键扩到八键 ----------
//
// B78 在 `ir-validate:42` 的注释、规格 §4、验收 12 三处互相引用「门⑤ 判等」，代码零行。
// 运行时探针（记录 §6）实证：只改 `glossary.gate` ⇒ **0 条错误**；本轮连 path/peak 一起改，
// 五处全是 0。所以下面那条「负样本」就是当时缺失的那一条——它必须红在**判等实现**上，
// 而不是红在别处恰好也报了 glossary 的形状错。

const EQUAL_PAIRS: readonly [string, string][] = [
  ['hp', 'HP'], ['resource', 'resource'], ['gate', 'gate'], ['path', 'path'], ['peak', 'peak'],
  // B80 §2.1 三新叶。⚠️ hybrid 的 glossary 三键必须与 terms 同步（规格 §2.1.2 裁定）——
  //   只换 terms 而 glossary 留着「裂隙 / 险径 / 修士」，下面两条负样本之外的**第一条**就会红三句，
  //   而那正是判等该抓的「句子层与印刷层说两个词」，不是误报。
  ['rift', 'rift'], ['hazard', 'hazard'], ['player', 'player'],
];

test('B79 R4 / B80：四套主题的 terms↔glossary 八键今天确实等值（守卫落地不自红）', () => {
  for (const id of IDS) {
    const t = read(id) as unknown as { terms: Record<string, string>; glossary: Record<string, string> };
    for (const [leaf, key] of EQUAL_PAIRS) {
      assert.equal(t.terms[leaf], t.glossary[key], `${id}：terms.${leaf}(${t.terms[leaf]}) ≢ glossary.${key}(${t.glossary[key]})`);
    }
  }
});

test('B79 R4 负样本：只改 glossary.gate ⇒ 门⑤ 判红（B78 验收 12 那条一直没实现的样本）', () => {
  const bad = read('urban-psych') as unknown as { glossary: Record<string, string> };
  bad.glossary.gate = 'XYZ闸';
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e: string) => e.includes('glossary.gate') && e.includes('terms.gate')),
    `实际错误：${JSON.stringify(r.errors)} ⇒ 判等还没实现或被绕过（E136 复发）`);
});

test('B79 R4 / B80 负样本：八键逐键篡改 ⇒ 每键都要报（少一键就是少一个守卫）', () => {
  for (const [leaf, key] of EQUAL_PAIRS) {
    const bad = read('scifi-ai') as unknown as { glossary: Record<string, string> };
    bad.glossary[key] = 'XYZ';
    const r = validateTheme(bad, schema);
    assert.ok(r.errors.some((e: string) => e.includes(`terms.${leaf}`) && e.includes(`glossary.${key}`)),
      `${key} 篡改未被判等抓到 ⇒ 实际：${JSON.stringify(r.errors)}`);
  }
});

test('B79 R4：deck 明确不比——牌库名 ≠ 单张牌名（实测四套两表全不等）', () => {
  for (const id of IDS) {
    const t = read(id) as unknown as { terms: Record<string, string>; glossary: Record<string, string> };
    assert.notEqual(t.terms.deck, t.glossary.deck, `${id}：terms.deck(${t.terms.deck}) 与 glossary.deck(${t.glossary.deck}) 本就该不同`);
  }
});

test('B79 R4 负样本的负样本：只改 terms.deck / glossary.deck 之一 ⇒ 判等不得报错（deck 是豁免，不是漏判）', () => {
  const bad = read('hybrid') as unknown as { glossary: Record<string, string> };
  bad.glossary.deck = 'XYZ库';
  const r = validateTheme(bad, schema);
  assert.equal(r.errors.filter((e: string) => /deck/i.test(e)).length, 0,
    `deck 被卷进判等了 ⇒ 会把正确数据判红：${JSON.stringify(r.errors)}`);
});
