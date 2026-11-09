// 负样本（B51）：证明仓库级扫描器的三类检查**不是空转**。
//
// ⚠️ 为什么必须有它（B51 的起因）：
//   · CI 检查：仓库当前**没有**任何 CI 配置 ⇒ 那条断言在真实仓库上恒为空集
//     ⇒ 它可能**永远绿**（断言写错了也没人知道）—— 与「闸门必须有过失败路径证据」同型。
//   · 例外文件：`print/规则书叙述.md` 此前从未被扫描 ⇒ 令牌能藏在那里（B50 的「print/ 无跟踪文件」结论不准确）。
//   · 大小写变体：区分大小写时 `cm_selftest` / `--SELFTEST` 会漏检。
// ⇒ 三类都必须在**隔离临时目录**里造出违例 ⇒ 断言扫描器**确实会红**。
//
// ⚠️ 纪律：负样本的篡改对象一律写在**隔离临时目录**，仓库侧全程只读
//   （否则会污染并行的门禁② —— 见 `docs/沉淀/负样本自证范式.md`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { collectCiHits, scanTree } from './repo-scan.ts';

/** 在隔离临时目录里造一棵目录树，跑断言，最后清理（仓库侧只读）。 */
function withTempTree(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'cm-scan-neg-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 造一个文件（含父目录）。 */
function put(dir: string, rel: string, text: string): void {
  const full = resolve(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, 'utf8');
}

test('B51 负样本 A：普通源文件含令牌 ⇒ 扫描器必须命中（证明扫描不是空转）', () => {
  withTempTree((dir) => {
    put(dir, 'tools/demo.mjs', 'const env = process.env.CM_SELFTEST;\n');
    const { hits } = scanTree(dir);
    assert.equal(hits.length, 1, '必须命中一次：\n' + hits.join('\n'));
    assert.ok(hits[0]?.includes('tools/demo.mjs'), '命中须点名文件：' + hits[0]);
  });
});

test('B51 负样本 B：允许区内含令牌 ⇒ 不命中（tests/ 与 docs/批次/ 免检）', () => {
  withTempTree((dir) => {
    put(dir, 'tests/gates/demo.test.ts', 'const x = "CM_SELFTEST";\n');
    put(dir, 'docs/批次/B99-demo.md', '提到 CM_SELFTEST 与 --selftest\n');
    const { hits } = scanTree(dir);
    assert.deepEqual([...hits], [], '允许区不得命中：\n' + hits.join('\n'));
  });
});

test('B51 负样本 C：活文档含令牌 ⇒ 必须命中（允许区不得放宽到整个 docs/）', () => {
  withTempTree((dir) => {
    put(dir, 'docs/superpowers/specs/demo.md', 'const x = "--selftest";\n');
    const { hits } = scanTree(dir);
    assert.equal(hits.length, 1, '活文档必须命中：\n' + hits.join('\n'));
  });
});

test('B51 负样本 D：大小写变体 ⇒ 必须命中（区分大小写会漏检）', () => {
  withTempTree((dir) => {
    put(dir, 'tools/lower.mjs', 'process.env.cm_selftest\n');
    put(dir, 'tools/upper.mjs', 'node x --SELFTEST\n');
    const { hits } = scanTree(dir);
    assert.equal(hits.length, 2, '两个变体都必须命中：\n' + hits.join('\n'));
  });
});

test('B51 负样本 E：例外文件（跳过目录内的已入库源文件）含令牌 ⇒ 必须命中', () => {
  withTempTree((dir) => {
    put(dir, 'print/规则书叙述.md', '提到 CM_SELFTEST\n');
    const { hits } = scanTree(dir);
    assert.equal(hits.length, 1, '例外文件必须被扫描：\n' + hits.join('\n'));
    assert.ok(hits[0]?.includes('print/'), '命中须点名例外文件：' + hits[0]);
  });
});

test('B51 负样本 F：跳过目录内的非例外文件含令牌 ⇒ 不命中（证明确实跳过 ⇒ 例外登记是必需的）', () => {
  withTempTree((dir) => {
    put(dir, 'print/生成物.md', '提到 CM_SELFTEST\n');
    const { hits } = scanTree(dir);
    assert.deepEqual([...hits], [], '跳过目录内的非例外文件不应被扫描');
  });
});

test('B51 负样本 G：CI 配置含令牌 ⇒ CI 检查必须命中（证明它不是空断言）', () => {
  withTempTree((dir) => {
    put(dir, '.github/workflows/ci.yml', 'run: node x --selftest\n');
    const hits = collectCiHits(dir);
    assert.equal(hits.length, 1, 'CI 检查必须命中：\n' + hits.join('\n'));
  });
});

test('B51 负样本 I：文件名含令牌 ⇒ 必须命中（文件名级引用同样能指向绕过入口）', () => {
  withTempTree((dir) => {
    put(dir, 'tools/release-check--selftest.mjs', 'export const ok = 1;\n');
    const { hits } = scanTree(dir);
    assert.equal(hits.length, 1, '文件名命中必须被抓到：\n' + hits.join('\n'));
    assert.ok(hits[0]?.includes('文件名'), '命中须标明来自文件名：' + hits[0]);
  });
});

test('B51 负样本 J：允许区内**文件名**含令牌 ⇒ 不命中（允许区对文件名同样生效）', () => {
  withTempTree((dir) => {
    put(dir, 'tests/gates/demo--selftest.test.ts', 'export const ok = 1;\n');
    const { hits } = scanTree(dir);
    assert.deepEqual([...hits], [], '允许区的文件名不得命中：\n' + hits.join('\n'));
  });
});

test('B51 负样本 K：例外文件的**文件名**含令牌 ⇒ 必须命中（例外分支与普通分支规则一致）', () => {
  withTempTree((dir) => {
    put(dir, 'print/CM_SELFTEST_例外.ts', 'export const ok = 1;\n');
    const { hits } = scanTree(dir, { exceptions: ['print/CM_SELFTEST_例外.ts'] });
    assert.equal(hits.length, 1, '例外文件的文件名命中必须被抓到：\n' + hits.join('\n'));
    assert.ok(hits[0]?.includes('文件名'), '命中须标明来自文件名：' + hits[0]);
  });
});

test('B51 负样本 H：CI 配置不含令牌 ⇒ 不命中（正样本对照：证明上一条不是「见谁命中」）', () => {
  withTempTree((dir) => {
    put(dir, '.github/workflows/ci.yml', 'run: npm run gate\n');
    assert.deepEqual(collectCiHits(dir), [], '干净的 CI 配置不得命中');
  });
});
