// 手牌区与玩家信息面板。

import type { State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el } from './dom.ts';

/** 渲染当前玩家的手牌（可点击出牌）。 */
export function renderHand(
  state: State,
  theme: ThemePack,
  seat: number,
  onPlay: (cardId: string) => void,
): HTMLElement {
  const player = state.players[seat];
  if (player === undefined) { return el('div', { class: 'hand' }); }
  const wrap = el('div', { class: 'hand' });
  if (player.hand.length === 0) {
    wrap.append(el('span', { class: 'muted', text: '（手牌已空）' }));
    return wrap;
  }
  for (const card of player.hand) {
    const node = el('div', { class: 'card ' + card.color, title: card.text });
    node.append(el('div', { class: 'card-cost', text: theme.meta.resourceName + ' ' + card.cost }));
    node.append(el('div', { class: 'card-name', text: card.name }));
    node.append(el('div', { class: 'card-text', text: card.text }));
    node.append(el('div', { class: 'card-rank', text: card.rankLabel ?? String(card.rank) }));
    node.addEventListener('click', () => { onPlay(card.id); });
    wrap.append(node);
  }
  return wrap;
}

/** 渲染玩家列表（体力/灵枢/身份/阵营/装备/状态）。 */
export function renderPlayers(state: State, theme: ThemePack): HTMLElement {
  const list = el('div', { class: 'players' });
  for (const p of state.players) {
    const identity = theme.identities.find((i) => i.id === p.identityId);
    const faction = theme.factions.find((f) => f.id === p.factionId);
    const row = el('div', { class: 'player' + (p.alive ? '' : ' dead') });
    row.append(el('span', { class: 'p-seat', text: '座' + p.seat }));
    row.append(el('span', { class: 'p-name', text: identity?.name ?? p.identityId }));
    row.append(el('span', { class: 'p-meta', text: (faction?.name ?? p.factionId) + ' · 灵力 ' + p.hp + '/' + p.hpMax + ' · ' + theme.meta.resourceName + ' ' + p.resource + ' · 位 ' + p.position }));
    if (p.hasMark) { row.append(el('span', { class: 'badge mark', text: '印记' })); }
    if (p.pendingCert) { row.append(el('span', { class: 'badge cert', text: '待认证' })); }
    if (p.equipment.length > 0) {
      row.append(el('span', { class: 'badge eq', text: '装备 ' + p.equipment.length }));
    }
    const st = Object.entries(p.statuses);
    if (st.length > 0) {
      row.append(el('span', { class: 'badge st', text: st.map(([k, v]) => k + String(v ?? 0)).join(' ') }));
    }
    list.append(row);
  }
  return list;
}
