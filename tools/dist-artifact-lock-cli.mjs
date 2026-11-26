// 门 ⑯ · dist 产物**字节基线一致性**的执行器（CLI）。
//
// ⚠️ 为什么单独成文件：门 ⑯ 要回答的问题是「**入库的产物字节基线，还是当前源构建出来的吗？**」
//   —— 与门 ④（构建能不能成功）、门 ⑭（产物行为对不对）**都不是同一个问题**。
//
// ⚠️ **绝不「就地重生成后比对自己」**（门 ⑮ 的教训，本门同款）：
//   期望值只能来自**入库基线**（人工维护的静态文件）⇒ 它与被检查对象来源不同 ⇒ 才不是同义反复。
//
// ⚠️ **根目录按脚本自身位置解析**（`import.meta.url`），**不**用 `process.cwd()`：
//   用 cwd 的话，负样本在**隔离副本**里跑本 CLI 时会读到**原仓库**的基线与源
//   ⇒ 副本里注入的漂移根本不会生效 ⇒ 负样本**假绿**（B94 实测踩到：cwd 定位）。
//
// ⚠️ **纪律 A4**：不经 shell（`shell: false`）、不接管道、退出码直取子进程状态。
//
// ⚠️ **期望值来源恒为「仓库根的入库基线」**：`--source-root` 只换**源**（供端到端负样本自证），
//   **不换期望值** ⇒ 本门**不存在**任何能让它恒绿的开关（E156 第 7 条的教训）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectArtifacts, compareArtifacts, parseBaseline } from './dist-artifact-lock.mjs';

/** 仓库根 = 本脚本所在目录的上一级（**不**依赖 cwd —— 见头注）。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 入库基线（**期望值的唯一出处**，恒为仓库根下那一份）。 */
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'dist-artifact.sha256.json');

/**
 * 解析命令行参数。
 *
 * ⚠️ 只认 `--source-root` 一个参数（**两种写法**：`--source-root <路径>` 与 `--source-root=<路径>`），
 *   且它**只换源不换期望值**：供端到端负样本在**隔离副本**里注入源码漂移时使用
 *   （副本里跑本 CLI 时，副本没有 node_modules ⇒ 副本内的 esbuild.config.mjs 无法 import 'esbuild'
 *   ⇒ 故由**仓库内**的脚本读副本的源，见下面「独立重建」段）。
 * ⚠️ 门 ⑯ 在门禁链里**不传任何参数** ⇒ 源 = 仓库根、期望 = 仓库基线。
 * ⚠️ **未知参数必须报错**：静默忽略会让拼错的 flag 回落到默认值，而「回落到默认值」
 *   在本门里等于「看起来正常」⇒ 掩盖误用（门 ⑮ 同款纪律）。
 * ⚠️ 但**报错要说清是哪种误用**：`--source-root=x`（等号写��）与真·未知参数要分开措辞
 *   （B98 盲审建议）—— 否则用户以为「等号写法不被支持」，实际它是被支持的。
 *
 * @param {readonly string[]} argv 命令行参数。
 * @returns {{ sourceRoot: string }}
 */
function parseArgs(argv) {
  let sourceRoot = ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source-root') {
      const raw = String(argv[++i] ?? '');
      if (raw === '') {
        console.error('✗ --source-root 需要一个路径（也可用 --source-root=<路径>）');
        process.exit(1);
      }
      sourceRoot = resolve(ROOT, raw);
    } else if (a.startsWith('--source-root=')) {
      const raw = a.slice('--source-root='.length);
      if (raw === '') {
        console.error('✗ --source-root 需要一个路径（--source-root= 不能为空）');
        process.exit(1);
      }
      sourceRoot = resolve(ROOT, raw);
    } else if (a.startsWith('--source-root')) {
      console.error('✗ --source-root 必须写成「--source-root <路径>」或「--source-root=<路径>」');
      process.exit(1);
    } else {
      console.error('✗ 未知参数：' + a + '（可用：--source-root <路径>）');
      console.error('  ⚠️ 本门**不提供**任何刷新基线 / 放宽比对 / 跳过检查的开关。');
      process.exit(1);
    }
  }
  return { sourceRoot };
}

const args = parseArgs(process.argv.slice(2));

console.log('== dist 产物字节基线一致性（门 ⑯）==');

// ① 期望值：入库基线（**只读**）。缺失 / 形状不合法 ⇒ **失败关闭**（判红，不静默通过）。
if (!existsSync(BASELINE)) {
  console.error('✗ 入库基线不存在：' + BASELINE);
  console.error('  （门 ⑯ 的期望值缺失 ⇒ 无从判断产物是否漂移 ⇒ 判红）');
  console.error('  恢复方式：node tools/dist-artifact-baseline.mjs --write（人工评审后执行）');
  process.exit(1);
}
let baseline;
try {
  baseline = parseBaseline(readFileSync(BASELINE, 'utf8'));
} catch (e) {
  console.error('✗ 入库基线不可用：' + String(e instanceof Error ? e.message : e));
  console.error('  （**失败关闭**：解析不了基线时绝不能当成「无漂移」放行）');
  process.exit(1);
}

if (!existsSync(args.sourceRoot)) {
  console.error('✗ 源根不存在：' + args.sourceRoot);
  process.exit(1);
}

// ② 独立重建：把产物构建到**源根下的独立临时目录**（不复用门 ④ 的 dist/，不覆盖任何既有产物）。
//
// ⚠️ **为什么在仓库内跑 esbuild.config.mjs、却读副本的源**：
//   隔离副本里**没有 node_modules** ⇒ 副本内的 esbuild.config.mjs 无法 `import 'esbuild'`。
//   ⇒ 用 esbuild.config.mjs 既有的 `CM_BUILD_ROOT`（源根）与 B98 新增的 `CM_BUILD_OUT`（输出根）
//   两个开关：脚本在仓库内跑（esbuild 正常解析），**源**来自 CM_BUILD_ROOT，**产物**写到 CM_BUILD_OUT。
//   ⇒ 正常门禁路径下两者都指向仓库根 ⇒ 行为与门 ④ 一致。
// ⚠️ 两个变量都**显式给绝对路径** ⇒ 与继承来的环境变量无关（且门 ④ 那侧已把这两个变量剥离，
//   见 tools/gate.mjs 的门 ④ env 字段 —— 否则本机若恰好设过它们，门 ④ 会把产物建到别处）。
const outDir = resolve(args.sourceRoot, '.tmp', 'dist-artifact-lock-' + String(process.pid));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const build = spawnSync(process.execPath, [resolve(ROOT, 'esbuild.config.mjs')], {
  encoding: 'utf8',
  shell: false,
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
  env: {
    ...process.env,
    CM_BUILD_ROOT: args.sourceRoot,
    CM_BUILD_OUT: outDir,
  },
});
if (build.status !== 0) {
  console.error('✗ 产物重建失败（exit ' + String(build.status) + '）：');
  console.error((build.stdout ?? '') + '\n' + (build.stderr ?? ''));
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

// ③ 枚举本次构建产出的产物（**集合层**的比对面）。
//   ⚠️ 摘要算法是**共用实现**（tools/dist-artifact-lock.mjs 的 collectArtifacts）——
//     与基线刷新脚本同一份 ⇒ 两边算出的字节数不可能漂移（E92）。
const actual = collectArtifacts(outDir);
rmSync(outDir, { recursive: true, force: true });

if (Object.keys(actual).length === 0) {
  console.error('✗ 本次构建没有产出任何文件（输出目录：' + outDir + '）⇒ 判红');
  process.exit(1);
}

// ④ 比对：入库基线（只读）↔ 本次独立构建产出。
const result = compareArtifacts(baseline.artifacts, actual, '本次构建产出（' + outDir + '）');

if (result.ok) {
  const n = Object.keys(actual).length;
  console.log('✓ 产物字节与入库基线**逐字节一致**（容差 0）· ' + String(n) + ' 个产物');
  for (const name of Object.keys(actual).sort()) {
    console.log('  ' + name + '｜SHA256 ' + actual[name].sha256 + '｜' + String(actual[name].bytes) + ' bytes');
  }
  console.log('  ⇒ 基线仍由当前源产生 ⇒ 无漂移');
  process.exit(0);
}

console.error('✗ dist 产物字节已漂移（容差 0）：');
for (const issue of result.issues) { console.error('  ' + issue); }
console.error('');
console.error('  含义：入库基线**已不再**由当前源构建产生（E153 同族：手抄基线会静默过期）。');
console.error('  处置：若本次改动**确实**改变了产物字节 ⇒ 评审后刷新基线并与改动同批提交：');
console.error('    node tools/dist-artifact-baseline.mjs --write');
console.error('  若**不该**变 ⇒ 改动引入了非预期行为，须先定位（**禁止**直接刷新基线掩盖）。');
process.exit(1);
