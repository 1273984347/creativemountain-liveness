import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlaytestEventStore,
  parsePlaytestConfig,
} from '../../web/playtest-events.ts';
import type { PlaytestConfig, PlaytestEvent } from '../../web/playtest-events.ts';

type StoredEvent = PlaytestEvent & { readonly seq: number; readonly ts: number };
interface PlaytestExport {
  schema: number;
  config: PlaytestConfig;
  metadata: { themeId: string; players: number; mode: string } | null;
  events: StoredEvent[];
  snapshot: string | null;
}

test('实拍配置：必须显式 playtest=1 + 合法 seed + 0..5 的 aiSeat', () => {
  assert.deepEqual(parsePlaytestConfig('playtest=1&seed=123456&aiSeat=2'),
    { seed: 123456, aiSeat: 2 });
  assert.deepEqual(parsePlaytestConfig('?playtest=1&seed=0&aiSeat=0'),
    { seed: 0, aiSeat: 0 });
  assert.deepEqual(parsePlaytestConfig('playtest=1&seed=4294967295&aiSeat=5'),
    { seed: 4294967295, aiSeat: 5 });

  for (const q of [
    '', '?', 'seed=1&aiSeat=2', 'playtest=0&seed=1&aiSeat=2',
    'playtest=true&seed=1&aiSeat=2', 'playtest=01&seed=1&aiSeat=2',
    'playtest=1&aiSeat=2', 'playtest=1&seed=1',
    'playtest=1&seed=-1&aiSeat=2', 'playtest=1&seed=1.5&aiSeat=2',
    'playtest=1&seed=1e3&aiSeat=2', 'playtest=1&seed=0x10&aiSeat=2',
    'playtest=1&seed=4294967296&aiSeat=2', 'playtest=1&seed=&aiSeat=2',
    'playtest=1&seed=abc&aiSeat=2', 'playtest=1&seed=1&aiSeat=-1',
    'playtest=1&seed=1&aiSeat=6', 'playtest=1&seed=1&aiSeat=1.5',
    'playtest=1&seed=1&aiSeat=1e0', 'playtest=1&seed=1&aiSeat=0x2',
    'playtest=1&seed=1&aiSeat=x', 'playtest=1&seed=1&aiSeat=',
  ]) {
    assert.equal(parsePlaytestConfig(q), null, q);
  }
});

test('事件表：导出包含 schema、配置、元数据与快照，更新后取最新值', () => {
  const config = { seed: 7, aiSeat: 2 };
  const store = new PlaytestEventStore(config);
  assert.deepEqual(store.toJSON(), {
    schema: 1, config, metadata: null, events: [], snapshot: null,
  });

  store.setMetadata({ themeId: 'default', players: 6, mode: 'standard' });
  store.setSnapshot('{"round":1}');
  store.setMetadata({ themeId: 'mountain', players: 6, mode: 'quick' });
  store.setSnapshot('{"round":2}');

  const data = store.toJSON() as PlaytestExport;
  assert.equal(data.schema, 1);
  assert.deepEqual(data.config, config);
  assert.deepEqual(data.metadata, { themeId: 'mountain', players: 6, mode: 'quick' });
  assert.equal(data.snapshot, '{"round":2}');
});

test('事件表：保留全部事件字段并补 seq 与 Date.now 时间戳', () => {
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const events: PlaytestEvent[] = [
    { type: 'game_start', seed: 7, aiSeat: 2 },
    { type: 'ai_turn_start', round: 1, turnIndex: 0, seat: 2 },
    { type: 'ai_action_committed', round: 1, turnIndex: 0, seat: 2,
      actionKey: 'play:card-1', durationMs: 25, degradeLevel: 1,
      seatMode: 'seat_filled_by_ai' },
    { type: 'ai_turn_duration_ms', round: 1, turnIndex: 0, seat: 2, durationMs: 25 },
    { type: 'ai_forfeit', round: 2, turnIndex: 1, seat: 2, reason: 'no_legal_action',
      durationMs: 10, seatMode: 'seat_filled_by_ai' },
    { type: 'human_turn_duration_ms', round: 2, turnIndex: 2, seat: 0, durationMs: 800 },
    { type: 'human_takeover_click', seat: 2, control: '行棋' },
    { type: 'table_attention_peak', anchorRound: 3, anchorLogIndex: 9,
      focusSeat: 1, durationSec: 4 },
    { type: 'gaze_panel', seat: 1, durationMs: 1200 },
    { type: 'post_game_poll', seat: 1, wantHumanBack: true, wouldReplay: 4,
      feltRobotic: 2, recalledPeakCount: 3, oneLineAnomaly: '接管提示出现得稍晚' },
  ];

  const before = Date.now();
  const returned = store.record(events[0]!) as StoredEvent;
  const after = Date.now();
  assert.equal(returned.seq, 0);
  assert.ok(Number.isInteger(returned.ts));
  assert.ok(returned.ts >= before && returned.ts <= after);
  for (const event of events.slice(1)) store.record(event);

  const data = store.toJSON() as PlaytestExport;
  assert.deepEqual(data.events.map((event) => event.seq), events.map((_, index) => index));
  assert.deepEqual(data.events.map((event) => ({ ...event, seq: 0, ts: 0 })),
    events.map((event) => ({ ...event, seq: 0, ts: 0 })));
});

test('事件表：reset 清空事件与 seq，但保留配置', () => {
  const config = { seed: 7, aiSeat: 2 };
  const store = new PlaytestEventStore(config);
  store.record({ type: 'human_takeover_click', seat: 2, control: '行棋' });
  store.record({ type: 'table_attention_peak', anchorRound: 3, anchorLogIndex: 9,
    focusSeat: 1, durationSec: 4 });

  store.reset();
  const data = store.toJSON() as PlaytestExport;
  assert.deepEqual(data.config, config);
  assert.deepEqual(data.events, []);

  const next = store.record({ type: 'gaze_panel', seat: 1, durationMs: 50 }) as StoredEvent;
  assert.equal(next.seq, 0);
});
