// B75：模拟器 AI 的两个新决策（概率装备、仲裁者自保否决）。
// ⚠️ 只测**导出的纯函数**；`playOne` 的带二分与 `councilTurn` 的接线由门 ⑨ 的重标定读数覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldVeto, pickEquipCard } from '../../tests/sim/policy.mjs';
import { castVote } from '../../engine/core/council.ts';
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

test('B75：仲裁者被最高票且票已齐 ⇒ shouldVeto 为真', () => {
  assert.equal(shouldVeto(voted(0, 0), 0), true);
});

test('B75：非持权 / 不是最高票 / 已用过 ⇒ shouldVeto 为假', () => {
  assert.equal(shouldVeto(voted(0, 0), 2), false, '座 2 不持权');
  assert.equal(shouldVeto(voted(0, 1), 0), false, '持权但自己不是最高票');
  const used = { ...voted(0, 0), council: { ...voted(0, 0).council, vetoUsed: true, vetoBy: 0 } };
  assert.equal(shouldVeto(used, 0), false, '每局一次');
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
