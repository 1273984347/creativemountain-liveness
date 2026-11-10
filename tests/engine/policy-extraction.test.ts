// tests/engine/policy-extraction.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MOVED = ['checkState', 'pickTarget', 'councilTurn', 'certificationTurn',
  'maybeUseAbility', 'pickPlayableCard', 'playOne', 'advanceWithDuel', 'record'];

test('policy.mjs 存在且导出全部 9 个被搬函数', async () => {
  assert.ok(existsSync('tests/sim/policy.mjs'), 'policy.mjs 必须存在');
  const mod = await import('../../tests/sim/policy.mjs');
  // ⚠️ B70 落地补：policy.mjs 有 tests/sim/policy.d.mts 契约（门 ① 约定：被 .ts 引用的 .mjs
  //   必须配 .d.mts，见 B52 记录）⇒ 按字符串名遍历导出需显式收窄，否则 TS7053。运行时判定不变。
  const named = mod as Record<string, unknown>;
  for (const name of MOVED) { assert.equal(typeof named[name], 'function', `缺导出：${name}`); }
  assert.equal(typeof mod.setRecorder, 'function');
});

test('run.mjs 不再保留被搬走的定义（防漏搬/防回流）', () => {
  const src = readFileSync('tests/sim/run.mjs', 'utf8');
  for (const name of MOVED) {
    assert.equal(new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\s*\\(`, 'm').test(src), false,
      `run.mjs 仍定义 ${name}`);
  }
});

test('policy.mjs 不 import run.mjs（防循环依赖 + 防 import 时误跑主流程）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*run\.mjs['"]/);
  assert.doesNotMatch(src, /require\([^)]*run\.mjs/);
});

test('两个死函数已删除（B18 委托引擎后零调用方）', () => {
  for (const f of ['tests/sim/run.mjs', 'tests/sim/policy.mjs']) {
    const src = readFileSync(f, 'utf8');
    for (const dead of ['pickDuelCard', 'resolveDuelByAI']) {
      assert.equal(src.includes(dead), false, `${f} 仍含死代码 ${dead}`);
    }
  }
});

test('缺省等价：省略后两参 与 显式传 undefined 结果逐字相同', async () => {
  const { playOne } = await import('../../tests/sim/policy.mjs');
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));
  const a = await playOne(theme, 4, 4242);
  const b = await playOne(theme, 4, 4242, undefined, undefined);
  assert.deepEqual({ winners: a.winners, rounds: a.rounds, reason: a.reason },
                   { winners: b.winners, rounds: b.rounds, reason: b.reason });
});
