// 发布前检查（B37）：**门禁 + 全量重扫 + 逐组比对** ⇒ 漂移即失败。
//
// ⚠️ 为什么分两层：日常门禁用**基线快照**做毫秒级回归锁；全量重扫（100 组 × 3000 局 ≈ 9 分钟）
//   成本高 ⇒ 只在发布前跑。本脚本是那道「慢但决定发布」的闸。
// ⚠️ **漂移即失败**：重扫产物与**入库基线快照**逐组比对 ⇒ 任一组不一致 ⇒ exit 1 ⇒ 发布被拦。
//   ⇒ 策略/引擎改动若未同步更新基线，发布会当场失败（而不是悄悄改变平衡）。
//
// ⚠️ 纪律：全程 `spawnSync` + `shell: false`（不经 shell、不接管道 —— 纪律 A4）。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 命令行参数（**仅供自检/负样本测试**；生产路径 `npm run release:check` 不带任何参数 ⇒ 全量执行）。 */
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const hit = argv.find((x) => x.startsWith('--' + name + '='));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};
/** 重扫产物路径（默认生成物，已被 `.gitignore`）。 */
const SCAN_PATH = argOf('scan', 'docs/trial-reserve-scan.json');
/** 基线快照路径（默认入库快照）。 */
const BASELINE_PATH = argOf('baseline', 'docs/baselines/trial-reserve-scan-B34.json');
/** 门禁脚本路径（默认 `tools/gate.mjs`）—— 注入点供**负样本测试**用。 */
const GATE_PATH = argOf('gate', 'tools/gate.mjs');
/** 模拟器路径（默认 `tests/sim/run.mjs`）—— 注入点供**负样本测试**用。 */
const SIM_PATH = argOf('sim', 'tests/sim/run.mjs');
/**
 * ⚠️ 自检模式开关：仅供**负样本测试**用（跳过门禁 / 跳过重扫）⇒ 生产路径不可用。
 *
 * ⚠️ B45：**双条件上锁** —— 跳过生效需**同时**满足：① `CM_SELFTEST=1` ② 显式传入 `--selftest`。
 *   ⇒ `npm run release:check`（**不带** `--selftest`）**结构上无法绕过门禁**：
 *   即使外部设了 `CM_SELFTEST=1`，也会被拒绝（而不是静默继续）。
 *   ⇒ 绕过入口统一收敛到 `tests/gates/release-check-selftest.mjs`（tests/ 专用包装器）。
 */
const SELFTEST = process.env.CM_SELFTEST === '1';
const wantsSkip = argv.includes('--skip-gate') || argv.includes('--skip-rescan');
const selftestMode = SELFTEST && argv.includes('--selftest');
if (wantsSkip && !selftestMode) {
  console.error('✗ 自检模式需同时满足：CM_SELFTEST=1 且传入 --selftest（生产发布检查不得绕过门禁）');
  process.exit(1);
}
const skipGate = selftestMode && argv.includes('--skip-gate');
const skipRescan = selftestMode && argv.includes('--skip-rescan');

/**
 * 扫描参数 —— 必须与 **B34 基线**一致。
 * ⚠️ 若写错：逐组比对会因「每组局数/组数」不符而红 ⇒ **自保护**，不会误判通过。
 */
const SCAN_ARGS = [
  '--scan-reserves', '0,1,2,3,4',
  '--scan-seeds', '1000,5000,9000,13000,17000,21000,25000,29000,33000,37000,41000,45000,49000,53000,57000,61000,65000,69000,73000,77000',
  '--games', '125',
  '--scan-json', SCAN_PATH,
];

/** 跑一步；失败即 exit（不继续）。 */
function run(label, args) {
  console.log('\n== ' + label + ' ==');
  const res = spawnSync(process.execPath, args, {
    encoding: 'utf8', shell: false, cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
  });
  const out = (res.stdout ?? '') + '\n' + (res.stderr ?? '');
  console.log(out.split(/\r?\n/).slice(-12).join('\n'));
  if (res.status !== 0) {
    console.error('\n✗ 发布前检查失败：' + label);
    process.exit(res.status ?? 1);
  }
}

if (skipGate) {
  console.log('\n== 门禁：已跳过（自检模式，不得用于发布） ==');
} else {
  run('门禁（十三道）', [resolve(ROOT, GATE_PATH)]);
}
if (skipRescan) {
  console.log('\n== 全量重扫：已跳过（自检模式，不得用于发布） ==');
} else {
  run('全量重扫（100 组 × 3000 局）', [resolve(ROOT, SIM_PATH), ...SCAN_ARGS]);
}
run('逐组比对（漂移即失败）', [
  resolve(ROOT, 'docs', '沉淀', 'compare-scan-baseline.mjs'),
  '--scan=' + SCAN_PATH,
  '--baseline=' + BASELINE_PATH,
]);

console.log('\n== PASS：发布前检查全绿（门禁 + 全量重扫 + 逐组比对零漂移） ==');
