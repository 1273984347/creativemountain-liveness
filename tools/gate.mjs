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
  // ⚠️ **剥离两个构建环境变量**（B98 盲审发现）：门 ④ 裸跑构建脚本时会继承全部 process.env
  //   ⇒ 若本机恰好设过 `CM_BUILD_ROOT` / `CM_BUILD_OUT`（它们是**隔离副本自证**用的开关），
  //   门 ④ 会把产物建到**别处** ⇒ `dist/` 不重建 ⇒ 门 ⑩ / 门 ⑭ 用的可能是**旧产物** ⇒ 假绿。
  //   ⇒ 门 ④ 显式把这两个变量置空（`undefined` ⇒ 子进程里**不存在**这两个变量）。
  { name: '单文件构建（esbuild）', cmd: process.execPath, args: [resolve('esbuild.config.mjs')],
    env: { ...process.env, CM_BUILD_ROOT: undefined, CM_BUILD_OUT: undefined } },
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
  // ⚠️ 第 14 道门（B86）：数字轨**浏览器走查与可观测断言**。
  //   真浏览器 + **file://** 单文件（验证「双击即玩」这个产品承诺，不得改成 http 预览），
  //   覆盖：四套主题 UI 契约（玩家行数 / 棋盘格数 == scales[players].boardLength /
  //   面板标题取 terms.path / 占位符零残留 / 面板非空）+ 几何（无横向溢出、棋盘格盒子非零、
  //   手牌不越界）+ 窄屏 390 无横向滚动 + 非法 seed 的**可见错误信号**（aria-invalid）+
  //   行棋后日志增加 + console/page 零错误。
  //   **依赖门 4 的 dist/** ⇒ 必须排在 esbuild 之后。
  //   负样本锚点：tests/gates/ui-walkthrough-negative.test.ts
  //   （占位符不展开 / 棋盘超宽 / 改坏断言容差 —— 三条各必红，且副本自建 bundle 不依赖仓库 dist）。
  { name: '浏览器走查与可观测断言（tests/e2e/ui-walkthrough.mjs）', cmd: process.execPath, args: [resolve('tests', 'e2e', 'ui-walkthrough.mjs')] },
  // ⚠️ 第 15 道门（B94）：平衡报告**入库一致性** —— 让 docs/balance-report.md 进入门禁的比对面。
  //   起因（B92 遗留 L-B92-4）：报告是**入库生成物**却**不被任何门读取** ⇒ 引擎演进后
  //   它会悄悄过期，而引用它的文档会一起过期，且**没有任何门会报**（E153）。
  //   做法：按报告的生成口径（默认参数 = 4 主题 × 6 人数档 × 1000 局 = 24000 局）
  //   **重跑一份新的到 .tmp/**（**绝不覆盖入库版** —— 就地重生成 ⇒ 必然相等 ⇒ 门禁永绿），
  //   再与**入库版逐字节比对**（容差 0，仅行尾归一化；口径依据见 tools/balance-report-lock.mjs）。
  //   **追加在末尾**（第 ⑮ 道）⇒ ⑨/⑫/⑬ 的编号不变，L-B92-1 重标定可直接引用。
  //   负样本锚点：tests/gates/balance-report-lock.test.ts（注入漂移 ⇒ 必红；恢复 ⇒ 必绿）。
  { name: '平衡报告入库一致性（tools/balance-report-lock-cli.mjs）', cmd: process.execPath, args: [resolve('tools', 'balance-report-lock-cli.mjs')] },
  // ⚠️ 第 16 道门（B98）：dist 产物**字节基线一致性** —— 让 `dist/` 的单文件产物进入门禁的比对面。
  //   起因（E153 同族）：产物字节基线此前**只以文字形式**记在批次文档里（B97 记录
  //   「A0A85EE5… / 212,032 bytes」）⇒ **没有任何机器守卫** ⇒ ① 产物字节变了没人知道；
  //   ② 那条**手抄**基线自己漂了也没人知道。
  //   做法：**独立重建**一份产物到临时目录（**不复用**门 4 的 dist/、**不就地覆盖**
  //   ⇒ 不是「自己重生成出来的自己」那种同义反复），算 **SHA256 + 字节数**，
  //   与**入库基线** `docs/baselines/dist-artifact.sha256.json` **逐字节比对**
  //   （**容差 0** —— 依据**实测**：同一 checkout 连续三次独立构建，两个产物 SHA 与字节数全等）
  //   ⇒ 漂移即红并**逐条点名**；**集合层**也判（本次产出集合必须 == 基线登记集合
  //   ⇒ 构建入口新增输出格式却忘登记基线 ⇒ 不会静默成盲区）；**失败关闭**
  //   （基线缺失 / 不可解析 / 构建失败 / 零产出 ⇒ 一律判红，绝不静默通过）。
  //   **追加在末尾**（第 ⑯ 道）⇒ 既有编号（⑨/⑫/⑬/⑮）不变。
  //   负样本锚点：tests/gates/dist-artifact-lock.test.ts（判据级）
  //   + tests/gates/dist-artifact-lock-e2e.test.ts（端到端：隔离副本改源码 ⇒ 必红；按原字节恢复 ⇒ 必绿）。
  { name: 'dist 产物字节基线一致性（tools/dist-artifact-lock-cli.mjs）', cmd: process.execPath, args: [resolve('tools', 'dist-artifact-lock-cli.mjs')] },
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

/**
 * 声明的门数（**字面量**，不是 `GATES.length`）。
 *
 * ⚠️ **为什么必须写字面量**（B94 盲审发现）：原写法 `const TOTAL_GATES = GATES.length;`
 *   再拿它跟 `GATES.length` 比 ⇒ **恒真**（同义反复）⇒ 门数漂移了也**发现不了**，
 *   文档里那句「门数声明 == 实跑门数（自断言）」就成了**空话**。
 *   ⇒ 现在写成字面量 **16** ⇒ 增删门禁而忘了改这里 ⇒ **当场判红**。
 *   ⚠️ 改门数时**必须**同时改这里、门禁清单、README（含 README.en.md）等各处表述。
 */
const TOTAL_GATES = 16;

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
    // ⚠️ 门条目可自带 env（如门 ④ 剥离构建环境变量）；未指定则继承当前环境。
    env: g.env ?? process.env,
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
