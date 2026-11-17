// B76 力竭：触发与解除的**唯一实现**。
//
// ⚠️ 四个调用点共用本模块（damage op / 险径黑牌 / endRound 自然恢复 / RECUPERATE 自恢救援）
//   ——同一口径两份实现必漂移（E94）。
// ⚠️ 日志 kind 统一 `exhaustion`：模拟器报告的四计数器（exhaustedTotal /
//   recuperateSelf / recuperateRescue / naturalRecovery）按 message 前缀扫描本日志
//   （「力竭：」= 触发；「解除力竭：…（<cause>）」= 解除），格式是跨任务契约，不得微调。
import type { State } from './state.ts';

/** 日志条目（与 turn-runner 的内联日志同形状）。 */
function logEntry(state: State, seat: number, message: string): State['log'][number] {
  return { round: state.round, turnIndex: state.turnIndex, actor: seat, kind: 'exhaustion', message };
}

/**
 * HP 归零 ⇒ 力竭（置 `exhaustedRounds = 2`）。
 *
 * ⚠️ 已力竭者**不刷新**（不叠加、不清零重计、不发新日志）——规格 §2。
 * ⚠️ hp 由调用方归零后调用；本函数不动 hp、不动 alive（打空不再是出局——放逐是唯一出局通道）。
 */
export function triggerExhaustion(state: State, seat: number): State {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return state; }
  if ((p.exhaustedRounds ?? 0) > 0) { return state; }
  return {
    ...state,
    players: state.players.map((x) => (x.seat === seat ? { ...x, exhaustedRounds: 2 } : x)),
    // B79 §2.4：「体力」是四套都不用的兜底词（hp 词是 灵力/气血/机体完整度/精神值），
    //   与 §3.2 拆掉的 `hp ?? '体力'` 同源 ⇒ 走占位符，由出口按本主题展开。
    //   ⚠️ 前缀「力竭：」是仿真的计数键（规格 §1），只有括注内部随主题走。
    log: [...state.log, logEntry(state, seat, '力竭：座位 ' + String(seat) + '（{hp}归零）')],
  };
}

/**
 * 解除力竭：`exhaustedRounds = 0`，hp = **max(当前 hp, ceil(hpMax / 2))**（保底、不倒扣——
 * 力竭期间被 heal 抬回来的血不白给；同时不是满血 ⇒ 无免费回血循环）。
 */
export function recoverFromExhaustion(state: State, seat: number, cause: '自然' | '自恢' | '救援'): State {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return state; }   // ⚠️ 最终审查 I2：死者不恢复、不回血、不生日志（清零是放逐侧职责）
  const hp = Math.max(p.hp, Math.ceil(p.hpMax / 2));
  return {
    ...state,
    players: state.players.map((x) => (x.seat === seat ? { ...x, exhaustedRounds: 0, hp } : x)),
    log: [...state.log, logEntry(state, seat, '解除力竭：座位 ' + String(seat) + '（' + cause + '）')],
  };
}
