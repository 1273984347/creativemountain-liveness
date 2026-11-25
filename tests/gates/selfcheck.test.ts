// 门禁自检：负样本常驻化（GateKeeper《E1铁律》规则 2 + 绿洲 _gate.py 门⑥）
//
// 核心命题：**「违例必红、恢复必绿」**。
// 每道门禁都必须有对应的负样本用例——故意制造违例 → 断言门禁判红 → 恢复 → 断言判绿。
// 否则门禁交付后没人会再验它，规格 §9.3 里那句「人为制造一处漂移 → 必须判红」
// 就只是一句没人执行的承诺。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runTscIn, runNodeTest } from './harness.ts';

/**
 * 测试探针文件 —— 放在工程根的 `.probe/` 下，**不在 `tests/` 内**。
 *
 * ⚠️ 为什么不在 `tests/` 内：门禁②的 glob 会扫到 `tests/` 下所有 `*.test.ts` 文件 ⇒
 *   探针若落在 `tests/` 下，**并行跑的另一个 test runner 会扫到它**
 *   ⇒ 那个「故意失败」的探针会让别人的门禁瞬时假红。
 *   （实测：本批的独立盲审与门禁并发时撞上过一次全量测试假红。）
 *   ⇒ 探针与隔离目录都移到 `.probe/` ⇒ glob 扫不到 ⇒ 并行安全。
 */
const PROBE_DIR = resolve(process.cwd(), '.probe');
const TEST_PROBE = resolve(PROBE_DIR, 'negprobe.ts');
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
  // ⚠️ **自包含**：本负样本用**独立的临时目录 + 独立 tsconfig**，
  // 绝不使用工程主 tsconfig、也不在工程目录里放探针文件。
  // 理由：`{ concurrency: false }` 只保证**同文件内**串行，
  // 其他测试文件仍会并发执行——若本负样本在工程目录里留探针，
  // 并发跑的 tsc 会扫到它 ⇒ 「恢复后判绿」断言假红。
  // ⚠️ **隔离目录必须在工作树之外**（B86 修）：原实现落在 `tests/gates/__isolated_tsc`，
  //   而 `tests/` 在 tsc 的 include 范围里 ⇒ 任何**并发**跑 tsc 的进程（另一会话的 CI、
  //   并行门禁）都会扫到这份**故意写错的探针** ⇒ 门 ① 假红（本批实测撞到过一次）。
  //   本文件头的注释本就写着「绝不使用工程主 tsconfig、也不在工程目录里放探针文件」
  //   ⇒ 这次是把**实现拉回注释的意图**，不是新增约定。
  const tmpRoot = mkdtempSync(resolve(tmpdir(), 'cm-tsc-'));
  const isolated = resolve(tmpRoot, 'isolated');
  const srcDir = resolve(isolated, 'src');
  mkdirSync(srcDir, { recursive: true });
  try {
    // 独立 tsconfig：只扫自己的 src，不牵扯工程
    writeFileSync(
      resolve(isolated, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      }),
      'utf8',
    );
    const probe = resolve(srcDir, 'probe.ts');
    const benign = resolve(srcDir, 'benign.ts');

    // 故意注入类型错误：number 位置放了 string
    writeFileSync(probe, "export const n: number = '这不是数字';\n", 'utf8');
    const broken = runTscIn(resolve(isolated, 'tsconfig.json'));
    assert.notEqual(broken.code, 0, '注入类型错误后类型门禁必须判红');
    assert.match(broken.output, /TS\d+/, '报错信息应是 TypeScript 诊断码');

    // 恢复：移除探针，但**保留一个合法源文件**——
    // 否则 tsconfig 的 include 会匹配不到任何输入，tsc 报 TS18003
    // 「No inputs were found」，退出码同样是 2 ⇒ 「恢复后判绿」假红。
    rmSync(probe, { force: true });
    writeFileSync(benign, "export const ok: number = 1;\n", 'utf8');
    const restored = runTscIn(resolve(isolated, 'tsconfig.json'));
    assert.equal(restored.code, 0, '移除探针后类型门禁必须判绿');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- 负样本 2：测试门禁（node --test）----------

test('负样本：测试门禁对失败用例判红，恢复后判绿', { concurrency: false }, () => {
  cleanup(TEST_PROBE);
  try {
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(
      TEST_PROBE,
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n" +
        "test('故意失败的负样本', () => { assert.equal(1, 2); });\n",
      'utf8'
    );
    // ⚠️ 探针**显式点名**（它不在任何 glob 覆盖范围内）⇒ 既有 engine 用例 + 探针一起跑。
    const broken = runNodeTest([ENGINE_GLOB, TEST_PROBE]);
    assert.notEqual(broken.code, 0, '注入失败用例后测试门禁必须判红');

    // ⚠️ 恢复后的断言用**自包含的临时用例目录**，不依赖全局 engine 绿灯——
    // 否则并行开发中的中间态失败会让本负样本假红（门禁自证不该依赖被检对象的状态）。
    cleanup(TEST_PROBE);
    const isolated = resolve(PROBE_DIR, 'isolated');
    mkdirSync(isolated, { recursive: true });
    try {
      const isolatedGlob = '.probe/isolated/**/*.test.ts';
      const restored = runNodeTest(isolatedGlob);
      assert.equal(restored.code, 0, '移除失败用例后测试门禁必须判绿');
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  } finally {
    cleanup(TEST_PROBE);
    // 探针目录整体清掉 ⇒ 测试后不留空目录（已在 .gitignore 登记，双保险）。
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }
});
