// A4/A5 门禁纪律的负样本
//
// A4（GateKeeper《管道会吞退出码》）：门禁脚本**不得经 shell 管道**，
//   否则退出码会变成管道最后一个命令的，门禁静默失效。
// A5（绿洲《门禁覆盖边界（如实登记）》）：覆盖边界必须机器可读且与规格一致。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runNode } from './harness.ts';
import { COVERAGE_BOUNDARIES } from '../../tools/coverage-boundaries.mjs';

/** 门禁脚本清单（A4 的检查对象）。 */
const GATE_SCRIPTS = ['tools/gate.mjs', 'tools/doc-sync.mjs', 'tools/pdf-normalize.mjs'];

/** 读一份源码，剥掉注释与字符串（避免注释里的示例被误判）。 */
function codeOnly(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

// ---------- A4：门禁不经 shell 管道 ----------

test('A4：门禁脚本不得使用 shell:true（否则退出码不可信）', () => {
  for (const f of GATE_SCRIPTS) {
    const code = codeOnly(f);
    assert.ok(
      !/shell\s*:\s*true/.test(code),
      `${f} 不得使用 shell:true——shell 会改变退出码语义`
    );
  }
});

test('A4：门禁脚本不得把命令接进管道（管道会吞退出码）', () => {
  for (const f of GATE_SCRIPTS) {
    const code = codeOnly(f);
    // 形如 `cmd | head` / `cmd 2>&1 | tee` / `cmd | Select-Object`
    assert.ok(
      !/\|\s*(head|tail|tee|more|less|Select-Object|Where-Object)\b/.test(code),
      `${f} 不得把命令接进管道——管道会让退出码变成最后一个命令的`
    );
  }
});

test('A4：门禁退出码直取（spawnSync 的 status 就是被检查的结果）', () => {
  // 用一个必然失败的命令验证 exit code 直取
  const failing = runNode(['-e', 'process.exit(3)']);
  assert.equal(failing.code, 3, '子进程退出码必须原样传出');
  const ok = runNode(['-e', 'process.exit(0)']);
  assert.equal(ok.code, 0);
});

// ---------- A5：覆盖边界机器可读且与规格一致 ----------

test('A5：覆盖边界清单非空，且每条都有「不覆盖什么」与「为什么」', () => {
  
  assert.ok(COVERAGE_BOUNDARIES.length > 0, '覆盖边界清单不得为空');
  for (const b of COVERAGE_BOUNDARIES) {
    assert.ok(b.id.length > 0, '边界必须有稳定 id');
    assert.ok(b.notCovered.length > 0, `边界 ${b.id} 必须写明「不覆盖什么」`);
    assert.ok(b.reason.length > 0, `边界 ${b.id} 必须写明「为什么」`);
  }
});

test('A5：边界 id 唯一（重复 id 会让核对失去意义）', async () => {
  
  const ids = COVERAGE_BOUNDARIES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, '边界 id 必须唯一');
});

test('A5：规格覆盖边界表与机器清单条数一致（doc-sync C8 的负样本同源）', () => {
  
  const spec = readFileSync(
    resolve('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md'),
    'utf8'
  );
  const idx = spec.indexOf('门禁覆盖边界');
  assert.ok(idx >= 0, '规格必须含「门禁覆盖边界」小节');
  // 只取该小节内的表格行：遇到第一个空行即止（其后的表格属于别的章节）
  const sec = spec.slice(idx);
  const rows = [];
  for (const line of sec.split(/\r?\n/)) {
    if (rows.length > 0 && line.trim() === '') {
      break; // 表格结束
    }
    if (!line.trim().startsWith('|')) {
      continue;
    }
    if (line.trim().startsWith('|---') || line.includes('| 覆盖 | 不覆盖 |')) {
      continue; // 表头与分隔行
    }
    rows.push(line);
  }
  assert.equal(rows.length, COVERAGE_BOUNDARIES.length, '规格表与机器清单条数必须一致');
});
