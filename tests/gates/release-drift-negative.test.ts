// 发布检查的**漂移失败路径**（B38）—— 负样本：逐组不一致时必须**返回非零**并**阻断构建**。
//
// ⚠️ 负样本纪律：**不在共享工作树里改任何仓库文件** ⇒ 篡改产物写在**隔离临时目录**里，
//   仓库侧只读（基线快照与脚本都不动）⇒ 不会污染并行的门禁。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'trial-reserve-scan-B34.json');
const COMPARE = resolve(ROOT, 'docs', '沉淀', 'compare-scan-baseline.mjs');
const RELEASE_CHECK = resolve(ROOT, 'tools', 'release-check.mjs');

/** 造一份**篡改过**的扫描产物：改动某一组的某个指标 ⇒ 逐组比对必然不一致。 */
function tamperedScan(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cm-drift-'));
  const data = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const first = data.groups[0];
  assert.ok(first !== undefined, '基线快照应有分组');
  first.fallback = first.fallback + 0.5;
  const path = join(dir, 'tampered-scan.json');
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  return { path, dir };
}

test('B38：逐组比对在数据漂移时返回非零（漂移即失败）', () => {
  const t = tamperedScan();
  try {
    const res = spawnSync(process.execPath, [COMPARE, '--scan=' + t.path, '--baseline=' + BASELINE],
      { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
    assert.notEqual(res.status, 0, '漂移时必须返回非零');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /FAIL/, '输出应说明失败');
    assert.match(out, /逐组一致/, '输出应给出逐组比对结论');
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('B38：发布检查在漂移时返回非零（且不进入构建）', () => {
  const t = tamperedScan();
  try {
    const res = spawnSync(process.execPath, [
      RELEASE_CHECK, '--skip-gate', '--skip-rescan', '--scan=' + t.path, '--baseline=' + BASELINE,
    ], { encoding: 'utf8', shell: false, cwd: ROOT, env: { ...process.env, CM_SELFTEST: '1' } });
    assert.notEqual(res.status, 0, '发布检查必须返回非零（阻断发布）');
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(out, /发布前检查失败/, '应指明失败环节');
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('B38：release 脚本以 release:check 起头且用 && 串联 ⇒ 检查非零即阻断构建', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const rel = String(pkg.scripts.release ?? '');
  assert.ok(rel.startsWith('npm run release:check &&'), 'release 必须先跑发布前检查：' + rel);
  assert.match(rel, /&& npm run build/, '检查与构建之间必须是 &&（短路）');
});
