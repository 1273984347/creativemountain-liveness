// B92 · **FacePolicy 接线守卫**（sim CLI 的 `--policy-module`）。
//
// 起因（B74 遗留的前置条件）：`tests/sim/policy.mjs` 的 `playOne` 早就有第 5 参 `FacePolicy`，
//   且「注入失败必回落」有常驻测试；但**生产 sim 从来没有接线**（`run.mjs` 只传 4 参）
//   ⇒ B74 判定的「certify 面值得接入」一直悬着。
//
// 本守卫钉住 B1（接线能力）的三条性质：
//   ① **默认关闭**：不带 `--policy-module` 时无任何注入痕迹 ⇒ 行为与接线前一致；
//   ② **失败必回落**：策略返回 null / 抛错 ⇒ 对局**行为与不注入时逐字节相同**（且计数递增）；
//   ③ **接线不是空转**：策略真的改变决策 ⇒ 行为与不注入时**不同**。
//
// ⚠️ 比对时剔除「策略注入」两行统计 ⇒ 只比**对局行为**部分（统计行本就应当不同）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

/** 跑一次 sim（固定 seed ⇒ 确定性 ⇒ 可逐字节比对）。 */
function runSim(extra: readonly string[]): string {
  const args = ['tests/sim/run.mjs', '--games', '6', '--seed-base', '1000', '--themes', 'xianxia2026', '--players', '4', ...extra];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, 'sim 退出码非 0：\n' + (r.stdout ?? '') + '\n' + (r.stderr ?? ''));
  return r.stdout ?? '';
}

/** 剔除注入相关的两行 ⇒ 只留「对局行为」部分。 */
function behaviorOnly(stdout: string): string {
  return stdout
    .split('\n')
    .filter((l) => !l.includes('策略注入统计') && !l.includes('策略注入已启用'))
    .join('\n');
}

/** 从输出里读注入统计。 */
function injectionStat(stdout: string): { calls: number; fallbacks: number } {
  const m = stdout.match(/策略注入统计：calls=(\d+) fallbacks=(\d+)/);
  assert.ok(m !== null, '未读到注入统计行：\n' + stdout);
  return { calls: Number(m[1] ?? '0'), fallbacks: Number(m[2] ?? '0') };
}

test('默认关闭：不带 --policy-module 时没有任何注入痕迹', () => {
  const out = runSim([]);
  assert.ok(!out.includes('策略注入'), '默认不应出现策略注入痕迹：\n' + out);
});

test('回落：策略返回 null ⇒ 行为与不注入时逐字节相同（且策略确实被调用过）', () => {
  const base = runSim([]);
  const withPolicy = runSim(['--policy-module', 'tests/gates/fixtures/policy-fallback.mjs']);
  const st = injectionStat(withPolicy);
  assert.ok(st.calls > 0, '回落 fixture 应至少被调用一次（否则这条守卫没有意义）');
  assert.equal(behaviorOnly(withPolicy), behaviorOnly(base), '回落后行为必须与不注入时完全一致');
});

test('抛错：策略 throw ⇒ 不崩、不卡死、回落计数递增，行为逐字节相同', () => {
  const base = runSim([]);
  const withPolicy = runSim(['--policy-module', 'tests/gates/fixtures/policy-throws.mjs']);
  const st = injectionStat(withPolicy);
  assert.ok(st.calls > 0, '抛错 fixture 应至少被调用一次');
  assert.ok(st.fallbacks > 0, '抛错必须计入 fallbacks（回落路径被计数）');
  assert.equal(behaviorOnly(withPolicy), behaviorOnly(base), '抛错后行为必须与不注入时完全一致');
});

test('生效：策略真的改变决策 ⇒ 行为与不注入时不同（接线不是空转）', () => {
  const base = runSim([]);
  const withPolicy = runSim(['--policy-module', 'tests/gates/fixtures/policy-always-challenge.mjs']);
  const st = injectionStat(withPolicy);
  assert.ok(st.calls > 0, '策略应被调用');
  assert.notEqual(behaviorOnly(withPolicy), behaviorOnly(base), '注入真策略后行为应当改变（否则接线是空转）');
});
