// P5 无服务降级的**常驻**负样本（B59 · Task 17）。
//
// 判据（P5）：输出首词 `SKIP` 且**退出码 = 0** ⇒ 无 sidecar 时安静跳过，不是失败。
//
// ⚠️ **不依赖模型、不依赖权重**（用 `LAYA_PROXY_PORT=1` ⇒ 必定连不上）
//   ⇒ 可以进门 ②（`node --test tests/**/*.test.ts`）而不违反「门禁不依赖 sidecar」。
// ⚠️ 全部产物写**系统临时目录** ⇒ 共享工作树零写入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SKIP = resolve(ROOT, 'tools/laya-probe/skip.mjs');

/** 跑一次 skip.mjs（不经 shell ⇒ 退出码可信）。 */
function runSkip(port: number): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SKIP], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, LAYA_PROXY_PORT: String(port) },
    });
    return { code: 0, out };
  } catch (e) {
  // ⚠️ strict 下 catch 参数是 `unknown` ⇒ 须显式断言形状（否则 tsc 报 TS2339）。
  const err = e as { status?: number; stdout?: string };
  return { code: typeof err.status === 'number' ? err.status : -1, out: String(err.stdout ?? '') };
  }
}

/** 解析 `SKIP {…}` 的 JSON 部分。 */
function parseSkip(out: string): { reason: string; records: number; error?: string; status?: number } {
  const line = out.split(/\r?\n/).find((l) => l.startsWith('SKIP '));
  assert.ok(line !== undefined, `输出首词必须是 SKIP，实际输出：${JSON.stringify(out.slice(0, 200))}`);
  const parsed = JSON.parse(line.slice('SKIP '.length)) as {
    reason?: unknown; records?: unknown; error?: unknown; status?: unknown;
  };
  return parsed as { reason: string; records: number; error?: string; status?: number };
}

test('P5：无 sidecar ⇒ 首词 SKIP、退出码 0、reason 是字符串、records 是整数', () => {
  // ⚠️ 端口 1 ⇒ 必定连不上 ⇒ 走「no-sidecar」分支（不依赖模型/权重/服务）。
  const r = runSkip(1);
  assert.equal(r.code, 0, `无 sidecar **不是失败** ⇒ 退出码必须为 0，实际 ${String(r.code)}`);
  const parsed = parseSkip(r.out);
  assert.equal(typeof parsed.reason, 'string', 'reason 必须是字符串');
  assert.equal(typeof parsed.records, 'number', 'records 必须是整数');
  assert.ok(Number.isInteger(parsed.records), 'records 必须是整数');
  assert.equal(parsed.reason, 'no-sidecar', '连不上时 reason 必须是 no-sidecar');
  if (parsed.error !== undefined) {
    assert.ok(parsed.error.length <= 120, `error 文本必须 ≤120 字符，实际 ${String(parsed.error.length)}`);
  }
});

test('P5：输出**恰好一行**（多行会让消费方解析歧义）', () => {
  const r = runSkip(1);
  const lines = r.out.split(/\r?\n/).filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, `应只输出一行，实际 ${String(lines.length)} 行`);
});

test('P5：三种形状的**字段集**固定（消费方按字段判读）', () => {
  const parsed = parseSkip(runSkip(1).out);
  // no-sidecar 形状：{reason, error, records}
  assert.deepEqual(Object.keys(parsed).sort(), ['error', 'reason', 'records'], 'no-sidecar 形状的字段集必须固定');
});
