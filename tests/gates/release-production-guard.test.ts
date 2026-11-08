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

test('B45：即便设了 CM_SELFTEST=1，生产脚本也拒绝跳过（无 --selftest）', () => {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=docs/trial-reserve-scan.json',
  ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
  assert.notEqual(res.status, 0, '生产脚本必须拒绝绕过');
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  assert.match(out, /自检模式需同时满足/, '应说明双条件要求');
  assert.doesNotMatch(out, /已跳过（自检模式/, '不得静默跳过');
});

test('B45：即便传了 --selftest，没有 CM_SELFTEST=1 也拒绝', () => {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--selftest', '--skip-gate', '--skip-rescan', '--scan=docs/trial-reserve-scan.json',
  ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '0' } });
  assert.notEqual(res.status, 0, '缺少环境变量必须拒绝');
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  assert.match(out, /自检模式需同时满足/, '应说明双条件要求');
});

test('B45：绕过入口集中在 tests/ 专用包装器（生产脚本无自检入口）', () => {
  const src = readFileSync(RELEASE_CHECK, 'utf8');
  assert.ok(!/selftestMode\s*=\s*true/.test(src), '生产脚本不得内置无条件自检模式');
  assert.ok(src.includes('--selftest'), '生产脚本须识别 --selftest 标记（与 CM_SELFTEST 组成双条件）');
  const wrapper = readFileSync(SELFTEST_WRAPPER, 'utf8');
  assert.match(wrapper, /CM_SELFTEST: '1'/, '包装器负责设置自检环境变量');
  assert.match(wrapper, /'--selftest'/, '包装器负责传入自检标记');
});
