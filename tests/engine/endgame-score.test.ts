// 终局得分公式回归锁（B11 逐档标定）。
//
// 背景：victory.ts 文件头注释曾写「终局得分 = 席数 × ⌈山道长度÷2⌉ − 距峰顶」，
//   但实现取的是规模表 seatWeight（逐档标定，8000 局/档扫描）。6 人局 ⌈32÷2⌉=16，
//   真值却是 20——注释过时。本文件钉死各档 seatWeight 的具体标定值与 6 人局终局
//   场景的具体得分，防止有人把权重改回「半座山」近似式而无声回归。
//
// 与 live-seats.test.ts 的分工：那边钉公式关系（权重来自规模表 / 权重<山道 / 位置可
//   抵消席位）；这边钉**具体标定值**与**6 人局具体数字**（关系测试抓不到的精度）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { rankScore, seatWeight, distanceToPeak, fallbackRanking, resolveVictory } from '../../engine/core/victory.ts';
import { getScales } from '../../engine/scales.ts';

/** 6 人局真实 state，覆盖各座位置 / 席位 / 累计签印。 */
function sixPlayer(overrides: { seat: number; pos: number; seats?: number; sig?: number }[]): State {
  const s = createInitialState({ players: 6, seed: 7, deckSize: 64 });
  const bySeat = new Map(overrides.map((o) => [o.seat, o]));
  const liveSeats: Record<number, number> = {};
  for (const o of overrides) { if (o.seats) { liveSeats[o.seat] = o.seats; } }
  return {
    ...s,
    liveSeats,
    players: s.players.map((p) => {
      const o = bySeat.get(p.seat);
      return o ? { ...p, position: o.pos, counters: { ...p.counters, signaturesTotal: o.sig ?? 0 } } : p;
    }),
  };
}

// ---------- 各档席位权重标定值（逐档，非 ⌈山道÷2⌉） ----------

test('终局回归：各档 seatWeight 锁定逐档标定真值（不是 ⌈山道长度÷2⌉）', () => {
  const expected: Record<number, number> = { 3: 12, 4: 20, 5: 16, 6: 20, 7: 24, 8: 24 };
  for (const players of [3, 4, 5, 6, 7, 8] as const) {
    const row = getScales(players);
    assert.equal(row.seatWeight, expected[players], `${players} 人局 seatWeight 应为标定值 ${expected[players]}`);
    assert.equal(seatWeight(createInitialState({ players, seed: 1 })), expected[players], `${players} 人局 seatWeight() 应读规模表真值`);
  }
});

test('终局回归：6 人局 seatWeight=20，而非过时注释的 ⌈32÷2⌉=16', () => {
  const s = createInitialState({ players: 6, seed: 7 });
  assert.equal(seatWeight(s), 20);
  assert.notEqual(seatWeight(s), Math.ceil(s.board.length / 2), '权重不应等于「半座山」近似式（6 人局 16）');
});

// ---------- 6 人局终局具体场景（名场面流程脚本验证固化） ----------

test('终局回归：6 人局早期取席回起点(1席@pos0) 输给 0 席贴峰顶(pos30)——位置补偿刻意抵消先手', () => {
  const st = sixPlayer([{ seat: 0, pos: 0, seats: 1, sig: 4 }, { seat: 1, pos: 30, seats: 0 }]);
  assert.equal(distanceToPeak(st, 0), 32);
  assert.equal(distanceToPeak(st, 1), 2);
  assert.equal(rankScore(st, 0), 1 * 20 - 32); // −12
  assert.equal(rankScore(st, 1), 0 * 20 - 2);  // −2
  assert.ok(rankScore(st, 1) > rankScore(st, 0), '0 席贴峰顶者得分应更高');
  assert.deepEqual(fallbackRanking(st), [1], '0 席贴峰顶者胜（先手领先被位置补偿抵消）');
});

test('终局回归：6 人局取席者爬回 pos20(距峰顶12) 逆转胜出 0 席贴峰顶者', () => {
  const st = sixPlayer([{ seat: 0, pos: 20, seats: 1, sig: 4 }, { seat: 1, pos: 30, seats: 0 }]);
  assert.equal(rankScore(st, 0), 1 * 20 - 12); // 8
  assert.equal(rankScore(st, 1), -2);
  assert.deepEqual(fallbackRanking(st), [0], '爬回足够距离的取席者胜');
  const res = resolveVictory({ ...st, round: st.scales.globalRoundLimit + 1 });
  assert.equal(res.outcome.reason, 'seats');
  assert.deepEqual(res.outcome.winners, [0]);
});

test('终局回归：6 人局取席者翻盘临界点——距峰顶≤21格(pos≥11) outright 赢；pos10 同分靠累计签印 tiebreak', () => {
  const outright = sixPlayer([{ seat: 0, pos: 11, seats: 1, sig: 4 }, { seat: 1, pos: 30, seats: 0 }]);
  assert.equal(rankScore(outright, 0), -1);
  assert.ok(rankScore(outright, 0) > rankScore(outright, 1), 'pos11(距峰顶21) 应 outright 赢');
  assert.deepEqual(fallbackRanking(outright), [0]);

  const tie = sixPlayer([{ seat: 0, pos: 10, seats: 1, sig: 4 }, { seat: 1, pos: 30, seats: 0 }]);
  assert.equal(rankScore(tie, 0), -2);
  assert.equal(rankScore(tie, 0), rankScore(tie, 1), 'pos10 与 0 席@pos30 同分(−2)');
  assert.deepEqual(fallbackRanking(tie), [0], '同分按累计签印(4>0) tiebreak，取席者胜');
});