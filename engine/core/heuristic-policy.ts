import type { Action, ActionType } from './action.ts';
import type { State } from './state.ts';

export interface SeatPolicy {
  choose(state: State, playerId: number, legal: readonly Action[]): Action | null;
}

const FORBIDDEN: ReadonlySet<ActionType> = new Set<ActionType>([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

const BAND: Readonly<Record<ActionType, 1 | 2 | 3>> = {
  COMPARE: 1,
  GATE_RESOLVE: 1, BARRIER_RESOLVE: 1, DUEL_SUBMIT_CARD: 1,
  VOTE: 1, CERTIFY_ABSTAIN: 1,
  MOVE: 2, ROLL_WHEEL: 2, ABILITY: 2, RECUPERATE: 2,
  PLAY_CARD: 3, EQUIP_CARD: 3, PASS: 3,
  CERTIFY_SIGN: 3, CERTIFY_MUTUAL_SIGN: 3, CERTIFY_CHALLENGE: 3,
  CERTIFY_ANSWER: 3, CERTIFY_APPEAL: 3, CERTIFY_APPEAL_VOTE: 3,
  COUNCIL_VETO: 3,
};

export function policyBand(action: Action): 1 | 2 | 3 {
  return BAND[action.type];
}

const TYPE_ORDER: Readonly<Partial<Record<ActionType, number>>> = {
  COMPARE: 0,
  GATE_RESOLVE: 1, BARRIER_RESOLVE: 2, DUEL_SUBMIT_CARD: 3,
  VOTE: 4, CERTIFY_ABSTAIN: 5,
  MOVE: 6, ROLL_WHEEL: 7, ABILITY: 8, RECUPERATE: 9,
  PLAY_CARD: 10, EQUIP_CARD: 11, PASS: 12,
};

function cardRank(state: State, seat: number, cardId: string): number {
  return state.players[seat]?.hand.find((c) => c.id === cardId)?.rank ?? 0;
}

function compareActions(state: State, a: Action, b: Action): number {
  const band = policyBand(a) - policyBand(b);
  if (band !== 0) { return band; }
  const order = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
  if (order !== 0) { return order; }
  if (a.type === 'GATE_RESOLVE' && b.type === 'GATE_RESOLVE') {
    return (a.channel === 'pay' ? 0 : 1) - (b.channel === 'pay' ? 0 : 1);
  }
  if (a.type === 'BARRIER_RESOLVE' && b.type === 'BARRIER_RESOLVE') {
    return (a.channel === 'skip' ? 0 : 1) - (b.channel === 'skip' ? 0 : 1);
  }
  if (a.type === 'VOTE' && b.type === 'VOTE') { return a.target - b.target; }
  if (a.type === 'CERTIFY_ABSTAIN' && b.type === 'CERTIFY_ABSTAIN') { return a.target - b.target; }
  if (a.type === 'RECUPERATE' && b.type === 'RECUPERATE') {
    return (a.target ?? -1) - (b.target ?? -1);
  }
  const aCard = a.type === 'PLAY_CARD' || a.type === 'EQUIP_CARD' || a.type === 'DUEL_SUBMIT_CARD';
  const bCard = b.type === 'PLAY_CARD' || b.type === 'EQUIP_CARD' || b.type === 'DUEL_SUBMIT_CARD';
  if (aCard && bCard) {
    const aId = a.type === 'PLAY_CARD' || a.type === 'EQUIP_CARD' || a.type === 'DUEL_SUBMIT_CARD' ? a.cardId : '';
    const bId = b.type === 'PLAY_CARD' || b.type === 'EQUIP_CARD' || b.type === 'DUEL_SUBMIT_CARD' ? b.cardId : '';
    return cardRank(state, a.actor, aId) - cardRank(state, b.actor, bId) || aId.localeCompare(bId);
  }
  return 0;
}

export const heuristicPolicy: SeatPolicy = {
  choose(state, playerId, legal) {
    const candidates = legal.filter((a) => a.actor === playerId && !FORBIDDEN.has(a.type));
    candidates.sort((a, b) => compareActions(state, a, b));
    return candidates[0] ?? null;
  },
};
