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
  private humanTurnDurationRecorded = false;
  private scheduled = false;
  private running = false;
  private generation = 0;
  private readonly forfeitedSignatures = new Set<string>();

  constructor(options: PlaytestControllerOptions, store: PlaytestEventStore) {
    this.options = options;
    this.store = store;
    this.now = options.now ?? (() => performance.now());
  }

  getSeat(): number {
    return this.options.getSeat();
  }

  /** 新局/读档/导入前调用：旧排队步骤不得跨局执行，旧时钟与弃权签名一并作废。 */
  reset(): void {
    this.generation += 1;
    this.turnKey = null;
    this.turnStartedAt = 0;
    this.humanTurnDurationRecorded = false;
    this.scheduled = false;
    this.running = false;
    this.forfeitedSignatures.clear();
  }

  afterRender(state: State): void {
    this.store.setSnapshot(stateToJson(state));
    if (state.outcome.finished || this.running) { return; }

    const seat = currentPlayer(state);
    const turnKey = `${String(state.round)}:${String(state.turnIndex)}:${String(seat)}`;
    if (turnKey !== this.turnKey) {
      this.turnKey = turnKey;
      this.turnStartedAt = this.now();
      this.humanTurnDurationRecorded = false;
    }
    if (this.scheduled) { return; }

    const aiSeat = this.schedulableSeat(state, seat);
    if (aiSeat === null || this.forfeitedSignatures.has(stateSignature(state))) { return; }

    this.scheduled = true;
    const generation = this.generation;
    setTimeout(() => {
      if (generation !== this.generation) { return; }
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
    if (this.turnKey === null || this.humanTurnDurationRecorded) { return; }
    const [round, turnIndex] = this.turnKey.split(':');
    this.store.record({
      type: 'human_turn_duration_ms',
      round: Number(round),
      turnIndex: Number(turnIndex),
      seat,
      durationMs: Math.max(0, this.now() - this.turnStartedAt),
    });
    this.humanTurnDurationRecorded = true;
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
    const result = runSeatStep(state, seat, heuristicPolicy, this.options.getMode());
    const turnKey = `${String(round)}:${String(turnIndex)}:${String(seat)}`;
    // 当前手番度量的是玩家从轮转到 AI 动作落账的体验等待，包含调度/渲染延迟。
    // 非当前手番的山议/认证流程候选没有对应手番起点：不写 D1 样本，动作事件 durationMs=0。
    const currentTurn = this.turnKey === turnKey;
    const durationMs = currentTurn ? Math.max(0, this.now() - this.turnStartedAt) : 0;
    if (currentTurn) {
      this.store.record({ type: 'ai_turn_duration_ms', round, turnIndex, seat, durationMs });
    }
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
