// B75：模拟器 AI 的两个新决策（概率装备、仲裁者自保否决）。
// ⚠️ 只测**导出的纯函数**；`playOne` 的带二分与 `councilTurn` 的接线由门 ⑨ 的重标定读数覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldVeto, pickEquipCard, goalPursuit } from '../../tests/sim/policy.mjs';
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

// ---------- B75.2：goalPursuit（目标感知追goal）----------
//
// ⚠️ 只测导出的纯函数（文件头纪律）；playOne 的接线由门 ⑨ 的重标定读数覆盖。
//   语义：达阈即停 / 不抽随机数 / 失败回落 / 只服务 steal_count 与 reroll_count 两类目标。

/** 给座 `seat` 挂上身份被动规格并设置资源（追goal测试的夹具）。 */
function withPassiveAndGoal(
  state: State,
  seat: number,
  passive: unknown,
  kind: string,
  count: number,
): State {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat
      ? { ...p, flags: { ...p.flags, passive, goal: { kind, count } } }
      : p)),
  };
}

test('B75.2：窃火者追goal —— 偷最富的对手（deterministic，不抽随机数）', () => {
  let s = withPassiveAndGoal(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }, 'steal_count', 5);
  // 座 1 有 3、座 2 有 5 ⇒ 必须偷座 2（最富者）
  s = { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, resource: 3 } : p.seat === 2 ? { ...p, resource: 5 } : p)) };
  const rngBefore = s.rng.snapshot();
  const got = goalPursuit(s, 0);
  assert.ok(got !== null, '目标未达成且有可偷目标 ⇒ 必须追');
  assert.equal(got.op, 'transfer_resource', '动作是偷取被动');
  assert.equal(got.state.players[2]!.resource, 4, '最富者（座 2）被偷 1 枚');
  assert.equal(got.state.players[0]!.resource, (s.players[0]!.resource ?? 0) + 1, '自己 +1');
  assert.equal(got.state.players[0]!.counters.stolenTotal, 1, '计数器 +1');
  assert.deepEqual(got.state.rng.snapshot(), rngBefore, '追goal不得推进随机流');
});

test('B75.2：达阈即停 —— stolenTotal ≥ count ⇒ 不再追（不无限占行动）', () => {
  let s = withPassiveAndGoal(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }, 'steal_count', 5);
  s = { ...s, players: s.players.map((p) => (p.seat === 0
    ? { ...p, counters: { ...p.counters, stolenTotal: 5 } } : p)) };
  assert.equal(goalPursuit(s, 0), null, '已偷满 5 枚 ⇒ 追goal结束，回到正常行动带');
});

test('B75.2：无目标可偷 ⇒ 回落 null（对手资源全部 < amount）', () => {
  let s = withPassiveAndGoal(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }, 'steal_count', 5);
  s = { ...s, players: s.players.map((p) => (p.alive && p.seat !== 0 ? { ...p, resource: 0 } : p)) };
  assert.equal(goalPursuit(s, 0), null, '没人有资源 ⇒ 追不动，回落正常行动带');
});

test('B75.2：织梦者追goal —— 改判挂标记并计数；达阈即停', () => {
  let s = withPassiveAndGoal(mk(4, 7), 0, { op: 'modify_judgement', target: 0 }, 'reroll_count', 3);
  const rngBefore = s.rng.snapshot();
  const got = goalPursuit(s, 0);
  assert.ok(got !== null, '改判数未达标 ⇒ 必须追');
  assert.equal(got.op, 'modify_judgement', '动作是改判被动');
  assert.equal(got.state.players[0]!.flags.judgementModified, true, '挂上改判定标记');
  assert.equal(got.state.players[0]!.counters.rerollCount, 1, '改判计数 +1');
  assert.deepEqual(got.state.rng.snapshot(), rngBefore, '追goal不得推进随机流');
  // 达阈
  const done = { ...s, players: s.players.map((p) => (p.seat === 0
    ? { ...p, counters: { ...p.counters, rerollCount: 3 } } : p)) };
  assert.equal(goalPursuit(done, 0), null, '已改判 3 次 ⇒ 追goal结束');
});

test('B75.2：非追goal目标 / 无被动 / 待认证锁定 ⇒ 一律 null', () => {
  // equip_count 目标由 B75 的装备分支服务，追goal分支不得叠用
  const equipGoal = withPassiveAndGoal(mk(4, 7), 0, { op: 'create_card', cardId: 'x' }, 'equip_count', 3);
  assert.equal(goalPursuit(equipGoal, 0), null, 'equip_count 不归追goal分支');
  // 没有被动（旧存档形状）⇒ null
  let noPassive = withPassiveAndGoal(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }, 'steal_count', 5);
  noPassive = { ...noPassive, players: noPassive.players.map((p) => (p.seat === 0
    ? { ...p, flags: { ...p.flags, passive: undefined } } : p)) };
  assert.equal(goalPursuit(noPassive, 0), null, '无被动规格 ⇒ 追不动');
  // 待认证锁定 ⇒ null（锁定分支在 playOne 更早处 continue，天然不经过追goal）
  const locked = withPassiveAndGoal(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 }, 'steal_count', 5);
  const lockedState: State = { ...locked, players: locked.players.map((p) => (p.seat === 0 ? { ...p, pendingCert: true } : p)) };
  assert.equal(goalPursuit(lockedState, 0), null, '待认证锁定者不追goal');
});

// ---------- B76：力竭恢复的占位 AI（自恢 p=0.5 / 救援 p=0.10）----------
//
// ⚠️ 只测导出的纯函数（文件头纪律）。占位声明同 B75.1 §6：非最优、人类行为未建模、
//   会消耗 rng（前置过滤：非力竭座位 / 无力竭目标的座位**零消耗**——r2 评审 🔴3）。
import { selfRecuperateChoice, rescueChoice } from '../../tests/sim/policy.mjs';
import { triggerExhaustion, recoverFromExhaustion } from '../../engine/core/exhaustion.ts';

/** 夹具：座 seat 力竭 + 资源置值；座 victim 力竭归零。 */
function exhaustedShape(s: State, self: number, resource: number, victim?: number): State {
  return { ...s, players: s.players.map((p) => {
    if (p.seat === self) { return { ...p, exhaustedRounds: 2, resource, hp: 0 }; }
    if (victim !== undefined && p.seat === victim) { return { ...p, exhaustedRounds: 2, resource: 0, hp: 0 }; }
    return p;
  }) };
}

test('B76：自恢占位概率——力竭 + 资源≥2 跨 seed 扫描 seen 两值（0.5 真判据）', () => {
  const seen = new Set<boolean>();
  for (let seed = 7; seed < 80 && seen.size < 2; seed++) {
    seen.add(selfRecuperateChoice(exhaustedShape(mk(4, seed), 0, 3), 0));
  }
  assert.equal(seen.has(true), true, '必须有命中（否则自恢不可达）');
  assert.equal(seen.has(false), true, '必须有不命中（否则恒真）');
});

test('B76：非力竭座位 ⇒ selfRecuperateChoice 恒 false 且零 rng 消耗（r2 🔴3）', () => {
  const s = mk(4, 7);
  const before = s.rng.snapshot();
  assert.equal(selfRecuperateChoice(s, 0), false);
  assert.deepEqual(s.rng.snapshot(), before, '前置过滤不过 ⇒ 不抽签');
});

test('B76：力竭但资源不足 ⇒ false 且零 rng 消耗', () => {
  const s = exhaustedShape(mk(4, 7), 0, 1);
  const before = s.rng.snapshot();
  assert.equal(selfRecuperateChoice(s, 0), false);
  assert.deepEqual(s.rng.snapshot(), before);
});

test('B76：救援占位——存在力竭他人跨 seed 两值；无力竭他人恒 false 零消耗', () => {
  // ⚠️ 救援形状：**自己不力竭**（座 0 有资源）、他人（座 1）力竭——
  //   首版夹具把自己也置力竭 ⇒ 「力竭者不能救援」正确早退 ⇒ 测试 vacuous（自纠）。
  const rescueShape = (seed: number): State => {
    const s0 = mk(4, seed);
    return { ...s0, players: s0.players.map((p) => (p.seat === 1 ? { ...p, exhaustedRounds: 2, resource: 0, hp: 0 } : p.seat === 0 ? { ...p, resource: 3 } : p)) };
  };
  const seen = new Set<boolean>();
  for (let seed = 7; seed < 120 && seen.size < 2; seed++) {
    const r = rescueChoice(rescueShape(seed), 0);
    seen.add(r.fire);
    if (r.fire) { assert.equal(r.target, 1, '命中时目标是力竭者'); }
  }
  assert.equal(seen.has(true), true, 'p=0.10 在 113 个 seed 里必须至少命中一次');
  assert.equal(seen.has(false), true);
  const none = mk(4, 7);
  const before = none.rng.snapshot();
  assert.equal(rescueChoice(none, 0).fire, false);
  assert.deepEqual(none.rng.snapshot(), before, '无力竭他人 ⇒ 零 rng 消耗');
});

test('B76：力竭者不能救援 ⇒ 早退且零 rng 消耗（设计规格 §3：恢复是主动动作，力竭封锁）', () => {
  const s = exhaustedShape(mk(4, 7), 0, 3, 1);
  const before = s.rng.snapshot();
  assert.equal(rescueChoice(s, 0).fire, false);
  assert.deepEqual(s.rng.snapshot(), before, '力竭者早退 ⇒ 零消耗');
});

test('B76：报告计数器的 message 契约（Task 2 触发 / 解除格式与 T8 扫描谓词钉死）', () => {
  const s0 = mk(4, 7);
  const hit = triggerExhaustion(s0, 0);
  assert.ok(hit.log.some((l) => l.kind === 'exhaustion' && l.message.startsWith('力竭：')), '触发前缀 = 力竭：');
  const rec = recoverFromExhaustion(hit, 0, '自然');
  assert.ok(rec.log.some((l) => l.kind === 'exhaustion' && l.message.includes('（自然）')), '自然恢复含（自然）');
  const rec2 = recoverFromExhaustion(hit, 0, '自恢');
  assert.ok(rec2.log.some((l) => l.kind === 'exhaustion' && l.message.includes('（自恢）')));
  const rec3 = recoverFromExhaustion(hit, 0, '救援');
  assert.ok(rec3.log.some((l) => l.kind === 'exhaustion' && l.message.includes('（救援）')));
});
