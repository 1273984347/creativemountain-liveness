// 测试辅助：类型安全的取值。
//
// `noUncheckedIndexedAccess` 下 `players[0]` 的类型是 `Player | undefined`，
// 用 `!` 断言会绕过这道防线；这里用显式的运行时检查，
// 让「索引越界」在测试里变成**清晰的失败信息**而不是类型断言掩盖。

import assert from 'node:assert/strict';

/** 取数组第 i 项，越界时抛出可读错误。 */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  assert.ok(v !== undefined, `索引越界：arr[${i}]（长度 ${arr.length}）`);
  return v;
}
