// 「**自检能力仅存在于 tests/**」的回归证据（B47）。
//
// ⚠️ 背景：B46 已把 `--selftest` / `--skip-*` 从生产脚本移除 ⇒ `CM_SELFTEST` 的识别也随之失去意义
//   ⇒ 本批把生产侧残留一并清干净，并补断言证明「生产认不出任何自检入口、tests/ 侧自检仍可用」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tools', 'release-check.mjs');
const SELFTEST_WRAPPER = resolve(ROOT, 'tests', 'gates', 'release-check-selftest.mjs');

test('B47：生产脚本源码不含 CM_SELFTEST / SELFTEST 识别（自检能力仅在 tests/）', () => {
  const src = readFileSync(RELEASE_CHECK, 'utf8');
  assert.ok(!src.includes('CM_SELFTEST'), '生产脚本不得再识别 CM_SELFTEST');
  assert.ok(!src.includes('SELFTEST'), '生产脚本不得残留任何 SELFTEST 识别');
});

test('B47：拒绝与任何环境变量无关（env=1 / env=0 / 不设 都拒绝）', () => {
  for (const extra of [{ CM_SELFTEST: '1' }, { CM_SELFTEST: '0' }, {}]) {
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--skip-gate', '--scan=docs/baselines/trial-reserve-scan-B77.json',
    ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, ...extra } });
    assert.notEqual(res.status, 0, '任何环境变量下都必须拒绝绕过');
    assert.match((res.stdout ?? '') + (res.stderr ?? ''), /不支持这些参数/, '应明确拒绝不支持的参数');
  }
});

test('B47：tests/ 侧自检能力仍在（包装器能完成自检编排 ⇒ 比对层一致则通过）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-selftest-alive-'));
  try {
    const copy = join(dir, 'baseline-copy.json');
    writeFileSync(copy, readFileSync(BASELINE, 'utf8'), 'utf8');
    const res = spawnSync(process.execPath, [
      SELFTEST_WRAPPER, '--scan=' + copy, '--baseline=' + BASELINE,
    ], { encoding: 'utf8', shell: false, cwd: ROOT });
    assert.equal(res.status, 0, 'tests/ 包装器应能完成自检编排（未被误删）');
    assert.match((res.stdout ?? '') + (res.stderr ?? ''), /逐组一致/, '应给出逐组比对结论');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
