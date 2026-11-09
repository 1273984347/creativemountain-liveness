// 目标计数器（规格 §6.4 目标判定表的「引擎内建计数器」列）。
//
// ⚠️ **计数器名逐字取自规格**：`gatesPassed` / `cardsDrawn` / `equipsTotal` / `stolenTotal` /
//   `rerollCount` / `vetoCount` / `successfulChallenges` ⇒ 不得自造别名、不得各写一份。
//
// ⚠️ **单一实现**：所有「计数 +1」的写入点都走本模块 ⇒ 否则每个写入点各写一遍「怎么加」，
//   迟早漂移（同一口径两处实现 ⇒ 一处漏了就是静默少算）。
//
// ⚠️ **delta 可为负**：规格 §6.4 要求「成功质疑次数（且该次未被复议推翻）」
//   ⇒ 复议推翻时须把该次质疑成功数**回退** ⇒ 计数写入必须支持减法。

import type { Player, State } from './state.ts';

/**
 * 返回「累加某计数器后」的新 counters 对象（供只需 patch `counters` 字段的写入点使用）。
 *
 * ⚠️ 与 `bumpCounter` **共用同一份「怎么加」的逻辑** ⇒ 不得各写一份
 *   `{ ...p.counters, X: (p.counters.X ?? 0) + 1 }`。
 */
export function counterPatch(player: Player, name: string, delta = 1): Readonly<Record<string, number>> {
  return { ...player.counters, [name]: (player.counters[name] ?? 0) + delta };
}

/** 累加某玩家的计数器，返回新的 Player（不可变）。 */
export function bumpCounter(player: Player, name: string, delta = 1): Player {
  return {
    ...player,
    counters: counterPatch(player, name, delta),
  };
}

/** 累加某座位玩家的计数器，返回新的 State（不可变）；座位不存在时原样返回。 */
export function bumpCounterOf(state: State, seat: number, name: string, delta = 1): State {
  const p = state.players[seat];
  if (p === undefined) { return state; }
  return {
    ...state,
    players: state.players.map((x) => (x.seat === seat ? bumpCounter(x, name, delta) : x)),
  };
}
