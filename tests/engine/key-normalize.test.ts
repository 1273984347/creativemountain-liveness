// tests/engine/key-normalize.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeLegacyKey } from '../../tools/laya-probe/key-normalize.mjs';
import { actionKey, actionFromKey } from '../../engine/core/action-key.ts';

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
// ⚠️ B73：边界与非字符串。旧实现 `String(key)` 会把 `undefined` 洗成 `'undefined'`（仓内纪律禁止），
//   且 `duel_card:`（无 id）/ `duel_card:a:b`（多段）会被「补前缀」成看着像规范形、实为非法 key 的串。
test('B73 边界：空串 / 无 id / 多段 —— 只做前缀替换，不做合法性修复', () => {
  assert.equal(normalizeLegacyKey(''), '');
  assert.equal(normalizeLegacyKey('duel_card'), 'duel_card');       // 无冒号 ⇒ 原样
  assert.equal(normalizeLegacyKey('duel_card:'), 'duel:card:');     // 维持字面前缀语义（非法由反解层拒）
  assert.equal(normalizeLegacyKey('duel_card:a:b'), 'duel:card:a:b');
  assert.throws(() => actionFromKey('duel:card:'));
  assert.throws(() => actionFromKey('duel:card:a:b'));
});
test('B73 非字符串一律抛错（不得把 undefined 洗成字符串）', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.throws(() => normalizeLegacyKey(bad as unknown as string), TypeError);
  }
});
test('记录器不再手拼 duel_card:（改用 actionKey）', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  assert.doesNotMatch(src, /'duel_card:'\s*\+/);
  assert.match(src, /actionKey\(\{\s*type:\s*'DUEL_SUBMIT_CARD'/);
});

// ⚠️ B70 修复轮 1（评审发现 I-1）：上面那条只是**源码文本守卫**，两类等价回归它都抓不住 ——
//   ① 模板串写法（反引号 + `${...}`）与双引号写法在语义上同样违规，但不匹配那个正则；
//   ② 该正则**分不清代码与注释**：文档 / 注释里逐字引用那句串也会让断言变绿
//     （本仓历史上真发生过：某份 `.d.mts` 的注释逐字抄过手拼串）。
//   ⇒ 下面两条把它升级成**行为守卫**：规范形由真函数钉住、旧形在反解层真的不被接受。
test('规范形由真函数钉住：对峙选牌的 actionKey 就是 duel:card:<id>', () => {
  const canonical = actionKey({ type: 'DUEL_SUBMIT_CARD', actor: 0, cardId: 'c_x' });
  assert.equal(canonical, 'duel:card:c_x');
  // 读侧归一化的目标形必须与写侧真函数**逐字符相同**（否则 P6 的两把尺又分家了）。
  assert.equal(normalizeLegacyKey('duel_card:c_x'), canonical);
});
test('反解层未被归一化污染：旧形 duel_card: 仍不是合法 key', () => {
  // 归一化只发生在读侧比较之前 ⇒ 不得把旧形洗白成引擎可接受的动作。
  assert.throws(() => actionFromKey('duel_card:c_x'));
  // 正向对照：规范形照常反解（防「因为实现崩了所以什么都抛 ⇒ 上面那条假绿」）。
  assert.deepEqual(actionFromKey('duel:card:c_x'), { type: 'DUEL_SUBMIT_CARD', actor: -1, cardId: 'c_x' });
});
