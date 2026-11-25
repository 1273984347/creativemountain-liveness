// 发布检查的**字段缺失（半损坏）**失败路径（B41）。
//
// ⚠️ 背景：比对脚本原实现用 `Math.abs(a - b) > 1e-9` ⇒ 字段缺失时算出 **NaN**，
//   而 `NaN > 1e-9` 为 **false** ⇒ 半损坏（JSON 合法但少字段）会**静默通过**。
//   本批先把该漏洞修掉（显式判「字段缺失或非数值」），再用负样本钉住。
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

/** 跑一次发布检查（跳过门禁与重扫 ⇒ 只走比对这一步）。 */
function check(baselinePath: string, scanPath: string): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [
    RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + scanPath, '--baseline=' + baselinePath,
  ], { encoding: 'utf8', shell: false, cwd: ROOT });
  return { status: res.status, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

test('B41：基线缺字段 ⇒ 发布检查非零，并点名「字段缺失或非数值」（不再静默通过）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-field-missing-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups[0].fallback;
    const bad = join(dir, 'missing-field-baseline.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(bad, BASELINE);
    assert.notEqual(r.status, 0, '基线缺字段必须返回非零');
    assert.match(r.out, /字段缺失或非数值/, '应明确点名字段缺失');
    assert.match(r.out, /发布前检查失败/, '应指明失败环节');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B41：产物缺字段 ⇒ 发布检查非零，并点名「字段缺失或非数值」', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-field-missing-scan-'));
  try {
    const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
    delete data.groups[1].seats;
    const bad = join(dir, 'missing-field-scan.json');
    writeFileSync(bad, JSON.stringify(data, null, 2), 'utf8');
    const r = check(BASELINE, bad);
    assert.notEqual(r.status, 0, '产物缺字段必须返回非零');
    assert.match(r.out, /字段缺失或非数值/, '应明确点名字段缺失');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
