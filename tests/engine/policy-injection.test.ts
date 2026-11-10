// tests/engine/policy-injection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';

const theme = () => JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));

test('decide 返回 null ⇒ 回落启发式、对局正常结束、fallbacks 递增', async () => {
  const r = await playOne(theme(), 4, 4242, undefined, { face: 'play', seat: 0, decide: async () => null });
  assert.ok(r.rounds > 0);
  assert.ok(r.injection.calls > 0, '该面必须真的被问到');
  assert.equal(r.injection.fallbacks, r.injection.calls);
  assert.deepEqual(r.anomalies ?? [], []);
});

test('decide 抛错 / 返回非法 key ⇒ 同样回落且不死循环', async () => {
  for (const decide of [async () => { throw new Error('boom'); }, async () => 'bogus:key']) {
    const r = await playOne(theme(), 4, 4242, undefined, { face: 'council', seat: 0, decide });
    assert.ok(r.rounds > 0);
    assert.equal(r.injection.fallbacks, r.injection.calls);
  }
});

test('面隔离：face=council 时 play/certify 面不被调用', async () => {
  const seen: string[] = [];
  const r = await playOne(theme(), 4, 4242, undefined, {
    face: 'council', seat: 0,
    decide: async (_s, _seat, cands) => { seen.push(...cands.map((c) => c.type)); return null; },
  });
  assert.ok(r.injection.calls > 0);
  for (const t of seen) { assert.equal(t, 'VOTE', `越面调用：${t}`); }
});

test('decide 超时 ⇒ 回落（用 timeoutMs 缩短等待，避免测试真等 30s）', async () => {
  const r = await playOne(theme(), 4, 4242, undefined, {
    face: 'play', seat: 0, timeoutMs: 20,
    decide: () => new Promise(() => {}),        // 永不 resolve
  });
  assert.ok(r.rounds > 0, '超时必须回落，不得卡死');
  assert.equal(r.injection.fallbacks, r.injection.calls);
});

test('只有指定座位被问：seat=0 时 decide 收到的 seat 恒为 0', async () => {
  const seats = new Set<number>();
  await playOne(theme(), 4, 4242, undefined, {
    face: 'play', seat: 0, decide: async (_s, seat) => { seats.add(seat); return null; },
  });
  assert.deepEqual([...seats], [0]);
});

test('缺省 policy ⇒ injection 计数全 0，且结果与显式 undefined 相同', async () => {
  const a = await playOne(theme(), 4, 4242);
  const b = await playOne(theme(), 4, 4242, undefined, undefined);
  assert.deepEqual(a.injection, { calls: 0, fallbacks: 0, emptyCandidates: 0 });
  assert.deepEqual(a.winners, b.winners);
  assert.equal(a.reason, b.reason);
});
