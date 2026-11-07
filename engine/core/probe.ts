// 试跑基础设施（规格 §7 落地）。
//
// ⚠️ 为什么不能拿原 state 直接试跑：`State.rng` 是**可变类实例**
//   （`Rng.next()` 写内部 `s`；`readonly rng` 只锁引用、不锁内容）
//   ⇒ 直接试跑会推进随机源、改变对局轨迹，毁掉第 ⑨ 门与 balance-report 的固定 seed 复现。

import { Rng } from './dice.ts';
import type { State } from './state.ts';

/** 换一个全新随机源的状态副本；起点与 `state` 相同，但推进只影响副本。 */
export function isolatedState(state: State): State {
  return { ...state, rng: Rng.fromSnapshot(state.rng.initialSeed, state.rng.snapshot()) };
}
