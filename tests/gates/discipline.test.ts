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
import {
  COVERAGE_BOUNDARIES,
  checkSpecCoverageTableStructure,
  parseSpecCoverageRows,
} from '../../tools/coverage-boundaries.mjs';

/** 门禁脚本清单（A4 的检查对象）。 */
const GATE_SCRIPTS = [
  'tools/gate.mjs',
  'tools/doc-sync.mjs',
  'tools/pdf-normalize.mjs',
  // ⚠️ B94：门 ⑮ 的执行器也是**门禁脚本**（它决定门 ⑮ 判红判绿）⇒ 须受 A4 约束，
  //   否则将来有人给它加 `shell: true` 或接管道，**没有任何门会报**。
  'tools/balance-report-lock-cli.mjs',
];

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

test('A5：规格覆盖边界表与机器清单逐条对应（doc-sync C8 的同源口径）', () => {
  
  const spec = readFileSync(
    resolve('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md'),
    'utf8'
  );
  // 复用与 C8 **同一个解析实现**（B52：同一口径只能有一处实现，E92）
  // ⇒ 此前本文件自写了一套表格解析，两处实现必然漂移。
  const structure = checkSpecCoverageTableStructure(spec);
  assert.ok(structure.ok, `规格覆盖边界表结构必须合规：${structure.detail}`);
  const parsed = parseSpecCoverageRows(spec);
  assert.ok(parsed.found, '规格必须含「门禁覆盖边界」小节');
  const codeIds = COVERAGE_BOUNDARIES.map((b) => b.id);
  assert.equal(parsed.ids.length, codeIds.length, '规格表与机器清单条数必须一致');
  // 逐条对应：第 i 行的 id 必须等于第 i 条机器清单的 id
  assert.deepEqual(
    parsed.ids,
    codeIds,
    '规格表 id 必须与机器清单**同序一一对应**（B52：逐条对应，不只比条数）',
  );
});
