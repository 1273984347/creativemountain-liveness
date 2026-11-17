// 关隘通道**余量规则**（B24）的引擎层回归。
//
// 覆盖：① 付费后仍余 ≥ 2 资源 ⇒ AI 直接付费；② 付得起但会掏空 ⇒ AI 改走**试炼**（博一把）；
//   ③ 余量不足 + 试炼失败 ⇒ 本关改为付费 ⇒ 再付费即通过；④ 已改为付费的关隘 ⇒ 引擎层**拒绝**
//   再试炼 / 再比牌；⑤ 完全付不起 ⇒ 仍走试炼（B22 既有行为不变）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { autoResolveGate, canPayGateWithReserve, resolveCompareGate, resolveGate } from '../../engine/core/gate.ts';
import type { Card, ThemePack } from '../../engine/types/theme.ts';

const THEME = 'xianxia2026';

function themeOf(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

/**
 * 造一个「站在某座关隘上」的确定性局面。
 *
 * ⚠️ 用 **8 人局**（36 格 / 4 座关隘）⇒ 22 / 30 号关隘也在（4 人局只有 28 格 / 3 座）。
 * @param trials 只保留这些试炼牌（`null` = 保留全部）
 * @param hand 手牌（`null` = 沿用初始手牌）
 */
function gateScene(gateIndex: number, resource: number, trials: readonly string[] | null = null, hand: readonly Card[] | null = null): State {
  const theme = themeOf(THEME);
  const s0 = installTheme(createInitialState({ players: 8, seed: 7, deckSize: theme.counts.deckTotal }), theme);
  return {
    ...s0,
    decks: trials === null ? s0.decks
      : { ...s0.decks, trial: s0.decks.trial.filter((c) => trials.includes(c.id)) },
    players: s0.players.map((p) => (p.seat === 0
      ? { ...p, position: gateIndex, resource, hand: hand === null ? p.hand : [...hand] }
      : p)),
  };
}

test('B24：余量判据 —— 付费后仍余 ≥ 2 资源才算体面付费', () => {
  assert.equal(canPayGateWithReserve(6, 4), true, '付 4 剩 2 ⇒ 体面');
  assert.equal(canPayGateWithReserve(5, 4), false, '付 4 剩 1 ⇒ 余量不足');
  assert.equal(canPayGateWithReserve(4, 4), false, '付 4 剩 0 ⇒ 余量不足');
  assert.equal(canPayGateWithReserve(3, 4), false, '付不起 ⇒ 不足');
});

test('B24：余量充足 ⇒ AI 直接付费（不走试炼）', () => {
  const s = gateScene(14, 6);
  const r = autoResolveGate(s, 0);
  assert.equal(r.players[0]?.flags['gate_14'], true, '应付费通过');
  assert.equal(r.players[0]?.resource, 2, '应扣掉标价 4');
  assert.equal(r.log.some((l) => l.kind === 'trial'), false, '不该走试炼通道');
});

test('B24：余量不足（付得起但会掏空）⇒ AI 改走试炼', () => {
  // 14 号关标价 4；资源 5 ⇒ 付完只剩 1 < 余量 2 ⇒ 走试炼。
  const s = gateScene(14, 5, ['t_sutra']);
  const r = autoResolveGate(s, 0);
  assert.equal(r.log.some((l) => l.kind === 'trial'), true, '应走试炼通道（博一把）');
  assert.equal(typeof r.players[0]?.flags['trial_14'], 'string', '应记录抽到的试炼牌');
});

test('B24：余量不足 + 试炼失败 ⇒ 本关改为付费 ⇒ 再付费即通过', () => {
  // 22 号关标价 4；资源 4 ⇒ 付完剩 0 < 余量 2 ⇒ 走试炼；t_silent 判定「手上有守御类牌」
  // 而手牌被清空 ⇒ 必失败 ⇒ 本关改为付费 ⇒ 之后付费即通过（余量规则的语义：先博一把）。
  const s = gateScene(22, 4, ['t_silent'], []);
  const r1 = autoResolveGate(s, 0);
  assert.equal(r1.players[0]?.flags['gate_pay_22'], true, '试炼失败 ⇒ 应写「本关改为付费」');
  assert.notEqual(r1.players[0]?.flags['gate_22'], true, '未通过 ⇒ 不写通过标记');
  const r2 = resolveGate(r1, 0, 'pay');
  assert.equal(r2.ok, true, '付费通道应受理');
  assert.equal(r2.passed, true, '应通过关隘');
  assert.equal(r2.state.players[0]?.flags['gate_22'], true, '应写通过标记');
});

test('B24：已改为付费的关隘 ⇒ 引擎层拒绝再试炼 / 再比牌', () => {
  const s = gateScene(22, 4, ['t_silent'], []);
  const r1 = autoResolveGate(s, 0);
  assert.equal(r1.players[0]?.flags['gate_pay_22'], true);
  const trial = resolveGate(r1, 0, 'trial');
  assert.equal(trial.ok, false, '已改为付费 ⇒ 试炼通道应被引擎拒绝');
  const cardId = r1.players[0]?.hand[0]?.id ?? '';
  const cmp = resolveCompareGate(r1, 0, cardId, 1);
  assert.equal(cmp.ok, false, '已改为付费 ⇒ 比对通道应被引擎拒绝');
});

test('B24：完全付不起 ⇒ 仍走试炼（B22 既有行为不变）', () => {
  const s = gateScene(14, 0, ['t_sutra']);
  const r = autoResolveGate(s, 0);
  assert.equal(r.log.some((l) => l.kind === 'trial'), true, '付不起 ⇒ 走试炼');
});

test('B24：付费通道本身不受余量规则影响（玩家显式付费照常通过）', () => {
  // 规则只约束 **AI 自动解算**；玩家显式选付费时按标价扣资源（余量不足也允许）。
  const s = gateScene(14, 4);
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, true, '玩家付费应受理');
  assert.equal(r.passed, true);
  assert.equal(r.state.players[0]?.resource, 0, '应扣掉标价 4');
});
