// B68 · G-f：对峙选牌（§3.3）端到端接线
//
// ⚠️ **此前只有引擎函数、没有动作成员**（G-f）⇒ 对峙未决时粗筛**整表清零**
//   （判据 `duel !== null`）⇒ AI/sidecar 拿到**空动作表** ⇒ 真人必须选暗牌的时刻，
//   模型无牌可选（G-f 的原文）。
//
// ⚠️ 本文件钉住四件事：
//   ① **可达性**：对峙参与者**拿到候选**（不再是空动作表）；
//   ② **可见性边界**（预研红线 3）：候选的 `cardId` **只能是自己手牌里的牌**
//   ⇒ 任何一方都拿不到对方的手牌 id ⇒ 无法看到对方将出什么牌；
//   ③ **边界收紧**：非参与者无候选、已锁定者无候选（等对方）；
//   ④ **契约**：Action 成员与规格 §6.3 **逐条一致**（成员 + 字段形状）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { startDuel, submitDuelCard } from '../../engine/core/duel.ts';
import { candidatesOf, getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { uiCandidates } from '../../web/legal-gate.ts';
import { buildChoice } from '../../tools/laya-probe/state-text.mjs';

/** 对峙刚立起、双方都未锁定的局面（4 人局）。 */
function openDuel(): State {
  const base = createInitialState({ players: 4, seed: 7, deckSize: 40 });
  const d = startDuel(base, 0, 1);
  assert.ok(d.duel !== null, 'openDuel：startDuel 必须真的立起未决对峙');
  return d;
}

test('B68/F-1 可达性：对峙参与者拿到选牌候选（不再是空动作表）', () => {
  const d = openDuel();
  for (const seat of [0, 1]) {
    const keys = getLegalActions(d, seat).map(actionKey);
    const duelKeys = keys.filter((k) => k.startsWith('duel:card:'));
    assert.ok(duelKeys.length > 0,
      `[B68/F-1 可达性] 座${String(seat)} 是对峙参与者 ⇒ 必须拿到选牌候选（G-f 已修 ⇒ 不再是空动作表）`);
    const myIds = new Set(d.players[seat]?.hand.map((c) => c.id) ?? []);
    const pickedIds = getLegalActions(d, seat)
      .filter((a) => a.type === 'DUEL_SUBMIT_CARD')
      .map((a) => (a.type === 'DUEL_SUBMIT_CARD' ? a.cardId : ''));
    assert.equal(pickedIds.length, d.players[seat]?.hand.length ?? 0,
      `座${String(seat)}：候选数必须等于**自己手牌数**（一张一张选）`);
    // ⚠️ **可见性**也要在这一层钉住（否则「换成对手手牌」的 mutant 会先红在这里 ⇒ 判据失准）
    assert.equal(pickedIds.every((id) => myIds.has(id)), true,
      `座${String(seat)}：选牌候选必须全部来自**自己手牌**`);
  }
});

test('B68/F-2 可见性边界：候选只含**自己手牌**的牌（不得含他人手牌 id）', () => {
  const d = openDuel();
  for (const seat of [0, 1, 2, 3]) {
    const myIds = new Set(d.players[seat]?.hand.map((c) => c.id) ?? []);
    const others = new Set(
      d.players.filter((p) => p.seat !== seat).flatMap((p) => p.hand.map((c) => c.id)),
    );
    for (const a of candidatesOf(d, seat)) {
      if (a.type !== 'DUEL_SUBMIT_CARD') { continue; }
      assert.equal(myIds.has(a.cardId), true,
        `[B68/F-2 可见性] 座${String(seat)}：选牌候选必须是自己手牌里的牌`);
      // ⚠️ **可见性红线**：对方的牌 id **不得**出现在任何一方的候选里
      for (const otherId of others) {
        assert.notEqual(a.cardId, otherId,
          `座${String(seat)}：候选里出现了**他人手牌**的牌 id ${otherId} ⇒ 泄露对手手牌（预研红线 3）`);
      }
    }
  }
});

test('B68/F-3 边界收紧：非参与者无候选、已锁定者无候选（等对方）', () => {
  const d = openDuel();
  // 非参与者（座 2/3）⇒ 无候选
  for (const seat of [2, 3]) {
    assert.equal(getLegalActions(d, seat).length, 0,
      `座${String(seat)} 不是对峙参与者 ⇒ 无可做动作`);
  }
  // 已锁定者 ⇒ 无候选（等对方选牌）
  const pick = d.players[0]?.hand[0];
  assert.ok(pick !== undefined, '前提：座 0 必须有牌可选');
  const locked = submitDuelCard(d, 0, pick.id);
  assert.ok(locked.ok, '前提：座 0 锁定亮牌必须成功：' + locked.note);
  assert.equal(getLegalActions(locked.state, 0).length, 0,
    '座 0 已锁定亮牌 ⇒ 等对方选牌，本回合无候选');
  assert.ok(getLegalActions(locked.state, 1).length > 0,
    '座 1 尚未锁定 ⇒ 仍有候选可��');
});

test('B68/F-4 契约：Action 成员与规格 §6.3 逐条一致（成员 + 字段形状）', () => {
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  assert.ok(found.includes('DUEL_SUBMIT_CARD'),
    '[B68/F-4 契约] ActionType 必须含 DUEL_SUBMIT_CARD（对峙选牌）');
  // 规格 §6.3 的成员必须与代码一致（契约测试另有常驻断言；此处只钉「规格里也有」）
  const spec = readFileSync('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md', 'utf8');
  assert.ok(spec.includes("type: 'DUEL_SUBMIT_CARD'"),
    '[B68/F-4 契约] 规格 §6.3 必须含 DUEL_SUBMIT_CARD（规格与代码不得脱节）');
});

test('B68/F-5 三层等价：引擎候选 == UI 候选（漂移守卫的同源要求）', () => {
  const d = openDuel();
  for (const seat of [0, 1, 2, 3]) {
    const engine = candidatesOf(d, seat).map(actionKey).sort();
    const ui = uiCandidates(d, seat).map(actionKey).sort();
    assert.deepEqual(ui, engine,
      `座${String(seat)}：UI 候选与引擎候选必须逐条相等（漂移守卫的另一面）`);
  }
});

test('B68/F-6 题面：选牌候选必须有可读语义且不泄露对方', () => {
  const d = openDuel();
  const choice = buildChoice(d, 0);
  assert.ok(Object.keys(choice.criteria).length > 0,
    '[B68/F-6 题面] 对峙参与者必须拿到非空题面（G-f 已修）');
  // ⚠️ 题面里**不得**出现对方手牌的 id
  const oppIds = d.players[1]?.hand.map((c) => c.id) ?? [];
  const flat = JSON.stringify(choice.criteria);
  for (const id of oppIds) {
    assert.equal(flat.includes(id), false,
      `题面里出现了对方手牌 id ${id} ⇒ 泄露对手手牌（预研红线 3）`);
  }
});

// ================= 变异自证：证明上面 6 条断言**真的有判别力** =================
//
// ⚠️ 副本纪律（E23 / E15）：共享工作树**只读**；副本须含**被 mutant 影响的那个测试文件**
//   及其依赖 ⇒ 复制整个 tests/engine + web + tools + themes + engine；
//   **直接运行副本里的测试文件**（不用 `node --test`）⇒ 在测试文件内再调用 --test 会被 Node
//   跳过（「run() is being called recursively」）⇒ 退出码恒 0 ⇒ 误判「没有专属锁」；
//   **清掉 `NODE_TEST_CONTEXT`** ⇒ 否则子进程用 TAP reporter ⇒ 失败消息不在输出里；
//   失败详情 **stdout 与 stderr 两路都收**。

const SKIP_MUTATION = process.env['CM_SKIP_MUTATION'] === '1';

function runMutant(mutate: (dir: string) => void): { code: number; out: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b68-'));
  const entry = 'tests/engine/duel-action.test.ts';
  try {
    cpSync(resolve('engine'), resolve(dir, 'engine'), { recursive: true });
    cpSync(resolve('themes'), resolve(dir, 'themes'), { recursive: true });
    cpSync(resolve('tools'), resolve(dir, 'tools'), { recursive: true });
    cpSync(resolve('web'), resolve(dir, 'web'), { recursive: true });
    mkdirSync(resolve(dir, 'tests'), { recursive: true });
    cpSync(resolve('tests/engine'), resolve(dir, 'tests/engine'), { recursive: true });
    cpSync(resolve('package.json'), resolve(dir, 'package.json'));
    cpSync(resolve('tsconfig.json'), resolve(dir, 'tsconfig.json'));
    mutate(dir);
    try {
      const env: Record<string, string> = { ...process.env as Record<string, string>, CM_SKIP_MUTATION: '1' };
      delete env['NODE_TEST_CONTEXT'];
      const out = execFileSync(process.execPath, [entry], {
        cwd: dir, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024, env,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: typeof err.status === 'number' ? err.status : -1, out: String(err.stdout ?? '') + '\n' + String(err.stderr ?? '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function patchCopy(dir: string, rel: string, from: string, to: string): void {
  const p = resolve(dir, rel);
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes(from), 'mutant 必须在 ' + rel + ' 里找到目标片段：' + from);
  writeFileSync(p, src.replace(from, to));
}


test('[B68-M1 变异自证] 撤掉枚举层的对峙候选 ⇒ 可达性层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/legal.ts',
      "      out.push({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId: card.id });",
      '      void card;');
  });
  assert.notEqual(r.code, 0, '[B68-M1 变异自证] mutant（撤掉对峙候选）必须让测试变红 —— 否则可达性没有专属锁');
  // ⚠️ **判据不要求「层标记与 AssertionError 同行」**：mutant 输出里断言消息可能**换行**
  //   ⇒ 同行匹配会**恒假**（本批实测踩过）⇒ 改为「输出里同时出现层标记与该层的专属措辞」。
  assert.ok(/\[B68\/F-1/.test(r.out) && /必须拿到选牌候选/.test(r.out),
    '[B68-M1 变异自证] mutant 必须红在「可达性」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B68-M2 变异自证] 枚举层发**对方手牌**的牌（可见性失守）⇒ 可见性层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    // mutant：把候选源从「自己手牌」改成「对手手牌」⇒ 可见性红线必须抓住
    patchCopy(dir, 'engine/core/legal.ts',
      '    for (const card of p.hand) {',
      '    for (const card of [...p.hand, ...state.players.filter((x) => x.seat !== seat).flatMap((x) => x.hand)]) {');
  });
  assert.notEqual(r.code, 0, '[B68-M2 变异自证] mutant（发对方手牌）必须让测试变红 —— 否则可见性没有专属锁');
  // ⚠️ 同 M1：不要求同行（mutant 输出的断言消息可能换行）
  assert.ok(/\[B68\/F-2/.test(r.out) && /选牌候选必须是自己手牌里的牌/.test(r.out),
    '[B68-M2 变异自证] mutant 必须红在「可见性」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});
