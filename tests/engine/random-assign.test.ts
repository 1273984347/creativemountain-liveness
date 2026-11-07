// 开局**随机分配**身份与阵营的行为契约（B10）。
//
// 背景：原实现按**座位轮转**分配（identities[i%8] / factions[i%4]）⇒ 身份与座位一一绑定，
// 而先行动的座位在「登顶 → 认证 → 封顶」主线上占先 ⇒ 胜率沿座位**严格单调递减**。
// 本文件钉住随机化的三条性质 + 分配层的解绑检查。
//
// ⚠️ 平衡回归（跑模拟的那几条）已集中到 `balance-regression.test.ts` ——
//   模拟只跑一次、断言多条，避免重复付出子进程模拟的代价。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 造一局（seed 不同 ⇒ 随机分配不同）。 */
function game(seed: number, players = 8): State {
  const base = createInitialState({ players: players as 3 | 4 | 5 | 6 | 7 | 8, seed, deckSize: theme.cards.length });
  return installTheme(base, theme);
}

// ---------- 随机性 ----------

test('分配是随机的：不同 seed 下同一座位拿到的身份不同', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const s = game(seed);
    seen.add(s.players[0]?.identityId ?? '');
  }
  assert.ok(seen.size >= 4, `24 个 seed 里座 0 应拿到多种身份，实际 ${seen.size} 种`);
});

test('分配可复现：同 seed ⇒ 同一套身份/阵营分配', () => {
  const a = game(1234);
  const b = game(1234);
  assert.deepEqual(a.players.map((p) => p.identityId), b.players.map((p) => p.identityId));
  assert.deepEqual(a.players.map((p) => p.factionId), b.players.map((p) => p.factionId));
});

// ---------- 约束保持 ----------

test('每人身份唯一（身份槽位 8 ≥ 人数 3–8）', () => {
  for (const players of [3, 4, 5, 6, 7, 8] as const) {
    const s = game(7, players);
    const ids = s.players.map((p) => p.identityId);
    assert.equal(new Set(ids).size, players, `${players} 人局身份应互不相同`);
  }
});

test('每个阵营至少 1 人，且人数分布与原实现一致（前 4 人各一阵营，其后循环）', () => {
  const s = game(9, 5);
  const counts = new Map<string, number>();
  for (const p of s.players) { counts.set(p.factionId, (counts.get(p.factionId) ?? 0) + 1); }
  assert.equal(counts.size, 4, '5 人局应覆盖 4 个阵营');
  const sorted = [...counts.values()].sort((a, b) => a - b);
  assert.deepEqual(sorted, [1, 1, 1, 2], '应有且仅有一个阵营 2 人');
});

test('身份与阵营不再与座位绑定：同一座位在不同 seed 下可拿到不同阵营', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const s = game(seed);
    seen.add(s.players[0]?.factionId ?? '');
  }
  assert.ok(seen.size >= 3, `座 0 应能拿到多种阵营，实际 ${seen.size} 种`);
});

// ---------- 分配层：身份与座位解绑 ----------

test('分配层：同一身份**不再绑定**某个座位（分布覆盖多个座位且不悬殊）', () => {
  const seatCount = new Map<string, number[]>();
  for (let seed = 1; seed <= 400; seed++) {
    const s = game(seed, 8);
    for (const p of s.players) {
      const arr = seatCount.get(p.identityId) ?? [];
      arr[p.seat] = (arr[p.seat] ?? 0) + 1;
      seatCount.set(p.identityId, arr);
    }
  }
  for (const [id, arr] of seatCount) {
    const total = arr.reduce((a, b) => a + (b ?? 0), 0);
    assert.ok(total >= 390, id + ' 应出现约 400 次，实际 ' + total);
    // 判据直击「绑定」的本质：**覆盖座位数** + **分布不悬殊**。
    // ⚠️ 不用「每个座位次数接近均匀」的绝对容差 —— 二项波动下会假红
    //   （实测 artisan 在座 0 出现 36~61 次 / 期望 50，属正常波动）。
    //   随机化前每个身份只出现在**固定座位** ⇒ 覆盖座位数 = 1 ⇒ 必红。
    const used = arr.filter((n) => (n ?? 0) > 0).length;
    assert.ok(used >= 7, `身份 ${id} 只出现在 ${used} 个座位上 —— 仍与座位绑定`);
    const max = Math.max(...arr);
    const min = Math.min(...arr);
    assert.ok(max <= 3 * (min + 1),
      `身份 ${id} 的座位分布悬殊（max ${max} vs min ${min}）—— 疑似绑定`);
  }
});