// 山道与格位（规格 §3.3）

import type { Tile } from '../types/theme.ts';

/** 棋盘运行时结构。 */
export interface Board {
  readonly length: number;
  readonly tiles: readonly Tile[];
  readonly peakIndex: number;
}

/** 按 index 寻址格位；越界返回 undefined（不抛异常）。 */
export function tileAt(board: Board, index: number): Tile | undefined {
  return board.tiles.find((t) => t.index === index);
}

/** 峰顶格 index。 */
export function peakIndexOf(board: Board): number {
  return board.peakIndex;
}
