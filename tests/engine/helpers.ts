// 测试辅助：类型安全的取值。
//
// `noUncheckedIndexedAccess` 下 `players[0]` 的类型是 `Player | undefined`，
// 用 `!` 断言会绕过这道防线；这里用显式的运行时检查，
// 让「索引越界」在测试里变成**清晰的失败信息**而不是类型断言掩盖。

import assert from 'node:assert/strict';

import type { State } from '../../engine/core/state.ts';
import { advanceTurn } from '../../engine/core/turn-runner.ts';
import { autoResolveDuel } from '../../engine/core/duel.ts';
import type { RuleMode } from '../../engine/scales.ts';

/** 取数组第 i 项，越界时抛出可读错误。 */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  assert.ok(v !== undefined, `索引越界：arr[${i}]（长度 ${arr.length}）`);
  return v;
}

/**
 * 推进手番；若结算后进入**对峙** ⇒ 自动选牌并继续推进（B13）。
 *
 * ⚠️ 为什么需要：对峙会**阻塞回合推进**（`advanceTurn` 在对峙未决时直接返回）
 *   ⇒ 任何自己驱动对局的调用方都必须处理对峙，否则对局会在第一次同格相遇时卡死。
 */
export function advanceWithDuel(state: State, mode: RuleMode): State {
  let next = advanceTurn(state, mode);
  if (next.duel !== null) {
    next = autoResolveDuel(next);
    next = advanceTurn(next, mode);
  }
  return next;
}
