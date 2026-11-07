// 标志性卡牌的**精确效果**断言（B8）。
//
// 为什么要在对局测试之外再单独钉一遍：
//   「打出后局面变了」只能证明效果**不是空操作**，
//   抓不住「昼夜两支写反了」「资源给错人」这类**语义写反**的缺陷。
//   本文件对 6 张标志卡逐张断言**具体的资源/手牌增减**。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Card, ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { assignIdentitiesAndFactions } from '../../engine/core/setup.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { at } from './helpers.ts';

function loadTheme(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

function cardOf(theme: ThemePack, id: string): Card {
  const c = theme.cards.find((x) => x.id === id);
  assert.ok(c !== undefined, `主题 ${theme.meta.id} 应含卡牌 ${id}`);
  return c;
}

/**
 * 构造受控局面：
 *   · 资源清零（便于断言增减）
 *   · 手牌清空后按需塞入
 *   · 手牌上限放大到 20，避免「手牌上限 = 体力上限」在断言时裁牌
 */
function scene(theme: ThemePack, hand: readonly Card[] = [], hp = 10, resource = 0): State {
  const base = createInitialState({ players: 3, seed: 1, deckSize: theme.cards.length });
  const withFactions = assignIdentitiesAndFactions(base, theme);
  const players = withFactions.players.map((p, i) => (i === 0
    ? { ...p, hand: [...hand], hp, hpMax: 20, resource }
    : { ...p, hand: [] }));
  return { ...withFactions, players };
}

/** 打出一张标志卡，返回座 0 的（手牌数, 资源, 体力）。 */
function play(theme: ThemePack, cardId: string, s: State): { hand: number; resource: number; hp: number } {
  const c = cardOf(theme, cardId);
  const after = applyEffect({ state: s, actor: 0, sourceCard: c }, at(c.effects, 0)).state;
  const p = after.players[0];
  assert.ok(p !== undefined);
  return { hand: p.hand.length, resource: p.resource, hp: p.hp };
}

// ---------- 科幻·AI 纪元 ----------

test('标志卡「意识分叉」：昼抽 2 张不加算力；夜抽 1 张并得 2 算力', () => {
  const theme = loadTheme('scifi-ai');
  const day = play(theme, 'c_sa_u01', scene(theme));
  assert.deepEqual(day, { hand: 2, resource: 0, hp: 10 }, '昼分支应只抽 2 张');
  const night = play(theme, 'c_sa_u01', { ...scene(theme), phaseValue: 'night' });
  assert.deepEqual(night, { hand: 1, resource: 2, hp: 10 }, '夜分支应抽 1 张并得 2 算力');
});

test('标志卡「量子纠缠」：算力 ≥3 得 3 算力抽 1 张；否则得 1 算力抽 1 张', () => {
  const theme = loadTheme('scifi-ai');
  const rich = play(theme, 'c_sa_u02', scene(theme, [], 10, 3));
  assert.deepEqual(rich, { hand: 1, resource: 6, hp: 10 }, '算力充足应得 3 算力（3+3）');
  const poor = play(theme, 'c_sa_u02', scene(theme, [], 10, 0));
  assert.deepEqual(poor, { hand: 1, resource: 1, hp: 10 }, '算力不足应只得 1 算力');
});

// ---------- 融合·道械双修 ----------

test('标志卡「道箓转化」：灵能 ≥2 得 2 灵能抽 1 张；否则只抽 2 张', () => {
  const theme = loadTheme('hybrid');
  const rich = play(theme, 'c_hy_u01', scene(theme, [], 10, 2));
  assert.deepEqual(rich, { hand: 1, resource: 4, hp: 10 }, '灵能充足应得 2 灵能（2+2）');
  const poor = play(theme, 'c_hy_u01', scene(theme, [], 10, 0));
  assert.deepEqual(poor, { hand: 2, resource: 0, hp: 10 }, '灵能不足应只抽 2 张');
});

test('标志卡「双生符」：手上有功能牌则抽 2 张得 2 灵能；否则只得 1 灵能', () => {
  const theme = loadTheme('hybrid');
  const utility = theme.cards.find((c) => c.type === 'utility');
  assert.ok(utility !== undefined);
  const withCard = play(theme, 'c_hy_u02', scene(theme, [utility], 10, 0));
  assert.deepEqual(withCard, { hand: 3, resource: 2, hp: 10 }, '有功能牌应抽 2 张得 2 灵能（手牌 1+2）');
  const bare = play(theme, 'c_hy_u02', scene(theme, [], 10, 0));
  assert.deepEqual(bare, { hand: 0, resource: 1, hp: 10 }, '空手应只得 1 灵能');
});

// ---------- 都市·异能纪 ----------

test('标志卡「情绪抽离」：精神值 ≥5 得 2 异能点抽 1 张；否则得 1 异能点抽 2 张', () => {
  const theme = loadTheme('urban-psych');
  const strong = play(theme, 'c_up_u01', scene(theme, [], 5, 0));
  assert.deepEqual(strong, { hand: 1, resource: 2, hp: 5 }, '状态好应得 2 异能点抽 1 张');
  const weak = play(theme, 'c_up_u01', scene(theme, [], 3, 0));
  assert.deepEqual(weak, { hand: 2, resource: 1, hp: 3 }, '状态差应得 1 异能点抽 2 张');
});

test('标志卡「群体暗示」：手上有功能牌则得 2 异能点抽 1 张；否则得 3 异能点', () => {
  const theme = loadTheme('urban-psych');
  const utility = theme.cards.find((c) => c.type === 'utility');
  assert.ok(utility !== undefined);
  const withCard = play(theme, 'c_up_u02', scene(theme, [utility], 10, 0));
  assert.deepEqual(withCard, { hand: 2, resource: 2, hp: 10 }, '有功能牌应得 2 异能点抽 1 张（手牌 1+1）');
  const bare = play(theme, 'c_up_u02', scene(theme, [], 10, 0));
  assert.deepEqual(bare, { hand: 0, resource: 3, hp: 10 }, '空手应得 3 异能点');
});

test('6 张标志卡两两效果互不相同（不得是同一张牌换皮）', () => {
  const ids = ['c_sa_u01', 'c_sa_u02', 'c_hy_u01', 'c_hy_u02', 'c_up_u01', 'c_up_u02'];
  const seen = new Map<string, string>();
  for (const [themeId, cardId] of [['scifi-ai', 'c_sa_u01'], ['scifi-ai', 'c_sa_u02'], ['hybrid', 'c_hy_u01'], ['hybrid', 'c_hy_u02'], ['urban-psych', 'c_up_u01'], ['urban-psych', 'c_up_u02']] as const) {
    const theme = loadTheme(themeId);
    const c = cardOf(theme, cardId);
    const key = JSON.stringify(c.effects);
    const prev = seen.get(key);
    assert.ok(prev === undefined, `标志卡 ${cardId} 与 ${prev ?? ''} 的效果完全相同——不是独特效果`);
    seen.set(key, cardId);
  }
  assert.equal(seen.size, ids.length, '6 张标志卡应有 6 种不同效果');
});