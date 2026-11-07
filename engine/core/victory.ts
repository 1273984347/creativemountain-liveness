// 胜负判定（规格 §5.7 胜利判定 / §5.8 全局回合上限与兜底排名）

import type { State } from './state.ts';
import { signatureCount } from './certification.ts';

/** 距峰顶的格数（越小越前）。 */
export function distanceToPeak(state: State, seat: number): number {
  const pos = state.players[seat]?.position ?? 0;
  return Math.max(0, state.board.peakIndex - pos);
}

/**
 * 兜底排名（§5.8）。
 *
 * 排序优先级：
 * 1. **距峰顶格数**少者胜（越接近峰顶越前）；
 * 2. 若相同 → **已获签印数**多者胜；
 * 3. 若仍相同 → **灵枢**多者胜；
 * 4. 完全相同 → **并列胜出**。
 */
export function fallbackRanking(state: State): readonly number[] {
  const alive = state.players.filter((p) => p.alive).map((p) => p.seat);
  if (alive.length === 0) { return []; }
  const sorted = [...alive].sort((a, b) => {
    const d = distanceToPeak(state, a) - distanceToPeak(state, b);
    if (d !== 0) { return d; }
    const s = signatureCount(state, b) - signatureCount(state, a);
    if (s !== 0) { return s; }
    const r = (state.players[b]?.resource ?? 0) - (state.players[a]?.resource ?? 0);
    return r;
  });
  const first = sorted[0];
  if (first === undefined) { return []; }
  // 与第一名完全同分者并列
  const key = (seat: number): string => [
    distanceToPeak(state, seat),
    signatureCount(state, seat),
    -(state.players[seat]?.resource ?? 0),
  ].join('|');
  const topKey = key(first);
  return sorted.filter((seat) => key(seat) === topKey);
}

/**
 * 终局判定（§5.7 + §5.8）。
 *
 * - 已有人封顶（认证达成）→ 结束，`reason = 'certified'`。
 * - 达到全局回合上限仍无人封顶 → 按兜底排名，`reason = 'fallback'`，并**显式播报**。
 * - 场上仅剩 1 人 → `reason = 'no_winner'`（活人缺席）。
 */
export function resolveVictory(state: State): State {
  if (state.outcome.finished) { return state; }
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    return { ...state, phase: '终局', outcome: { finished: true, winners: [], reason: 'no_winner' } };
  }
  if (state.round > state.scales.globalRoundLimit) {
    // 达到回合上限 → 兜底排名
    const winners = fallbackRanking(state);
    return {
      ...state,
      phase: '终局',
      outcome: { finished: true, winners, reason: 'fallback' },
    };
  }
  return state;
}
