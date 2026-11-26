// B98 · 门 ⑯ · dist 产物**字节基线一致性**的**端到端**负样本。
//
// ⚠️ 为什么上一份（dist-artifact-lock.test.ts）还不够：
//   它测的是**判据纯函数**（两份对象不一致 ⇒ 判红）—— 证明「比对逻辑有牙」；
//   但**不能**证明「这条门真的会在引擎演进后报红」—— 那需要**真的改源、真的重构建、真的比对**。
//   ⇒ 本文件做**端到端**自证：隔离副本里改一处源 ⇒ 门 ⑯ 的 CLI 必须 **exit 1**；
//     按原字节恢复 ⇒ 必须 **exit 0**（违例必红、恢复必绿）。
//
// ⚠️ **共享工作树全程只读**：所有改动只发生在**隔离临时目录**里
//   （《负样本自证范式》：负样本若对仓库有任何写入，就不是负样本）。
//   ⇒ 仓库根的 docs/baselines/dist-artifact.sha256.json **不复制进副本**：
//     期望值恒取**仓库根**那份 ⇒ 这正是「期望值独立于被检查对象」的保证。
//
// ⚠️ **副本里不复制 node_modules**（也不可能）：门 ⑯ 的 CLI 在**仓库内**跑
//   （脚本自身位置解析仓库根，不依赖 cwd）⇒ esbuild 从仓库的 node_modules 解析、
//   **源**从副本读（CM_BUILD_ROOT）⇒ 副本无需 node_modules。
//
// ⚠️ **副本里必须有 tsconfig.json**：esbuild 会读它（影响编译行为）⇒ 缺了产物就与基线不一致
//   ⇒ 正样本会**假红**。
//
// ⚠️ **测的是被测实现本身**（tools/dist-artifact-lock-cli.mjs 及其判据模块），不是复刻。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();

/**
 * 副本里要复制的目录/文件（源 + 主题 + 构建入口 + 本门工具 + 配置）。
 *
 * ⚠️ build/ 必须带上：构建链会读到（主题/规则书的构建期产物）。
 * ⚠️ tools/ 必须带上：副本保持自洽（副本内若被引用到门禁工具链即不出错）。
 */
const COPY_PATHS = [
  'engine',
  'themes',
  'web',
  'build',
  'tools',
  'esbuild.config.mjs',
  'package.json',
  'tsconfig.json',
];

/**
 * 漂移注入点：副本里把免疫窗的 flags 键前缀常量改掉。
 *
 * ⚠️ 选**常量**而非注释：注释改动不进产物 ⇒ 不会触发字节漂移 ⇒ 负样本失真。
 *   IMMUNITY_FLAG_PREFIX 的字面量被内联进 bundle ⇒ 改它必然改产物字节。
 */
const DRIFT_FILE = 'engine/core/statuses.ts';
const DRIFT_FROM = "export const IMMUNITY_FLAG_PREFIX = 'immunity_';";
const DRIFT_TO = "export const IMMUNITY_FLAG_PREFIX = 'immunity_DRIFT_PROBE_';";
const DRIFT_MARK = 'immunity_DRIFT_PROBE_';

/** 隔离副本目录（null = 尚未建）。 */
let cachedIso: string | null = null;

/** 建隔离副本（只建一次，多个用例共用 ⇒ 避免重复复制）。 */
function makeIso(): string {
  if (cachedIso !== null) { return cachedIso; }
  const dir = mkdtempSync(join(tmpdir(), 'cm-dist-lock-'));
  for (const rel of COPY_PATHS) {
    const src = resolve(ROOT, rel);
    const dst = resolve(dir, rel);
    if (existsSync(src) && !existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst, { recursive: true });
    }
  }
  // ⚠️ 副本里的 docs/ 只需建空目录：**基线不得复制进去** ⇒ 期望值恒取仓库根那份。
  mkdirSync(resolve(dir, 'docs'), { recursive: true });
  cachedIso = dir;
  return dir;
}

/** 跑一次门 ⑯ 的 CLI（**仓库内**的脚本，源指向副本），返回退出码与输出。 */
function runLock(iso: string, extraArgs: readonly string[] = []): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    resolve(ROOT, 'tools', 'dist-artifact-lock-cli.mjs'),
    '--source-root', iso,
    ...extraArgs,
  ], { encoding: 'utf8', shell: false, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return { code: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

// 副本建好后**统一清理**（进程退出前不删 ⇒ 多个用例共用一份）。
process.on('exit', () => {
  if (cachedIso !== null) { rmSync(cachedIso, { recursive: true, force: true }); }
});

test('端到端自证：隔离副本 · 未漂移 ⇒ 门 ⑯ exit 0（正样本：副本环境可用）', () => {
  const iso = makeIso();
  const r = runLock(iso);
  assert.equal(r.code, 0, '未漂移时门 ⑯ 必须 exit 0，实际输出：' + r.out);
  assert.ok(r.out.includes('逐字节一致'), '输出须说明逐字节一致，实际：' + r.out);
});

test('端到端自证：隔离副本 · 改一处源常量 ⇒ 门 ⑯ exit 1 且点名漂移（违例必红）', () => {
  const iso = makeIso();
  const driftPath = resolve(iso, DRIFT_FILE);

  const original = readFileSync(driftPath, 'utf8');
  assert.ok(original.includes(DRIFT_FROM), '漂移注入锚点不存在（源已变？本样本会失真）：' + DRIFT_FILE);
  writeFileSync(driftPath, original.replace(DRIFT_FROM, DRIFT_TO), 'utf8');
  try {
    const r = runLock(iso);
    assert.equal(r.code, 1, '源漂移后门 ⑯ 必须 exit 1，实际输出：' + r.out);
    assert.ok(r.out.includes('漂移'), '输出须点名「漂移」，实际：' + r.out);
    assert.ok(r.out.includes('产物字节漂移'), '输出须点名「产物字节漂移」，实际：' + r.out);
  } finally {
    // ⚠️ 按**原字节**写回（E138：撤销注入按原字节写回，不用 git checkout）。
    writeFileSync(driftPath, original, 'utf8');
  }
});

test('端到端自证：按原字节恢复 ⇒ 门 ⑯ 必绿（恢复必绿）', () => {
  const iso = makeIso();
  const driftPath = resolve(iso, DRIFT_FILE);

  const original = readFileSync(driftPath, 'utf8');
  assert.ok(original.includes(DRIFT_FROM), '漂移注入锚点不存在（源已变？本样本会失真）：' + DRIFT_FILE);
  writeFileSync(driftPath, original.replace(DRIFT_FROM, DRIFT_TO), 'utf8');
  writeFileSync(driftPath, original, 'utf8'); // 按原字节恢复
  const r = runLock(iso);
  assert.equal(r.code, 0, '恢复后必须 exit 0，实际输出：' + r.out);
});

test('防回归（E156 第 7 条）：门 ⑯ **不得**提供刷新基线的开关', () => {
  const iso = makeIso();
  // ① CLI 收到未知参数必须报错退出 1（静默忽略会让拼错的 flag 回落默认值 ⇒ 掩盖误用）。
  const r = runLock(iso, ['--update-baseline']);
  assert.equal(r.code, 1, '未知参数必须 exit 1，实际输出：' + r.out);
  assert.ok(r.out.includes('未知参数'), '输出须点名「未知参数」，实际：' + r.out);
});

test('防回归：CLI 源码里不出现任何「刷新基线」入口', () => {
  const cliSrc = readFileSync(resolve(ROOT, 'tools', 'dist-artifact-lock-cli.mjs'), 'utf8');
  assert.ok(!cliSrc.includes('update-baseline'), 'CLI 不得再有 --update-baseline（期望值会由被检查的一侧决定 ⇒ 同义反复）');
  assert.ok(!cliSrc.includes('--refresh'), 'CLI 不得有 --refresh 开关');
  assert.ok(!/refresh\w*Baseline/i.test(cliSrc), 'CLI 不得出现 refresh*Baseline 入口');
});

test('纪律：端到端自证全程**未写共享工作树**（仓库内源文件零改动）', () => {
  // 判据：仓库内被注入的那个源文件仍含原锚点、不含漂移串。
  const text = readFileSync(resolve(ROOT, DRIFT_FILE), 'utf8');
  assert.ok(text.includes(DRIFT_FROM), '共享工作树的源被负样本改坏了：' + DRIFT_FILE);
  assert.ok(!text.includes(DRIFT_MARK), '共享工作树的源残留了漂移注入：' + DRIFT_FILE);
});
