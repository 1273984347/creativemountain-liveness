// 牌桌视图（规格 §6.6：牌桌视图 + 玩家位置）。

import type { State } from '../../engine/core/state.ts';
import { el } from './dom.ts';

const TILE_CLASS: Record<string, string> = {
  plain: 'tile',
  boon: 'tile boon',
  hazard: 'tile hazard',
  rift: 'tile rift',
  gate: 'tile gate',
  junction: 'tile junction',
  peak: 'tile peak',
};

/** 渲染山道。 */
export function renderBoard(state: State): HTMLElement {
  const wrap = el('div', { class: 'board' });
  for (const tile of state.board.tiles) {
    const cls = TILE_CLASS[tile.kind] ?? 'tile';
    const node = el('div', { class: cls, title: tile.name + '（第 ' + tile.index + ' 格）' });
    node.append(el('span', { class: 'tile-idx', text: String(tile.index) }));
    for (const pl of state.players) {
      if (pl.alive && pl.position === tile.index) {
        node.append(el('span', { class: 'marker', text: String(pl.seat) }));
      }
    }
    if (tile.barrier === true) {
      node.append(el('span', { class: 'barrier', text: '封' }));
    }
    wrap.append(node);
  }
  return wrap;
}
