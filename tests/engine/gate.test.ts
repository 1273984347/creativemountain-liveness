// 关隘通道（规格 §3.5，B18）的回归测试。
//
// 覆盖六件事：① 待过闸判定；② 付费通道成功；③ 付费通道灵枢不足被拒；
//   ④ 试炼通道成功（抽牌 + 执行效果树）；⑤ **引擎层门禁**（停在关隘上时其它行动一律被拒）；
//   ⑥ 自动解算出口（AI / 脚本用）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { autoResolveGate, pendingGate, resolveGate } from '../../engine/core/gate.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import type { ThemePack } from '../../engine/types/theme.ts';

/** 6 号格 = 落雁关（标价 3，试炼池 t_sword / t_mirror）。 */
const GATE_INDEX = 6;
const GATE_FEE = 3;

/** 装主题并把座 0 放到关隘格上（`resource` 可调，用于灵枢不足的分支）。 */
function gateScene(resource = 10): State {
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  const s0 = installTheme(createInitialState({ players: 4, seed: 7, deckSize: 40 }), theme);
  return {
    ...s0,
    players: s0.players.map((p) => (p.seat === 0 ? { ...p, position: GATE_INDEX, resource } : p)),
  };
}

test('B18：停在未通过的关隘 ⇒ 待过闸判定成立；通过后失效', () => {
  const s = gateScene();
  const tile = pendingGate(s, 0);
  assert.ok(tile !== null, '座 0 站在关隘格上 ⇒ 应有待过闸');
  assert.equal(tile?.index, GATE_INDEX);
  assert.equal(tile?.gate?.fee, GATE_FEE);
  assert.equal(pendingGate(s, 1), null, '别的座位不在关隘格上 ⇒ 不待过闸');
  const paid = resolveGate(s, 0, 'pay');
  assert.equal(paid.ok, true);
  assert.equal(pendingGate(paid.state, 0), null, '通过后不再待过闸');
});

test('B18：付费通道 —— 扣标价、记通过标记', () => {
  const s = gateScene(10);
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, true, '付费通道应通过：' + String(r.note));
  assert.equal(r.passed, true);
  const p0 = r.state.players[0];
  assert.equal(p0?.resource, 10 - GATE_FEE, '应扣掉标价');
  assert.equal(p0?.flags[`gate_${String(GATE_INDEX)}`], true, '应记录通过标记');
});

test('B18：付费通道 —— 灵枢不足 ⇒ 拒绝且状态不变', () => {
  const s = gateScene(1);
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, false, '灵枢不足必须被拒');
  assert.equal(r.state, s, '被拒时状态必须原样返回（无副作用）');
  assert.match(String(r.note), /灵枢不足/);
});

test('B18：试炼通道 —— 公开抽牌 + 执行效果树 + 记通过标记', () => {
  const s = gateScene(1);
  const r = resolveGate(s, 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应通过：' + String(r.note));
  const p0 = r.state.players[0];
  assert.equal(p0?.flags[`gate_${String(GATE_INDEX)}`], true, '应记录通过标记');
  assert.ok(typeof p0?.flags[`trial_${String(GATE_INDEX)}`] === 'string', '应记录抽到的试炼牌 id');
  assert.ok(r.state.log.some((l) => l.kind === 'trial'), '应留下试炼日志');
});

test('B18：引擎层门禁 —— 停在关隘上时，行棋/问天/出牌一律被拒', () => {
  const s = gateScene();
  assert.equal(performAction(s, 0, 'move'), s, '关隘未过时不得行棋（否则可反复移动免费穿关）');
  assert.equal(performAction(s, 0, 'ask'), s, '关隘未过时不得问天');
  assert.equal(performAction(s, 0, 'act', { cardId: 'x' }), s, '关隘未过时不得出牌');
});

test('B18-c：关隘试炼发的牌当场裁到手牌上限（结算期通道选择不破坏手牌上限）', () => {
  // ⚠️ 根因（实测定位）：超限者**全部停在关隘格**、且只超 **1 张牌**
  //   ⇒ 关隘 6 的试炼牌 `t_sword` 无论成败都 `draw_cards(1)`；
  //   而试炼通道发生在**手番结算之后** ⇒ 手番末的裁牌已跑完、回合末裁牌又被阻塞延后 ⇒ 超限。
  const s = gateScene(1); // 灵枢 1 ⇒ 付费不够，只能走试炼
  const p0 = s.players[0];
  assert.ok(p0 !== undefined);
  // 把座 0 的手牌填满上限（不填满则「超限」测不出来）
  const full = { ...p0, hand: [...p0.hand, ...p0.hand].slice(0, p0.hpMax) };
  const fullState = { ...s, players: s.players.map((p) => (p.seat === 0 ? full : p)) };
  assert.equal(fullState.players[0]?.hand.length, fullState.players[0]?.hpMax, '前置：手牌应已满');
  const r = resolveGate(fullState, 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应通过：' + String(r.note));
  const after = r.state.players[0];
  assert.ok(
    (after?.hand.length ?? 99) <= (after?.hpMax ?? 0),
    '试炼发的牌必须当场裁到手牌上限内：' + String(after?.hand.length) + '/' + String(after?.hpMax),
  );
});

test('B18：自动解算出口 —— 灵枢够就付费，不够走试炼', () => {
  const rich = autoResolveGate(gateScene(10), 0);
  assert.equal(rich.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true);
  assert.equal(rich.players[0]?.resource, 10 - GATE_FEE, '灵枢够 ⇒ 自动付费');
  const poor = autoResolveGate(gateScene(0), 0);
  assert.equal(poor.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true, '灵枢不足 ⇒ 自动走试炼');
  assert.equal(poor.players[0]?.resource, 0, '试炼通道不扣灵枢');
});
