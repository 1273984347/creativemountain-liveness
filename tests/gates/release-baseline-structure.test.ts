// 发布检查的**结构字段缺失**失败路径（B42）：`groups` / `seedBase` 等**结构字段**缺失。
//
// ⚠️ 背景：结构字段缺失时，旧的分组键会拼成 `reserve@undefined` ⇒ 只表现为「缺少该组」
//   ⇒ 仍会红，但**报错不精准**（看不出是结构坏了还是数据漂移）。本批加一层结构校验并钉住。
//
// ⚠️ 负样本纪律：坏基线 / 坏产物写在**隔离临时目录**；仓库侧全程只读。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tests', 'gates', 'release-check-selftest.mjs');

function check(baselinePath: string, scanPath: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + scanPath, '--baseline=' + baselinePath,
  ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

test('B42：基线缺 groups（结构字段）⇒ 发布检查非零，并点名结构字段缺失', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-struct-groups-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups;
    const bad = join(dir, 'no-groups.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad, resolve(ROOT, 'docs', 'trial-reserve-scan.json'));
    assert.notEqual(r.status, 0, '基线缺 groups 必须返回非零');
    assert.match(r.out, /结构字段缺失或类型错误：groups/, '应明确指出 groups 缺失');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B42：基线某组缺 seedBase ⇒ 发布检查非零，并点名结构字段缺失', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-struct-seedbase-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups[0].seedBase;
    const bad = join(dir, 'no-seedbase.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad, resolve(ROOT, 'docs', 'trial-reserve-scan.json'));
    assert.notEqual(r.status, 0, '基线缺 seedBase 必须返回非零');
    assert.match(r.out, /结构字段缺失或非数值/, '应明确指出结构字段缺失');
    assert.match(r.out, /seedBase/, '应点名具体字段');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B42：产物缺 seedBase ⇒ 发布检查非零（结构层同样拦住）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-struct-scan-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups[2].seedBase;
    const bad = join(dir, 'no-seedbase-scan.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(BASELINE, bad);
    assert.notEqual(r.status, 0, '产物缺 seedBase 必须返回非零');
    assert.match(r.out, /扫描产物结构字段缺失或非数值/, '应指明是扫描产物坏了');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
