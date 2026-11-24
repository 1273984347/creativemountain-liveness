// 门禁第 10 道（对峙浏览器端到端）的**常驻负样本自证**。
//
// ⚠️ 为什么必须用**隔离临时目录**：直接在共享工作树上改引擎源码制造缺陷，
//   会让并行的 `node --test`（门 2）读到坏代码 ⇒ 门禁② 假红、无法区分真因。
//   ⇒ 复制到临时目录改**副本**，共享工作树全程只读。
//
// ⚠️ 为什么副本能**自建 bundle**：esbuild.config.mjs 支持 `CM_BUILD_ROOT` 覆盖根目录
//   （脚本仍在仓库 ⇒ `import 'esbuild'` 正常解析，无需在副本里准备 node_modules），
//   ⇒ 副本用**自己的 engine/ web/ themes/** 构建出副本 bundle ⇒ E2E 测的正是副本引擎。
//   ⇒ **完全不依赖仓库的 dist**（即使仓库没有 dist，负样本 B 依然必红）。
//
// 五个用例：
//   ① 负样本 A：引擎丢掉对峙消费点 ⇒ **门 9**（模拟器可达性断言）必红；
//   ② 负样本 B：引擎丢掉对峙消费点 ⇒ 副本自建 bundle ⇒ **门 10** 必红；
//   ③ 负样本 C：E2E 的断言被破坏 ⇒ **门 10** 必红（证明断言机制本身有效）；
//   ④ 正样本 A：未破坏的副本 ⇒ **门 9** 必须绿；
//   ⑤ 正样本 B：未破坏的副本 ⇒ 自建 bundle ⇒ **门 10** 必须绿（证明副本 bundle 可用）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 建立隔离副本（engine / themes / web / tests/sim / tests/e2e + E2E 依赖的 fixtures）。 */
function makeCopy(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-neg-'));
  cpSync(resolve(ROOT, 'engine'), resolve(dir, 'engine'), { recursive: true });
  cpSync(resolve(ROOT, 'themes'), resolve(dir, 'themes'), { recursive: true });
  cpSync(resolve(ROOT, 'web'), resolve(dir, 'web'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'sim'), resolve(dir, 'tests', 'sim'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'e2e'), resolve(dir, 'tests', 'e2e'), { recursive: true });
  mkdirSync(resolve(dir, 'tests', 'engine'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'engine', 'fixtures.ts'), resolve(dir, 'tests', 'engine', 'fixtures.ts'));
  return dir;
}

/** 在副本里跑模拟器冒烟（门 9）。 */
function runSim(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tests', 'sim', 'run.mjs'), '--games', '30', '--check'], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/**
 * 在副本里**自建** bundle（用仓库的 esbuild.config.mjs + `CM_BUILD_ROOT` 指向副本）。
 *
 * ⚠️ 这样 E2E 测的是**副本的引擎**（含被注入的缺陷），且**完全不依赖仓库的 dist**。
 */
function buildCopy(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(ROOT, 'esbuild.config.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CM_BUILD_ROOT: cwd },
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 在副本里跑 E2E（门 10），bundle 指向**副本自建**的 dist。 */
function runE2E(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tests', 'e2e', 'duel-e2e.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      CM_E2E_BUNDLE: resolve(cwd, 'dist', '创界山-活人认证.html'),
      CM_REPO_ROOT: ROOT, // 副本没有 node_modules ⇒ playwright 从仓库根解析
    },
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/**
 * 在副本里**破坏引擎的对峙入口**。
 *
 * ⚠️ 必须切**两条**出口（B77 暴露的脆弱点）：`startDuel` 有两条都会写 `kind:'duel'` 日志的路径——
 *   ① `:76` 立起 pending 对峙；② 空手相遇走 `autoLose()`，它经 `logDuel()` 同样落一条 duel 日志。
 *   只切 ① 时，只要对局里出现过一次空手相遇，`duelTotal` 就 > 0 ⇒ 门 9 的可达性判据被骗过、
 *   负样本**假绿**。B77 之前 720 局的冒烟窗口里恰好没有空手相遇所以看不出来；
 *   B77 起 `silence`（封口）会在写入时弃一张牌 ⇒ 空手率上升，这条漏网路径立刻显形。
 *   ⇒ 判据本身没错（空手自动落败确实是一次按规则结算的对峙），错的是破坏点覆盖不全。
 */
function breakEngine(cwd: string): void {
  const p = resolve(cwd, 'engine', 'core', 'duel.ts');
  const src = readFileSync(p, 'utf8');
  const noPending = src.replace(
    '  return { ...state, duel: { seatA, seatB } };',
    '  return { ...state, duel: null }; // NEG-SAMPLE',
  );
  assert.notEqual(noPending, src, '负样本：应能破坏「立起 pending 对峙」这条出口');
  const noAutoLose = noPending.replace(
    '    return autoLose(state, seatA, seatB, loser);',
    '    return state; // NEG-SAMPLE（空手自动落败也不写日志）',
  );
  assert.notEqual(noAutoLose, noPending, '负样本：应能破坏「空手自动落败」这条出口（只切一条会让门 9 假绿）');
  writeFileSync(p, noAutoLose, 'utf8');
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

test('负样本 B（无 dist 的干净副本）：引擎丢掉对峙消费点 ⇒ 自建 bundle ⇒ 门 10 必红', () => {
  const dir = makeCopy();
  try {
    // 干净副本：**起始没有 dist** ⇒ 证明 E2E 不依赖仓库已构建的产物
    assert.equal(existsSync(resolve(dir, 'dist')), false, '副本起始应无 dist');
    breakEngine(dir);
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本自建 bundle 应成功：' + b.out.slice(-400));
    assert.equal(existsSync(resolve(dir, 'dist', '创界山-活人认证.html')), true, '副本应有自建 bundle');
    const r = runE2E(dir);
    assert.notEqual(r.status, 0, '引擎有缺陷时门 10 必须判红');
    assert.match(r.out, /"ok": false/, '应报出「未触发对峙」');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('负样本 C（隔离副本）：E2E 断言被破坏 ⇒ 门 10 必红', () => {
  const dir = makeCopy();
  try {
    breakE2E(dir);
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本自建 bundle 应成功：' + b.out.slice(-400));
    const r = runE2E(dir);
    assert.notEqual(r.status, 0, '断言被破坏后门 10 必须判红');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('正样本 A（隔离副本）：未破坏时门 9 必须绿（证明副本环境本身可用）', () => {
  const dir = makeCopy();
  try {
    const r = runSim(dir);
    assert.equal(r.status, 0, '未破坏时门 9 必须绿：' + r.out.slice(-400));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('正样本 B（隔离副本）：未破坏 ⇒ 自建 bundle ⇒ 门 10 必须绿（证明副本 bundle 可用）', () => {
  const dir = makeCopy();
  try {
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本自建 bundle 应成功：' + b.out.slice(-400));
    const r = runE2E(dir);
    assert.equal(r.status, 0, '未破坏时门 10 必须绿：' + r.out.slice(-600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
