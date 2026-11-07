// 门禁第 10 道（对峙浏览器端到端）的**常驻负样本自证**。
//
// ⚠️ 为什么必须用**隔离临时目录**：直接在共享工作树上改引擎源码制造缺陷，
//   会让并行的 `node --test`（门 2）读到坏代码 ⇒ 门禁② 假红、无法区分真因。
//   ⇒ 复制到临时目录改**副本**，共享工作树全程只读。
//
// 三个用例：
//   ① 负样本 A：引擎丢掉对峙消费点 ⇒ **门 9**（模拟器可达性断言）必红；
//   ② 负样本 B：E2E 的断言被破坏 ⇒ **门 10** 必红；
//   ③ 正样本：未破坏的副本 ⇒ 门 9 必须**绿**（证明上面的红不是「副本环境本身跑不起来」）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 建立隔离副本（engine / themes / web / tests/sim / tests/e2e）。 */
function makeCopy(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-neg-'));
  cpSync(resolve(ROOT, 'engine'), resolve(dir, 'engine'), { recursive: true });
  cpSync(resolve(ROOT, 'themes'), resolve(dir, 'themes'), { recursive: true });
  cpSync(resolve(ROOT, 'web'), resolve(dir, 'web'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'sim'), resolve(dir, 'tests', 'sim'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'e2e'), resolve(dir, 'tests', 'e2e'), { recursive: true });
  return dir;
}

/** 在副本里跑模拟器冒烟（门 9）。 */
function runSim(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tests', 'sim', 'run.mjs'), '--games', '30', '--check'], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 在副本里跑 E2E（门 10），bundle 指向仓库已构建的 dist。 */
function runE2E(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tests', 'e2e', 'duel-e2e.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CM_E2E_BUNDLE: resolve(ROOT, 'dist', '创界山-活人认证.html') },
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 破坏副本里的引擎对峙消费点。 */
function breakEngine(cwd: string): void {
  const p = resolve(cwd, 'engine', 'core', 'duel.ts');
  const src = readFileSync(p, 'utf8');
  const broken = src.replace(
    '  return { ...state, duel: { seatA, seatB } };',
    '  return { ...state, duel: null }; // NEG-SAMPLE',
  );
  assert.notEqual(broken, src, '负样本：应能在副本里破坏引擎的对峙消费点');
  writeFileSync(p, broken, 'utf8');
}

/** 破坏副本里的 E2E 断言（回合解锁）。 */
function breakE2E(cwd: string): void {
  const p = resolve(cwd, 'tests', 'e2e', 'duel-e2e.mjs');
  const src = readFileSync(p, 'utf8');
  const broken = src.replace(
    'const unlocked = (await moveBtn.count()) > 0;',
    'const unlocked = false; // NEG-SAMPLE',
  );
  assert.notEqual(broken, src, '负样本：应能在副本里破坏 E2E 的断言');
  writeFileSync(p, broken, 'utf8');
}

test('负样本 A（隔离副本）：引擎丢掉对峙消费点 ⇒ 门 9 必红', () => {
  const dir = makeCopy();
  try {
    breakEngine(dir);
    const r = runSim(dir);
    assert.notEqual(r.status, 0, '破坏引擎后门 9 必须判红');
    assert.match(r.out, /对峙在真实对局中从未发生/, '应报出对峙不可达');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('负样本 B（隔离副本）：E2E 断言被破坏 ⇒ 门 10 必红', (t) => {
  if (!existsSync(resolve(ROOT, 'dist', '创界山-活人认证.html'))) {
    t.skip('dist 未构建（门 4 尚未运行）⇒ 跳过；门 9 的负样本 A 不受影响，仍是常驻保障');
    return;
  }
  const dir = makeCopy();
  try {
    breakE2E(dir);
    const r = runE2E(dir);
    assert.notEqual(r.status, 0, '断言被破坏后门 10 必须判红');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('正样本（隔离副本）：未破坏时门 9 必须绿（证明副本环境本身可用）', () => {
  const dir = makeCopy();
  try {
    const r = runSim(dir);
    assert.equal(r.status, 0, '未破坏时门 9 必须绿：' + r.out.slice(-400));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
