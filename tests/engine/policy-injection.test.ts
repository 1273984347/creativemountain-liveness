// tests/engine/policy-injection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne, setRecorder } from '../../tests/sim/policy.mjs';
import { actionKey } from '../../engine/core/action-key.ts';
import type { DecisionRecord, FacePolicy, SimGameResult } from '../../tests/sim/policy.d.mts';

const theme = () => JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));

/**
 * 可观察的**结局签名**（B70 修复轮 1 · 评审 I-2）：
 * 用来证明「改道真的改变了轨迹」——若注入块回归成恒回落，本签名会与全回落对照逐字相同。
 * 只取 playOne 返回值里的终局字段（不读 injection ⇒ 与计数断言互相独立）。
 */
const outcome = (r: SimGameResult): string[] =>
  [r.reason, String(r.rounds), r.winners.join(','), String(r.seatTotal)];

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

// ⚠️ 以上 6 条是简报点名的最小集（逐字保留）。下面 4 条是 B70 修复轮 1 按控制器裁定补的
//   常驻守卫：前 6 条喂给 `decide` 的全是 null / 非法 key / 抛错 / 永不 resolve ⇒
//   「合法 key 确实改道」这条**主功能**对提交测试不可见（守卫或 `injected`/`continue`
//   若回归成恒回落，门禁仍全绿）。

test('合法 key ⇒ 真的改道：fallbacks 恒 0，且记录与结局两处都跟着变（评审 I-2）', async () => {
  // 对照组：同 seed、同面、同座位，但策略器每次都答 null ⇒ 纯原启发式轨迹。
  const rowsOff: DecisionRecord[] = [];
  setRecorder(rowsOff);
  let off: SimGameResult;
  try {
    off = await playOne(theme(), 4, 4242, undefined, { face: 'play', seat: 0, decide: async () => null });
  } finally { setRecorder(null); }
  assert.ok(off.injection.calls > 0, '对照组必须真的被问到');
  assert.equal(off.injection.fallbacks, off.injection.calls, '对照组每次都回落');

  // 实验组：交回**候选里第一条**的合法 key ⇒ 每次问出口都必须改道成功。
  const rowsOn: DecisionRecord[] = [];
  const chosen: string[] = [];
  setRecorder(rowsOn);
  let on: SimGameResult;
  try {
    on = await playOne(theme(), 4, 4242, undefined, {
      face: 'play', seat: 0,
      decide: async (_s, _seat, c) => {
        const first = c[0];
        assert.ok(first !== undefined, '候选非空才问得出口 ⇒ 第一条必然存在');
        const k = actionKey(first);
        chosen.push(k);
        return k;
      },
    });
  } finally { setRecorder(null); }

  assert.ok(on.injection.calls > 0, '该面必须真的被问到');
  assert.equal(on.injection.fallbacks, 0, '合法 key 一次都不许回落');
  assert.equal(chosen.length, on.injection.calls, '问出口 = 交回 key');

  // 证据 A（记录侧）：策略器交回的每个 key 都**按序**成为 seat 0 的决策记录
  //   （记录写在该座位的下一次决策之前 ⇒ 顺序即因果，不是「调用过」这种恒真形状）。
  let cursor = 0;
  for (const row of rowsOn) {
    if (row.seat !== 0) { continue; }
    if (cursor < chosen.length && row.heuristic === chosen[cursor]) { cursor += 1; }
  }
  assert.equal(cursor, chosen.length, '改道选出的动作必须逐条按序进决策记录');
  // 反证形状：全回落对照里 seat 0 打出牌的记录条数**远少于**它的问出口数
  //   ⇒ 上面那条「记录条数 == 问出口数」不是恒成立，回归成恒回落时必红。
  const playsOff = rowsOff.filter((x) => x.seat === 0 && x.heuristic.startsWith('play:')).length;
  assert.ok(playsOff < off.injection.calls, `全回落时 seat0 只有少数回合打牌（实际 ${String(playsOff)} / ${String(off.injection.calls)}）`);

  // 证据 B（结局侧）：同 seed 下改道局与全回落局必须分歧（rng 流自首个分歧起分叉 ⇒ 结局不同）。
  assert.notDeepEqual(outcome(on), outcome(off), '改道必须留下可观察的结局差异');
});

test('certify 面候选按**当前待认证 target** 收窄 ⇒ 模型/记录/执行三者同一 target（评审 I-1）', async () => {
  // seed 1074 / 4 人会走到 §5.5 双人互验（`pending.length >= 2`）⇒ `legal.ts` 对**每个**
  // 待认证目标各发三条候选。收窄前策略器会一次拿到 6 条（两个 target），于是
  // 「模型想质疑 A、循环此刻 target=B ⇒ 引擎质疑 B，JSONL 记下没发生过的事」。
  const seen: { pending: readonly number[]; keys: string[] }[] = [];
  const r = await playOne(theme(), 4, 1074, undefined, {
    face: 'certify', seat: 0,
    decide: async (s, _seat, c) => {
      const keys = c.map((a) => actionKey(a));
      seen.push({ pending: [...s.certification.pending], keys });
      const last = c[c.length - 1];
      assert.ok(last !== undefined, '候选非空才问得出口');
      return actionKey(last);
    },
  });
  assert.ok(r.injection.calls > 0, 'certify 面必须真的被问到');
  assert.equal(r.injection.fallbacks, 0, '合法 key 不许回落');
  assert.equal(seen.length, r.injection.calls);
  // ① 非空转：本局必须真的出现「同时 ≥2 个待认证目标」的问出口，否则下面的断言是假绿。
  assert.ok(seen.some((x) => x.pending.length >= 2), '本局必须走到双人互验（pending ≥ 2），否则收窄断言空转');
  // ② 每次问出口只对应**一个** target，且恰是签印/质疑/弃权三条 ⇒ 与循环执行的 target 同源。
  for (const x of seen) {
    const targets = new Set(x.keys.map((k) => k.split(':')[2]));
    assert.equal(x.keys.length, 3, `certify 面一次问出口恰三条候选：${x.keys.join(' / ')}`);
    assert.equal(targets.size, 1, `候选不得跨待认证目标混发（否则记录 target ≠ 执行 target）：${x.keys.join(' / ')}`);
    const t = Number([...targets][0]);
    assert.ok(x.pending.includes(t), `收窄后的 target 必须是当前待认证目标之一：${String(t)}`);
  }
});

test('计数配平：calls + emptyCandidates == 该面注入点问出口总数（未登记 face 当测量仪）', async () => {
  // play 面：锁定态回合（§7 粗筛在 pendingCert 时不发行动面候选）与认证/山议循环
  // 都会「问不到候选」⇒ emptyCandidates 必须 > 0，而不是恒 0 的摆设。
  const a = await playOne(theme(), 4, 4242, undefined, { face: 'play', seat: 0, decide: async () => null });
  assert.ok(a.injection.calls > 0);
  assert.ok(a.injection.emptyCandidates > 0, '锁定态 play 面必须真的出现过空候选');
  assert.equal(a.injection.fallbacks, a.injection.calls, '问了但答 null ⇒ 全部算回落');

  // 测量仪：未登记的 face ⇒ 每次到达注入点都走「问不到候选」那条路（calls 恒 0），
  // 且两局都是 100% 回落 ⇒ 轨迹逐字相同 ⇒ 它的 emptyCandidates 就是该面的**问出口总数**。
  const b = await playOne(theme(), 4, 4242, undefined, {
    face: 'Play' as FacePolicy['face'], seat: 0, decide: async () => null,
  });
  assert.equal(b.injection.calls, 0, '未登记的 face 不得问出口');
  assert.equal(b.injection.fallbacks, 0, '没问出口就不算回落（不得记进 fallbacks）');
  assert.equal(a.injection.calls + a.injection.emptyCandidates, b.injection.emptyCandidates,
    'calls + emptyCandidates 必须与该面问出口配平');
});

test('policy.face 未登记 ⇒ 不崩局：按「问不到候选」回落，且与缺省注入逐字同结局（连带修正）', async () => {
  // `policy.face` 由 `.mjs` 调用方（Task 5 的 game-arms）直接构造，TS 的字面量联合类型
  // 保护不到 ⇒ 拼错一个 face 原本会在 try **之外**抛 TypeError 炸掉整局（400 局一起没）。
  const r = await playOne(theme(), 4, 4242, undefined, {
    face: 'certifyy' as FacePolicy['face'], seat: 0, decide: async () => 'cert:sign:1',
  });
  assert.ok(r.rounds > 0, '整局必须正常结束（不得抛错崩局）');
  assert.deepEqual(r.anomalies ?? [], [], '不得因非法 face 产生异常');
  assert.equal(r.injection.calls, 0);
  assert.equal(r.injection.fallbacks, 0);
  assert.ok(r.injection.emptyCandidates > 0, '非法 face 必须计入既有的 emptyCandidates');
  // 守卫只影响计数、不影响行为 ⇒ 与不注入的缺省局结局逐字相同。
  const d = await playOne(theme(), 4, 4242);
  assert.deepEqual(outcome(r), outcome(d), '未登记 face 的对局必须与缺省路径同结局');
});
