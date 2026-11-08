// 负样本集中文件：**所有会修改文件的负样本都在这里**。
//
// ⚠️ **B17 改造（从「就地改共享工作树」改为「隔离副本」）**：
//   原实现就地改仓库里的规格 / state.ts（改 → 跑 → 恢复）。文件头注释说「集中在同一
//   文件内即可互不干扰」—— 但那只解决了**负样本之间**的冲突，**没解决与其它测试文件
//   的冲突**：node:test 跨文件并发跑，而 `discipline.test.ts` 也读同一份规格
//   ⇒ 它会在本文件「破坏窗口」内读到**中间态** ⇒ 门禁瞬时假红。
//   实测：门 ② 红在「规格必须含『门禁覆盖边界』小节」，而**单跑该文件全绿**。
//   ⇒ 现在一律在**隔离副本**里改副本，共享工作树全程只读。
//
// 每个用例都用 try/finally 清理副本（无论断言是否失败）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runNode } from './harness.ts';
import { DOC_SYNC_INCLUDE, makeIsolatedRepo, removeIsolatedRepo } from '../../tools/repo-copy.mjs';

const ROOT = process.cwd();
const SPEC_REL = 'docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md';
const STATE_REL = 'engine/core/state.ts';

/**
 * 在规格文件上做一次「改坏 → 跑门禁 → 还原」的完整负样本。
 *
 * ⚠️ 断言回调必须用**块体**（`{ ... }`）而非表达式体——
 * 表达式体末尾的 `;` 会落在函数实参列表内部，TS 报 TS1005「')' expected」。
 */
function withBrokenSpec(mutate: (spec: string) => string, assertFail: (output: string) => void): void {
  const dir = makeIsolatedRepo(ROOT, DOC_SYNC_INCLUDE);
  try {
    const specPath = resolve(dir, SPEC_REL);
    const original = readFileSync(specPath, 'utf8');
    const broken = mutate(original);
    assert.notEqual(broken, original, '负样本必须真的改动文件，否则证明不了任何东西');
    writeFileSync(specPath, broken, 'utf8');
    const run = runNode([resolve(dir, 'tools', 'doc-sync.mjs')], { cwd: dir });
    assert.notEqual(run.code, 0, 'doc-sync 对口径漂移必须判红');
    assertFail(run.output);
    // 「恢复必绿」：在副本里恢复后仍须判绿（副本可恢复 ⇒ 仓库自然不受影响）
    writeFileSync(specPath, original, 'utf8');
    const restored = runNode([resolve(dir, 'tools', 'doc-sync.mjs')], { cwd: dir });
    assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
  } finally {
    removeIsolatedRepo(dir);
  }
}

// ---------- 负样本：算子清单漂移 ----------
test('负样本：doc-sync 对算子清单漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('`gain_resource`', '`gain_resource_XXX`'),
    (out) => {
      assert.match(out, /C3/, '应报在 C3 算子清单检查上');
    }
  );
});

// ---------- 负样本：规模表数值漂移 ----------
test('负样本：doc-sync 对规模表数值漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('| 5 | 32 | 3 | 6 | 6 | 56 | 12 | 14 | 3 | 2 |', '| 5 | 32 | 3 | 6 | 6 | 56 | 12 | 14 | 9 | 2 |'),
    (out) => {
      assert.match(out, /C2/, '应报在 C2 规模表数值检查上');
    }
  );
});

// ---------- 负样本：字段名契约漂移 ----------
test('负样本：doc-sync 对字段名契约漂移判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('`boardLength`', '`boardLen`'),
    (out) => {
      assert.match(out, /C1/, '应报在 C1 字段名契约检查上');
    }
  );
});

// ---------- 负样本：ops 表重复行 ----------
//
// 这条负样本是**被真实 bug 逼出来的**：v1.4 回改时 `| 判定与装备 |` 行被写了两次，
// 而 C3 用 Set 比较**检测不到**（算子名集合不变）⇒ 补 C7 按行统计。
test('负样本：doc-sync 对 ops 表重复行判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('| 棋盘 | `place_barrier` |', '| 棋盘 | `place_barrier` |\n| 判定与装备 | `modify_judgement` `create_card` `equip_card` |'),
    (out) => {
      assert.match(out, /C7/, '应报在 C7 重复行检查上');
    }
  );
});

// ---------- 负样本：State 契约漂移（方向二：规格多写）----------
//
// C9 是「B1 契约冻结」的机器守卫：口头约定形同虚设，并行开发照样加字段。
test('负样本：doc-sync 对「规格多写代码没有的字段」判红，恢复后判绿', () => {
  withBrokenSpec(
    (s) => s.replace('  scales: ScalesRow;         // 当前局规模配置（§8）', '  scales: ScalesRow;         // 当前局规模配置（§8）\n  ghostField: string;'),
    (out) => {
      assert.match(out, /C9/, '应报在 C9 State 契约检查上');
    }
  );
});

// ---------- 负样本：C9 方向一（代码多字段）----------
test('C9 方向一：代码加了字段但规格未登记 → doc-sync 判红，恢复后判绿', () => {
  const dir = makeIsolatedRepo(ROOT, DOC_SYNC_INCLUDE);
  try {
    const statePath = resolve(dir, STATE_REL);
    const original = readFileSync(statePath, 'utf8');
    const patched = original.replace('  readonly scales: ScalesRow;', '  readonly scales: ScalesRow;\n  brandNewField: string;');
    assert.notEqual(patched, original, '必须真的改到代码，否则证明不了任何东西');
    writeFileSync(statePath, patched, 'utf8');
    const run = runNode([resolve(dir, 'tools', 'doc-sync.mjs')], { cwd: dir });
    assert.notEqual(run.code, 0, '代码加了字段而规格未登记，doc-sync 必须判红');
    assert.match(run.output, /C9/, '应报在 C9 State 契约检查上');
    assert.match(run.output, /brandNewField/, '报错信息应指出未登记的字段名');
    writeFileSync(statePath, original, 'utf8');
    const restored = runNode([resolve(dir, 'tools', 'doc-sync.mjs')], { cwd: dir });
    assert.equal(restored.code, 0, '恢复后 doc-sync 必须判绿');
  } finally {
    removeIsolatedRepo(dir);
  }
});
