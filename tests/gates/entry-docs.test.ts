// 开源文档**入口文件守卫**（B91）。
//
// 起因：仓内 `docs/沉淀/README.md` 早就写着「`AGENTS.md` / `HANDOVER` —— 规则正文与交接指针」，
//   而 **`AGENTS.md` 实际并不存在** ⇒ 那条指针指向空处，纪律散落在各处却**没有单一入口**，
//   而且**这种缺口不会报错**（文档里的引用不会因目标缺失而变红）。
//
// 这条守卫把「指针不许空转」变成机械判据：
//   ① 三个入口文件必须真实存在，且各含**必需小节**（防止变成空壳）；
//   ② `CLAUDE.md` 必须**指向** AGENTS.md，且**不得复制**纪律正文（否则又是第二事实源）；
//   ③ `docs/沉淀/README.md` 里出现的**仓根文件引用**必须逐条真实存在（指针不许空转）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const AGENTS = resolve(ROOT, 'AGENTS.md');
const CLAUDE = resolve(ROOT, 'CLAUDE.md');
const ROADMAP = resolve(ROOT, 'ROADMAP.md');
const SED_README = resolve(ROOT, 'docs', '沉淀', 'README.md');

/** 入口文件必须含的小节（缺一节 ⇒ 指针会指向不完整的内容）。 */
const REQUIRED_SECTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['AGENTS.md', ['## 3. 不可协商的纪律', '## 5. 外部可见动作的授权边界', '## 6. 改了什么 ⇒ 同步哪处']],
  ['CLAUDE.md', ['AGENTS.md']],
  ['ROADMAP.md', ['## 已发布', '## 在途', '## 未决遗留']]
];

test('三个入口文件真实存在', () => {
  for (const f of [AGENTS, CLAUDE, ROADMAP]) {
    assert.ok(existsSync(f), '入口文件缺失：' + f);
  }
});

test('入口文件含必需小节（不是空壳）', () => {
  for (const [name, sections] of REQUIRED_SECTIONS) {
    const src = readFileSync(resolve(ROOT, name), 'utf8');
    for (const s of sections) {
      assert.ok(src.includes(s), name + ' 缺少必需内容：' + s);
    }
  }
});

test('CLAUDE.md 只做指针，不复制纪律正文（避免第二事实源）', () => {
  const src = readFileSync(CLAUDE, 'utf8');
  assert.ok(src.includes('AGENTS.md'), 'CLAUDE.md 必须指向 AGENTS.md');
  assert.ok(
    !src.includes('不可协商的纪律'),
    'CLAUDE.md 复制了纪律正文 ⇒ 出现第二事实源（细则只放 AGENTS.md）'
  );
});

test('沉淀 README 里指向的仓根文件逐条真实存在（指针不许空转）', () => {
  const src = readFileSync(SED_README, 'utf8');
  // 只看形如 `- \`X.md\` / \`X.md\` ——` 的**仓根文件**引用（排除 docs/ 与 ../ 开头的仓内相对路径）
  const refs = [...src.matchAll(/`([A-Za-z0-9._-]+\.md)`/g)].map((m) => m[1]).filter((x): x is string => x !== undefined);
  const rootRefs = [...new Set(refs)].filter((n) => !n.includes('/'));
  assert.ok(rootRefs.length > 0, '沉淀 README 里没解析到任何仓根文件引用（判据自身失效？）');
  for (const n of rootRefs) {
    assert.ok(existsSync(resolve(ROOT, n)), '沉淀 README 指向的仓根文件不存在：' + n);
  }
});

test('README（中英）都登记了三个入口文件', () => {
  for (const f of ['README.md', 'README.en.md']) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    for (const n of ['AGENTS.md', 'CLAUDE.md', 'ROADMAP.md']) {
      assert.ok(src.includes(n), f + ' 未登记 ' + n);
    }
  }
});
