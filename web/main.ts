// 数字轨入口（规格 §6.6）。
//
// B1 只做骨架：渲染空白棋盘 + 玩家位置 + 当前 round/手番。
// 完整牌桌 UI、认证面板、教学演示在 B5 接入。

import { createInitialState } from '../engine/core/state.ts';
import { currentPlayer, isRoundEnd } from '../engine/core/round.ts';
import { getScales } from '../engine/scales.ts';

const root = document.getElementById('app');

function render(): void {
  if (root === null) {
    return;
  }
  const state = createInitialState({ players: 3, seed: 42, deckSize: 40 });
  const scales = getScales(3);

  const tiles = state.board.tiles
    .map((t) => {
      const cls = t.kind === 'peak' ? 'tile peak' : 'tile';
      const occupants = state.players
        .filter((p) => p.alive && p.position === t.index)
        .map((p) => '<span class="marker">' + p.seat + '</span>')
        .join('');
      return '<div class="' + cls + '" title="' + t.name + '">' + t.index + occupants + '</div>';
    })
    .join('');

  const meta = [
    'round <code>' + state.round + '</code> / 上限 <code>' + scales.globalRoundLimit + '</code>',
    'turnIndex <code>' + state.turnIndex + '</code>',
    '当前玩家 <code>' + currentPlayer(state) + '</code>',
    'round 末 <code>' + (isRoundEnd(state) ? '是' : '否') + '</code>',
    '山道 <code>' + state.board.length + '</code> 格，峰顶 <code>' + state.board.peakIndex + '</code>',
    '签印门槛 N=<code>' + scales.threshold + '</code>',
  ].join(' · ');

  root.innerHTML =
    '<h1>创界山·活人认证 — 引擎骨架（B1）</h1>' +
    '<div class="board">' + tiles + '</div>' +
    '<div class="meta">' + meta + '</div>';
}

render();
