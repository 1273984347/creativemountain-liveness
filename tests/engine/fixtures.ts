// 测试局面的唯一来源：全部通过**真实引擎调用**构造，不手拼 certification/council 字段。
//
// ⚠️ 为什么坚持走引擎入口而不是手拼状态：
//   · `enterPendingCertification` 除了置 `pendingCert` / 追加 `pending`，还会应用
//     山主 `certify_free_pass` 免质疑标记——手拼会**静默跳过**这条真实前置；
//   · `advanceCertificationRound` 在 `round === 0` 且有待认证者时正是「开启第 1 轮」
//     的引擎语义（不掷骰、不动局势），用它把 round 从 0 推到 1 无需伪造任何字段。
import assert from 'node:assert/strict';
import { createInitialState, type State } from '../../engine/core/state.ts';
import {
  advanceCertificationRound,
  certifyAppeal,
  certifyAnswer,
  certifyChallenge,
  enterPendingCertification,
} from '../../engine/core/certification.ts';
import { openCouncil } from '../../engine/core/council.ts';

export type SeatCount = 3 | 4 | 5 | 6 | 7 | 8;

/** 初始状态（`deckSize` 与既有测试一致取 40，保证有手牌可打）。 */
export function mk(players = 4, seed = 7): State {
  return createInitialState({ players: players as SeatCount, seed, deckSize: 40 });
}

/** 把指定座位放上峰顶并置为待认证（认证第 1 轮已开启）。 */
export function putPending(s: State, seats: number[]): State {
  // 放上峰顶是 enterPendingCertification 的语义前置（登顶才会触发认证），棋盘坐标可直接置；
  // 待认证状态本身必须走引擎入口（含山主 certify_free_pass 标记的应用）。
  let next: State = {
    ...s,
    players: s.players.map((p) => (seats.includes(p.seat) ? { ...p, position: s.board.peakIndex } : p)),
  };
  for (const seat of seats) {
    const r = enterPendingCertification(next, seat);
    assert.ok(r.ok, `进入待认证必须成功（座 ${seat}）：` + (r.note ?? ''));
    next = r.state;
  }
  // round 0 → 1（第 1 轮尚未开始 → 进行中）走真实引擎调用，不手拼 certification.round。
  const opened = advanceCertificationRound(next);
  assert.ok(opened.ok, '开启第 1 轮认证必须成功：' + (opened.note ?? ''));
  return opened.state;
}

/** 座 0 待认证锁定（行动阶段应无动作）。 */
export function lockedScene(): State { return putPending(mk(), [0]); }

/** 座 0 待认证、认证轮进行中。 */
export function pendingScene(players = 4, seed = 7): State { return putPending(mk(players, seed), [0]); }

/** 座 1 已质疑座 0（获得判定权）。 */
export function challengedScene(players = 4, seed = 7): State {
  const r = certifyChallenge(pendingScene(players, seed), 1, 0);
  assert.ok(r.ok, '发起质疑必须成功，否则后续断言无意义：' + (r.note ?? ''));
  return r.state;
}

/** 座 1 质疑并判座 0 不通过 ⇒ 座 0 付 2 资源后复议已发起。 */
export function appealedScene(players = 5, seed = 7): State {
  const judged = certifyAnswer(challengedScene(players, seed), 1, 0, false).state;
  // certifyAppeal 的前置是 resource >= 2 且 target === actor——先补足灵枢再申请。
  const rich = { ...judged, players: judged.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)) };
  const r = certifyAppeal(rich, 0, 0);
  assert.ok(r.ok, '复议申请必须成功，否则后续断言无意义：' + (r.note ?? ''));
  return r.state;
}

/** 山议进行中。 */
export function councilScene(players = 4, seed = 7): State {
  const r = openCouncil(mk(players, seed));
  assert.ok(r.ok, '开启山议必须成功，否则后续断言无意义：' + (r.note ?? ''));
  return r.state;
}
