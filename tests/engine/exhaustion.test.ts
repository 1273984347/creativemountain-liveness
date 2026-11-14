// B76 力竭：触发 / 解除 / 四效果 / 自然恢复 / 常驻断言。
//
// ⚠️ 触发与解除的唯一实现在 `engine/core/exhaustion.ts`（damage、险径、endRound、
//   RECUPERATE 四个调用点共用——同一口径两份实现必漂移，E94）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { Player, State } from '../../engine/core/state.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { finishTurn, performAction, advanceTurn } from '../../engine/core/turn-runner.ts';
import { handLimitOf } from '../../engine/core/hand.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { certifyChallenge } from '../../engine/core/certification.ts';
import { recoverFromExhaustion } from '../../engine/core/exhaustion.ts';
import { mk, putPending } from './fixtures.ts';

/** 造一张黑牌（险径判定用）。 */
function blackCard(id: string): { id: string; color: 'black' } {
  return { id, color: 'black' } as { id: string; color: 'black' };
}

/** 把座 `seat` 的 hp/shield 直接置值（力竭测试夹具）。 */
function withHp(s: State, seat: number, hp: number, shield = 0): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, hp, shield } : p)) };
}

/** 把座 `seat` 置为已力竭（直接置字段——触发语义由触发点测试覆盖）。 */
function exhaust(s: State, seat: number, rounds = 2): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, exhaustedRounds: rounds } : p)) };
}

/** 把某格改为 hazard（mk 的默认棋盘全 plain）。 */
function withHazardTile(s: State, index: number): State {
  return { ...s, board: { ...s.board, tiles: s.board.tiles.map((t) => (t.index === index ? { ...t, kind: 'hazard' as const } : t)) } };
}

/** 把牌库顶换成指定牌（险径判定读 deck[0]）。 */
function withDeckTop(s: State, card: { id: string; color: 'black' }): State {
  return { ...s, decks: { ...s.decks, deck: [card as unknown as State['decks']['deck'][number], ...s.decks.deck.slice(1)] } };
}

// ---------- 触发点：damage ----------

test('B76：damage 打空 ⇒ exhaustedRounds=2、alive 保持 true、日志 kind=exhaustion', () => {
  const s = withHp(mk(4, 7), 1, 1);
  const r = applyEffect({ state: s, actor: 0 }, { op: 'damage', amount: 1, target: 1 });
  const p = r.state.players[1]!;
  assert.equal(p.alive, true, '打空不再是出局（damage 暗杀分支已收口）');
  assert.equal(p.exhaustedRounds, 2);
  assert.ok(r.state.log.some((l) => l.kind === 'exhaustion' && l.message.startsWith('力竭：')), '触发日志');
});

test('B76：damage 未打空 ⇒ 不力竭', () => {
  const s = withHp(mk(4, 7), 1, 5);
  const r = applyEffect({ state: s, actor: 0 }, { op: 'damage', amount: 1, target: 1 });
  assert.equal(r.state.players[1]!.exhaustedRounds, 0);
});

// ---------- 触发点：险径 ----------

test('B76：险径黑牌打空 ⇒ 同样力竭（两路径统一）', () => {
  let s = withHazardTile(mk(4, 7), 5);
  s = withDeckTop(s, blackCard('b1'));
  s = withHp(s, 0, 1);
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, position: 5 } : p)) };
  const next = finishTurn(s, 0);
  const p = next.players[0]!;
  assert.equal(p.hp, 0);
  assert.equal(p.alive, true, '险径打空也不出局');
  assert.equal(p.exhaustedRounds, 2);
  assert.ok(next.log.some((l) => l.kind === 'exhaustion'));
});

// ---------- 不刷新 ----------

test('B76：已力竭者再次归零 ⇒ 不刷新计数、不重复触发日志', () => {
  const s = exhaust(withHp(mk(4, 7), 1, 0), 1);
  const before = s.log.length;
  const r = applyEffect({ state: s, actor: 0 }, { op: 'damage', amount: 1, target: 1 });
  assert.equal(r.state.players[1]!.exhaustedRounds, 2, '不得清零重计');
  const added = r.state.log.slice(before).filter((l) => l.kind === 'exhaustion');
  assert.equal(added.length, 0, '已力竭 ⇒ 不发新触发日志');
});

// ---------- 解除（max 保底） ----------

test('B76：解除时 hp = max(当前, ceil(hpMax/2))——hp=0 ⇒ 半血', () => {
  const s = exhaust(withHp(mk(4, 7), 1, 0), 1);
  const hpMax = s.players[1]!.hpMax;
  const r = recoverFromExhaustion(s, 1, '自恢');
  assert.equal(r.players[1]!.exhaustedRounds, 0);
  assert.equal(r.players[1]!.hp, Math.ceil(hpMax / 2));
  assert.ok(r.log.some((l) => l.kind === 'exhaustion' && l.message.includes('（自恢）')));
});

test('B76：解除不倒扣——heal 抬到半血以上，解除后保留', () => {
  const s = exhaust(withHp(mk(4, 7), 1, 0), 1);
  const healed = applyEffect({ state: s, actor: 0 }, { op: 'heal', amount: 5, target: 1 }).state;
  const hpAfterHeal = healed.players[1]!.hp;
  assert.ok(hpAfterHeal > 0, '力竭者是 heal 的合法目标');
  const r = recoverFromExhaustion(healed, 1, '救援');
  assert.equal(r.players[1]!.hp, hpAfterHeal, '不得倒扣到半血');
  assert.equal(r.players[1]!.exhaustedRounds, 0);
});

// ---------- 常驻断言 ----------

test('B76 常驻：alive: false 的写入点只允许山议放逐（council.ts）', () => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.ts')) { continue; }
      // ⚠️ 只查**代码行**——注释里提到 `alive: false` 的（如 turn-runner 的 B18 修正注释）不算写入点。
      const code = readFileSync(full, 'utf8').split(/\r?\n/)
        .filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
        .join('\n');
      if (/alive:\s*false/.test(code)) { hits.push(full.replaceAll('\\', '/')); }
    }
  };
  walk('engine');
  assert.deepEqual(hits, ['engine/core/council.ts'], `damage 暗杀分支必须已删除；命中：${hits.join('、')}`);
});

// ---------- 四效果（Task 3）----------

test('B76：力竭 ⇒ 手牌上限 = ceil(hpMax/2)（7 ⇒ 4）', () => {
  const s = exhaust(mk(4, 7), 0);
  assert.equal(handLimitOf(s.players[0]!), Math.ceil(s.players[0]!.hpMax / 2));
  assert.ok(s.players[0]!.hpMax >= 6, '前提：hpMax ≥ 6（上限真的减半了）');
});

test('B76：旧存档缺 exhaustedRounds ⇒ handLimitOf 按 0 处理（不 NaN）', () => {
  const s = mk(4, 7);
  const legacy: Player = JSON.parse(JSON.stringify(s.players[0]));
  delete (legacy as unknown as Record<string, unknown>).exhaustedRounds;
  assert.equal(handLimitOf(legacy), legacy.hpMax, '缺字段按未力竭处理（Read Focus #1）');
});

test('B76：力竭骰移 = max(1, 骰面-1)（先减后加；seed 扫描保证区分力——骰面 ≥ 2 才可判）', () => {
  let seen = false;
  for (let seed = 7; seed < 60 && !seen; seed++) {
    const start = mk(4, seed);
    const pos0 = start.players[0]!.position;
    const base = applyEffect({ state: start, actor: 0 }, { op: 'move_by_dice', faces: 6, target: 0 }).state;
    const dieFace = base.players[0]!.position - pos0;
    if (dieFace < 2) { continue; }   // 骰面 1 时 max(1,0)=1 与未力竭相同 ⇒ 该 seed 无区分力
    seen = true;
    const arm = applyEffect({ state: exhaust(mk(4, seed), 0), actor: 0 }, { op: 'move_by_dice', faces: 6, target: 0 }).state;
    assert.equal(arm.players[0]!.position, Math.max(1, dieFace - 1), `seed=${seed} 骰面=${dieFace}`);
  }
  assert.ok(seen, 'seed 7–60 内必须出现骰面 ≥ 2（否则测试恒 vacuous）');
});

test('B76：力竭 ⇒ 主动被动被拒（performAbility ok:false，note 含力竭）', () => {
  const s = withPassive(exhaust(mk(4, 7), 0), 0, { op: 'transfer_resource', amount: 1 });
  const r = performAbility(s, 0, 1);
  assert.equal(r.ok, false);
  assert.ok((r.note ?? '').includes('力竭'), r.note);
});

test('B76：力竭 ⇒ 不能发起质疑（且不扣灵枢——拒在扣费前）', () => {
  const s0 = putPending(mk(4, 7), [1]);
  const s = exhaust(s0, 0);
  assert.deepEqual(s.certification.pending, [1], '前提：座 1 真的在待认证（player 字段与认证状态两回事）');
  const before = s.players[0]!.resource;
  const r = certifyChallenge(s, 0, 1);
  assert.equal(r.ok, false);
  assert.ok((r.note ?? '').includes('力竭'), r.note);
  assert.equal(r.state.players[0]!.resource, before, '拒在扣费前，一分不扣');
});

// ---------- 夹具 ----------

/** 给座 `seat` 挂被动（passive-abilities.test.ts 的 withPassive 同款）。 */
function withPassive(s: State, seat: number, passive: unknown): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, passive } } : p)) };
}
// ---------- 夹具 ----------


// ---------- 自然恢复（Task 4）----------

/** 跨一个 round（把 turnIndex 推到末位 + move + advanceTurn）。 */
function crossRound(s: State): State {
  const moved = { ...s, turnIndex: s.turnOrder.length - 1 };
  const cur = currentPlayer(moved);
  const acted = performAction(moved, cur, 'move');
  return advanceTurn(acted, 'standard');
}

test('B76：触发当轮末递减 2→1（仍力竭——r1.1 笔误钉子：不是 max(0,-1)）', () => {
  let s = exhaust(withHp(mk(4, 7), 0, 0), 0);
  s = crossRound(s);
  assert.equal(s.round, 2, '前提：已跨轮');
  const p = s.players[0]!;
  assert.equal(p.exhaustedRounds, 1, '触发当轮末剩 1——当轮末即解除 = 递减笔误');
  assert.equal(p.hp, 0, '未解除 ⇒ 不回血');
});

test('B76：下一轮末 1→0 ⇒ 解除 + hp 保底 max(当前, ceil(hpMax/2))', () => {
  let s = exhaust(withHp(mk(4, 7), 0, 0), 0);
  s = crossRound(s);
  s = crossRound(s);
  const p = s.players[0]!;
  assert.equal(p.exhaustedRounds, 0, '已解除');
  assert.equal(p.hp, Math.ceil(p.hpMax / 2), '保底回血');
});

test('B76：力竭期间 heal 抬血 ⇒ 解除时保留（不倒扣）', () => {
  let s = exhaust(withHp(mk(4, 7), 0, 0), 0);
  s = crossRound(s); // 2→1
  s = applyEffect({ state: s, actor: 1 }, { op: 'heal', amount: 5, target: 0 }).state;
  const healed = s.players[0]!.hp;
  s = crossRound(s); // 1→0 解除
  assert.equal(s.players[0]!.exhaustedRounds, 0);
  assert.equal(s.players[0]!.hp, healed, '解除不倒扣（heal 白给检查）');
});

// ---------- 最终审查 I2：被放逐者不得「自然恢复」（尸体回血 / 幽灵日志）----------
//
// ⚠️ 力竭约 1.5 round ⇒ 「hp 归零当轮被放逐」是真实牌型；放逐清 hasMark（§5.6）同款语义：
//   被放逐者的力竭状态一并作废（exhaustedRounds 清 0）；endRound 递减循环跳过死者；
//   recoverFromExhaustion 对死者不生日志不回血（唯一实现处的防御）。
import { castVote, resolveCouncil } from '../../engine/core/council.ts';
import { councilScene } from './fixtures.ts';

test('B76 最终审查 I2：放逐清除力竭状态（与 hasMark 同款「身上的状态作废」）', () => {
  let s = councilScene(4, 7);
  s = { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, exhaustedRounds: 2, hp: 0 } : p)) };
  for (const p of s.players.filter((x) => x.alive)) {
    const r = castVote(s, p.seat, p.seat === 1 ? 0 : 1);
    assert.ok(r.ok, '前提：投票成功');
    s = r.state;
  }
  const res = resolveCouncil(s);
  assert.ok(res.ok);
  assert.equal(res.state.players[1]!.alive, false, '座 1 被放逐');
  assert.equal(res.state.players[1]!.exhaustedRounds, 0, '力竭状态随放逐作废');
});

test('B76 最终审查 I2：死者跨 round 末 ⇒ 无恢复日志、hp 不变（递减循环跳过死者）', () => {
  // 直接构造死者带力竭残值的局面（放逐路径已清 ⇒ 这是防御性断言，防未来写入点漏清）
  const s0 = exhaust(withHp(mk(4, 7), 1, 0), 1);
  const dead = { ...s0, players: s0.players.map((p) => (p.seat === 1 ? { ...p, alive: false } : p)) };
  const before = dead.players[1]!.hp;
  const rec = recoverFromExhaustion(dead, 1, '自然');
  assert.equal(rec.players[1]!.hp, before, '死者不回血');
  assert.equal(rec.players[1]!.exhaustedRounds, 2, 'recoverFromExhaustion 不碰死者（清零是放逐侧的职责）');
  const added = rec.log.slice(dead.log.length).filter((l) => l.kind === 'exhaustion');
  assert.equal(added.length, 0, '无幽灵日志');
});
