// B1 锁定 State 契约的行为测试（规格 §6.2）
//
// 覆盖「回合内临时状态」的三条语义：
//   · moveBonus / usedAsk / movedThisTurn 初始为零
//   · 回合末**一并**清零（整体替换，不逐字段漏清）
//   · 清零只影响 turn 子对象，不影响玩家其他状态

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createInitialState, clearTurnStates, EMPTY_TURN, type State } from '../../engine/core/state.ts';
import { performAction, advanceTurn } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
// B75：council.vetoBy 的读取侧容错要用真实山议局面与真实结算入口。
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene, mk } from './fixtures.ts';

test('State 契约：Player 带 turn 回合内临时状态，初始为 EMPTY_TURN', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  for (const p of s.players) {
    assert.deepEqual(p.turn, EMPTY_TURN, '回合内临时状态初始应全零');
    assert.equal(p.turn.moveBonus, 0);
    assert.equal(p.turn.usedAsk, false);
    assert.equal(p.turn.movedThisTurn, false);
  }
});

test('State 契约：回合末清零 —— usedAsk/movedThisTurn/abilityUsedThisTurn 归零，moveBonus 保留（B75.2 定案）', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  // 模拟一回合内的状态污染
  const dirty: typeof s = {
    ...s,
    players: s.players.map((p, i) =>
      i === 0
        ? { ...p, turn: { moveBonus: 2, usedAsk: true, movedThisTurn: true, abilityUsedThisTurn: true } }
        : p
    ),
  };
  const cleared = clearTurnStates(dirty);
  const t = at(cleared.players, 0).turn;
  // ⚠️ B75.2 裁定：moveBonus **不**随回合末清零 —— 指令 17 在「一回合一行动」节奏下
  //   只能跨手番生效（问天的同一手番没有行动机会再移动），清了它指令 17 就是死指令；
  //   现行语义是「用后清零」（registry.ts 的 move_forward/move_by_dice 消费点）。
  //   其余「本回合」标志（usedAsk / movedThisTurn / abilityUsedThisTurn）回合末归零。
  assert.equal(t.moveBonus, 2, 'moveBonus 用后清零（指令 17 跨手番生效），回合末保留');
  assert.equal(t.usedAsk, false);
  assert.equal(t.movedThisTurn, false);
  assert.equal(t.abilityUsedThisTurn, false);
  assert.equal(t.finished, false);
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
  assert.equal(p.turn.moveBonus, 5, 'moveBonus 保留');
  assert.equal(p.turn.usedAsk, false, 'usedAsk 清零');
  assert.equal(p.turn.movedThisTurn, false, 'movedThisTurn 清零');
});

test('B75.2 回归：跨 round 后「每回合」类 turn 标志必须复位（B1 契约接线——clearTurnStates 此前零调用方）', () => {
  // ⚠️ 这是 B75.2 的立项级发现：规格 §6.2 一直要求回合末清零，clearTurnStates 也一直存在，
  //   但**从未被任何回合末流程调用** ⇒ 「每回合 1 次」类被动实际整局只能用 1 次
  //   （实测：窃火者第 2 回合追goal被拒「本回合已发动过被动」）⇒ reroll_count / steal_count
  //   在策略层面根本不可达。本用例钉住接线本身：改 clearTurnStates 而不接线，这里照样红。
  let s = mk(4, 7);
  s = { ...s, players: s.players.map((p, i) => (i === 0
    ? { ...p, turn: { ...p.turn, abilityUsedThisTurn: true, movedThisTurn: true, usedAsk: true, moveBonus: 2 } }
    : p)) };
  // 把 turnIndex 推到 round 末，让下一手番跨 round（默认棋盘全 plain，无暂停路径）
  s = { ...s, turnIndex: s.turnOrder.length - 1 };
  const cur = currentPlayer(s);
  assert.ok(cur >= 0, '前提：round 末存在当前手番玩家');
  s = performAction(s, cur, 'move');
  s = advanceTurn(s, 'standard');
  assert.equal(s.round, 2, `前提：已跨入第 2 回合（实际 ${s.round}）`);
  const p0 = at(s.players, 0);
  assert.equal(p0.turn.abilityUsedThisTurn, false, '每回合 1 次类被动的闸门必须复位（否则 = 每局 1 次）');
  assert.equal(p0.turn.movedThisTurn, false, '开拓者「每回合首次移动 +1」的基准必须复位');
  assert.equal(p0.turn.usedAsk, false, 'usedAsk 复位');
  assert.equal(p0.turn.moveBonus, 2, 'moveBonus 跨手番保留（用后清零）');
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

test('B76：Player 带 exhaustedRounds（0 = 未力竭），初始状态人人 0', () => {
  const s = createInitialState({ players: 3, seed: 1, deckSize: 40 });
  for (const p of s.players) {
    // ⚠️ 不带 ?? 0 容错：字段本身必须存在且为 0（缺字段 = 契约未实现，必须红）。
    //    读取侧容错（?? 0）属于消费点（handLimitOf 等），不属于契约断言。
    assert.equal('exhaustedRounds' in p, true, '字段必须存在（旧存档容错在消费点做，不在契约上做）');
    assert.equal(p.exhaustedRounds, 0);
  }
});

// ---------- B77：PlayerTurnState 新增键的**文档登记**必须被机械核对 ----------
//
// ⚠️ 为什么要自己写这条用例：门 ③ 的 C9 只解析 `export interface State` 的**顶层**字段
//   （engine/core/state-fields.mjs 的 parseStateFields），**看不到 PlayerTurnState 的嵌套键**
//   ⇒ B76 的 Player.exhaustedRounds 与本批的 turn.statusGrantedThisTurn 都不在 C9 覆盖内，
//   「规格先行」的纪律在这类字段上没有任何门禁兜着。本用例从 EMPTY_TURN（事实源）派生
//   逐键核对主规格 §6.2，补上这个盲区——清单不是手抄的，所以它不会自己变成第二事实源。
test('B77：EMPTY_TURN 每个键都必须在主规格 §6.2 登记（C9 的嵌套字段盲区）', () => {
  const spec = readFileSync('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md', 'utf8');
  const idx = spec.indexOf('### 6.2 引擎状态');
  assert.ok(idx >= 0, '前提：规格含 §6.2 引擎状态小节（C9 同款定位方式）');
  const end = spec.indexOf('\n### ', idx + 10);
  const sec = spec.slice(idx, end === -1 ? idx + 4000 : end);
  for (const key of Object.keys(EMPTY_TURN)) {
    assert.ok(sec.includes('`' + key + '`'), `PlayerTurnState.${key} 未登记进规格 §6.2（文档欠账）`);
  }
});

test('B77：EMPTY_TURN 显式含 statusGrantedThisTurn=false，且 clearTurnStates 会清它', () => {
  assert.equal(EMPTY_TURN.statusGrantedThisTurn, false,
    '缺省必须显式为 false（exactOptionalPropertyTypes 下 undefined 与 false 不同形）');
  const dirty: State = {
    ...createInitialState({ players: 3, seed: 1, deckSize: 40 }),
    players: createInitialState({ players: 3, seed: 1, deckSize: 40 }).players
      .map((p) => ({ ...p, turn: { ...p.turn, statusGrantedThisTurn: true } })),
  };
  assert.equal(clearTurnStates(dirty).players[0]!.turn.statusGrantedThisTurn, false, 'round 末安全网必须清掉');
});
