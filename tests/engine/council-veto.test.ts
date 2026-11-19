// B75：仲裁者否决 —— 入口校验、结算、计数与即时目标。
// ⚠️ 测试里直接改 `flags.canVeto` 是**夹具**手段；生产路径由 Task 2 的 `setup` 按身份 `rights` 授予。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castVote, useCouncilVeto, resolveCouncil, topVoted as topVotedOf } from '../../engine/core/council.ts';
import { candidatesOf } from '../../engine/core/legal.ts';
import { uiAllows, uiBlockNotice, uiCandidates } from '../../web/legal-gate.ts';
import type { Action } from '../../engine/core/action.ts';
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
  assert.equal(res.state.council.vetoBy, 0, '前提：本局否决者是 0 号座');
  // B80 §2.3：句子里的主体必须是**否决者**的座位号（`council.vetoBy`），不是结算时的当前手番
  //   ——`resolveCouncil(state)` 根本不收 actor，任何"默认取当前行动者"的实现都会在这里红。
  assert.match(String(res.note), /\{identity:0\}否决/,
    '⇒ 引擎交出的是带座位的占位符形态，不再硬写某一套的身份名（称谓由显示出口按主题展开）');
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

test('B75：3 人局不受否决影响（扣资源分支）', () => {
  // ⚠️ B75.1：持权者不能是被最高票的那个（否则测的是「自救被拒」）⇒ 座 2 持权、座 0 被最高票。
  let s = grantVeto(councilScene(3, 7), 2);
  for (const p of s.players) {
    const others = s.players.filter((x) => x.alive && x.seat !== p.seat).map((x) => x.seat);
    const r = castVote(s, p.seat, p.seat === 0 ? (others[0] ?? 1) : 0);
    assert.ok(r.ok, '前提：3 人局投票必须成功：' + String(r.note));
    s = r.state;
  }
  assert.deepEqual(topVotedOf(s), [0], '前提：被最高票的是座 0（持权者座 2 不自救）');
  const before = s.players[0]?.resource;
  const v = useCouncilVeto(s, 2);
  assert.ok(v.ok, '前提：救他人形状的否决必须可用：' + String(v.note));
  const res = resolveCouncil(v.state);
  assert.ok(res.ok);
  // ⚠️ counters 初始是 `{}`（动态添加）⇒ 未触发时是 undefined；用 `?? 0` 兼容两种初始形状。
  assert.equal(res.state.players[2]?.counters.vetoCount ?? 0, 0, '3 人局不涉及放逐 ⇒ 不计数');
  assert.equal(res.state.players[0]?.resource, Math.max(0, (before ?? 0) - 2), '3 人局仍走扣资源裁定');
});

test('B75.1：不能为自己使用否决（只可救他人）—— 引擎与 UI 三层同判', () => {
  // 全员投给座 0（座 0 自己投给别人 ⇒ 票齐），座 0 持权且是最高票 ⇒ 这正是被禁掉的「自救」形状。
  let s = grantVeto(councilScene(4, 7), 0);
  for (const p of s.players.filter((x) => x.alive)) {
    const r = castVote(s, p.seat, p.seat === 0 ? 1 : 0);
    assert.ok(r.ok, `前提：座 ${String(p.seat)} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  const r = useCouncilVeto(s, 0);
  assert.equal(r.ok, false, '自救必须被拒');
  assert.match(String(r.note), /只可救他人/);
  assert.equal(s.council.vetoUsed, false, '被拒不得消耗「每局一次」（否则白挨一次）');
  // 三层同步：UI 门禁同一句、两侧候选都不发 ⇒ 自救形状不会变成「按钮亮着但按不动」的死选项
  const veto: Action = { type: 'COUNCIL_VETO', actor: 0 };
  assert.equal(uiBlockNotice(s, 0, veto), '你不能为自己使用否决（只可救他人）。');
  assert.equal(uiAllows(s, 0, veto), false);
  assert.equal(candidatesOf(s, 0).some((a) => a.type === 'COUNCIL_VETO'), false, '引擎粗筛不得发自救候选');
  assert.equal(uiCandidates(s, 0).some((a) => a.type === 'COUNCIL_VETO'), false, 'UI 粗筛不得发自救候选');
  // 反证：同一个「票齐 + 持权」的形状改成**救他人**（持权者是座 1，被最高票的是座 0）⇒ 必须可用
  let other = grantVeto(councilScene(4, 7), 1);
  for (const p of other.players.filter((x) => x.alive)) {
    const others = other.players.filter((x) => x.alive && x.seat !== p.seat).map((x) => x.seat);
    const to = p.seat === 0 ? (others[0] ?? 1) : 0;
    const v = castVote(other, p.seat, to);
    assert.ok(v.ok, `前提：座 ${String(p.seat)} 投票必须成功：` + String(v.note));
    other = v.state;
  }
  assert.deepEqual(topVotedOf(other), [0], '前提：被最高票的必须是座 0（持权者座 1 不在最高票里）');
  assert.equal(useCouncilVeto(other, 1).ok, true, '被最高票的是别人 ⇒ 否决仍然可用（战术价值保留）');
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
