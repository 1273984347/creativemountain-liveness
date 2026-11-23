import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeatStep } from '../../engine/core/seat-runner.ts';
import { heuristicPolicy } from '../../engine/core/heuristic-policy.ts';
import type { SeatPolicy } from '../../engine/core/heuristic-policy.ts';
import type { State } from '../../engine/core/state.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { startDuel } from '../../engine/core/duel.ts';
import { certifyMutualSign, certifySign, advanceCertificationRound } from '../../engine/core/certification.ts';
import { exiledScene, mk, pendingScene, putPending } from './fixtures.ts';

function withAi(s: State, seat = 0): State {
  return { ...s, players: s.players.map((p) => p.seat === seat ? { ...p, controlledBy: 'ai' } : p) };
}

test('AI 座位提交合法动作并写 actionKey/degradeLevel/seatMode', () => {
  const s = withAi(mk(6, 7));
  const r = runSeatStep(s, 0, heuristicPolicy, 'standard');
  assert.equal(r.accepted, true);
  assert.ok(r.action);
  assert.notEqual(r.state, s);
  const event = r.state.log.at(-1);
  assert.equal(event?.kind, 'ai_action_committed');
  assert.equal(event?.actionKey, actionKey(r.action));
  assert.equal(event?.degradeLevel, r.degradeLevel);
  assert.equal(event?.seatMode, 'seat_filled_by_ai');
});

test('AI 动作事件记录提交前手番，不跟随后置推进', () => {
  const base = mk(4, 7);
  const seat = currentPlayer(base);
  const s = withAi(base, seat);
  const policy: SeatPolicy = {
    choose: (_state, _seat, legal) => legal.find((a) => a.type === 'MOVE') ?? null,
  };
  const r = runSeatStep(s, seat, policy, 'standard');
  assert.equal(r.accepted, true);
  assert.equal(r.state.turnIndex, s.turnIndex + 1, '前提：MOVE 必须推进手番');
  const event = r.state.log.at(-1);
  assert.equal(event?.kind, 'ai_action_committed');
  assert.equal(event?.round, s.round);
  assert.equal(event?.turnIndex, s.turnIndex);
});

test('AI 动作事件记录跨回合前的 round/turnIndex', () => {
  const base = mk(4, 7);
  const lastTurn = base.players.filter((p) => p.alive).length - 1;
  const atRoundEnd: State = { ...base, turnIndex: lastTurn };
  const seat = currentPlayer(atRoundEnd);
  const s = withAi(atRoundEnd, seat);
  const policy: SeatPolicy = {
    choose: (_state, _seat, legal) => legal.find((a) => a.type === 'MOVE') ?? null,
  };
  const r = runSeatStep(s, seat, policy, 'standard');
  assert.equal(r.accepted, true);
  assert.equal(r.state.round, s.round + 1, '前提：末位手番必须跨 round');
  assert.equal(r.state.turnIndex, 0);
  const event = r.state.log.at(-1);
  assert.equal(event?.kind, 'ai_action_committed');
  assert.equal(event?.round, s.round);
  assert.equal(event?.turnIndex, lastTurn);
});

test('策略返回候选集外动作时拒绝并写 ai_forfeit', () => {
  const s = withAi(mk(4, 7));
  const bad: SeatPolicy = { choose: () => ({ type: 'PASS', actor: 1 }) };
  const r = runSeatStep(s, 0, bad, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'illegal_choice');
  assert.equal(r.action, null);
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('无合法候选时显式 ai_forfeit(blocked)，不静默跳过', () => {
  const s = withAi(exiledScene(4, 7, 0));
  const none: SeatPolicy = {
    choose: (_state, _seat, legal) => {
      assert.deepEqual(legal, [], '出局 AI 座位不应有合法候选');
      return null;
    },
  };
  const r = runSeatStep(s, 0, none, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.action, null);
  assert.equal(r.reason, 'blocked');
  assert.equal(r.degradeLevel, 3);
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('自定义策略提交 AI 禁止动作时由提交口拒绝并写 ai_forfeit(engine_rejected)', () => {
  const base = pendingScene(4, 7);
  const s = withAi(base, 1);
  const sign = { type: 'CERTIFY_SIGN', actor: 1, target: 0 } as const;
  const policy: SeatPolicy = { choose: () => sign };
  const r = runSeatStep(s, 1, policy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'engine_rejected');
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('首选被引擎拒绝后排除该键并改选合法弃权', () => {
  const base = pendingScene(4, 7);
  const s = withAi(base, 1);
  const sign = { type: 'CERTIFY_SIGN', actor: 1, target: 0 } as const;
  let calls = 0;
  const policy: SeatPolicy = {
    choose: (_state, _seat, legal) => {
      calls += 1;
      if (calls === 1) {
        assert.ok(legal.some((a) => actionKey(a) === actionKey(sign)), '前提：首轮候选含被禁签印');
        return sign;
      }
      assert.equal(legal.some((a) => actionKey(a) === actionKey(sign)), false,
        '回落候选必须排除已尝试且被拒绝的动作键');
      const abstain = legal.find((a) => a.type === 'CERTIFY_ABSTAIN');
      assert.ok(abstain, '前提：弃权仍是合法替代动作');
      return abstain;
    },
  };
  const r = runSeatStep(s, 1, policy, 'standard');
  assert.equal(r.accepted, true);
  assert.equal(r.action?.type, 'CERTIFY_ABSTAIN');
  assert.equal(r.reason, 'committed');
  assert.equal(r.degradeLevel, 1, '降级档位取最终被接受动作的 policyBand');
  assert.equal(calls, 2, '应在首次引擎拒绝后恰好再调用一次策略');
  assert.equal(r.state.log.at(-1)?.kind, 'ai_action_committed');
  assert.equal(r.state.log.some((l) => l.kind === 'ai_forfeit'), false,
    '已有合法替代动作时不得提前弃权');
});

test('认证入口直接调用也拒绝 AI 认证人签印/互签', () => {
  const base = pendingScene(4, 7);
  const s = withAi(base, 1);
  const sign = certifySign(s, 1, 0);
  assert.equal(sign.ok, false);
  assert.equal(sign.note, '程序座位没有签印权');
  assert.equal(sign.state, s);

  const twoPending = putPending(mk(4, 7), [0, 1]);
  const withTwo = withAi(twoPending, 1);
  const mutual = certifyMutualSign(withTwo, 1, 0);
  assert.equal(mutual.ok, false);
  assert.equal(mutual.note, '程序座位没有签印权');
  assert.equal(mutual.state, withTwo);
});

test('AI 待认证者即使被真人签够，也不获得活人席', () => {
  const base = pendingScene(4, 7);
  let s = withAi(base, 0);
  for (const seat of [1, 2, 3]) {
    const r = certifySign(s, seat, 0);
    assert.equal(r.ok, true, `真人座 ${seat} 签印必须成功`);
    s = r.state;
  }
  const closed = advanceCertificationRound(s);
  assert.equal(closed.ok, true);
  assert.equal(closed.state.liveSeats[0], undefined, 'AI 不得持有活人席');
  assert.equal(closed.state.players[0]?.position, 0, 'AI 认证结束后回到山道起点');
  assert.equal(closed.state.players[0]?.pendingCert, false, 'AI 认证结束后仍回到山道');
  assert.match(closed.note ?? '', /程序座位完成验证/);
  assert.doesNotMatch(closed.note ?? '', /坐上活人席/);
  const explanation = closed.state.log.find((l) => l.actor === 0 && l.message === '程序座位完成验证，但不获得活人席');
  assert.ok(explanation, 'AI 认证完成必须留下显式状态日志，不得静默无效');
  assert.equal(explanation.kind, 'certify');
});

test('混合认证结算只给真人活人席，note 分别说明两类结果', () => {
  const base = putPending(mk(4, 7), [0, 1]);
  const s = withAi(base, 0);
  const signedAi = certifySign(s, 2, 0);
  assert.equal(signedAi.ok, true);
  const signedHuman = certifySign(signedAi.state, 3, 1);
  assert.equal(signedHuman.ok, true);
  const closed = advanceCertificationRound(signedHuman.state);
  assert.equal(closed.ok, true);
  assert.equal(closed.state.liveSeats[0], undefined);
  assert.equal(closed.state.liveSeats[1], 1);
  assert.match(closed.note ?? '', /坐上活人席：座1/);
  assert.match(closed.note ?? '', /程序座位完成验证：座0/);
  assert.ok(closed.state.log.some((l) => l.actor === 0 && l.message === '程序座位完成验证，但不获得活人席'));
});

test('人类座位不产生 AI 事件', () => {
  const s = mk(4, 7);
  const r = runSeatStep(s, 0, heuristicPolicy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'not_ai_seat');
  assert.equal(r.state, s);
});

test('临时离线模式不执行动作且明确返回未实现', () => {
  const s = withAi(mk(4, 7));
  const r = runSeatStep(s, 0, heuristicPolicy, 'standard', 'seat_offline_temporary');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'offline_mode_not_implemented');
  assert.equal(r.action, null);
  assert.equal(r.state, s);
  assert.equal(r.state.log.at(-1)?.kind, undefined);
});

test('非当前手番的 AI 不得提交需要手番的动作', () => {
  const s = withAi(mk(4, 7), 1);
  assert.equal(s.turnOrder[s.turnIndex], 0, '前提：当前手番是真人座 0');
  const policy: SeatPolicy = {
    choose: (_state, _seat, legal) => legal.find((a) => a.type === 'MOVE') ?? null,
  };
  const r = runSeatStep(s, 1, policy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'wrong_turn');
  assert.equal(r.action, null);
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('AI 对峙参与者可提交合法亮牌动作', () => {
  const s = withAi(startDuel(mk(4, 7), 0, 1), 0);
  const policy: SeatPolicy = {
    choose: (_state, _seat, legal) => legal.find((a) => a.type === 'DUEL_SUBMIT_CARD') ?? null,
  };
  const r = runSeatStep(s, 0, policy, 'standard');
  assert.equal(r.accepted, true);
  assert.equal(r.action?.type, 'DUEL_SUBMIT_CARD');
  assert.equal(r.state.log.at(-1)?.kind, 'ai_action_committed');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});

test('AI 非对峙参与者不能伪造亮牌动作', () => {
  const s = withAi(startDuel(mk(4, 7), 0, 1), 2);
  const card = s.players[2]?.hand[0];
  assert.ok(card, '前提：非参与者手中有牌');
  const policy: SeatPolicy = {
    choose: () => ({ type: 'DUEL_SUBMIT_CARD', actor: 2, cardId: card.id }),
  };
  const r = runSeatStep(s, 2, policy, 'standard');
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'illegal_choice');
  assert.equal(r.action, null);
  assert.equal(r.state.log.at(-1)?.kind, 'ai_forfeit');
  assert.equal(r.state.log.at(-1)?.seatMode, 'seat_filled_by_ai');
});
