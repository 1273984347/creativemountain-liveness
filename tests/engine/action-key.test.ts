// tests/engine/action-key.test.ts
// 动作 ↔ key 的可逆编码守卫：往返等价、key 互异、非法 key 必抛错（只认规范形，绝不猜）。
// ⚠️ 23 是当前**样本总数**，不等于 ActionType 的**成员数**（19）：复议票 / 应答各占两条真假样本，
//   PLAY_CARD 与 ABILITY 各占有无 target 两条。成员数由下方「根因守卫」从源码解析，不手抄。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  // ⚠️ B69：以下四条是「ActionType 有成员、SAMPLES 却没样本」的历史欠账（根因守卫一次照出四个）。
  //   GATE_RESOLVE / BARRIER_RESOLVE 反解早在（B18/B18-b），只是**从没人往返过**；
  //   CERTIFY_MUTUAL_SIGN（B67）与 DUEL_SUBMIT_CARD（B68）则是**反解分支真缺**⇒ 一探针就抛「未知动作 key」。
  { type: 'GATE_RESOLVE', actor: 2, channel: 'pay' },
  { type: 'BARRIER_RESOLVE', actor: 2, channel: 'place' },
  { type: 'CERTIFY_MUTUAL_SIGN', actor: 1, target: 0 },
  { type: 'DUEL_SUBMIT_CARD', actor: 0, cardId: 'c_windstep' },
  // ⚠️ B75：装备与否决（spec §4 / §6）—— `equip:<cardId>` 含牌 id 段，`council_veto` 是**单段无冒号**。
  { type: 'EQUIP_CARD', actor: 0, cardId: 'c_x' },
  { type: 'COUNCIL_VETO', actor: 0 },
  // ⚠️ B76：力竭恢复（单段自恢 / 两段救援各一条——根因守卫要求每个成员都有往返样本）。
  { type: 'RECUPERATE', actor: 0 },
  { type: 'RECUPERATE', actor: 0, target: 3 },
];

test('key 往返：withActor(decode(encode(a)), a.actor) 与 a 等价', () => {
  for (const a of SAMPLES) {
    assert.deepEqual(withActor(actionFromKey(actionKey(a)), a.actor), a, `往返失败：${actionKey(a)}`);
  }
});

test('key 唯一：SAMPLES 互不相同 ⇒ key 集合大小相等（actor 不入 key）', () => {
  const keys = SAMPLES.map((a) => actionKey(a));
  // 样本数钉死：B15 契约修正后复议票（overturn 对）与应答（passed 对）各占两条 = 17 条；
  // B69 补齐 ActionType 全成员覆盖（关隘通道 / 裂隙通道 / 互签 / 对峙选牌各一条）⇒ 21 条；
  // B75 装备与否决各一条 ⇒ 23 条；
  // B76 力竭恢复（自恢 / 救援各一条）⇒ 25 条。
  // 少一条 ⇒ 断言会因 keys.length 同步变小而空转，故必须先固定样本总数。
  assert.equal(keys.length, 25, '样本被误删，唯一性断言失去覆盖面');
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
  // 第 4 组（B69）：新增反解分支的**同款严格规范形**——
  //   `duel:card:`（空 id）/ `duel:card`（缺段）/ `duel:bogus:x`（kind 拼错）/ `duel:card:a:b`（多余尾段）；
  //   互签分支补齐后同样不得放宽：`cert:mutual:`（空座位）/ `cert:mutual:0:junk`（多余尾段）。
  // 第 5 组（B75）：装备（`equip:<cardId>`）与否决（`council_veto`）的同款严格形——
  //   空 id / 缺段 / 多余尾段；`council_veto` 是**单段无冒号**，带尾段即非规范形。
  for (const bad of ['bogus:1', 'cert:whatever:0', 'vote:xx', 'play',
    'ability', 'play:', 'cert:answer:0', 'cert:appealvote:0:yes',
    'vote:', 'cert:sign:', 'play:c_fang->', 'gate:x->', 'play:->3', 'move:junk',
    'cert:appealvote:0:overturn:junk',
    'duel:card:', 'duel:card', 'duel:bogus:x', 'duel:card:a:b',
    'cert:mutual:', 'cert:mutual:0:junk',
    'equip', 'equip:', 'equip:c_x:junk', 'council_veto:junk']) {
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
    // B69：三段文法（`gate:resolve` / `barrier:resolve` / `cert:mutual` / `duel:card`）的正形也要钉住
    //   ——收紧不得误伤规范形，尤其新补的两条反解分支。
    ['gate:resolve:trial', { type: 'GATE_RESOLVE', actor: -1, channel: 'trial' }],
    ['barrier:resolve:skip', { type: 'BARRIER_RESOLVE', actor: -1, channel: 'skip' }],
    ['cert:mutual:0', { type: 'CERTIFY_MUTUAL_SIGN', actor: -1, target: 0 }],
    ['duel:card:c_windstep', { type: 'DUEL_SUBMIT_CARD', actor: -1, cardId: 'c_windstep' }],
    // B75：装备两式无（只有带牌 id 一式），否决是**单段**文法。
    ['equip:c_x', { type: 'EQUIP_CARD', actor: -1, cardId: 'c_x' }],
    ['council_veto', { type: 'COUNCIL_VETO', actor: -1 }],
  ];
  for (const [key, expected] of CANONICAL) {
    assert.deepEqual(actionFromKey(key), expected, `规范形反解失败：${key}`);
    assert.equal(actionKey(actionFromKey(key)), key, `规范形往返失败：${key}`);
  }
});

test('根因守卫：ActionType 每个成员都在 SAMPLES 里有往返样本（新增动作漏测即红）', () => {
  // ⚠️ B69 根因：`actionKey` 的 switch 判别式是 `a.type` ⇒ **穷尽**，新增成员由 tsc 逼出分支；
  //   而 `decodeKey` 的 switch 判别式是**字符串头段** ⇒ tsc 管不着，新增成员可以静默漏反解。
  //   B67/B68 都只补了编码侧，本文件的 SAMPLES 又没跟着补 ⇒ 漏检一路放行到探针（P1.answerRate 0.9526）。
  //   ⇒ 本条守卫把「枚举成员」与「往返样本」钉成一对一：以后再加动作成员，不补样本立刻红。
  // ⚠️ 成员真值取自**源码文本**（与 tests/engine/action-contract.test.ts、门 ③ 的 unionMembers 同法），
  //   **不手抄清单**：手抄清单会随枚举增补而漂 ⇒ 守卫自己先失效（那正是本次漏检的形状）。
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const members = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  // 解析式失效（源码改写/正则不匹配）时必须红，不得静默变成「零成员 ⇒ 恒绿」。
  assert.ok(members.length > 0, 'ActionType 解析为空 ⇒ 守卫失去真值来源');
  const covered = new Set<string>(SAMPLES.map((a) => a.type));
  const missing = members.filter((t) => !covered.has(t));
  assert.deepEqual(missing, [],
    `ActionType 有成员没有往返样本：${missing.join(', ')}`
    + ' ⇒ 编码/反解任一侧漏接线都无人报警（B69 根因）');
  // 有样本还不够：样本必须**真能往返**（decode 缺分支时上面那条会绿，这一条才红）。
  for (const t of members) {
    const a = SAMPLES.find((s) => s.type === t);
    assert.ok(a !== undefined, `SAMPLES 缺 ${t} 的样本`);
    assert.deepEqual(withActor(actionFromKey(actionKey(a)), a.actor), a,
      `ActionType 成员 ${t} 往返失败：${actionKey(a)}`);
  }
});
