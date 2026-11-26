// Dependabot 自动合并**路径守卫**（B95）。
//
// 起因（PR #9 挂起 26 小时逼出来的两个真缺陷）：
//   D1「等 CI 全绿」**从未生效**：原判据查 check-runs，而 CI workflow 的 check-run 还没创建时
//     pending=0 ⇒ 直接判绿。实测 run 45667433870 日志：17:41:45 就打印「CI 全绿」，
//     而 gate chain 17:46:43 才完成 ⇒ CI 红了也会照发合并指令。
//   D2 合并指令是发 `@dependabot merge` 评论，发评论的是 GITHUB_TOKEN（github-actions[bot]），
//     它没有仓库写权限 ⇒ Dependabot 侧不受理：PR #9 的 auto_merge 字段始终为 null。
//
// 这条守卫**直接执行工作流里那段 CI 判据代码**（从 .github/workflows/dependabot-auto-merge.yml
// 的 DEP-CI-GREEN 标记块抽出）⇒ 测的是**被测实现本身**，不是另写一份近似实现
// （避免 E94「同一口径两份实现必然漂移」）。
//
// 同时守住合并路径本身：必须走 `gh pr merge --auto`（GitHub 服务端执行 ⇒ 合并会触发 CI），
// 不得退回发评论；且必须带 contents: write、并校验 PR 作者是 dependabot[bot]（手动触发也校验）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const WF = resolve(ROOT, '.github', 'workflows', 'dependabot-auto-merge.yml');

function wfSrc(): string {
  return readFileSync(WF, 'utf8');
}

/**
 * 只取**可执行行**（去掉整行注释）⇒ 注释里出现的命令字样**不能**冒充真实命令。
 * 起因（B95 自证时踩到）：原先用全文正则断言 `gh pr merge --auto`，
 *   而文件头注释里恰好也写了这句话 ⇒ 把执行行改成 `gh pr merge --squash` 注入时守卫**没红**
 *   （守卫生了鉴别力缺口，等于没守）。
 */
function codeLines(): string[] {
  return wfSrc()
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l));
}

/** 从工作流里抽出 CI 判据用的那段 JS（**唯一事实源 = 工作流文件本身**）。 */
function extractCiJudge(): string {
  const src = wfSrc();
  const m = src.match(/DEP-CI-GREEN-BEGIN[\s\S]*?node -e '\r?\n([\s\S]*?)\r?\n\s*'\s+"\$SHA"\s+"\$RUNS_JSON"[\s\S]*?DEP-CI-GREEN-END/);
  if (m === null || m[1] === undefined) {
    assert.fail('未能从工作流里抽出 DEP-CI-GREEN 代码块（标记或结构被改了？）');
  }
  return m[1];
}

const JUDGE = extractCiJudge();

/** 跑工作流里那段 CI 判据代码，返回 wait / fail / green。 */
function judge(headSha: string, runs: unknown): string {
  const out = execFileSync(process.execPath, ['-e', JUDGE, headSha, JSON.stringify(runs)], { encoding: 'utf8' });
  return out.trim();
}

const SHA = 'a'.repeat(40);

function run(
  name: string,
  status: string,
  conclusion: string,
  headSha: string = SHA
): { name: string; status: string; conclusion: string; head_sha: string } {
  return { name: name, status: status, conclusion: conclusion, head_sha: headSha };
}

test('CI 判据：该 head 上没有任何 run（CI 还没启动）⇒ wait，绝不能判绿', () => {
  assert.equal(judge(SHA, []), 'wait', '空 run 列表被判成绿 ⇒ D1 复发');
});

test('CI 判据：有 run 但没跑完 ⇒ wait', () => {
  assert.equal(judge(SHA, [run('CI', 'in_progress', '')]), 'wait');
  assert.equal(judge(SHA, [run('CI', 'queued', '')]), 'wait');
});

test('CI 判据：有 run 失败 ⇒ fail（⇒ 不合并）', () => {
  assert.equal(judge(SHA, [run('CI', 'completed', 'failure')]), 'fail');
  assert.equal(judge(SHA, [run('CI', 'completed', 'cancelled')]), 'fail');
});

test('CI 判据：CI 与 commitlint 全绿 ⇒ green', () => {
  assert.equal(
    judge(SHA, [run('CI', 'completed', 'success'), run('commitlint', 'completed', 'success')]),
    'green'
  );
});

test('CI 判据：只有别的 workflow 全绿、没有 CI 工作流 ⇒ wait（不许拿旁证当 CI）', () => {
  assert.equal(judge(SHA, [run('commitlint', 'completed', 'success')]), 'wait');
});

test('CI 判据：run 不属于该 head ⇒ wait（不许拿别的提交的绿灯充数）', () => {
  assert.equal(judge(SHA, [run('CI', 'completed', 'success', 'b'.repeat(40))]), 'wait');
});

test('合并路径：必须走 gh pr merge --auto（服务端执行 ⇒ 合并会触发 CI）', () => {
  const code = codeLines().join('\n');
  assert.match(code, /gh pr merge --auto --squash "\$PR_URL"/, '可执行行里没有 gh pr merge --auto --squash');
  assert.doesNotMatch(code, /gh pr merge(?!.*--auto)/, '存在不带 --auto 的 gh pr merge 调用（合并不会触发 CI）');
});

test('合并路径：不得退回「发 @dependabot merge 评论」（GITHUB_TOKEN 无写权限 ⇒ 不受理）', () => {
  assert.ok(
    !codeLines().some((l) => l.includes('@dependabot merge')),
    '可执行行里仍在发 @dependabot merge 评论'
  );
});

test('权限：必须给 contents: write（否则 auto-merge 设不上）', () => {
  assert.match(codeLines().join('\n'), /permissions:\s*\n\s*pull-requests: write\s*\n\s*contents: write/);
});

test('安全：手动触发也必须校验 PR 作者是 dependabot[bot]（contents: write ⇒ 防 fork 提权）', () => {
  assert.match(codeLines().join('\n'), /if \[ "\$AUTHOR" != "dependabot\[bot\]" \]/);
});

test('CI 判据：必须排除本工作流自己的 run（否则永远判 wait）', () => {
  assert.match(codeLines().join('\n'), /select\(\.path != "\.github\/workflows\/dependabot-auto-merge\.yml"\)/);
});

test('工作流纪律：不得用 | head 截断管道（SIGPIPE + pipefail ⇒ 脚本误退出变红）', () => {
  assert.ok(!codeLines().some((l) => /\|\s*head\b/.test(l)), '管道里出现 | head：pipefail 下会因 SIGPIPE 让脚本误退出');
});

test('工作流纪律：不得出现 shell: true', () => {
  assert.doesNotMatch(wfSrc(), /shell:\s*true/);
});

test('负样本（D1 的鉴别力）：旧判据会把「CI 未启动」判成绿，新判据必须判 wait', () => {
  // 旧判据的等价实现（check-runs 口径）：没查到 run ⇒ pending=0 ⇒ 判绿。
  const legacy = [
    'const runs = JSON.parse(process.argv[1] || "[]");',
    'const pending = runs.filter(r => r.status !== "completed").length;',
    'const bad = runs.filter(r => r.status === "completed" && r.conclusion !== "success").length;',
    'console.log(bad > 0 ? "fail" : (pending === 0 ? "green" : "wait"));'
  ].join('\n');
  const out = execFileSync(process.execPath, ['-e', legacy, '[]'], { encoding: 'utf8' }).trim();
  assert.equal(out, 'green', '旧判据的行为变了 ⇒ 负样本失去意义');
  assert.equal(judge(SHA, []), 'wait', '新判据必须与旧判据在空列表上判出不同结果');
});
