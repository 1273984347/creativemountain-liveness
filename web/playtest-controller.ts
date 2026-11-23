import type { Action, ActionType } from '../engine/core/action.ts';
import type { RuleMode } from '../engine/scales.ts';
import { actionKey } from '../engine/core/action-key.ts';
import { currentPlayer } from '../engine/core/round.ts';
import { getLegalActions } from '../engine/core/legal.ts';
import { heuristicPolicy } from '../engine/core/heuristic-policy.ts';
import { runSeatStep } from '../engine/core/seat-runner.ts';
import { stateToJson } from '../engine/core/serialize.ts';
import { isAiSeat, type State } from '../engine/core/state.ts';
import type { PlaytestEventStore } from './playtest-events.ts';

export interface PlaytestControllerOptions {
  getState(): State;
  getSeat(): number;
  getMode(): RuleMode;
  setState(s: State): void;
  requestRender(): void;
  now?: () => number;
}

const FLOW_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  'VOTE', 'COUNCIL_VETO', 'DUEL_SUBMIT_CARD',
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ABSTAIN', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'CERTIFY_ANSWER',
]);

function sortedEntries(value: Readonly<Record<string, unknown>>): [string, unknown][] {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

/** 排除日志与随机源，保证同一阻塞局面在 forfeit 前后签名不变。 */
function stateSignature(state: State): string {
  return JSON.stringify({
    round: state.round,
    turnIndex: state.turnIndex,
    phase: state.phase,
    players: state.players.map((p) => ({
      seat: p.seat,
      controlledBy: p.controlledBy,
      alive: p.alive,
      position: p.position,
      pendingCert: p.pendingCert,
      statuses: sortedEntries(p.statuses),
      flags: sortedEntries(p.flags),
    })),
    certification: state.certification,
    council: state.council,
    duel: state.duel,
    // 关隘与封路印都挂在棋盘格上；位置与格面合起来表示当前阻塞。
    board: state.board,
  });
}

function isFlowAction(action: Action): boolean {
  return FLOW_ACTIONS.has(action.type);
}

/** DOM 无关的实拍调度器：只推进 AI 座位，并采集动作/接管墙钟。 */
export class PlaytestController {
  readonly store: PlaytestEventStore;
  private readonly options: PlaytestControllerOptions;
  private readonly now: () => number;
  private turnKey: string | null = null;
  private turnStartedAt = 0;
  private scheduled = false;
  private running = false;
  private readonly forfeitedSignatures = new Set<string>();

  constructor(options: PlaytestControllerOptions, store: PlaytestEventStore) {
    this.options = options;
    this.store = store;
    this.now = options.now ?? (() => performance.now());
  }

  getSeat(): number {
    return this.options.getSeat();
  }

  afterRender(state: State): void {
    this.store.setSnapshot(stateToJson(state));
    if (state.outcome.finished || this.running) { return; }

    const seat = currentPlayer(state);
    const turnKey = `${String(state.round)}:${String(state.turnIndex)}:${String(seat)}`;
    if (turnKey !== this.turnKey) {
      this.turnKey = turnKey;
      this.turnStartedAt = this.now();
    }
    if (this.scheduled) { return; }

    const aiSeat = this.schedulableSeat(state, seat);
    if (aiSeat === null || this.forfeitedSignatures.has(stateSignature(state))) { return; }

    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.running = true;
      try {
        const latest = this.options.getState();
        if (latest.outcome.finished) { return; }
        const latestSeat = this.schedulableSeat(latest, currentPlayer(latest));
        if (latestSeat === null || this.forfeitedSignatures.has(stateSignature(latest))) { return; }
        this.stepAi(latest, latestSeat);
      } finally {
        this.running = false;
      }
    }, 0);
  }

  captureHumanClick(control: string, target: HTMLElement): void {
    if (typeof target.closest === 'function'
      && target.closest('.playtest-panel, .toolbar') !== null) {
      return;
    }
    const seat = this.options.getSeat();
    const state = this.options.getState();
    if (isAiSeat(state, seat)) {
      this.store.record({ type: 'human_takeover_click', seat, control });
      return;
    }
    if (this.turnKey === null) { return; }
    const [round, turnIndex] = this.turnKey.split(':');
    this.store.record({
      type: 'human_turn_duration_ms',
      round: Number(round),
      turnIndex: Number(turnIndex),
      seat,
      durationMs: Math.max(0, this.now() - this.turnStartedAt),
    });
  }

  private schedulableSeat(state: State, currentSeat: number): number | null {
    if (isAiSeat(state, currentSeat)) { return currentSeat; }
    for (const player of state.players) {
      if (!isAiSeat(state, player.seat) || !player.alive) { continue; }
      if (getLegalActions(state, player.seat).some(isFlowAction)) { return player.seat; }
    }
    return null;
  }

  private stepAi(state: State, seat: number): void {
    const round = state.round;
    const turnIndex = state.turnIndex;
    this.store.record({ type: 'ai_turn_start', round, turnIndex, seat });
    const start = this.now();
    const result = runSeatStep(state, seat, heuristicPolicy, this.options.getMode());
    const durationMs = Math.max(0, this.now() - start);
    this.store.record({ type: 'ai_turn_duration_ms', round, turnIndex, seat, durationMs });
    if (result.accepted && result.action !== null) {
      this.store.record({
        type: 'ai_action_committed', round, turnIndex, seat,
        actionKey: actionKey(result.action), durationMs,
        degradeLevel: result.degradeLevel, seatMode: 'seat_filled_by_ai',
        legal: true, source: 'heuristic',
      });
    } else {
      this.forfeitedSignatures.add(stateSignature(state));
      this.store.record({
        type: 'ai_forfeit', round, turnIndex, seat,
        reason: result.reason, durationMs, seatMode: 'seat_filled_by_ai',
      });
    }
    this.options.setState(result.state);
    this.store.setSnapshot(stateToJson(result.state));
    // requestRender 可能同步回调 afterRender；先释放运行锁，让它处理 AI 行动后的新局面。
    this.running = false;
    this.options.requestRender();
  }
}
