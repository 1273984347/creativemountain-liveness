// 「干净副本」门禁自检：在**隔离临时目录**里跑完整条门禁。
//
// 用途（可沉淀可复用）：
//   · 验证门禁在**没有预置产物**（dist / node_modules 实体）的副本里仍能自举全绿；
//   · 验证门禁不依赖「仓库当前工作区状态」；
//   · 验证负样本自证（副本再套副本）在副本里**不会无限递归**。
//
// ⚠️ 为什么排除 `tests/gates/duel-negative.test.ts`：它在副本里会**再复制一份副本**，
//   ⇒ 若不排除，副本的门 ② 会无限套娃（它复制的是 process.cwd()，即副本自己）。
//   排除后副本的门 ② 少跑这一条常驻负样本，但仓库侧的常驻保障不受影响。
//
// 用法：node docs/沉淀/clean-room-gate-check.mjs

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();

/**
 * 复制清单 = **版本库跟踪的文件**（`git ls-files`）+ 本轮新增但尚未入库的文件。
 *
 * 为什么不用手抄目录名：
 *   · 手抄目录会把**未跟踪的并行会话产物**（如 `spark-output/`、他人未提交的文档）带进副本
 *     ⇒ 副本不再是「干净 clone」语义；
 *   · `git ls-files` 天然只含入库文件，按文件复制还能保持相对路径；
 *   · 未跟踪但**本轮新增**的文件走 EXTRA 白名单
 *     —— 避免「必须先提交才能自检」的循环依赖。
 */
const EXTRA_FILES = ['docs/沉淀/README.md', 'docs/沉淀/clean-room-gate-check.mjs'];
// ⚠️ 必须排除：它在副本里会**再复制一份副本**（它复制的是 process.cwd()，即副本自己）
//   ⇒ 若不排除，副本的门 ② 会无限套娃。
const EXCLUDE = ['tests/gates/duel-negative.test.ts'];

/** 列出版本库跟踪的文件（相对路径，/ 分隔）。 */
function trackedFiles() {
  const r = spawnSync('git', ['ls-files'], {
    cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) { throw new Error('git ls-files 失败：' + (r.stderr ?? '')); }
  return r.stdout.split(/\r?\n/).filter((l) => l.length > 0);
}

const dir = mkdtempSync(resolve(tmpdir(), 'cm-clean-'));
try {
  const files = [...trackedFiles(), ...EXTRA_FILES];
  for (const rel of files) {
    if (EXCLUDE.includes(rel)) { continue; }
    const src = resolve(ROOT, rel);
    if (!existsSync(src)) { continue; } // 索引里存在但工作树已删（不应发生）
    const dst = resolve(dir, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst);
  }
  // node_modules 用**链接**而非复制（几百 MB，且内容只读）
  // ⚠️ 副本**刻意不带 dist / print 产物** ⇒ 验证门禁能在「全新 clone」状态下自举全绿。
  symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
  const r = spawnSync(process.execPath, [resolve(dir, 'tools', 'gate.mjs')], {
    cwd: dir, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  console.log(r.stdout ?? '');
  console.log(r.stderr ?? '');
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
