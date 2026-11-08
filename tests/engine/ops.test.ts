// B2 机制原语的行为契约（规格 §6.4）

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState } from '../../engine/core/state.ts';
import { OPS, applyEffect, type OpContext } from '../../engine/ops/registry.ts';
import { PREDICATES, evaluatePredicate } from '../../engine/predicates.ts';
import { GOALS, isGoalAchieved } from '../../engine/goals/registry.ts';
import { OP_NAME_LIST, PREDICATE_NAME_LIST, GOAL_KIND_LIST } from '../../engine/ops/names.ts';
import { at } from './helpers.ts';

const ctx = (state = createInitialState({ players: 3, seed: 1, deckSize: 40 }), actor = 0): OpContext => ({ state, actor });

// ---------- 注册表完备性 ----------

test('全部 58 个算子均已注册且有实现（B19-b 新增 gate_fallback_pay）', () => {
  for (const name of OP_NAME_LIST) {
    assert.equal(typeof OPS[name], 'function', `算子未注册：${name}`);
  }
  assert.equal(OP_NAME_LIST.length, 58);
});

test('全部 15 个谓词均已注册且有实现', () => {
  for (const name of PREDICATE_NAME_LIST) {
    assert.equal(typeof PREDICATES[name], 'function', `谓词未注册：${name}`);
  }
  assert.equal(PREDICATE_NAME_LIST.length, 15);
});

test('全部 8 个 goal kind 均已注册且有实现', () => {
  for (const kind of GOAL_KIND_LIST) {
    assert.equal(typeof GOALS[kind].judge, 'function', `目标未注册：${kind}`);
  }
  assert.equal(GOAL_KIND_LIST.length, 8);
});

// ---------- 作用域约定 ----------

test('算子失败时 ok=false 且状态不变（不可变语义）', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'spend_resource', amount: 99 });
  assert.equal(r.ok, false);
  assert.equal(r.state, c.state, '失败时状态必须原样返回');
  assert.ok(r.note !== undefined, '失败应给出原因');
});

test('target 指向已出局玩家 → 无效操作，状态不变', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const dead = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, alive: false } : p)) };
  const r = applyEffect({ state: dead, actor: 0 }, { op: 'discard_opponent', count: 1, target: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.state, dead);
});

test('负数 amount 被拒绝', () => {
  const c = ctx();
  assert.equal(applyEffect(c, { op: 'gain_resource', amount: -1 }).ok, false);
});

// ---------- 资源类 ----------

test('gain_resource 生效且受上限 10 约束', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'gain_resource', amount: 3 });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).resource, at(c.state.players, 0).resource + 3);
  const capped = applyEffect({ state: r.state, actor: 0 }, { op: 'gain_resource', amount: 99 });
  assert.equal(at(capped.state.players, 0).resource, 10);
});

test('spend_resource 灵枢不足 → 失败且状态不变', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'spend_resource', amount: 99 });
  assert.equal(r.ok, false);
  assert.equal(r.state, c.state);
});

test('transfer_resource 在双方间转移灵枢', () => {
  const c = ctx();
  const before1 = at(c.state.players, 0).resource;
  const before2 = at(c.state.players, 1).resource;
  const r = applyEffect(c, { op: 'transfer_resource', amount: 2, target: 1 });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).resource, before1 - 2);
  assert.equal(at(r.state.players, 1).resource, before2 + 2);
});

// ---------- 位移类（§3.1 位移结算语义）----------

test('move_forward 前进指定格数', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'move_forward', amount: 3 });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).position, 3);
});

test('move_forward 越过峰顶 → clamp 在峰顶并进入待认证（到达即停）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const peak = s.board.peakIndex;
  const r = applyEffect({ state: s, actor: 0 }, { op: 'move_forward', amount: peak + 10 });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).position, peak, '应 clamp 在峰顶');
  assert.equal(at(r.state.players, 0).pendingCert, true, '到达峰顶进入待认证');
});

test('move_by_dice 按骰子点数前进并记录骰值（G1）', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'move_by_dice', faces: 6 });
  assert.equal(r.ok, true);
  const rolled = r.state.lastDice;
  assert.ok(rolled >= 1 && rolled <= 6, `骰值越界：${rolled}`);
  assert.equal(at(r.state.players, 0).position, rolled);
  const log = r.state.log[r.state.log.length - 1];
  assert.equal(log?.diceRoll, rolled, '日志必须记录骰值');
});

test('待认证者不能主动移动（§5.1 待认证锁定）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const pending = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, pendingCert: true } : p)) };
  const r = applyEffect({ state: pending, actor: 0 }, { op: 'move_forward', amount: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.state, pending);
});

// ---------- 组合器 ----------

test('sequence 顺序执行多个算子', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'sequence', effects: [
    { op: 'gain_resource', amount: 2 },
    { op: 'move_forward', amount: 1 },
  ] });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).resource, at(c.state.players, 0).resource + 2);
  assert.equal(at(r.state.players, 0).position, 1);
});

test('conditional 按谓词选分支', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'conditional',
    pred: { kind: 'resource_at_least', amount: 0 },
    then: { op: 'gain_resource', amount: 5 },
    else: { op: 'gain_resource', amount: 1 },
  });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).resource, at(c.state.players, 0).resource + 5);
});

test('conditional 条件不成立且无 else → 失败且状态不变', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'conditional',
    pred: { kind: 'resource_at_least', amount: 999 },
    then: { op: 'gain_resource', amount: 5 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.state, c.state);
});

test('count 重复执行 effect', () => {
  const c = ctx();
  const r = applyEffect(c, { op: 'count', count: 3, effect: { op: 'gain_resource', amount: 1 } });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).resource, at(c.state.players, 0).resource + 3);
});

// ---------- 谓词 ----------

test('谓词可独立求值（只读，无副作用）', () => {
  const c = ctx();
  const before = c.state;
  assert.equal(evaluatePredicate({ state: c.state, actor: 0 }, { kind: 'resource_at_least', amount: 0 }), true);
  assert.equal(evaluatePredicate({ state: c.state, actor: 0 }, { kind: 'resource_at_least', amount: 999 }), false);
  assert.equal(c.state, before, '谓词不得改变状态');
});

test('card_type_is 作用域 = 使用者手牌（缺口 G6）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  // 测试牌 type 均为 utility
  assert.equal(evaluatePredicate({ state: s, actor: 0 }, { kind: 'card_type_is', type: 'utility' }), true);
  assert.equal(evaluatePredicate({ state: s, actor: 0 }, { kind: 'card_type_is', type: 'motion' }), false);
});

test('dice_is_at_least 读 lastDice（缺口 G2）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const with15 = { ...s, lastDice: 15 };
  assert.equal(evaluatePredicate({ state: with15, actor: 0 }, { kind: 'dice_is_at_least', amount: 15, faces: 20 }), true);
  assert.equal(evaluatePredicate({ state: with15, actor: 0 }, { kind: 'dice_is_at_least', amount: 16, faces: 20 }), false);
});

test('card_color_is 读牌库顶颜色（缺口 G3）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const top = s.decks.deck[0];
  assert.ok(top !== undefined);
  assert.equal(evaluatePredicate({ state: s, actor: 0 }, { kind: 'card_color_is', color: top.color, source: { kind: 'deckTop' } }), true);
  assert.equal(evaluatePredicate({ state: s, actor: 0 }, { kind: 'card_color_is', color: top.color === 'red' ? 'black' : 'red', source: { kind: 'deckTop' } }), false);
});

// ---------- 目标判定 ----------

test('goal 判定按计数器阈值（达成即发印记的判定依据）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const withCounter = {
    ...s,
    players: s.players.map((p, i) => (i === 0 ? { ...p, counters: { gatesPassed: 3 } } : p)),
  };
  assert.equal(isGoalAchieved(withCounter, 0, 'pass_gates', 3), true);
  assert.equal(isGoalAchieved(withCounter, 0, 'pass_gates', 4), false);
});

test('survive_with_hp 检查存活且体力达上限（count 忽略）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  assert.equal(isGoalAchieved(s, 0, 'survive_with_hp', 1), true);
  const hurt = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, hp: p.hpMax - 1 } : p)) };
  assert.equal(isGoalAchieved(hurt, 0, 'survive_with_hp', 1), false);
});
