// B67 · G-d：双人互验（§5.5）端到端接线
//
// ⚠️ **此前只有引擎函数、没有动作成员**（G-d）⇒ 无法枚举、UI 无入口、模拟器不处理
//   ⇒ 机制在数字轨与模拟器**均不可达**（唯一调用方是测试）⇒ 且双人会因
//   「两人都要等对方签」而**死锁**（规格 §5.5 明写「**不产生死锁**」）。
//
// ⚠️ 本文件钉住五件事：
//   ① **互签环**：待认证者给另一位待认证者签印 ⇒ 对方 +1 枚签印、互签者记入 `signed`；
//   ② **门槛环**：双人同时待认证 ⇒ 门槛降为 1（§5.2 步骤 0）⇒ 互签即达标；
//   ③ **死锁防线**：双方互签 ⇒ 各自达标（规格「不产生死锁」）；
//   ④ **守卫**：不能自己签自己 / 对方不在待认证 / 本轮已用过机会 ⇒ 引擎拒；
//   ⑤ **可达性**：互签动作**必须被枚举**（否则又是「只有引擎函数、没有入口」）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  advanceCertificationRound, certifyMutualSign, certificationThreshold, enterPendingCertification,
} from '../../engine/core/certification.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';

/** 座 0 与座 1 同时待认证的局面（双人互验场景，§5.5）。 */
function dualPending(): State {
  const s0 = createInitialState({ players: 4, seed: 5, deckSize: 40 });
  const onPeak: State = {
    ...s0,
    players: s0.players.map((p) => (p.seat === 0 || p.seat === 1 ? { ...p, position: s0.board.peakIndex, resource: 5 } : p)),
  };
  let s = onPeak;
  for (const seat of [0, 1]) {
    const r = enterPendingCertification(s, seat);
    assert.ok(r.ok, 'dualPending：座 ' + String(seat) + ' 进入待认证必须成功：' + String(r.note));
    s = r.state;
  }
  const opened = advanceCertificationRound(s);
  assert.ok(opened.ok, 'dualPending：开启第 1 轮认证必须成功：' + String(opened.note));
  return opened.state;
}

test('B67/M-1 门槛环：双人同时待认证 ⇒ 门槛降为 1（§5.2 步骤 0）', () => {
  const s = dualPending();
  assert.deepEqual(s.certification.pending, [0, 1], '前提：本局面应有两名待认证者');
  assert.equal(certificationThreshold(s, 0), 1, '[B67/M-1 门槛环] 双人时门槛必须是 1');
  assert.equal(certificationThreshold(s, 1), 1, '[B67/M-1 门槛环] 双人时门槛必须是 1');
});

test('B67/M-2 互签环：互签 ⇒ 对方 +1 枚签印、互签者记入 signed', () => {
  const s = dualPending();
  const before = s.certification.signatures[1] ?? 0;
  const r = certifyMutualSign(s, 0, 1);
  assert.ok(r.ok, '[B67/M-2 互签环] 座 0 为座 1 互签必须成功：' + String(r.note));
  assert.equal(r.state.certification.signatures[1], before + 1,
    '[B67/M-2 互签环] 被签者应 +1 枚签印');
  assert.ok(r.state.certification.signed.includes(0),
    '[B67/M-2 互签环] 互签者应记入 signed（本轮已用掉认证机会）');
});

test('B67/M-3 死锁防线：双方互签 ⇒ 各自达标（规格 §5.5「不产生死锁」）', () => {
  let s = dualPending();
  const a = certifyMutualSign(s, 0, 1);
  assert.ok(a.ok, '[B67/M-3 死锁防线] 座 0 的互签必须成功');
  s = a.state;
  const b = certifyMutualSign(s, 1, 0);
  assert.ok(b.ok, '[B67/M-3 死锁防线] 座 1 的互签必须成功');
  s = b.state;
  assert.ok((s.certification.signatures[0] ?? 0) >= 1 && (s.certification.signatures[1] ?? 0) >= 1,
    '[B67/M-3 死锁防线] 双方互签后各自至少 1 枚签印 ⇒ 门槛为 1 时双方都达标');
  const done = advanceCertificationRound(s);
  assert.ok(done.ok, '[B67/M-3 死锁防线] 双方达标后轮末结算必须成功：' + String(done.note));
});

test('B67/M-4 守卫：不能自己签自己 / 对方不在待认证 / 本轮已用过机会 ⇒ 引擎拒', () => {
  const s = dualPending();
  const self = certifyMutualSign(s, 0, 0);
  assert.equal(self.ok, false, '[B67/M-4 守卫] 不能与自己互签');
  assert.match(String(self.note), /自己/, '[B67/M-4 守卫] 拒因要点名「自己」');
  const notPending = certifyMutualSign(s, 0, 3);
  assert.equal(notPending.ok, false, '[B67/M-4 守卫] 对方不在待认证 ⇒ 拒');
  const used = certifyMutualSign(certifyMutualSign(s, 0, 1).state, 0, 1);
  assert.equal(used.ok, false, '[B67/M-4 守卫] 本轮已用过机会 ⇒ 不得再互签');
  assert.match(String(used.note), /机会/, '[B67/M-4 守卫] 拒因要点名「机会」');
});

test('B67/M-5 可达性：互签动作必须被枚举（否则又是「只有引擎函数、没有入口」）', () => {
  const s = dualPending();
  const keys = getLegalActions(s, 0).map(actionKey);
  assert.ok(keys.includes('cert:mutual:1'),
    '[B67/M-5 可达性] 座 0 的互签动作必须出现在枚举里（引擎函数 + 动作成员 + 粗筛三层齐备）');
  assert.ok(keys.includes('cert:mutual:0') === false,
    '[B67/M-5 可达性] 不得给自己发互签（target !== actor）');
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
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b67-'));
  const entry = 'tests/engine/mutual-sign.test.ts';
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


test('[B67-M1 变异自证] 撤掉互签的落账 ⇒ 互签环必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      '  const next = addSignature(state, target, 1);',
      '  const next = state;');
  });
  assert.notEqual(r.code, 0, '[B67-M1 变异自证] mutant（撤掉落账）必须让测试变红 —— 否则互签环没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B67\/M-2/.test(r.out),
    '[B67-M1 变异自证] mutant 必须红在「互签环」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B67-M2 变异自证] 撤掉枚举层的互签候选 ⇒ 可达性层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/legal.ts',
      "        out.push({ type: 'CERTIFY_MUTUAL_SIGN', actor: seat, target: other });",
      "        void other;");
  });
  assert.notEqual(r.code, 0, '[B67-M2 变异自证] mutant（撤掉枚举候选）必须让测试变红 —— 否则可达性没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B67\/M-5/.test(r.out),
    '[B67-M2 变异自证] mutant 必须红在「可达性」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B67-M3 变异自证] 撤掉「本轮已用过机会」的守卫 ⇒ 守卫层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      "  if (c.signed.includes(actor)) { return fail(state, '本轮已用过认证机会'); }",
      '  void c;');
  });
  assert.notEqual(r.code, 0, '[B67-M3 变异自证] mutant（撤掉守卫）必须让测试变红 —— 否则守卫层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B67\/M-4/.test(r.out),
    '[B67-M3 变异自证] mutant 必须红在「守卫」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});
