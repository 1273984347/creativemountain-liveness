// B1 锁定 State 契约的行为测试（规格 §6.2）
//
// 覆盖「回合内临时状态」的三条语义：
//   · moveBonus / usedAsk / movedThisTurn 初始为零
//   · 回合末**一并**清零（整体替换，不逐字段漏清）
//   · 清零只影响 turn 子对象，不影响玩家其他状态

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, clearTurnStates, EMPTY_TURN, type State } from '../../engine/core/state.ts';
// B75：council.vetoBy 的读取侧容错要用真实山议局面与真实结算入口。
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene } from './fixtures.ts';

test('State 契约：Player 带 turn 回合内临时状态，初始为 EMPTY_TURN', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  for (const p of s.players) {
    assert.deepEqual(p.turn, EMPTY_TURN, '回合内临时状态初始应全零');
    assert.equal(p.turn.moveBonus, 0);
    assert.equal(p.turn.usedAsk, false);
    assert.equal(p.turn.movedThisTurn, false);
  }
});

test('State 契约：回合末清零 —— moveBonus/usedAsk/movedThisTurn 一并归零', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  // 模拟一回合内的状态污染
  const dirty: typeof s = {
    ...s,
    players: s.players.map((p, i) =>
      i === 0
        ? { ...p, turn: { moveBonus: 2, usedAsk: true, movedThisTurn: true } }
        : p
    ),
  };
  const cleared = clearTurnStates(dirty);
  assert.deepEqual(at(cleared.players, 0).turn, EMPTY_TURN, '回合末必须一并清零');
});

test('State 契约：清零不影响玩家其他状态（不可误伤）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  const dirty: typeof s = {
    ...s,
    players: s.players.map((p, i) =>
      i === 0
        ? { ...p, resource: 7, hp: 3, position: 12, hasMark: true, pendingCert: true,
            turn: { moveBonus: 5, usedAsk: true, movedThisTurn: true } }
        : p
    ),
  };
  const cleared = clearTurnStates(dirty);
  const p = at(cleared.players, 0);
  assert.equal(p.resource, 7, '灵枢不得被清零影响');
  assert.equal(p.hp, 3, '体力不得被清零影响');
  assert.equal(p.position, 12, '位置不得被清零影响');
  assert.equal(p.hasMark, true, '印记不得被清零影响');
  assert.equal(p.pendingCert, true, '待认证标记不得被清零影响');
  assert.deepEqual(p.turn, EMPTY_TURN, '只有 turn 应被清零');
});

// 局部取值辅助（noUncheckedIndexedAccess 下 arr[i] 是 T | undefined）
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  assert.ok(v !== undefined, `索引越界：arr[${i}]（长度 ${arr.length}）`);
  return v;
}

// ---------- B75：council.vetoBy 的读取侧容错（规格 §13 R4：不写迁移，只容错） ----------

/** 真·缺字段（不是 `vetoBy: undefined` 那种「键存在但值为 undefined」）：模拟 B75 之前落盘的存档。 */
function dropVetoBy(council: State['council']): State['council'] {
  const legacy: Record<string, unknown> = { ...council };
  delete legacy.vetoBy;
  return legacy as unknown as State['council'];
}

test('B75：新建状态的 council.vetoBy 默认为 null', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  assert.equal(s.council.vetoBy, null);
});

test('B75：旧存档缺 council.vetoBy ⇒ 按未使用处理，不抛错、也不误判为已否决', () => {
  let s = councilScene(4, 7);
  for (const p of s.players.filter((x) => x.alive)) {
    const r = castVote(s, p.seat, p.seat === 1 ? 0 : 1);
    assert.ok(r.ok, `前提：座 ${p.seat} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  const legacy: State = { ...s, council: dropVetoBy(s.council) };
  const r = resolveCouncil(legacy);
  assert.ok(r.ok, '缺 vetoBy 不得抛错：' + String(r.note));
  // ⚠️ 关键方向：缺字段 = **没用过否决**，绝不能因为「读出来是 undefined」就当成已否决而放过放逐。
  assert.equal(r.state.players[1]?.alive, false, '缺 vetoBy ⇒ 放逐照常');
  assert.equal(r.state.players[0]?.counters.vetoCount ?? 0, 0, '缺 vetoBy ⇒ 不得计数');
});
