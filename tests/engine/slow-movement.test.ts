// B77 ③：slow 层数＝本手番减 N 格，且与力竭的位移罚**合并为单一表达式**
// （规格 §3.2 ⇒ registry.ts 里不得出现第二处「下限 1」）。
//
// ⚠️ 为什么不写成 `assert.equal(位移, -1)`：move_by_dice 掷的是 d6，掷到 1 时
//   max(1, 1-1) = 1 ⇒ 罚值被下限吃掉，按固定期望值断言会随机红。
//   这里改成**对每个骰面**断言 moved === max(1, roll - penalty)，并要求样本里真的
//   出现过 roll=1（否则下限那条分支从未被跑到，用例只是空转）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyEffect } from '../../engine/ops/registry.ts';
import { mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

function withTurnState(s: State, seat: number, patch: { statuses?: Partial<State['players'][number]['statuses']>; exhausted?: number }): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? {
        ...p,
        ...(patch.statuses === undefined ? {} : { statuses: { ...p.statuses, ...patch.statuses } }),
        ...(patch.exhausted === undefined ? {} : { exhaustedRounds: patch.exhausted }),
      }
      : p)),
  };
}

/** 扫一批 seed，返回观测到的骰面集合。 */
function scan(seat: number, penalty: number): Set<number> {
  const seen = new Set<number>();
  for (let seed = 1; seed <= 120; seed++) {
    const base = withTurnState(mk(4, seed), seat, penalty === 2
      ? { statuses: { slow: 1 }, exhausted: 1 }
      : { statuses: { slow: penalty } });
    const before = base.players[seat]!.position;
    const r = applyEffect({ state: base, actor: seat }, { op: 'move_by_dice', faces: 6, target: seat });
    const roll = r.state.lastDice!;
    const moved = r.state.players[seat]!.position - before;
    assert.equal(moved, Math.max(1, roll - penalty), `seed ${String(seed)} 骰面 ${String(roll)}：位移罚不符`);
    seen.add(roll);
  }
  return seen;
}

test('B77：slow 1 层 ⇒ moved = max(1, 骰面-1)，且样本覆盖到骰面 1（下限真的被跑到）', () => {
  const seen = scan(0, 1);
  assert.ok(seen.has(1), `120 个 seed 里一次都没掷到 1 ⇒ 下限分支未被测试（实际骰面集 ${[...seen].join(',')}）`);
  assert.ok(seen.has(6), `骰面上界未覆盖（实际 ${[...seen].join(',')}）`);
});

test('B77：slow 3 层 ⇒ 骰 1–3 全被压到下限 1 格（行棋必须走满，不得原地）', () => {
  const seen = scan(0, 3);
  assert.ok(seen.has(1) && seen.has(2) && seen.has(3), `低骰面未覆盖，下限断言是空转（实际 ${[...seen].join(',')}）`);
});

test('B77：力竭 + slow 1 ⇒ 叠加罚 2（合并为单一表达式，不是两套 max）', () => {
  const penalty = 2;
  let hitLow = false;
  for (let seed = 1; seed <= 120; seed++) {
    const base = withTurnState(mk(4, seed), 0, { statuses: { slow: 1 }, exhausted: 1 });
    const before = base.players[0]!.position;
    const r = applyEffect({ state: base, actor: 0 }, { op: 'move_by_dice', faces: 6, target: 0 });
    const moved = r.state.players[0]!.position - before;
    assert.equal(moved, Math.max(1, r.state.lastDice! - penalty), `seed ${String(seed)}`);
    if (r.state.lastDice! <= penalty) { hitLow = true; }
  }
  assert.ok(hitLow, '未覆盖到「罚值≥骰面」的情形 ⇒ 叠加下限没被测到');
});

test('B77：slow 0 层 ⇒ 与 B76 力竭罚口径逐字一致（合并未改变既有语义）', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const base = withTurnState(mk(4, seed), 0, { exhausted: 1 });
    const before = base.players[0]!.position;
    const r = applyEffect({ state: base, actor: 0 }, { op: 'move_by_dice', faces: 6, target: 0 });
    assert.equal(r.state.players[0]!.position - before, Math.max(1, r.state.lastDice! - 1), `seed ${String(seed)}`);
  }
});
