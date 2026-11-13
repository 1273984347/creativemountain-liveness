// B75：两个「B75 前恒为 0」的目标必须**真的可达**，且达成即发【印记】。
//
// ⚠️ 为什么要单独一条文件：B75 的立项理由是「机制缺失」而非「漏写计数器」⇒
//   补齐后必须由**可失败的用例**证明「事件会发生、判定会触发、印记会发放」三环都通；
//   只测引擎函数改了状态（equip 后 hand 变短）证明不了后两环（B60 的死机制正是断在判定/发奖环）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performAction } from '../../engine/core/turn-runner.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { castVote, resolveCouncil, useCouncilVeto } from '../../engine/core/council.ts';
import { goalOf, settleRoundEndGoals, settleImmediateGoals } from '../../engine/goals/settle.ts';
import { councilScene, mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

/** 夹具：给某座位挂上身份目标（生产路径由 `setup.ts` 从主题身份派生）。 */
function withGoal(state: State, seat: number, kind: string, count: number): State {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat
      ? { ...p, flags: { ...p.flags, goal: { kind, count } } }
      : p)),
  };
}

test('B75：equip_count —— 装备够数 ⇒ 回合末结算发印记（不在装备那一刻发）', () => {
  let s = withGoal(mk(4, 7), 0, 'equip_count', 1);
  assert.deepEqual(goalOf(s, 0), { kind: 'equip_count', count: 1 }, '前提：目标已派生');
  const card = s.players[0]!.hand[0]!;
  s = performAction(s, 0, 'equip', { cardId: card.id });
  assert.equal(s.players[0]!.counters.equipsTotal, 1, '装备必须真的写计数器');
  assert.equal(s.players[0]!.hasMark, false, '装备那一刻**不发**印记（发奖只在 round_end 结算点）');
  s = settleRoundEndGoals(s);
  assert.equal(s.players[0]!.hasMark, true, '装备够数 ⇒ 回合末发印记');
});

test('B75：equip_count —— 没够数不发印记（防把「有目标」当「达成」）', () => {
  let s = withGoal(mk(4, 7), 0, 'equip_count', 2);
  const card = s.players[0]!.hand[0]!;
  s = performAction(s, 0, 'equip', { cardId: card.id });
  s = settleRoundEndGoals(s);
  assert.equal(s.players[0]!.hasMark, false, '1 < 2 ⇒ 不得发印记');
});

test('B75：veto_success —— 成功否决走完整链：使用 → 结算 → 计数 → 即时发印记', () => {
  let s = withGoal(councilScene(4, 7), 0, 'veto_success', 1);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive)) {
    const to = p.seat === 1 ? 0 : 1;
    const r = castVote(s, p.seat, to);
    assert.ok(r.ok, `前提：座 ${String(p.seat)} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok, '前提：票齐且持权 ⇒ 否决必须被接受：' + String(v.note));
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  assert.equal(res.state.players[0]!.counters.vetoCount, 1, '成功阻止放逐 ⇒ 计数写入');
  assert.equal(res.state.players[1]!.alive, true, '本次无人被放逐');
  // ⚠️ 印记必须由 `resolveCouncil` **内部**的即时结算发出（测试里不再手动调一次 ⇒ 证明接线点在引擎里）
  assert.equal(res.state.players[0]!.hasMark, true, 'immediate 时机 ⇒ 结算山议时就该发印记');
});

test('B75：白用的否决不计数（计数点唯一，且只认真阻止了放逐）', () => {
  // 座 1 有凭证免疫 ⇒ 本来就不会有人被放逐 ⇒ 否决消耗掉但 `vetoCount` 必须保持 0（设计 §4.3 口径）。
  let c = withGoal(councilScene(4, 7), 0, 'veto_success', 1);
  c = { ...c, players: c.players.map((p) => (p.seat === 0
    ? { ...p, flags: { ...p.flags, canVeto: true } }
    : p.seat === 1 ? { ...p, flags: { ...p.flags, exemptFromVote: true } } : p)) };
  for (const p of c.players.filter((x) => x.alive)) {
    const r = castVote(c, p.seat, p.seat === 1 ? 0 : 1);
    assert.ok(r.ok, `前提：座 ${String(p.seat)} 投票必须成功：` + String(r.note));
    c = r.state;
  }
  const v = useCouncilVeto(c, 0);
  assert.ok(v.ok, '前提：票齐且持权 ⇒ 否决可用：' + String(v.note));
  const res = resolveCouncil(v.state);
  assert.equal(res.state.players[1]!.alive, true, '凭证免疫 ⇒ 座 1 本来就活着');
  assert.equal(res.state.council.vetoUsed, true, '否决已消耗');
  assert.equal(res.state.players[0]!.counters.vetoCount ?? 0, 0, '未阻止放逐 ⇒ 不得计数');
  assert.equal(res.state.players[0]!.hasMark, false, '没计数 ⇒ 目标未达成，不得发印记');
});

test('B75：settleImmediateGoals 是全局结算（不只给否决者发奖）', () => {
  // 设计 §4.3：否决后检查**所有玩家**的 immediate 目标 ⇒ 另一位持 veto_success 的玩家不该被漏掉。
  let s = withGoal(councilScene(4, 7), 0, 'veto_success', 1);
  s = withGoal(s, 2, 'veto_success', 1);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  s = { ...s, players: s.players.map((p) => (p.seat === 2 ? { ...p, counters: { ...p.counters, vetoCount: 1 } } : p)) };
  const after = settleImmediateGoals(s);
  assert.equal(after.players[2]!.hasMark, true, '他人已达成的 immediate 目标同样要在同一次全局结算里发奖');
});

// ---------- B75.2：reroll_count / steal_count 的三环链（计数 → 结算 → 发奖） ----------
//
// ⚠️ 计数写入环在 B61 已由 goals.test.ts 的 LAYER-E2/E3 钉住；这里补的是**后两环**
//   （回合末结算触发判定、判定通过发【印记】）——与 B75 给 equip/veto 补链的理由同款：
//   只测「counter +1」证明不了目标真的可达（判定/发奖环断掉时 counter 照样在涨）。

/** 给座 `seat` 挂上身份被动规格（与 passive-abilities.test.ts 的 withPassive 同法）。 */
function withPassive(state: State, seat: number, passive: unknown): State {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat
      ? { ...p, flags: { ...p.flags, passive } }
      : p)),
  };
}

test('B75.2：reroll_count —— 改判入计数，回合末结算发印记（不在改判那一刻发）', () => {
  let s = withGoal(withPassive(mk(4, 7), 0, { op: 'modify_judgement', target: 0 }), 0, 'reroll_count', 1);
  assert.deepEqual(goalOf(s, 0), { kind: 'reroll_count', count: 1 }, '前提：目标已派生');
  const r = performAbility(s, 0);
  assert.ok(r.ok, '前提：织梦者发动改判必须成功：' + String(r.note));
  s = r.state;
  assert.equal(s.players[0]!.counters.rerollCount, 1, '改判必须真的写计数器（被改判者 = 自己）');
  assert.equal(s.players[0]!.hasMark, false, '改判那一刻**不发**印记（发奖只在 round_end 结算点）');
  s = settleRoundEndGoals(s);
  assert.equal(s.players[0]!.hasMark, true, '改判够数 ⇒ 回合末发印记');
});

test('B75.2：reroll_count —— 没够数不发印记（防把「有目标」当「达成」）', () => {
  let s = withGoal(withPassive(mk(4, 7), 0, { op: 'modify_judgement', target: 0 }), 0, 'reroll_count', 2);
  const r = performAbility(s, 0);
  assert.ok(r.ok, '前提：发动成功：' + String(r.note));
  s = settleRoundEndGoals(r.state);
  assert.equal(s.players[0]!.hasMark, false, '1 < 2 ⇒ 不得发印记');
});

test('B75.2：steal_count —— 偷取入**偷取者**的计数，回合末结算发印记', () => {
  let s = withGoal(withPassive(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }), 0, 'steal_count', 1);
  const victim = s.players[1];
  assert.ok(victim !== undefined && victim.resource >= 1, '前提：目标须有灵枢');
  assert.deepEqual(goalOf(s, 0), { kind: 'steal_count', count: 1 }, '前提：目标已派生');
  const r = performAbility(s, 0, 1);
  assert.ok(r.ok, '前提：窃火者发动偷取必须成功：' + String(r.note));
  s = r.state;
  assert.equal(s.players[0]!.counters.stolenTotal, 1, '偷取必须写**偷取者**的计数器');
  assert.equal(s.players[1]!.counters.stolenTotal, undefined, '受害者不得被写计数器（B61 口径）');
  assert.equal(s.players[0]!.hasMark, false, '偷取那一刻**不发**印记（发奖只在 round_end 结算点）');
  s = settleRoundEndGoals(s);
  assert.equal(s.players[0]!.hasMark, true, '偷取够数 ⇒ 回合末发印记');
});

test('B75.2：steal_count —— 没够数不发印记（防把「有目标」当「达成」）', () => {
  let s = withGoal(withPassive(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }), 0, 'steal_count', 2);
  const r = performAbility(s, 0, 1);
  assert.ok(r.ok, '前提：发动成功：' + String(r.note));
  s = settleRoundEndGoals(r.state);
  assert.equal(s.players[0]!.hasMark, false, '1 < 2 ⇒ 不得发印记');
});
