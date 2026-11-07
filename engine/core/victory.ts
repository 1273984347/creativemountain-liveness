// 胜负判定（规格 §5.7 胜利判定 / §5.8 全局回合上限与终局得分）

// ⚠️ B11 活人席计分制：**封顶不再终局**。
//   认证通过 ⇒ 获得 1 个活人席并回到山道起点（见 certification.ts 的 advanceCertificationRound），
//   对局持续到**全局回合上限**，此时按**终局得分**排名结算。

// **终局得分 = 活人席数 × ⌈山道长度 ÷ 2⌉ − 距峰顶格数**（B11 裁定）
//   ——「**一个活人席抵得上爬半座山**」。
//
// 为什么不是「只比席位数」（实测证据）：
//   · 只比席位数 ⇒ 位次胜率极差 **13.0pp**（与改造前持平，不达标）：
//     先登顶者结构性地**独占**唯一席位，后来者要拿 2 席才能超越，而局内几乎拿不到 2 席。
//   · 只比距峰顶 ⇒ 极差 **5.7pp** 且方向翻转（后手占优）：封顶者回山道起点 ⇒ 先到者位置差。
//   · 加位置补偿（席位权重 < 山道长度）⇒ 极差 **1.1–3.5pp**（3/5/8 人局）达标。
//   机制：「拿 1 席但位置差」会输给「0 席但位置近」⇒ 先到者的领先**可被位置补偿抵消**。

import type { State } from './state.ts';

/** 距峰顶的格数（越小越前）。 */
export function distanceToPeak(state: State, seat: number): number {
  const pos = state.players[seat]?.position ?? 0;
  return Math.max(0, state.board.peakIndex - pos);
}

/** 该玩家已获得的活人席数（B11）。 */
export function liveSeatCount(state: State, seat: number): number {
  return state.liveSeats[seat] ?? 0;
}

/**
 * 一个活人席值多少格距离：**规模表的 `seatWeight`**（B11 裁定，逐档标定）。
 *
 * ⚠️ 该权重**必须小于山道长度** —— 否则席位变成绝对优势，先到者再次独占，
 *   实测位次胜率极差会从 1–3pp 反弹到 13pp（见文件头注释）。
 */
export function seatWeight(state: State): number {
  return state.scales.seatWeight;
}

/**
 * 本局**累计**获得的签印数（B11）。
 *
 * ⚠️ 不能用 `certification.signatures` —— 那是**本轮**签印数，每轮清零；
 *   整局累计值记在 `player.counters.signaturesTotal`（签印时 +1）。
 */
export function totalSignatureCount(state: State, seat: number): number {
  return state.players[seat]?.counters.signaturesTotal ?? 0;
}

/** 终局得分：席位数 × 席位权重 − 距峰顶格数（分数越高越好）。 */
export function rankScore(state: State, seat: number): number {
  return liveSeatCount(state, seat) * seatWeight(state) - distanceToPeak(state, seat);
}

/**
 * 排名比较（§5.8）：**终局得分降序 → 累计签印降序 → 灵枢降序**。
 * 返回负数表示 a 排在 b 之前（更优）。
 */
export function compareRank(state: State, a: number, b: number): number {
  const scoreDiff = rankScore(state, b) - rankScore(state, a);
  if (scoreDiff !== 0) { return scoreDiff; }
  const ca = totalSignatureCount(state, a);
  const cb = totalSignatureCount(state, b);
  if (ca !== cb) { return cb - ca; }
  const ra = state.players[a]?.resource ?? 0;
  const rb = state.players[b]?.resource ?? 0;
  return rb - ra;
}

/**
 * 终局排名（§5.8）：返回**并列第一**的座位号列表。
 *
 * 同分判据三项：终局得分 / 累计签印数 / 灵枢 —— 全同者判为**并列胜出**。
 */
export function fallbackRanking(state: State): readonly number[] {
  const alive = state.players.filter((p) => p.alive).map((p) => p.seat);
  if (alive.length === 0) { return []; }
  const sorted = [...alive].sort((a, b) => compareRank(state, a, b));
  const first = sorted[0];
  if (first === undefined) { return []; }
  const tied = (seat: number): boolean =>
    rankScore(state, seat) === rankScore(state, first)
    && totalSignatureCount(state, seat) === totalSignatureCount(state, first)
    && (state.players[seat]?.resource ?? 0) === (state.players[first]?.resource ?? 0);
  return sorted.filter((seat) => tied(seat));
}

/**
 * 终局判定（§5.7 + §5.8）
 *
 * - 场上仅剩 ≤1 人 → `no_winner`（活人缺席）。
 * - 达到全局回合上限 → **席位制结算**：
 *   · 有人取得过席位 ⇒ `seats`；
 *   · **无人**取得席位 ⇒ `fallback`（席位项全体为 0，实质是纯距离排名）。
 *   胜者 = 终局得分最高者（并列则并列胜出）。
 */
export function resolveVictory(state: State): State {
  if (state.outcome.finished) { return state; }
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    return { ...state, phase: '终局', outcome: { finished: true, winners: [], reason: 'no_winner' } };
  }
  if (state.round > state.scales.globalRoundLimit) {
    const totalSeats = Object.values(state.liveSeats).reduce((a, b) => a + b, 0);
    const winners = fallbackRanking(state);
    return {
      ...state,
      phase: '终局',
      outcome: { finished: true, winners, reason: totalSeats > 0 ? 'seats' : 'fallback' },
    };
  }
  return state;
}
