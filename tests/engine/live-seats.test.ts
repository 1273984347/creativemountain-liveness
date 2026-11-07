// 活人席计分制（B11 抢先链修正）的行为契约。
//
// 背景：改造前「认证通过 = 本局结束」⇒ 谁先登顶几乎等于谁赢
//   （实测首个登顶者 77.6% 直接获胜，位次胜率极差 12.7pp 且严格单调）。
//   B11 改为**计分制**：认证通过 = 获得 1 个活人席 + 回到山道起点（可再取席），
//   对局打到全局回合上限，按席位数排名。
//
// 本文件钉住：席位发放 / 不终局 / 回山道 / 可再取席 / 双人互验各得 1 席 /
//   席位制终局排名 / 无席位兜底 / 旧档兼容 / 规模表上限契约。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, type State } from '../../engine/core/state.ts';
import {
  enterPendingCertification, advanceCertificationRound, certifySign, certifyMutualSign,
  certificationThreshold,
} from '../../engine/core/certification.ts';
import { resolveVictory, liveSeatCount, rankScore, seatWeight, distanceToPeak } from '../../engine/core/victory.ts';
import { stateToJson, stateFromJson } from '../../engine/core/serialize.ts';
import { getScales } from '../../engine/scales.ts';

/** 让座 seat 进入待认证（已登顶）状态。 */
function pending(state: State, seat: number): State {
  const r = enterPendingCertification(state, seat);
  assert.equal(r.ok, true, '应进入待认证状态');
  return r.state;
}

/** 走完一次完整认证：开启第 1 轮 → 认证人签印到门槛 → 结算。 */
function certifyThrough(state: State, target: number): State {
  const opened = advanceCertificationRound(state);
  assert.equal(opened.ok, true, '应开启第 1 轮认证');
  let st = opened.state;
  const need = certificationThreshold(st, target);
  const certifiers = st.players.filter((p) => p.alive && !st.certification.pending.includes(p.seat));
  for (const c of certifiers.slice(0, need)) {
    const r = certifySign(st, c.seat, target);
    assert.equal(r.ok, true, '认证人签印应成功');
    st = r.state;
  }
  return advanceCertificationRound(st).state;
}

// ---------- 席位发放 ----------

test('B11：认证达标 = 获得 1 个活人席，且**不结束本局**', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const onPeak = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, position: s.board.peakIndex } : p)) };
  const st = certifyThrough(pending(onPeak, 0), 0);
  assert.equal(liveSeatCount(st, 0), 1, '达标者应获得 1 个活人席');
  assert.equal(st.outcome.finished, false, '封顶**不再**结束本局');
  assert.equal(st.outcome.winners.length, 0, '尚无胜者');
});

test('B11：封顶后回到山道起点并解除待认证锁定（可再次登顶）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const onPeak = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, position: s.board.peakIndex } : p)) };
  const st = certifyThrough(pending(onPeak, 0), 0);
  assert.equal(st.players[0]?.position, 0, '应回到山道起点');
  assert.equal(st.players[0]?.pendingCert, false, '待认证锁定应解除');
});

test('B11：同一玩家可再次登顶再取席（席位累加）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const first = certifyThrough(pending(s, 0), 0);
  assert.equal(liveSeatCount(first, 0), 1);
  // 回山道后重新爬到峰顶，再次认证
  const again = { ...first, players: first.players.map((p) => (p.seat === 0 ? { ...p, position: first.board.peakIndex } : p)) };
  const second = certifyThrough(pending(again, 0), 0);
  assert.equal(liveSeatCount(second, 0), 2, '第二次封顶应累计为 2 席');
});

test('B11：双人互验同时达标 ⇒ 两人**各得 1 席**，不结束本局', () => {
  const s = createInitialState({ players: 5, seed: 9, deckSize: 40 });
  let st = pending(s, 0);
  st = pending(st, 1);
  const opened = advanceCertificationRound(st);
  st = opened.state;
  assert.equal(certificationThreshold(st, 0), 1, '双人同时待认证 ⇒ 门槛降为 1');
  const a = certifyMutualSign(st, 0, 1);
  assert.equal(a.ok, true);
  st = a.state;
  const b = certifyMutualSign(st, 1, 0);
  assert.equal(b.ok, true);
  st = b.state;
  const done = advanceCertificationRound(st);
  st = done.state;
  assert.equal(liveSeatCount(st, 0), 1, '座 0 应得 1 席');
  assert.equal(liveSeatCount(st, 1), 1, '座 1 应得 1 席');
  assert.equal(st.outcome.finished, false, '双人互验达标不结束本局');
});

// ---------- 席位制终局 ----------

test('B11：达到回合上限 ⇒ 席位制结算，席位数最多者胜（reason=seats）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const over = { ...s, round: s.scales.globalRoundLimit + 1, liveSeats: { 2: 2, 0: 1, 3: 1 } };
  const res = resolveVictory(over);
  assert.equal(res.outcome.finished, true);
  assert.equal(res.outcome.reason, 'seats');
  assert.deepEqual(res.outcome.winners, [2], '席位数最多者胜');
});

test('B11：席位数相同 ⇒ 按距峰顶更近者胜', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const over = {
    ...s,
    round: s.scales.globalRoundLimit + 1,
    liveSeats: { 0: 1, 1: 1 },
    players: s.players.map((p) => (p.seat === 1
      ? { ...p, position: s.board.peakIndex - 1 }
      : p.seat === 0 ? { ...p, position: 2 } : p)),
  };
  const res = resolveVictory(over);
  assert.deepEqual(res.outcome.winners, [1], '距离更近者胜');
});

test('B11：无人取得任何席位 ⇒ reason=fallback（纯距离排名）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const over = { ...s, round: s.scales.globalRoundLimit + 1, liveSeats: {} };
  const res = resolveVictory(over);
  assert.equal(res.outcome.reason, 'fallback');
  assert.ok(res.outcome.winners.length >= 1);
});

// ---------- 终局得分公式 ----------

test('B11：终局得分 = 席位数 × 活人席权重 − 距峰顶格数（一席抵得上爬半座山）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const w = seatWeight(s);
  assert.equal(w, s.scales.seatWeight, '权重来自规模表（逐档标定）');
  assert.ok(w < s.board.length, '席位权重必须小于山道长度，否则席位成绝对优势、先到者再次独占');
  const withSeat = { ...s, liveSeats: { 1: 1 } };
  assert.equal(rankScore(withSeat, 1), w - distanceToPeak(withSeat, 1));
});

test('B11：各档席位权重均小于山道长度（否则先到者独占，位次极差反弹到 13pp）', () => {
  for (const players of [3, 4, 5, 6, 7, 8] as const) {
    const row = getScales(players);
    assert.ok(row.seatWeight > 0, `${players} 人局席位权重应为正`);
    assert.ok(row.seatWeight < row.boardLength, `${players} 人局席位权重 ${row.seatWeight} 必须小于山道长度 ${row.boardLength}`);
  }
});

test('B11：位置可以抵消席位（1 席但位置差 ⇒ 输给 0 席但位置近）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  // 座 0：1 席但在山脚；座 1：0 席但已爬到峰顶前一格
  const st: State = {
    ...s,
    liveSeats: { 0: 1 },
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, position: 0 }
      : p.seat === 1 ? { ...p, position: s.board.peakIndex - 1 } : p)),
  };
  assert.ok(rankScore(st, 1) > rankScore(st, 0), '位置更近者的得分应更高');
  const over = { ...st, round: s.scales.globalRoundLimit + 1 };
  const res = resolveVictory(over);
  assert.deepEqual(res.outcome.winners, [1], '位置更近者胜（席位优势被位置补偿抵消）');
});

// ---------- 兼容与规模契约 ----------

test('B11：旧档（缺 liveSeats）按空表补齐', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const data = JSON.parse(stateToJson(s)) as { state: Record<string, unknown> };
  delete data.state.liveSeats;
  const back = stateFromJson(JSON.stringify(data));
  assert.deepEqual(back.liveSeats, {});
});

test('B11：全局回合上限 = 8 + 人数（席位制下对局必然打满，故下调）', () => {
  for (const players of [3, 4, 5, 6, 7, 8] as const) {
    assert.equal(getScales(players).globalRoundLimit, players + 8, `${players} 人局上限应为 ${players + 8}`);
  }
});
