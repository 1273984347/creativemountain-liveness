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
import { triggerExhaustion } from './exhaustion.ts';
import { aliveTarget, fail, ok, withLog, withPlayer, type OpContext, type OpResult } from '../ops/context.ts';
import type { Player, State } from './state.ts';

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

/**
 * 摘掉 flags 里所有 `immunity_` 前缀键（放逐侧收口用，规格 §4 附带项）。
 *
 * ⚠️ 只摘免疫窗：其余 flag（`gate_<格号>` 已通过、`canVeto` 否决权、`goal` 目标态…）是
 *   **历史事实**，B60 的口径是「达成过不会被之后的放逐抹掉」⇒ 一律保留。
 * 前缀知识只在 statuses.ts 里存在一份 ⇒ 这个函数由 `council.ts` 调用，而不是让放逐侧
 * 自己重抄 `'immunity_'` 字面量（同一口径两份实现必漂移，E94）。
 */
export function withoutImmunityFlags(flags: Player['flags']): Player['flags'] {
  return Object.fromEntries(Object.entries(flags).filter(([k]) => !k.startsWith(IMMUNITY_FLAG_PREFIX)));
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

/** 家族 B 的衰减对象（③④⑤：poison 的衰减在 ② 内联处理，扣完血才减）。 */
const DECAY_ORDER: readonly NegativeStatus[] = ['slow', 'silence', 'skip_turn'];
/** 免疫窗的衰减对象（⑥：四类都可能被免疫，逐个查窗）。 */
const IMMUNITY_TICK: readonly NegativeStatus[] = ['poison', 'slow', 'silence', 'skip_turn'];

/** 某状态 −1（下限 0）。不写日志——衰减本身由 ② 的扣血日志代表，避免噪声翻倍。 */
function decStatus(state: State, seat: number, kind: NegativeStatus): State {
  const p = state.players[seat]!;
  return withPlayer(state, seat, { statuses: { ...p.statuses, [kind]: Math.max(0, (p.statuses?.[kind] ?? 0) - 1) } });
}

/**
 * 家族 B 的**唯一**结算处（规格 B77 §4：② poison 扣血 → ③④⑤ 衰减 → ⑥ 免疫衰减）。
 *
 * ⚠️ 为什么锚在**该玩家自己的手番末**而不是 round 末：每人每 round 恰好一个手番
 *   （`round.ts:17-27` 的 `aliveOrder[turnIndex % len]` + `isRoundEnd` 的 `turnIndex >= aliveCount`），
 *   而 skip/silence/immunity 的写入点全在该玩家自己 手番内 ⇒ round 末递减会在其下次行动
 *   **之前**把状态抹平（「停 1 回合」停不到、禁言永不生效、免疫窗恒为 0）。
 *   力竭是**另一回事**：它是 round 级计数器，留在 `endRound` 不动（B76 r1.2 定稿）。
 * ⚠️ 死者（`alive === false`，唯一通道 = 放逐）整体跳过：不扣血、不衰减、不写日志（B76 I2）。
 *   写入侧的对应收口在 `council.ts` 的放逐分支——两侧都要有。
 *
 * @param seat 刚结束手番的那个座位（**不是**全场循环）。
 */
export function tickPlayerStatuses(state: State, seat: number): State {
  const p0 = state.players[seat];
  if (p0 === undefined || !p0.alive) { return state; }
  const granted = p0.turn.statusGrantedThisTurn === true;
  let next = state;

  // ② poison：先按层数扣血（clamp 0）⇒ 归零走 triggerExhaustion（家族 A 的入口）⇒ 再 −1 层。
  const layers = statusOf(next, seat, 'poison');
  if (layers > 0) {
    const p = next.players[seat]!;
    const hp = Math.max(0, p.hp - layers);
    next = withPlayer(next, seat, { hp });
    next = withLog(next, { state: next, actor: seat }, LOG_KIND,
      `中毒扣血：座位 ${String(seat)}（-${String(layers)}）`);
    // 力竭的置值与日志一律交给 exhaustion.ts —— 本模块不碰 exhaustedRounds（E94）。
    if (hp === 0) { next = triggerExhaustion(next, seat); }
    next = decStatus(next, seat, 'poison');
  }

  // ③–⑥：授予当回合整体豁免（不吃刚挂上的那一拍），段末无条件自清标记。
  if (!granted) {
    for (const kind of DECAY_ORDER) {
      if (statusOf(next, seat, kind) > 0) { next = decStatus(next, seat, kind); }
    }
    for (const kind of IMMUNITY_TICK) {
      const left = immunityOf(next, seat, kind);
      if (left > 0) {
        const q = next.players[seat]!;
        next = withPlayer(next, seat, { flags: { ...q.flags, [IMMUNITY_FLAG_PREFIX + kind]: left - 1 } });
      }
    }
  }
  const last = next.players[seat]!;
  return withPlayer(next, seat, { turn: { ...last.turn, statusGrantedThisTurn: false } });
}
