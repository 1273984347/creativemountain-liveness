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
import { autoResolveGate, pendingGate, resolveCompareGate } from './gate.ts';
import { autoResolveBarrier, pendingBarrier } from './barrier.ts';
import { currentPlayer } from './round.ts';

/**
 * 推进手番，并**自动解算阻塞**（对峙 → 关隘），返回可继续驱动的状态。
 *
 * ⚠️ **人类玩家不该用这个**：关隘的通道选择是玩家决策（UI 应给按钮），
 *   本函数替玩家选了「灵枢够就付费、否则走试炼」。
 */
/**
 * @param opts 可选覆盖：`gateReserve` = 关隘付费的余量门槛（默认 `GATE_RESOURCE_RESERVE`）。
 *   ⚠️ 可注入 ⇒ 余量阈值的**多值扫描**能走生产同一条代码路径（不另写模拟器副本）。
 */
export function advanceAuto(state: State, mode: RuleMode, opts?: { readonly gateReserve?: number }): State {
  let next = advanceTurn(state, mode);
  // ---- 对峙闭环（B13）----
  if (next.duel !== null) {
    next = autoResolveDuel(next);
    next = advanceTurn(next, mode);
  }
  // ---- 关隘闭环（B18）----
  const seat = currentPlayer(next);
  // ---- 关隘通道（AI 策略，**顺序即强度**）----
  // ⚠️ B19 平衡修正：AI 若**总是**先比牌（胜则免灵枢过关）⇒ 资源经济被改写 ⇒
  //   位次胜率极差从 <4pp 反弹到 **5.5pp**（实测，门 ② 平衡回归判红）。
  // ⇒ 改为：**付费优先**（灵枢够就付费）→ **付费不可用时**才比牌 → 最后试炼兜底。
  //   这样比对通道仍**可达**（不是死机制），但只在「付不起」时影响对局。
  if (seat >= 0 && pendingGate(next, seat) !== null) {
    const me = next.players[seat];
    const fee = next.board.tiles.find((t) => t.index === me?.position)?.gate?.fee ?? 0;
    // ⚠️ B24：**比牌门槛仍是「完全付不起」**（B19 口径：比对通道只在付费通道不可用时才影响对局
    //   ⇒ 位次胜率极差不反弹）；B24 只把「付费」的门槛抬高为「付费后仍有余量」。
    // ⚠️ 但**已改为付费**的关隘只剩付费通道 ⇒ 此时不得比牌（否则绕过粗筛的既定口径）。
    const fallback = me?.flags[`gate_pay_${String(me?.position)}`] === true;
    const canPay = (me?.resource ?? 0) >= fee;
    if (!canPay && !fallback) {
      const foe = next.players.filter((p) => p.alive && p.seat !== seat).sort((a, b) => b.position - a.position)[0];
      const best = [...(me?.hand ?? [])].sort((a, b) => b.rank - a.rank)[0];
      if (foe !== undefined && best !== undefined) {
        const r = resolveCompareGate(next, seat, best.id, foe.seat);
        if (r.ok) { next = r.state; }
      }
    }
  }
  // ---- 关隘付费 / 试炼通道（付费优先：灵枢够就付费，否则试炼）----
  const seatPay = currentPlayer(next);
  if (seatPay >= 0 && pendingGate(next, seatPay) !== null) {
    next = autoResolveGate(next, seatPay, opts?.gateReserve);
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
