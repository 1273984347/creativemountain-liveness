// 测试**专用**的发布检查入口（B45/B46）—— 「绕过闸门」的能力**仅存在于这里**。
//
// ⚠️ B46 起**不再委托**生产脚本的跳过能力（生产脚本已彻底移除 `--selftest` / `--skip-*`）⇒
//   本包装器**自建编排**：
//   · 只验**比对层**（默认）⇒ 直接跑 `docs/沉淀/compare-scan-baseline.mjs`（毫秒级）；
//   · 需要**门禁/重扫步骤**（注入了 `--gate=` / `--sim=`）⇒ 委托生产脚本跑三步（注入的假脚本会立即失败 ⇒ 秒级）。
// ⚠️ 生产发布链（`npm run release:check`）**不经过本文件** ⇒ 无法绕过门禁。

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const has = (name) => args.some((a) => a.startsWith('--' + name + '='));

let tmpDir = null;
let target;
let targetArgs;

if (has('gate') || has('sim')) {
  // 需要真实跑门禁 / 重扫步骤 ⇒ 委托生产脚本（不传任何自检标记）。
  // ⚠️ B46：**不转发** `--skip-*` —— 生产脚本已不认识它们 ⇒ 会直接拒绝 ⇒ 跳过语义由本包装器实现：
  //   未注入门禁时用**立即成功的假门禁**代替 ⇒ 避免真跑 13 道门拖慢测试。
  const forwarded = args.filter((a) => a !== '--skip-gate' && a !== '--skip-rescan');
  if (!has('gate')) {
    tmpDir = mkdtempSync(join(tmpdir(), 'cm-fake-gate-'));
    const fake = join(tmpDir, 'ok-gate.mjs');
    writeFileSync(fake, 'console.log(\'假门禁：立即成功\');\nprocess.exit(0);\n', 'utf8');
    target = resolve(ROOT, 'tools', 'release-check.mjs');
    targetArgs = ['--gate=' + fake, ...forwarded];
  } else {
    target = resolve(ROOT, 'tools', 'release-check.mjs');
    targetArgs = [...forwarded];
  }
} else {
  // 只需比对层 ⇒ 直接跑比对脚本。
  target = resolve(ROOT, 'docs', '沉淀', 'compare-scan-baseline.mjs');
  targetArgs = [...args];
}

const res = spawnSync(process.execPath, [target, ...targetArgs], {
  encoding: 'utf8', shell: false, cwd: ROOT,
});
process.stdout.write(res.stdout ?? '');
process.stderr.write(res.stderr ?? '');
if (tmpDir !== null) { rmSync(tmpDir, { recursive: true, force: true }); }
// ⚠️ 与生产发布检查**同一措辞**（「发布前检查失败：<环节>」）⇒ 负样本断言不因迁移而漂移。
//   ⚠️ 委托模式由**生产脚本**自己打印精确环节（门禁 / 全量重扫）⇒ 这里只在比对层模式补一句。
if ((res.status ?? 0) !== 0 && !(has('gate') || has('sim'))) {
  console.error('✗ 发布前检查失败：逐组比对（漂移即失败）');
}
process.exit(res.status ?? 1);
