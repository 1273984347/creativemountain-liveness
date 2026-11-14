// B77 锚点反证（规格 §8「锚点本身的反证」）——这条文件是 r2 版 §4 的墓碑。
//
// r2 曾把六个步骤统一挂在 **round 末**。现查：每名玩家每 round 恰好一个手番
// （round.ts:17-27 + isRoundEnd），而 skip_turn / silence / immunity 的写入点全在
// **该玩家自己 手番内**（撞印判色 barrier.ts:63、关隘失败 gate.ts:317/345、行动阶段自己出牌）
// ⇒ round 末递减会在该玩家下次行动**之前**把状态抹平：「停 1 回合」一个手番都停不到、
// 禁言永不生效、免疫窗结构性恒为 0（六个计数器会全为 0）。
//
// 所以这里钉的不是某个数值，而是**锚点**：状态必须活着跨过 round 末，
// 并在该玩家的下一个手番真的咬住他。将来谁想"统一锚点"，会先撞上这一条。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyStatus, statusOf } from '../../engine/core/statuses.ts';
import { candidatesOf } from '../../engine/core/legal.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { resolveCouncil } from '../../engine/core/council.ts';
import { mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';
import type { NegativeStatus } from '../../engine/types/common.ts';

/** 让每名玩家站在不同格上：默认全在起点格 ⇒ 走 round 时会立刻立起对峙并阻塞推进。 */
function spread(s: State): State {
  return { ...s, players: s.players.map((p) => ({ ...p, position: 1 + p.seat })) };
}

/** 走到下一个 round 里座 `seat` 的手番（途中就地结算开启的山议，避免候选被 VOTE 污染）。 */
function walkUntilSeat(from: State, seat: number, cap = 80): State {
  let s = from;
  for (let i = 0; i < cap; i++) {
    if (s.council.resolved === false) {
      const r = resolveCouncil(s);
      if (r.ok) { s = r.state; }
    }
    if (currentPlayer(s) === seat) { return s; }
    if (currentPlayer(s) < 0) { break; }
    s = advanceTurn(s, 'standard');
  }
  throw new Error(`walkUntilSeat(${String(seat)}) 在 ${String(cap)} 步内没走到（对局可能被阻塞或已终局）`);
}

/** 在自己手番内被授予某状态（走真实写入 ⇒ 会置授予豁免标记，与撞印/关隘失败同形状）。 */
function grantOnOwnTurn(s: State, seat: number, kind: NegativeStatus, n: number): State {
  return applyStatus({ state: { ...s, turnIndex: s.turnOrder.indexOf(seat) }, actor: seat }, seat, kind, n).state;
}

const typesOf = (s: State, seat: number): string[] => candidatesOf(s, seat).map((a) => a.type);

test('B77 锚点：撞印式写入的 skip_turn 必须活着跨过 round 末，并在下一个手番真咬住人', () => {
  let s = spread(mk(4, 7));
  s = grantOnOwnTurn(s, 0, 'skip_turn', 1);
  assert.equal(statusOf(s, 0, 'skip_turn'), 1, '前提：写入 1 层');

  // ① 授予当回合：finishTurn 内的家族 B 结算必须**不衰减**它（豁免位生效）
  const ended = advanceTurn(s, 'standard');
  assert.equal(statusOf(ended, 0, 'skip_turn'), 1, '授予当回合不吃一拍 ⇒ 否则 skip(1) 永远停不到手番');

  // ② 跨过 round 末（r2 的锚点就是在这里把状态抹平的）
  const nextRound = walkUntilSeat(ended, 0);
  assert.equal(statusOf(nextRound, 0, 'skip_turn'), 1,
    'round 末不得抹掉状态 ⇒ 家族 B 的递减只许挂在 finishTurn');

  // ③ 下一个手番：确实被跳过（枚举只剩 PASS，且没有 PASS 之外的行动泄漏）
  assert.deepEqual(typesOf(nextRound, 0), ['PASS'],
    `被停手番者的行动面必须只剩 PASS，实际=${JSON.stringify(typesOf(nextRound, 0))}`);

  // ④ 交出这个手番 ⇒ 此刻才消耗掉那一层
  const afterSkip = advanceTurn(performAction(nextRound, 0, 'pass'), 'standard');
  assert.equal(statusOf(afterSkip, 0, 'skip_turn'), 0, 'skip(1) 恰好停掉一个手番');

  // ⑤ 再下一个手番恢复 ⇒ skip 不是永久出局
  const free = walkUntilSeat(afterSkip, 0);
  assert.ok(typesOf(free, 0).includes('MOVE'),
    `解封后必须能行棋，实际=${JSON.stringify(typesOf(free, 0))}`);
});

test('B77 锚点：silence 同样活着跨过 round 末，并在下一个手番拿走出牌（但保留行棋与装备）', () => {
  let s = spread(mk(4, 7));
  s = grantOnOwnTurn(s, 0, 'silence', 1);
  const ended = advanceTurn(s, 'standard');
  assert.equal(statusOf(ended, 0, 'silence'), 1, '授予当回合不衰减（封口 1 回合必须真的还剩 1 回合）');
  const nextRound = walkUntilSeat(ended, 0);
  const ts = typesOf(nextRound, 0);
  assert.equal(statusOf(nextRound, 0, 'silence'), 1, 'round 末不得抹掉封口');
  assert.ok(!ts.includes('PLAY_CARD'), `下一个手番必须发不出出牌候选，实际=${JSON.stringify(ts)}`);
  assert.ok(ts.includes('MOVE') && ts.includes('EQUIP_CARD'),
    `行棋与装备不受封口影响，实际=${JSON.stringify(ts)}`);
});
