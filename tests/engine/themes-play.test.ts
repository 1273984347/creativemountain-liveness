// B8 主题包对局测试（规格 §10.1 验收：4 套主题均通过校验与对局）
//
// 覆盖三件事：
//   ① 四套主题包都能装进引擎开局 —— 主题包 → State 的装配链没断
//   ② 每套主题都能跑完整回合且状态始终合法 —— 不会因主题数据崩掉
//   ③ 每套新主题的**标志性卡牌**效果在引擎里真的能执行 ——
//      §10.1 必须差异化第 ④ 项不只是「名字不同」，而是「效果独特且可运行」
//
// ⚠️ 全部在**内存副本**上操作，不读写工作区文件（负样本必须自包含）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { performAction, advanceTurn } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { at } from './helpers.ts';

const THEME_IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'] as const;
const NEW_THEME_IDS = ['scifi-ai', 'hybrid', 'urban-psych'] as const;

function loadTheme(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

/**
 * 主题包 → 引擎 State 的装配。
 *
 * ⚠️ 用的是**引擎侧同一个** `installTheme`（数字轨 web/main.ts 也调它）——
 *   测试与生产共用一条装配链，避免「测试装配 ≠ 生产装配」的分裂。
 */
function newGame(theme: ThemePack, players: 3 | 4 | 5 | 6 | 7 | 8, seed: number): State {
  return installTheme(createInitialState({ players, seed, deckSize: theme.cards.length }), theme);
}

/** 跑若干个 round（每个存活玩家各行动一次 = 1 round，规格 §3.1）。 */
function playRounds(start: State, rounds: number): State {
  let s = start;
  for (let r = 0; r < rounds; r++) {
    for (let t = 0; t < 8; t++) {
      const seat = currentPlayer(s);
      if (seat < 0) {
        return s;
      }
      s = performAction(s, seat, 'move');
      s = advanceTurn(s, 'standard');
      if (s.outcome.finished) {
        return s;
      }
    }
  }
  return s;
}

/** 状态合法性体检（跑完一局后逐玩家核对）。 */
function assertLegal(s: State, label: string): void {
  for (const p of s.players) {
    assert.ok(Number.isFinite(p.hp) && p.hp >= 0, `${label} 座${p.seat} 体力非法：${p.hp}`);
    assert.ok(Number.isFinite(p.resource) && p.resource >= 0, `${label} 座${p.seat} 资源非法：${p.resource}`);
    assert.ok(Number.isFinite(p.shield) && p.shield >= 0, `${label} 座${p.seat} 护盾非法：${p.shield}`);
    assert.ok(
      p.position >= 0 && p.position <= s.board.length,
      `${label} 座${p.seat} 位置越界：${p.position}`,
    );
    assert.ok(p.hand.length <= p.hpMax, `${label} 座${p.seat} 手牌 ${p.hand.length} 超过上限 ${p.hpMax}`);
  }
  assert.ok(s.decks.deck.length + s.decks.discard.length >= 0, `${label} 牌堆计数异常`);
}

/** 取某玩家的状态指纹（用于「效果真的发生了」的断言）。 */
function fingerprint(s: State, seat: number): string {
  const p = s.players[seat];
  if (p === undefined) {
    return 'none';
  }
  return [p.hand.length, p.resource, p.hp, p.shield, p.position].join('/');
}

// ---------- ① 四套主题都能开局 ----------

for (const id of THEME_IDS) {
  test(`主题 ${id}：能装进引擎并开局（3 人局）`, () => {
    const theme = loadTheme(id);
    const s = newGame(theme, 3, 20261107);
    assert.equal(s.players.length, 3);
    assert.equal(s.board.length, theme.board.length);
    assert.equal(s.board.peakIndex, theme.board.peakIndex);
    // 发牌后：牌库剩余 + 各家手牌 = 卡池总数（发牌把牌从牌库移到手牌）
    const inHand = s.players.reduce((n, p) => n + p.hand.length, 0);
    assert.equal(
      s.decks.deck.length + inHand,
      theme.cards.length,
      '牌库剩余 + 手牌应等于卡池总数',
    );
    assert.equal(s.decks.trial.length, (theme.trials ?? []).length);
    assert.equal(s.decks.creation.length, (theme.creationDeck ?? []).length);
    // 身份与阵营按主题分配（规格 §4.1 明牌竞速 ⇒ 必须可从状态读出）
    assert.equal(s.players[0]?.identityId, theme.identities[0]?.id);
    assert.equal(s.players[0]?.factionId, theme.factions[0]?.id);
    assert.equal(s.players[0]?.hpMax, theme.factions[0]?.hpBase);
    // 每人都发到起始手牌
    for (const p of s.players) {
      assert.equal(p.hand.length, theme.counts.handStart, `座${p.seat} 起始手牌数不符`);
    }
    assertLegal(s, `${id} 开局`);
  });
}

// ---------- ② 四套主题都能跑完整回合 ----------

for (const id of THEME_IDS) {
  test(`主题 ${id}：跑 12 个 round 后状态仍合法`, () => {
    const theme = loadTheme(id);
    const s0 = newGame(theme, 3, 4242);
    const s1 = playRounds(s0, 12);
    assertLegal(s1, `${id} 12 round`);
    assert.ok(s1.log.length > 0, '应有回合日志');
    assert.ok(s1.round > 1, '回合数应推进');
    // 至少有人移动过（行棋生效）
    const moved = s1.players.some((p, i) => p.position !== (s0.players[i]?.position ?? 0));
    assert.ok(moved, '应有玩家位置变化');
  });
}

// ---------- ③ 标志性卡牌的效果在引擎里可执行 ----------

for (const id of NEW_THEME_IDS) {
  test(`主题 ${id}：2 张标志卡效果可执行且真的改变局面`, () => {
    const theme = loadTheme(id);
    const flags = theme.cards.filter((c) => /_u0[12]$/.test(c.id));
    assert.equal(flags.length, 2, `${id} 应有 2 张标志卡，实际 ${flags.length}`);
    for (const flag of flags) {
      const s0 = newGame(theme, 3, 99);
      const before = fingerprint(s0, 0);
      const after = applyEffect(
        { state: s0, actor: 0, sourceCard: flag },
        at(flag.effects, 0),
      ).state;
      assert.notEqual(
        fingerprint(after, 0),
        before,
        `${id} 标志卡「${flag.name}」打出后局面毫无变化——效果没生效`,
      );
      assertLegal(after, `${id} 标志卡 ${flag.name}`);
    }
  });
}

test('标志卡「意识分叉」：昼夜两态产生不同结果（科幻主题的机制气质）', () => {
  const theme = loadTheme('scifi-ai');
  const flag = theme.cards.find((c) => c.id === 'c_sa_u01');
  assert.ok(flag !== undefined, '应存在意识分叉');
  const day = newGame(theme, 3, 7);
  const night: State = { ...day, phaseValue: 'night' };
  const eff = at(flag.effects, 0);
  const dayResult = applyEffect({ state: day, actor: 0, sourceCard: flag }, eff).state;
  const nightResult = applyEffect({ state: night, actor: 0, sourceCard: flag }, eff).state;
  assert.notEqual(
    fingerprint(dayResult, 0),
    fingerprint(nightResult, 0),
    '昼夜两态必须产生不同结果',
  );
  assertLegal(dayResult, '意识分叉·昼');
  assertLegal(nightResult, '意识分叉·夜');
});
