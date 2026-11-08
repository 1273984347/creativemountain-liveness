// 棋盘按规模表格数适配（规格 §8 `boardLength`）——**引擎与实体件构建共用**。
//
// ⚠️ 为什么要共用：数字轨（`installTheme`）与实体件（`build/build-print.ts`）必须
//   产出**同一张棋盘**；各写一份 ⇒ 实体件印的棋盘与实际对局不一致（B9 的教训同款）。
//
// ⚠️ 主题包固定 28 格（4 人局），而规模表按人数给出不同格数（3–8 人 = 24/28/32/32/36/36）：
//   若不缩放 ⇒ 3 人局要爬 28 格（规则书写 24）⇒ **兜底触发率飙到 96%**（B9 实测）。
//   缩放规则：截断时保留关隘等关键格位（前段顺序不变），峰顶永远在末格；
//   扩展时新增格位用中性名（避免地名重复）。

import type { Tile } from '../types/theme.ts';
import type { Board } from './board.ts';
import { SCALES } from '../scales.ts';

/**
 * 一版棋盘：**格数** + **适用人数**（由规模表派生，单一事实源）。
 */
export interface BoardVersion {
  /** 棋盘格数（规格 §8 `boardLength`）。 */
  readonly length: number;
  /** 适用人数档（同一格数可能对应多档，如 32 格 = 5–6 人）。 */
  readonly players: readonly number[];
}

/** 规模表里出现的所有棋盘版（按格数升序）。 */
export const BOARD_VERSIONS: readonly BoardVersion[] = [...new Set(SCALES.map((s) => s.boardLength))]
  .sort((a, b) => a - b)
  .map((length) => ({
    length,
    players: SCALES.filter((s) => s.boardLength === length).map((s) => s.players),
  }));

/**
 * 把棋盘**适配到目标格数**（规格 §8 `boardLength`）。
 *
 * @param board 源棋盘（主题包原版或 IR 里的棋盘）
 * @param length 目标格数
 */
export function fitBoard(board: Board, length: number): Board {
  const tiles = board.tiles;
  if (tiles.length === length) {
    return { length, tiles: [...tiles], peakIndex: board.peakIndex };
  }
  const peakTile = tiles[tiles.length - 1];
  const body = tiles.slice(0, -1);
  const out: Tile[] = [];
  for (let i = 0; i < length - 1; i++) {
    const src = body[i % body.length];
    if (src === undefined) {
      continue;
    }
    const isRepeat = i >= body.length;
    out.push({
      ...src,
      index: i + 1,
      ...(isRepeat ? { name: '山道 ' + String(i + 1) } : {}),
    });
  }
  if (peakTile !== undefined) {
    out.push({ ...peakTile, index: length });
  }
  return { length, tiles: out, peakIndex: length };
}
