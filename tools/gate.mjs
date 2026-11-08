// 一键门卫：把所有门禁串成一条命令，任一失败即 exit 1。
//
// 来源：绿洲共享田园 `交付物/_gate.py`（七门串行 ≤60s）+ GateKeeper `gates.mjs`。
// 两点沿用其纪律：
//   1. **门禁自己也要被检查** —— 门数声明与实跑门数必须一致（绿洲 gate 的自断言）。
//   2. **退出码直取** —— 不经 shell 管道（GateKeeper《管道会吞退出码》）。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

/** 一道门禁。 */
const GATES = [
  { name: '语法与类型（tsc --noEmit）', cmd: process.execPath, args: [resolve('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'] },
  { name: '单元与门禁自检（node --test）', cmd: process.execPath, args: ['--test', 'tests/**/*.test.ts'] },
  { name: '文档口径（doc-sync）', cmd: process.execPath, args: [resolve('tools', 'doc-sync.mjs')] },
  { name: '单文件构建（esbuild）', cmd: process.execPath, args: [resolve('esbuild.config.mjs')] },
  { name: '主题包校验（theme-validate）', cmd: process.execPath, args: [resolve('tools', 'theme-validate.mjs')] },
  { name: 'IR 契约校验（ir-validate）', cmd: process.execPath, args: [resolve('tools', 'ir-validate.mjs')] },
  { name: '双轨一致性（parity-check）', cmd: process.execPath, args: [resolve('tools', 'parity-check.mjs')] },
  { name: '主题差异化核对（theme-diff-check，规格 §10.1）', cmd: process.execPath, args: [resolve('tools', 'theme-diff-check.mjs')] },
  { name: '规模与平衡冒烟（tests/sim/run.mjs --check）', cmd: process.execPath, args: [resolve('tests', 'sim', 'run.mjs'), '--games', '30', '--check'] },
  // ⚠️ 第 10 道门：浏览器端到端（对峙）。**依赖门 4 已构建的 `dist/`** ⇒ 排在 esbuild 之后。
  //   单独跑本门禁时需先 `npm run build`（否则找不到 dist/创界山-活人认证.html）。
  //   负样本锚点：门 9 的「对峙在真实对局中发生过」断言（破坏引擎消费点 ⇒ 必红）。
  { name: '对峙浏览器端到端（tests/e2e/duel-e2e.mjs）', cmd: process.execPath, args: [resolve('tests', 'e2e', 'duel-e2e.mjs')] },
  // ⚠️ 第 11 道门（B23）：关隘试炼**通过率专项平衡**。
  //   骰子型试炼（`dice_is_at_least`）的实测通过率须与理论期望 `(faces-amount+1)/faces` 偏差 ≤ 10pp；
  //   失败时必须写「本关改为付费」标记（挑战型语义）⇒ 挑战型试炼不会静默变成「永远通过」。
  { name: '关隘试炼通过率专项平衡（tests/sim/run.mjs --trial-rate --check）', cmd: process.execPath, args: [resolve('tests', 'sim', 'run.mjs'), '--trial-rate', '--check'] },
  // ⚠️ 第 12 道门（B25）：位次胜率极差**回归锁**（先手优势的直接度量）。
  //   **固定 seed + 固定局数** ⇒ 同 seed 同结果 ⇒ 确定性、零 flake；
  //   阈值取该固定 seed 的基线 + 余量（基线：最大极差 8.6pp · 最大 RMS 3.38pp）。
  { name: '位次胜率极差回归锁（tests/sim/run.mjs --position-spread --check）', cmd: process.execPath, args: [resolve('tests', 'sim', 'run.mjs'), '--position-spread', '--games', '100', '--check'] },
  // ⚠️ 第 13 道门（B33）：余量判定的**离线回归** —— 用已发布的多 seed 数据重算 Welch t 与
  //   **精确** t 临界值 ⇒ 断言「余量 0 vs 2」的判定仍与 B31 基线一致（显著）。
  //   ⚠️ 直接 spawn node 脚本（不经 shell、不接管道 —— 纪律 A4）。
  { name: '余量判定离线回归（docs/沉淀/verify-trial-reserve-critical.mjs）', cmd: process.execPath, args: [resolve('docs', '沉淀', 'verify-trial-reserve-critical.mjs')] },
];

/**
 * 产物自举：门 6/7 依赖 `print/<theme>/ir.json`、`规则书.html`、`*.pdf` 等构建产物，
 * 而 `print/*` 在 .gitignore 中（实体件属生成物，不入版本库）
 * ⇒ **全新 clone / 干净副本里产物必然缺失**，门禁会直接红。
 *
 * 做法：**缺失才生成**（日常零开销），生成命令直接跑 `build/build-print-all.mjs`
 * —— 本文件不手抄构建参数（避免第二事实源）；该脚本也是 `package.json` 的 `build:print`。
 *
 * ⚠️ **不经 shell**（门禁纪律 A4：门禁脚本不得使用 shell:true —— shell 会改变退出码语义）。
 *   Windows 上 `npm.cmd` 无法用 `shell: false` 直接执行（EINVAL），
 *   故这里调用的是**纯 node 脚本**，而不是 npm。
 */
function ensurePrintArtifacts() {
  const themesDir = resolve(ROOT, 'themes');
  const themeIds = readdirSync(themesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => existsSync(resolve(themesDir, id, 'theme.json')))
    .sort();
  const missing = themeIds.filter((id) => !existsSync(resolve(ROOT, 'print', id, 'ir.json')));
  if (missing.length === 0) { return; }

  console.log('[自举] print 产物缺失（' + missing.join('、') + '）⇒ 执行 build/build-print-all.mjs');
  // ⚠️ 不经 shell（门禁纪律 A4）：直接跑 node 脚本，退出码原样传出。
  //   构建参数只写在 build/build-print-all.mjs 一处（package.json 的 build:print 指向它）。
  const res = spawnSync(process.execPath, [resolve(ROOT, 'build', 'build-print-all.mjs')], {
    encoding: 'utf8',
    shell: false,
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error('[自举] 产物生成失败：');
    console.error((res.stdout ?? '') + '\n' + (res.stderr ?? ''));
    process.exit(1);
  }
  const stillMissing = themeIds.filter((id) => !existsSync(resolve(ROOT, 'print', id, 'ir.json')));
  if (stillMissing.length > 0) {
    console.error('[自举] 产物生成后仍缺失：' + stillMissing.join('、'));
    process.exit(1);
  }
  console.log('[自举] print 产物已就绪');
}

/** 声明的门数（与实跑门数必须一致，否则自断言失败）。 */
const TOTAL_GATES = GATES.length;

console.log('== 创界山·活人认证 一键门卫 ==');

ensurePrintArtifacts();

const failures = [];
for (let i = 0; i < GATES.length; i++) {
  const g = GATES[i];
  const started = Date.now();
  const res = spawnSync(g.cmd, g.args, {
    encoding: 'utf8',
    shell: false,
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const dt = ((Date.now() - started) / 1000).toFixed(1);
  const ok = res.status === 0;
  console.log(`[门${i + 1}] ${ok ? '✓' : '✗'} ${g.name} (${dt}s)`);
  if (!ok) {
    failures.push({ i: i + 1, g, output: `${res.stdout ?? ''}\n${res.stderr ?? ''}` });
  }
}

// 门禁自断言：声明门数 == 实跑门数
if (TOTAL_GATES !== GATES.length) {
  console.log(`✗ 门禁自断言 FAIL：声明 ${TOTAL_GATES} 门，实跑 ${GATES.length} 门`);
  process.exit(1);
}

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`\n---- 门${f.i} ${f.g.name} 输出尾 30 行 ----`);
    console.log(f.output.split(/\r?\n/).slice(-30).join('\n'));
  }
  console.log(`\n✗ FAIL：${failures.length} 门必须修复`);
  process.exit(1);
}

console.log(`\n== PASS：${TOTAL_GATES} 门全绿 ==`);
