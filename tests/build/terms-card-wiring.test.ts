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
import { termsOf } from '../../build/build-ir.mjs';

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

// ---- B79 §3.2（T6）：印刷层取词也归一 ----
//
// `termsOf()` 六个键各带一条 `?? '兜底词'`，而兜底词与**任何一套主题都不等**
// （`peak ?? '峰顶'` —— 基准实印「封顶台」；`hp ?? '体力'` —— 四套没一个叫这个）
// ⇒ 它不是「安全默认值」，是**第三套词**：门⑤ 一旦漏跑，规则书就印出谁的主题都不是的句子。
// 只判「没有 ??」是不够的——那等于允许它继续从 `glossary` 取词，而本批要的是一层取词。
const IR_SRC = readFileSync('build/build-ir.mjs', 'utf8');
const TERMSOF_BODY = IR_SRC.slice(IR_SRC.indexOf('export function termsOf'), IR_SRC.indexOf('/** 目标文本'));
const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];

test('B79：termsOf 不再有 ?? 兜底，且取词来源换成 theme.terms', () => {
  assert.ok(TERMSOF_BODY.length > 60, `前提：定位得到 termsOf 函数体（截到 ${String(TERMSOF_BODY.length)} 字符）`);
  assert.equal(/ \?\? /.test(TERMSOF_BODY), false, `仍有兜底：\n${TERMSOF_BODY}`);
  assert.ok(TERMSOF_BODY.includes('theme.terms'), '仍从 glossary 取词就不是「单一取词层」');
  assert.equal(TERMSOF_BODY.includes('theme.glossary'), false, 'termsOf 不许再读 glossary（它退回印刷层对照表）');
  assert.ok(TERMSOF_BODY.includes('theme.meta.deckName'), 'deck 继续来自 meta.deckName（单张牌名 ≠ 牌库名，见 B79 §3.2）');
});

test('B79：换来源不换值——termsOf 五叶输出 ≡ theme.terms（四套逐字）', () => {
  for (const id of IDS) {
    const theme = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8')) as
      { meta: { deckName: string }; terms: Record<string, string> };
    const t = termsOf(theme) as Record<string, string>;
    for (const k of ['hp', 'resource', 'gate', 'peak', 'path']) {
      assert.equal(t[k], theme.terms[k], `${id}：termsOf().${k}(${t[k]}) ≢ terms.${k}(${theme.terms[k]})`);
    }
    assert.equal(t.deck, theme.meta.deckName, `${id}：deck 取值来源变了 ⇒ 牌面文案会跟着漂`);
  }
});

