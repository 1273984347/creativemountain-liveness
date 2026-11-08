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
 * 目标格数对应的**关隘数**（由规模表 `gateCount` 派生）。
 *
 * ⚠️ 取同格数各人数档的**最小值**（保守：关隘多了会让高人数档更难、且与规模表口径不符）。
 */
export function gateCountFor(length: number): number {
  const rows = SCALES.filter((s) => s.boardLength === length);
  if (rows.length === 0) { return 0; }
  return Math.min(...rows.map((r) => r.gateCount));
}

/**
 * 把棋盘**适配到目标格数**（规格 §8 `boardLength`）。
 *
 * ⚠️ **关隘数同时按规模表 `gateCount` 收口**（B21）：主题包提供**足够的关隘**（36 格底板里 4 座，
 *   位于 6 / 14 / 22 / 30），适配时**只保留前 N 座**（N = 该档 gateCount），其余关隘**降级为普通格**
 *   （名字中性化）⇒ 于是 24 / 28 / 32 / 36 格分别对应 **2 / 3 / 3 / 4 座**关隘，与规模表一致。
 *
 * @param board 源棋盘（主题包原版或 IR 里的棋盘）
 * @param length 目标格数
 */
export function fitBoard(board: Board, length: number): Board {
  const tiles = board.tiles;
  const peakTile = tiles[tiles.length - 1];
  const body = tiles.slice(0, -1);
  const gateBudget = gateCountFor(length);
  const out: Tile[] = [];
  let gates = gateBudget;
  for (const t of body) {
    if (out.length >= length - 1) { break; }
    if (t.kind === 'gate') {
      if (gates > 0) {
        gates -= 1;
        out.push(t);
      } else {
        // 超出本档关隘数 ⇒ **降级为普通格**（名字中性化，避免玩家误认）。
        out.push({ ...t, kind: 'plain', name: '第 ' + String(t.index) + ' 段' });
      }
      continue;
    }
    out.push(t);
  }
  // 补足普通格（扩展时用中性名，避免地名重复）。
  for (let i = out.length + 1; i < length; i++) {
    out.push({ index: i, kind: 'plain', name: '第 ' + String(i) + ' 段' });
  }
  if (peakTile !== undefined) {
    out.push({ ...peakTile, index: length });
  }
  return { length, tiles: out, peakIndex: length };
}
