// 开局配置：按主题分配身份与阵营（规格 §4.1 / §4.2）。
//
// 主题包提供 8 个身份与 4 个阵营；引擎在开局时把它们分配给玩家。
// **身份是公开的**（§4.1 明牌竞速），所以分配结果必须进日志。

import type { Card, Effect, ThemePack } from '../types/theme.ts';
import type { State } from './state.ts';
import { dealInitialHands } from './hand.ts';

/**
 * 按主题分配身份与阵营。
 *
 * 身份按座位轮转分配（8 个身份槽位）；阵营每 4 人一轮（4 个阵营槽位）。
 */
export function assignIdentitiesAndFactions(state: State, theme: ThemePack): State {
  const players = state.players.map((p, i) => {
    const identity = theme.identities[i % theme.identities.length];
    const faction = theme.factions[i % theme.factions.length];
    return {
      ...p,
      identityId: identity?.id ?? p.identityId,
      factionId: faction?.id ?? p.factionId,
      hpMax: faction?.hpBase ?? p.hpMax,
      hp: faction?.hpBase ?? p.hp,
      resource: faction?.resourceBase ?? p.resource,
    };
  });
  const names = players.map((p) => {
    const identity = theme.identities.find((i) => i.id === p.identityId);
    const faction = theme.factions.find((f) => f.id === p.factionId);
    return '座' + p.seat + ' = ' + (identity?.name ?? p.identityId) + '（' + (faction?.name ?? p.factionId) + '）';
  });
  return {
    ...state,
    players,
    log: [...state.log, { round: state.round, turnIndex: state.turnIndex, actor: -1, kind: 'setup', message: '身份与阵营分配：' + names.join('；') }],
  };
}

/** 把非 Card 的牌（天机 / 试炼 / 认证题）包成引擎可用的 Card。 */
function toCard(id: string, name: string, text: string, effects: readonly Effect[]): Card {
  return { id, name, type: 'utility', cost: 0, color: 'red', rank: 2, text, effects: [...effects] };
}

/** 确定性洗牌（用状态自己的 RNG 推进状态 ⇒ 同 seed 同结果）。 */
function shuffle(items: readonly Card[], state: State): Card[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng.next() * (i + 1));
    const ti = a[i];
    const tj = a[j];
    if (ti !== undefined && tj !== undefined) {
      a[i] = tj;
      a[j] = ti;
    }
  }
  return a;
}

/**
 * 把主题包装进 State：**牌池 / 棋盘 / 天机 / 试炼 / 认证题 / 造物**。
 *
 * ⚠️ B8 补：createInitialState 的 deckSize 参数只是 **B1 骨架的测试牌占位**——
 *   主题包的真实卡池与棋盘此前从未进过数字轨（UI 里打的是「测试牌N」）。
 *   本函数把装配收进引擎侧，让**数字轨与对局测试共用同一条装配链**，
 *   避免「测试装配 ≠ 生产装配」这种分裂。
 *
 * 顺序：装牌堆 → 分配身份阵营（决定体力上限）→ 按体力上限发牌。
 */
export function installTheme(state: State, theme: ThemePack): State {
  const creationIds = new Set((theme.creationDeck ?? []).map((c) => c.cardId));
  const withPacks: State = {
    ...state,
    board: {
      length: theme.board.length,
      tiles: [...theme.board.tiles],
      peakIndex: theme.board.peakIndex,
    },
    decks: {
      deck: shuffle(theme.cards, state),
      discard: [],
      creation: theme.cards.filter((c) => creationIds.has(c.id)),
      exhausted: [],
      heaven: theme.heavenCards.map((h) => toCard(h.id, h.name, h.text, h.effects)),
      trial: (theme.trials ?? []).map((t) => toCard(t.id, t.id, t.text, t.effects ?? [])),
      cert: theme.certificationCards.map((c) => toCard(c.id, c.id, c.prompt, [])),
    },
    // 发牌前清空手牌：B1 骨架发的「测试牌」不能混进主题局
    players: state.players.map((p) => ({ ...p, hand: [] })),
  };
  const withFactions = assignIdentitiesAndFactions(withPacks, theme);
  return dealInitialHands(withFactions);
}