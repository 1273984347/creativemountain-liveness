// 日志面板。

import type { State } from '../../engine/core/state.ts';
import { el } from './dom.ts';

/** 渲染最近 N 条日志。 */
export function renderLog(state: State, limit = 40): HTMLElement {
  const box = el('div', { class: 'log' });
  const items = state.log.slice(-limit);
  if (items.length === 0) {
    box.append(el('span', { class: 'muted', text: '（暂无记录）' }));
    return box;
  }
  for (const entry of items) {
    box.append(el('div', { class: 'log-line', text: 'R' + entry.round + '·T' + entry.turnIndex + ' 座' + entry.actor + ' ' + entry.message }));
  }
  return box;
}
