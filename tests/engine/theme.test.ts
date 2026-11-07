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

test('派生器从 theme.ts 解析出全部算子（57）与谓词（15）与 goal（8）', () => {
  assert.equal(schema.opNames.length, 57);
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
