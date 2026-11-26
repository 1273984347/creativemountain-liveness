// B97 力竭可见性增强 · 毒牌层数契约的常驻守卫。
//
// ⚠️ **自包含**：负样本全部在**内存副本**上制造违例，不碰工作区主题包文件
//   （node:test 跨文件并发，改工作区文件会与其他测试互踩 —— 同 theme-diff-check 守卫的做法）。
//
// 判据：正样本全绿；四路负样本「违例必红」⇒ 证明判据有牙（不是恒真断言）。
//
// ⚠️ **不按牌 id 定位**：四套主题的卡牌 id 并不逐字相同 ⇒ 负样本一律先由判据导出实际 id
//   （否则负样本会因「找不到那张牌」而空转，测不到判据本身 —— B97 首版守卫就是这么红的）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkPoisonCards,
  collectPoisonCards,
  POISON_MIN_CARDS,
  POISON_MIN_LAYERS,
  POISON_STRONG_LAYERS,
} from '../../tools/poison-card-contract.mjs';

const THEME_IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];
const themes = THEME_IDS.map((id) => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')));
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v)) as any;

/** 找到卡牌里第一个 poison effect 并改写层数（毒牌效果可能嵌在 sequence 里）。 */
function setFirstPoisonLayers(card: any, layers: number): void {
  const walk = (node: any): boolean => {
    if (Array.isArray(node)) { return node.some((v) => walk(v)); }
    if (node === null || typeof node !== 'object') { return false; }
    if (node.op === 'poison' && typeof node.amount === 'number') { node.amount = layers; return true; }
    return Array.isArray(node.effects) ? walk(node.effects) : false;
  };
  walk(card.effects);
}

/** 按判据导出的 id 取到卡牌对象。 */
function cardOf(theme: any, cardId: string): any {
  const found = theme.cards.find((c: any) => c.id === cardId);
  assert.ok(found !== undefined, '主题里应有毒牌 ' + cardId);
  return found;
}

// ---------- 正样本：四套主题必须全绿 ----------

test('正样本：四套主题的毒牌层数契约零错误（B97 强档）', () => {
  for (const theme of themes) {
    const r = checkPoisonCards(theme);
    assert.deepEqual(r.errors, [], `${theme.meta.id} 契约应有零错误：${r.errors.join('；')}`);
  }
});

test('正样本：每套主题的毒牌层数都高于弱档基线，且文案与数值一致', () => {
  for (const theme of themes) {
    const cards = collectPoisonCards(theme);
    assert.ok(cards.length >= POISON_MIN_CARDS, `${theme.meta.id} 毒牌数不足`);
    for (const c of cards) {
      assert.ok(c.layers >= POISON_MIN_LAYERS, `${theme.meta.id}/${c.id} 层数 ${c.layers} 应 ≥ ${POISON_MIN_LAYERS}`);
      const m = /中毒\s*(\d+)\s*层/.exec(c.text);
      assert.ok(m !== null, `${theme.meta.id}/${c.id} 文案未写明中毒层数`);
      assert.equal(Number(m[1]), c.layers, `${theme.meta.id}/${c.id} 文案与数值必须一致`);
    }
    assert.ok(Math.max(...cards.map((c) => c.layers)) >= POISON_STRONG_LAYERS, `${theme.meta.id} 强档核心丢失`);
  }
});

// ---------- 负样本：违例必红 ----------

test('负样本：把毒牌层数退回 1 层 ⇒ 判红（弱档回退）', () => {
  const bad = clone(themes[0]);
  const cards = collectPoisonCards(bad);
  const target = cards[cards.length - 1];
  assert.ok(target !== undefined, '主题里应有毒牌');
  setFirstPoisonLayers(cardOf(bad, target.id), 1);
  const errors = checkPoisonCards(bad).errors;
  assert.ok(errors.some((e) => e.includes('层数')), '层数退回弱档必须判红：' + errors.join('；'));
});

test('负样本：只改数值不改文案 ⇒ 判红（文案与判定脱节）', () => {
  const bad = clone(themes[1]);
  const cards = collectPoisonCards(bad);
  const target = cards[cards.length - 1];
  assert.ok(target !== undefined, '主题里应有毒牌');
  setFirstPoisonLayers(cardOf(bad, target.id), target.layers + 1);
  const errors = checkPoisonCards(bad).errors;
  assert.ok(errors.some((e) => e.includes('文案与判定脱节')), '文案与数值不一致必须判红：' + errors.join('；'));
});

test('负样本：删掉毒牌 ⇒ 判红', () => {
  const bad = clone(themes[2]);
  const ids = collectPoisonCards(bad).map((c) => c.id);
  bad.cards = bad.cards.filter((c: any) => !ids.includes(c.id));
  const errors = checkPoisonCards(bad).errors;
  assert.ok(errors.some((e) => e.includes('毒牌只有')), '删牌回退必须判红：' + errors.join('；'));
});

test('负样本：把最强毒牌退回 2 层 ⇒ 判红（强档核心丢失）', () => {
  const bad = clone(themes[3]);
  const cards = collectPoisonCards(bad);
  const target = cards[cards.length - 1];
  assert.ok(target !== undefined, '主题里应有毒牌');
  const card = cardOf(bad, target.id);
  setFirstPoisonLayers(card, POISON_STRONG_LAYERS - 1);
  card.text = card.text.replace(/中毒 \d+ 层/, '中毒 ' + String(POISON_STRONG_LAYERS - 1) + ' 层');
  const errors = checkPoisonCards(bad).errors;
  assert.ok(errors.some((e) => e.includes('强档核心丢失')), '强档核心丢失必须判红：' + errors.join('；'));
});
