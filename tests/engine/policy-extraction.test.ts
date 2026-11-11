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

test('run.mjs 不再保留被搬走的定义（防漏搬/防回流；含箭头函数回流）', () => {
  const src = readFileSync('tests/sim/run.mjs', 'utf8');
  for (const name of MOVED) {
    // ⚠️ B73：旧正则只认 `function name(` ⇒ `const name = (...) =>` / `name = function` 这类回流抓不到。
    const decl = new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\s*\\(`, 'm');
    const assign = new RegExp(
      `^\\s*(export\\s+)?(const|let|var)?\\s*${name}\\s*=\\s*(async\\s+)?(\\(|function\\b|[A-Za-z_$])`, 'm');
    assert.equal(decl.test(src) || assign.test(src), false, `run.mjs 仍定义 ${name}`);
  }
});

test('policy.mjs 不 import run.mjs（防循环依赖 + 防 import 时误跑主流程）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /from\s+['"][^'"]*run\.mjs['"]/);
  assert.doesNotMatch(src, /require\([^)]*run\.mjs/);
});

/** 去掉行注释与块注释（B73：`src.includes` 会被注释里提一次名字骗红 ⇒ 只在**代码**里查标识符）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('两个死函数已删除（B18 委托引擎后零调用方；只在代码里查，注释不算）', () => {
  for (const f of ['tests/sim/run.mjs', 'tests/sim/policy.mjs']) {
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const dead of ['pickDuelCard', 'resolveDuelByAI']) {
      const re = new RegExp('\\b' + dead + '\\b');
      assert.equal(re.test(code), false, `${f} 的代码里仍含 ${dead}`);
    }
  }
});

test('缺省等价：省略后两参 与 显式传 undefined 结果逐字相同 + 两条硬契约（async / 5 参）', async () => {
  const { playOne } = await import('../../tests/sim/policy.mjs');
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));
  // ⚠️ B70 修 round 1（评审 I-2）：下面的 deepEqual 在 JS 语义下恒成立（缺省与显式 undefined 同值），
  //   它守的是「第 5 参不改变行为」，但**不能**独立失败。交付物的两条硬契约必须另有断言：
  //   ① playOne 是 async ⇒ 返回 Promise（Task 3 注入模型策略要 await 它）；
  //   ② 签名保持 5 参（B70 Task 3 已加第 5 参 `policy` ⇒ **不得写默认值、不得改成 rest**：
  //      `Function.length` 遇到第一个带默认值/rest 的形参就停止计数，写了本条守护当场失效）。
  const pending = playOne(theme, 4, 4242);
  assert.ok(pending instanceof Promise, 'playOne 必须返回 Promise（async 契约）');
  assert.equal(playOne.length, 5, 'playOne 形参数必须恰为 5：theme, players, seed, gateReserve, policy');
  const a = await pending;
  const b = await playOne(theme, 4, 4242, undefined, undefined);
  assert.deepEqual({ winners: a.winners, rounds: a.rounds, reason: a.reason },
                   { winners: b.winners, rounds: b.rounds, reason: b.reason });
});
