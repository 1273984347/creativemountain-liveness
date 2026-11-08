// B4 主题包校验器的行为契约（规格 §6.5 / 实施计划 §5.2）
//
// 核心判据：**校验器的判据全部从 engine/types/theme.ts 派生**，
// 不存在手抄的第二事实源。本文件用负样本证明这条链路真的成立。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveThemeSchema, unionMembers, readThemeSource } from '../../tools/theme-schema.mjs';
import { validateTheme } from '../../tools/theme-validate.mjs';

const THEME_PATH = resolve('themes/xianxia2026/theme.json');
const theme = JSON.parse(readFileSync(THEME_PATH, 'utf8'));
const schema = deriveThemeSchema();

// ---------- 派生器本身 ----------

test('派生器从 theme.ts 解析出全部算子（58）与谓词（15）与 goal（8）', () => {
  assert.equal(schema.opNames.length, 58);
  assert.equal(schema.predicateNames.length, 15);
  assert.equal(schema.goalKinds.length, 8);
  assert.equal(schema.cardTypes.length, 4);
  assert.equal(schema.negativeStatuses.length, 4);
});

test('派生器解析出算子的必填/可选参数', () => {
  assert.deepEqual(schema.ops.gain_resource, { required: ['amount'], optional: [] });
  assert.deepEqual(schema.ops.draw_cards, { required: ['count'], optional: ['target'] });
  assert.deepEqual(schema.ops.conditional, { required: ['pred', 'then'], optional: ['else'] });
});

test('派生器是源码派生的——改 theme.ts 的 OpName 会改变派生结果', () => {
  const src = readThemeSource();
  const before = unionMembers(src, 'OpName').length;
  const mutated = src.replace("  | 'gain_resource'", "  | 'gain_resource'\n  | 'zzz_probe_op'");
  const after = unionMembers(mutated, 'OpName').length;
  assert.equal(after, before + 1, '派生结果必须随源码变化');
});

// ---------- 校验器判红（负样本）----------

test('合法主题包 → 零错误', () => {
  const r = validateTheme(theme, schema);
  assert.deepEqual(r.errors, [], `校验器误报：${r.errors.join('；')}`);
});

test('未注册的算子 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'not_a_real_op', amount: 1 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('not_a_real_op')), '未注册算子必须判红');
});

test('缺少必填参数 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'gain_resource' }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('必填参数')), '缺必填参数必须判红');
});

test('多余参数 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'gain_resource', amount: 1, bogus: 1 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('多余参数')), '多余参数必须判红');
});

test('未注册的 goal kind → 判红', () => {
  const bad = structuredClone(theme);
  bad.identities[0].goal = { kind: 'not_a_goal', count: 1 };
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('goal.kind')), '非法 goal kind 必须判红');
});

test('rank 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].rank = 99;
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('rank')), 'rank 越界必须判红');
});

// ---------- 谓词参数取值（B8 补：谓词**名**合法 ≠ **参数取值**合法）----------

test('phase_is 的 value 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'phase_is', value: 'dusk' },
    then: { op: 'draw_cards', count: 1 },
  }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('phase_is')), '非法 phase_is 取值必须判红');
});

test('card_type_is 的 type 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'card_type_is', type: 'spell' },
    then: { op: 'draw_cards', count: 1 },
  }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('card_type_is')), '非法 card type 必须判红');
});

test('tile_kind 谓词 → 判红（参数名与判别字段冲突，当前不可用）', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'tile_kind', tileKind: 'plain' },
    then: { op: 'draw_cards', count: 1 },
  }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('tile_kind')), 'tile_kind 谓词必须判红');
});

test('hand_count 的 op 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'hand_count', count: 3, op: 'between' },
    then: { op: 'draw_cards', count: 1 },
  }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('hand_count')), '非法比较运算符必须判红');
});

test('has_card 的 filter.type 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'has_card', filter: { type: 'spell' } },
    then: { op: 'draw_cards', count: 1 },
  }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('filter')), '非法 filter 取值必须判红');
});

// ---------- 效果参数取值域（B8 补：原先只校验参数**名**合法）----------

test('效果 amount 为负 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'damage', amount: -5, target: 0 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('amount')), '负数 amount 必须判红');
});

test('效果 amount 非整数 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'gain_resource', amount: 'abc' }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('amount')), '非整数 amount 必须判红');
});

test('immunity 的 status 不在负面状态白名单 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'immunity', status: 'zombie', amount: 1 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('immunity')), '非法 status 必须判红');
});

test('move_to_tile 的 tileIndex 越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'move_to_tile', tileIndex: 999 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('tileIndex')), '越界格号必须判红');
});

test('引用不存在的卡牌 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'exhaust_card', cardId: 'c_not_exist' }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('不存在的卡牌')), '悬空卡牌引用必须判红');
});

test('spirit_wheel 的 source 非法 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'spirit_wheel', source: 'whatever' }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('spirit_wheel')), '非法 source 必须判红');
});

test('target 座位越界 → 判红', () => {
  const bad = structuredClone(theme);
  bad.cards[0].effects = [{ op: 'damage', amount: 1, target: 99 }];
  const r = validateTheme(bad, schema);
  assert.ok(r.errors.some((e) => e.includes('target')), '越界座位必须判红');
});

test('合法谓词参数 → 不判红（B8 新增的白名单不得误伤）', () => {
  const ok = structuredClone(theme);
  ok.cards[0].effects = [{
    op: 'conditional',
    pred: { kind: 'phase_is', value: 'night' },
    then: { op: 'draw_cards', count: 1 },
    else: { op: 'gain_resource', amount: 2 },
  }];
  const r = validateTheme(ok, schema);
  assert.deepEqual(r.errors, [], `合法谓词被误报：${r.errors.join('；')}`);
});
