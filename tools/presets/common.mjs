// B79 取证脚本的共用件（**只放取数与文件遍历，不放判据**）。
//
// 为什么住在 tools/presets/ 而不是 .tmp/：执行记录 §5/§6/§12/§13/§14 把这些脚本当**复算入口**引用；
// `.tmp/` 未入库 ⇒ 干净克隆里入口不存在，「证据位置」就成了空指针（E136 的同一形态：话说在前，取证跟不上）。
//
// ⚠️ 三个约定：
//   1. **不依赖 CWD**：一律从 `ROOT`（本文件的上两级）拼路径，`node tools/presets/xxx.mjs` 在任何目录都能跑。
//   2. **判据语义各自保留**：各脚本的行过滤规则是当时量出记录里那些数的**同一把尺**，
//      收敛成一份"更干净"的实现就等于换尺，历史数字立刻不可复算 ⇒ 共用件只共用遍历与 git。
//   3. **只用 execFile 传 argv 数组**调 git，不拼 shell 字符串。
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（本文件在 `<root>/tools/presets/`）。 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** B79 各取证脚本当年用的尺：**不含** `.mts`（多一个 `policy.d.mts` 就多 4 行注释，记录里的数立刻不复算）。 */
export const BATCH_SOURCE_EXT = /\.(ts|tsx|mjs)$/;

/** 相对仓库根的路径 → 绝对路径。 */
export const at = (...parts) => join(ROOT, ...parts);

/** 相对仓库根的 posix 风格相对路径（记录里引用文件都用这个形状）。 */
export function relOf(absPath) {
  return absPath.slice(ROOT.length + 1).split('\\').join('/');
}

/**
 * 递归收集某子树下的源文件（绝对路径）。
 *
 * ⚠️ 默认用 `BATCH_SOURCE_EXT`（`.ts/.tsx/.mjs`）而不是 `tools/theme-word-scan.mjs` 的四扩展名版本：
 *   记录里那些清点数字是照三扩展名的尺量的。尺一旦换，历史数就不可复算——这比脚本难看更糟。
 *   （`b79-t19-count.mjs` 例外：它当年就是走扫描器的 `listSources`，engine/web 里既无 `.mts` 也无
 *   `.tsx`，两把尺在那一侧等价，所以 59/37/22 照旧复算得出。）
 */
export function walkSources(subdir, ext = BATCH_SOURCE_EXT) {
  const out = [];
  const dir = at(subdir);
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...walkSources(join(subdir, e), ext)); }
    else if (ext.test(e)) { out.push(p); }
  }
  return out;
}

/** 读仓库内文件（相对根路径）。 */
export function readRepo(relPath) {
  return readFileSync(at(relPath), 'utf8');
}

/** `git <args…>`，argv 数组、无 shell。 */
export function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** 取某个历史提交里某个文件的内容。 */
export function gitShow(rev, relPath) {
  return git(['show', `${rev}:${relPath}`]);
}

/** `git diff --numstat <range> -- <paths>` → 增删行与文件数（施工面对账用）。 */
export function gitNumstat(revRange, paths) {
  const out = git(['diff', '--numstat', revRange, '--', ...paths]);
  let add = 0;
  let del = 0;
  let files = 0;
  for (const l of out.split('\n').filter(Boolean)) {
    const [a, d] = l.split('\t');
    add += Number(a);
    del += Number(d);
    files += 1;
  }
  return { add, del, files };
}

/** B79 开工基线提交（台账与所有 `git show` 都锚在它上面）。 */
export const BATCH_BASE = '879ddce';
