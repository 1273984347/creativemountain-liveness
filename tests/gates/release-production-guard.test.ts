// 「**生产发布检查无法绕过门禁**」的负样本（B45）。
//
// ⚠️ 断言三层：① 生产的 `npm run release:check` **不带** `--selftest`（结构上无法绕过）；
//   ② 即便外部设了 `CM_SELFTEST=1`，生产脚本也会**拒绝**跳过（不静默继续）；
//   ③ 即便传了 `--selftest`，没有 `CM_SELFTEST=1` 也拒绝 ⇒ **双条件**缺一不可。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const RELEASE_CHECK = resolve(ROOT, 'tools', 'release-check.mjs');
const SELFTEST_WRAPPER = resolve(ROOT, 'tests', 'gates', 'release-check-selftest.mjs');

test('B45：生产的 release:check 不带 --selftest ⇒ 结构上无法绕过门禁', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const check = String(pkg.scripts['release:check'] ?? '');
  assert.ok(!check.includes('--selftest'), '生产 release:check 不得带 --selftest：' + check);
  assert.ok(!String(pkg.scripts.release ?? '').includes('--selftest'), '生产 release 不得带 --selftest');
  assert.match(String(pkg.scripts.release ?? ''), /^npm run release:check &&/, 'release 必须先跑发布前检查');
});

test('B46：生产脚本已彻底移除自检/跳过参数 ⇒ 传入即拒绝（非零）', () => {
  for (const flag of ['--selftest', '--skip-gate', '--skip-rescan']) {
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, flag, '--scan=docs/baselines/trial-reserve-scan-B77.json',
    ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
    assert.notEqual(res.status, 0, flag + ' 必须被拒绝（生产不得有绕过入口）');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /不支持这些参数/, '应明确拒绝不支持的参数');
  }
});

test('B46：生产脚本把 --selftest / --skip-* 列入**拒绝清单**（不再是有效参数）', () => {
  const src = readFileSync(RELEASE_CHECK, 'utf8');
  assert.ok(!src.includes('--selftest'), '生产脚本不得再出现自检参数名（B48 起改为白名单式拒绝）');
  assert.ok(!src.includes('--selftest') && !src.includes('--skip-'), '生产脚本不得再出现自检/跳过参数名（B48 起白名单式拒绝）');
  assert.ok(!src.includes('--selftest') && !src.includes('--skip-'), '生产脚本不得再出现自检/跳过参数名（B48 起白名单式拒绝）');
  assert.match(src, /不支持这些参数/, '应明确拒绝不支持的参数');
  const wrapper = readFileSync(SELFTEST_WRAPPER, 'utf8');
  assert.match(wrapper, /compare-scan-baseline/, '自检编排落在 tests/ 包装器里');
});
