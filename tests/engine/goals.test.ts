// 终局目标可达性（B60 · G-c 关隘接线）的回归测试。
//
// ⚠️ **本文件钉住的是「三环闭环」，不是单个函数** ——
//   环 A：关隘通过 ⇒ 写 `gatesPassed` 计数（engine/core/gate.ts 的 `markGatePassed`）
//   环 B：身份目标从主题包派生到运行时状态 + 判定器被调用（engine/goals/settle.ts）
//   环 C：目标达成 ⇒ 发【印记】（Player.hasMark）
//   ⇒ **任一环缺失，`pass_gates` 目标都仍然「不可达」** —— 只测其中一环会漏掉另外两环。
//
// ⚠️ 每层断言带**专属措辞**（`[LAYER-A-COUNT 计数写入]` / `[LAYER-B-DERIVE 目标派生]` / `[LAYER-C-MARK 判定与发印记]`）
//   —— 变异自证（文末 D 组）据此判定「被 mutant 打红的是哪一层」，
//   避免「因为别的原因红」而误判通过。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { markGatePassed, resolveCompareGate, resolveGate } from '../../engine/core/gate.ts';
import { goalOf, settleGoals, settleRoundEndGoals, settleTerminalGoals } from '../../engine/goals/settle.ts';
import { certificationThreshold } from '../../engine/core/certification.ts';
import { castVote, openCouncil, resolveCouncil } from '../../engine/core/council.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import {
  advanceCertificationRound, certifyAnswer, certifyAppeal, certifyAppealVote, certifyChallenge, resolveAppeals,
} from '../../engine/core/certification.ts';
import { drawCards } from '../../engine/core/hand.ts';
import { putPending } from './fixtures.ts';
import { advanceTurn } from '../../engine/core/turn-runner.ts';
import { resolveVictory } from '../../engine/core/victory.ts';
import type { Card, GoalKind, ThemePack } from '../../engine/types/theme.ts';

const THEME = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;

/** 落雁关：6 号格，标价 3，试炼池 t_mirror / t_sword / t_oath。 */
const GATE_INDEX = 6;
const GATE_FEE = 3;

/** 探针牌（颜色决定比牌胜负：红 > 黑）。 */
const probeRed: Card = { id: 'probe-red', name: '探针红', type: 'attack', cost: 0, color: 'red', rank: 5, text: '', effects: [] };
const probeBlack: Card = { id: 'probe-black', name: '探针黑', type: 'attack', cost: 0, color: 'black', rank: 14, text: '', effects: [] };

/** 装主题的初始局面（走**真实引擎入口** `installTheme` ⇒ 身份与目标都是真的）。 */
function themed(players = 4, seed = 7): State {
  const row = { 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 } as const;
  const n = row[players as 3 | 4 | 5 | 6 | 7 | 8];
  return installTheme(
    createInitialState({ players: n, seed, deckSize: THEME.counts.deckTotal }),
    THEME,
  );
}

/** 把座位放到关隘格上（资源给足）。 */
function atGate(s: State, seat = 0, resource = 10): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat ? { ...p, position: GATE_INDEX, resource } : p)),
  };
}

/** 只保留指定试炼牌 ⇒ 抽牌确定（避免随机 ⇒ flaky）。 */
function onlyTrials(s: State, ids: readonly string[]): State {
  return { ...s, decks: { ...s.decks, trial: s.decks.trial.filter((c) => ids.includes(c.id)) } };
}

/** 单元级前置：给某座位设置身份目标与计数器（纯数据，不伪造流程状态）。 */
function withGoal(s: State, seat: number, kind: GoalKind, count: number, counterValue: number): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? {
          ...p,
          flags: { ...p.flags, goal: { kind, count } },
          counters: { ...p.counters, gatesPassed: counterValue },
        }
      : p)),
  };
}

// ================= A 组：环 A（计数写入） =================

test('[B60-A 计数写入] 付费通道通过 ⇒ gatesPassed 记为 1（不是只写通过标记）', () => {
  const s = atGate(themed());
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, true, '[LAYER-A-COUNT 计数写入] 付费通道应通过：' + String(r.note));
  assert.equal(r.state.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true,
    '[LAYER-A-COUNT 计数写入] 应写下通过标记');
  assert.equal(r.state.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 付费通过后 gatesPassed 必须为 1（规格 §6.4：pass_gates = 本局通过关隘数）');
  assert.equal(r.state.players[0]?.resource, 10 - GATE_FEE,
    '[LAYER-A-COUNT 计数写入] 付费仍应扣掉标价（计数写入不得改动原有语义）');
});

test('[B60-A 计数写入] 试炼通道通过 ⇒ gatesPassed 记为 1', () => {
  const s = onlyTrials(atGate(themed()), ['t_mirror']);
  // t_mirror 判定「手里至少 2 张红牌」⇒ 塞 2 张红牌 ⇒ **必过**（确定性 ⇒ 不 flaky）。
  const withHand: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, hand: [probeRed, { ...probeRed, id: 'probe-red-2' }] }
      : p)),
  };
  const r = resolveGate(withHand, 0, 'trial');
  assert.equal(r.ok, true, '[LAYER-A-COUNT 计数写入] 试炼通道应成功：' + String(r.note));
  assert.equal(r.passed, true, '[LAYER-A-COUNT 计数写入] t_mirror 必过（手里 2 张红牌）');
  assert.equal(r.state.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 试炼通过后 gatesPassed 必须为 1');
});

test('[B60-A 计数写入] 出牌比对胜出 ⇒ gatesPassed 记为 1', () => {
  const s = atGate(themed());
  const withHands: State = {
    ...s,
    players: s.players.map((p) => {
      if (p.seat === 0) { return { ...p, hand: [probeRed] }; }
      if (p.seat === 1) { return { ...p, hand: [probeBlack] }; }
      return p;
    }),
  };
  const r = resolveCompareGate(withHands, 0, 'probe-red', 1);
  assert.equal(r.ok, true, '[LAYER-A-COUNT 计数写入] 比牌动作应被接受：' + String(r.note));
  assert.equal(r.passed, true, '[LAYER-A-COUNT 计数写入] 红 > 黑 ⇒ 应胜出通过');
  assert.equal(r.state.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 比牌通过后 gatesPassed 必须为 1');
});

test('[B60-A 计数写入] 对方手牌为空 ⇒ 自动胜出 ⇒ gatesPassed 记为 1', () => {
  const s = atGate(themed());
  const withHands: State = {
    ...s,
    players: s.players.map((p) => {
      if (p.seat === 0) { return { ...p, hand: [probeRed] }; }
      if (p.seat === 1) { return { ...p, hand: [] }; }
      return p;
    }),
  };
  const r = resolveCompareGate(withHands, 0, 'probe-red', 1);
  assert.equal(r.ok, true, '[LAYER-A-COUNT 计数写入] 比牌动作应被接受：' + String(r.note));
  assert.equal(r.passed, true, '[LAYER-A-COUNT 计数写入] 对方无手牌 ⇒ 自动胜出');
  assert.equal(r.state.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 自动胜出后 gatesPassed 必须为 1');
});

test('[B60-A 计数写入] 「未通过并放行」⇒ 不计入通过数', () => {
  const s = atGate(themed(), 0, 0);
  const payOnly: State = {
    ...s,
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, flags: { ...p.flags, [`gate_pay_${String(GATE_INDEX)}`]: true } }
      : p)),
  };
  const r = resolveGate(payOnly, 0, 'pay');
  assert.equal(r.ok, true, '[LAYER-A-COUNT 计数写入] 放行路径也应 ok：' + String(r.note));
  assert.equal(r.passed, false, '[LAYER-A-COUNT 计数写入] 付不起 ⇒ 判未通过并放行');
  assert.equal(r.state.players[0]?.flags[`gate_${String(GATE_INDEX)}`], undefined,
    '[LAYER-A-COUNT 计数写入] 放行不得写通过标记');
  assert.equal(r.state.players[0]?.counters.gatesPassed, undefined,
    '[LAYER-A-COUNT 计数写入] **被放行不算通过关隘** ⇒ 计数不得增加');
});

test('[B60-A 计数写入] 同一座关隘重复标记 ⇒ 幂等（不重复计数）', () => {
  const s = atGate(themed());
  const tile = s.board.tiles.find((t) => t.index === GATE_INDEX);
  assert.ok(tile !== undefined, '[LAYER-A-COUNT 计数写入] 主题棋盘应有关隘格');
  const once = markGatePassed(s, 0, tile);
  const twice = markGatePassed(once, 0, tile);
  assert.equal(once.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 第一次标记 ⇒ 计数 1');
  assert.equal(twice.players[0]?.counters.gatesPassed, 1,
    '[LAYER-A-COUNT 计数写入] 重复标记同一座关隘 ⇒ 计数仍为 1（幂等，不得重复计）');
});

test('[B60-A 计数写入] 通过 3 座不同关隘 ⇒ gatesPassed = 3（pass_gates 阈值 3 可达）', () => {
  let s = atGate(themed());
  for (const idx of [6, 14, 22]) {
    const tile = s.board.tiles.find((t) => t.index === idx);
    assert.ok(tile !== undefined, '[LAYER-A-COUNT 计数写入] 主题棋盘应有关隘格 ' + String(idx));
    s = markGatePassed(s, 0, tile);
  }
  assert.equal(s.players[0]?.counters.gatesPassed, 3,
    '[LAYER-A-COUNT 计数写入] 三座关隘 ⇒ 计数 3（规格 §6.4 的 pass_gates 阈值 3 确实可达）');
});

// ================= B 组：环 B（目标派生） =================

test('[B60-B 目标派生] 装主题后每个玩家的身份目标与主题包逐字一致（不是硬编码）', () => {
  const s = themed();
  for (const p of s.players) {
    const identity = THEME.identities.find((i) => i.id === p.identityId);
    assert.ok(identity !== undefined,
      '[LAYER-B-DERIVE 目标派生] 座 ' + String(p.seat) + ' 的身份应在主题包里：' + p.identityId);
    const g = goalOf(s, p.seat);
    assert.ok(g !== null, '[LAYER-B-DERIVE 目标派生] 座 ' + String(p.seat) + ' 应派生出身份目标');
    assert.equal(g.kind, identity.goal.kind,
      '[LAYER-B-DERIVE 目标派生] 目标 kind 必须与主题包一致');
    assert.equal(g.count, identity.goal.count ?? 1,
      '[LAYER-B-DERIVE 目标派生] 目标 count 必须与主题包一致（缺省 1）');
  }
});

test('[B60-B 目标派生] 四套主题的 8 个身份目标彼此一致（同一份口径，不是各写一份）', () => {
  const ids = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];
  const shapes = ids.map((id) => {
    const t = JSON.parse(readFileSync(resolve(`themes/${id}/theme.json`), 'utf8')) as ThemePack;
    return t.identities.map((i) => `${i.id}=${i.goal.kind}/${i.goal.count ?? 1}`).join(',');
  });
  for (let i = 1; i < shapes.length; i++) {
    assert.equal(shapes[i], shapes[0],
      '[LAYER-B-DERIVE 目标派生] ' + String(ids[i]) + ' 的身份目标应与 ' + String(ids[0]) + ' 一致');
  }
});

// ================= C 组：环 C（判定与发印记） =================

test('[B60-C 判定与发印记] 回合末：pass_gates 达成 ⇒ 获得【印记】并留日志', () => {
  const s = withGoal(themed(), 0, 'pass_gates', 3, 3);
  const out = settleRoundEndGoals(s);
  assert.equal(out.players[0]?.hasMark, true,
    '[LAYER-C-MARK 判定与发印记] 达成目标必须发印记（规格 §6.4「达成即发印记」）');
  const logs = out.log.filter((l) => l.kind === 'goal');
  assert.equal(logs.length, 1, '[LAYER-C-MARK 判定与发印记] 应恰好一条目标达成日志');
  assert.ok(logs[0]?.message.includes('身份目标达成'),
    '[LAYER-C-MARK 判定与发印记] 日志应写明「身份目标达成」');
});

test('[B60-C 判定与发印记] 未达阈值 ⇒ 不发印记', () => {
  const s = withGoal(themed(), 0, 'pass_gates', 3, 2);
  const out = settleRoundEndGoals(s);
  assert.equal(out.players[0]?.hasMark, false,
    '[LAYER-C-MARK 判定与发印记] 未达阈值不得发印记');
  assert.equal(out.log.filter((l) => l.kind === 'goal').length, 0,
    '[LAYER-C-MARK 判定与发印记] 未达成不得记目标日志');
});

test('[B60-C 判定与发印记] 印记不叠加：已持印记者不再发、也不再记日志', () => {
  const s = withGoal(themed(), 0, 'pass_gates', 3, 3);
  const marked: State = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hasMark: true } : p)) };
  const out = settleRoundEndGoals(marked);
  assert.equal(out.players[0]?.hasMark, true, '[LAYER-C-MARK 判定与发印记] 仍持有印记');
  assert.equal(out.log.filter((l) => l.kind === 'goal').length, 0,
    '[LAYER-C-MARK 判定与发印记] 印记不叠加 ⇒ 不得重复记日志');
});

test('[B60-C 判定与发印记] 终局判定：survive_with_hp 在 terminal 时机发印记', () => {
  const s = withGoal(themed(), 0, 'survive_with_hp', 1, 0);
  const out = settleTerminalGoals(s);
  assert.equal(out.players[0]?.hasMark, true,
    '[LAYER-C-MARK 判定与发印记] 存活且满血 ⇒ 终局判定应发印记（规格 §6.4 表）');
});

test('[B60-C 判定与发印记] 无目标信息（未装主题）⇒ 跳过判定，不凭空发印记', () => {
  const plain = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  assert.equal(goalOf(plain, 0), null, '[LAYER-C-MARK 判定与发印记] 未装主题的局没有目标信息');
  const out = settleRoundEndGoals(plain);
  assert.equal(out.players[0]?.hasMark, false,
    '[LAYER-C-MARK 判定与发印记] 缺目标 ⇒ 跳过判定，不得凭空发印记');
});

test('[B60-C 判定与发印记] 判定时机：immediate 的目标不在回合末发印记', () => {
  const s: State = {
    ...withGoal(themed(), 0, 'veto_success', 1, 0),
    players: withGoal(themed(), 0, 'veto_success', 1, 0).players.map((p) => (p.seat === 0
      ? { ...p, counters: { ...p.counters, vetoCount: 5 } }
      : p)),
  };
  const roundEnd = settleRoundEndGoals(s);
  assert.equal(roundEnd.players[0]?.hasMark, false,
    '[LAYER-C-MARK 判定与发印记] immediate 时机的目标不得在回合末结算');
  const immediate = settleGoals(s, 'immediate');
  assert.equal(immediate.players[0]?.hasMark, true,
    '[LAYER-C-MARK 判定与发印记] immediate 时机判定器本身应能判定达成（时机维度生效）');
});

test('[B60-C 判定与发印记] 终局接线：resolveVictory 走到终局 ⇒ survive_with_hp 达成者持印', () => {
  // ⚠️ 覆盖的是**接线**（`resolveVictory` 内部是否调用终局判定），不是 `settleTerminalGoals` 函数本身
  //   —— 只测函数的话，把 `victory.ts` 里的调用删掉，测试**仍会全绿**（复审实证）。
  const s = withGoal(themed(), 0, 'survive_with_hp', 1, 0);
  const over: State = { ...s, round: s.scales.globalRoundLimit + 1 };
  const out = resolveVictory(over);
  assert.equal(out.outcome.finished, true,
    '[LAYER-C-TERMINAL 终局接线] 达到全局回合上限 ⇒ 应进入终局');
  assert.equal(out.players[0]?.hasMark, true,
    '[LAYER-C-TERMINAL 终局接线] **终局判定应发印记**（覆盖 resolveVictory 的接线）');
});

test('[B60-C 判定与发印记] 印记的真实效果：持印记者认证门槛减半（规格 §4.1）', () => {
  const s = themed();
  const marked: State = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hasMark: true } : p)) };
  const plain = certificationThreshold(s, 0);
  const withMark = certificationThreshold(marked, 0);
  assert.ok(withMark < plain,
    '[LAYER-C-MARK 判定与发印记] 持印记者门槛应更低（实际 ' + String(withMark) + ' vs ' + String(plain) + '）');
});

test('[B60-C 判定与发印记] 集成：真实对局里通过第 3 座关隘 ⇒ 回合末拿到印记', () => {
  const s0 = themed();
  const pioneer = s0.players.find((p) => p.identityId === 'pioneer');
  assert.ok(pioneer !== undefined, '[LAYER-C-MARK 判定与发印记] 开局应有人分到 pioneer（pass_gates）身份');
  const seat = pioneer.seat;
  // 前置：该玩家已通过 2 座关隘，停在第 3 座（落雁关）上且付得起。
  let s: State = {
    ...s0,
    players: s0.players.map((p) => (p.seat === seat
      ? { ...p, position: GATE_INDEX, resource: 10, counters: { ...p.counters, gatesPassed: 2 } }
      : p)),
  };
  // 真实引擎入口：付费通道过关 ⇒ gatesPassed 变 3。
  const paid = resolveGate(s, seat, 'pay');
  assert.equal(paid.ok, true, '[LAYER-C-MARK 判定与发印记] 付费过关应成功：' + String(paid.note));
  s = paid.state;
  assert.equal(s.players[seat]?.counters.gatesPassed, 3,
    '[LAYER-C-MARK 判定与发印记] 过关后计数应为 3');
  // 排到回合末（turnIndex = 存活人数 - 1 ⇒ 当前手番是 aliveOrder 的最后一个 = pioneer）。
  const aliveCount = s.players.filter((p) => p.alive).length;
  const order = [...s.turnOrder.filter((x) => x !== seat), seat];
  s = { ...s, turnOrder: order, turnIndex: aliveCount - 1 };
  // 真实引擎入口：推进一个手番 ⇒ 跨 round ⇒ 触发回合末流程（含目标判定）。
  const after = advanceTurn(s, 'standard');
  assert.equal(after.players[seat]?.hasMark, true,
    '[LAYER-C-MARK 判定与发印记] 回合末达成 pass_gates ⇒ 该玩家必须拿到印记');
  assert.equal(after.players[seat]?.counters.gatesPassed, 3,
    '[LAYER-C-MARK 判定与发印记] 印记发放不得改动关隘计数');
});

// ⚠️ **测试名不得含层标记**（如 `[LAYER-C-MARK ...]`）：spec reporter 会**列出全部测试名**
//   （含通过的）⇒ 判据 `out.includes('[LAYER-C-MARK ...]')` 会**恒真** ⇒ mutant 的层归因失去区分力
//   （盲审实证）。⇒ 层标记只出现在**断言消息**里。
test('[B60-C 判定与发印记] 被放逐者：印记作废（规格 §5.6）', () => {
  const marked: State = {
    ...themed(),
    players: themed().players.map((p) => (p.seat === 3 ? { ...p, hasMark: true } : p)),
  };
  assert.equal(marked.players[3]?.hasMark, true, '[LAYER-C-MARK 判定与发印记] 前置：座 3 持印');
  let st = openCouncil(marked).state;
  for (const voter of [0, 1, 2]) { st = castVote(st, voter, 3).state; }
  const res = resolveCouncil(st);
  assert.ok(res.ok, '[LAYER-C-MARK 判定与发印记] 山议结算应成功：' + String(res.note));
  assert.equal(res.state.players[3]?.alive, false,
    '[LAYER-C-MARK 判定与发印记] 前置：座 3 应真的被放逐');
  assert.equal(res.state.players[3]?.hasMark, false,
    '[LAYER-C-MARK 判定与发印记] **被放逐者身上的印记必须作废**（规格 §5.6）');
});

// ================= E 组：其余 4 类目标的计数器写入（B61 · T1） =================

/** 把某座位改成指定身份，并同步其派生目标（构造性前置：目标由 setup 派生，测试需定点到具体身份）。 */
function asIdentity(s: State, seat: number, identityId: string, goal: { kind: GoalKind; count: number }): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? { ...p, identityId, flags: { ...p.flags, goal } }
      : p)),
  };
}

test('[LAYER-E1-DRAW 抽牌计数] 抽到的牌计入获得者的 cardsDrawn；开局发牌不计入', () => {
  const s = themed();
  // 开局发牌（installTheme → dealInitialHands）⇒ **不计入**
  for (const p of s.players) {
    assert.equal(p.counters.cardsDrawn ?? 0, 0,
      '[LAYER-E1-DRAW-HAND 抽牌计数] 开局发牌不计入 cardsDrawn（起手是初始配置，不是「抽」）');
  }
  const r = applyEffect({ state: s, actor: 0 }, { op: 'draw_cards', count: 2 });
  assert.equal(r.ok, true, '[LAYER-E1-DRAW 抽牌计数] 抽牌应成功');
  assert.equal(r.state.players[0]?.counters.cardsDrawn, 2,
    '[LAYER-E1-DRAW-OP 抽牌计数] 抽 2 张 ⇒ cardsDrawn = 2');
  assert.equal(r.state.players[1]?.counters.cardsDrawn, undefined,
    '[LAYER-E1-DRAW-OP 抽牌计数] 别人的抽牌不计入自己');
});

test('[LAYER-E1-DRAW-HAND 抽牌计数] hand.ts 的抽牌入口同样计入 cardsDrawn（两个独立实现各有锁）', () => {
  const s = themed();
  const out2 = drawCards(s, 1, 3);
  assert.equal(out2.players[1]?.counters.cardsDrawn, 3,
    '[LAYER-E1-DRAW-HAND 抽牌计数] hand.ts 的 drawCards ⇒ cardsDrawn = 3');
  assert.equal(out2.players[0]?.counters.cardsDrawn, undefined,
    '[LAYER-E1-DRAW-HAND 抽牌计数] 别人的抽牌不计入自己');
});

test('[LAYER-E2-REROLL 改判计数] modify_judgement 计入被改判者的 rerollCount', () => {
  const s = themed();
  const r = applyEffect({ state: s, actor: 0 }, { op: 'modify_judgement', target: 2 });
  assert.equal(r.ok, true, '[LAYER-E2-REROLL 改判计数] 改判应成功');
  assert.equal(r.state.players[2]?.counters.rerollCount, 1,
    '[LAYER-E2-REROLL 改判计数] 被改判者（座 2）的 rerollCount = 1');
  assert.equal(r.state.players[0]?.counters.rerollCount, undefined,
    '[LAYER-E2-REROLL 改判计数] 改判计给**被改判者**，不是使用者');
});

test('[LAYER-E3-STEAL 偷取计数] 窃火者偷取计入偷取者的 stolenTotal（不是受害者）', () => {
  const s = themed();
  const thief = s.players.find((p) => p.identityId === 'ember');
  assert.ok(thief !== undefined, '[LAYER-E3-STEAL 偷取计数] 开局应有人分到窃火者（ember）');
  const victim = s.players.find((p) => p.seat !== thief.seat);
  assert.ok(victim !== undefined, '[LAYER-E3-STEAL 偷取计数] 应有受害座位');
  const rich: State = { ...s, players: s.players.map((p) => (p.seat === victim.seat ? { ...p, resource: 5 } : p)) };
  const r = performAbility(rich, thief.seat, victim.seat);
  assert.equal(r.ok, true, '[LAYER-E3-STEAL 偷取计数] 偷取应成功：' + r.note);
  assert.equal(r.state.players[thief.seat]?.counters.stolenTotal, 1,
    '[LAYER-E3-STEAL 偷取计数] **偷取者**的 stolenTotal = 1');
  assert.equal(r.state.players[victim.seat]?.counters.stolenTotal, undefined,
    '[LAYER-E3-STEAL 偷取计数] 受害者不计数');
});

test('[LAYER-E4-CHALLENGE 质疑计数] 判不通过即质疑成功 ⇒ 质疑者 +1', () => {
  const s = asIdentity(themed(), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  assert.equal(challenged.ok, true, '[LAYER-E4-CHALLENGE 质疑计数] 发起质疑应成功：' + String(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(answered.ok, true, '[LAYER-E4-CHALLENGE 质疑计数] 判定应成功');
  assert.equal(answered.state.players[1]?.counters.successfulChallenges, 1,
    '[LAYER-E4-CHALLENGE 质疑计数] 判不通过（答对 ≤ 1）= 质疑成功 ⇒ 质疑者 +1');
});

test('[LAYER-E6-APPEAL 复议回退] 复议推翻 ⇒ 质疑成功计数回退 −1', () => {
  // ⚠️ 走**真实复议流程**（5 人局：座 0 待认证、座 1 质疑、第三方 2 票投推翻）⇒
  //   覆盖的是 `applyAppealOutcome` 的**回退分支**（不是只测函数）。
  const s = asIdentity(themed(5), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  assert.equal(challenged.ok, true, '[LAYER-E6-APPEAL 复议回退] 发起质疑应成功：' + String(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(answered.state.players[1]?.counters.successfulChallenges, 1,
    '[LAYER-E6-APPEAL 复议回退] 判不通过 ⇒ 质疑成功 +1');
  const appealed = certifyAppeal(answered.state, 0, 0);
  assert.equal(appealed.ok, true, '[LAYER-E6-APPEAL 复议回退] 待认证者申请复议应成功：' + String(appealed.note));
  let st = appealed.state;
  st = certifyAppealVote(st, 2, 0, true).state;
  st = certifyAppealVote(st, 3, 0, true).state;
  const resolved = resolveAppeals(st, 0);
  assert.equal(resolved.ok, true, '[LAYER-E6-APPEAL 复议回退] 复议裁定应成功：' + String(resolved.note));
  assert.equal(resolved.state.players[1]?.counters.successfulChallenges, 0,
    '[LAYER-E6-APPEAL 复议回退] **复议推翻 ⇒ 该次质疑不再成立 ⇒ 计数回退 −1**（规格 §6.4）');
});

test('[LAYER-E7-IDEMP 计数幂等] 重复判定不得虚高计数（一次质疑 = 一次计数）', () => {
  // ⚠️ 引擎层**不**收紧接受面（既有裁定「去重由粗筛承担」+ 门禁登记「UI 比引擎严」）
  //   ⇒ 幂等由**计数侧**保证 ⇒ 探针/外部调用方重复判定也不会虚高。
  const s = asIdentity(themed(), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  const first = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(first.state.players[1]?.counters.successfulChallenges, 1,
    '[LAYER-E7-IDEMP 计数幂等] 首次判不通过 ⇒ +1');
  const second = certifyAnswer(first.state, 1, 0, false);
  assert.equal(second.ok, true, '[LAYER-E7-IDEMP 计数幂等] 引擎仍接受（去重由粗筛承担）');
  assert.equal(second.state.players[1]?.counters.successfulChallenges, 1,
    '[LAYER-E7-IDEMP 计数幂等] **重复判定不得虚高计数**（一次质疑 = 一次计数）');
});

test('[LAYER-E8-REVERDICT 改判回退] 改判为通过 ⇒ 该次质疑不再成立 ⇒ 计数回退', () => {
  const s = asIdentity(themed(), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  const first = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(first.state.players[1]?.counters.successfulChallenges, 1,
    '[LAYER-E8-REVERDICT 改判回退] 首次判不通过 ⇒ +1');
  const re = certifyAnswer(first.state, 1, 0, true);
  assert.equal(re.state.players[1]?.counters.successfulChallenges, 0,
    '[LAYER-E8-REVERDICT 改判回退] 改判为通过 ⇒ 质疑不再成立 ⇒ 计数回退（与复议推翻同款可逆语义）');
});

test('[LAYER-E9-APPEAL-CLOSE 复议窗口] 生产路径：轮末关闭复议窗口 ⇒ 待认证者不再卡在峰顶', () => {
  // ⚠️ 此前生产路径**无人调用** `resolveAppeals` ⇒ 轮末结算**主动跳过**已申请复议的座位
  //   ⇒ 待认证者**永远不被结算**（卡在峰顶）⇒ 本用例钉住「轮末必须关闭复议窗口」。
  const s = asIdentity(themed(5), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  assert.equal(challenged.ok, true, '[LAYER-E9-APPEAL-CLOSE 复议窗口] 发起质疑应成功');
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(answered.ok, true, '[LAYER-E9-APPEAL-CLOSE 复议窗口] 判定应成功');
  const appealed = certifyAppeal(answered.state, 0, 0);
  assert.equal(appealed.ok, true, '[LAYER-E9-APPEAL-CLOSE 复议窗口] 申请复议应成功：' + String(appealed.note));
  assert.ok(appealed.state.certification.appealed.includes(0),
    '[LAYER-E9-APPEAL-CLOSE 复议窗口] 申请后复议窗口应打开');
  const peak = appealed.state.board.peakIndex;
  // 轮末结算（不投复议票 ⇒ 票未收齐 ⇒ 维持原判 ⇒ 后退 1 格）
  const settled = advanceCertificationRound(appealed.state);
  assert.ok(settled.ok, '[LAYER-E9-APPEAL-CLOSE 复议窗口] 轮末结算应成功：' + String(settled.note));
  const p0 = settled.state.players[0];
  assert.ok((p0?.position ?? peak) < peak,
    '[LAYER-E9-APPEAL-CLOSE 复议窗口] **待认证者不得卡在峰顶**（未接线时轮末跳过它 ⇒ 永远不结算）');
});

test('[LAYER-E10-APPEAL-WINDOW 窗口关闭] 复议裁定后 appealed 被清（窗口关闭 ⇒ 不会重复裁定）', () => {
  const s = asIdentity(themed(5), 0, 'pioneer', { kind: 'pass_gates', count: 3 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  const appealed = certifyAppeal(answered.state, 0, 0);
  assert.ok(appealed.ok, '[LAYER-E10-APPEAL-WINDOW 窗口关闭] 申请复议应成功');
  let st = appealed.state;
  st = certifyAppealVote(st, 2, 0, true).state;
  st = certifyAppealVote(st, 3, 0, true).state;
  const resolved = resolveAppeals(st, 0);
  assert.equal(resolved.ok, true, '[LAYER-E10-APPEAL-WINDOW 窗口关闭] 复议裁定应成功：' + String(resolved.note));
  assert.equal(resolved.state.certification.appealed.includes(0), false,
    '[LAYER-E10-APPEAL-WINDOW 窗口关闭] **裁定后复议窗口必须关闭**（否则轮末会再裁定一次 ⇒ 重复扣资源/后退）');
  assert.equal(resolved.state.players[1]?.counters.successfulChallenges, 0,
    '[LAYER-E10-APPEAL-WINDOW 窗口关闭] 复议推翻 ⇒ 该次质疑不再成立 ⇒ 计数回退');
});

test('[LAYER-E5-MARK 即时判定] 山主质疑成功 ⇒ immediate 判定发印记', () => {
  const s = asIdentity(themed(), 1, 'mountainlord', { kind: 'successful_challenge', count: 1 });
  const pending = putPending(s, [0]);
  const challenged = certifyChallenge(pending, 1, 0);
  assert.equal(challenged.ok, true, '[LAYER-E5-MARK 即时判定] 发起质疑应成功：' + String(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.equal(answered.state.players[1]?.hasMark, true,
    '[LAYER-E5-MARK 即时判定] 质疑成功 ⇒ **即时判定**（§6.4）⇒ 该玩家应获得【印记】');
});

// ================= D 组：变异自证 =================

/** 副本里跳过变异自证（否则副本会再跑变异 ⇒ 递归）。 */
const SKIP_MUTATION = process.env['CM_SKIP_MUTATION'] === '1';

/**
 * 在**隔离副本**里跑 mutant ⇒ 断言「被这一层专属措辞打红」。
 * ⚠️ 共享工作树**只读** —— 所有写入都发生在系统临时目录的副本里。
 */
function runMutant(
  mutate: (dir: string) => void,
  opts?: { readonly entry?: string },
): { code: number; out: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b60-'));
  const entry = opts?.entry ?? 'tests/engine/goals.test.ts';
  try {
    cpSync(resolve('engine'), resolve(dir, 'engine'), { recursive: true });
    cpSync(resolve('themes'), resolve(dir, 'themes'), { recursive: true });
    mkdirSync(resolve(dir, 'tests'), { recursive: true });
    // ⚠️ **副本必须包含「被 mutant 影响的那个测试文件」及其依赖** ——
    //   只复制入口文件时，若 mutant 影响的是**另一个**测试文件（如跨主题继承影响
    //   themes-play.test.ts），那条断言在副本里**根本不存在** ⇒ mutant 静默无效
    //   ⇒ 变异自证变成**恒绿**的假证明。
    //   ⚠️ 且被复制的文件**还有 import 依赖**（如 themes-play 依赖 ./helpers.ts）
    //   ⇒ 少一个依赖 ⇒ 整个文件 import 失败 ⇒ 输出里既没有断言也没有标记 ⇒ 同样误判。
    //   ⇒ 索性**复制整个 tests/engine 目录**（只复制、不运行 ⇒ 无副作用）。
    cpSync(resolve('tests/engine'), resolve(dir, 'tests/engine'), { recursive: true });
    cpSync(resolve('package.json'), resolve(dir, 'package.json'));
    mutate(dir);
    try {
      // ⚠️ **直接运行副本里的测试文件**（不用 `node --test`）：
      //   `node --test` 在一个 test 文件的进程里被再次调用时，Node 会打印
      //   「run() is being called recursively within a test file. skipping running files.」
      //   ⇒ **副本里的测试根本不会跑** ⇒ 退出码恒 0 ⇒ 变异自证会误判「没有专属锁」。
      //   直接运行文件时 `node:test` 照样执行并把失败反映到进程退出码 ✓。
      // ⚠️ **必须清掉 `NODE_TEST_CONTEXT`**：在 `node --test` 的子进程里再 spawn 子进程时，
      //   Node 会给子进程带上 `NODE_TEST_CONTEXT=child-v8` ⇒ 子进程的 `node:test`
      //   自动改用 **TAP reporter**（而不是默认的 spec）⇒ 失败断言的消息不在输出里
      //   ⇒ 「专属措辞」判据永远匹配不上（实测踩过）。
      //   清掉它 ⇒ 副本输出与独立进程一致（spec）⇒ 判据可用。
      const env: Record<string, string> = { ...process.env as Record<string, string>, CM_SKIP_MUTATION: '1' };
      delete env['NODE_TEST_CONTEXT'];
      const out = execFileSync(process.execPath, [entry], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
        env,
      });
      return { code: 0, out };
    } catch (e) {
      // ⚠️ 失败详情既可能落在 stdout 也可能落在 stderr ⇒ **两路都收**，
      //   否则会把「副本测试确实红了」误判成「专属措辞没出现」。
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return {
        code: typeof err.status === 'number' ? err.status : -1,
        out: String(err.stdout ?? '') + '\n' + String(err.stderr ?? ''),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 在副本里做一次「唯一一处」的文本替换，替换不到就当场失败（避免 mutant 静默变成空操作）。 */
function patchCopy(dir: string, rel: string, from: string, to: string): void {
  const p = resolve(dir, rel);
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes(from), 'mutant 必须在 ' + rel + ' 里找到目标片段：' + from);
  writeFileSync(p, src.replace(from, to));
}

test('[B60-D 变异自证] 撤掉 gatesPassed 计数写入 ⇒ 计数写入层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/gate.ts',
      "counters: already ? x.counters : counterPatch(x, 'gatesPassed'),",
      'counters: x.counters,');
  });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（去掉计数写入）必须让测试变红 —— 否则计数写入层没有专属锁');
  // ⚠️ 判据只匹配 **AssertionError 行**（不匹配测试名行）⇒ 测试名里即使残留层标记也不会恒真。
  assert.ok(/AssertionError[^\n]*\[LAYER-A-COUNT/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在计数写入层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B60-D 变异自证] 撤掉回合末判定调用 ⇒ 判定与发印记层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/turn-runner.ts',
      'next = settleRoundEndGoals(next);',
      'void settleRoundEndGoals;');
  });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（去掉回合末判定点）必须让测试变红 —— 否则判定点没有专属锁');
  assert.ok(/AssertionError[^\n]*\[LAYER-C-MARK/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在判定与发印记层的专属措辞上');
  assert.ok(!/AssertionError[^\n]*\[LAYER-A-COUNT/.test(r.out),
    '[B60-D 变异自证] 计数写入层不应因「判定点被撤」而变红（否则两层锁互相污染）');
});

test('[B60-D 变异自证] 撤掉发印记 ⇒ 判定与发印记层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/goals/settle.ts',
      'players: state.players.map((p) => (seats.has(p.seat) ? { ...p, hasMark: true } : p)),',
      'players: state.players.map((p) => (seats.has(p.seat) ? p : p)),');
  });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（去掉发印记）必须让测试变红 —— 否则发印记没有专属锁');
  assert.ok(/AssertionError[^\n]*\[LAYER-C-MARK/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在判定与发印记层的专属措辞上');
});

// ⚠️ B60-D 追加：补 **目标派生层**（LAYER-B）的变异自证 ——
//   此前 B 层只有一条「数据一致性」用例（四套 theme.json 互比），它**不碰生产代码**
//   ⇒ 该层虽仍有真实锁（撤掉派生即红），但没被 mutant **固化** ⇒ 补上。
test('[B60-D 变异自证] 撤掉身份目标派生 ⇒ 目标派生层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/setup.ts',
      'const goalFlags = identity?.goal !== undefined\n      ? { goal: { kind: identity.goal.kind, count: identity.goal.count ?? 1 } }\n      : {};',
      'const goalFlags: Record<string, unknown> = {};');
  });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（去掉目标派生）必须让测试变红 —— 否则目标派生层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[LAYER-B-DERIVE/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在目标派生层的专属措辞上');
});

// ⚠️ B60-D 追加：**跨主题继承** mutant ——
//   证明「目标不得跨主题继承」这条断言**有判别力**（否则它是恒绿的假断言）。
//   做法：让「重置局面」保留旧 goal，且「分配身份」优先沿用旧 goal
//   ⇒ 新主题的座位带着**旧主题**的目标 ⇒ 逐座断言必须红。
//   ⚠️ 这两处**必须一起改**：只改其一不产生继承（重置会把 goal 清掉 / 分配会覆盖旧 goal）。
test('[B60-D 变异自证] 跨主题继承身份目标 ⇒ 「目标不继承」层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  // ⚠️ 入口是 **themes-play.test.ts**：跨主题继承影响的是**那条**断言，不在 goals.test.ts 里。
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/setup.ts',
      'flags: {},\n    statuses: {},',
      'flags: p.flags.goal !== undefined ? { goal: p.flags.goal } : {},\n    statuses: {},');
    patchCopy(dir, 'engine/core/setup.ts',
      'const goalFlags = identity?.goal !== undefined\n      ? { goal: { kind: identity.goal.kind, count: identity.goal.count ?? 1 } }\n      : {};',
      'const goalFlags = p.flags.goal !== undefined\n      ? { goal: p.flags.goal }\n      : (identity?.goal !== undefined\n        ? { goal: { kind: identity.goal.kind, count: identity.goal.count ?? 1 } }\n        : {});');
  }, { entry: 'tests/engine/themes-play.test.ts' });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（跨主题继承目标）必须让测试变红 —— 否则「目标不继承」这条断言没有判别力');
  assert.ok(/AssertionError[^\n]*\[LAYER-B-INHERIT/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「目标不继承」层的专属措辞上');
});

// ⚠️ B60-D 追加：**终局接线** mutant ——
//   覆盖 `resolveVictory` 里的 `settleTerminalGoals` 调用是否真的在（复审实证：删掉它测试仍全绿）。
test('[B60-D 变异自证] 撤掉终局判定接线 ⇒ 「终局接线」层专属断言必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    // ⚠️ **两处都要改**：`victory.ts` 有两个终局分支（存活 ≤1 / 达到回合上限），
    //   各有一句 `settleTerminalGoals(state)` ⇒ 只改第一处时，第二处仍在 ⇒ 接线其实没断 ⇒ mutant 静默无效。
    patchCopy(dir, 'engine/core/victory.ts',
      "const marked = settleTerminalGoals(state);\n    return { ...marked, phase: '终局', outcome: { finished: true, winners: [], reason: 'no_winner' } };",
      "const marked = state;\n    return { ...marked, phase: '终局', outcome: { finished: true, winners: [], reason: 'no_winner' } };");
    patchCopy(dir, 'engine/core/victory.ts',
      'const marked = settleTerminalGoals(state);\n    const totalSeats = Object.values(marked.liveSeats).reduce((a, b) => a + b, 0);',
      'const marked = state;\n    const totalSeats = Object.values(marked.liveSeats).reduce((a, b) => a + b, 0);');
  });
  assert.notEqual(r.code, 0,
    '[B60-D 变异自证] mutant（去掉终局判定接线）必须让测试变红 —— 否则终局发放路径没有回归锁');
  assert.ok(/AssertionError[^\n]*\[LAYER-C-TERMINAL/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「终局接线」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉轮末的复议裁定接线 ⇒ 「复议窗口」层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "  for (const seat of c.appealed) {\n    if (!c.pending.includes(seat)) { continue; }\n    const r = resolveAppeals(state, seat);\n    if (r.ok) { state = r.state; }\n  }",
      '  // mutant: 去掉轮末的复议裁定接线');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E9-APPEAL-CLOSE/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「复议窗口」层的专属措辞上');
});

// ================= E 组变异自证：B61 的 4 类计数器写入 =================
// ⚠️ 每条 mutant 对应**一个环节**，判据只匹配**该环节专属**的层标记 ⇒
//   证明「每一环都有自己的锁」，而不是「某一环有锁就算全有」。

test('[B60-D 变异自证] 撤掉 draw_cards op 的计数 ⇒ 抽牌计数（op 路径）层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/ops/registry.ts',
      "state = bumpCounterOf(state, t.seat, 'cardsDrawn', drawn.length);",
      '// mutant: 去掉 draw_cards op 的 cardsDrawn 计数');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E1-DRAW-OP/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「抽牌计数（op 路径）」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉 hand.ts 的计数 ⇒ 抽牌计数（hand 路径）层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/hand.ts',
      ": { counters: counterPatch(target, 'cardsDrawn', drawn.length) }),",
      ': {}),');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E1-DRAW-HAND/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「抽牌计数（hand 路径）」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉 modify_judgement 的计数 ⇒ 改判计数层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/ops/registry.ts',
      "state = bumpCounterOf(state, t.seat, 'rerollCount');",
      '// mutant: 去掉 rerollCount 计数');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E2-REROLL/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「改判计数」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉偷取计数 ⇒ 偷取计数层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/abilities.ts',
      "next = bumpCounterOf(next, seat, 'stolenTotal', passive.amount);",
      '// mutant: 去掉 stolenTotal 计数');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E3-STEAL/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「偷取计数」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉质疑成功计数 ⇒ 质疑计数层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "next = bumpCounterOf(next, actor, 'successfulChallenges');",
      '// mutant: 去掉 successfulChallenges 计数');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E4-CHALLENGE/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「质疑计数」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉 immediate 判定调用 ⇒ 即时判定层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      'next = settleImmediateGoals(next);',
      '// mutant: 去掉 immediate 判定');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E5-MARK/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「即时判定」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉复议推翻的计数回退 ⇒ 复议回退层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "next = bumpCounterOf(next, challengerSeat, 'successfulChallenges', -1);",
      '// mutant: 去掉复议推翻的计数回退');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E6-APPEAL/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「复议回退」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉计数幂等 ⇒ 计数幂等层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "if (!alreadyJudged) {\n    next = bumpCounterOf(next, actor, 'successfulChallenges');\n  }",
      "next = bumpCounterOf(next, actor, 'successfulChallenges');");
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E7-IDEMP/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「计数幂等」层的专属措辞上');
});

test('[B60-D 变异自证] 撤掉改判回退 ⇒ 改判回退层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "if (judgedFalseBefore) {\n      next = bumpCounterOf(next, actor, 'successfulChallenges', -1);\n    }",
      '// mutant: 去掉改判回退');
  });
  assert.notEqual(r.code, 0, '[B60-D 变异自证] mutant 必须让测试变红');
  assert.ok(/AssertionError[^\n]*\[LAYER-E8-REVERDICT/.test(r.out),
    '[B60-D 变异自证] mutant 必须红在「改判回退」层的专属措辞上');
});
