import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';
import type { FacePolicy } from '../../tests/sim/policy.d.mts';
import type { ThemePack } from '../../engine/types/theme.ts';
import type { Action, ActionType } from '../../engine/core/action.ts';
import { createInitialState, isAiSeat, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { applyAction } from '../../engine/core/apply-action.ts';
import { runSeatStep } from '../../engine/core/seat-runner.ts';
import { heuristicPolicy, type SeatPolicy } from '../../engine/core/heuristic-policy.ts';
import { actionFromKey, actionKey } from '../../engine/core/action-key.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { needsCertificationAction, needsCouncilVote } from '../../engine/core/turn-runner.ts';
import { resolveCouncil } from '../../engine/core/council.ts';
import { pendingBarrier } from '../../engine/core/barrier.ts';
import { pendingGate } from '../../engine/core/gate.ts';

const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
const FORBIDDEN = new Set([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

test('6 人局真实决策点：启发式在 play/council/certify 三面均零回落、不选禁止动作', async () => {
  for (const face of ['play', 'council', 'certify'] as const) {
    for (const seed of [7, 11, 17]) {
      const policy: FacePolicy = {
        face,
        seat: 2,
        decide: async (state, seat, candidates) => {
          const picked = heuristicPolicy.choose(state, seat, candidates);
          if (picked === null) { return null; }
          assert.equal(FORBIDDEN.has(picked.type), false, `${face}/${seed} 选了禁止动作 ${picked.type}`);
          return actionKey(picked);
        },
      };
      const result = await playOne(theme, 6, seed, undefined, policy);
      assert.equal(result.injection.fallbacks, 0, `${face}/${seed} 不得回落原启发式`);
      assert.ok(result.injection.calls > 0, `${face}/${seed} 必须真的到达决策点`);
      assert.equal(result.anomalies.includes('未分出胜负'), false, `${face}/${seed} 必须正常终局`);
      assert.ok(result.winners.length > 0, `${face}/${seed} 必须产出胜者`);
      assert.equal(result.anomalies.some((a) => a.includes('死循环')), false, `${face}/${seed} 不得死循环`);
    }
  }
});

const AI_SEAT = 2;
const COUNCIL_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(['VOTE']);
const CERTIFIER_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN',
]);
const DUEL_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(['DUEL_SUBMIT_CARD']);
const GATE_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(['COMPARE', 'GATE_RESOLVE']);
const BARRIER_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>(['BARRIER_RESOLVE']);

// 真人测试策略仍只从引擎枚举动作中选择；裂隙优先放印，确保走完真实阻塞结算而非停在待处理面。
const humanGamePolicy: SeatPolicy = {
  choose(state, seat, legal) {
    const place = legal.find((a) => a.actor === seat
      && a.type === 'BARRIER_RESOLVE' && a.channel === 'place');
    return place ?? heuristicPolicy.choose(state, seat, legal);
  },
};

interface FlowCoverage {
  council: boolean;
  certification: boolean;
  duel: boolean;
  gate: boolean;
  barrier: boolean;
}

function chooseHumanAction(
  state: State,
  seat: number,
  legal: readonly Action[],
  allowed: ReadonlySet<ActionType>,
): Action {
  const candidates = legal.filter((a) => a.actor === seat && allowed.has(a.type));
  // 真人优先给程序座位签印，让整局回归真正经过「AI 认证完成但不获活人席」的生产结算。
  const signAi = candidates.find((a) => a.type === 'CERTIFY_SIGN' && isAiSeat(state, a.target));
  const action = signAi ?? humanGamePolicy.choose(state, seat, candidates);
  assert.ok(action, `真人座 ${String(seat)} 在 ${[...allowed].join('/')} 面必须有合法动作`);
  return action;
}

function submitSeat(
  state: State,
  seat: number,
  allowed?: ReadonlySet<ActionType>,
): State {
  if (isAiSeat(state, seat)) {
    const result = runSeatStep(state, seat, heuristicPolicy, 'standard');
    assert.equal(result.accepted, true,
      `AI 座 ${String(seat)} 不得在本可行动的步骤弃权：${result.reason}`);
    assert.ok(result.action !== null);
    if (allowed !== undefined) {
      assert.ok(allowed.has(result.action.type),
        `AI 座 ${String(seat)} 在当前流程面提交了跨面动作 ${result.action.type}`);
    }
    return result.state;
  }
  const legal = getLegalActions(state, seat);
  const action = chooseHumanAction(state, seat, legal, allowed ?? new Set(legal.map((a) => a.type)));
  assert.ok(legal.some((a) => actionKey(a) === actionKey(action)), '真人只能提交引擎枚举动作');
  const next = applyAction(state, action, 'standard');
  assert.notEqual(next, state, `真人座 ${String(seat)} 的合法动作被提交口拒绝`);
  return next;
}

function driveAiSeatGame(seed: number): { readonly state: State; readonly coverage: FlowCoverage } {
  const base = createInitialState({ players: 4, seed, deckSize: theme.counts.deckTotal });
  let state = installTheme(base, theme);
  state = {
    ...state,
    players: state.players.map((p) => p.seat === AI_SEAT ? { ...p, controlledBy: 'ai' } : p),
  };
  const coverage: FlowCoverage = { council: false, certification: false, duel: false, gate: false, barrier: false };
  const maxSteps = state.scales.globalRoundLimit * state.players.length * 12 + 500;
  let steps = 0;
  while (!state.outcome.finished) {
    assert.ok(steps++ < maxSteps, `seed=${String(seed)} 生产 AI 座位流水线死循环；`
      + `round=${String(state.round)} turn=${String(state.turnIndex)} phase=${state.phase} `
      + `current=${String(currentPlayer(state))} duel=${JSON.stringify(state.duel)} `
      + `council=${String(state.council.resolved)} pending=${state.certification.pending.join(',')} `
      + `positions=${state.players.map((p) => `${String(p.seat)}@${String(p.position)}`).join(',')}`);

    if (needsCouncilVote(state)) {
      coverage.council = true;
      let votes = 0;
      while (needsCouncilVote(state)) {
        const voter = state.players.find((p) => p.alive
          && getLegalActions(state, p.seat).some((a) => a.type === 'VOTE'));
        if (voter === undefined) { break; }
        state = submitSeat(state, voter.seat, COUNCIL_ACTIONS);
        assert.ok(++votes <= state.players.length + 1, '山议投票不得无限循环');
      }
      const resolved = resolveCouncil(state);
      assert.ok(resolved.ok, `seed=${String(seed)} 山议必须由真实引擎结算：${resolved.note ?? ''}`);
      state = resolved.state;
      continue;
    }

    if (state.certification.pending.length > 0) { coverage.certification = true; }
    if (needsCertificationAction(state)) {
      const certifier = state.players.find((p) => p.alive
        && !state.certification.pending.includes(p.seat)
        && getLegalActions(state, p.seat).some((a) => CERTIFIER_ACTIONS.has(a.type)));
      assert.ok(certifier !== undefined, `seed=${String(seed)} 认证面必须仍有可行动的认证人`);
      state = submitSeat(state, certifier.seat, CERTIFIER_ACTIONS);
      continue;
    }

    const seat = currentPlayer(state);
    assert.ok(seat >= 0, `seed=${String(seed)} 未终局却无当前手番`);
    // 与 legal.ts 的真实候选优先级一致：关隘/裂隙阻塞面先于对峙亮牌面。
    if (pendingGate(state, seat) !== null) {
      coverage.gate = true;
      state = submitSeat(state, seat, GATE_ACTIONS);
      continue;
    }
    if (pendingBarrier(state, seat) !== null) {
      coverage.barrier = true;
      state = submitSeat(state, seat, BARRIER_ACTIONS);
      continue;
    }

    if (state.duel !== null) {
      coverage.duel = true;
      const participant = [state.duel.seatA, state.duel.seatB].find((seat) =>
        getLegalActions(state, seat).some((a) => a.type === 'DUEL_SUBMIT_CARD'));
      assert.ok(participant !== undefined, `seed=${String(seed)} 待决对峙必须仍有可亮牌方；`
        + `duel=${JSON.stringify(state.duel)}；`
        + state.players.map((p) => `座${String(p.seat)}:${String(p.hand.length)}张:${getLegalActions(state, p.seat).map(actionKey).join(',')}`).join('；'));
      state = submitSeat(state, participant, DUEL_ACTIONS);
      continue;
    }

    state = submitSeat(state, seat);
  }
  return { state, coverage };
}

test('整局生产流水线：AI 座位零禁止提交/零弃权/零活人席并正常终局', () => {
  const runs = [7, 11, 17].map((seed) => driveAiSeatGame(seed));
  const coverage: FlowCoverage = {
    council: runs.some((r) => r.coverage.council),
    certification: runs.some((r) => r.coverage.certification),
    duel: runs.some((r) => r.coverage.duel),
    gate: runs.some((r) => r.coverage.gate),
    barrier: runs.some((r) => r.coverage.barrier),
  };
  assert.deepEqual(coverage, { council: true, certification: true, duel: true, gate: true, barrier: true },
    '整局回归必须经过山议、认证、对峙、关隘、裂隙的真实引擎流程');

  const committed = runs.flatMap((r) => r.state.log.filter((l) => l.kind === 'ai_action_committed'));
  assert.ok(committed.length > 0, 'AI 座位必须真实经过 runSeatStep + applyAction');
  for (const event of committed) {
    assert.equal(event.actor, AI_SEAT);
    assert.equal(event.seatMode, 'seat_filled_by_ai');
    assert.ok(event.actionKey !== undefined, 'AI 动作事件必须带 actionKey');
    assert.equal(FORBIDDEN.has(actionFromKey(event.actionKey).type), false,
      `AI 提交了禁止动作 ${event.actionKey}`);
  }
  for (const { state } of runs) {
    assert.equal(state.outcome.finished, true, '整局必须正常终局');
    assert.notEqual(state.outcome.reason, 'no_winner', '整局不得以活人缺席异常终局');
    assert.ok(state.outcome.winners.length > 0, '整局必须产出胜者');
    assert.ok(state.round > 1, '整局必须真实跨 round 推进');
    assert.equal(state.log.filter((l) => l.kind === 'ai_forfeit').length, 0,
      '有合法替代动作时不得出现 AI 弃权');
    assert.equal(state.liveSeats[AI_SEAT] ?? 0, 0, 'AI 座位始终不得持有活人席');
  }
  assert.ok(runs.some((r) => r.state.log.some((l) =>
    l.actor === AI_SEAT && l.message === '程序座位完成验证，但不获得活人席')),
  '整局回归必须真实经历 AI 认证完成，并留下显式解释日志');
});
