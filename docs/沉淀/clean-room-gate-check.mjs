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

import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { copyTracked } from '../../tools/repo-copy.mjs';

const ROOT = process.cwd();

/**
 * 复制清单 = **工作树快照**（已入库 + 未跟踪但未忽略，见 `tools/repo-copy.mjs`）。
 *
 * 为什么不用手抄目录名：
 *   · 手抄目录会把 `.gitignore` 忽略的**生成物**（`dist/`、`print/<theme>/`）一起带进副本
 *     ⇒ 副本不再验证「无产物时能否自举」；
 *   · 按文件复制能保持相对路径，且**排除 .gitignore 项**。
 *
 * ⚠️ 未跟踪文件**要带上**：本批新建的模块（如 `tools/rules-book-contract.mjs`）尚未入库，
 *   只取已入库文件会让副本因「模块找不到」而假红。
 *
 * ⚠️ 复制逻辑与隔离副本测试共用 `tools/repo-copy.mjs`（单一事实源）。
 */
// ⚠️ 必须排除：它们在副本里会**再复制一份副本**（它们复制的是 process.cwd()，即副本自己）
//   ⇒ 若不排除，副本的门 ② 会无限套娃。
const EXCLUDE = ['tests/gates/duel-negative.test.ts', 'tests/build/rules-book.test.ts'];

const dir = mkdtempSync(resolve(tmpdir(), 'cm-clean-'));
try {
  copyTracked(ROOT, dir, { exclude: EXCLUDE });
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
