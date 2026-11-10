// tests/engine/key-normalize.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLegacyKey } from '../../tools/laya-probe/key-normalize.mjs';

test('历史 duel_card: 归一化为规范形', () => {
  assert.equal(normalizeLegacyKey('duel_card:c_windstep'), 'duel:card:c_windstep');
});
test('已是规范形则不变', () => {
  assert.equal(normalizeLegacyKey('duel:card:c_windstep'), 'duel:card:c_windstep');
});
test('非对峙 key 一律不动', () => {
  for (const k of ['play:c_fang->3', 'cert:sign:0', 'move', 'ask', 'vote:2', 'cert:mutual:1']) {
    assert.equal(normalizeLegacyKey(k), k);
  }
});
test('记录器不再手拼 duel_card:（改用 actionKey）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /'duel_card:'\s*\+/);
  assert.match(src, /actionKey\(\{\s*type:\s*'DUEL_SUBMIT_CARD'/);
});
