// 回合推进的**统一出口**（供 AI / 脚本 / 测试 / 教学演示等自行驱动对局的调用方）。
//
// ⚠️ 为什么必须有这个出口：本作有两种**会阻塞回合推进**的机制——
//   · **对峙**（B13）：`advanceTurn` 在对峙未决时直接返回；
//   · **关隘**（B18）：停在未通过的关隘格上时同样直接返回（等玩家选通道）。
//   ⇒ 任何自己驱动对局的调用方不处理它，就会**静默卡死**或**绕过关隘**。
//     实测（B18）：模拟器「异常 0 条」却让玩家**免费穿过关隘**——
//     因为 AI 在关隘格上反复行棋直到离开，而引擎当时并不禁止其它行动。
//
// ⇒ 本模块把「解算阻塞后再推进」收成**一个函数**，调用方不再各自复制闭环逻辑
//   （复制 ⇒ 迟早漏一处 ⇒ 机制静默失效）。

import type { State } from './state.ts';
import type { RuleMode } from '../scales.ts';
import { advanceTurn } from './turn-runner.ts';
import { autoResolveDuel } from './duel.ts';
import { autoResolveGate, pendingGate } from './gate.ts';
import { autoResolveBarrier, pendingBarrier } from './barrier.ts';
import { currentPlayer } from './round.ts';

/**
 * 推进手番，并**自动解算阻塞**（对峙 → 关隘），返回可继续驱动的状态。
 *
 * ⚠️ **人类玩家不该用这个**：关隘的通道选择是玩家决策（UI 应给按钮），
 *   本函数替玩家选了「灵枢够就付费、否则走试炼」。
 */
export function advanceAuto(state: State, mode: RuleMode): State {
  let next = advanceTurn(state, mode);
  // ---- 对峙闭环（B13）----
  if (next.duel !== null) {
    next = autoResolveDuel(next);
    next = advanceTurn(next, mode);
  }
  // ---- 关隘闭环（B18）----
  const seat = currentPlayer(next);
  if (seat >= 0 && pendingGate(next, seat) !== null) {
    next = autoResolveGate(next, seat);
    next = advanceTurn(next, mode);
  }
  // ---- 裂隙闭环（B18-b）----
  const seat2 = currentPlayer(next);
  if (seat2 >= 0 && pendingBarrier(next, seat2) !== null) {
    next = autoResolveBarrier(next, seat2);
    next = advanceTurn(next, mode);
  }
  return next;
}
