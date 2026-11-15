// B78（T17）：IR 顶层键的**可追溯覆盖差集**元守卫。
//
// 病灶不是「board 现在错了」，而是「新字段进了 IR 却没人逐字核对」——
// 现查（T0）：`grep board tools/parity-check.mjs` **零命中**，而 ir-validate 只判
// board 结构（格数 / peakIndex / gateTrialIds 引用，`:119-131`）⇒ `tiles[].name`、
// `gateFee`、`branchTo` 与 theme.json 的逐字一致性**无人核对**。
// B77 的 trials[].text 与本次的 board 是同一形状：生成链上一致，链上不设防，改一天就漂。
//
// 判据形状：每个 IR 顶层键要么被**逐字可追溯**覆盖，要么显式登记为结构校验并**给出原因**
// ——「没人认领的键」和「匿名白名单」都不许存在。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { IR_TOP_KEYS, STRUCTURAL_KEYS, STRUCTURAL_KEYS_MAP, TRACEABLE_KEYS, validateIr } from '../../tools/ir-validate.mjs';
import { SCALES } from '../../engine/scales.ts';

test('元守卫：每个 IR 顶层键要么逐字可追溯、要么带原因登记为结构校验', () => {
  const unclaimed = IR_TOP_KEYS.filter((k: string) => !TRACEABLE_KEYS.includes(k) && !STRUCTURAL_KEYS.includes(k));
  assert.deepEqual(unclaimed, [], '未认领的键 ⇒ 加逐字检查，或进 STRUCTURAL_KEYS_MAP（必须写原因）');
});

test('STRUCTURAL_KEYS 每一项都带原因（不许用白名单藏漏检）', () => {
  for (const k of STRUCTURAL_KEYS) {
    const why = STRUCTURAL_KEYS_MAP[k];
    assert.ok(typeof why === 'string' && why.length >= 8, `${k} 的原因太短，不足以让人判断它是否该被逐字核对`);
  }
  assert.deepEqual([...STRUCTURAL_KEYS].sort(), Object.keys(STRUCTURAL_KEYS_MAP).sort(), '两份清单必须同源');
});

test('board 已纳入逐字可追溯：改一个格名 ⇒ validateIr 判红（内存副本）', () => {
  const ir = JSON.parse(readFileSync(resolve('print', 'hybrid', 'ir.json'), 'utf8')) as any;
  const theme = JSON.parse(readFileSync(resolve('themes', 'hybrid', 'theme.json'), 'utf8')) as any;
  assert.deepEqual(validateIr(ir, theme, SCALES).errors, [], '前提：现值零错误');
  const target = ir.board.tiles[5] as { index: number };
  const bad = { ...ir, board: { ...ir.board, tiles: ir.board.tiles.map((t: any, i: number) => (i === 5 ? { ...t, name: '改过的格名' } : t)) } };
  const errs = validateIr(bad, theme, SCALES).errors;
  // ⚠️ 用**格号字段**断言，不是数组下标：tiles[5] 的 index 是 6（1-based），写成 5 会漏判。
  assert.ok(errs.some((e: string) => e.includes('name') && e.includes(String(target.index))), errs.join('; '));
});

test('board 的 gateFee / branchTo 同样逐字核对（各一条负样本）', () => {
  const ir = JSON.parse(readFileSync(resolve('print', 'urban-psych', 'ir.json'), 'utf8')) as any;
  const theme = JSON.parse(readFileSync(resolve('themes', 'urban-psych', 'theme.json'), 'utf8')) as any;
  const gateIdx = ir.board.tiles.find((t: any) => typeof t.gateFee === 'number').index;
  const badFee = { ...ir, board: { ...ir.board, tiles: ir.board.tiles.map((t: any) => (t.index === gateIdx ? { ...t, gateFee: (t.gateFee ?? 0) + 1 } : t)) } };
  assert.ok(validateIr(badFee, theme, SCALES).errors.some((e: string) => e.includes('gateFee')), 'gateFee 漂移必须判红');
  const branchIdx = ir.board.tiles.find((t: any) => Array.isArray(t.branchTo) && t.branchTo.length > 0).index;
  const badBranch = { ...ir, board: { ...ir.board, tiles: ir.board.tiles.map((t: any) => (t.index === branchIdx ? { ...t, branchTo: [999] } : t)) } };
  assert.ok(validateIr(badBranch, theme, SCALES).errors.some((e: string) => e.includes('branchTo')), 'branchTo 漂移必须判红');
});
