// 发布检查的**两条补充失败路径**（B44）：基线 groups 为空数组 / 自检绕过开关被拒绝。
//
// ⚠️ B24 起自检开关（`--skip-gate` / `--skip-rescan`）**仅在 `CM_SELFTEST=1` 时可用**；
//   否则发布检查**直接拒绝执行**（而不是静默继续）⇒ 误用/漏配环境变量 ⇒ 立刻失败。
//
// ⚠️ 负样本纪律：坏基线写在**隔离临时目录**；仓库侧全程只读。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tools', 'release-check.mjs');

test('B44：基线 groups 为空数组 ⇒ 发布检查非零，并明确说「没有任何分组」', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-base-empty-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    data.groups = [];
    const bad = join(dir, 'empty-baseline.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=docs/trial-reserve-scan.json', '--baseline=' + bad,
    ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
    assert.notEqual(res.status, 0, '空基线必须返回非零');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /基线快照结构字段异常：groups 为空数组/, '应明确指出基线没有任何分组');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B44：未设 CM_SELFTEST 时，自检绕过开关被拒绝（不静默继续）', () => {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=docs/trial-reserve-scan.json', '--baseline=' + BASELINE,
  ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '0' } });
  assert.notEqual(res.status, 0, '绕过开关必须被拒绝');
  const out = (res.stdout ?? '') + (res.stderr ?? '');
  assert.match(out, /CM_SELFTEST=1/, '应说明绕过开关的启用条件');
  assert.doesNotMatch(out, /已跳过（自检模式/, '不得静默跳过检查');
});
