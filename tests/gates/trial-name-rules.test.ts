// B78 §2.2 三条命名判据里「机器可判」的部分：必填 / 长度 / 禁字 / 套内不撞名。
//
// ⚠️ 语义同侧**不在这里**：机器不判「这个名字指没指对侧」，那一维归规格 §2.4 的人工对照
//   （T18 的签字行）。门 ⑧ 的 SAME_NAME_ALLOWED 是**同名**判据的出口，与同侧无关，别混。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveThemeSchema } from '../../tools/theme-schema.mjs';
import { validateTheme } from '../../tools/theme-validate.mjs';

const schema = deriveThemeSchema();
const load = (id = 'xianxia2026'): any => JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8'));

test('正样本：四套现状在 name 判据下零错误', () => {
  for (const id of ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid']) {
    assert.deepEqual(validateTheme(load(id), schema).errors, [], id);
  }
});

test('负样本：name 为空串 ⇒ 判红（版面靠它起标题行）', () => {
  const t = load();
  t.trials[0].name = '';
  const errs = validateTheme(t, schema).errors;
  assert.ok(errs.some((e: string) => e.includes('trials[0]') && e.includes('name')), errs.join('; '));
});

test('负样本：name 缺字段 ⇒ 判红（与空串同判）', () => {
  const t = load();
  delete t.trials[0].name;
  assert.ok(validateTheme(t, schema).errors.some((e: string) => e.includes('trials[0]') && e.includes('name')));
});

test('负样本：含数字 ⇒ 判红（parity 的 #N+name 锚定串靠「无数字」保证唯一）', () => {
  const t = load();
  t.trials[1].name = '沉墨2';
  assert.ok(validateTheme(t, schema).errors.some((e: string) => e.includes('数字')));
});

test('负样本：超 6 字 ⇒ 判红', () => {
  const t = load();
  t.trials[2].name = '踏阵踏阵踏阵踏';
  assert.ok(validateTheme(t, schema).errors.some((e: string) => e.includes('超过')));
});

test('负样本：含类目词「关隘」⇒ 判红（头部已印「{gate}试炼」，名字不许复读）', () => {
  const t = load();
  t.trials[11].name = '关隘守';
  assert.ok(validateTheme(t, schema).errors.some((e: string) => e.includes('禁字')), '应报禁字');
});

test('负样本：含量化词「回合」⇒ 判红（量化口径只属于题面）', () => {
  const t = load();
  t.trials[7].name = '多回合';
  assert.ok(validateTheme(t, schema).errors.some((e: string) => e.includes('禁字')));
});

test('负样本：同套两条同名 ⇒ 判红（与门 ⑧ 的跨套判据分工不同）', () => {
  const t = load();
  t.trials[1].name = t.trials[0].name;
  const errs = validateTheme(t, schema).errors;
  assert.ok(errs.some((e: string) => e.includes('重名') || e.includes('次 ⇒ 同套')), errs.join('; '));
});

test('正样本：单字颜色与单字「关」合法（禁的是词组）', () => {
  const t = load();
  t.trials[0].name = '赤关';
  t.trials[1].name = '墨色';
  assert.deepEqual(validateTheme(t, schema).errors, [], '「赤关」「墨色」不该被判红');
});
