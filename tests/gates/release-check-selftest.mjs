// 测试**专用**的发布检查入口（B45）—— 「绕过闸门」的能力从生产脚本**迁到这里**。
//
// ⚠️ 为什么要有这个文件：生产的 `tools/release-check.mjs` **不允许**跳过门禁/重扫
//   （只有 `CM_SELFTEST=1` **且**显式传 `--selftest` 才生效）⇒ 负样本测试需要
//   「跳过重扫、只跑比对」的入口 ⇒ 集中在此，测试文件不再各自设环境变量。
// ⚠️ 本脚本只服务**测试**：生产发布链（`npm run release:check`）不经过它 ⇒ 无法绕过门禁。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const res = spawnSync(process.execPath, [
  resolve(ROOT, 'tools', 'release-check.mjs'),
  '--selftest',
  ...process.argv.slice(2),
], {
  encoding: 'utf8', shell: false, cwd: ROOT,
  env: { ...process.env, CM_SELFTEST: '1' },
});
process.stdout.write(res.stdout ?? '');
process.stderr.write(res.stderr ?? '');
process.exit(res.status ?? 1);
