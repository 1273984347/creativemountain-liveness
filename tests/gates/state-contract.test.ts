// C9 方向一的负样本：代码加字段、规格未登记 → 必须判红
//
// 与 doc-sync.test.ts 的方向二（规格多写字段）互补，两个方向都要有证据。
//
// ⚠️ 本用例会**临时修改 engine/core/state.ts**，因此必须用 try/finally 保证恢复——
// 否则一次失败就会把工作区留在破损状态。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runNode } from './harness.ts';

const STATE = resolve('engine/core/state.ts');
const DOC_SYNC = resolve('tools', 'doc-sync.mjs');

test('C9 方向一：代码加了字段但规格未登记 → doc-sync 判红，恢复后判绿', () => {
  const original = readFileSync(STATE, 'utf8');
  const anchor = '  readonly scales: ScalesRow;';
  const patched = original.replace(anchor, `${anchor}\n  brandNewField: string;`);
  assert.notEqual(patched, original, '必须真的改到代码，否则证明不了任何东西');
  writeFileSync(STATE, patched, 'utf8');
  try {
    const run = runNode([DOC_SYNC]);
    assert.notEqual(run.code, 0, '代码加了字段而规格未登记，doc-sync 必须判红');
    assert.match(run.output, /C9/, '应报在 C9 State 契约检查上');
    assert.match(run.output, /brandNewField/, '报错信息应指出未登记的字段名');
  } finally {
    writeFileSync(STATE, original, 'utf8');
  }
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});
