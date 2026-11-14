// 门 ⑤ 的「题面==判定」守卫（B77 规格 §6.3）+ 三条负样本。
//
// ⚠️ 为什么判据必须常驻门 ⑤ 而不是只写在测试里：题面漂移是**印刷事故**（玩家手里的牌写着
//   条件 A、引擎判条件 B），而印刷链路（build-ir.mjs:138）只搬运 text ⇒ 只有主题包校验器
//   站在源头。B75.2 当年把「题面与判定不符」当成"已知瑕疵登记"而不是修，正是因为没有门。
//
// 三条负样本各判红一次（B38–B44 的「失败路径常驻」纪律）：
//   ① 篡改题面 ⇒ 报出 trials[i] 与两条文本；
//   ② terms 缺一个叶子 ⇒ 报出该叶子路径；
//   ③ 给可派生的题面偷标 fallback ⇒ 报出 fallback 数与钉子（EXPECTED_FALLBACK_COUNT）。
// 第 ④ 条是「未知顶层键不影响」的正样本：它把规格 §6.2 里"加 terms 零风险"的**现查结论**
// 变成常驻断言，免得将来有人靠读代码重新确认一遍。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveThemeSchema } from '../../tools/theme-schema.mjs';
import { validateTheme, listThemePaths, EXPECTED_FALLBACK_COUNT } from '../../tools/theme-validate.mjs';
import { isDerivable, renderTrialText } from '../../build/trial-text.mjs';

const schema = deriveThemeSchema();
const load = (id: string): any => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8'));

test('门⑤ 正样本：四套主题在守卫下零错误，且 fallback 恰为 0', () => {
  assert.equal(EXPECTED_FALLBACK_COUNT, 0, '今天必须恰好 0 条手写题面（§6.3 第 3 条）');
  const paths = listThemePaths();
  assert.equal(paths.length, 4, '前提：门 ⑤ 自动覆盖 themes/ 下四套主题包');
  for (const p of paths) {
    const theme = JSON.parse(readFileSync(p, 'utf8'));
    const r = validateTheme(theme, schema);
    assert.deepEqual(r.errors, [], `${p} 不该有错：${r.errors.join('; ')}`);
  }
});

test('门⑤ 正样本：未知顶层键不影响校验（§6.2「加 terms 零风险」的现查结论钉成断言）', () => {
  const theme = load('xianxia2026');
  theme.some_future_top_level_key = { a: 1 };
  assert.deepEqual(validateTheme(theme, schema).errors, []);
});

test('门⑤ 负样本：篡改一条题面 ⇒ 判红并给出路径与两侧文本', () => {
  const theme = load('xianxia2026');
  // 复刻 B26 留下的那条错牌：文本说同色/红牌，判定其实是 2 张黑色
  theme.trials[1].text = '展示 2 张同色手牌（手里要有红牌）。';
  const r = validateTheme(theme, schema);
  assert.ok(r.errors.some((e) => e.includes('trials[1]') && e.includes('题面与判定不符')),
    `实际 errors=${r.errors.join('; ')}`);
});

test('门⑤ 负样本：terms 少一个叶子 ⇒ 判红并点名该叶子', () => {
  const theme = load('xianxia2026');
  delete theme.terms.types.defense;
  const r = validateTheme(theme, schema);
  assert.ok(r.errors.some((e) => e.includes('terms.types.defense')), r.errors.join('; '));
});

test('门⑤ 负样本：整个 terms 缺失 ⇒ 判红（基准也不能免检）', () => {
  const theme = load('xianxia2026');
  delete theme.terms;
  const r = validateTheme(theme, schema);
  assert.ok(r.errors.some((e) => e.includes('terms.hp')), r.errors.join('; '));
});

test('门⑤ 负样本：给**可派生**的题面偷标 fallback ⇒ 判红（不许靠 fallback 绕过守卫）', () => {
  const theme = load('xianxia2026');
  assert.equal(isDerivable(theme.trials[0].effects[0].pred), true, '前提：这条判定本来可派生');
  theme.trials[0].fallback = true;
  const r = validateTheme(theme, schema);
  assert.ok(r.errors.some((e) => e.includes('fallback')), r.errors.join('; '));
});

test('门⑤ 负样本：把判定换成白名单外却不标 fallback ⇒ 判红（不给手写题面留暗门）', () => {
  const theme = load('xianxia2026');
  theme.trials[0].effects[0].pred = { kind: 'flag_set', flag: 'whatever' };
  const r = validateTheme(theme, schema);
  assert.ok(r.errors.some((e) => e.includes('trials[0]') && e.includes('fallback')), r.errors.join('; '));
});

test('门⑤ 正样本：真·不可派生时，守卫只查非空并如实计入 fallback', () => {
  const theme = load('xianxia2026');
  theme.trials[0].effects[0].pred = { kind: 'flag_set', flag: 'whatever' };
  theme.trials[0].fallback = true;
  theme.trials[0].text = '手工题面：相关标记已置——通过后抽 1 张符箓（未通过则本关改为付费）。';
  // 期望：题面本身不再比对，但总数变成 1 ≠ 0 ⇒ 仍然判红，红在钉子上（放宽必须改常量）
  const r = validateTheme(theme, schema);
  assert.equal(r.errors.filter((e) => e.includes('题面与判定不符')).length, 0,
    '不可派生的条目不该再比对文本：' + r.errors.join('; '));
  assert.ok(r.errors.some((e) => e.includes('EXPECTED_FALLBACK_COUNT')), r.errors.join('; '));
});

test('门⑤ 判据与派生器同源：守卫报的期望文本就是 renderTrialText 的输出', () => {
  const theme = load('xianxia2026');
  const want = renderTrialText(theme.trials[3].effects[0], theme.terms);
  assert.equal(theme.trials[3].text, want);
});
