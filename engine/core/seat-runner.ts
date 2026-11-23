import type { Action } from './action.ts';
import { isAiSeat, type State } from './state.ts';
import type { RuleMode } from '../scales.ts';
import { actionKey } from './action-key.ts';
import { currentPlayer } from './round.ts';
import { getLegalActions } from './legal.ts';
import { applyAction } from './apply-action.ts';
import { policyBand, type SeatPolicy } from './heuristic-policy.ts';

export type SeatMode = 'seat_filled_by_ai' | 'seat_offline_temporary';

export interface SeatStepResult {
  readonly state: State;
  readonly action: Action | null;
  readonly accepted: boolean;
  readonly degradeLevel: 1 | 2 | 3;
  readonly reason: string;
}

function forfeit(state: State, seat: number, seatMode: SeatMode, reason: string): SeatStepResult {
  return {
    state: {
      ...state,
      log: [...state.log, {
        round: state.round, turnIndex: state.turnIndex, actor: seat,
        kind: 'ai_forfeit', message: `程序座位弃权：${reason}`, seatMode,
      }],
    },
    action: null,
    accepted: false,
    degradeLevel: 3,
    reason,
  };
}

export function runSeatStep(
  state: State,
  seat: number,
  policy: SeatPolicy,
  mode: RuleMode,
  seatMode: SeatMode = 'seat_filled_by_ai',
): SeatStepResult {
  if (!isAiSeat(state, seat)) {
    return { state, action: null, accepted: false, degradeLevel: 3, reason: 'not_ai_seat' };
  }
  if (seatMode === 'seat_offline_temporary') {
    return { state, action: null, accepted: false, degradeLevel: 3, reason: 'offline_mode_not_implemented' };
  }
  const legal = getLegalActions(state, seat);
  if (legal.length === 0) {
    const action = policy.choose(state, seat, legal);
    return action === null ? forfeit(state, seat, seatMode, 'blocked')
      : forfeit(state, seat, seatMode, 'illegal_choice');
  }
  let remaining = legal;
  let lastReason = 'illegal_choice';
  let lastRuleReason: 'wrong_turn' | 'engine_rejected' | null = null;
  const turnOnly = new Set<Action['type']>([
    'MOVE', 'ROLL_WHEEL', 'PLAY_CARD', 'ABILITY', 'COMPARE',
    'GATE_RESOLVE', 'BARRIER_RESOLVE', 'PASS', 'EQUIP_CARD', 'RECUPERATE',
  ]);
  // C5 三级降级：每次把已尝试键从候选集移除后再问策略；最多尝试合法候选数，杜绝死循环。
  for (let attempt = 0; attempt < legal.length; attempt += 1) {
    const action = policy.choose(state, seat, remaining);
    if (action === null) {
      return forfeit(state, seat, seatMode, lastRuleReason ?? 'blocked');
    }
    const key = actionKey(action);
    const matched = remaining.find((a) => actionKey(a) === key);
    if (matched !== undefined) {
      remaining = remaining.filter((a) => actionKey(a) !== key);
    }
    if (action.actor !== seat || matched === undefined) {
      // 策略反复返回候选集外键时，保留此前真实规则拒绝的原因（既有 ai_forfeit 契约）。
      if (lastRuleReason === null) { lastReason = 'illegal_choice'; }
      continue;
    }
    if (turnOnly.has(action.type) && currentPlayer(state) !== seat) {
      lastReason = 'wrong_turn';
      lastRuleReason = 'wrong_turn';
      continue;
    }
    if (action.type === 'DUEL_SUBMIT_CARD'
      && state.duel !== null
      && action.actor !== state.duel.seatA
      && action.actor !== state.duel.seatB) {
      lastReason = 'wrong_turn';
      lastRuleReason = 'wrong_turn';
      continue;
    }
    const actionRound = state.round;
    const actionTurnIndex = state.turnIndex;
    const next = applyAction(state, action, mode);
    if (next === state) {
      lastReason = 'engine_rejected';
      lastRuleReason = 'engine_rejected';
      continue;
    }
    const degradeLevel = policyBand(action);
    return {
      state: {
        ...next,
        log: [...next.log, {
          round: actionRound, turnIndex: actionTurnIndex, actor: seat,
          kind: 'ai_action_committed', message: `程序座位行动：${actionKey(action)}`,
          actionKey: actionKey(action), degradeLevel, seatMode,
        }],
      },
      action,
      accepted: true,
      degradeLevel,
      reason: 'committed',
    };
  }
  return forfeit(state, seat, seatMode, lastReason);
}
