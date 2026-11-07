// 谓词契约测试（规格 §6.4）
//
// B8 回归重点：`phase_is` 必须判定**全局昼夜阶段值** `state.phaseValue`，与 `set_phase` 配对。
// 原实现读的是回合阶段枚举（`Phase` = 天机/行动/山议/认证/终局），
// 而 `set_phase` 写入的是 §6.2 的 `phaseValue`（night/day）——
// 两者永不相等 ⇒ 天机牌「本回合为夜/昼」的机制对任何谓词都不可见。
//
// 这条用例是**常驻**的：任何人再把 `phase_is` 改回读 `state.phase`，这里立刻判红。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../../engine/core/state.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { evaluatePredicate } from '../../engine/predicates.ts';

const base = () => createInitialState({ players: 3, seed: 1, deckSize: 10 });

test('phase_is 判定 state.phaseValue（与 set_phase 配对）', () => {
  const s0 = base();
  assert.equal(s0.phaseValue, 'day', '初始为昼');
  assert.equal(evaluatePredicate({ state: s0, actor: 0 }, { kind: 'phase_is', value: 'day' }), true);
  assert.equal(evaluatePredicate({ state: s0, actor: 0 }, { kind: 'phase_is', value: 'night' }), false);

  const night = applyEffect({ state: s0, actor: 0 }, { op: 'set_phase', value: 'night' }).state;
  assert.equal(night.phaseValue, 'night');
  assert.equal(evaluatePredicate({ state: night, actor: 0 }, { kind: 'phase_is', value: 'night' }), true);
  assert.equal(evaluatePredicate({ state: night, actor: 0 }, { kind: 'phase_is', value: 'day' }), false);
});

test('conditional 按 phase_is 分岔（引擎侧回归）', () => {
  const s0 = base();
  const eff = {
    op: 'conditional',
    pred: { kind: 'phase_is', value: 'night' },
    then: { op: 'gain_resource', amount: 2 },
    else: { op: 'draw_cards', count: 2 },
  } as const;

  const dayResult = applyEffect({ state: s0, actor: 0 }, eff).state;
  const nightResult = applyEffect(
    { state: { ...s0, phaseValue: 'night' }, actor: 0 },
    eff,
  ).state;

  const dayPlayer = dayResult.players[0];
  const nightPlayer = nightResult.players[0];
  assert.ok(dayPlayer !== undefined && nightPlayer !== undefined);
  assert.equal(dayPlayer.resource, s0.players[0]?.resource, '昼分支不应加资源');
  assert.equal(nightPlayer.resource, (s0.players[0]?.resource ?? 0) + 2, '夜分支应加 2 资源');
});

test('天机牌「本回合为夜/昼」机制真的可被谓词观测', () => {
  const s0 = base();
  const dusk = applyEffect({ state: s0, actor: 0 }, { op: 'set_phase', value: 'night' }).state;
  const dawn = applyEffect({ state: s0, actor: 0 }, { op: 'set_phase', value: 'day' }).state;
  assert.equal(evaluatePredicate({ state: dusk, actor: 0 }, { kind: 'phase_is', value: 'night' }), true);
  assert.equal(evaluatePredicate({ state: dawn, actor: 0 }, { kind: 'phase_is', value: 'day' }), true);
});
