// tests/engine/action-key.test.ts
// 动作 ↔ key 的可逆编码守卫：往返等价、key 互异、非法 key 必抛错（只认规范形，绝不猜）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionKey, actionFromKey, withActor } from '../../engine/core/action-key.ts';
import type { Action } from '../../engine/core/action.ts';

const SAMPLES: Action[] = [
  { type: 'MOVE', actor: 0, steps: 0 },
  { type: 'ROLL_WHEEL', actor: 2 },
  { type: 'PASS', actor: 3 },
  { type: 'COMPARE', actor: 3, cardId: 'c_gate_trial', target: 1 },
  { type: 'PLAY_CARD', actor: 0, cardId: 'c_windstep' },
  { type: 'PLAY_CARD', actor: 0, cardId: 'c_fang', target: 3 },
  { type: 'ABILITY', actor: 1, abilityId: 'peek_deck' },
  { type: 'ABILITY', actor: 1, abilityId: 'transfer_resource', target: 4 },
  { type: 'VOTE', actor: 5, target: 2 },
  { type: 'CERTIFY_SIGN', actor: 1, target: 0 },
  { type: 'CERTIFY_CHALLENGE', actor: 1, target: 0 },
  { type: 'CERTIFY_ABSTAIN', actor: 1, target: 0 },
  { type: 'CERTIFY_APPEAL', actor: 0, target: 0 },
  { type: 'CERTIFY_APPEAL_VOTE', actor: 1, target: 0, overturn: true },
  { type: 'CERTIFY_APPEAL_VOTE', actor: 1, target: 0, overturn: false },
  { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: true },
  { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: false },
];

test('key 往返：withActor(decode(encode(a)), a.actor) 与 a 等价', () => {
  for (const a of SAMPLES) {
    assert.deepEqual(withActor(actionFromKey(actionKey(a)), a.actor), a, `往返失败：${actionKey(a)}`);
  }
});

test('key 唯一：SAMPLES 互不相同 ⇒ key 集合大小相等（actor 不入 key）', () => {
  const keys = SAMPLES.map((a) => actionKey(a));
  // 样本数钉死：B15 契约修正后复议票（overturn 对）与应答（passed 对）各占两条，共 17 条。
  // 少一条 ⇒ 断言会因 keys.length 同步变小而空转，故必须先固定样本总数。
  assert.equal(keys.length, 17, '样本被误删，唯一性断言失去覆盖面');
  assert.equal(new Set(keys).size, keys.length, `key 撞车：${keys.join(' | ')}`);
});

test('play 两式互异 + key 自洽：需选目标的牌打不同座位不得塌成同一 key', () => {
  // 设计 §5 的 key 文法同时有 `play:<cardId>` 与 `play:<cardId>-><seat>` 两式；
  // 若 Action 的 PLAY_CARD 缺 target，出牌就丢掉了「打谁」这一维（key 塌车 ⇒ 模型无法表达）。
  const base = { type: 'PLAY_CARD', actor: 0, cardId: 'c_fang' } as const;
  const variants = [base, { ...base, target: 1 }, { ...base, target: 2 }];
  assert.deepEqual(variants.map((a) => actionKey(a)), ['play:c_fang', 'play:c_fang->1', 'play:c_fang->2']);
  // decode∘encode 必须回到原 key（规范形）：任何一段被静默丢弃都会在此现形。
  for (const key of [...SAMPLES.map((a) => actionKey(a)), ...variants.map((a) => actionKey(a))]) {
    assert.equal(actionKey(actionFromKey(key)), key, `key 非规范形：${key}`);
  }
});

test('未知 key 必须抛错，绝不猜', () => {
  // 第 1 组（基线）：整段拼错/缺段。
  // 第 2 组（§3.2 缺陷类）：缺 id 段（'ability'）/ 空 id（'play:'）/ 缺标志位 / 标志位拼错。
  // 第 3 组（评审复核项，Ruling B）：**截断**与**多余尾段**——
  //   `Number('') === 0` 会让 `vote:`、`cert:sign:`、`play:c_fang->`、`gate:x->` 编造出座位 0，
  //   `play:->3` 编造出空 id，`move:junk`/`…:overturn:junk` 把尾段静默丢弃。
  //   这些 key 在 Task 7 漂移守卫与 Task 15 探针里来自**模型输出**，
  //   编造出一个合法动作就是正确性 bug（会绕过引擎的「未选目标 ⇒ 不出牌」守卫），不是风格问题。
  for (const bad of ['bogus:1', 'cert:whatever:0', 'vote:xx', 'play',
    'ability', 'play:', 'cert:answer:0', 'cert:appealvote:0:yes',
    'vote:', 'cert:sign:', 'play:c_fang->', 'gate:x->', 'play:->3', 'move:junk',
    'cert:appealvote:0:overturn:junk']) {
    assert.throws(() => actionFromKey(bad), /key|动作/, `未抛错：${bad}`);
  }
});

test('规范形正例：0 号座位与各文法正形仍是合法 key（收紧不得误伤规范形）', () => {
  // 反例收紧后必须有正例钉住边界：target 为 0 是合法座位，不是「缺段」。
  const CANONICAL: Array<[string, Action]> = [
    ['move', { type: 'MOVE', actor: -1, steps: 0 }],
    ['ask', { type: 'ROLL_WHEEL', actor: -1 }],
    ['pass', { type: 'PASS', actor: -1 }],
    ['vote:0', { type: 'VOTE', actor: -1, target: 0 }],
    ['play:c_windstep', { type: 'PLAY_CARD', actor: -1, cardId: 'c_windstep' }],
    ['play:c_fang->0', { type: 'PLAY_CARD', actor: -1, cardId: 'c_fang', target: 0 }],
    ['ability:transfer_resource->0', { type: 'ABILITY', actor: -1, abilityId: 'transfer_resource', target: 0 }],
    ['gate:c_gate_trial->0', { type: 'COMPARE', actor: -1, cardId: 'c_gate_trial', target: 0 }],
    ['cert:sign:0', { type: 'CERTIFY_SIGN', actor: -1, target: 0 }],
    ['cert:appealvote:0:uphold', { type: 'CERTIFY_APPEAL_VOTE', actor: -1, target: 0, overturn: false }],
    ['cert:answer:1:pass', { type: 'CERTIFY_ANSWER', actor: -1, target: 1, passed: true }],
  ];
  for (const [key, expected] of CANONICAL) {
    assert.deepEqual(actionFromKey(key), expected, `规范形反解失败：${key}`);
    assert.equal(actionKey(actionFromKey(key)), key, `规范形往返失败：${key}`);
  }
});
