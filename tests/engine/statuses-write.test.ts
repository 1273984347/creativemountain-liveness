// B77 写入侧（规格 B77 §3 / §4）：免疫窗拦截、累加语义、封口弃牌（复用 discard_self 弃首位）。
//
// ⚠️ 这些用例钉的是**写入侧**的四条纪律，全部是本轮评审逐条裁定的落点：
//   · 累加不是设层（D 系列：连续中毒的第二发必须有意义）
//   · 免疫是预防不是解药（不清已有层数）
//   · 被免疫 ⇒ 整件「被授予」事件都不发生（封口连弃牌一起挡）
//   · 死者不接受写入（B76 I2 同族）
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyStatus, grantImmunity, statusOf, immunityOf } from '../../engine/core/statuses.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { mk } from './fixtures.ts';
import type { Player, State } from '../../engine/core/state.ts';
import type { OpContext } from '../../engine/ops/registry.ts';

/** 用真实 Player 的 hand 类型造手牌（Card 字段以 engine/types/theme.ts 为准）。 */
function withHand(s: State, seat: number, ids: readonly string[]): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? {
        ...p,
        hand: ids.map((id) => ({
          id, name: id, type: 'attack' as const, cost: 1, color: 'red' as const, rank: 5, text: '', effects: [],
        } satisfies Player['hand'][number])),
      }
      : p)),
  };
}
const ctxOf = (s: State, actor: number): OpContext => ({ state: s, actor });

test('B77：poison 累加，第二次写入是 3 层不是覆盖（§3 通用形状）', () => {
  let s = mk(4, 7);
  s = applyStatus(ctxOf(s, 0), 1, 'poison', 2).state;
  s = applyStatus(ctxOf(s, 0), 1, 'poison', 1).state;
  assert.equal(statusOf(s, 1, 'poison'), 3, '设层写法会让连续中毒的第二发毫无意义');
});

test('B77：授予状态时置 statusGrantedThisTurn（家族 B 递减豁免的依据）', () => {
  const s = applyStatus(ctxOf(mk(4, 7), 0), 0, 'slow', 1).state;
  assert.equal(s.players[0]!.turn.statusGrantedThisTurn, true);
});

test('B77：免疫窗内同类写入被拒 + 写「被免疫」日志 + 不动既有层数', () => {
  let s = mk(4, 7);
  s = applyStatus(ctxOf(s, 1), 1, 'poison', 2).state;      // 先中毒 2 层
  s = grantImmunity(ctxOf(s, 1), 1, 'poison', 1).state;     // 再给自己挂免疫窗
  const before = s;
  const r = applyStatus(ctxOf(s, 1), 1, 'poison', 3);
  assert.equal(r.ok, false, '窗口内写入判失败');
  assert.equal(statusOf(r.state, 1, 'poison'), 2, '免疫是预防不是解药：已有 2 层不得被清');
  assert.match(r.state.log.at(-1)!.message, /^被免疫：座位 1 的 poison$/);
  assert.notEqual(r.state, before, '拦截也要留痕 ⇒ 状态对象确有变化');
});

test('B77：封口写入即弃手牌首位一张，走 discard_self 同一实现', () => {
  const s = withHand(mk(4, 7), 1, ['h0', 'h1', 'h2']);
  const res = applyStatus(ctxOf(s, 1), 1, 'silence', 1);
  assert.deepEqual(res.state.players[1]!.hand.map((c) => c.id), ['h1', 'h2'], '弃**首位**（discard_self 语义，规格 r3.3）');
  assert.equal(res.state.decks.discard.at(-1)!.id, 'h0', '进弃牌堆 ⇒ 牌库循环才找得到它');
  assert.match(res.state.log.at(-1)!.message, /^封口弃牌：座位 1（弃 h0）$/);
});

test('B77：被免疫的封口**不弃牌**（拦截在弃牌之前，§3.3）', () => {
  let s = withHand(mk(4, 7), 1, ['h0', 'h1']);
  s = grantImmunity(ctxOf(s, 1), 1, 'silence', 1).state;
  const r = applyStatus(ctxOf(s, 1), 1, 'silence', 2);
  assert.equal(r.ok, false);
  assert.deepEqual(r.state.players[1]!.hand.map((c) => c.id), ['h0', 'h1'], '一张都不能少');
  assert.equal(r.state.decks.discard.length, s.decks.discard.length, '弃牌堆也不得多东西');
});

test('B77：空手被封口 ⇒ 不弃牌但不报错、禁言照挂', () => {
  const s = withHand(mk(4, 7), 1, []);
  const r = applyStatus(ctxOf(s, 1), 1, 'silence', 1);
  assert.equal(r.ok, true);
  assert.equal(statusOf(r.state, 1, 'silence'), 1);
});

test('B77：死者不接受状态写入（B76 I2 同族）', () => {
  const base = mk(4, 7);
  const dead: State = { ...base, players: base.players.map((p) => (p.seat === 2 ? { ...p, alive: false } : p)) };
  const r = applyStatus(ctxOf(dead, 0), 2, 'poison', 1);
  assert.equal(r.ok, false);
  assert.equal(r.state, dead, '引用相等 = 三层认得的拒绝信号');
});

test('B77：amount <= 0 一律拒绝，不写日志也不置豁免标记', () => {
  const s = mk(4, 7);
  const r = applyStatus(ctxOf(s, 0), 1, 'poison', 0);
  assert.equal(r.ok, false);
  assert.equal(r.state, s);
});

test('B77：旧存档缺 statuses / 缺 immunity 键 ⇒ 读出 0，不抛', () => {
  const base = mk(4, 7);
  const legacy = { ...base, players: base.players.map((p) => ({ ...p, statuses: undefined })) } as unknown as State;
  assert.equal(statusOf(legacy, 0, 'poison'), 0);
  assert.equal(immunityOf(legacy, 0, 'poison'), 0);
});

// ---------- 走**算子**入口的同判用例（主题包实际调的是这些 op，不是 applyStatus） ----------
// 只有直接调 applyStatus 的用例是不够的：四套主题的 effects 全部写 op 名 ⇒
// 改道没接上时，上面九条依然全绿，而真实对局里状态照旧只写不读（B75 的三环取证教训）。

test('B77：poison 算子累加（蚀骨 + 毒瘴 = 3 层）', () => {
  let s = mk(4, 7);
  s = applyEffect({ state: s, actor: 0 }, { op: 'poison', amount: 2, target: 1 }).state;
  s = applyEffect({ state: s, actor: 0 }, { op: 'poison', amount: 1, target: 1 }).state;
  assert.equal(statusOf(s, 1, 'poison'), 3);
});

test('B77：silence 算子同样弃首位并进弃牌堆', () => {
  const s = withHand(mk(4, 7), 1, ['a', 'b']);
  const out = applyEffect({ state: s, actor: 0 }, { op: 'silence', amount: 1, target: 1 }).state;
  assert.deepEqual(out.players[1]!.hand.map((c) => c.id), ['b']);
  assert.equal(out.decks.discard.at(-1)!.id, 'a');
});

test('B77：immunity 算子开窗后，同类写入被挡且既有层数不动', () => {
  let s = mk(4, 7);
  s = applyEffect({ state: s, actor: 0 }, { op: 'poison', amount: 1, target: 1 }).state;
  s = applyEffect({ state: s, actor: 1 }, { op: 'immunity', status: 'poison', amount: 1 }).state;
  const r = applyEffect({ state: s, actor: 0 }, { op: 'poison', amount: 5, target: 1 });
  assert.equal(r.ok, false, '算子层也要判未生效（上游据此不计奖励）');
  assert.equal(statusOf(r.state, 1, 'poison'), 1);
  assert.match(r.state.log.at(-1)!.message, /^被免疫：座位 1 的 poison$/);
});
