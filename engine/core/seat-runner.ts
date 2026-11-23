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
  const action = policy.choose(state, seat, legal);
  if (action === null) { return forfeit(state, seat, seatMode, 'blocked'); }
  if (action.actor !== seat || !legal.some((a) => actionKey(a) === actionKey(action))) {
    return forfeit(state, seat, seatMode, 'illegal_choice');
  }
  const turnOnly = new Set<Action['type']>([
    'MOVE', 'ROLL_WHEEL', 'PLAY_CARD', 'ABILITY', 'COMPARE',
    'GATE_RESOLVE', 'BARRIER_RESOLVE', 'PASS', 'EQUIP_CARD', 'RECUPERATE',
  ]);
  if (turnOnly.has(action.type) && currentPlayer(state) !== seat) {
    return forfeit(state, seat, seatMode, 'wrong_turn');
  }
  if (action.type === 'DUEL_SUBMIT_CARD'
    && state.duel !== null
    && action.actor !== state.duel.seatA
    && action.actor !== state.duel.seatB) {
    return forfeit(state, seat, seatMode, 'wrong_turn');
  }
  const next = applyAction(state, action, mode);
  if (next === state) { return forfeit(state, seat, seatMode, 'engine_rejected'); }
  const degradeLevel = policyBand(action);
  return {
    state: {
      ...next,
      log: [...next.log, {
        round: next.round, turnIndex: next.turnIndex, actor: seat,
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
