// 关隘试炼通过率专项指标（B23）的引擎层回归。
//
// 覆盖三件事：① 试炼日志带**结构化字段**（`trialId` / `trialPassed`）⇒ 平衡模拟可不解析文案统计；
//   ② 骰子型试炼的实测通过率与**理论期望**一致（小样本，宽松阈值）；
//   ③ 试炼失败 ⇒ 写「本关改为付费」标记（挑战型语义，不会静默变成「永远通过」）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { resolveGate } from '../../engine/core/gate.ts';
import type { ThemePack } from '../../engine/types/theme.ts';

function themeOf(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

/**
 * 造一个「站在某座关隘上、试炼池只剩指定牌」的确定性局面。
 *
 * ⚠️ 用 **8 人局**（36 格 / 4 座关隘）⇒ 30 号关隘也在（4 人局只有 28 格 / 3 座）。
 */
function trialScene(theme: ThemePack, trialId: string, gateIndex: number, seed: number, resource = 0): State {
  const s0 = installTheme(createInitialState({ players: 8, seed, deckSize: theme.counts.deckTotal }), theme);
  return {
    ...s0,
    decks: { ...s0.decks, trial: s0.decks.trial.filter((c) => c.id === trialId) },
    players: s0.players.map((p) => (p.seat === 0 ? { ...p, position: gateIndex, resource } : p)),
  };
}

test('B23：试炼日志带结构化字段（trialId / trialPassed）—— 通过率可不解析文案统计', () => {
  const theme = themeOf('xianxia2026');
  // t_toll 的判定是「灵枢 ≥ 4」⇒ 灵枢 0 ⇒ 必失败
  const r = resolveGate(trialScene(theme, 't_toll', 30, 7), 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应被受理：' + String(r.note));
  const entry = r.state.log.find((l) => l.kind === 'trial');
  assert.ok(entry !== undefined, '应有试炼日志条目');
  assert.equal(entry?.trialId, 't_toll', '日志应带试炼牌 id');
  assert.equal(entry?.trialPassed, false, 't_toll 判定失败 ⇒ trialPassed 应为 false');
  assert.equal(r.state.players[0]?.flags['gate_pay_30'], true, '失败 ⇒ 写「本关改为付费」标记');
});

test('B23：骰子型试炼的实测通过率与理论期望一致（小样本，宽松阈值）', () => {
  const theme = themeOf('xianxia2026');
  // t_star：指令骰 ≥ 12/20 ⇒ 理论通过率 45%
  const times = 120;
  let passes = 0;
  for (let i = 0; i < times; i++) {
    const r = resolveGate(trialScene(theme, 't_star', 30, 90000 + i * 131), 0, 'trial');
    if (r.passed) { passes += 1; }
  }
  const rate = (passes / times) * 100;
  assert.ok(Math.abs(rate - 45) <= 18,
    '通过率 ' + rate.toFixed(1) + '% 应接近理论 45%（样本 ' + String(times) + '）');
  assert.ok(passes > 0 && passes < times, '两种结果都应出现（既不全过也不全败）');
});
