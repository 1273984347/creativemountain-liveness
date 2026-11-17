// 标志性卡牌的**精确效果**断言（B8）。
//
// 为什么要在对局测试之外再单独钉一遍：
//   「打出后局面变了」只能证明效果**不是空操作**，
//   抓不住「昼夜两支写反了」「资源给错人」这类**语义写反**的缺陷。
//   本文件对 6 张标志卡逐张断言**具体的资源/手牌/HP/护盾增减**。
//
// 6 张标志卡的设计刻意互不相同（6 个谓词各用一次）：
//   意识分叉 phase_is · 量子纠缠 dice_is_at_least · 道箓转化 resource_at_least
//   双生符 has_card · 情绪抽离 hp_at_least · 意志壁垒 card_type_is

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

/** 使用者座位：攻击类标志卡的 target 为座位 0，故用座 1 作使用者、座 0 作目标。 */
const ACTOR = 1;

/**
 * 构造受控局面：
 *   · 所有玩家的资源清零、HP统一（便于逐项断言增减）
 *   · 手牌只发给使用者（has_card / card_type_is 谓词查的是**使用者**手牌）
 *   · 手牌上限放大到 20，避免「手牌上限 = 体力上限」在断言时裁牌
 *   · lastDice 可设（dice_is_at_least 谓词用）
 */
function scene(
  theme: ThemePack,
  opts: { hand?: readonly Card[]; hp?: number; resource?: number; lastDice?: number } = {},
): State {
  const base = createInitialState({ players: 3, seed: 1, deckSize: theme.cards.length });
  const withFactions = assignIdentitiesAndFactions(base, theme);
  const players = withFactions.players.map((p, i) => ({
    ...p,
    hand: i === ACTOR ? [...(opts.hand ?? [])] : [],
    hp: opts.hp ?? 10,
    hpMax: 20,
    resource: opts.resource ?? 0,
  }));
  return { ...withFactions, players, lastDice: opts.lastDice ?? 0 };
}

/** 打出标志卡，返回使用者与目标的状态。 */
function play(
  theme: ThemePack,
  cardId: string,
  s: State,
): { target: { hp: number }; self: { hand: number; resource: number; hp: number; shield: number } } {
  const c = cardOf(theme, cardId);
  const after = applyEffect({ state: s, actor: ACTOR, sourceCard: c }, at(c.effects, 0)).state;
  const t = after.players[0];
  const u = after.players[ACTOR];
  assert.ok(t !== undefined && u !== undefined);
  return {
    target: { hp: t.hp },
    self: { hand: u.hand.length, resource: u.resource, hp: u.hp, shield: u.shield },
  };
}

// ---------- 科幻·AI 纪元 ----------

test('标志卡「意识分叉」：昼抽 2 张不加算力；夜抽 1 张并得 2 算力', () => {
  const theme = loadTheme('scifi-ai');
  const day = play(theme, 'c_sa_u01', scene(theme));
  assert.equal(day.self.hand, 2, '昼分支应只抽 2 张');
  assert.equal(day.self.resource, 0, '昼分支不应加算力');
  const night = play(theme, 'c_sa_u01', { ...scene(theme), phaseValue: 'night' });
  assert.equal(night.self.hand, 1, '夜分支应抽 1 张');
  assert.equal(night.self.resource, 2, '夜分支应得 2 算力');
});

test('标志卡「量子纠缠」：骰点 ≥4 则打伤目标并得 2 算力；否则只得 1 算力', () => {
  const theme = loadTheme('scifi-ai');
  const hit = play(theme, 'c_sa_u02', scene(theme, { lastDice: 5 }));
  assert.equal(hit.target.hp, 9, '骰点 ≥4 应对目标（座位 0）造成 1 点伤害');
  assert.equal(hit.self.resource, 2, '骰点 ≥4 应得 2 算力');
  const miss = play(theme, 'c_sa_u02', scene(theme, { lastDice: 2 }));
  assert.equal(miss.target.hp, 10, '骰点 <4 不应造成伤害');
  assert.equal(miss.self.resource, 1, '骰点 <4 只应得 1 算力');
});

// ---------- 融合·道械双修 ----------

test('标志卡「道箓转化」：灵能充足则抽 2 张得 1 灵能；不足则抽 1 张得 2 灵能（双向兑换）', () => {
  const theme = loadTheme('hybrid');
  const rich = play(theme, 'c_hy_u01', scene(theme, { resource: 2 }));
  assert.equal(rich.self.hand, 2, '灵能充足应抽 2 张');
  assert.equal(rich.self.resource, 3, '灵能充足应得 1 灵能（2+1）');
  const poor = play(theme, 'c_hy_u01', scene(theme, { resource: 0 }));
  assert.equal(poor.self.hand, 1, '灵能不足应抽 1 张');
  assert.equal(poor.self.resource, 2, '灵能不足应得 2 灵能');
});

test('标志卡「双生符」：手上有功能牌则抽 2 张得 2 灵能；否则只得 2 灵能', () => {
  const theme = loadTheme('hybrid');
  const utility = theme.cards.find((c) => c.type === 'utility');
  assert.ok(utility !== undefined);
  const withCard = play(theme, 'c_hy_u02', scene(theme, { hand: [utility] }));
  assert.equal(withCard.self.hand, 3, '有功能牌应再抽 2 张（1+2）');
  assert.equal(withCard.self.resource, 2, '有功能牌应得 2 灵能');
  const bare = play(theme, 'c_hy_u02', scene(theme));
  assert.equal(bare.self.hand, 0, '空手不应抽牌');
  assert.equal(bare.self.resource, 2, '空手应得 2 灵能');
});

// ---------- 都市·异能纪 ----------

test('标志卡「情绪抽离」：状态好则自愈 2 点并得 1 护盾；状态差则打伤目标换 2 异能点', () => {
  const theme = loadTheme('urban-psych');
  // 注：scene 把所有玩家的HP统一设为 opts.hp，故目标（座位 0）初始也是同值
  const strong = play(theme, 'c_up_u01', scene(theme, { hp: 5 }));
  assert.equal(strong.self.hp, 7, '状态好应恢复 2 点精神值（5→7）');
  assert.equal(strong.self.shield, 1, '状态好应得 1 点护盾');
  assert.equal(strong.target.hp, 5, '状态好不应造成伤害');
  const weak = play(theme, 'c_up_u01', scene(theme, { hp: 3 }));
  assert.equal(weak.target.hp, 2, '状态差应对目标（座位 0）造成 1 点伤害（3→2）');
  assert.equal(weak.self.hp, 3, '状态差不应自愈');
  assert.equal(weak.self.resource, 2, '状态差应得 2 异能点');
});

test('标志卡「意志壁垒」：手上有功能牌则得 2 异能点与 1 护盾；否则抽 1 张', () => {
  const theme = loadTheme('urban-psych');
  const utility = theme.cards.find((c) => c.type === 'utility');
  assert.ok(utility !== undefined);
  const withCard = play(theme, 'c_up_u02', scene(theme, { hand: [utility] }));
  assert.equal(withCard.self.resource, 2, '有功能牌应得 2 异能点');
  assert.equal(withCard.self.shield, 1, '有功能牌应得 1 点护盾');
  assert.equal(withCard.self.hand, 1, '有功能牌不应抽牌');
  const bare = play(theme, 'c_up_u02', scene(theme));
  assert.equal(bare.self.hand, 1, '空手应抽 1 张');
  assert.equal(bare.self.resource, 0, '空手不应得异能点');
});

test('6 张标志卡两两效果互不相同（不得是同一张牌换皮）', () => {
  const pairs: readonly (readonly [string, string])[] = [
    ['scifi-ai', 'c_sa_u01'], ['scifi-ai', 'c_sa_u02'],
    ['hybrid', 'c_hy_u01'], ['hybrid', 'c_hy_u02'],
    ['urban-psych', 'c_up_u01'], ['urban-psych', 'c_up_u02'],
  ];
  const seen = new Map<string, string>();
  for (const [themeId, cardId] of pairs) {
    const theme = loadTheme(themeId);
    const c = cardOf(theme, cardId);
    const key = JSON.stringify(c.effects);
    const prev = seen.get(key);
    assert.ok(prev === undefined, `标志卡 ${cardId} 与 ${prev ?? ''} 的效果完全相同——不是独特效果`);
    seen.set(key, cardId);
  }
  assert.equal(seen.size, pairs.length, '6 张标志卡应有 6 种不同效果');
});