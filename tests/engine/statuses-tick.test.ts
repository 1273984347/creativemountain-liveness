// B77 家族 B 结算（规格 §3.1 / §4）：② poison 扣血 → ③④⑤ slow/silence/skip 衰减 →
// ⑥ immunity 衰减，全部锚在**该玩家自己的手番末**；授予当回合豁免；死者整体跳过。
//
// ⚠️ 为什么必须自己写这条链：r2 版规格把六个步骤统一挂 round 末，而 skip/silence/immunity
//   的写入点本来就在该玩家自己 手番内 ⇒ 状态会在他下次行动之前被 round 末抹平
//   （「停 1 回合」停不到、禁言永不生效、免疫窗恒为 0）。锚点是本批最容易复发的坑，
//   所以除了行为断言，tests/engine/status-anchor.test.ts 另有一条"锚点反证"钉住它。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tickPlayerStatuses, statusOf, immunityOf } from '../../engine/core/statuses.ts';
import { finishTurn } from '../../engine/core/turn-runner.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene, mk } from './fixtures.ts';
import type { State } from '../../engine/core/state.ts';

type StatusKey = 'poison' | 'slow' | 'silence' | 'skip_turn';

function withStatuses(s: State, seat: number, patch: Partial<Record<StatusKey, number>>): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, ...patch } } : p)) };
}
function withHp(s: State, seat: number, hp: number): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, hp } : p)) };
}
function withFlags(s: State, seat: number, patch: Record<string, unknown>): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, ...patch } } : p)) };
}
const hpOf = (s: State, seat: number): number => s.players[seat]!.hp;

test('B77 ②：poison 2 层 ⇒ 本手番扣 2 血、层数 2→1（先作强度、再衰减）', () => {
  const s0 = withHp(withStatuses(mk(4, 7), 1, { poison: 2 }), 1, 7);
  const s1 = tickPlayerStatuses(s0, 1);
  assert.equal(hpOf(s1, 1), 5);
  assert.equal(statusOf(s1, 1, 'poison'), 1);
  assert.match(s1.log.at(-1)!.message, /^中毒扣血：座位 1（-2）$/, '前缀是报告计数器的契约（规格 §9）');
});

test('B77 ②：poison 扣血到 0 ⇒ 走 triggerExhaustion，且与 damage 触发的结果逐字相同（§3.1 等长钉子）', () => {
  // poison 路径
  const byPoison = tickPlayerStatuses(withHp(withStatuses(mk(4, 7), 1, { poison: 3 }), 1, 2), 1);
  // damage 路径（B76 既有触发点）
  const byDamage = applyEffect({ state: withHp(mk(4, 7), 1, 2), actor: 0 }, { op: 'damage', amount: 2, target: 1 }).state;
  for (const [name, s] of [['poison', byPoison], ['damage', byDamage]] as const) {
    assert.equal(hpOf(s, 1), 0, `${name}：clamp 到 0，不得为负`);
    assert.equal(s.players[1]!.exhaustedRounds, 2, `${name}：必须走 exhaustion.ts 置 2，不是自置字段`);
    assert.ok(s.log.some((l) => /^力竭：座位 1（体力归零）$/.test(l.message)), `${name}：力竭日志由 exhaustion.ts 负责`);
  }
  assert.equal(byPoison.players[1]!.exhaustedRounds, byDamage.players[1]!.exhaustedRounds,
    '两条触发路径等长（r3.2）：poison 触发的力竭同样会被本 round 末的家族 A 接手');
});

test('B77 豁免：本手番授予的状态不吃这一拍（否则 immunity(1) / skip(1) 结构性恒为 0）', () => {
  const s0 = mk(4, 7);
  const granted = withStatuses(s0, 1, { silence: 1 });          // 经由 applyStatus 之外直接造，故手工置标记
  const withMark: State = {
    ...granted,
    players: granted.players.map((p) => (p.seat === 1 ? { ...p, turn: { ...p.turn, statusGrantedThisTurn: true } } : p)),
  };
  assert.equal(statusOf(tickPlayerStatuses(withMark, 1), 1, 'silence'), 1, '授予当回合 ⇒ 本次不衰减');
  // 对照组：没有标记（即"上一手番授予的"）就照常衰减
  const plain = withStatuses(s0, 1, { silence: 1 });
  assert.equal(statusOf(tickPlayerStatuses(plain, 1), 1, 'silence'), 0, '对照组必须会衰减，否则豁免判据是空转');
});

test('B77 豁免标记经 applyStatus 真实置位，并被同手番末的结算读到', () => {
  // ⚠️ B77 r5：授予必须发生在**受害者自己的手番内**才会置豁免位（别人手番内授予不打标记，
  //   否则「N 个手番」会吃掉 N+1 个 ⇒ 由 tests/engine/status-duration.test.ts 钉死两种时机）。
  //   ⇒ 这里把当前手番指到座 1，再让他给自己开免疫窗（真实场景就是 t_oath 试炼奖励）。
  const idx1 = mk(4, 7).turnOrder.indexOf(1);
  assert.ok(idx1 >= 0, '前提：座 1 在行动顺序里');
  const s0 = { ...mk(4, 7), turnIndex: idx1 };
  const s1 = applyEffect({ state: s0, actor: 1 }, { op: 'immunity', status: 'poison', amount: 1 }).state;
  assert.equal(s1.players[1]!.turn.statusGrantedThisTurn, true, '授予方必须置标记（否则豁免只存在于纸面）');
  assert.equal(immunityOf(tickPlayerStatuses(s1, 1), 1, 'poison'), 1, '当回合不衰减 ⇒ 窗口完整覆盖授予那一个手番');
});

test('B77 ⑥：免疫窗与 poison 层数各自结算，窗覆盖所在手番', () => {
  const s1 = withFlags(withStatuses(mk(4, 7), 1, { poison: 1 }), 1, { immunity_poison: 2 });
  const t1 = tickPlayerStatuses(s1, 1);       // 扣毒 1 ⇒ 0 层；⑥ 免疫 2→1
  assert.equal(statusOf(t1, 1, 'poison'), 0);
  assert.equal(immunityOf(t1, 1, 'poison'), 1);
});

test('B77：死者不参与 ②–⑥（引用相等：不扣血、不衰减、不写日志）', () => {
  const base = withHp(withStatuses(mk(4, 7), 2, { poison: 3, skip_turn: 1 }), 2, 4);
  const dead: State = { ...base, players: base.players.map((p) => (p.seat === 2 ? { ...p, alive: false } : p)) };
  assert.equal(tickPlayerStatuses(dead, 2), dead);
});

test('B77：段末自清豁免标记，接线在 finishTurn 尾部 ⇒ 收入/裁牌等既有结算不受影响', () => {
  const s0 = withHp(withStatuses(mk(4, 7), 0, { slow: 1, poison: 1 }), 0, 6);
  const acted = finishTurn(s0, 0);
  assert.equal(acted.players[0]!.turn.statusGrantedThisTurn, false, '递减段末自清（round 末 clearTurnStates 只是安全网）');
  assert.equal(hpOf(acted, 0), 5, 'poison 在 finishTurn 内扣了 1 点');
  assert.equal(statusOf(acted, 0, 'poison'), 0, '1 层 → 0');
  assert.equal(statusOf(acted, 0, 'slow'), 0, '③ slow 同样衰减');
});

test('B77：被放逐者不带状态离场——statuses 清空、immunity_ 摘除、其它 flags 不连坐', () => {
  let s = councilScene(4, 7);
  s = withStatuses(s, 1, { poison: 2, silence: 1 });
  s = withFlags(s, 1, { immunity_poison: 3, gate_6: true });
  for (const p of s.players.filter((x) => x.alive)) {
    const r = castVote(s, p.seat, p.seat === 1 ? 0 : 1);
    assert.ok(r.ok, `前提：座 ${p.seat} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  const res = resolveCouncil(s);
  assert.ok(res.ok, '山议必须能结算：' + String(res.note));
  const q = res.state.players[1]!;
  assert.equal(q.alive, false, '前提：座 1 已被放逐');
  assert.deepEqual(q.statuses, {}, '死者不得带着 poison/silence 离场');
  assert.equal(q.flags.immunity_poison, undefined, '免疫窗一起摘');
  assert.equal(q.flags.gate_6, true, '反证：只清 immunity_ 前缀，其它 flag（关隘标记）不得连坐');
});
