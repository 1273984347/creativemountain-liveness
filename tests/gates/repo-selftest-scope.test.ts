// 仓库级回归（B48）：`CM_SELFTEST` / `--selftest` **仅**允许出现在 tests/ 与历史记录中。
//
// ⚠️ 为什么必须**仓库级**而不是逐文件断言：逐个文件的断言只守住「已知位置」；
//   日后新增脚本 / 配置 / CI 步骤时可能再引入 ⇒ 必须有一条**扫描全仓**的回归 ⇒ 新位置一旦出现即红。
//
// ⚠️ 允许区（有意）：
//   · `tests/**` —— 自检能力本就只属于测试侧（B46/B47）；
//   · `docs/**/*.md` —— 规格裁定与批次记录是**历史留痕**（改写历史反而失真）。
//   ⇒ 其余（`tools/` 工具、`engine/`、`build/`、`web/` 源码、`package.json` 的 npm scripts、CI 配置）一律禁止。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const TOKENS = ['CM_SELFTEST', '--selftest'];
/** 跳过目录（依赖 / 产物 / 版本库）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'print', 'coverage', '.tmp', '.vscode', '.idea']);
/** 跳过的大文件（>2MB 多半是二进制/字体）。 */
const MAX_BYTES = 2 * 1024 * 1024;

/** 路径是否在允许区：tests/** 或 docs/ 下的 .md（历史记录）。 */
function allowed(relPath: string): boolean {
  const parts = relPath.split(sep);
  if (parts[0] === 'tests') { return true; }
  if (parts[0] === 'docs') { return relPath.endsWith('.md'); }
  return false;
}

/** 递归收集「不允许位置」里出现令牌的文本文件。 */
function scanForbidden(dir: string, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) { continue; }
      scanForbidden(join(dir, entry.name), hits);
      continue;
    }
    if (!entry.isFile()) { continue; }
    const full = join(dir, entry.name);
    let size = 0;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_BYTES) { continue; }
    let text = '';
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) { continue; }
    const rel = relative(ROOT, full);
    if (allowed(rel)) { continue; }
    for (const token of TOKENS) {
      if (text.includes(token)) { hits.push(rel + ' ⇒ ' + token); }
    }
  }
}

test('B48：CM_SELFTEST / --selftest 只存在于 tests/ 与历史记录（docs/**/*.md）', () => {
  const hits: string[] = [];
  scanForbidden(ROOT, hits);
  assert.deepEqual(hits, [], '以下位置不允许引用自检入口：\n' + hits.join('\n'));
});

test('B48：npm scripts 不得引用自检入口', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const token of TOKENS) {
      assert.ok(!String(cmd).includes(token), 'npm script ' + name + ' 不得含 ' + token);
    }
  }
});

test('B48：CI 配置不得引用自检入口', () => {
  const ciPaths = ['.github', '.gitlab-ci.yml', '.circleci', 'azure-pipelines.yml', 'Jenkinsfile'];
  const hits: string[] = [];
  for (const p of ciPaths) {
    let st = null;
    try { st = statSync(resolve(ROOT, p)); } catch { continue; }
    if (!st.isDirectory()) {
      const text = readFileSync(resolve(ROOT, p), 'utf8');
      for (const token of TOKENS) { if (text.includes(token)) { hits.push(p + ' ⇒ ' + token); } }
      continue;
    }
    const local: string[] = [];
    scanForbidden(resolve(ROOT, p), local);
    for (const h of local) { hits.push(h); }
  }
  assert.deepEqual(hits, [], 'CI 配置不得引用自检入口：\n' + hits.join('\n'));
});
