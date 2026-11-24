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

test('真人同一手番多次点击只记录一次耗时，AI 每次点击都记录接管', () => {
  let state = aiState();
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 1 };
  let operatorSeat = 0;
  let t = 100;
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => operatorSeat, getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => t,
  }, store);
  c.afterRender(state);
  t = 250;
  c.captureHumanClick('card:first', {} as HTMLElement);
  t = 400;
  c.captureHumanClick('target-seat:1', {} as HTMLElement);

  operatorSeat = 2;
  t = 450;
  c.captureHumanClick('card:ai-first', {} as HTMLElement);
  t = 500;
  c.captureHumanClick('target-seat:1', {} as HTMLElement);

  operatorSeat = 1;
  state = { ...state, turnIndex: 2 };
  t = 600;
  c.afterRender(state);
  t = 650;
  c.captureHumanClick('card:next-turn', {} as HTMLElement);

  const recorded = events(store);
  assert.deepEqual(recorded.filter((e) => e.type === 'human_turn_duration_ms').map((e) => ({
    turnIndex: e.turnIndex, seat: e.seat, durationMs: e.durationMs,
  })), [
    { turnIndex: 1, seat: 0, durationMs: 150 },
    { turnIndex: 2, seat: 1, durationMs: 50 },
  ]);
  assert.deepEqual(recorded.filter((e) => e.type === 'human_takeover_click').map((e) => e.control),
    ['card:ai-first', 'target-seat:1']);
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
  assert.equal(events(store).some((event) => event.type === 'ai_turn_duration_ms'), false,
    '非当前手番流程候选不得写成 D1 的 0ms 手番样本');
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

test('AI 当前手番耗时从回合开始计到动作落账，包含调度等待而非仅计算耗时', async () => {
  let state = aiState();
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  // 100：回合开始；850：动作落账。体验等待应为 750，而非旧实现的 25ms 计算耗时。
  const readings = [100, 850];
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {},
    now: () => readings.shift() ?? 850,
  }, store);
  c.afterRender(state);
  await tick();
  assert.equal(events(store).find((e) => e.type === 'ai_turn_duration_ms')?.durationMs, 750);
  assert.equal(events(store).find((e) => e.type === 'ai_action_committed')?.durationMs, 750);
});

test('新局 reset 取消已排队 AI 步骤并清空旧手番时钟', async () => {
  let state = aiState();
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  let t = 100;
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; }, requestRender: () => {}, now: () => t,
  }, store);
  c.afterRender(state);
  c.reset();
  t = 500;
  await tick();
  assert.deepEqual(events(store), []);
  assert.equal(state.turnIndex, 0);

  state = { ...state, turnIndex: 1 };
  c.afterRender(state);
  t = 650;
  c.captureHumanClick('问天', {} as HTMLElement);
  assert.equal(events(store).find((e) => e.type === 'human_turn_duration_ms')?.durationMs, 150);
});

test('同步重渲染按 AI 行动后的真人手番记录墙钟', async () => {
  let state = aiState();
  state = { ...state, turnOrder: [2, 0, 1, 3, 4, 5], turnIndex: 0 };
  let t = 100;
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; },
    requestRender: () => { t = 200; c.afterRender(state); },
    now: () => t,
  }, store);
  c.afterRender(state);
  await tick();
  t = 250;
  c.captureHumanClick('问天', {} as HTMLElement);
  const duration = events(store).find((e) => e.type === 'human_turn_duration_ms');
  assert.deepEqual(duration, {
    type: 'human_turn_duration_ms', round: 1, turnIndex: 1, seat: 0,
    durationMs: 50, seq: duration?.seq, ts: duration?.ts,
  });
});

test('同步重渲染无需额外渲染即可调度后续 AI 流程候选', async () => {
  const base = councilScene(6, 7);
  let state: State = {
    ...base,
    players: base.players.map((p) => p.seat === 2 || p.seat === 3
      ? { ...p, controlledBy: 'ai' as const }
      : p),
  };
  let renderCount = 0;
  const store = new PlaytestEventStore({ seed: 7, aiSeat: 2 });
  const c = new PlaytestController({
    getState: () => state, getSeat: () => currentPlayer(state), getMode: () => 'standard',
    setState: (s) => { state = s; },
    requestRender: () => { renderCount += 1; c.afterRender(state); },
    now: () => 0,
  }, store);
  c.afterRender(state);
  await tick();
  await tick();
  const committed = events(store).filter((e) => e.type === 'ai_action_committed');
  assert.deepEqual(committed.map((e) => e.seat), [2, 3]);
  assert.equal(renderCount, 2);
  assert.equal(state.council.votes[2] !== undefined, true);
  assert.equal(state.council.votes[3] !== undefined, true);
});
