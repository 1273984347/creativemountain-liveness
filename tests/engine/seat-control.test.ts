import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, isAiSeat, type State } from '../../engine/core/state.ts';
import { deserializeState, serializeState, stateFromJson, stateToJson } from '../../engine/core/serialize.ts';

test('新建状态所有座位 controlledBy=human', () => {
  const s = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  assert.deepEqual(s.players.map((p) => p.controlledBy), ['human', 'human', 'human', 'human']);
});

test('controlledBy=ai 可序列化并原样还原', () => {
  const base = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  const s: State = {
    ...base,
    players: base.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' } : p),
  };
  const restored = stateFromJson(stateToJson(s));
  assert.equal(restored.players[2]?.controlledBy, 'ai');
  assert.equal(restored.players[0]?.controlledBy, 'human');
});

test('isAiSeat 仅将显式 ai 座位判为程序控制，越界座位为 false', () => {
  const base = createInitialState({ players: 4, seed: 7, deckSize: 48 });
  const s: State = {
    ...base,
    players: base.players.map((p) => p.seat === 2 ? { ...p, controlledBy: 'ai' } : p),
  };
  assert.equal(isAiSeat(s, 0), false);
  assert.equal(isAiSeat(s, 2), true);
  assert.equal(isAiSeat(s, 99), false);
});

test('旧存档缺 controlledBy 时按 human 归一化，不抛错', () => {
  const base = createInitialState({ players: 3, seed: 9, deckSize: 40 });
  const raw = serializeState(base) as unknown as {
    state: { players: Array<Record<string, unknown>> };
  };
  delete raw.state.players[0]!.controlledBy;
  const restored = deserializeState(raw);
  assert.equal(restored.players[0]?.controlledBy, 'human');
});
