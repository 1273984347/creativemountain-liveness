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

import { expandIdentityNames, expandThemeWords, TERM_TOKENS } from '../../engine/core/theme-text.ts';
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

// B80 T7：验收 11 要「三叶各至少一条基准展开证据」，且 R5 的 `baseExpanded` 下限要跟着涨。
// 上面那条四套对照是**表驱动**的（期望值在 `want` 里），R5 的 `wrapped` 只认 assert 表达式里
// 直接出现的出口调用 ⇒ 表驱动的那条它看不见。这里补三条**内联字面量**形状：
// 期望串就是基准套玩家看到的句子，谁把它改回 `{rift}` 就等于把展开结果没人测了（会被 R5 抓）。
test('B80 验收 11：三叶 + 称谓各一条基准内联展开证据（字面量期望，不经表格）', () => {
  const x = termsOf('xianxia2026');
  assert.equal(expandThemeWords('{rift}结算失败：花 2 {resource}通过{gate}', x),
    '裂隙结算失败：花 2 灵枢通过关隘', '⇒ 含 {rift} 的句子在基准套必须印成「裂隙」');
  assert.equal(expandThemeWords('{hazard}：判定失败，退 1 格', x), '险径：判定失败，退 1 格');
  assert.equal(expandThemeWords('当前{player} 座 2', x), '当前修士 座 2');
  assert.equal(expandIdentityNames('[被动:shield] {identity:4}：回合结束获得 1 点护盾',
    (seat) => (seat === 4 ? '守夜人' : '座' + String(seat))),
    '[被动:shield] 守夜人：回合结束获得 1 点护盾');
});

// ---------- B80 §2.3：`{identity:N}` 的解析机制 ----------
//
// 与上面的 `expandThemeWords` 分两个函数：那一个查**静态词表**（terms），这一个查**运行时主体**
// （座位 → 玩家身份 → 主题身份表）。合成一个"大替换"就把两件事糊成一团，将来加 `{faction:N}` 没有落点。
test('B80 {identity:N}：多个全部展开、格式错误抛错、无占位符恒等', () => {
  const nameOf = (seat: number) => (seat === 0 ? '守闸人' : seat === 7 ? '塔主' : '座' + String(seat));
  assert.equal(expandIdentityNames('{identity:0}：回合结束', nameOf), '守闸人：回合结束');
  assert.equal(
    expandIdentityNames('{identity:0} 把盾给了 {identity:7}', nameOf),
    '守闸人 把盾给了 塔主', '⇒ 必须全局替换（无 g 的 replace 会漏第二个）');
  assert.equal(expandIdentityNames('无称谓的句子', nameOf), '无称谓的句子', '恒等：出口可无条件调用');
  assert.throws(() => expandIdentityNames('{identity:} 发言', nameOf), /身份占位符格式非法/,
    '⇒ 花括号没写全不能悄悄漏过去（印给玩家就是 B78 页脚假话的形状）');
  assert.throws(() => expandIdentityNames('{identity:1x} 发言', nameOf), /身份占位符格式非法/,
    '⇒ 座位号不是纯数字也算畸形，不猜意图');
  assert.throws(() => expandIdentityNames('{identity:9} 发言', () => { throw new Error('查无此人'); }),
    /查无此人/, '⇒ 解析失败由调用侧抛出，本函数不吞');
  // 连调两次必须同结果：带 g 的字面量正则若被提到模块级复用，第二次会从 lastIndex 起跑 ⇒ 静默漏替换
  const raw = '{identity:0} 与 {identity:7}';
  assert.equal(expandIdentityNames(raw, nameOf), expandIdentityNames(raw, nameOf));
});
