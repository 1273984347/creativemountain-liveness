// B77 死状态家族的**唯一**读写出处（规格 B77 §4：两个家族、各自单一出处）。
//
// 分工：本文件管「写入侧」（applyStatus / grantImmunity）与「家族 B 结算侧」
//   （tickPlayerStatuses，Task 4 加入）。**力竭（家族 A）不在这里**——它是 round 级
//   计数器，留在 turn-runner 的 endRound（B76 r1.2 定稿，exhaustion.test.ts:196/246 钉着）。
//
// ⚠️ 日志 kind 一律 'status'，message 前缀是**跨任务契约**：模拟器按前缀扫六个计数器
//   （规格 B77 §9 表），测试逐字匹配 ⇒ 改一个字要连规格与扫描侧一起改。
// ⚠️ 同一口径禁止出现第二份实现（E94）：poison 扣血只在 ②、层数衰减只在家族 B、
//   封口弃牌复用 discard_self（首位），都不许在别处再写一遍。
import type { NegativeStatus } from '../types/common.ts';
import { applyEffect } from '../ops/registry.ts';
import { aliveTarget, fail, ok, withLog, withPlayer, type OpContext, type OpResult } from '../ops/context.ts';
import type { State } from './state.ts';

/** `flags` 里免疫窗的键前缀（immunity 寄居 flags 而不迁容器的理由见规格 §3.5）。 */
export const IMMUNITY_FLAG_PREFIX = 'immunity_';

/** 统一日志 kind。 */
const LOG_KIND = 'status';

/** 读层数 / 回合数。旧存档缺字段一律 0（B75 R4 容错惯例）。 */
export function statusOf(state: State, seat: number, kind: NegativeStatus): number {
  return state.players[seat]?.statuses?.[kind] ?? 0;
}

/** 读免疫窗剩余回合数。 */
export function immunityOf(state: State, seat: number, kind: NegativeStatus): number {
  return (state.players[seat]?.flags[IMMUNITY_FLAG_PREFIX + kind] as number | undefined) ?? 0;
}

/** 置「本手番授予过」标记 —— 家族 B 递减豁免的依据（规格 §4 豁免条）。 */
function markGranted(state: State, seat: number): State {
  const p = state.players[seat];
  if (p === undefined) { return state; }
  return withPlayer(state, seat, { turn: { ...p.turn, statusGrantedThisTurn: true } });
}

/**
 * 给 `seat` 加 `amount` 层 / 回合的负面状态。
 *
 * ⚠️ **累加，不是设层**（规格 §3 通用形状）：`poison`/`slow` 加层＝当回合强度，
 *   `silence`/`skip_turn` 加回合＝持续时间。卡面「使其中毒 1 层」的「使其」是累加语气；
 *   设层会让连续两发的第二发毫无意义，也会凭空抹掉「免疫中毒」这类防御牌的价值。
 * ⚠️ 免疫窗**在此拦截**：挡住的是整件「被授予」事件 —— 封口连弃牌一起挡（规格 §3.3），
 *   所以拦截必须写在弃牌之前，否则会出现「毒没中、牌却弃了」。
 */
export function applyStatus(ctx: OpContext, seat: number, kind: NegativeStatus, amount: number): OpResult {
  if (amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
  const t = aliveTarget(ctx, seat);
  if (!t.ok) { return fail(ctx.state, t.note); }
  const state = ctx.state;
  const targetCtx: OpContext = { state, actor: t.seat };
  if (immunityOf(state, t.seat, kind) > 0) {
    // ⚠️ 本模块**唯一**一处「ok=false 但状态有变化」，是对 registry.ts 文件头不变式的有意偏离：
    //   不变式的**意图**是「未生效不得被调用方当成功」（ok=false ⇒ 上游不计奖励），这点守住了；
    //   但拦截若完全不留痕，规格 §9 的 immunity_blocked 计数器就无从产生、§10 判据 3 的
    //   「免疫是否空转」这条硬验收也测不了 ⇒ 只多写一行日志，不动任何数值与状态。
    return fail(withLog(state, targetCtx, LOG_KIND, `被免疫：座位 ${String(t.seat)} 的 ${kind}`), '目标处于免疫窗口内');
  }
  const p = state.players[t.seat]!;
  let next = withPlayer(state, t.seat, { statuses: { ...p.statuses, [kind]: (p.statuses?.[kind] ?? 0) + amount } });
  next = markGranted(next, t.seat);
  next = withLog(next, targetCtx, LOG_KIND, `授予：座位 ${String(t.seat)} 的 ${kind} +${String(amount)}`);
  if (kind === 'silence' && (p.hand.length ?? 0) > 0) {
    // 封口＝弃牌 + 禁言，弃牌是**写入那一刻**的即时代价，不随持续时间重复（规格 §3.3）。
    // 复用 discard_self：它是「弃 N 张」的唯一实现（弃**首位**、进弃牌堆、自带簿记）。
    const dropped = p.hand[0]!;
    const r = applyEffect({ state: next, actor: t.seat }, { op: 'discard_self', count: 1 });
    if (r.ok) {
      next = withLog(r.state, targetCtx, LOG_KIND, `封口弃牌：座位 ${String(t.seat)}（弃 ${dropped.name}）`);
    }
  }
  return ok(next);
}

/** 授予免疫窗（`immunity` 算子的落点）。持续窗、不清已有层数（规格 §3.5）。 */
export function grantImmunity(ctx: OpContext, seat: number, status: NegativeStatus, amount: number): OpResult {
  if (amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
  const t = aliveTarget(ctx, seat);
  if (!t.ok) { return fail(ctx.state, t.note); }
  const p = ctx.state.players[t.seat]!;
  let next = withPlayer(ctx.state, t.seat, {
    flags: { ...p.flags, [IMMUNITY_FLAG_PREFIX + status]: immunityOf(ctx.state, t.seat, status) + amount },
  });
  next = markGranted(next, t.seat);
  return ok(withLog(next, { state: next, actor: t.seat }, LOG_KIND,
    `免疫 ${status} ${String(amount)} 回合：座位 ${String(t.seat)}`));
}
