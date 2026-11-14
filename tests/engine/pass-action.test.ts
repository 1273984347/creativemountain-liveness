// B77：`PASS` 端到端 —— 被停手番者的唯一出口（规格 §2.3 / §3.4 / §3.6）。
//
// ⚠️ 本批之前 `PASS` 是**两端未接**的契约成员：key 编解码、probe、UI 闸门、探针文案四处
//   case 齐全，但 `legal.ts` 从不发它、`performAction` 没有分支、UI 闸门直接登记为
//   「数字轨没有 UI 入口」。三层对同一个成员各执一词 ⇒ 本任务把它们对齐到
//   `statuses.isActionBlocked` 这一个判据上（布尔一致 + 拒因一致）。
// ⚠️ PASS 的实现刻意**只写日志**：结算与推进仍归 `advanceTurn` / `finishTurn`，
//   否则 PASS 会变成第二条"绕过地形结算"的捷径（B18-c 解耦的本意）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { candidatesOf } from '../../engine/core/legal.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { probeAction } from '../../engine/core/probe.ts';
import { statusOf } from '../../engine/core/statuses.ts';
import { uiAllows, uiBlockNotice, uiCandidates } from '../../web/legal-gate.ts';
import { mk } from './fixtures.ts';
import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';

const withSkip = (s: State, seat: number, n: number): State => ({
  ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, skip_turn: n } } : p)),
});
const atSeat = (s: State, seat: number): State => ({ ...s, turnIndex: s.turnOrder.indexOf(seat) });
const typesOf = (list: readonly Action[]): string[] => list.map((a) => a.type);

test('B77：skip 中 PASS 被接受并写「停手番」日志，手番随之推进', () => {
  const s = atSeat(withSkip(mk(4, 7), 0, 1), 0);
  const passed = performAction(s, 0, 'pass');
  assert.notEqual(passed, s, '接受 ⇒ 状态必须变化（引用相等即拒绝）');
  assert.match(passed.log.at(-1)!.message, /^停手番：座位 0$/, '前缀是报告计数器的契约（规格 §9）');
  const moved = advanceTurn(passed, 'standard');
  assert.ok(moved.turnIndex !== s.turnIndex || moved.round !== s.round, '手番确实推进了');
});

test('B77：未被 skip 时 PASS 被三层一致拒绝（引擎 / UI 闸门 / 两侧候选）', () => {
  const s = atSeat(mk(4, 7), 0);
  const pass: Action = { type: 'PASS', actor: 0 };
  assert.equal(performAction(s, 0, 'pass'), s, '引擎拒（引用相等）');
  assert.equal(uiAllows(s, 0, pass), false, 'UI 闸门拒');
  assert.match(uiBlockNotice(s, 0, pass) ?? '', /没人封你/, '拒因要说人话，不能是空串');
  assert.ok(!candidatesOf(s, 0).some((a) => a.type === 'PASS'), '枚举候选里没有 PASS');
  assert.ok(!uiCandidates(s, 0).some((a) => a.type === 'PASS'), 'UI 候选里没有 PASS');
  assert.equal(probeAction(s, pass).ok, false, '探针也必须拒 —— 否则枚举会发出一条引擎不接受的候选');
});

test('B77：skip 生效时三层同判为"接受"，且两侧候选集都只剩 PASS', () => {
  const s = atSeat(withSkip(mk(4, 7), 0, 1), 0);
  const pass: Action = { type: 'PASS', actor: 0 };
  assert.equal(uiAllows(s, 0, pass), true);
  assert.equal(probeAction(s, pass).ok, true, '探针接受 ⇒ getLegalActions 才不会把它滤掉');
  assert.deepEqual(typesOf(candidatesOf(s, 0)), ['PASS']);
  assert.deepEqual(typesOf(uiCandidates(s, 0)), ['PASS'], 'UI 候选必须与枚举候选同集合（漂移守卫的同一对）');
});

test('B77：skip 只拿走行动，回合末结算照做（收入 +1、状态递减）', () => {
  const s = atSeat(withSkip(mk(4, 7), 0, 1), 0);
  const before = s.players[0]!.resource;
  const after = advanceTurn(performAction(s, 0, 'pass'), 'standard');
  assert.equal(after.players[0]!.resource, before + 1, 'finishTurn 的收入不能被 skip 掉（§3.4：惩罚＝少一次行动）');
  assert.equal(statusOf(after, 0, 'skip_turn'), 0, '被跳过的那个手番末即递减 ⇒ skip(1) 恰好停一个手番');
});

// ⚠️ 这里**不**测「skip(2) 停掉连续两个手番」：那要跨 round 走，而同一个 round 内
//   把 turnIndex 倒回同一座位会撞上 B75.2 的 `turn.finished` 闩（finishTurn 被合法跳过 ⇒
//   不递减），造出的是现实里不存在的节奏。多轮节奏见 tests/engine/status-anchor.test.ts。
test('B77：skip(2) 本手番只递减一层（不是清零），且剩余层数继续封住行动面', () => {
  const s = atSeat(withSkip(mk(4, 7), 0, 2), 0);
  const after = advanceTurn(performAction(s, 0, 'pass'), 'standard');
  assert.equal(statusOf(after, 0, 'skip_turn'), 1, '停一个手番只消耗一层');
  // 剩余层数继续封锁（封锁按层数计，不按"这局用过一次 skip"计）
  assert.deepEqual(candidatesOf(after, 0).map((a) => a.type), ['PASS'],
    '仍剩 1 层 ⇒ 枚举继续只发 PASS');
});
