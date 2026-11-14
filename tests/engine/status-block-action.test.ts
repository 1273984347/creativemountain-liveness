// B77 封锁集与豁免族（规格 §3.6）——三层同判的判据出处。
//
// ⚠️ 豁免族不是"方便"而是**防死锁**：关隘 / 裂隙 / 对峙 / 认证 / 投票是未决流程的解阻塞动作。
//   若被封者连通道都不能选，他会永远卡在关隘格上（`advanceTurn` 的 pendingGate 分支会一直
//   提前 return）⇒ 门 ⑨ 的死循环。最后一条用例就是这条的钉子。
// ⚠️ 判据只允许存在一份（`statuses.isActionBlocked`）：枚举层、引擎、UI 闸门都读它。
//   两三份判据必然漂移，这是 B75.1「三层同判」已经付过学费的地方。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isActionBlocked, blockedNotice } from '../../engine/core/statuses.ts';
import { candidatesOf } from '../../engine/core/legal.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { uiCandidates } from '../../web/legal-gate.ts';
import { gateScene, mk, putPending } from './fixtures.ts';
import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';

type StatusKey = 'poison' | 'slow' | 'silence' | 'skip_turn';

function withStatuses(s: State, seat: number, patch: Partial<Record<StatusKey, number>>): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, ...patch } } : p)) };
}
/** 把 turnIndex 指到座 seat 的手番（全存活时 aliveOrder === turnOrder）。 */
function atSeat(s: State, seat: number): State {
  const idx = s.turnOrder.indexOf(seat);
  assert.ok(idx >= 0, '前提：座位在行动顺序里');
  return { ...s, turnIndex: idx };
}
const typesOf = (list: readonly Action[]): string[] => list.map((a) => a.type).sort();

test('B77：skip 封六个行动面动作，豁免族一律照放', () => {
  const s = withStatuses(mk(4, 7), 0, { skip_turn: 1 });
  for (const t of ['MOVE', 'PLAY_CARD', 'ABILITY', 'ROLL_WHEEL', 'EQUIP_CARD', 'RECUPERATE'] as const) {
    assert.equal(isActionBlocked(s, 0, t), true, `${t} 应被 skip 封`);
  }
  for (const t of ['PASS', 'GATE_RESOLVE', 'BARRIER_RESOLVE', 'DUEL_SUBMIT_CARD', 'VOTE', 'COUNCIL_VETO', 'COMPARE', 'CERTIFY_SIGN', 'CERTIFY_ANSWER'] as const) {
    assert.equal(isActionBlocked(s, 0, t), false, `${t} 属豁免族（解阻塞 / 社交判决）`);
  }
});

test('B77：silence 只封 PLAY_CARD / ABILITY，行棋·问天·装备·自救照做', () => {
  const s = withStatuses(mk(4, 7), 0, { silence: 1 });
  assert.equal(isActionBlocked(s, 0, 'PLAY_CARD'), true);
  assert.equal(isActionBlocked(s, 0, 'ABILITY'), true);
  for (const t of ['MOVE', 'ROLL_WHEEL', 'EQUIP_CARD', 'RECUPERATE'] as const) {
    assert.equal(isActionBlocked(s, 0, t), false, `${t} 不是「发言」（§3.3 的裁定）`);
  }
});

test('B77：skip 的封锁集 ⊃ silence ⇒ 同挂时 skip 说话（D6 优先级）', () => {
  const s = withStatuses(mk(4, 7), 0, { skip_turn: 1, silence: 2 });
  assert.equal(isActionBlocked(s, 0, 'MOVE'), true, 'skip 生效时连行棋都封');
  assert.equal(blockedNotice(s, 0), '你被停了手番——这一回合只能结束行动。', '拒因必须先说停手番');
});

test('B77：只有 silence 时拒因说封口（同一函数出同一句话，三层共用）', () => {
  assert.equal(blockedNotice(withStatuses(mk(4, 7), 0, { silence: 1 }), 0),
    '你被封口了——本回合不能出牌或发动被动。');
  assert.equal(blockedNotice(mk(4, 7), 0), null, '没被封就不该有拒因');
});

test('B77：skip 生效时行动面只发 PASS', () => {
  const s = atSeat(withStatuses(mk(4, 7), 0, { skip_turn: 1 }), 0);
  assert.deepEqual(typesOf(candidatesOf(s, 0)), ['PASS']);
});

test('B77：silence 生效时候选里没有出牌与被动，但行棋/装备照发', () => {
  const s = atSeat(withStatuses(mk(4, 7), 0, { silence: 1 }), 0);
  const ts = typesOf(candidatesOf(s, 0));
  assert.ok(ts.includes('MOVE'), '行棋必须还在');
  assert.ok(ts.includes('EQUIP_CARD'), '装备不视为发言 ⇒ 不受禁言影响');
  assert.ok(!ts.includes('PLAY_CARD'), `出牌应被剔除，实际候选=${ts.join(',')}`);
  assert.ok(!ts.includes('ABILITY'), `被动应被剔除，实际候选=${ts.join(',')}`);
});

test('B77：绕过枚举直接打引擎 ⇒ 引用相等拒绝（三层同判的引擎侧）', () => {
  const s = atSeat(withStatuses(mk(4, 7), 0, { silence: 1 }), 0);
  const card = s.players[0]!.hand[0]!;
  assert.equal(performAction(s, 0, 'act', { cardId: card.id }), s, '被封者出牌 = 原样返回（探针认得的拒绝信号）');
  assert.notEqual(performAction(s, 0, 'move'), s, 'silence 不封行棋 ⇒ 行棋必须照常放行');
});

test('B77：skip 时引擎同样拒行棋、但拒不掉豁免族（停手番期间认证流程照常能走）', () => {
  const s = atSeat(withStatuses(mk(4, 7), 0, { skip_turn: 1 }), 0);
  assert.equal(performAction(s, 0, 'move'), s, 'skip 封行棋');
  assert.equal(performAction(s, 0, 'ask'), s, 'skip 封问天');
});

test('B77：待认证锁定 + 封口同时成立 ⇒ 锁定留下的非位移牌也被封口拿掉（两层同判）', () => {
  // B71 让锁定者仍能拿到**非位移** PLAY_CARD；B77 的封口要在这条分支里也生效，
  // 否则枚举会发一条引擎必拒的死选项（正是 B68/B71 一路在防的"枚举领先引擎"）。
  let s = mk(4, 7);
  s = putPending(s, [0]);
  s = withStatuses(s, 0, { silence: 1 });
  const engine = typesOf(candidatesOf(s, 0));
  const ui = typesOf(uiCandidates(s, 0));
  assert.ok(!engine.includes('PLAY_CARD'), `引擎侧仍发了出牌候选：${engine.join(',')}`);
  assert.ok(!ui.includes('PLAY_CARD'), `UI 侧仍发了出牌候选：${ui.join(',')}`);
  assert.deepEqual(ui, engine, '两层候选集必须逐字相等（漂移守卫的同一条纪律）');
  // 装备不受封口影响 ⇒ 锁定者至少还剩一条行动（不是整面清零）。
  assert.ok(engine.includes('EQUIP_CARD'), '装备不视为发言 ⇒ 锁定+封口下仍应可装备');
});

test('B77 死锁钉子：停在未通过关隘上的被封者，仍能选通道', () => {
  // gateScene 造"座 0 站在未通过的关隘上"；再给他 silence + skip 双重封锁。
  const s = withStatuses(gateScene(4, 7, 3, 0), 0, { silence: 2, skip_turn: 2 });
  const ts = typesOf(candidatesOf(s, 0));
  assert.ok(ts.includes('GATE_RESOLVE'), `解阻塞通道必须照放，否则玩家永远卡在关隘上；实际候选=${ts.join(',')}`);
  assert.ok(!ts.includes('PASS'), '通道没选完之前不得发 PASS——否则等于允许"跳过关隘"');
});
