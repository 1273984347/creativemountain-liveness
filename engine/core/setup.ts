// 开局配置：按主题分配身份与阵营（规格 §4.1 / §4.2）。
//
// 主题包提供 8 个身份与 4 个阵营；引擎在开局时把它们分配给玩家。
// **身份是公开的**（§4.1 明牌竞速），所以分配结果必须进日志。

import type { ThemePack } from '../types/theme.ts';
import type { State } from './state.ts';

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
