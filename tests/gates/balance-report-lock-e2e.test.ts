// B94 · 门 ⑮ 的**端到端**负样本：证明「引擎变了、报告没重生成 ⇒ 门禁必红」。
//
// ⚠️ 为什么上一份负样本（balance-report-lock.test.ts）还不够：
//   它测的是**判据纯函数**（两份文本不一致 ⇒ 判红）—— 证明「比对逻辑有牙」；
//   但**不能**证明「这条门真的会在引擎演进后报红」—— 那需要**真的改引擎、真的重跑、真的比对**。
//   ⇒ 本文件做**端到端**自证：隔离副本里改一行引擎 ⇒ 门 ⑮ 的 CLI 必须 **exit 1**；
//     按原字节恢复 ⇒ 必须 **exit 0**（违例必红、恢复必绿）。
//
// ⚠️ **共享工作树全程只读**：所有改动只发生在**隔离临时目录**里
//   （《负样本自证范式》：负样本若对仓库有任何写入，就不是负样本）。
//   ⚠️ 副本内的 sim 用**绝对路径** `--out`（B94 实测踩到：sim 的 `--out` 相对路径按
//   **cwd** 解析 ⇒ 副本里跑 sim 若不带绝对路径，会把副本产物**写回原仓库**）。
//
// ⚠️ **用小口径（--games 30）**：端到端自证的要点是「改了引擎 ⇒ 判红」，
//   与局数无关；用 30 局/档（720 局）把耗时从 ~2 分钟压到 ~6 秒。
//   ⚠️ 基线也必须同口径生成 ⇒ 先在副本里用**未漂移**的引擎生成 30 局基线，
//   再注入漂移（否则基线与重跑口径不同，差异会被「口径差」淹没 ⇒ 断言会失真）。
//
// ⚠️ **测的是被测实现本身**（tools/balance-report-lock-cli.mjs 及其判据模块），不是复刻。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();

/**
 * 副本里要复制的目录/文件（引擎 + 主题包 + sim + 本门工具 + 配置 + **规格**）。
 *
 * ⚠️ **必须含 `docs/superpowers/specs/`**：门 ⑮ 的**权威样本口径**从**规格 §9.2** 派生
 *   （独立锚点 ⇒ 才防得住「缩样本 + 重生成」）⇒ 副本缺规格 ⇒ 期望值派生失败 ⇒ 门在副本里报错。
 *   ⇒ 漏这一项会让端到端自证**假红**（B94 实测踩到）。
 *   ⚠️ 本项在早期版本里曾被 `--scope-from-report` 绕过（该开关已删除）⇒ 现在**必须**含。
 */
const COPY_PATHS = [
  'engine',
  'themes',
  'tests',
  'tools',
  'docs/superpowers/specs',
  'package.json',
  'tsconfig.json',
];

/** 漂移注入点：副本里把 poison 扣血从 `layers` 改成 `layers - 1`。 */
const DRIFT_FILE = 'engine/core/statuses.ts';
const DRIFT_FROM = 'const hp = Math.max(0, p.hp - layers);';
const DRIFT_TO = 'const hp = Math.max(0, p.hp - layers - 1);';

/** 自证用的小口径（每档局数）。 */
const SMALL_GAMES = '30';

/** 隔离副本目录（`null` = 尚未建）。 */
let cachedIso: string | null = null;

/** 建隔离副本（只建一次，多个用例共用 ⇒ 避免重复复制）。 */
function makeIso(): string {
  if (cachedIso !== null) { return cachedIso; }
  const dir = mkdtempSync(join(tmpdir(), 'cm-bal-lock-'));
  for (const rel of COPY_PATHS) {
    const src = resolve(ROOT, rel);
    const dst = resolve(dir, rel);
    if (existsSync(src) && !existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst, { recursive: true });
    }
  }
  mkdirSync(resolve(dir, 'docs'), { recursive: true });
  cachedIso = dir;
  return dir;
}

/** 跑一次门 ⑮ 的 CLI（副本内），返回其退出码与输出。 */
function runLock(iso: string, reportPath: string): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    resolve(iso, 'tools', 'balance-report-lock-cli.mjs'),
    '--games', SMALL_GAMES,
    '--report', reportPath,
    // ⚠️ **只传 --games**（不传任何能关闭「防缩样本」能力的开关）⇒
    //   期望口径仍**派生自规格 §9.2**（按局数等比缩放）⇒ **端到端自证走的是真实门禁路径**
    //   （规格锚点派生 · 主题包实扫 · 实际 stdout 局数核对 · 逐字节比对 · 漂移必红）
    //   ⇒ 规格被破坏 / 缩样本 ⇒ 本自证也会红。
  ], { encoding: 'utf8', shell: false, cwd: iso, maxBuffer: 64 * 1024 * 1024 });
  return { code: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

// 副本建好后**统一清理**（进程退出前不删 ⇒ 多个用例共用一份）。
process.on('exit', () => {
  if (cachedIso !== null) { rmSync(cachedIso, { recursive: true, force: true }); }
});

test('端到端自证：隔离副本 · 未漂移 ⇒ 门 ⑮ exit 0（正样本：副本环境可用）', () => {
  const iso = makeIso();
  const report = resolve(iso, 'docs', 'balance-report.md');

  // 先用**未漂移**的引擎在副本内生成同口径基线（绝对路径 --out，避免写回原仓）。
  const gen = spawnSync(process.execPath, [
    resolve(iso, 'tests', 'sim', 'run.mjs'), '--games', SMALL_GAMES, '--out', report,
  ], { encoding: 'utf8', shell: false, cwd: iso, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(gen.status, 0, '副本内生成基线失败：' + (gen.stdout ?? '') + (gen.stderr ?? ''));
  assert.ok(existsSync(report), '副本内基线未生成');

  const r = runLock(iso, report);
  assert.equal(r.code, 0, '未漂移时门 ⑮ 必须 exit 0，实际输出：' + r.out);
  assert.ok(r.out.includes('逐字节一致'), '输出须说明逐字节一致，实际：' + r.out);
});

test('端到端自证：隔离副本 · 改一行引擎 ⇒ 门 ⑮ exit 1 且点名差异行（违例必红）', () => {
  const iso = makeIso();
  const report = resolve(iso, 'docs', 'balance-report.md');
  const driftPath = resolve(iso, DRIFT_FILE);

  const original = readFileSync(driftPath, 'utf8');
  assert.ok(original.includes(DRIFT_FROM), '漂移注入锚点不存在（引擎已变？本样本会失真）');
  writeFileSync(driftPath, original.replace(DRIFT_FROM, DRIFT_TO), 'utf8');
  try {
    const r = runLock(iso, report);
    assert.equal(r.code, 1, '引擎漂移后门 ⑮ 必须 exit 1，实际输出：' + r.out);
    assert.ok(r.out.includes('已漂移'), '输出须点名「已漂移」，实际：' + r.out);
    assert.ok(/第 \d+ 行｜期望：/.test(r.out), '输出须逐行点名差异，实际：' + r.out);
  } finally {
    // ⚠️ 按**原字节**写回（E138：撤销注入按原字节写回）。
    writeFileSync(driftPath, original, 'utf8');
  }
});

test('端到端自证：按原字节恢复 ⇒ 门 ⑮ 必绿（恢复必绿）', () => {
  const iso = makeIso();
  const report = resolve(iso, 'docs', 'balance-report.md');
  const driftPath = resolve(iso, DRIFT_FILE);

  const original = readFileSync(driftPath, 'utf8');
  writeFileSync(driftPath, original.replace(DRIFT_FROM, DRIFT_TO), 'utf8');
  writeFileSync(driftPath, original, 'utf8'); // 按原字节恢复
  const r = runLock(iso, report);
  assert.equal(r.code, 0, '恢复后必须 exit 0，实际输出：' + r.out);
});

test('纪律：端到端自证全程**未写共享工作树**（仓内报告与引擎零改动）', () => {
  // 判据：仓内被测文件的字节与 git 索引一致（由外层门禁的 git status 兜底，这里做直断言）。
  const driftPath = resolve(ROOT, DRIFT_FILE);
  const text = readFileSync(driftPath, 'utf8');
  assert.ok(text.includes(DRIFT_FROM), '共享工作树的引擎被负样本改坏了：' + DRIFT_FILE);
  assert.ok(!text.includes(DRIFT_TO), '共享工作树的引擎残留了漂移注入：' + DRIFT_FILE);
});
