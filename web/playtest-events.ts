import { MAX_SEED, parseSeed } from './seed.ts';

export interface PlaytestConfig {
  readonly seed: number;
  readonly aiSeat: number;
}

export type PlaytestEvent =
  | { readonly type: 'game_start'; readonly seed: number; readonly aiSeat: number }
  | { readonly type: 'ai_turn_start'; readonly round: number; readonly turnIndex: number; readonly seat: number }
  | { readonly type: 'ai_action_committed'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly actionKey: string; readonly durationMs: number;
      readonly degradeLevel: 1 | 2 | 3; readonly seatMode: 'seat_filled_by_ai';
      readonly legal: boolean; readonly source: 'heuristic' | 'model' }
  | { readonly type: 'ai_turn_duration_ms'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly durationMs: number }
  | { readonly type: 'ai_forfeit'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly reason: string; readonly durationMs: number;
      readonly seatMode: 'seat_filled_by_ai' }
  | { readonly type: 'human_turn_duration_ms'; readonly round: number; readonly turnIndex: number;
      readonly seat: number; readonly durationMs: number }
  | { readonly type: 'human_takeover_click'; readonly seat: number; readonly control: string }
  | { readonly type: 'table_attention_peak'; readonly anchorRound: number;
      readonly anchorLogIndex: number; readonly focusSeat: number; readonly durationSec: number }
  | { readonly type: 'gaze_panel'; readonly seat: number; readonly durationMs: number }
  | { readonly type: 'post_game_poll'; readonly seat: number; readonly wantHumanBack: boolean;
      readonly wouldReplay: number; readonly feltHuman: number; readonly recalledPeakCount: number;
      readonly oneLineAnomaly: string };

interface PlaytestMetadata {
  readonly themeId: string;
  readonly players: number;
  readonly mode: string;
}

type RecordedPlaytestEvent = PlaytestEvent & {
  readonly seq: number;
  readonly ts: number;
};

export function parsePlaytestConfig(search: string): PlaytestConfig | null {
  const params = new URLSearchParams(search);
  if (params.get('playtest') !== '1') return null;

  const seed = parseSeed(params.get('seed') ?? '');
  const aiSeat = parseSeed(params.get('aiSeat') ?? '');
  if (seed === null || aiSeat === null || aiSeat > 5) return null;
  return { seed, aiSeat };
}

export class PlaytestEventStore {
  private readonly config: PlaytestConfig;
  private metadata: PlaytestMetadata | null = null;
  private snapshot: string | null = null;
  private events: RecordedPlaytestEvent[] = [];

  constructor(config: PlaytestConfig) {
    if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > MAX_SEED) {
      throw new Error('Invalid playtest config seed: expected uint32');
    }
    if (!Number.isInteger(config.aiSeat) || config.aiSeat < 0 || config.aiSeat > 5) {
      throw new Error('Invalid playtest config aiSeat: expected integer in 0..5');
    }
    this.config = { ...config };
  }

  record(event: PlaytestEvent): PlaytestEvent {
    if (event.type === 'table_attention_peak'
      && (!Number.isFinite(event.durationSec) || event.durationSec < 3)) {
      throw new Error('Invalid attention durationSec: expected at least 3 seconds');
    }
    if (event.type === 'post_game_poll') {
      if (this.events.some((recorded) => recorded.type === 'post_game_poll' && recorded.seat === event.seat)) {
        throw new Error('Post-game poll already submitted for seat ' + String(event.seat) + ' in this game');
      }
      if (!Number.isInteger(event.feltHuman) || event.feltHuman < 1 || event.feltHuman > 5) {
        throw new Error('Invalid poll feltHuman: expected integer in 1..5 (1=machine, 5=human)');
      }
    }
    const recorded: RecordedPlaytestEvent = {
      ...event,
      seq: this.events.length,
      ts: Date.now(),
    };
    this.events.push(recorded);
    return recorded;
  }

  setMetadata(metadata: { themeId: string; players: number; mode: string }): void {
    if (metadata.players !== 6) {
      throw new Error('Invalid playtest metadata players: expected 6');
    }
    this.metadata = { ...metadata };
  }

  setSnapshot(snapshot: string): void {
    this.snapshot = snapshot;
  }

  toJSON(): unknown {
    return {
      schema: 1,
      config: { ...this.config },
      metadata: this.metadata === null ? null : { ...this.metadata },
      events: this.events.map((event) => ({ ...event })),
      snapshot: this.snapshot,
    };
  }

  reset(): void {
    this.events = [];
    this.snapshot = null;
  }
}
