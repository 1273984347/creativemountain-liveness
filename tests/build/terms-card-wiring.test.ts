// B78 §4 R4：`terms` 必须真驱动**卡面**，不只是题面。
//
// ⚠️ 判据形状为什么是「变异式接线探针」，而不是「跨套 terms 全同即红」：
//   现查四套的 terms.types / terms.colors **逐字全同**（位移/攻击/防御/功能 + 红/黑），
//   「两套全同即红」会在施工第一天把门 ⑧ 自己判红（规格 r1 已作废那条判据）。
//   历史实证：B22 记录里仙侠旧称是「身法 / 攻伐 / 守御 / 机巧」⇒ 一旦某套换词而卡面
//   不换，同一张牌就题面一个词、卡面另一个词。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderEffect, renderPredicate, termWord } from '../../build/theme-render.mjs';

const RENDER = readFileSync('build/theme-render.mjs', 'utf8');

const TERMS = {
  hp: '灵力', deck: '符箓', resource: '灵枢', gate: '关隘',
  types: { motion: '位移', attack: '攻击', defense: '守御', utility: '功能' },
  colors: { red: '红', black: '黑' },
  statuses: { poison: '中毒', slow: '减速', silence: '封口' },
};

test('R4：内置类型词/状态词表已退役（两张表都不许回来）', () => {
  assert.equal(/TYPE_CN\s*=\s*\{/.test(RENDER), false, 'TYPE_CN 应删除，改走 terms.types');
  assert.equal(/STATUS_CN\s*=\s*\{/.test(RENDER), false, 'STATUS_CN 应删除，改走 terms.statuses');
});

test('R4：变异接线探针——把 types.defense 换成「守御」，卡面条件句必须跟着变', () => {
  const t = renderPredicate({ kind: 'card_type_is', type: 'defense' }, TERMS);
  assert.ok(t.includes('守御'), `卡面仍是「防御」⇒ 还在回退内置词：[${t}]`);
  assert.equal(t.includes('防御'), false, '内置词与词表词同时出现 = 接线只做了一半');
});

test('R4：statuses 三叶，第四叶缺位时抛错（无读取点的字段不建）', () => {
  assert.equal(termWord(TERMS.statuses, 'poison', 'statuses'), '中毒');
  assert.throws(() => termWord(TERMS.statuses, 'skip_turn', 'statuses'), /缺 statuses\.skip_turn/);
  // 三处名词骨架真的走词表（silence/slow/poison 各一）
  assert.ok(renderEffect({ op: 'silence', amount: 1, target: 0 }, TERMS).includes('封口'));
  assert.ok(renderEffect({ op: 'slow', amount: 1, target: 0 }, TERMS).includes('减速'));
  assert.ok(renderEffect({ op: 'poison', amount: 2, target: 0 }, TERMS).includes('中毒'));
  // immunity 的名词位走词表；**数据里今天没有 immunity(skip_turn)**，缺叶必须抛错而不是静默
  assert.ok(renderEffect({ op: 'immunity', status: 'silence', amount: 1 }, TERMS).includes('免疫封口'));
  assert.throws(() => renderEffect({ op: 'immunity', status: 'skip_turn', amount: 1 }, TERMS), /缺 statuses\.skip_turn/);
});
