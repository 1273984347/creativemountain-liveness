// B75：模拟器 AI 的两个新决策（概率装备、仲裁者自保否决）。
// ⚠️ 只测**导出的纯函数**；`playOne` 的带二分与 `councilTurn` 的接线由门 ⑨ 的重标定读数覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldVeto, pickEquipCard } from '../../tests/sim/policy.mjs';
import { castVote, topVoted, useCouncilVeto } from '../../engine/core/council.ts';
import { cardHasMovement } from '../../engine/core/targeting.ts';
import { councilScene, mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

/** 把座 `seat` 造成持权者，并让**所有存活玩家**都投完票（`target` 拿最高票；本人不能投自己 ⇒ 转投他人）。 */
function voted(seat: number, target: number, players = 4): State {
  let s: State = councilScene(players, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  const alive = s.players.filter((x) => x.alive).map((x) => x.seat);
  for (const voter of alive) {
    // 被提名者自己也必须投票（票齐是否决的硬前置）⇒ 投给除自己外的任意存活座位
    const to = voter === target ? (alive.find((x) => x !== voter) ?? 0) : target;
    const r = castVote(s, voter, to);
    assert.ok(r.ok, `前提：座 ${String(voter)} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  return s;
}

test('B75.1：自己被最高票 ⇒ shouldVeto 为假（自救禁止，与引擎同判）', () => {
  // 座 0 持权且被全员投给 ⇒ 引擎会拒自救，AI 也必须跟着不用（否则白耗一次决策记录）
  assert.equal(shouldVeto(voted(0, 0), 0), false, '自救形状必须为假');
  assert.equal(useCouncilVeto(voted(0, 0), 0).ok, false, '引擎同判：自救被拒');
});

test('B75.1：救他人形状下按固定概率触发（命中与不命中都要出现过 ⇒ 0.15 是真判据，不是恒真/恒假）', () => {
  // ⚠️ 不硬编码「第几号 seed 必命中」：那等于把 rng 游标写进断言，随机流一改就红。
  //   改为跨 seed 扫描，要求同时出现 true 与 false ⇒ 既证明 `veto_success` 仍有来源，也证明不是每次都触发。
  const seen = new Set<boolean>();
  for (let seed = 7; seed <= 80 && seen.size < 2; seed += 1) {
    // 座 0 持权、全员将票投给座 1 ⇒ 「救他人」形状（自救已被规则排除）
    let s: State = { ...councilScene(4, seed) };
    s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
    for (const p of s.players.filter((x) => x.alive)) {
      const others = s.players.filter((x) => x.alive && x.seat !== p.seat).map((x) => x.seat);
      const r = castVote(s, p.seat, p.seat === 1 ? (others[0] ?? 0) : 1);
      assert.ok(r.ok, `前提：seed=${seed} 座 ${String(p.seat)} 投票必须成功：` + String(r.note));
      s = r.state;
    }
    assert.deepEqual(topVoted(s), [1], `前提：seed=${seed} 时被最高票的必须是座 1（持权者座 0 不自救）`);
    seen.add(shouldVeto(s, 0));
  }
  assert.equal(seen.has(true), true, 'seed 7–80 内必须至少出现一次「用否决」⇒ 否则 veto_success 不可达');
  assert.equal(seen.has(false), true, '也必须至少出现一次「不用」⇒ 否则概率被写成了恒真');
});

test('B75：非持权 / 已用过 ⇒ shouldVeto 为假（两条都在抽签之前，判定确定）', () => {
  assert.equal(shouldVeto(voted(0, 0), 2), false, '座 2 不持权');
  const used = { ...voted(0, 0), council: { ...voted(0, 0).council, vetoUsed: true, vetoBy: 0 } };
  assert.equal(shouldVeto(used, 0), false, '每局一次');
  // ⚠️ B75.1 后「自己不是最高票」**不再**推出 false —— 那正是唯一可能用否决的形状（概率决定）；
  //   原来那条断言已随规则改写进上面两条 B75.1 用例，这里不再重复。
});

test('B75：票未齐 ⇒ shouldVeto 为假（引擎同判，不发不可达的候选）', () => {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive && x.seat !== 2 && x.seat !== 1)) {
    const r = castVote(s, p.seat, 1);
    assert.ok(r.ok, '前提：投票必须成功：' + String(r.note));
    s = r.state;
  }
  assert.equal(shouldVeto(s, 0), false, '座 2 还没投票 ⇒ 不能使用否决');
});

test('B75：pickEquipCard 手牌少于 2 不装备、只给可支付且非位移的牌', () => {
  const s = mk(4, 7);
  const hand = s.players[0]!.hand;
  assert.ok(hand.length >= 2, '前提：夹具手牌至少 2 张');
  // 手牌 < 2 ⇒ 不装备（装备掉唯一的手牌会把行动面变成空集）
  const oneCard: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 0 ? { ...p, resource: 99, hand: [hand[0]!] } : p)),
  };
  assert.equal(pickEquipCard(oneCard, 0), undefined, '手牌 < 2 ⇒ 不装备');

  const wide: State = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, resource: 99 } : p)) };
  const card = pickEquipCard(wide, 0);
  assert.ok(card !== undefined, '手牌 ≥2 且资源充足 ⇒ 必须给出可装备的牌');
  assert.equal(wide.players[0]!.hand.some((c) => c.id === card.id), true, '只能是自己手牌里的牌');
  assert.equal(cardHasMovement(card), false, '装备避开位移牌（那通常是最想打出的牌）');

  // 只剩位移牌 ⇒ 不装备（宁可出牌也不把位移牌锁进装备区）
  const onlyMove: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, resource: 99, hand: p.hand.filter((c) => cardHasMovement(c)) }
      : p)),
  };
  if (onlyMove.players[0]!.hand.length >= 2) {
    assert.equal(pickEquipCard(onlyMove, 0), undefined, '全是位移牌 ⇒ 不装备');
  }
});

test('B75：pickEquipCard 付不起时不装备（与出牌同看资源）', () => {
  const s = mk(4, 7);
  const broke: State = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, resource: 0 } : p)) };
  const needCost = broke.players[0]!.hand.some((c) => c.cost > 0 && !cardHasMovement(c));
  if (!needCost) { return; }   // 该 seed 手牌全免费 ⇒ 本用例无变量可测，跳过
  const card = pickEquipCard(broke, 0);
  if (card !== undefined) {
    assert.equal(card.cost <= 0, true, '资源为 0 时只能装备免费牌');
  }
});
