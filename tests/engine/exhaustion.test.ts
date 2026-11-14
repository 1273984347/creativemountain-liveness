// B76 力竭：触发 / 解除 / 四效果 / 自然恢复 / 常驻断言。
//
// ⚠️ 触发与解除的唯一实现在 `engine/core/exhaustion.ts`（damage、险径、endRound、
//   RECUPERATE 四个调用点共用——同一口径两份实现必漂移，E94）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { State } from '../../engine/core/state.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { finishTurn } from '../../engine/core/turn-runner.ts';
import { recoverFromExhaustion } from '../../engine/core/exhaustion.ts';
import { mk } from './fixtures.ts';

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
