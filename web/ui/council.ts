// 山议投票面板（规格 §5.6）。
//
// 匿名投票：UI **不显示谁投了谁**——只显示各目标的票数。

import type { State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el, button, section } from './dom.ts';

/**
 * 渲染山议面板。
 *
 * `onVote(target)` 投票；`onResolve()` 结算。
 */
export function renderCouncil(
  state: State,
  theme: ThemePack,
  seat: number,
  onVote: (target: number) => void,
  onResolve: () => void,
): HTMLElement {
  const c = state.council;
  const alive = state.players.filter((p) => p.alive);
  const alreadyVoted = c.votes[seat] !== undefined;
  const counts = new Map<number, number>();
  for (const t of Object.values(c.votes)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const body: (Node | string)[] = [];
  if (alreadyVoted) {
    body.push(el('span', { class: 'muted', text: '你已投票，等待其他人。' }));
  } else {
    body.push(el('span', { class: 'muted', text: '选择一名玩家（匿名投票）：' }));
    const row = el('div', { class: 'btn-row' });
    for (const target of alive) {
      if (target.seat === seat) { continue; }
      row.append(button('座' + target.seat, () => { onVote(target.seat); }));
    }
    body.push(row);
  }
  // 票数（不显示投票人）
  const tally = el('div', { class: 'tally' });
  for (const target of alive) {
    const n = counts.get(target.seat) ?? 0;
    tally.append(el('span', { class: 'tally-item', text: '座' + target.seat + '：' + n + ' 票' }));
  }
  body.push(tally);
  if (alive.length === 3) {
    body.push(el('div', { class: 'warn', text: '3 人局：山议不淘汰人，得票最高者扣 2 ' + theme.glossary.resource + '（并列各扣 1）。' }));
  }
  body.push(el('div', { class: 'btn-row' }, button('结算山议', () => { onResolve(); })));
  return section('山议（匿名投票）', ...body);
}
