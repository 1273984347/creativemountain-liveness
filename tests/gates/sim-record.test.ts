// sim 决策点记录器的常驻测试（B56 · Task 14）。
//
// 第一不变量：**报告文件逐字不变** —— 记录器是纯旁路，开了它也不能改变任何对局行为。
//   ⚠️ 判据是**文件 diff 为空**，不是 stdout 计数行（stdout 本来就不含逐局细节）。
//
// 第二不变量：**默认关闭** ⇒ 不带 `--record-decisions` 时**不产出**任何 JSONL。
//
// ⚠️ 这些用例会真跑 sim（2 局 × 1 主题 ⇒ 秒级）⇒ 门 ② 可接受。
// ⚠️ 全部产物写**系统临时目录** ⇒ 共享工作树零写入。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SIM = resolve(ROOT, 'tests/sim/run.mjs');

/** 跑一次 sim（不经 shell ⇒ 退出码与输出都可信）。 */
function runSim(args: readonly string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SIM, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    // ⚠️ strict 下 catch 参数是 `unknown` ⇒ 需显式断言形状（否则 tsc 报 TS2339）。
    const err = e as { status?: number; stdout?: string };
    return { code: typeof err.status === 'number' ? err.status : -1, out: String(err.stdout ?? '') };
  }
}

test('sim 决策点记录器：默认关闭 ⇒ 不产出 JSONL，且报告照常生成', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const report = resolve(dir, 'on.md');
    const r = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--out', report]);
    assert.equal(r.code, 0, 'sim 必须成功退出');
    assert.ok(existsSync(report), '报告文件必须生成');
    assert.equal(existsSync(resolve(dir, 'on.jsonl')), false, '不带开关时不得产出 JSONL');
    assert.ok(readFileSync(report, 'utf8').length > 0, '报告不得为空');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sim 决策点记录器：**报告逐字不变**（开了开关也不改变对局行为）', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const on = resolve(dir, 'on.md');
    const rec = resolve(dir, 'on-rec.md');
    const jsonl = resolve(dir, 'on.jsonl');
    const a = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--out', on]);
    assert.equal(a.code, 0, '不带开关的 sim 必须成功退出');
    const b = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--record-decisions', jsonl, '--out', rec]);
    assert.equal(b.code, 0, '带开关的 sim 必须成功退出');
    const textOn = readFileSync(on, 'utf8');
    const textRec = readFileSync(rec, 'utf8');
    assert.equal(textRec, textOn, '⚠️ 报告必须**逐字一致** —— 记录器是纯旁路，不得改变任何对局行为');
    assert.ok(existsSync(jsonl), '带开关时必须产出 JSONL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sim 决策点记录器：JSONL 行字段恰为 11 个、seq 从 0 开始（seq == 行号）、themeId 正确', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const jsonl = resolve(dir, 'on.jsonl');
    const out = resolve(dir, 'on.md');
    const r = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--record-decisions', jsonl, '--out', out]);
    assert.equal(r.code, 0, 'sim 必须成功退出');
    const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.trim() !== '');
    assert.ok(lines.length > 10, `决策点条数应 > 10，实际 ${String(lines.length)}`);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.deepEqual(
      Object.keys(parsed[0] ?? {}),
      ['seq', 'themeId', 'players', 'seed', 'round', 'turnIndex', 'seat', 'phase', 'face', 'heuristic', 'state'],
      '字段必须恰为这 11 个且顺序固定');
    assert.equal(parsed[1]?.seq, 1, '第二行的 seq 必须是 1（seq 从 0 开始 ⇒ seq == 行号）');
    assert.equal(parsed[0]?.themeId, 'xianxia2026', 'themeId 必须正确');
    assert.equal(parsed[0]?.players, 4, 'players 必须正确');
    assert.equal(typeof parsed[0]?.state, 'string', 'state 必须是 stateToJson 的文本');
    assert.equal(typeof parsed[0]?.heuristic, 'string', 'heuristic 必须是动作 key 字符串');
    // ⚠️ `parsed` 的值类型是 `unknown` ⇒ 直接 `?? ''` 后仍是 `{}` ⇒ 须先 `String(...)`（TS2339）。
    const firstHeuristic = String(parsed[0]?.heuristic ?? '');
    assert.ok(firstHeuristic.length > 0, 'heuristic 不得为空');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
