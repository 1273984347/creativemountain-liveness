import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED, MAX_SEED, parseSeed } from '../../web/seed.ts';

test('seed 解析：空/空白/负数/小数/科学计数/超 uint32 一律拒绝', () => {
  for (const raw of ['', '   ', '-1', '1.5', '1e3', '0x10', '4294967296', 'abc']) {
    assert.equal(parseSeed(raw), null, `必须拒绝：${JSON.stringify(raw)}`);
  }
});

test('seed 解析：0、42、uint32 上限与首尾空白可接受', () => {
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed('42'), 42);
  assert.equal(parseSeed(' 123456 '), 123456);
  assert.equal(parseSeed(String(MAX_SEED)), MAX_SEED);
  assert.equal(DEFAULT_SEED, 42);
});
