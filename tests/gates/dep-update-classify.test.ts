// Dependabot 自动合并的**版本跨度分类守卫**（B90）。
//
// 起因（B89 收尾时实测到的真缺陷）：工作流原先只用「标题含 deps-major」判 major，
//   而 Dependabot 对**未分组的 major 更新**根本不会写 deps-major —— 实测 4 个 major PR
//   的标题分别是 "bump typescript from 5.9.3 to 7.0.2"、"bump @types/node from 22.20.5 to
//   26.6.6"、"bump actions/setup-node from 4.4.0 to 7.1.0"、"bump actions/checkout from
//   4.4.0 to 7.0.1" ⇒ major 会被当成 patch/minor 自动合并（实测两个 auto-merge run 已进入
//   「等 CI 全绿」轮询，CI 一绿就会合并 major）。
//
// 这条守卫**直接执行工作流里那段分类代码**（从 .github/workflows/dependabot-auto-merge.yml
// 的 DEP-CLASSIFY 标记块抽出）⇒ 测的是**被测实现本身**，不是另写一份近似实现
//   （避免 E94「同一口径两份实现必然漂移」）。
//
// 同时守住配置侧：.github/dependabot.yml 的**每个**更新目录都必须把 major 单独分组成
//   deps-major ⇒ Dependabot 自己给 major PR 打上标记，工作流的规则 a 才能生效。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const WF = resolve(ROOT, '.github', 'workflows', 'dependabot-auto-merge.yml');
const DEP = resolve(ROOT, '.github', 'dependabot.yml');

/** 从工作流里抽出分类用的那段 JS（**唯一事实源 = 工作流文件本身**）。 */
function extractClassifier(): string {
  const src = readFileSync(WF, 'utf8');
  // ⚠️ B95 踩坑后加固：原来靠「**第一个** `node -e `」的位置约定抽取 ⇒ 只要工作流里
  //   **前面**再插入任何 node 块（本批的作者/仓库判据块就在 ⓪ 段），抽取就会越过块边界、
  //   连 yml 注释一起喂给 node ⇒ SyntaxError（B90 守卫被 B95 打断，门 ② 判红）。
  //   ⇒ 改为**显式标记锚定**（DEP-CLASSIFY-BEGIN）：块边界由标记决定，与插入顺序无关。
  const m = src.match(/DEP-CLASSIFY-BEGIN[\s\S]*?node -e '\r?\n([\s\S]*?)\r?\n\s*'\s+"\$TITLE"/);
  if (m === null || m[1] === undefined) {
    assert.fail('未能从工作流里抽出 DEP-CLASSIFY 代码块（标记或结构被改了？）');
  }
  return m[1];
}

const CLASSIFIER = extractClassifier();

/** 跑工作流里那段分类代码，返回 major / safe / unknown。 */
function classify(title: string): string {
  const out = execFileSync(process.execPath, ['-e', CLASSIFIER, title], { encoding: 'utf8' });
  return out.trim();
}

/** 真实出现过的 Dependabot PR 标题 → 期望分类。 */
const CASES: ReadonlyArray<readonly [string, string]> = [
  // —— 实测 4 个会被误判的 major（全部必须判 major）——
  ['build(deps-dev): bump typescript from 5.9.3 to 7.0.2', 'major'],
  ['build(deps-dev): bump @types/node from 22.20.5 to 26.6.6', 'major'],
  ['build(deps): bump actions/setup-node from 4.4.0 to 7.1.0', 'major'],
  ['build(deps): bump actions/checkout from 4.4.0 to 7.0.1', 'major'],
  // —— 非 major（必须判 safe ⇒ 才允许自动合并）——
  ['build(deps-dev): bump esbuild from 0.24.2 to 0.28.1', 'safe'],
  ['build(deps-dev): bump vite from 8.3.0 to 8.4.1', 'safe'],
  // —— 分组 PR：解析不出 from/to ⇒ unknown ⇒ 保守人工审 ——
  ['build(deps): bump the host-npm-patch group in /creativemountain-host with 5 updates', 'unknown'],
  // —— 配置补齐后，major 分组 PR 自带 deps-major 标记 ⇒ major ——
  ['build(deps): bump the deps-major group with 3 updates', 'major'],
  // —— 边界：v 前缀 ——
  ['build(deps): bump actions/checkout from v4.4.0 to v7.0.1', 'major'],
  ['build(deps): bump actions/checkout from v4.4.0 to v4.5.0', 'safe']
];


test('抽取块不得混入工作流的注释行（锚点缺失 ⇒ 块边界会被后续插入挤掉）', () => {
  assert.ok(!CLASSIFIER.includes('#'), '抽出的代码里含注释行 ⇒ 抽取正则越过了块边界');
});

test('版本跨度分类：真实 PR 标题逐条判定（含 4 个曾被误判的 major）', () => {
  for (const [title, expected] of CASES) {
    assert.equal(classify(title), expected, '标题分类错：' + title);
  }
});

test('major 绝不会被判成 safe（回归锁：这是 B90 要堵的那个洞）', () => {
  const majors = CASES.filter(([, e]) => e === 'major').map(([t]) => t);
  assert.ok(majors.length >= 5, '样本里的 major 太少，守卫失去意义');
  for (const t of majors) {
    assert.notEqual(classify(t), 'safe', 'major 被判成 safe：' + t);
  }
});

test('工作流对 unknown（分组 PR）也走「保持人工审」分支', () => {
  const src = readFileSync(WF, 'utf8');
  assert.match(src, /unknown\)\s*\n\s*echo "[^"]*人工审/);
});

test('dependabot.yml 的每个更新目录都把 major 单独分组成 deps-major', () => {
  const src = readFileSync(DEP, 'utf8');
  const blocks = src.split(/^ {2}- package-ecosystem:/m).slice(1);
  assert.equal(blocks.length, 3, '更新目录数变了（根 npm / host npm / github-actions）');
  for (const b of blocks) {
    assert.match(
      b,
      /groups:\n(?: {6}\S[\s\S]*?\n)*? {6}deps-major:\n {8}applies-to: version-updates\n {8}update-types:\n {10}- major\n/,
      '某个更新目录没有把 major 单独分组：' + b.slice(0, 60)
    );
  }
});

test('deps-major 不得落进 ignore 块（配置侧的结构错位守卫）', () => {
  const src = readFileSync(DEP, 'utf8');
  const blocks = src.split(/^ {2}- package-ecosystem:/m).slice(1);
  for (const b of blocks) {
    const ignoreAt = b.indexOf('\n    ignore:');
    const majorAt = b.indexOf('deps-major:');
    assert.ok(majorAt >= 0, '缺 deps-major：' + b.slice(0, 60));
    if (ignoreAt >= 0) {
      assert.ok(majorAt < ignoreAt, 'deps-major 落在 ignore 块之后（结构错位）：' + b.slice(0, 80));
    }
  }
});
