// 开局**随机行动顺序**的行为契约（B10 收尾④）。
//
// 背景：行动顺序若固定按座位，座 0 永远先动 ⇒ 先登顶 ⇒ 先认证 ⇒ 先终局
//   ⇒ **座位与胜率绑定**（实测胜率沿座位严格单调递减：22.4% → 1.7%）。
//   本轮把「行动顺序」改为**开局随机决定**（固定 seed 可复现），
//   「先手」不再绑定任何固定座位 ⇒ 座位胜率 spread 从 20.7pp 降到 3.0pp。
//
// ⚠️ 本文件**不**声称「先手优势已消除」—— 那是规则级问题，见 `balance-regression.test.ts`：
//   位次胜率仍有 11.4pp（严格单调递减），根源是规则链「先登顶 → 77.6% 直接获胜」，
//   属 V1.1 的抢先链规则修正，不在本轮范围。
//
// 本文件钉住 turnOrder 的六条性质：排列合法 / 随机 / 可复现 / 轮转正确 /
// 整局沿用 / 存档往返（含旧档兼容）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { advanceWithDuel } from './helpers.ts';
import { currentPlayer, nextTurn } from '../../engine/core/round.ts';
import { stateToJson, stateFromJson } from '../../engine/core/serialize.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 造一局（seed 不同 ⇒ 随机分配与行动顺序都不同）。 */
function game(seed: number, players = 8): State {
  const base = createInitialState({ players: players as 3 | 4 | 5 | 6 | 7 | 8, seed, deckSize: theme.cards.length });
  return installTheme(base, theme);
}

// ---------- 排列合法性 ----------

test('turnOrder 是座位 0..N-1 的一个排列（每个座位恰好出现一次）', () => {
  for (const players of [3, 4, 5, 6, 7, 8] as const) {
    const s = game(7, players);
    assert.equal(s.turnOrder.length, players, `${players} 人局的 turnOrder 长度应为 ${players}`);
    assert.deepEqual([...s.turnOrder].sort((a, b) => a - b), Array.from({ length: players }, (_, i) => i),
      `${players} 人局的 turnOrder 应恰好覆盖每个座位一次`);
  }
});

// ---------- 随机性 ----------

test('行动顺序是随机的：不同 seed 下同一座位的行动次序不同', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    seen.add(game(seed).turnOrder.join(','));
  }
  // 8 座位的排列共 8! = 40320 种 ⇒ 24 个 seed 几乎不可能重复；
  // 阈值取 20 是为了容忍 rng 偶发碰撞，同时仍能抓住「退化成固定座位序」。
  assert.ok(seen.size >= 20, `24 个 seed 应给出近乎互异的行动顺序，实际只有 ${seen.size} 种`);
});

test('行动顺序可复现：同 seed ⇒ 同一套行动顺序', () => {
  const a = game(1234);
  const b = game(1234);
  assert.deepEqual([...a.turnOrder], [...b.turnOrder]);
});

// ---------- 轮转正确性 ----------

test('currentPlayer 按 turnOrder 轮转（不是按座位序）', () => {
  const s = game(42);
  let st = s;
  const seq: number[] = [];
  for (let i = 0; i < s.turnOrder.length; i++) {
    seq.push(currentPlayer(st));
    st = nextTurn(st);
  }
  assert.deepEqual(seq, [...s.turnOrder], '手番顺序应与 turnOrder 逐位一致');
});

test('开局第一个行动的席位是 turnOrder 的第一位', () => {
  const s = game(2024);
  assert.equal(currentPlayer(s), s.turnOrder[0]);
});

test('turnOrder 整局沿用（回合推进不改变行动顺序）', () => {
  const s = game(77);
  const order = [...s.turnOrder];
  let st = s;
  for (let i = 0; i < 12; i++) {
    st = advanceWithDuel(st, 'standard');
    assert.deepEqual([...st.turnOrder], order, '行动顺序应在整局内保持不变');
  }
});

// ---------- 存档往返 ----------

test('存档往返保留行动顺序', () => {
  const s = game(31);
  const back = stateFromJson(stateToJson(s));
  assert.deepEqual([...back.turnOrder], [...s.turnOrder]);
});

test('旧档兼容：缺 turnOrder 的存档按座位序补齐', () => {
  const s = game(31);
  const data = JSON.parse(stateToJson(s)) as { state: Record<string, unknown> };
  delete data.state.turnOrder;
  const back = stateFromJson(JSON.stringify(data));
  assert.deepEqual([...back.turnOrder], s.players.map((p) => p.seat));
});
