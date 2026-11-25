// 门禁第 14 道（数字轨浏览器走查）的**常驻负样本自证**。
//
// ⚠️ 为什么必须用**隔离临时目录**：直接在共享工作树上改源码制造缺陷，
//   会让并行的 `node --test`（门 2）读到坏代码 ⇒ 门禁② 假红、无法区分真因。
//   ⇒ 复制到临时目录改**副本**，共享工作树全程只读。
//
// ⚠️ 副本**自建 bundle**（esbuild.config.mjs 的 `CM_BUILD_ROOT`）⇒ 走查测的是副本的 UI，
//   且**完全不依赖仓库的 dist**（即使仓库没构建过 dist，负样本也照样能证伪）。
//
// 四个用例（对应「违例必红、恢复必绿」）：
//   ① 负样本 A：副本里让占位符**不展开** ⇒ 走查必红且点名「占位符」；
//   ② 负样本 B：副本里让棋盘**超宽** ⇒ 走查必红且点名「横向溢出」；
//   ③ 负样本 C：副本里改坏走查**断言机制本身** ⇒ 必红（证明断言不是摆设）；
//   ④ 正样本：未破坏 ⇒ 必绿（证明副本环境本身可用）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 建立隔离副本（engine / themes / web / tests/e2e）。 */
function makeCopy(): string {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-neg-walk-'));
  cpSync(resolve(ROOT, 'engine'), resolve(dir, 'engine'), { recursive: true });
  cpSync(resolve(ROOT, 'themes'), resolve(dir, 'themes'), { recursive: true });
  cpSync(resolve(ROOT, 'web'), resolve(dir, 'web'), { recursive: true });
  cpSync(resolve(ROOT, 'tests', 'e2e'), resolve(dir, 'tests', 'e2e'), { recursive: true });
  return dir;
}

/** 在副本里自建 bundle（脚本仍在仓库 ⇒ esbuild 正常解析，无需副本有 node_modules）。 */
function buildCopy(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(ROOT, 'esbuild.config.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CM_BUILD_ROOT: cwd },
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 在副本里跑走查（bundle 指向副本自建产物；playwright 从真实仓根解析）。 */
function runWalkthrough(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tests', 'e2e', 'ui-walkthrough.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      CM_E2E_BUNDLE: resolve(cwd, 'dist', '创界山-活人认证.html'),
      CM_REPO_ROOT: ROOT,
    },
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 负样本 A：让主题词占位符**不展开**（页面会把 {path} 等直接印给玩家）。 */
function breakPlaceholder(cwd: string): void {
  const p = resolve(cwd, 'web', 'ui', 'terms.ts');
  const src = readFileSync(p, 'utf8');
  const broken = src.replace(
    'const byTerms = expandThemeWords(raw, terms);',
    'const byTerms = raw; // NEG-SAMPLE：占位符不展开',
  );
  assert.notEqual(broken, src, '负样本 A：应能在副本里破坏占位符展开点');
  writeFileSync(p, broken, 'utf8');
}

/** 负样本 B：让棋盘横向超宽（制造真实的横向溢出）。 */
function breakOverflow(cwd: string): void {
  const p = resolve(cwd, 'web', 'styles.css');
  const src = readFileSync(p, 'utf8');
  const broken = src.replace(
    '.board { display:flex; flex-wrap:wrap; gap:5px; }',
    '.board { width:5000px; display:flex; flex-wrap:wrap; gap:5px; }', // NEG-SAMPLE
  );
  assert.notEqual(broken, src, '负样本 B：应能在副本里破坏棋盘宽度');
  writeFileSync(p, broken, 'utf8');
}

/** 负样本 C：改坏走查**断言机制本身**（正常页面也会被判红）。 */
function breakAssertion(cwd: string): void {
  const p = resolve(cwd, 'tests', 'e2e', 'ui-walkthrough.mjs');
  const src = readFileSync(p, 'utf8');
  const broken = src.replace(
    'const OVERFLOW_TOLERANCE = 1;',
    'const OVERFLOW_TOLERANCE = -100000;', // NEG-SAMPLE
  );
  assert.notEqual(broken, src, '负样本 C：应能在副本里改坏溢出断言的容差');
  writeFileSync(p, broken, 'utf8');
}

test('负样本 A：占位符不展开 ⇒ 走查必红（点名「占位符」）', () => {
  const dir = makeCopy();
  try {
    breakPlaceholder(dir);
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本构建失败：' + b.out.slice(-400));
    const r = runWalkthrough(dir);
    assert.notEqual(r.status, 0, '占位符残留时走查必须判红');
    assert.match(r.out, /占位符/, '应报出占位符残留');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('负样本 B：棋盘横向超宽 ⇒ 走查必红（点名「横向溢出」）', () => {
  const dir = makeCopy();
  try {
    breakOverflow(dir);
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本构建失败：' + b.out.slice(-400));
    const r = runWalkthrough(dir);
    assert.notEqual(r.status, 0, '横向溢出时走查必须判红');
    assert.match(r.out, /横向溢出/, '应报出横向溢出');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('负样本 C：断言机制被改坏 ⇒ 走查必红（证明断言不是摆设）', () => {
  const dir = makeCopy();
  try {
    breakAssertion(dir);
    // ⚠️ 也要先构建副本 bundle：走查在「产物不存在」处就退出 ⇒ 那样红得没有意义
    //   （红的原因必须是「断言判红」，不是「跑不起来」）。
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本构建失败：' + b.out.slice(-400));
    const r = runWalkthrough(dir);
    assert.notEqual(r.status, 0, '断言容差被改坏后走查必须判红');
    assert.match(r.out, /横向溢出/, '应报出横向溢出');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('正样本：未破坏 ⇒ 走查必绿（证明副本环境本身可用）', () => {
  const dir = makeCopy();
  try {
    const b = buildCopy(dir);
    assert.equal(b.status, 0, '副本构建失败：' + b.out.slice(-400));
    const r = runWalkthrough(dir);
    assert.equal(r.status, 0, '未破坏时走查必须绿：' + r.out.slice(-600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
