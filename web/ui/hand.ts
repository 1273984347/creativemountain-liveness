// 手牌区与玩家信息面板。

import type { State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el } from './dom.ts';
import { termExpander } from './terms.ts';

/** 渲染当前玩家的手牌（可点击出牌）。 */
export function renderHand(
  state: State,
  theme: ThemePack,
  seat: number,
  onPlay: (cardId: string) => void,
  pendingCardId: string | null = null,
): HTMLElement {
  const player = state.players[seat];
  if (player === undefined) { return el('div', { class: 'hand' }); }
  const wrap = el('div', { class: 'hand' });
  if (player.hand.length === 0) {
    wrap.append(el('span', { class: 'muted', text: '（手牌已空）' }));
    return wrap;
  }
  for (const card of player.hand) {
    const node = el('div', {
      class: 'card ' + card.color + (card.id === pendingCardId ? ' pending' : ''),
      title: card.text,
      'data-action-control': 'card:' + card.id,
    });
    node.append(el('div', { class: 'card-cost', text: theme.meta.resourceName + ' ' + card.cost }));
    node.append(el('div', { class: 'card-name', text: card.name }));
    node.append(el('div', { class: 'card-text', text: card.text }));
    node.append(el('div', { class: 'card-rank', text: card.rankLabel ?? String(card.rank) }));
    node.addEventListener('click', () => { onPlay(card.id); });
    wrap.append(node);
  }
  return wrap;
}

/**
 * 渲染玩家列表（体力/资源/身份/阵营/装备/状态）。术语取词 = `theme.terms`（B79 §3.4：
 * glossary 已退回印刷层对照表，界面不再从它取词）。
 *
 * `onPick` 存在时玩家行可点击（用于**出牌选目标**）；`picking` 为真时才高亮可点行。
 */
export function renderPlayers(
  state: State,
  theme: ThemePack,
  onPick?: (seat: number) => void,
  picking = false,
): HTMLElement {
  const list = el('div', { class: 'players' });
  // 面板是四个显示出口之一（B79 §4.3）：引擎给占位符，这里按本主题词表展开。
  const t = termExpander(theme.terms);
  for (const p of state.players) {
    const identity = theme.identities.find((i) => i.id === p.identityId);
    const faction = theme.factions.find((f) => f.id === p.factionId);
    const pickable = picking && onPick !== undefined && p.alive;
    const row = el('div', { class: 'player' + (p.alive ? '' : ' dead') + (pickable ? ' pickable' : '') });
    row.append(el('span', { class: 'p-seat', text: '座' + p.seat }));
    row.append(el('span', { class: 'p-name', text: identity?.name ?? p.identityId }));
    // B11：活人席计分制 —— 玩家行显示已获席位数
    const seats = state.liveSeats[p.seat] ?? 0;
    row.append(el('span', { class: 'p-meta', text: (faction?.name ?? p.factionId) + ' · ' + t('{hp}') + ' ' + p.hp + '/' + p.hpMax + ' · ' + t('{resource}') + ' ' + p.resource + ' · 位 ' + p.position + (seats > 0 ? ' · 活人席 ' + String(seats) : '') }));
    if (p.hasMark) { row.append(el('span', { class: 'badge mark', text: '印记' })); }
    // B13：处于对峙的双方加标记
    if (state.duel !== null && (state.duel.seatA === p.seat || state.duel.seatB === p.seat)) {
      row.append(el('span', { class: 'badge duel', text: '对峙' }));
    }
    // B12：观星者窥视到的牌面（`peek_deck` 记在 flags.peeked）
    const peeked = p.flags.peeked as { name: string; color: string }[] | undefined;
    if (peeked !== undefined && Array.isArray(peeked) && peeked.length > 0) {
      const label = peeked.map((c) => c.name + '（' + (c.color === 'red' ? '红' : '黑') + '）').join(' ');
      row.append(el('span', { class: 'badge peek', text: '窥视 ' + label }));
    }
    if (p.pendingCert) { row.append(el('span', { class: 'badge cert', text: '待认证' })); }
    if ((p.exhaustedRounds ?? 0) > 0) { row.append(el('span', { class: 'badge ex', text: '力竭 ' + String(p.exhaustedRounds) })); }
    if (p.equipment.length > 0) {
      row.append(el('span', { class: 'badge eq', text: '装备 ' + p.equipment.length }));
    }
    const st = Object.entries(p.statuses);
    if (st.length > 0) {
      row.append(el('span', { class: 'badge st', text: st.map(([k, v]) => k + String(v ?? 0)).join(' ') }));
    }
    if (onPick !== undefined) {
      if (pickable) { row.setAttribute('data-action-control', 'target-seat:' + String(p.seat)); }
      row.addEventListener('click', () => { onPick(p.seat); });
    }
    list.append(row);
  }
  return list;
}
