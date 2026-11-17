// B64 · T2：复议窗口状态在 UI 可见（谁还没投 / 窗口何时关）
//
// ⚠️ 为什么单独一个文件：这条断言的**核心不变量**是「UI 显示的第三方集合 == 引擎裁定口径」
//   ⇒ 它要同时碰**引擎导出函数**（事实源）、**UI 纯函数**（文案）、**state-text**（探针副本）
//   —— 三者同属一条「口径链」，放一起才看得出断的是哪一环。
//
// ⚠️ 判据不弱化：每条断言都指向**可观测事实**（文案里的数字 / 集合相等），
//   不写「应当一致」这类无法失败的措辞；每条还配**专属变异自证**（见文件末尾）
//   ⇒ 断言有判别力，不靠「本来就绿」冒充覆盖。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { appealThirdParties, resolveAppeals } from '../../engine/core/certification.ts';
import { appealWindowStatus } from '../../web/ui/cert.ts';
import { describeState } from '../../tools/laya-probe/state-text.mjs';
import { mk, putPending } from './fixtures.ts';
import { certifyAnswer, certifyAppeal, certifyAppealVote, certifyChallenge } from '../../engine/core/certification.ts';

/** 引擎 note 的可读兜底（fixtures 的 noteOf 是私有的，此处不重抄规则、只做显示兜底）。 */
function noted(note: string | undefined): string {
  return note ?? '（引擎未给 note）';
}

/**
 * 「座 0 被判不通过并申请复议」的局面（5 人局）。
 *
 * ⚠️ 认证字段一律走**引擎入口**（certifyX），不手拼（遵 fixtures 的禁令）。
 * ⚠️ 座 0 补到 5 资源是复议的成本（`certifyAppeal` 需 2）。
 */
function appealScene(): ReturnType<typeof putPending> {
  const challenged = certifyChallenge(putPending(mk(5, 7), [0]), 1, 0);
  assert.ok(challenged.ok, 'appealScene：座 1 发起质疑必须成功：' + noted(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.ok(answered.ok, 'appealScene：判定必须落账：' + noted(answered.note));
  assert.equal(answered.state.certification.judgments[1], false,
    'appealScene：局面名承诺「判不通过」⇒ judgments[1] 必须是 false');
  const funded = {
    ...answered.state,
    players: answered.state.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)),
  };
  const appealed = certifyAppeal(funded, 0, 0);
  assert.ok(appealed.ok, 'appealScene：复议申请必须成功：' + noted(appealed.note));
  assert.ok(appealed.state.certification.appealed.includes(0), 'appealScene：appealed 必须含座 0');
  return appealed.state;
}

test('B64/T2-1 事实源：独立第三方集合 == 裁定口径（存活 − 判定人 − 待认证者）', () => {
  const s = appealScene();
  const third = appealThirdParties(s, 0);
  // 5 人局：存活 5 − 判定人（座 1）− 待认证者（座 0）= 座 2/3/4
  assert.deepEqual(third, [2, 3, 4],
    '[B64/T2-1 事实源] 独立第三方必须是「存活 − 判定人 − 待认证者」');
  // ⚠️ **与裁定口径逐项相等**（不是「看起来一样」）：让座 2/3 投票、座 4 不投
  //   ⇒ 裁定结果里的「复议投票 x/3」分母必须是 3。
  let voted = certifyAppealVote(s, 2, 0, true).state;
  voted = certifyAppealVote(voted, 3, 0, true).state;
  const resolved = resolveAppeals(voted, 0);
  assert.ok(resolved.ok, 'B64/T2-1 事实源：复议裁定应成功：' + String(resolved.note));
  assert.match(String(resolved.note), /复议投票 2\/3/,
    '[B64/T2-1 事实源] 裁定的分母必须是独立第三方人数 3 ⇒ 事实源与裁定口径必须同源');
});

test('B64/T2-2 单一事实源：不得在调用方各自复制「独立第三方」口径', () => {
  // ⚠️ 这条钉的是**结构**（防第二事实源回流），不是行为。
  //   口径一旦被抄进 UI / 探针，两边各自演化 ⇒ 显示的「未投人数」与实际裁定不一致 ⇒ 玩家看到假数字。
  const certSrc = readFileSync('web/ui/cert.ts', 'utf8');
  const stateTextSrc = readFileSync('tools/laya-probe/state-text.mjs', 'utf8');
  for (const [name, src] of [['web/ui/cert.ts', certSrc], ['tools/laya-probe/state-text.mjs', stateTextSrc]] as const) {
    assert.match(src, /appealThirdParties\(/,
      `[B64/T2-2 单一事实源] ${name} 必须调用 appealThirdParties（唯一出处），不得自己算第三方集合`);
    // 「存活 − 判定人 − 待认证者」这条口径的**手写形状**（判不通过 + 存活过滤 + 排除两个座位）
    const handRolled = /judgments\[[^\]]+\]\s*===\s*false[\s\S]{0,240}?\.filter\([^)]*\.alive/.test(src);
    assert.equal(handRolled, false,
      `[B64/T2-2 单一事实源] ${name} 不得手写「独立第三方」集合口径（存活过滤 + 排除判定人/待认证者）`);
  }
});

test('B64/T2-3 UI 文案：显示的第三方人数 / 已投 / 未投必须与状态一致', () => {
  const s = appealScene();
  const text0 = appealWindowStatus(s, 0);
  assert.match(text0, /第三方 3 人/,
    '[B64/T2-3 UI 文案] 必须显示独立第三方人数 3（座 2/3/4）');
  assert.match(text0, /已投 0/,
    '[B64/T2-3 UI 文案] 尚未投票 ⇒ 已投必须是 0');
  assert.match(text0, /未投 3（座2、座3、座4）/,
    '[B64/T2-3 UI 文案] 必须点名「谁还没投」（座 2/3/4）⇒ 玩家看得见还差谁');
  assert.match(text0, /轮末/,
    '[B64/T2-3 UI 文案] 必须说清「窗口何时关」（轮末）');

  // 投一票后，计数必须跟着变（未投 2 人、点名剩下两个）
  const voted = certifyAppealVote(s, 2, 0, true).state;
  const text1 = appealWindowStatus(voted, 0);
  assert.match(text1, /已投 1/, '[B64/T2-3 UI 文案] 投一票后已投必须是 1');
  assert.match(text1, /未投 2（座3、座4）/,
    '[B64/T2-3 UI 文案] 投一票后未投必须减为 2 且点名剩下的人');
});

test('B64/T2-4 窗口关闭时机：第三方不足 2 人时文案必须说「掷骰」而不是「多数决」', () => {
  // 3 人局：座 0 待认证、座 1 判不通过 ⇒ 第三方 = 存活 3 − 座 1 − 座 0 = 座 2（仅 1 人）⇒ 掷骰路径。
  const challenged = certifyChallenge(putPending(mk(3, 7), [0]), 1, 0);
  assert.ok(challenged.ok, 'B64/T2-4：座 1 发起质疑必须成功：' + String(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.ok(answered.ok, 'B64/T2-4：判定必须落账：' + String(answered.note));
  const funded = {
    ...answered.state,
    players: answered.state.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)),
  };
  const appealed = certifyAppeal(funded, 0, 0);
  assert.ok(appealed.ok, 'B64/T2-4：复议申请必须成功：' + String(appealed.note));
  const third = appealThirdParties(appealed.state, 0);
  assert.deepEqual(third, [2], '[B64/T2-4 窗口关闭时机] 3 人局的独立第三方只有座 2');
  const text0 = appealWindowStatus(appealed.state, 0);
  assert.match(text0, /第三方 1 人/, '[B64/T2-4 窗口关闭时机] 必须显示第三方 1 人');
  assert.match(text0, /掷 6 面骰/,
    '[B64/T2-4 窗口关闭时机] 第三方不足 2 人 ⇒ 必须说清「掷骰裁定」，不得说「多数决」');
  assert.equal(/多数决/.test(text0), false,
    '[B64/T2-4 窗口关闭时机] 掷骰路径下不得出现「多数决」字样（会误导玩家以为要凑票）');
});

test('B64/T2-5 探针口径：state-text 的复议计数与事实源同源（不得各算一份）', () => {
  const s = appealScene();
  const third = appealThirdParties(s, 0);
  assert.equal(third.length, 3, '前提自查：本局面的独立第三方必须是 3 人');
  // describeState 的复议票文本里必须出现同一组数字（第三方 3 人 / 未投 3）
  const described = describeState(s, 2);
  const flat = JSON.stringify(described);
  assert.match(flat, /第三方 3 人/,
    '[B64/T2-5 探针口径] state-text 的复议计数必须与事实源一致（第三方 3 人）');
  assert.match(flat, /未投 3/,
    '[B64/T2-5 探针口径] state-text 的复议计数必须与事实源一致（未投 3）');
});

// ================= 变异自证：证明上面 5 条断言**真的有判别力** =================
//
// ⚠️ 为什么必须做（E113 同族）：断言「本来就绿」不证明它能抓住回归 ⇒ 每条核心断言
//   都要有一个 mutant ⇒ 撤掉实现后它**必须红**，且红在**该层专属措辞**上。
//
// ⚠️ 副本纪律（E23 / E15）：
//   · 共享工作树**只读** ⇒ 所有写入发生在系统临时目录的副本里；
//   · 副本必须含**被 mutant 影响的那个测试文件**及其依赖 ⇒ 直接复制整个 tests/engine；
//   · **直接运行副本里的测试文件**（不用 `node --test`）⇒ 在测试文件内再调用 --test
//     会被 Node 跳过（「run() is being called recursively」）⇒ 退出码恒 0 ⇒ 误判「没有专属锁」；
//   · **清掉 `NODE_TEST_CONTEXT`** ⇒ 否则子进程用 TAP reporter ⇒ 失败消息不在输出里；
//   · 失败详情**stdout 与 stderr 两路都收**。

/** 副本里跳过变异自证（否则副本会再跑变异 ⇒ 递归）。 */
const SKIP_MUTATION = process.env['CM_SKIP_MUTATION'] === '1';

/** 在**隔离副本**里跑 mutant ⇒ 断言「被这一层专属措辞打红」。 */
function runMutant(
  mutate: (dir: string) => void,
): { code: number; out: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b64-'));
  const entry = 'tests/engine/appeal-window.test.ts';
  try {
    cpSync(resolve('engine'), resolve(dir, 'engine'), { recursive: true });
    cpSync(resolve('themes'), resolve(dir, 'themes'), { recursive: true });
    cpSync(resolve('tools'), resolve(dir, 'tools'), { recursive: true });
    // ⚠️ **web/ 必须复制**：mutant 改的是 `web/ui/cert.ts` ⇒ 副本缺它 ⇒ patch 直接 ENOENT
    //   ⇒ 变异自证变成「测的是文件缺失」而非「测的是判别力」。
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
        cwd: dir,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
        env,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return {
        code: typeof err.status === 'number' ? err.status : -1,
        out: String(err.stdout ?? '') + '\n' + String(err.stderr ?? ''),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 在副本里做一次「唯一一处」的文本替换，替换不到就当场失败（避免 mutant 静默变成空操作）。 */
function patchCopy(dir: string, rel: string, from: string, to: string): void {
  const p = resolve(dir, rel);
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes(from), 'mutant 必须在 ' + rel + ' 里找到目标片段：' + from);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, src.replace(from, to));
}

test('[B64-M1 变异自证] UI 改回手写口径（第二事实源回流）⇒ 单一事实源层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'web/ui/cert.ts',
      '  const third = appealThirdParties(state, target);',
      '  const third = state.players.filter((pp) => pp.alive && pp.seat !== 0 && pp.seat !== 1).map((pp) => pp.seat);');
  });
  assert.notEqual(r.code, 0,
    '[B64-M1 变异自证] mutant（UI 改回手写口径）必须让测试变红 —— 否则单一事实源没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B64\/T2-2/.test(r.out),
    '[B64-M1 变异自证] mutant 必须红在「单一事实源」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B64-M2 变异自证] 事实源口径漂移（少排除待认证者）⇒ 事实源与显示层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/certification.ts',
      '    .filter((p) => p.alive && p.seat !== target && p.seat !== challenger)',
      '    .filter((p) => p.alive && p.seat !== challenger)');
  });
  assert.notEqual(r.code, 0,
    '[B64-M2 变异自证] mutant（口径漂移）必须让测试变红 —— 否则事实源层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B64\/T2-1/.test(r.out),
    '[B64-M2 变异自证] mutant 必须红在「事实源」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B64-M3 变异自证] UI 文案与状态脱节（未投人数写死 0）⇒ 显示层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'web/ui/cert.ts',
      '  const notYet = third.filter((s) => c.appealVotes[s] === undefined);',
      '  const notYet: number[] = [];');
  });
  assert.notEqual(r.code, 0,
    '[B64-M3 变异自证] mutant（文案与状态脱节）必须让测试变红 —— 否则显示层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B64\/T2-3/.test(r.out),
    '[B64-M3 变异自证] mutant 必须红在「显示」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});
