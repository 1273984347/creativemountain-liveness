// 一键门卫：把所有门禁串成一条命令，任一失败即 exit 1。
//
// 来源：绿洲共享田园 `交付物/_gate.py`（七门串行 ≤60s）+ GateKeeper `gates.mjs`。
// 两点沿用其纪律：
//   1. **门禁自己也要被检查** —— 门数声明与实跑门数必须一致（绿洲 gate 的自断言）。
//   2. **退出码直取** —— 不经 shell 管道（GateKeeper《管道会吞退出码》）。

import { spawnSync } from 'node:child_process';
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
];

/** 声明的门数（与实跑门数必须一致，否则自断言失败）。 */
const TOTAL_GATES = GATES.length;

console.log('== 创界山·活人认证 一键门卫 ==');

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
