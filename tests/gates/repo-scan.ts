// 仓库级扫描器（B48 引入 / B51 重构）—— **单一事实源**。
//
// 为什么抽成共享模块（B51）：
//   原实现把「扫描逻辑」写死在 `repo-selftest-scope.test.ts` 里 ⇒ 正样本与负样本
//   无法共用同一套逻辑 ⇒ 负样本只能「另写一份近似实现」去测 ⇒ 那测的是负样本自己，
//   不是被测的扫描器 ⇒ **等于没测**。⇒ 逻辑必须住在可被双方 import 的模块里。
//
// 为什么令牌匹配改成**大小写不敏感**（B51）：
//   区分大小写 ⇒ `cm_selftest` / `--SELFTEST` 这类变体漏检（B50 登记的 T1）。
//   ⇒ 改为大小写不敏感；仍保持**精确令牌**（`CM_SELFTEST` / `--selftest`），
//   不能退化成子串 `selftest` —— 否则会被文件名 `repo-selftest-scope.test.ts` 误伤。
//
// 为什么有「例外文件」（B51）：
//   扫描器整目录跳过 `print/` 等目录 ⇒ 但 `print/规则书叙述.md` 是**已入库的源文件**
//   （规则书叙述模板，C10 要读它）⇒ 它此前**从未被扫描过**（B50 记「print/ 无跟踪
//   文件」不准确）⇒ 令牌能藏在那里。⇒ 例外清单把这类文件拉回扫描范围，
//   并由断言守住「清单与实际集合一致」（新增即红，不静默扩大盲区）。

import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** 自检入口的标识（**大小写不敏感**匹配；精确令牌，非子串）。 */
export const TOKENS: readonly string[] = ['CM_SELFTEST', '--selftest'];

/** 跳过目录（依赖 / 产物 / 版本库 / 编辑器配置）。 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'print', 'coverage', '.tmp', '.vscode', '.idea',
]);

/** 跳过的大文件阈值（>2MB 多半是二进制 / 字体）。 */
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * 允许区：**tests/**（自检能力本就只属于测试侧）与 **docs/批次/**（历史记录）。
 *
 * ⚠️ B49：允许区精确到**目录** —— 规格 / 沉淀索引 / README 等**活文档**不在允许区
 *   （它们是活文档 ⇒ 改写措辞即可，不该是免检区）。
 */
export const ALLOWED_ROOTS: readonly (readonly string[])[] = [['tests'], ['docs', '批次']];

/** CI 配置路径清单（目录递归扫，文件直读）。 */
export const CI_PATHS: readonly string[] = [
  '.github', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml', 'Jenkinsfile',
];

/**
 * 例外清单：**位于跳过目录内、但已入库的源文件** —— 仍要扫描。
 *
 * ⚠️ 日后新增条目必须同时说明理由；断言「跳过目录内的已入库文件集合 == 本清单」
 *   在 `repo-selftest-scope.test.ts` 里 ⇒ 漏登记即红。
 */
export const SCAN_EXCEPTIONS: readonly string[] = ['print/规则书叙述.md'];

/** 扫描结果。 */
export interface ScanResult {
  /** 命中令牌的位置（`相对路径 ⇒ 令牌`）。 */
  readonly hits: readonly string[];
  /** 实际扫描过的文件（相对路径，`/` 分隔）—— 供「覆盖确实发生」的断言使用。 */
  readonly scanned: readonly string[];
}

/** 归一化相对路径为 `/` 分隔（Windows 的 `\` 与 git 的 `/` 混用是本仓的老坑）。 */
export function normalizeRel(p: string): string {
  return p.split(/[\\/]/).join('/');
}

/** 路径是否在允许区。 */
export function allowed(relPath: string): boolean {
  const parts = normalizeRel(relPath).split('/');
  return ALLOWED_ROOTS.some((root) => root.every((seg, i) => parts[i] === seg));
}

/** 文本里命中的令牌（大小写不敏感；返回命中的令牌本身）。 */
export function hitsInText(text: string): string[] {
  const lower = text.toLowerCase();
  return TOKENS.filter((t) => lower.includes(t.toLowerCase()));
}

/**
 * 递归收集目录下的普通文件（跳过 SKIP_DIRS）。
 *
 * ⚠️ 单个目录不可读（权限）时**跳过**而不是让整条检查崩掉 —— 崩掉会让门禁
 *   变成「环境问题」，而这里要的是「能不能扫到该扫的东西」。
 */
function collectFiles(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) { continue; }
      collectFiles(full, out);
      continue;
    }
    if (entry.isFile()) { out.push(full); }
  }
}

/**
 * 扫描一棵目录树 ⇒ 命中令牌的位置 + 实际扫描过的文件。
 *
 * 跳过规则（**每条都是盲区** ⇒ 已在 `tools/coverage-boundaries.mjs` 如实登记）：
 *   · 允许区（`tests/`、`docs/批次/`）不扫；
 *   · SKIP_DIRS 整目录不扫（例外清单里的文件单独扫）；
 *   · >MAX_BYTES 的文件不扫；二进制（含 `\0`）不扫。
 */
export function scanTree(root: string): ScanResult {
  const hits: string[] = [];
  const scanned: string[] = [];
  const files: string[] = [];
  collectFiles(root, files);
  for (const full of files) {
    const rel = normalizeRel(relative(root, full));
    if (allowed(rel)) { continue; }
    let size = 0;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_BYTES) { continue; }
    let text = '';
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) { continue; }
    scanned.push(rel);
    for (const token of hitsInText(text)) { hits.push(rel + ' ⇒ ' + token); }
  }
  // 例外文件：父目录被跳过 ⇒ 单独扫描（否则它们成为盲区）。
  for (const rel of SCAN_EXCEPTIONS) {
    const full = resolve(root, rel);
    if (!existsSync(full)) { continue; }
    const text = readFileSync(full, 'utf8');
    scanned.push(normalizeRel(rel));
    for (const token of hitsInText(text)) { hits.push(rel + ' ⇒ ' + token); }
  }
  return { hits, scanned };
}

/**
 * 扫描 CI 配置 ⇒ 命中令牌的位置。
 *
 * ⚠️ 仓库当前**没有**任何 CI 配置 ⇒ 该检查在真实仓库上是**空集**（B50 登记的 T2）。
 *   ⇒ 其有效性由 `repo-selftest-scope-negative.test.ts` 在**隔离临时目录**里造出
 *   含令牌的 CI 配置来证明 ⇒ 「空转」与「无效」必须分开说。
 */
export function collectCiHits(root: string): string[] {
  const hits: string[] = [];
  for (const p of CI_PATHS) {
    const full = resolve(root, p);
    if (!existsSync(full)) { continue; }
    if (!statSync(full).isDirectory()) {
      const text = readFileSync(full, 'utf8');
      for (const token of hitsInText(text)) { hits.push(p + ' ⇒ ' + token); }
      continue;
    }
    const files: string[] = [];
    collectFiles(full, files);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const token of hitsInText(text)) {
        hits.push(normalizeRel(relative(root, f)) + ' ⇒ ' + token);
      }
    }
  }
  return hits;
}