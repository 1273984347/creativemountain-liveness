// B3 核心玩法闭环的行为契约（规格 §5 活人认证 / §5.6 山议 / §5.7–5.8 胜负）

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, type State } from '../../engine/core/state.ts';
import {
  advanceCertificationRound,
  certificationThreshold,
  certifyAbstain,
  certifyAnswer,
  certifyAppeal,
  certifyChallenge,
  certifySign,
  enterPendingCertification,
  signatureCount,
} from '../../engine/core/certification.ts';
import { castVote, openCouncil, resolveCouncil, topVoted } from '../../engine/core/council.ts';
import { fallbackRanking, resolveVictory } from '../../engine/core/victory.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { at } from './helpers.ts';
import { mk, putPending } from './fixtures.ts';

/**
 * 造一个「N 人待认证（第 1 轮进行中）」的局面。
 *
 * ⚠️ B15 收敛：原先这里**手拼** `certification: { ...s.certification, round: 1, pending }`
 *   ＋直接置 `pendingCert`——正是 `tests/engine/fixtures.ts` 文件头明令禁止的写法
 *   （跳过 `enterPendingCertification` 的山主 `certify_free_pass` 前置，也绕开
 *   `advanceCertificationRound` 的 round-0「开启第 1 轮」语义）。
 *   现在薄薄一层委托给共享 builder（真实引擎入口构造），**断言一字未改**。
 */
function pendingScene(playerCount: number, pendingSeats: number[] = [0]): State {
  return putPending(mk(playerCount), pendingSeats);
}

// ---------- §5.2 门槛公式 ----------

test('§5.2 步骤 1：门槛 = min(N, 存活人数 - 1)', () => {
  const s = pendingScene(5);
  assert.equal(certificationThreshold(s, 0), 3, '5 人局 N=3，存活 5 → min(3,4)=3');
});

test('§5.2 步骤 2：持印记 → 门槛减半（向上取整）', () => {
  const s = pendingScene(5);
  const withMark = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hasMark: true } : p)) };
  assert.equal(certificationThreshold(withMark, 0), 2, 'ceil(3/2)=2');
});

test('§5.2 步骤 0 前置分支：双人同时待认证 → 门槛 = 1，且不走印记减半', () => {
  const s = pendingScene(4, [0, 1]);
  assert.equal(certificationThreshold(s, 0), 1);
  const withMark = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hasMark: true } : p)) };
  assert.equal(certificationThreshold(withMark, 0), 1, '双人互验时印记不得使其再降');
});

test('§5.2 门槛最低为 1（不允许 0 门槛）', () => {
  const s = pendingScene(3);
  assert.ok(certificationThreshold(s, 0) >= 1);
});

// ---------- §5.3 签印 / 质疑 / 成本对称 ----------

test('§5.3 签印贡献 1 枚签印', () => {
  const s = pendingScene(5);
  const r = certifySign(s, 1, 0);
  assert.equal(r.ok, true);
  assert.equal(signatureCount(r.state, 0), 1);
});

test('§5.3 一轮内同一认证人只能用一次机会', () => {
  const s = pendingScene(5);
  const signed = certifySign(s, 1, 0);
  assert.equal(signed.ok, true);
  const again = certifySign(signed.state, 1, 0);
  assert.equal(again.ok, false, '同轮不得重复');
  assert.equal(again.state, signed.state);
});

test('§5.3 弃权合法且不产生签印', () => {
  const s = pendingScene(5);
  const r = certifyAbstain(s, 1, 0);
  assert.equal(r.ok, true);
  assert.equal(signatureCount(r.state, 0), 0);
});

test('§5.3.4 发起质疑立即扣 1 点资源（无论成败；基准印「灵枢」）', () => {
  const s = pendingScene(5);
  const before = at(s.players, 1).resource;
  const r = certifyChallenge(s, 1, 0);
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 1).resource, before - 1, '发起质疑即付费');
});

test('§5.3.4 资源不足时不可发起质疑', () => {
  const s = pendingScene(5);
  const broke = { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, resource: 0 } : p)) };
  const r = certifyChallenge(broke, 1, 0);
  assert.equal(r.ok, false);
  assert.equal(r.state, broke, '失败时状态不变');
});

test('§5.3 判定通过 → 该认证人视为签印', () => {
  const s = pendingScene(5);
  const ch = certifyChallenge(s, 1, 0);
  const ans = certifyAnswer(ch.state, 1, 0, true);
  assert.equal(ans.ok, true);
  assert.equal(signatureCount(ans.state, 0), 1, '通过即视为签印');
});

test('§5.3 判定不通过 → 先记录判定并给复议窗口（不立即后退）', () => {
  const s = pendingScene(5);
  const ch = certifyChallenge(s, 1, 0);
  const ans = certifyAnswer(ch.state, 1, 0, false);
  assert.equal(ans.ok, true);
  const tp = at(ans.state.players, 0);
  assert.equal(tp.position, s.board.peakIndex, '判不通过本身不后退（复议窗口内）');
  assert.equal(tp.pendingCert, true, '认证仍在进行，待认证者仍在峰顶');
  assert.deepEqual(ans.state.certification.pending, [0]);
  assert.equal(ans.state.certification.judgments[1], false, '判定被记录');
});

test('§5.3.2 复议申请消耗 2 资源，且每轮限 1 次', () => {
  const s = pendingScene(5);
  const ch = certifyChallenge(s, 1, 0);
  const ans = certifyAnswer(ch.state, 1, 0, false);
  const before = at(ans.state.players, 0).resource;
  const ap = certifyAppeal(ans.state, 0, 0);
  assert.equal(ap.ok, true, '判不通过后仍可申请复议');
  assert.equal(at(ap.state.players, 0).resource, before - 2, '复议 -2 点资源');
  const again = certifyAppeal(ap.state, 0, 0);
  assert.equal(again.ok, false, '每轮限 1 次');
});

// ---------- §5.2 两轮上限 ----------

test('§5.2 达到门槛 → 获得 1 个活人席，**不结束本局**（B11 席位制）', () => {
  const s = pendingScene(5);
  let st = s;
  // 3 人签印即达门槛 N=3
  st = certifySign(st, 1, 0).state;
  st = certifySign(st, 2, 0).state;
  st = certifySign(st, 3, 0).state;
  const adv = advanceCertificationRound(st);
  assert.equal(adv.ok, true);
  // ⚠️ B11：认证通过不再终局 —— 封顶 = 获得 1 席并回到山道起点。
  assert.equal(adv.state.outcome.finished, false, '封顶不再结束本局');
  assert.equal(adv.state.liveSeats[0], 1, '达标者获得 1 个活人席');
  assert.equal(adv.state.players[0]?.position, 0, '封顶后回到山道起点');
  assert.equal(adv.state.players[0]?.pendingCert, false, '待认证锁定解除');
});

test('§5.2 登顶当轮只开启第 1 轮，不判定（B9：给认证人留出整轮）', () => {
  const s = createInitialState({ players: 5, seed: 7, deckSize: 40 });
  const entered = enterPendingCertification(s, 0);
  assert.equal(entered.ok, true);
  assert.equal(entered.state.certification.round, 0, '刚登顶时第 1 轮尚未开始');
  const opened = advanceCertificationRound(entered.state);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.certification.round, 1, '应进入第 1 轮');
  assert.equal(opened.state.outcome.finished, false, '开启第 1 轮不判定、不封顶');
  assert.deepEqual(opened.state.certification.pending, [0], '待认证者仍在待认证');
});

test('§5.2 两轮未达成 → 退回山道 60% 位置并终止认证', () => {
  const s = pendingScene(5);
  // 第 1 轮无人签印 → 进入第 2 轮
  const r1 = advanceCertificationRound(s);
  assert.equal(r1.state.certification.round, 2);
  assert.deepEqual(r1.state.certification.pending, [0]);
  // 第 2 轮仍无人签印 → 退回
  const r2 = advanceCertificationRound(r1.state);
  assert.equal(r2.ok, true);
  const tp = at(r2.state.players, 0);
  assert.equal(tp.position, Math.max(1, Math.round(s.board.length * 0.6)));
  assert.equal(tp.pendingCert, false);
  assert.deepEqual(r2.state.certification.pending, []);
});

test('§5.1 移动到峰顶即进入待认证流程（B9 回归：曾只设 pendingCert 而未进流程）', () => {
  const s = createInitialState({ players: 3, seed: 7, deckSize: 40 });
  const peak = s.board.peakIndex;
  // 用 move_to_tile 直接落到峰顶
  const r = applyEffect({ state: s, actor: 0 }, { op: 'move_to_tile', tileIndex: peak });
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).pendingCert, true, '应锁定为待认证');
  assert.deepEqual(r.state.certification.pending, [0], '必须进入认证流程的 pending 列表');
  assert.equal(r.state.certification.round, 0, '第 1 轮尚未开始');
});

test('§5.1 进入待认证状态', () => {
  const s = createInitialState({ players: 5, seed: 7, deckSize: 40 });
  const r = enterPendingCertification(s, 0);
  assert.equal(r.ok, true);
  assert.equal(at(r.state.players, 0).pendingCert, true);
  assert.deepEqual(r.state.certification.pending, [0]);
});

// ---------- §5.6 山议 ----------

test('§5.6 3 人局山议 → 山议裁定（扣资源，不淘汰）', () => {
  const s = createInitialState({ players: 3, seed: 7, deckSize: 40 });
  const opened = openCouncil(s);
  assert.equal(opened.ok, true);
  let st = opened.state;
  st = castVote(st, 0, 1).state;
  st = castVote(st, 1, 2).state;
  st = castVote(st, 2, 1).state;
  assert.deepEqual(topVoted(st), [1], '座位 1 得 2 票居首');
  const before = at(st.players, 1).resource;
  const res = resolveCouncil(st);
  assert.equal(res.ok, true);
  assert.equal(at(res.state.players, 1).resource, before - 2, '3 人局最高票扣 2 点资源');
  assert.equal(at(res.state.players, 1).alive, true, '3 人局不淘汰');
});

test('§5.6 4 人局山议 → 得票最高者放逐', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  let st = openCouncil(s).state;
  st = castVote(st, 0, 3).state;
  st = castVote(st, 1, 3).state;
  st = castVote(st, 2, 3).state;
  st = castVote(st, 3, 0).state;
  const res = resolveCouncil(st);
  assert.equal(res.ok, true);
  assert.equal(at(res.state.players, 3).alive, false, '座位 3 被放逐');
});

test('§5.6 放逐下限保护：存活会低于下限时不放逐', () => {
  // 4 人局：放逐 1 人后剩 3 = 下限，允许；构造 3 人局验证不淘汰
  const s = createInitialState({ players: 3, seed: 7, deckSize: 40 });
  let st = openCouncil(s).state;
  st = castVote(st, 0, 1).state;
  const res = resolveCouncil(st);
  assert.equal(at(res.state.players, 1).alive, true);
});

test('§5.6 凭证免疫放逐（公开信息）', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const withVoucher = {
    ...s,
    players: s.players.map((p) => (p.seat === 3 ? { ...p, flags: { ...p.flags, exemptFromVote: true } } : p)),
  };
  let st = openCouncil(withVoucher).state;
  st = castVote(st, 0, 3).state;
  st = castVote(st, 1, 3).state;
  const res = resolveCouncil(st);
  assert.equal(at(res.state.players, 3).alive, true, '凭证应免疫放逐');
});

test('§5.6 山议投票不能投自己、不能重复投', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const st = openCouncil(s).state;
  assert.equal(castVote(st, 0, 0).ok, false);
  const voted = castVote(st, 0, 1).state;
  assert.equal(castVote(voted, 0, 2).ok, false, '同轮不得重复投');
});

// ---------- §5.7–5.8 胜负判定 ----------

test('§5.8 兜底排名：距峰顶近者胜', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const positioned = {
    ...s,
    players: s.players.map((p) => (p.seat === 2 ? { ...p, position: 20 } : p.seat === 0 ? { ...p, position: 5 } : p)),
  };
  const ranked = fallbackRanking(positioned);
  assert.equal(ranked[0], 2, '座位 2 离峰顶更近，应排第一');
});

test('§5.8 兜底排名：距峰顶相同时比**累计**签印数，再相同时比资源', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const base = { ...s, players: s.players.map((p) => ({ ...p, position: 10 })) };
  // ⚠️ B11：兜底排名用的是**整局累计**签印数（`counters.signaturesTotal`），
  //   不是 `certification.signatures`（那是本轮签印数，每轮清零）。
  const withSig = {
    ...base,
    players: base.players.map((p) => (p.seat === 3 ? { ...p, counters: { signaturesTotal: 2 } } : p)),
  };
  assert.equal(fallbackRanking(withSig)[0], 3, '累计签印更多者胜');
});

test('§5.8 达到全局回合上限 → 兜底判定并标记 reason=fallback', () => {
  const s = createInitialState({ players: 3, seed: 7, deckSize: 40 });
  const overLimit = { ...s, round: s.scales.globalRoundLimit + 1 };
  const res = resolveVictory(overLimit);
  assert.equal(res.outcome.finished, true);
  assert.equal(res.outcome.reason, 'fallback');
  assert.ok(res.outcome.winners.length >= 1);
});

test('§5.7 仅剩 1 人 → 活人缺席，无胜者', () => {
  const s = createInitialState({ players: 3, seed: 7, deckSize: 40 });
  const oneLeft = {
    ...s,
    players: s.players.map((p) => (p.seat === 0 ? p : { ...p, alive: false })),
  };
  const res = resolveVictory(oneLeft);
  assert.equal(res.outcome.finished, true);
  assert.equal(res.outcome.reason, 'no_winner');
  assert.deepEqual(res.outcome.winners, []);
});

// ---------- §7 getLegalActions ----------

test('§7 认证阶段：认证人可签印/质疑/弃权', () => {
  const s = pendingScene(5);
  const actions = getLegalActions(s, 1);
  const types = new Set(actions.map((a) => a.type));
  assert.ok(types.has('CERTIFY_SIGN'));
  assert.ok(types.has('CERTIFY_CHALLENGE'));
  assert.ok(types.has('CERTIFY_ABSTAIN'));
});

test('§7 已用掉本轮机会 → 不再返回认证动作', () => {
  const s = pendingScene(5);
  const signed = certifySign(s, 1, 0).state;
  const actions = getLegalActions(signed, 1);
  const certActions = actions.filter((a) => a.type.startsWith('CERTIFY_'));
  assert.equal(certActions.length, 0, '本轮机会已用完');
});

test('§7 待认证者不能主动移动（§5.1 锁定）', () => {
  const s = pendingScene(5);
  const actions = getLegalActions(s, 0);
  assert.equal(actions.filter((a) => a.type === 'MOVE').length, 0);
});

test('§7 山议进行中 → 返回投票动作', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const st = openCouncil(s).state;
  const actions = getLegalActions(st, 0);
  assert.ok(actions.some((a) => a.type === 'VOTE'));
});

test('§5.3.2 轮末未申请复议 → 执行后退后果', () => {
  const s = pendingScene(5);
  const ch = certifyChallenge(s, 1, 0);
  const ans = certifyAnswer(ch.state, 1, 0, false);
  // 未申请复议 → 轮末结算时执行后退
  const adv = advanceCertificationRound(ans.state);
  assert.equal(adv.ok, true);
  const tp = at(adv.state.players, 0);
  assert.equal(tp.position, s.board.peakIndex - 1, '轮末执行后退 1 格');
  assert.equal(tp.pendingCert, false, '离开峰顶 → 认证终止');
});

test('§5.3 认证 Action 的 target 统一表示「待认证者」（语义一致）', () => {
  const s = pendingScene(5);
  const ch = certifyChallenge(s, 1, 0);
  const ans = certifyAnswer(ch.state, 1, 0, false);
  // 复议只能由待认证者自己发起，target 也指向自己
  assert.equal(certifyAppeal(ans.state, 0, 1).ok, false, 'target 非待认证者本人 → 拒绝');
  assert.equal(certifyAppeal(ans.state, 0, 0).ok, true);
});
