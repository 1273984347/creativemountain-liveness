import type { Action, ActionType } from './action.ts';
import { isAiSeat, type State } from './state.ts';
import type { RuleMode } from '../scales.ts';
import { advanceTurn, performAction } from './turn-runner.ts';
import { performAbility } from './abilities.ts';
import { castVote, useCouncilVeto } from './council.ts';
import { resolveGate, resolveCompareGate } from './gate.ts';
import { resolveBarrier } from './barrier.ts';
import { submitDuelCard } from './duel.ts';
import {
  certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote,
  certifyChallenge, certifyMutualSign, certifySign,
} from './certification.ts';

type FlagResult = { readonly ok: boolean; readonly state: State };

const AI_FORBIDDEN: ReadonlySet<ActionType> = new Set<ActionType>([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

const accepted = (state: State, result: FlagResult): State => result.ok ? result.state : state;
const actionThenAdvance = (state: State, next: State, mode: RuleMode): State =>
  next === state ? state : advanceTurn(next, mode);

/** AI/脚本侧声明式动作统一提交口；拒绝 = 返回原引用（与 performAction 同形）。 */
export function applyAction(state: State, action: Action, mode: RuleMode = 'standard'): State {
  if (isAiSeat(state, action.actor) && AI_FORBIDDEN.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'MOVE':
      return actionThenAdvance(state, performAction(state, action.actor, 'move'), mode);
    case 'ROLL_WHEEL':
      return actionThenAdvance(state, performAction(state, action.actor, 'ask'), mode);
    case 'PLAY_CARD':
      return actionThenAdvance(state, performAction(state, action.actor, 'act', {
        cardId: action.cardId,
        ...(action.target === undefined ? {} : { target: action.target }),
      }), mode);
    case 'ABILITY': {
      const r = performAbility(state, action.actor, action.target);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'COMPARE': {
      const r = resolveCompareGate(state, action.actor, action.cardId, action.target);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'GATE_RESOLVE': {
      const r = resolveGate(state, action.actor, action.channel);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'BARRIER_RESOLVE': {
      const r = resolveBarrier(state, action.actor, action.channel);
      return r.ok ? advanceTurn(r.state, mode) : state;
    }
    case 'PASS':
      return actionThenAdvance(state, performAction(state, action.actor, 'pass'), mode);
    case 'VOTE':
      return accepted(state, castVote(state, action.actor, action.target));
    case 'CERTIFY_SIGN':
      return accepted(state, certifySign(state, action.actor, action.target));
    case 'CERTIFY_CHALLENGE':
      return accepted(state, certifyChallenge(state, action.actor, action.target));
    case 'CERTIFY_ABSTAIN':
      return accepted(state, certifyAbstain(state, action.actor, action.target));
    case 'CERTIFY_APPEAL':
      return accepted(state, certifyAppeal(state, action.actor, action.target));
    case 'CERTIFY_APPEAL_VOTE':
      return accepted(state, certifyAppealVote(state, action.actor, action.target, action.overturn));
    case 'CERTIFY_ANSWER':
      return accepted(state, certifyAnswer(state, action.actor, action.target, action.passed));
    case 'CERTIFY_MUTUAL_SIGN':
      return accepted(state, certifyMutualSign(state, action.actor, action.target));
    case 'DUEL_SUBMIT_CARD': {
      const r = submitDuelCard(state, action.actor, action.cardId);
      if (!r.ok) { return state; }
      return r.state.duel === null ? advanceTurn(r.state, mode) : r.state;
    }
    case 'EQUIP_CARD':
      return actionThenAdvance(state, performAction(state, action.actor, 'equip', { cardId: action.cardId }), mode);
    case 'COUNCIL_VETO':
      return accepted(state, useCouncilVeto(state, action.actor));
    case 'RECUPERATE':
      return actionThenAdvance(state, performAction(state, action.actor, 'recuperate',
        action.target === undefined ? {} : { target: action.target }), mode);
  }
}
