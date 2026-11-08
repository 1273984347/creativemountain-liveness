// 仓库级回归（B48 引入 / B51 重构）：自检入口标识**只**允许出现在 tests/ 与历史记录目录。
//
// ⚠️ 为什么必须**仓库级**而不是逐文件断言：逐个文件的断言只守住「已知位置」；
//   日后新增脚本 / 配置 / CI 步骤时可能再引入 ⇒ 必须有一条**扫描全仓**的回归 ⇒ 新位置一旦出现即红。
//
// ⚠️ 允许区（有意）：
//   · `tests/**` —— 自检能力本就只属于测试侧（B46/B47）；
//   · `docs/批次/**` —— **历史记录目录**（B49 收紧：规格 / 沉淀索引 / README 等**活文档**不在允许区）。
//   ⇒ 其余（`tools/` 工具、`engine/`、`build/`、`web/` 源码、`package.json` 的 npm scripts、CI 配置）一律禁止。
//
// ⚠️ B51：扫描逻辑已抽到 `./repo-scan.ts`（**单一事实源**）⇒ 正负样本共用同一套实现；
//   本文件只负责**断言**，不再自带一份实现（自带实现 ⇒ 负样本测的是它自己，不是被测代码）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { trackedFiles } from '../../tools/repo-copy.mjs';
import {
  ALLOWED_ROOTS, CI_PATHS, MAX_BYTES, SCAN_EXCEPTIONS, SKIP_DIRS,
  allowed, collectCiHits, hitsInText, scanTree,
} from './repo-scan.ts';

const ROOT = process.cwd();

/**
 * 是否有 git 元数据。
 *
 * ⚠️ 隔离副本（`tools/repo-copy.mjs`）复制的是**工作树快照**，**不含 .git**
 *   ⇒ 「哪些文件已入库」无法判定 ⇒ 依赖该判定的守卫在副本里**显式跳过**
 *   （node:test 的 skip 状态**可见** ⇒ 不是「静默通过」）。
 */
const HAS_GIT = existsSync(resolve(ROOT, '.git'));

test('B48/B51：自检入口标识只存在于 tests/ 与历史记录目录（docs/批次/）', () => {
  const { hits } = scanTree(ROOT);
  assert.deepEqual([...hits], [], '以下位置不允许引用自检入口：\n' + hits.join('\n'));
});

test('B51：npm scripts 不得引用自检入口（大小写不敏感）', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
    const hit = hitsInText(String(cmd));
    assert.deepEqual(hit, [], `npm script ${name} 不得含 ${hit.join(' / ')}`);
  }
});

test('B51：CI 配置不得引用自检入口（大小写不敏感）', () => {
  const hits = collectCiHits(ROOT);
  assert.deepEqual(hits, [], 'CI 配置不得引用自检入口：\n' + hits.join('\n'));
});

test('B51：允许区语义钉住（tests/ 与 docs/批次/ 允许，活文档与生产代码禁止）', () => {
  assert.equal(allowed('tests/engine/x.test.ts'), true);
  assert.equal(allowed('docs/批次/B50-x.md'), true);
  assert.equal(allowed('docs/superpowers/specs/x.md'), false);
  assert.equal(allowed('docs/沉淀/经验教训索引.md'), false);
  assert.equal(allowed('tools/release-check.mjs'), false);
  assert.equal(allowed('package.json'), false);
  // 允许区必须精确到目录前缀，不允许退化成「整个 docs」
  assert.deepEqual(ALLOWED_ROOTS.map((r) => r.join('/')), ['tests', 'docs/批次']);
});

test('B51：扫描盲区守卫 —— 跳过目录内的已入库文件必须登记为例外（否则它从未被扫描）', (t) => {
  if (!HAS_GIT) {
    t.skip('无 git 元数据（隔离副本）⇒ 无法判定「已入库」集合 ⇒ 本守卫不执行（跳过状态可见，非静默通过）');
    return;
  }
  // ⚠️ 跳过规则在**任意深度**都生效（扫描器遇到任意层级的跳过目录名就跳过）
  //   ⇒ 守卫必须按**每一段**判定，只看顶层会漏掉嵌套位置（如 docs/批次/x/print/…）。
  const inSkip = trackedFiles(ROOT)
    .filter((rel) => rel.split('/').some((seg) => SKIP_DIRS.has(seg)))
    .sort();
  assert.deepEqual(
    inSkip,
    [...SCAN_EXCEPTIONS].sort(),
    '跳过目录内出现未登记的已入库文件 ⇒ 它不会被扫描 ⇒ 必须登记进 SCAN_EXCEPTIONS（或改结构）',
  );
});

test('B51：例外文件确实进入了扫描覆盖（登记不是空话）', () => {
  const { scanned } = scanTree(ROOT);
  for (const rel of SCAN_EXCEPTIONS) {
    assert.ok(scanned.includes(rel), `例外文件必须真的被扫描：${rel}`);
  }
});

test('B51：扫描盲区守卫 —— 无已入库文件超过体积上限（否则令牌可藏进超大文件）', (t) => {
  if (!HAS_GIT) {
    t.skip('无 git 元数据（隔离副本）⇒ 无法判定「已入库」集合 ⇒ 本守卫不执行（跳过状态可见，非静默通过）');
    return;
  }
  const big: string[] = [];
  for (const rel of trackedFiles(ROOT)) {
    let size = 0;
    try { size = statSync(resolve(ROOT, rel)).size; } catch { continue; }
    if (size > MAX_BYTES) { big.push(rel); }
  }
  assert.deepEqual(big, [], '以下已入库文件超过体积上限而未被扫描：\n' + big.join('\n'));
});

test('B51：CI 路径清单非空（清单为空 ⇒ 「CI 检查」根本不存在）', () => {
  assert.ok(CI_PATHS.length > 0, 'CI 路径清单不得为空');
});
