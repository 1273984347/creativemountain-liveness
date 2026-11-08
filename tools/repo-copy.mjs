// 仓库快照复制（单一事实源）—— 隔离副本测试与干净副本自检共用。
//
// 为什么抽出：两处都要「按**版本库跟踪清单**复制到临时目录」；
//   各写一份 ⇒ 清单逻辑漂移（一份按目录、一份按 git ls-files）⇒ 副本语义不一致，
//   且「干净副本」会悄悄变成「工作树全量副本」。
//
// ⚠️ 复制的是**工作树内容**（不是 git 检出）—— 副本要反映当前未提交的改动。

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

/**
 * 列出工作树快照的文件（相对路径，/ 分隔）。
 *
 * = **已入库文件**（`--cached`）+ **未跟踪但未被 .gitignore 忽略的文件**（`--others --exclude-standard`）。
 *
 * ⚠️ 为什么要带 `--others`：**未入库的新文件也是工作树的一部分**。
 *   只取 `--cached` 时，本批新建的模块（如 `tools/rules-book-contract.mjs`）不在副本里
 *   ⇒ 副本的门禁会因「模块找不到」而红 —— 这是**假的自举失败**，不是真缺陷。
 *
 * ⚠️ 为什么要 `-c core.quotePath=false`：默认 git 会把非 ASCII 路径**转义并加引号**
 *   （如 `"print/\350\247\214...md"`）⇒ 按该字符串解析出来的路径**根本不存在**。
 *   实测：中文文件名在副本里被静默漏掉（副本缺规格/规则书 ⇒ 门③ 报 ENOENT）。
 *
 * @param {string} root 仓库根
 * @returns {string[]}
 */
export function repoFiles(root) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) { throw new Error('git ls-files 失败：' + (r.stderr ?? '')); }
  return r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
}

/**
 * 列出**已入库**的文件（相对路径，/ 分隔）—— 不含未跟踪文件。
 *
 * = `git ls-files --cached`（同样带 `-c core.quotePath=false` ⇒ 中文路径不转义）。
 *
 * ⚠️ 为什么与 `repoFiles()` 分开：`repoFiles()` 是「工作树快照」（含未跟踪文件），
 *   用于**复制副本**；本函数用于「判断某个目录里**哪些文件是入库的**」——
 *   即「扫描盲区里有没有真源文件」⇒ 必须排除未跟踪的生成物。
 *
 * @param {string} root 仓库根
 * @returns {string[]}
 */
export function trackedFiles(root) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '--cached'], {
    cwd: root, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) { throw new Error('git ls-files --cached 失败：' + (r.stderr ?? '')); }
  return r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
}

/**
 * 把跟踪文件复制到目标目录（保持相对路径）。
 *
 * @param {string} root 仓库根
 * @param {string} dest 目标目录
 * @param {{include?: readonly string[], exclude?: readonly string[]}} [opts]
 *   include：只复制这些路径/前缀（空 = 全部）；exclude：排除的路径（精确匹配）。
 *
 * ⚠️ 副本里的**测试脚本要排除**：负样本脚本复制的是 `process.cwd()`（副本自己）
 *   ⇒ 若不排除，副本的门 ② 会无限套娃。
 * @returns {number} 复制的文件数
 */
export function copyTracked(root, dest, { include = [], exclude = [] } = {}) {
  const files = repoFiles(root);
  let n = 0;
  for (const rel of files) {
    if (exclude.includes(rel)) { continue; }
    if (include.length > 0 && !include.some((p) => rel === p || rel.startsWith(p))) { continue; }
    const src = resolve(root, rel);
    if (!existsSync(src)) { continue; } // 索引里存在但工作树已删
    const dst = resolve(dest, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
    n += 1;
  }
  return n;
}

/**
 * 跑门 ③（doc-sync）所需的最小文件集 —— **单一事实源**。
 *
 * ⚠️ 为什么要含 `print/规则书叙述.md`：C10 要读它（规则书地形覆盖校验）⇒
 *   副本缺它 ⇒ doc-sync 因 C10 判红 ⇒ 「恢复后判绿」的断言会被误判为缺陷。
 */
export const DOC_SYNC_INCLUDE = [
  'tools/',
  'engine/',
  'docs/superpowers/specs/',
  'print/规则书叙述.md',
  'package.json',
  'tsconfig.json',
  'esbuild.config.mjs',
];

/**
 * 建一个**隔离副本**（工作树快照），供负样本在副本里改副本。
 *
 * ⚠️ 为什么必须隔离：node:test **跨文件并发**跑测试文件；负样本若就地改共享工作树
 *   ⇒ 并行读的其它测试会读到**中间态** ⇒ 门禁瞬时假红（B17 实测踩过）。
 *
 * @param {string} root 仓库根
 * @param {readonly string[]} [include] 复制清单（默认 DOC_SYNC_INCLUDE）
 * @returns {string} 副本目录
 */
export function makeIsolatedRepo(root, include = DOC_SYNC_INCLUDE) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-iso-'));
  copyTracked(root, dir, { include });
  return dir;
}

/** 清理隔离副本（务必在 finally 里调用）。 */
export function removeIsolatedRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}
