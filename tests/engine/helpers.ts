// 测试辅助：类型安全的取值。
//
// `noUncheckedIndexedAccess` 下 `players[0]` 的类型是 `Player | undefined`，
// 用 `!` 断言会绕过这道防线；这里用显式的运行时检查，
// 让「索引越界」在测试里变成**清晰的失败信息**而不是类型断言掩盖。

import assert from 'node:assert/strict';

import type { State } from '../../engine/core/state.ts';
import { advanceAuto } from '../../engine/core/advance.ts';
import type { RuleMode } from '../../engine/scales.ts';

/** 取数组第 i 项，越界时抛出可读错误。 */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  assert.ok(v !== undefined, `索引越界：arr[${i}]（长度 ${arr.length}）`);
  return v;
}

/**
 * 推进手番，并**自动解算阻塞**（对峙 + 关隘）。
 *
 * ⚠️ 委托给引擎层的统一出口 `advanceAuto`（`engine/core/advance.ts`）：
 *   对峙（B13）与关隘（B18）都会**阻塞回合推进** ⇒ 各调用方自己复制闭环逻辑
 *   迟早漏一处 ⇒ 机制静默失效（实测：模拟器让玩家免费穿过关隘）。
 */
export function advanceWithDuel(state: State, mode: RuleMode): State {
  return advanceAuto(state, mode);
}
