// 发布检查的**其余三类失败路径**（B39）：门禁失败 / 重扫失败 / 产物缺失 ⇒ 均须**非零**并**阻断**。
//
// ⚠️ 负样本纪律：假门禁、假模拟器、缺失产物**全部写在隔离临时目录**；
//   仓库侧（基线快照、脚本、配置）**全程只读** ⇒ 不污染并行的门禁。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const RELEASE_CHECK = resolve(ROOT, 'tests', 'gates', 'release-check-selftest.mjs');

/** 在临时目录里造一个「必失败」的脚本。 */
function failingScript(dir: string, name: string, code: number): string {
  const p = join(dir, name);
  writeFileSync(p, 'console.error(\'假脚本：故意失败\');\nprocess.exit(' + String(code) + ');\n', 'utf8');
  return p;
}

test('B39：门禁失败 ⇒ 发布检查非零，且不进入后续步骤', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-gate-fail-'));
  try {
    const fakeGate = failingScript(dir, 'fake-gate.mjs', 3);
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--gate=' + fakeGate, '--skip-rescan', '--scan=docs/trial-reserve-scan.json', '--baseline=' + BASELINE,
    ], { encoding: 'utf8', shell: false, cwd: ROOT });
    assert.notEqual(res.status, 0, '门禁失败必须返回非零');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /发布前检查失败：门禁/, '应指明失败环节');
    assert.doesNotMatch(out, /全量重扫/, '门禁失败后不应进入全量重扫');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B39：重扫失败 ⇒ 发布检查非零，且不进入逐组比对', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-rescan-fail-'));
  try {
    const fakeSim = failingScript(dir, 'fake-sim.mjs', 4);
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--skip-gate', '--sim=' + fakeSim, '--scan=docs/trial-reserve-scan.json', '--baseline=' + BASELINE,
    ], { encoding: 'utf8', shell: false, cwd: ROOT });
    assert.notEqual(res.status, 0, '重扫失败必须返回非零');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /发布前检查失败：全量重扫/, '应指明失败环节');
    assert.doesNotMatch(out, /逐组比对（漂移即失败）/, '重扫失败后不应进入逐组比对');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B39：产物缺失 ⇒ 发布检查非零，且给出明确缺失提示', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-missing-'));
  try {
    const missing = join(dir, 'never-produced.json');
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + missing, '--baseline=' + BASELINE,
    ], { encoding: 'utf8', shell: false, cwd: ROOT });
    assert.notEqual(res.status, 0, '产物缺失必须返回非零');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /扫描产物缺失或不可读/, '应给出明确的缺失提示');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
