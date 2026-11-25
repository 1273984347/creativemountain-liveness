// 发布检查的**基线快照失败路径**（B40）：基线缺失 / 基线损坏 / 基线与产物不匹配。
//
// ⚠️ 负样本纪律：坏基线写在**隔离临时目录**里；仓库侧（真基线快照、脚本）**全程只读**。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tests', 'gates', 'release-check-selftest.mjs');

/** 跑一次发布检查（跳过门禁与重扫 ⇒ 只走比对这一步）。
 *  ⚠️ B74：`scanPath` 可注入 —— 「组数不匹配」用例必须用**自造且数值一致**的扫描产物，
 *    不能依赖仓库里按需生成的 `docs/trial-reserve-scan.json`（它的数值随引擎行为变化）。
 *  ⚠️ B87：默认值改为**入库基线**（`BASELINE`）—— 原默认值指向那份 **gitignore 的生成物**，
 *    ⇒ 干净副本（刻意不带生成物）里会停在「扫描产物缺失」，到不了本用例要验的层次 ⇒ 门 ② 假红。
 */
function check(baselinePath: string, scanPath = BASELINE): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + scanPath, '--baseline=' + baselinePath,
  ], { encoding: 'utf8', shell: false, cwd: ROOT });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

test('B40：基线快照缺失 ⇒ 发布检查非零，且明确指出是基线快照', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-base-missing-'));
  try {
    const r = check(join(dir, 'no-such-baseline.json'));
    assert.notEqual(r.status, 0, '基线缺失必须返回非零');
    assert.match(r.out, /基线快照缺失或不可读/, '应明确指出基线快照缺失');
    assert.match(r.out, /发布前检查失败/, '应指明失败环节');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B40：基线快照损坏（非法 JSON）⇒ 发布检查非零，且明确指出是基线快照', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-base-broken-'));
  try {
    const bad = join(dir, 'broken-baseline.json');
    writeFileSync(bad, '{ this is not json', 'utf8');
    const r = check(bad);
    assert.notEqual(r.status, 0, '基线损坏必须返回非零');
    assert.match(r.out, /基线快照不是合法 JSON/, '应明确指出基线快照损坏');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B40：基线与产物组数不匹配 ⇒ 发布检查非零，并点名多余/缺失的组', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-base-mismatch-'));
  try {
    const full = JSON.parse(readFileSync(BASELINE, 'utf8'));
    // 扫描产物 = 基线原值（数值一致）⇒ 比对的唯一差异是「扫描多出 3 组」。
    const scan = join(dir, 'scan.json');
    writeFileSync(scan, JSON.stringify(full, null, 2), 'utf8');
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    data.groups = data.groups.slice(0, data.groups.length - 3);
    const trimmed = join(dir, 'trimmed-baseline.json');
    writeFileSync(trimmed, JSON.stringify(data, null, 2), 'utf8');
    const r = check(trimmed, scan);
    assert.notEqual(r.status, 0, '组数不匹配必须返回非零');
    assert.match(r.out, /逐组一致/, '应给出逐组比对结论');
    assert.match(r.out, /新扫描多出该组/, '应点名多出的组');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
