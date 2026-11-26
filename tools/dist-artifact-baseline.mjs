// dist 产物**基线刷新**脚本 —— 人工显式执行，**不在门禁路径内**。
//
// ⚠️ **为什么单独成脚本、且门禁绝不调用它**（E156 第 7 条的教训）：
//   门 ⑯ 的期望值是「**入库基线**」这份人工维护的静态文件。
//   若把刷新能力做进门禁 CLI（哪怕只是个 flag）⇒ 「改了源码 ⇒ 顺手刷新基线 ⇒ 门禁全绿」
//   就成了**默认路径** ⇒ 门禁失去牙齿。
//   ⇒ 刷新只在本脚本里，且必须由人**显式**执行 ⇒ 刷新动作本身就是一次**评审点**
//   （基线 diff 会打印出来，供人判断「产物字节变化是否可接受」）。
//
// 用法：
//   node tools/dist-artifact-baseline.mjs           ⇒ **只预览**（打印与旧基线的差异，不写文件）
//   node tools/dist-artifact-baseline.mjs --write   ⇒ 真正写入入库基线
//
// ⚠️ **默认只预览**（B98 盲审建议）：刷新会**覆盖**入库基线 ⇒ 若默认就写，
//   则「手滑跑一次」＝ 把未经评审的产物字节登记成期望值 ⇒ 门禁当场失去牙齿。
//   ⇒ 默认 dry-run，写入必须显式 `--write`。**失败方向是安全的**：忘了加 `--write`
//   ⇒ 基线没变 ⇒ 门 ⑯ 会红 ⇒ 立刻发现，而不是静默放行。
//
// ⚠️ 刷新**不等于**认可：若产物字节的漂移是**非预期**的，先定位行为差异
//   （**禁止**直接刷新基线掩盖 —— 与门 ⑮ 的处置口径同款）。
//
// ⚠️ **纪律 A4**：不经 shell、不接管道、退出码直取子进程状态。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectArtifacts, parseBaseline } from './dist-artifact-lock.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = resolve(ROOT, 'docs', 'baselines', 'dist-artifact.sha256.json');

const write = process.argv.includes('--write');
const unknown = process.argv.slice(2).filter((a) => a !== '--write');
if (unknown.length > 0) {
  console.error('✗ 未知参数：' + unknown.join(' ') + '（可用：--write）');
  process.exit(1);
}

const outDir = resolve(ROOT, '.tmp', 'dist-artifact-baseline-' + String(process.pid));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const build = spawnSync(process.execPath, [resolve(ROOT, 'esbuild.config.mjs')], {
  encoding: 'utf8',
  shell: false,
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, CM_BUILD_ROOT: ROOT, CM_BUILD_OUT: outDir },
});
if (build.status !== 0) {
  console.error('✗ 产物构建失败（exit ' + String(build.status) + '）：');
  console.error((build.stdout ?? '') + '\n' + (build.stderr ?? ''));
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

// ⚠️ 摘要算法与门 ⑯ 的执行器**共用同一份实现**（tools/dist-artifact-lock.mjs）⇒ 两边算出的
//   字节数与哈希不可能漂移（E92：同一口径只能有一处实现）。
const artifacts = collectArtifacts(outDir);
rmSync(outDir, { recursive: true, force: true });

if (Object.keys(artifacts).length === 0) {
  console.error('✗ 构建没有产出任何文件 ⇒ 不刷新基线');
  process.exit(1);
}

// 打印与旧基线的 diff（**评审点**）：哪些产物变了、变了什么。
let old = {};
if (existsSync(BASELINE)) {
  try {
    old = parseBaseline(readFileSync(BASELINE, 'utf8')).artifacts;
  } catch (e) {
    console.error('⚠ 旧基线不可用（将视为「无旧基线」）：' + String(e instanceof Error ? e.message : e));
    old = {};
  }
}
const names = [...new Set([...Object.keys(old), ...Object.keys(artifacts)])].sort();
console.log('== 基线刷新：与旧基线的差异（**评审点**）==');
let changed = 0;
for (const n of names) {
  const o = old[n];
  const a = artifacts[n];
  if (!o) { console.log('  + 新增产物 ' + n + '｜SHA256 ' + a.sha256 + '｜' + String(a.bytes) + ' bytes'); changed += 1; continue; }
  if (!a) { console.log('  - 消失产物 ' + n); changed += 1; continue; }
  if (o.sha256 !== a.sha256 || o.bytes !== a.bytes) {
    console.log('  ~ 漂移 ' + n + '｜旧 SHA256 ' + o.sha256 + '（' + String(o.bytes) + ' bytes）'
      + '｜新 SHA256 ' + a.sha256 + '（' + String(a.bytes) + ' bytes）');
    changed += 1;
  } else {
    console.log('  = 未变 ' + n + '｜SHA256 ' + a.sha256);
  }
}

console.log('');
if (!write) {
  console.log('⚠ **预览模式**（未写入）｜变化条目 ' + String(changed) + ' 个');
  console.log('  确认无误后显式执行：node tools/dist-artifact-baseline.mjs --write');
  process.exit(0);
}

const payload = {
  note: 'dist 产物字节基线（门 ⑯ 的**期望值**）—— 人工维护；产物字节变化须经评审后刷新'
    + '（node tools/dist-artifact-baseline.mjs --write）⇒ 门 ⑯ 会据此判红。',
  artifacts,
};
mkdirSync(dirname(BASELINE), { recursive: true });
writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('✓ 基线已写入：' + BASELINE + '（变化条目 ' + String(changed) + ' 个）');
