// B78 §3.2 甲案：类目行「{gate}试炼」不动（玩家识别牌型的第一层信息），
//   name 起独立第二行（pad+15），正文固定从 pad+27 起；name 为空串时标题行不渲染。
// ⚠️ 形状判据而非文案判据：它证明渲染层的 if 真的短路了，而不是靠数据恰好非空。
// ⚠️ 正文起点**固定** pad+27（规格 r1.5）：空 name 也占位 —— 偏移不许成为数据的函数，
//   否则同一批牌的位置会随数据在两种版式间跳。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trialSvg } from '../../build/print-parts.ts';

/** trialSvg 第三参是 Readonly<Record<string,string>>（IR glossary 形状）。 */
const GLOSSARY = { gate: '关隘' };
const TRIAL = { id: 't_mirror', text: '展示手里 2 张红色牌。' };

/** SVG 里含某串的 <text> 的 y 值（取第一个命中；CARD_PAD=3 ⇒ 11/18/30 是算出来的）。 */
function yOf(svg: string, needle: string): number | null {
  const i = svg.indexOf(needle);
  if (i < 0) { return null; }
  const m = svg.slice(svg.lastIndexOf('<text', i), i).match(/ y="([\d.]+)"/);
  return m?.[1] === undefined ? null : Number(m[1]);
}

test('甲案：有 name ⇒ 类目 11 / 标题 18 / 正文 30（pad+8 / pad+15 / pad+27）', () => {
  const svg = trialSvg({ ...TRIAL, name: '燃朱' }, 0, GLOSSARY);
  assert.ok(svg.includes('>燃朱<'), '标题行没印 name');
  assert.equal(yOf(svg, '>关隘试炼<'), 11, '类目行应保持 pad+8');
  assert.equal(yOf(svg, '>燃朱<'), 18, '标题行应为 pad+15');
  assert.equal(yOf(svg, '展示手里'), 30, '正文首行应为 pad+27');
});

test('空 name ⇒ 标题行不渲染，正文起点**仍** pad+27（不随数据漂移）', () => {
  const withName = trialSvg({ ...TRIAL, name: '赤步' }, 0, GLOSSARY);
  const without = trialSvg({ ...TRIAL, name: '' }, 0, GLOSSARY);
  assert.ok(withName.includes('>赤步<'), '前提：有 name 时印标题');
  assert.equal(without.includes('赤步'), false, '空 name 不得印任何东西');
  assert.equal(yOf(without, '展示手里'), 30, '空 name 时正文仍在 pad+27');
  assert.equal(yOf(without, '展示手里'), yOf(withName, '展示手里'), '两种数据下版式一致');
  assert.equal(yOf(without, '>关隘试炼<'), 11, '空 name 不影响类目行');
});
