import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaytestController } from '../../web/playtest-controller.ts';
import { PlaytestEventStore, type PlaytestEvent } from '../../web/playtest-events.ts';
import { mk, councilScene, gateScene } from '../engine/fixtures.ts';
import type { State } from '../../engine/core/state.ts';
import { currentPlayer } from '../../engine/core/round.ts';

type StoredEvent = PlaytestEvent & { readonly seq: number; readonly ts: number };

function aiState(): State {
  const s = mk(6, 7);
  return { ...s, players: s.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' } : p) };
}

function events(store: PlaytestEventStore): StoredEvent[] {
  return (store.toJSON() as { events: StoredEvent[] }).events;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function targetInside(selector: string): HTMLElement {
  return { closest: (value: string) => value.split(', ').includes(selector) ? {} : null } as unknown as HTMLElement;
}

test('AI 座位在合法候选出现时自动走 runSeatStep，并记录动作前回合与墙钟', async () => {
  let state = aiState();
  let t = 100;
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; },
    requestRender: () => {},
    now: () => t,
  }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  await tick();
  const event = events(store).find((e) => e.type === 'ai_action_committed');
  assert.ok(event);
  assert.equal(event.round, 1);
  assert.equal(event.turnIndex, 0);
  assert.equal(event.durationMs, 0);
  assert.equal(event.seat, 2);
  assert.equal(event.legal, true);
  assert.equal(event.source, 'heuristic');
  assert.equal(event.seatMode, 'seat_filled_by_ai');
  assert.ok(event.actionKey.length > 0);
  assert.deepEqual(events(store).map((e) => e.type), [
    'ai_turn_start', 'ai_turn_duration_ms', 'ai_action_committed',
  ]);
  const duration = events(store).find((e) => e.type === 'ai_turn_duration_ms');
  assert.deepEqual(duration, {
    type: 'ai_turn_duration_ms', round: 1, turnIndex: 0, seat: 2, durationMs: 0, seq: 1, ts: duration?.ts,
  });
  const snapshot = JSON.parse((store.toJSON() as { snapshot: string }).snapshot) as {
    state: { turnIndex: number };
  };
  assert.equal(snapshot.state.turnIndex, 1);
  assert.ok(state.log.length > 0);
  assert.equal(state.log.some((entry) => 'durationMs' in entry || entry.kind === 'ai_turn_duration_ms'), false);
});

test('同一局面签名上的 forfeit 不重复调度，状态变化后允许新签名', async () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 0,
  }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0,
    players: state.players.map((p) => p.seat === 2
      ? { ...p, controlledBy: 'ai', pendingCert: true, hand: [] }
      : p) };
  c.afterRender(state);
  await tick();
  c.afterRender(state);
  await tick();
  assert.equal(events(store).filter((e) => e.type === 'ai_forfeit').length, 1);
  const forfeit = events(store).find((e) => e.type === 'ai_forfeit');
  assert.equal(forfeit?.seatMode, 'seat_filled_by_ai');
  assert.equal(forfeit?.reason, 'blocked');

  state = { ...state, players: state.players.map((p) => p.seat === 2
    ? { ...p, statuses: { ...p.statuses, silence: 1 } }
    : p) };
  c.afterRender(state);
  await tick();
  assert.equal(events(store).filter((e) => e.type === 'ai_forfeit').length, 2);
});

test('点击 AI 座位控件记录 human_takeover_click，点击真人控件记录人类手番耗时', () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  let t = 0;
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => t,
  }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  c.captureHumanClick('行棋', {} as HTMLElement);
  t = 500;
  state = { ...state, turnIndex: 1 };
  c.afterRender(state);
  t = 1000;
  c.captureHumanClick('问天', {} as HTMLElement);
  const recorded = events(store);
  assert.ok(recorded.some((e) => e.type === 'human_takeover_click' && e.seat === 2 && e.control === '行棋'));
  assert.ok(recorded.some((e) => e.type === 'human_turn_duration_ms'
    && e.seat === 0 && e.round === 1 && e.turnIndex === 1 && e.durationMs === 500));
});

test('实拍面板和工具栏内点击不记录接管或耗时', () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 10,
  }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  c.captureHumanClick('导出', targetInside('.playtest-panel'));
  c.captureHumanClick('新开一局', targetInside('.toolbar'));
  assert.deepEqual(events(store), []);
});

test('真人当前手番时不会调度 AI 的普通行动面候选', async () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => 0, getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 0,
  }, store);
  c.afterRender(state);
  await tick();
  assert.deepEqual(events(store), []);
  assert.equal(state.turnIndex, 0);
});

test('AI 的非当前手番流程候选可以自动执行', async () => {
  const base = councilScene(6, 7);
  let state: State = { ...base, players: base.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' as const } : p) };
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => 0, getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 0,
  }, store);
  assert.equal(currentPlayer(state), 0);
  c.afterRender(state);
  await tick();
  const committed = events(store).find((e) => e.type === 'ai_action_committed');
  assert.ok(committed);
  assert.equal(committed.seat, 2);
  assert.match(committed.actionKey, /^vote:/);
  assert.equal(state.council.votes[2] !== undefined, true);
});

test('AI 的非当前手番关隘候选不会被调度', async () => {
  const base = gateScene(6, 7, 3, 2);
  let state: State = { ...base, players: base.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' as const } : p) };
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => 0, getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 0,
  }, store);
  c.afterRender(state);
  await tick();
  assert.deepEqual(events(store), []);
  assert.equal(state.players[2]?.position, 3);
});

test('排队期间手番已变化时使用最新局面，不提交过期的 AI 行动', async () => {
  let state = aiState();
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => 0,
  }, store);
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  c.afterRender(state);
  state = { ...state, turnIndex: 1 };
  c.afterRender(state);
  await tick();
  assert.deepEqual(events(store), []);
  assert.equal(state.turnIndex, 1);
  assert.equal(state.log.length, 0);
});

test('AI 单步墙钟记录 runSeatStep 的真实耗时', async () => {
  let state = aiState();
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  const readings = [100, 125, 150];
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {},
    now: () => readings.shift() ?? 150,
  }, store);
  c.afterRender(state);
  await tick();
  assert.equal(events(store).find((e) => e.type === 'ai_turn_duration_ms')?.durationMs, 25);
  assert.equal(events(store).find((e) => e.type === 'ai_action_committed')?.durationMs, 25);
});

