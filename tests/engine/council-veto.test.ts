// B75：仲裁者否决 —— 入口校验、结算、计数与即时目标。
// ⚠️ 测试里直接改 `flags.canVeto` 是**夹具**手段；生产路径由 Task 2 的 `setup` 按身份 `rights` 授予。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castVote, useCouncilVeto, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

/** 给某座位挂上否决特权（夹具）。 */
function grantVeto(state: State, seat: number): State {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, canVeto: true } } : p)),
  };
}

/**
 * 让所有**存活**玩家都投完票（默认把座 1 顶上最高票），座 `seat` 持否决权。
 *
 * ⚠️ 最高票者自己也必须投票 —— 「所有存活玩家都已投票」是否决的硬前置，
 *   漏投一票 ⇒ `useCouncilVeto` 直接拒 ⇒ 用例测的是前置而不是否决本身。
 */
function readyVeto(seat = 0, target = 1): State {
  let s = grantVeto(councilScene(4, 7), seat);
  const others = s.players.filter((p) => p.alive && p.seat !== target).map((p) => p.seat);
  for (const voter of s.players.filter((p) => p.alive)) {
    const to = voter.seat === target ? (others[0] ?? 0) : target;
    const r = castVote(s, voter.seat, to);
    assert.ok(r.ok, `前提：座 ${String(voter.seat)} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  return s;
}

test('B75：非持权者不能使用否决', () => {
  const r = useCouncilVeto(readyVeto(), 2);
  assert.equal(r.ok, false);
  assert.match(String(r.note), /否决特权/);
});

test('B75：投票未完成时不能使用否决', () => {
  const s = grantVeto(councilScene(4, 7), 0);
  const r = useCouncilVeto(s, 0);
  assert.equal(r.ok, false);
  assert.match(String(r.note), /等待所有玩家投票/);
});

test('B75：成功否决 ⇒ 无人被放逐 + vetoCount+1 + 每局一次', () => {
  const s = readyVeto();
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok, '前提：持权且票齐 ⇒ 否决必须被接受：' + String(v.note));
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  assert.match(String(res.note), /仲裁者否决/);
  assert.equal(res.state.players[1]?.alive, true, '被否决者必须存活');
  assert.equal(res.state.players[0]?.counters.vetoCount, 1);
  assert.equal(useCouncilVeto(res.state, 0).ok, false, '每局只能一次');
});

test('B75：否决已用但本次本就不会放逐 ⇒ 不计数', () => {
  // 凭证免疫 ⇒ exiled 为空 ⇒ 否决**没有阻止任何放逐** ⇒ 按规格 §4.3 不得计入 vetoCount。
  let s = readyVeto();
  s = {
    ...s,
    players: s.players.map((p) => (p.seat === 1 ? { ...p, flags: { ...p.flags, exemptFromVote: true } } : p)),
  };
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok);
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  assert.equal(res.state.players[1]?.alive, true);
  assert.equal(res.state.players[0]?.counters.vetoCount ?? 0, 0, '未阻止放逐 ⇒ 不计数');
});

test('B75：3 人局不受否决影响（扣灵枢分支）', () => {
  let s = grantVeto(councilScene(3, 7), 0);
  for (const p of s.players) {
    const r = castVote(s, p.seat, p.seat === 0 ? 1 : 0);
    assert.ok(r.ok, '前提：3 人局投票必须成功：' + String(r.note));
    s = r.state;
  }
  const before = s.players[0]?.resource;
  const v = useCouncilVeto(s, 0);
  assert.ok(v.ok);
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  // ⚠️ counters 初始是 `{}`（动态添加）⇒ 未触发时是 undefined；用 `?? 0` 兼容两种初始形状。
  assert.equal(res.state.players[0]?.counters.vetoCount ?? 0, 0, '3 人局不涉及放逐 ⇒ 不计数');
  assert.equal(res.state.players[0]?.resource, Math.max(0, (before ?? 0) - 2), '3 人局仍走扣灵枢裁定');
});

test('B75：否决后即时目标结算（veto_success 达成发印记）', () => {
  let s = readyVeto();
  s = {
    ...s,
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, flags: { ...p.flags, canVeto: true, goal: { kind: 'veto_success', count: 1 } } }
      : p)),
  };
  assert.equal(s.players[0]?.hasMark, false, '前提：结算前无印记');
  const v = useCouncilVeto(s, 0);
  const res = resolveCouncil(v.state);
  assert.equal(res.state.players[0]?.hasMark, true, '成功否决 ⇒ 即时目标达成 ⇒ 发印记');
});
