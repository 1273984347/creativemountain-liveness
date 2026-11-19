// B79 §4.1：句子层占位符的**唯一**替换实现。
//
// 为什么只许一份（P2）：B78 时 `instructionText` 自己 split/join 一次、`build-ir` 又自己
// split/join 一次——同一件事两份实现，第三份（本文件）落地后前两份都必须改调它（T5）。
// 每多一份实现，就多一处「改了这份忘了那份」的窗口，而那正是本批要治的病。
//
// ⚠️ 缺叶**抛错**而不是保留占位符：把裸 `{path}` 印给玩家，和印出错的主题词是同一类缺陷
//   （B78 页脚假话的形状）。静默兜底比当场炸更危险。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expandThemeWords, TERM_TOKENS } from '../../engine/core/theme-text.ts';
import { SENTENCE_LEAVES } from '../../tools/theme-diff-check.mjs';
import type { ThemeTerms } from '../../engine/types/theme.ts';

const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];
// 既有先例：tests/gates/instruction-d20.test.ts 用 `theme.terms as ThemeTerms` 从真实主题包取词表。
const termsOf = (id: string): ThemeTerms =>
  JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')).terms as ThemeTerms;

test('五叶全展开（基准逐字 = 玩家现在看到的词）', () => {
  const raw = '{resource}不足：{gate}标价 3，走{path}绕到{peak}，{hp}不低于初始值';
  assert.equal(expandThemeWords(raw, termsOf('xianxia2026')),
    '灵枢不足：关隘标价 3，走山道绕到封顶台，灵力不低于初始值');
});

// B80 §2.1：三新叶各留一条「展开后是本套词」的正证据。缺了这类断言，扩表只证明**能展开**，
// 不证明**展开成对的词**——四套里任何一套把 rift 写成别套的词，上面那条五叶断言看不见。
test('B80 §2.1：三叶展开各说本套的话（rift / hazard / player 四套对照）', () => {
  const want: Record<string, string[]> = {
    xianxia2026: ['裂隙', '险径', '修士'], hybrid: ['崩口', '险坡', '行道者'],
    'scifi-ai': ['数据断层', '故障区', '行动者'], 'urban-psych': ['断桥', '危险区', '异能者'],
  };
  for (const id of IDS) {
    const shown = expandThemeWords('{rift}/{hazard}/{player}', termsOf(id));
    assert.equal(shown, (want[id] ?? []).join('/'), `${id} 三叶展开不符：${shown}`);
    assert.equal(/\{/.test(shown), false, `${id}：展开后残留占位符 ⇒ ${shown}`);
  }
});

test('无占位符时恒等（出口可以无条件调用，不必分支）', () => {
  const s = '问天：掷出 2，执行第 2 条指令';
  for (const id of IDS) { assert.equal(expandThemeWords(s, termsOf(id)), s); }
});

test('四套主题各自展开成自己的词', () => {
  const raw = '{resource}不足';
  assert.deepEqual(
    Object.fromEntries(IDS.map((id) => [id, expandThemeWords(raw, termsOf(id))])),
    { hybrid: '灵能不足', 'scifi-ai': '算力不足', 'urban-psych': '异能点不足', xianxia2026: '灵枢不足' },
  );
});

test('同一占位符出现多次全部展开（split/join 语义，不是只换第一个）', () => {
  assert.equal(expandThemeWords('{gate}：未通过则改走{gate}付费通道', termsOf('scifi-ai')),
    '安全闸：未通过则改走安全闸付费通道');
});

test('缺叶抛错而不是静默留占位符（同 termWord 口径）', () => {
  // 故意只给四个叶：运行时守卫是为「主题包缺键但门⑤ 没跑到」的场景兜底，
  // 所以这里必须绕过类型系统（既有惯例：instruction-d20 的 `as` 逐字段显式标注）。
  const partial = { gate: 'g', path: 'p', peak: 'k', hp: 'h' } as unknown as ThemeTerms;
  assert.throws(() => expandThemeWords('{resource}不足', partial), /terms\.resource/);
});

test('TERM_TOKENS ≡ 展开集合，且不含 deck（同形词「指令」，规格 §4.4）', () => {
  // B80 §2.1：8 叶 = B79 的五叶 + rift / hazard / player。`deck` 依旧不在内（§4.4 同形词裁决仍成立）。
  assert.deepEqual([...TERM_TOKENS].sort(), ['gate', 'hazard', 'hp', 'path', 'peak', 'player', 'resource', 'rift']);
  const raw = '{deck}不足';
  assert.equal(expandThemeWords(raw, termsOf('scifi-ai')), raw, '⇒ {deck} 不是占位符：原样留着，交给守卫而不是印给玩家');
});

// 执行期修正 #9：`tools/theme-diff-check.mjs` 的 SENTENCE_LEAVES 与本文件的 TERM_TOKENS
// 是同一集合的两处声明（让门⑧ 去 import 渲染实现会把「差异化」与「怎么替换」焊死）。
// 各自声明可以，**漂移不行**——漂移的后果是门⑧ 比了五个叶而 R1 只禁其中四个。
test('B79 修正 #9：门⑧ 的 SENTENCE_LEAVES ≡ TERM_TOKENS（两处声明不许漂）', () => {
  assert.deepEqual([...SENTENCE_LEAVES].sort(), [...TERM_TOKENS].sort());
});
