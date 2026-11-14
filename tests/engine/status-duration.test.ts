// B77 r5（用户裁定乙案）：**「N 个手番」= 受害者接下来 N 个完整手番**。
//
// ⚠️ 为什么要单独成文件：这条口径是**印在牌上和规则书里**的话，不是实现细节。
//   r3 造 `statusGrantedThisTurn` 是为了救「免疫 1 回合在授予它的同一手番末被吃成 0」——
//   那需要豁免；但实现把豁免位**无条件**打在受害者身上 ⇒ 在别人手番里给的封口 / 停手番
//   也顺带被豁免一拍 ⇒ 「N=1」实测吃掉 **2** 个完整手番（模拟器 4800 局对账：
//   封口 失手 1192 / 授予 996 = 1.20，停手番 3806 / 3272 = 1.16，而 amount 全是 1）。
//   ⇒ 本文件把「时长账」钉成常驻断言：豁免位只在**授予发生在受害者自己手番内**时置位。
//
// ⚠️ 「自己手番内授予」仍会影响**当前手番的剩余部分**（状态 >0 ⇒ 立刻封得住），
//   但那**不消耗额度**：额度只由「完整未来手番」支付 ⇒ 这正是本文件第 1、4 两个用例的断言形状。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyStatus, grantImmunity, immunityOf, statusOf, tickPlayerStatuses } from '../../engine/core/statuses.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

const VICTIM = 1;

/** 让受害者「有牌可出」：否则测不到封锁（没钱 ⇒ 本来就没有 PLAY_CARD 候选）。 */
function readyHand(s: State, seat: number): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? { ...p, resource: 9, hand: p.hand.map((c) => ({ ...c, cost: 0 })) }
      : p)),
  };
}

/** 把当前手番指到某个座位（= 授予发生在该座位的手番内）。 */
function duringTurnOf(s: State, seat: number): State {
  const idx = s.turnOrder.indexOf(seat);
  assert.ok(idx >= 0, '前提：该座位在行动顺序里');
  return { ...s, turnIndex: idx };
}

/** 可出牌候选数（PLAY_CARD + ABILITY）。 */
const playable = (s: State, seat: number): number =>
  getLegalActions(s, seat).filter((a) => a.type === 'PLAY_CARD' || a.type === 'ABILITY').length;

/** 该手番是否被封口吃掉（拿「摘掉封口后的枚举」作反事实，判据仍来自引擎）。 */
function silenceLost(s: State, seat: number): number {
  const bare: State = {
    ...s,
    players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, silence: 0 } } : p)),
  };
  return Math.max(0, playable(bare, seat) - playable(s, seat));
}

/** 该手番是否被停手番（= 枚举只剩 PASS）。 */
const skipped = (s: State, seat: number): boolean => {
  const acts = getLegalActions(s, seat);
  return acts.length === 1 && acts[0]!.type === 'PASS';
};

test('B77 r5：封口 1 回合在**别人手番内**授予 ⇒ 只吃掉受害者 1 个完整手番（不是 2）', () => {
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), 0);   // 座 0 的手番里给座 1 挂封口
  s = applyStatus({ state: s, actor: 0 }, VICTIM, 'silence', 1).state;
  assert.equal(statusOf(s, VICTIM, 'silence'), 1, '前提：封口已挂上');
  assert.notEqual(s.players[VICTIM]!.turn.statusGrantedThisTurn, true,
    '关键断言：授予发生在**别人**手番内 ⇒ 不打豁免位（打了就会多豁免一拍 ⇒ N=1 吃掉 2 个手番）');
  // 受害者第 1 个完整手番：被封
  assert.ok(silenceLost(s, VICTIM) > 0, '第 1 个手番必须真的吃掉动作（生效侧）');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(statusOf(s, VICTIM, 'silence'), 0, '第 1 个手番末必须衰减到 0 ⇒ 额度已付清');
  // 受害者第 2 个完整手番：不再被封
  assert.equal(silenceLost(s, VICTIM), 0, '封口 1 回合不得吃掉第 2 个手番');
});

test('B77 r5：封口 1 回合在**受害者自己手番内**授予 ⇒ 当前剩余被封，但额度付给下一个完整手番', () => {
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), VICTIM);
  assert.equal(currentPlayer(s), VICTIM, '前提：现在是受害者自己的手番');
  s = applyStatus({ state: s, actor: VICTIM }, VICTIM, 'silence', 1).state;
  assert.equal(s.players[VICTIM]!.turn.statusGrantedThisTurn, true,
    '授予发生在自己手番内 ⇒ 豁免位置位（r3 的原意，本条不许回退）');
  assert.equal(playable(s, VICTIM), 0, '当前手番剩余部分立刻被封（状态 >0 ⇒ 引擎/枚举同判）');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(statusOf(s, VICTIM, 'silence'), 1, '授予当回合不消耗额度（豁免生效）');
  assert.ok(silenceLost(s, VICTIM) > 0, '下一个完整手番被封');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(statusOf(s, VICTIM, 'silence'), 0, '该手番末衰减 ⇒ 恰好 1 个完整未来手番');
  assert.equal(silenceLost(s, VICTIM), 0, '第 2 个完整手番不得再被封');
});

test('B77 r5：封口 2 回合 ⇒ 恰好吃掉 2 个完整手番，第 3 个自由（别人手番内授予）', () => {
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), 0);
  s = applyStatus({ state: s, actor: 0 }, VICTIM, 'silence', 2).state;
  for (const k of [1, 2]) {
    assert.ok(silenceLost(s, VICTIM) > 0, `第 ${String(k)} 个手番应被封`);
    s = tickPlayerStatuses(s, VICTIM);
  }
  assert.equal(statusOf(s, VICTIM, 'silence'), 0);
  assert.equal(silenceLost(s, VICTIM), 0, 'N=2 不得吃掉第 3 个手番');
});

test('B77 r5：停手番 1 回合 ⇒ 只让受害者 1 个手番只剩 PASS（别人手番内授予）', () => {
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), 0);
  s = applyStatus({ state: s, actor: 0 }, VICTIM, 'skip_turn', 1).state;
  assert.notEqual(s.players[VICTIM]!.turn.statusGrantedThisTurn, true, '同款：别人手番内授予不打豁免位');
  assert.ok(skipped(s, VICTIM), '第 1 个手番必须只剩 PASS');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(statusOf(s, VICTIM, 'skip_turn'), 0);
  assert.equal(skipped(s, VICTIM), false, '停手番 1 回合不得连停 2 个手番');
});

test('B77 r5：免疫 1 回合（自己手番内授予，如 t_oath 试炼奖励）⇒ 下一个完整手番内仍挡得住（r3 那条不许回退）', () => {
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), VICTIM);
  s = grantImmunity({ state: s, actor: VICTIM }, VICTIM, 'poison', 1).state;
  assert.equal(immunityOf(s, VICTIM, 'poison'), 1, '前提：免疫窗已开');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(immunityOf(s, VICTIM, 'poison'), 1, '授予当回合不消耗免疫额度（豁免位必须置位）');
  // 受害者的下一个手番里，别人给他下毒仍应被窗挡住
  const r = applyStatus({ state: duringTurnOf(s, 0), actor: 0 }, VICTIM, 'poison', 1);
  assert.equal(r.ok, false, '免疫窗内对 poison 的授予必须被整件拦下');
  assert.equal(statusOf(s, VICTIM, 'poison'), 0, '被挡 ⇒ 没有落层');
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(immunityOf(s, VICTIM, 'poison'), 0, '该手番末窗关闭 ⇒ N=1 恰好保护 1 个完整手番');
});

test('B77 r5：反证——豁免位若无条件置位，N=1 会多吃一个手番（r3→r5 的病根）', () => {
  // 这条用例本身不改动引擎；它记录「为什么 markGranted 要看 currentPlayer」：
  // 别人手番内授予 + 豁免位 = true ⇒ 受害者下一个手番末不衰减 ⇒ 第 2 个手番仍被封。
  let s = duringTurnOf(readyHand(mk(4, 7), VICTIM), 0);
  s = applyStatus({ state: s, actor: 0 }, VICTIM, 'silence', 1).state;
  s = tickPlayerStatuses(s, VICTIM);
  assert.equal(statusOf(s, VICTIM, 'silence'), 0, '现状必须恰好衰减到 0；若这里读到 1，就是 r3→r5 那个多豁免一拍的老病复发');
});
