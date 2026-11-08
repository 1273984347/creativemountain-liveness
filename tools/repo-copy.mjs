// 仓库快照复制（单一事实源）—— 隔离副本测试与干净副本自检共用。
//
// 为什么抽出：两处都要「按**版本库跟踪清单**复制到临时目录」；
//   各写一份 ⇒ 清单逻辑漂移（一份按目录、一份按 git ls-files）⇒ 副本语义不一致，
//   且「干净副本」会悄悄变成「工作树全量副本」。
//
// ⚠️ 复制的是**工作树内容**（不是 git 检出）—— 副本要反映当前未提交的改动。

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
