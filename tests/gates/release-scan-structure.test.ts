// 发布检查的**扫描产物侧结构字段缺失**失败路径（B43）：缺 groups / 缺 reserve / groups 为空。
//
// ⚠️ B42 已覆盖基线侧与「产物缺 seedBase」⇒ 本批补齐**产物侧其余形态**。
// ⚠️ 负样本纪律：坏产物写在**隔离临时目录**；仓库侧全程只读。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tools', 'release-check.mjs');

function check(scanPath: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + scanPath, '--baseline=' + BASELINE,
  ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

test('B43：扫描产物缺 groups ⇒ 发布检查非零，并点名是扫描产物缺 groups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-scan-nogroups-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups;
    const bad = join(dir, 'no-groups-scan.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad);
    assert.notEqual(r.status, 0, '产物缺 groups 必须返回非零');
    assert.match(r.out, /扫描产物结构字段缺失或类型错误：groups/, '应明确指出产物缺 groups');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B43：扫描产物某组缺 reserve ⇒ 发布检查非零，并点名 reserve', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-scan-noreserve-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups[0].reserve;
    const bad = join(dir, 'no-reserve-scan.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad);
    assert.notEqual(r.status, 0, '产物缺 reserve 必须返回非零');
    assert.match(r.out, /groups\[0\]\.reserve/, '应点名具体结构字段');
    assert.match(r.out, /reserve/, '应点名具体字段');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B43：扫描产物 groups 为空数组 ⇒ 发布检查非零，并明确说「没有任何分组」', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-scan-empty-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    data.groups = [];
    const bad = join(dir, 'empty-scan.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad);
    assert.notEqual(r.status, 0, '空分组必须返回非零');
    assert.match(r.out, /groups 为空数组（没有任何分组）/, '应明确指出产物没有任何分组');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
