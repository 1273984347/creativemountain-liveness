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
  assert.deepEqual(a.injection, {
    calls: 0, fallbacks: 0, emptyCandidates: 0,
    emptyByReason: { unregisteredFace: 0, stationMismatch: 0, noCandidate: 0, narrowedEmpty: 0 },
  });
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
    off = await playOne(theme(), 4, 9001, undefined, { face: 'play', seat: 0, decide: async () => null });
  } finally { setRecorder(null); }
  assert.ok(off.injection.calls > 0, '对照组必须真的被问到');
  assert.equal(off.injection.fallbacks, off.injection.calls, '对照组每次都回落');

  // 实验组：交回**候选里最后一条**的合法 key ⇒ 每次问出口都必须改道成功。
  //   ⚠️ C1 之后 play 面只在出牌手番问出口，而候选的**第一条**与本 seed 的启发式选牌恰好重合
  //   （实测：两者打出的牌逐字相同 ⇒ 结局签名不变，无法证明「改道生效」）⇒ 改用最后一条。
  //   ⚠️ **B75.1 换 seed（4242 → 9001）**：仲裁者否决改为「救他人 + 0.15 概率」后会在山议里消耗一次 rng，
  //   轨迹随之改变；4242 这个 seed 的两臂（改道 / 全回落）**撞到同一个结局签名**（实测 seats/[2]/13 逐字相同）
  //   ⇒ 「结局必须分歧」这条断言在该 seed 上失去区分力。9001 实测：问出口 2 次、回落 0、胜者座 3 → 座 0
  //   ⇒ 分歧可观察。**换的是样本不是判据**（判据仍是「记录跟随注入 + 结局分歧」两条）。
  const rowsOn: DecisionRecord[] = [];
  const chosen: string[] = [];
  setRecorder(rowsOn);
  let on: SimGameResult;
  try {
    on = await playOne(theme(), 4, 9001, undefined, {
      face: 'play', seat: 0,
      decide: async (_s, _seat, c) => {
        const last = c[c.length - 1];
        assert.ok(last !== undefined, '候选非空才问得出口 ⇒ 最后一条必然存在');
        const k = actionKey(last);
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
  // 反证形状（C1 后重写）：若注入回归成恒回落，本臂的轨迹与全回落对照逐字相同 ⇒ seat 0 打出的
  //   牌也逐字相同。⇒ 「改道确实换掉了实际打出的牌」这一条在恒回落时会红。
  //   （C1 之前这里断言的是「全回落时打牌次数 < 问出口数」—— 注入下沉到出牌分支后两者本就相等，
  //    那条形状不再有区分力，见 plan/终审 C1。）
  const playKeys = (rows: DecisionRecord[]): string[] => rows
    .filter((x) => x.seat === 0 && x.heuristic.startsWith('play:'))
    .map((x) => x.heuristic);
  assert.notDeepEqual(playKeys(rowsOn), playKeys(rowsOff),
    '改道必须真的换掉 seat0 打出的牌（否则「记录跟随注入」与恒回落不可区分）');

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

// ⚠️ 以上 10 条是修复轮 1 的形状。复审在**新改的那几行**里照出 N-1（`hit` 只认座位不认面 ⇒
//   跨面问出口）与 N-2（`=== undefined` 挡不住 Object.prototype 成员名），下面 3 条是它们的常驻守卫。

/** 记录行里 `state` 字段（`stateToJson` 的信封）本批断言要读的两处。 */
type RowState = {
  players: { seat: number; pendingCert: boolean }[];
  certification: { pending: number[]; signed: number[]; challenged: number[]; abstained: number[] };
};
const rowState = (text: string): RowState => (JSON.parse(text) as { state: RowState }).state;
/**
 * 「这一行是在**认证循环**里写下的」——该座位当时是本轮还没用掉机会的认证人
 * （`certificationTurn` 的循环头判据 `isCertifier ∧ !hasUsedCertificationTurn` 的同款）。
 * 认证人往往**同时**是行动窗口开着的手番玩家 ⇒ 修复前 `face:'play'` 的策略器正是从这里问出口。
 */
const inCertifyCycle = (st: RowState, seat: number): boolean => {
  const c = st.certification;
  if (c.pending.length === 0 || c.pending.includes(seat)) { return false; }
  return !(c.signed.includes(seat) || c.challenged.includes(seat) || c.abstained.includes(seat));
};
const CERTIFY_ROW_RE = /^cert:(sign|challenge|abstain):/;

// 本轮取数脚本逐个点名的种子：修复前**每个 seed 各出 1 条**幻影记录（`play:` 写进 JSONL、
// 引擎做的却是 `certifySign`，且该座位那一轮少一条 `cert:` 行）。
const PHANTOM_SEEDS = [4249, 4264, 4265, 4276];

test('站点 ≡ 面：face=play 不在认证循环里问出口 ⇒ 无幻影签印、无幻影记录（评审 N-1）', async () => {
  let totalCalls = 0;
  let seedsWhereSeat0Certifies = 0;
  for (const seed of PHANTOM_SEEDS) {
    // 基线局（无注入）里 seat 0 是否真的当过认证人 —— C1 之后 play 面的问出口只发生在出牌手番，
    //   「该座位的 cert 记录必须回来」在不含该座位认证回合的 seed 上是空断言（实测 4276）。
    const baseRows: DecisionRecord[] = [];
    setRecorder(baseRows);
    try { await playOne(theme(), 4, seed); } finally { setRecorder(null); }
    const seat0Certifies = baseRows.some((x) => x.seat === 0 && CERTIFY_ROW_RE.test(x.heuristic));
    if (seat0Certifies) { seedsWhereSeat0Certifies += 1; }
    const rows: DecisionRecord[] = [];
    const chosen: string[] = [];
    setRecorder(rows);
    let r: SimGameResult;
    try {
      r = await playOne(theme(), 4, seed, undefined, {
        face: 'play', seat: 0,
        decide: async (_s, _seat, c) => {
          const first = c[0];
          assert.ok(first !== undefined, '候选非空才问得出口');
          const k = actionKey(first);
          chosen.push(k);
          return k;
        },
      });
    } finally { setRecorder(null); }
    // ⚠️ C1 之后 play 面的问出口只发生在「基线本来就要出牌」的手番上 ⇒ 单个 seed 可能是 0 次
    //   （本组 4265/4276 就是 0 次）。改用**整组**非空转前置：至少一个 seed 必须真的被问到。
    totalCalls += r.injection.calls;
    assert.equal(r.injection.fallbacks, 0, '交回的是合法 key ⇒ 一次都不许回落');
    assert.equal(chosen.length, r.injection.calls);

    // ① 幻影记录归零：不得有任何 `play:` 行写在认证循环里（那里被记下的牌从未被打出）。
    const phantom = rows
      .filter((x) => x.heuristic.startsWith('play:') && inCertifyCycle(rowState(x.state), x.seat))
      .map((x) => `seq=${String(x.seq)} seat=${String(x.seat)} ${x.heuristic}`);
    assert.deepEqual(phantom, [], `seed ${String(seed)}：不得出现跨面幻影记录`);

    // ② 幻影签印归零：改道交回的每个 key 都按序成为该座位的记录，且该座位在认证循环里
    //    **仍然**逐轮记账（幻影的成因正是「用 certifySign 执行 + 记 play 的 key」⇒ 该轮的
    //    `cert:` 行被替换掉；归零后该座位的认证记录必须回来）。
    if (seat0Certifies) {
      assert.ok(rows.some((x) => x.seat === 0 && CERTIFY_ROW_RE.test(x.heuristic)),
        `seed ${String(seed)}：seat 0 必须仍有自己的认证记录（不是靠少记账来消除幻影）`);
    }
    let cursor = 0;
    for (const row of rows) {
      if (row.seat !== 0) { continue; }
      if (cursor < chosen.length && row.heuristic === chosen[cursor]) { cursor += 1; }
    }
    assert.equal(cursor, chosen.length, '交回的 key 必须逐条按序进记录');
  }
  assert.ok(totalCalls > 0, '整组必须至少一个 seed 真的问出口（否则下面的「无幻影」断言空转）');
  assert.ok(seedsWhereSeat0Certifies > 0, '整组必须至少一个 seed 在基线局里 seat 0 当过认证人（否则 ② 空转）');
});

test('反向配平：face=certify/council 时别的站点按「问不到候选」计数，不静默丢弃（评审 N-1 的分母）', async () => {
  const PREFIX: Record<'certify' | 'council', string[]> = {
    certify: ['cert:sign:', 'cert:challenge:', 'cert:abstain:'],
    council: ['vote:'],
  };
  // 4463/4710/4827 是本轮取数脚本点名的「certify 面在别的站点被问出口」的种子
  // （修复前每次问出口被 `picked.type` 判据丢弃 ⇒ 计进 calls 却既不 record 也不 fallback）。
  const INJECT_SEEDS: Record<'certify' | 'council', number[]> = { certify: [4463, 4710, 4827], council: [4249, 4463] };
  for (const face of ['certify', 'council'] as const) {
    // 恒回落臂：`calls + emptyCandidates` == 到达注入点的时刻数（用未登记 face 当测量仪，
    // 两臂都 100% 回落 ⇒ 轨迹逐字相同 ⇒ 它的 emptyCandidates 就是到达数）。
    let calls = 0; let arrivals = 0;
    for (const seed of [4242, 1074, 4249]) {
      const a = await playOne(theme(), 4, seed, undefined, { face, seat: 0, decide: async () => null });
      const m = await playOne(theme(), 4, seed, undefined, {
        face: '未登记' as FacePolicy['face'], seat: 0, decide: async () => null,
      });
      assert.equal(m.injection.calls, 0, '未登记 face 不得问出口');
      assert.equal(a.injection.fallbacks, a.injection.calls);
      assert.equal(a.injection.calls + a.injection.emptyCandidates, m.injection.emptyCandidates,
        `seed ${String(seed)}：${face} 面必须「每个到达恰好计一次」`);
      calls += a.injection.calls;
      arrivals += m.injection.emptyCandidates;
    }
    assert.ok(arrivals > calls, `${face} 面必须真的到达过**别的**站点（否则 emptyCandidates 是摆设）`);

    // 改道臂：每一次 `calls` 都要兑现成该座位的一条本面动作记录 ⇒ 差值就是
    // 「计进 calls 却既没 record 也没 fallback」的静默丢弃数
    // （本轮取数实测：修复前 certify 面每 40 局漏 2 次、面越大越稀；修复后恒 0）。
    for (const seed of INJECT_SEEDS[face]) {
      const rows: DecisionRecord[] = [];
      setRecorder(rows);
      let r: SimGameResult;
      try {
        r = await playOne(theme(), 4, seed, undefined, {
          face, seat: 0,
          decide: async (_s, _seat, c) => {
            const first = c[0];
            assert.ok(first !== undefined, '候选非空才问得出口');
            return actionKey(first);
          },
        });
      } finally { setRecorder(null); }
      assert.equal(r.injection.fallbacks, 0, '合法 key 不许回落');
      const honored = rows.filter((x) => x.seat === 0
        && PREFIX[face].some((p) => x.heuristic.startsWith(p))).length;
      assert.equal(honored, r.injection.calls,
        `seed ${String(seed)} · ${face} 面：每次问出口都要兑现成该座位的本面动作`
        + `（calls=${String(r.injection.calls)} 兑现=${String(honored)} ⇒ 静默丢弃 ${String(r.injection.calls - honored)} 次）`);
    }
  }
});

test('face 取 Object.prototype 成员名 ⇒ 不崩局：守卫不得只判 === undefined（评审 N-2）', async () => {
  // `FACE_TYPES['toString']` 取到的是**原型链上的函数**而非 undefined ⇒ 上一轮的
  // `types === undefined` 挡不住它 ⇒ `types.includes` 在 try **之外**抛 TypeError
  // ⇒ 整局没样本（Task 5 的一批一起没）。对照用：'Play' 是**没登记**的拼错 face（恒 undefined）。
  const d = await playOne(theme(), 4, 4242);
  for (const face of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'Play']) {
    const r = await playOne(theme(), 4, 4242, undefined, {
      face: face as FacePolicy['face'], seat: 0, decide: async () => 'cert:sign:1',
    });
    assert.ok(r.rounds > 0, `face='${face}' 必须正常终局（不得抛错）`);
    assert.deepEqual(r.anomalies ?? [], [], `face='${face}' 不得产生异常`);
    assert.equal(r.injection.calls, 0, `face='${face}' 不得问出口`);
    assert.equal(r.injection.fallbacks, 0);
    assert.ok(r.injection.emptyCandidates > 0, `face='${face}' 必须计入既有的 emptyCandidates`);
    assert.deepEqual(outcome(r), outcome(d), `face='${face}' 只改计数、不改行为`);
  }
});
