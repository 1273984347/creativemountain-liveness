// doc-sync 门禁的负样本（GateKeeper《E1铁律》规则 2：违例必红、恢复必绿）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runNode } from './harness.ts';

const SPEC = resolve('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md');
const DOC_SYNC = resolve('tools', 'doc-sync.mjs');

/**
 * 在规格文件上做一次「改坏 → 跑门禁 → 还原」的完整负样本。
 *
 * ⚠️ 断言回调必须用**块体**（`{ ... }`）而非表达式体——
 * 表达式体末尾的 `;` 会落在函数实参列表内部，TS 报 TS1005「')' expected」。
 */
function withBrokenSpec(
  mutate: (spec: string) => string,
  assertFail: (output: string) => void
): void {
  const original = readFileSync(SPEC, 'utf8');
  const broken = mutate(original);
  assert.notEqual(broken, original, '负样本必须真的改动文件，否则证明不了任何东西');
  writeFileSync(SPEC, broken, 'utf8');
  try {
    const run = runNode([DOC_SYNC]);
    assert.notEqual(run.code, 0, 'doc-sync 对口径漂移必须判红');
    assertFail(run.output);
  } finally {
    writeFileSync(SPEC, original, 'utf8');
  }
}

// ---------- 负样本 3：算子名漂移 ----------

test('负样本：doc-sync 对算子清单漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('`gain_resource`', '`gain_resource_XXX`'),
    (out) => {
      assert.match(out, /C3/, '应报在 C3 算子清单检查上');
    }
  );
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});

// ---------- 负样本 4：规模表数值漂移 ----------

test('负样本：doc-sync 对规模表数值漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('| 5 | 32 | 3 | 6 | 6 | 56 | 12 | 14 | 3 | 2 |', '| 5 | 32 | 3 | 6 | 6 | 56 | 12 | 14 | 9 | 2 |'),
    (out) => {
      assert.match(out, /C2/, '应报在 C2 规模表数值检查上');
    }
  );
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});

// ---------- 负样本 7：State 契约漂移（双向）----------
//
// C9 是「B1 契约冻结」的机器守卫：口头约定形同虚设，并行开发照样加字段。
// 两个方向都要能判红：
//   ① 代码有字段、规格没登记 → 改 state.ts（见 state-contract.test.ts 的配套用例）
//   ② 规格写了字段、代码没有 → 改规格（本条）

test('负样本：doc-sync 对「规格多写代码没有的字段」判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('  scales: ScalesRow;         // 当前局规模配置（§8）', '  scales: ScalesRow;         // 当前局规模配置（§8）\n  ghostField: string;'),
    (out) => {
      assert.match(out, /C9/, '应报在 C9 State 契约检查上');
    }
  );
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});

// ---------- 负样本 6：ops 表重复行 ----------
//
// 这条负样本是**被真实 bug 逼出来的**：v1.4 回改时 `| 判定与装备 |` 行被写了两次，
// 而 C3 用 Set 比较**检测不到**（算子名集合不变）⇒ 补 C7 按行统计。

test('负样本：doc-sync 对 ops 表重复行判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) =>
      s.replace(
        '| 棋盘 | `place_barrier` |',
        '| 棋盘 | `place_barrier` |\n| 判定与装备 | `modify_judgement` `create_card` `equip_card` |'
      ),
    (out) => {
      assert.match(out, /C7/, '应报在 C7 重复行检查上');
    }
  );
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});

// ---------- 负样本 5：字段名契约漂移 ----------

test('负样本：doc-sync 对字段名契约漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('`boardLength`', '`boardLen`'),
    (out) => {
      assert.match(out, /C1/, '应报在 C1 字段名契约检查上');
    }
  );
  const restored = runNode([DOC_SYNC]);
  assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
});
