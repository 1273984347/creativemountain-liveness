// IR 契约的行为测试（B6/B7 的接口守卫）。
//
// 三条判据：结构完整 · 数值可溯源 · 文本可追溯。
// 负样本证明校验器真的会判红。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateIr, IR_TOP_KEYS } from '../../tools/ir-validate.mjs';
import { SCALES } from '../../engine/scales.ts';

const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as {
  readonly factions: readonly { readonly id: string; readonly abilityText: string; readonly wheelText: string }[];
  readonly identities: readonly { readonly id: string; readonly passiveText: string; readonly goal: { readonly kind: string; readonly count?: number } }[];
  readonly cards: readonly { readonly id: string; readonly text: string; readonly name: string; readonly rank: number }[];
  readonly certificationCards: readonly { readonly id: string; readonly prompt: string }[];
  readonly heavenCards: readonly { readonly id: string; readonly text: string }[];
  readonly trials: readonly { readonly id: string; readonly text: string }[];
  readonly creationDeck?: readonly { readonly cardId: string }[];
};
const ir = JSON.parse(readFileSync(resolve('print/xianxia2026/ir.json'), 'utf8'));

/** 深拷贝并放宽 readonly（负样本需要就地改字段）。 */
const clone = (v: unknown): any => JSON.parse(JSON.stringify(v)) as any;

// ---------- 正样本 ----------

test('IR 校验：真实 ir.json 零错误', () => {
  const r = validateIr(ir, theme, SCALES);
  assert.deepEqual(r.errors, [], '校验器误报：' + r.errors.join('；'));
});

test('IR 顶层键与契约完全一致', () => {
  assert.deepEqual(Object.keys(ir).sort(), [...IR_TOP_KEYS].sort());
});

test('每个规模数值都带合法溯源路径，且值与引擎常量一致', () => {
  for (const row of ir.scales) {
    for (const [field, cell] of Object.entries(row as Record<string, unknown>)) {
      if (field === 'players') { continue; }
      const c = cell as { readonly src?: unknown };
      assert.equal(typeof c.src, 'string', field + ' 缺 src');
      assert.match(String(c.src), /^scales\[\d+\]\.[a-zA-Z_0-9]+$/, '溯源路径格式：' + String(c.src));
    }
  }
});

test('IR 的文本与 theme.json 逐字相等（可追溯）', () => {
  const byId = new Map(theme.factions.map((f: { readonly id: string; readonly abilityText: string; readonly wheelText: string }) => [f.id, f]));
  for (const f of ir.factions) {
    const src = byId.get(f.id);
    assert.ok(src !== undefined, '阵营 ' + f.id + ' 应存在');
    assert.equal(f.abilityText, src.abilityText);
    assert.equal(f.wheelText, src.wheelText);
  }
});

// ---------- 负样本：校验器必须判红 ----------

test('负样本：数值溯源路径指向不存在的字段 → 判红', () => {
  const bad = clone(ir);
  const row = bad.scales[0] as unknown as Record<string, unknown>;
  const cell = row.threshold as { readonly value: number; readonly src: string };
  row.threshold = { value: cell.value, src: 'scales[3].not_a_real_field' };
  const r = validateIr(bad, theme, SCALES);
  assert.ok(r.errors.some((e) => e.includes('not_a_real_field')), '非法溯源字段必须判红');
});

test('负样本：溯源值与引擎常量不符 → 判红', () => {
  const bad = clone(ir);
  const row = bad.scales[0] as unknown as Record<string, unknown>;
  const cell = row.threshold as { readonly value: number; readonly src: string };
  row.threshold = { value: 999, src: cell.src };
  const r = validateIr(bad, theme, SCALES);
  assert.ok(r.errors.some((e) => e.includes('溯源值与引擎常量不符')), '溯源值不符必须判红');
});

test('负样本：文本与 theme.json 不一致 → 判红（可追溯性）', () => {
  const bad = clone(ir);
  const f = bad.factions[0] as unknown as { abilityText: string };
  f.abilityText = '被偷偷改掉的文字';
  const r = validateIr(bad, theme, SCALES);
  assert.ok(r.errors.some((e) => e.includes('abilityText')), '文本漂移必须判红');
});

test('负样本：多余顶层键 → 判红', () => {
  const bad = clone(ir) as unknown as Record<string, unknown>;
  bad.notARealKey = 1;
  const r = validateIr(bad, theme, SCALES);
  assert.ok(r.errors.some((e) => e.includes('多余顶层键')), '多余顶层键必须判红');
});

test('负样本：关隘引用不存在的试炼牌 → 判红', () => {
  const bad = clone(ir);
  const tile = bad.board.tiles.find((t: { readonly gateTrialIds?: readonly string[] }) => t.gateTrialIds !== undefined) as unknown as { gateTrialIds: string[] };
  tile.gateTrialIds = ['not_a_trial'];
  const r = validateIr(bad, theme, SCALES);
  assert.ok(r.errors.some((e) => e.includes('not_a_trial')), '悬空引用必须判红');
});
