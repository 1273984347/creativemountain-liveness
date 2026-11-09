// B66 · G-b：引擎层待认证锁定（§5.1「不能使用移动类卡牌或位移能力」）
//
// ⚠️ **规格早就对、只差实现**（与 B65 的 G-a 性质相反）：规格 §5.1 明写「待认证者在峰顶
//   **不能主动移动、不能使用移动类卡牌或位移能力**；唯一的离开方式是『判罚后退』」，
//   而 §13.4 裁定表也把「位移结算语义 ③」列为已定 ⇒ 此前引擎 `act` 分支**不查 `pendingCert`**
//   ⇒ 锁定者能打位移牌绕过锁定 ⇒ **登顶是单向门**的设计被击穿。本批补上**实现**（规格零改动）。
//
// ⚠️ 本文件钉住四件事：
//   ① **位移类牌被拒**（引擎层，引用相等 = 探针认得的拒绝信号）；
//   ② **非位移牌照打**（规格只禁位移，不禁一切行动 ⇒ 禁过头会把锁定者变成完全不能行动）；
//   ③ **位移判据覆盖 `utility` 类型的位移牌**（只看 `type === 'motion'` 会漏掉 `c_throwspirit`）；
//   ④ **嵌套效果里的位移也算**（sequence / conditional / count）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import type { Card, ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { cardHasMovement } from '../../engine/core/targeting.ts';
import { putPending } from './fixtures.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/**
 * 一张含位移的牌（优先 utility 类型 ⇒ 覆盖「只看 motion 会漏」的那个盲区）。
 *
 * ⚠️ **前提自查不得调用被测函数**（本批实测踩过）：若用 `cardHasMovement` 来找这张牌，
 *   那么「判据退化成只看 type」的 mutant 会让**前提先失败** ⇒ 变异自证红在「前提自查」
 *   而不是**专属断言**上 ⇒ 判据就失准了（它证明的是「前提会红」，不是「该层有锁」）。
 *   ⇒ 前提改为**直接查 op 文本**（与被测实现无关）。
 */
function movementCard(): Card {
  const util = theme.cards.find((c) => c.type === 'utility' && /move_by_dice|move_forward|teleport|swap_position/.test(JSON.stringify(c.effects)));
  assert.ok(util !== undefined,
    '前提：主题里必须存在 utility 类型的位移牌（否则测不到「按 type 判会漏」这个盲区）');
  return util;
}

/**
 * 一张**不含位移**的牌。
 *
 * ⚠️ **注意**：主题里的攻击牌**全部含 target**（直接或嵌在 sequence / conditional 里）⇒
 *   用它们做「非位移牌」用例时**必须给合法目标**，否则引擎在「需要目标却没选目标」处就
 *   **提前返回** ⇒ 本用例测到的会是那条分支、不是「锁定是否放行非位移牌」（本批实测踩过）。
 */
function nonMovementCard(): Card {
  // ⚠️ 同样**不调用被测函数**（见 movementCard 的说明）⇒ 直接查 op 文本
  const attack = theme.cards.find((c) => c.type === 'attack'
    && !/move_by_dice|move_forward|move_backward|move_to_tile|move_relative_to|swap_position|teleport/.test(JSON.stringify(c.effects)));
  assert.ok(attack !== undefined, '前提：主题里必须存在不含位移的攻击牌');
  return attack;
}

/** 座 0 在峰顶待认证、手里有指定牌的局面。 */
function lockedWith(card: Card): State {
  const s0 = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  const withCard: State = {
    ...s0,
    players: s0.players.map((p, i) => (i === 0 ? { ...p, hand: [card], resource: 9 } : p)),
  };
  return putPending(withCard, [0]);
}

test('B66/B-1 位移判据：utility 类型的位移牌也必须被识别为「含位移」', () => {
  const util = movementCard();
  assert.equal(util.type, 'utility', '前提：本用例取的就是 utility 类型的牌');
  assert.equal(cardHasMovement(util), true,
    '[B66/B-1 位移判据] utility 类型的位移牌必须被识别为含位移（只看 type===motion 会漏）');
  // 负对照：攻击牌不得被误判
  assert.equal(cardHasMovement(nonMovementCard()), false,
    '[B66/B-1 位移判据] 不含位移的牌不得被误判为含位移');
});

test('B66/B-2 引擎拒绝：锁定者打位移类牌 ⇒ 被拒（状态逐字不变）', () => {
  const card = movementCard();
  const s = lockedWith(card);
  assert.equal(s.players[0]?.pendingCert, true, '前提：座 0 必须处于待认证锁定');
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.equal(r, s,
    '[B66/B-2 引擎拒绝] 锁定者打位移类牌必须原样返回（引用相等 = 探针认得的拒绝信号）');
  assert.equal(r.players[0]?.hand.length, 1,
    '[B66/B-2 引擎拒绝] 被拒时不得弃牌');
  assert.equal(r.players[0]?.resource, 9,
    '[B66/B-2 引擎拒绝] 被拒时不得扣费');
});

test('B66/B-3 非位移牌照打：锁定者打攻击牌 ⇒ 允许（规格只禁位移，不禁一切行动）', () => {
  const card = nonMovementCard();
  const s = lockedWith(card);
  // ⚠️ 攻击牌含 target ⇒ 必须给**合法目标**（座 1），否则引擎在「需要目标却没选目标」处提前返回
  const r = performAction(s, 0, 'act', { cardId: card.id, target: 1 });
  assert.notEqual(r, s,
    '[B66/B-3 非位移牌照打] 锁定者打非位移牌必须允许（禁过头 ⇒ 锁定者完全不能行动）');
  assert.equal(r.players[0]?.hand.length, 0,
    '[B66/B-3 非位移牌照打] 牌应已打出');
});

test('B66/B-4 边界：非锁定者打位移类牌 ⇒ 照打（锁定判据不得误伤）', () => {
  const card = movementCard();
  const s0 = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  const s: State = {
    ...s0,
    players: s0.players.map((p, i) => (i === 0 ? { ...p, hand: [card], resource: 9 } : p)),
  };
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.notEqual(r, s,
    '[B66/B-4 边界] 非锁定者打位移类牌必须允许（锁定判据不得误伤正常对局）');
  assert.equal(r.players[0]?.hand.length, 0, '[B66/B-4 边界] 牌应已打出');
});

test('B66/B-5 行棋仍被拒：锁定者不能主动移动（§5.1 的另一半，回归防线）', () => {
  const card = movementCard();
  const s = lockedWith(card);
  const r = performAction(s, 0, 'move');
  assert.equal(r, s, '[B66/B-5 行棋仍被拒] 锁定者行棋必须被拒（move 分支的既有检查不得被改坏）');
});

// ================= 变异自证：证明上面 5 条断言**真的有判别力** =================
//
// ⚠️ 副本纪律（E23 / E15）：共享工作树**只读**；副本须含**被 mutant 影响的那个测试文件**
//   及其依赖 ⇒ 复制整个 tests/engine + web + tools + themes + engine；
//   **直接运行副本里的测试文件**（不用 `node --test`）⇒ 在测试文件内再调用 --test 会被 Node
//   跳过（「run() is being called recursively」）⇒ 退出码恒 0 ⇒ 误判「没有专属锁」；
//   **清掉 `NODE_TEST_CONTEXT`** ⇒ 否则子进程用 TAP reporter ⇒ 失败消息不在输出里；
//   失败详情 **stdout 与 stderr 两路都收**。

const SKIP_MUTATION = process.env['CM_SKIP_MUTATION'] === '1';

function runMutant(mutate: (dir: string) => void): { code: number; out: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b66-'));
  const entry = 'tests/engine/pending-cert-lock.test.ts';
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


test('[B66-M1 变异自证] 撤掉引擎的锁定检查 ⇒ 引擎拒绝层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/turn-runner.ts',
      '      if (player.pendingCert && cardHasMovement(card)) {',
      '      if (false && player.pendingCert && cardHasMovement(card)) {');
  });
  assert.notEqual(r.code, 0, '[B66-M1 变异自证] mutant（撤掉锁定检查）必须让测试变红 —— 否则引擎拒绝层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B66\/B-2/.test(r.out),
    '[B66-M1 变异自证] mutant 必须红在「引擎拒绝」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B66-M2 变异自证] 位移判据退回只看 card.type ⇒ utility 位移牌漏判 ⇒ 必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    // mutant：把「含位移」判成「type === motion」⇒ utility 类型的位移牌漏判
    patchCopy(dir, 'engine/core/targeting.ts',
      '  return walk(card.effects);',
      "  return card.type === 'motion';");
  });
  assert.notEqual(r.code, 0, '[B66-M2 变异自证] mutant（只看 type）必须让测试变红 —— 否则位移判据没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B66\/B-1/.test(r.out),
    '[B66-M2 变异自证] mutant 必须红在「位移判据」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B66-M3 变异自证] 锁定检查禁掉一切牌（过头）⇒ 非位移牌层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/turn-runner.ts',
      '      if (player.pendingCert && cardHasMovement(card)) {',
      '      if (player.pendingCert) {');
  });
  assert.notEqual(r.code, 0, '[B66-M3 变异自证] mutant（禁掉一切牌）必须让测试变红 —— 否则非位移牌层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B66\/B-3/.test(r.out),
    '[B66-M3 变异自证] mutant 必须红在「非位移牌」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});
