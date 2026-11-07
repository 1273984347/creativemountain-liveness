// 门禁自检：负样本常驻化（GateKeeper《E1铁律》规则 2 + 绿洲 _gate.py 门⑥）
//
// 核心命题：**「违例必红、恢复必绿」**。
// 每道门禁都必须有对应的负样本用例——故意制造违例 → 断言门禁判红 → 恢复 → 断言判绿。
// 否则门禁交付后没人会再验它，规格 §9.3 里那句「人为制造一处漂移 → 必须判红」
// 就只是一句没人执行的承诺。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runTsc, runNodeTest } from './harness.ts';

/**
 * 类型探针文件（在 tsconfig include 范围内，才能被类型门禁扫到）。
 *
 * ⚠️ **文件名不能以 `_` 开头** —— Node 的 test runner 会**忽略 `_` 前缀的文件**，
 * 用 `__negprobe` 命名会导致探针根本没被跑到，负样本假绿。
 */
const TYPE_PROBE = resolve(process.cwd(), 'engine', 'negprobe.ts');
/** 测试探针文件（同上，禁用 `_` 前缀）。 */
const TEST_PROBE = resolve(process.cwd(), 'tests', 'engine', 'negprobe.test.ts');
/** 只跑 engine 目录，避免自检用例递归触发自身。 */
const ENGINE_GLOB = 'tests/engine/**/*.test.ts';

function cleanup(...paths: readonly string[]): void {
  for (const p of paths) {
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  }
}

// ---------- 负样本 1：类型门禁（tsc --noEmit）----------

test('负样本：类型门禁对类型错误判红，恢复后判绿', { concurrency: false }, () => {
  cleanup(TYPE_PROBE);
  try {
    // 故意注入类型错误：number 位置放了 string
    writeFileSync(TYPE_PROBE, "export const n: number = '这不是数字';\n", 'utf8');

    const broken = runTsc();
    assert.notEqual(broken.code, 0, '注入类型错误后类型门禁必须判红');
    assert.match(broken.output, /TS\d+/, '报错信息应是 TypeScript 诊断码');

    // 恢复
    cleanup(TYPE_PROBE);
    const restored = runTsc();
    assert.equal(restored.code, 0, '移除探针后类型门禁必须判绿');
  } finally {
    cleanup(TYPE_PROBE);
  }
});

// ---------- 负样本 2：测试门禁（node --test）----------

test('负样本：测试门禁对失败用例判红，恢复后判绿', { concurrency: false }, () => {
  cleanup(TEST_PROBE);
  try {
    writeFileSync(
      TEST_PROBE,
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n" +
        "test('故意失败的负样本', () => { assert.equal(1, 2); });\n",
      'utf8'
    );
    const broken = runNodeTest(ENGINE_GLOB);
    assert.notEqual(broken.code, 0, '注入失败用例后测试门禁必须判红');

    // ⚠️ 恢复后的断言用**自包含的临时用例目录**，不依赖全局 engine 绿灯——
    // 否则并行开发中的中间态失败会让本负样本假红（门禁自证不该依赖被检对象的状态）。
    cleanup(TEST_PROBE);
    const isolated = resolve(process.cwd(), 'tests', 'gates', '__isolated');
    mkdirSync(isolated, { recursive: true });
    try {
      const isolatedGlob = 'tests/gates/__isolated/**/*.test.ts';
      const restored = runNodeTest(isolatedGlob);
      assert.equal(restored.code, 0, '移除失败用例后测试门禁必须判绿');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  } finally {
    cleanup(TEST_PROBE);
  }
});
