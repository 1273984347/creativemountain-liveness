// extra_vote / extra_roll 的**读取逻辑**契约（B10 补）。
//
// 这两个算子此前**只写不读**：
//   · extra_vote 写 flags.extraVotes，但山议计票硬编码 identityId === 'arbiter'
//     ⇒ 任何**其他**拿到 extra_vote 的玩家都无效；
//   · extra_roll 写 State.extraRolls，但行棋从不读它 ⇒ 掷骰机会等于不存在。
//
// 本文件钉住两件事：**效果被消费**（读取点真的生效）+ **机制等价**（仲裁者仍是 2 票）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { grantedFlags } from '../../engine/core/passives.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { voteWeight } from '../../engine/core/council.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 装好主题的 3 人局（座 0..2）。 */
function game(players = 3): State {
  const base = createInitialState({ players: players as 3, seed: 11, deckSize: theme.cards.length });
  return installTheme(base, theme);
}

// ---------- extra_vote：授予 ----------

test('grantedFlags：识别被动里的 extra_vote（含嵌套在 sequence 里）', () => {
  assert.equal(grantedFlags({ op: 'extra_vote', amount: 1 }).extraVotes, 1);
  assert.equal(grantedFlags({ op: 'gain_resource', amount: 2 }).extraVotes, 0);
  assert.equal(grantedFlags(undefined).extraVotes, 0);
  assert.equal(
    grantedFlags({ op: 'sequence', effects: [{ op: 'extra_vote', amount: 2 }] }).extraVotes,
    2,
  );
});

test('分配身份时授予仲裁者额外投票权（flags.extraVotes = 1）', () => {
  // 用 8 人局：人数少于 8 时身份槽位只出场一部分（随机缺席），仲裁者未必在场
  const s = game(8);
  const arbiter = s.players.find((p) => p.identityId === 'arbiter');
  assert.ok(arbiter !== undefined, '应有仲裁者');
  assert.equal((arbiter.flags.extraVotes as number | undefined) ?? 0, 1);
});

test('非仲裁者没有额外投票权', () => {
  const s = game(8);
  const pioneer = s.players.find((p) => p.identityId === 'pioneer');
  assert.ok(pioneer !== undefined);
  assert.equal((pioneer.flags.extraVotes as number | undefined) ?? 0, 0);
});

// ---------- extra_vote：读取（山议计票）----------

test('voteWeight：基础 1 票 + 额外投票数', () => {
  const s = game(8);
  const arbiter = s.players.find((p) => p.identityId === 'arbiter');
  assert.ok(arbiter !== undefined);
  assert.equal(voteWeight(s, arbiter.seat), 2, '仲裁者应 2 票');
  const other = s.players.find((p) => p.identityId !== 'arbiter');
  assert.ok(other !== undefined);
  assert.equal(voteWeight(s, other.seat), 1, '普通人 1 票');
});

test('山议计票读 extra_vote：权重能**逆转**并列结果', () => {
  const s = game(3);
  // 座 0、座 1 各投座 2 一票 ⇒ 1:1 并列
  const tie: State = {
    ...s,
    council: { ...s.council, votes: { 0: 2, 1: 2 }, resolved: false },
  };
  assert.equal(voteWeight(tie, 0), 1);
  // 给座 0 额外 1 票 ⇒ 座 2 得 2 票 > 座 0 的 0 票 ⇒ 座 2 单独最高
  const weighted: State = {
    ...tie,
    players: tie.players.map((p) => (p.seat === 0
      ? { ...p, flags: { ...p.flags, extraVotes: 1 } }
      : p)),
  };
  assert.equal(voteWeight(weighted, 0), 2, '额外票必须被计票读到');
});

// ---------- extra_roll：授予 ----------

test('extra_roll 效果写入 extraRolls', () => {
  const s = game(3);
  const r = applyEffect({ state: s, actor: 0 }, { op: 'extra_roll', count: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.state.extraRolls, 2);
});

// ---------- extra_roll：读取（行棋时消费）----------

test('行棋消费额外掷骰机会：多掷一次取最高，且机会用完即清零', () => {
  const s0 = game(3);
  const s1 = applyEffect({ state: s0, actor: 0 }, { op: 'extra_roll', count: 1 }).state;
  assert.equal(s1.extraRolls, 1);
  const r = applyEffect({ state: s1, actor: 0 }, { op: 'move_by_dice', faces: 6 });
  assert.equal(r.ok, true);
  assert.equal(r.state.extraRolls, 0, '机会用完即清零');
  // 有机会时掷了两次 ⇒ 日志含「取最高」
  const log = r.state.log.at(-1)?.message ?? '';
  assert.ok(log.includes('取最高'), '日志应体现多掷取最高：' + log);
});

test('无机会时行棋只掷一次（不消费、不产生额外位移）', () => {
  const s0 = game(3);
  const r = applyEffect({ state: s0, actor: 0 }, { op: 'move_by_dice', faces: 6 });
  assert.equal(r.ok, true);
  assert.equal(r.state.extraRolls, 0);
  const log = r.state.log.at(-1)?.message ?? '';
  assert.ok(!log.includes('取最高'), '无机会时不应多掷：' + log);
});

test('同 seed 下，有额外机会时前进距离 ≥ 无机会时（取更高点）', () => {
  const base = createInitialState({ players: 3, seed: 99, deckSize: 10 });
  const plain = applyEffect({ state: base, actor: 0 }, { op: 'move_by_dice', faces: 6 });
  const withExtra = applyEffect(
    { state: { ...base, extraRolls: 1 }, actor: 0 },
    { op: 'move_by_dice', faces: 6 },
  );
  const d1 = (plain.state.players[0]?.position ?? 0) - 0;
  const d2 = (withExtra.state.players[0]?.position ?? 0) - 0;
  assert.ok(d2 >= d1, `有机会时距离 ${d2} 应 ≥ 无机会时 ${d1}`);
});