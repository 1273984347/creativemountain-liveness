// B1 引擎骨架的行为契约（先于实现写，规格 §3.1 / §6.2 / §6.3 / §8）
//
// 本文件先于 engine/core/ 的实现落地 —— 若测试不是「因为功能缺失而失败」，
// 它就证明不了任何东西（TDD）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getScales, councilInterval, SCALES } from '../../engine/scales.ts';
import { createInitialState } from '../../engine/core/state.ts';
import { currentPlayer, isRoundEnd, nextTurn, advanceRound } from '../../engine/core/round.ts';
import { rollD6, rollD20, createRng } from '../../engine/core/dice.ts';


// ---------- 规模表（§8） ----------

test('规模表覆盖 3–8 人六档', () => {
  assert.equal(SCALES.length, 6);
  assert.deepEqual(SCALES.map((s) => s.players), [3, 4, 5, 6, 7, 8]);
});

test('5 人局签印门槛 N 为 3（不是 4，避免全员签印的终局僵局）', () => {
  assert.equal(getScales(5).threshold, 3);
});

test('印记后门槛 = ceil(N/2) 且最低为 1', () => {
  for (const s of SCALES) {
    assert.equal(s.thresholdWithMark, Math.max(1, Math.ceil(s.threshold / 2)));
  }
});

test('新手模式山议间隔 = 标准 + 2 回合', () => {
  for (const s of SCALES) {
    assert.equal(councilInterval(s, 'newbie'), s.councilIntervalStandard + 2);
    assert.equal(councilInterval(s, 'standard'), s.councilIntervalStandard);
  }
});

test('全局回合上限 = 12 + 人数', () => {
  for (const s of SCALES) {
    assert.equal(s.globalRoundLimit, 12 + s.players);
  }
});

test('放逐下限恒为 3（保证活人认证永远有认证人）', () => {
  for (const s of SCALES) {
    assert.equal(s.exileFloor, 3);
  }
});


// ---------- round / turn 粒度（§3.1 术语定义） ----------

test('回合(round) = 所有存活玩家各行动一次；手番(turn) = 单人一次行动', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  assert.equal(s.round, 1);
  assert.equal(s.turnIndex, 0);
  assert.equal(currentPlayer(s), 0);
});

test('手番推进：turnIndex 逐个递增，玩家按座位序轮转', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  const t1 = nextTurn(s);
  assert.equal(t1.turnIndex, 1);
  assert.equal(t1.round, 1);
  assert.equal(currentPlayer(t1), 1);
});

test('山议与认证检查仅在 round 末触发一次（不是每个手番触发）', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  // 3 人局：手番 0、1 都不是 round 末
  assert.equal(isRoundEnd(s), false);
  assert.equal(isRoundEnd(nextTurn(s)), false);
  // 第 3 个手番是 round 末
  const third = nextTurn(nextTurn(s));
  assert.equal(isRoundEnd(third), true);
});

test('round 末推进：round +1，turnIndex 归零', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  const after = advanceRound(nextTurn(nextTurn(s)));
  assert.equal(after.round, 2);
  assert.equal(after.turnIndex, 0);
  assert.equal(currentPlayer(after), 0);
});

test('玩家被放逐后不再占用手番（存活玩家才行动）', () => {
  const s = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  const withOneOut = {
    ...s,
    players: s.players.map((p, i) => (i === 1 ? { ...p, alive: false } : p)),
  };
  const t = nextTurn(withOneOut);
  assert.equal(currentPlayer(t), 2);
});


// ---------- 骰子（§3.2 双骰） ----------

test('同 seed 产生同序列（可复现）', () => {
  const a = createRng(7);
  const b = createRng(7);
  for (let i = 0; i < 10; i++) {
    assert.equal(rollD6(a), rollD6(b));
  }
});

test('同一随机源连续取数产生不同结果（状态必须推进）', () => {
  const rng = createRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) {
    seen.add(rollD6(rng));
  }
  assert.ok(seen.size > 1, '随机源未推进，骰子恒定');
});

test('6 面骰结果落在 1–6，20 面骰落在 1–20', () => {
  const rng = createRng(1);
  for (let i = 0; i < 200; i++) {
    const d6 = rollD6(rng);
    assert.ok(d6 >= 1 && d6 <= 6, `6面骰越界: ${d6}`);
    const d20 = rollD20(rng);
    assert.ok(d20 >= 1 && d20 <= 20, `20面骰越界: ${d20}`);
  }
});
