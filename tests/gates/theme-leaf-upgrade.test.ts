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
