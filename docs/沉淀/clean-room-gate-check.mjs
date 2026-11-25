// 「干净副本」门禁自检：在**隔离临时目录**里跑完整条门禁。
//
// 用途（可沉淀可复用）：
//   · 验证门禁在**没有预置产物**（dist / node_modules 实体）的副本里仍能自举全绿；
//   · 验证门禁不依赖「仓库当前工作区状态」；
//   · 验证负样本自证（副本再套副本）在副本里**不会无限递归**。
//
// ⚠️ 为什么排除 `tests/gates/duel-negative.test.ts`：它在副本里会**再复制一份副本**，
//   ⇒ 若不排除，副本的门 ② 会无限套娃（它复制的是 process.cwd()，即副本自己）。
//   排除后副本的门 ② 少跑这一条常驻负样本，但仓库侧的常驻保障不受影响。
//
// 用法：node docs/沉淀/clean-room-gate-check.mjs

import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { copyTracked } from '../../tools/repo-copy.mjs';

const ROOT = process.cwd();

/**
 * 复制清单 = **工作树快照**（已入库 + 未跟踪但未忽略，见 `tools/repo-copy.mjs`）。
 *
 * 为什么不用手抄目录名：
 *   · 手抄目录会把 `.gitignore` 忽略的**生成物**（`dist/`、`print/<theme>/`）一起带进副本
 *     ⇒ 副本不再验证「无产物时能否自举」；
 *   · 按文件复制能保持相对路径，且**排除 .gitignore 项**。
 *
 * ⚠️ 未跟踪文件**要带上**：本批新建的模块（如 `tools/rules-book-contract.mjs`）尚未入库，
 *   只取已入库文件会让副本因「模块找不到」而假红。
 *
 * ⚠️ 复制逻辑与隔离副本测试共用 `tools/repo-copy.mjs`（单一事实源）。
 */
// ⚠️ 必须排除：它们在副本里会**再复制一份副本**（它们复制的是 process.cwd()，即副本自己）
//   ⇒ 若不排除，副本的门 ② 会无限套娃。
const EXCLUDE = ['tests/gates/duel-negative.test.ts', 'tests/build/rules-book.test.ts'];

const dir = mkdtempSync(resolve(tmpdir(), 'cm-clean-'));
try {
  copyTracked(ROOT, dir, { exclude: EXCLUDE });
  // node_modules 用**链接**而非复制（几百 MB，且内容只读）
  // ⚠️ 副本**刻意不带 dist / print 产物** ⇒ 验证门禁能在「全新 clone」状态下自举全绿。
  symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');

  // ⚠️ B88（L-B87-4）：副本里**建一个最小 git 仓库**（索引 + 一个基线提交）。
  //   起因：`tools/repo-copy.mjs` 的 `repoFiles()` 用 `git ls-files` 取「已入库文件清单」，
  //   而副本刻意不带 `.git` ⇒ 依赖 git 元数据的用例（如 `tests/gates/mutation-samples.test.ts`
  //   的隔离副本）必红 ⇒ 门 ② 在副本里永远红，且**红因与被验机制无关**。
  //   为什么这样修而不是改 `repoFiles()`：后者是复制语义的核心（同时服务门 ② 的隔离副本），
  //   改动风险高；这里只给副本补一个**索引**，不动生产复制逻辑。
  //   `git add -A` 遵守副本内的 `.gitignore` ⇒ 被忽略的生成物（dist/ print/ node_modules）不会进索引。
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', shell: false });
  if (init.status !== 0) {
    console.error('[clean-room] git init 失败：' + (init.stderr ?? ''));
    process.exitCode = 1;
  } else {
    // ⚠️ 索引必须**镜像真实仓的跟踪状态**：只把**真实仓里已跟踪**的文件喂进副本的索引。
    //   为什么不能用 `git add -A`：它会把副本里「未跟踪但未忽略」的文件（如 .qoder/）也变成「已跟踪」
    //   ⇒ `repo-selftest-scope` 守卫（跳过目录里不得有已入库文件）当场判红 —— 守卫是对的，是索引错了。
    //   为什么不用 pathspec 排除写法 `:!node_modules`：git 会对「ignored」直接报错退出。
    const tracked = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '--cached', '-z'],
      { cwd: ROOT, encoding: 'buffer', shell: false });
    if (tracked.status !== 0) {
      console.error('[clean-room] 读真实仓跟踪清单失败：' + String(tracked.stderr ?? ''));
      process.exitCode = 1;
    } else {
      // ⚠️ 副本里**没有**被 EXCLUDE 的文件 ⇒ 索引清单必须同步剔除（否则 update-index 报
      //   「does not exist and --remove not passed」⇒ 索引建立失败 ⇒ 副本无 git 元数据）。
      const excluded = new Set(EXCLUDE);
      const kept = Buffer.concat(
        tracked.stdout.toString('utf8').split('\0').filter(Boolean)
          .filter((p) => !excluded.has(p))
          .map((p) => Buffer.from(p + '\0', 'utf8')),
      );
      const idx = spawnSync('git', ['update-index', '-z', '--add', '--stdin'],
        { cwd: dir, input: kept, encoding: 'buffer', shell: false });
      if (idx.status !== 0) {
        console.error('[clean-room] 建立副本索引失败：' + String(idx.stderr ?? ''));
        process.exitCode = 1;
      } else {
        // ⚠️ 副本里**再补一个 HEAD**（B88 独立盲审）：只有索引没有提交 ⇒ `git rev-parse HEAD` /
        //   `git log` / `git show` 仍会失败 ⇒ 与「副本无 git 元数据」同型的假红风险。
        //   提交身份用一次性参数（不写全局 git config）。
        const commit = spawnSync('git',
          ['-c', 'user.email=clean-room@local', '-c', 'user.name=clean-room', 'commit', '-q', '-m', 'clean-room baseline'],
          { cwd: dir, encoding: 'utf8', shell: false });
        if (commit.status !== 0) {
          console.error('[clean-room] 建立副本 HEAD 失败：' + String(commit.stderr ?? ''));
          process.exitCode = 1;
        }
      }
    }
  }
  const r = spawnSync(process.execPath, [resolve(dir, 'tools', 'gate.mjs')], {
    cwd: dir, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  console.log(r.stdout ?? '');
  console.log(r.stderr ?? '');
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
