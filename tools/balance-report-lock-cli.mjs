// 门 ⑮ · 平衡报告**入库一致性**的执行器（CLI）。
//
// ⚠️ 为什么是独立 CLI（而不是直接跑 `tests/sim/run.mjs --check`）：
//   门 ⑨（规模与平衡冒烟）跑的是 **30 局/档** 的快检，只看**统计阈值**；
//   本门要回答的是另一个问题：**「入库的 `docs/balance-report.md` 还是当前引擎跑出来的吗？」**
//   ⇒ 必须**按报告的生成口径**（默认参数 = 4 主题 × 6 人数档 × 1000 局 = 24000 局）
//      重跑一份**新的**到**临时文件**，再与**入库版逐字节比对**。
//
// ⚠️ **绝不覆盖入库版**（本门最容易犯的错）：
//   若直接 `node tests/sim/run.mjs --out docs/balance-report.md` 再比对自己
//   ⇒ **必然相等** ⇒ 门禁永绿 ⇒ 比对面形同虚设（本门就白做了）。
//   ⇒ 新版一律写到 `.tmp/`（已 gitignore），入库版**只读**。
//
// ⚠️ **根目录按脚本自身位置解析**（`import.meta.url`），**不**用 `process.cwd()`：
//   用 cwd 的话，负样本在**隔离副本**里跑本 CLI 时会读到**原仓库**的引擎与报告
//   ⇒ 副本里注入的漂移根本不会生效 ⇒ 负样本**假绿**（B94 实测踩到：
//   副本内改引擎后本门仍判绿，根因就是 cwd 定位）。
//   ⇒ 根随脚本走 ⇒ 副本里的 CLI 只看副本的引擎/主题/报告。
//
// ⚠️ **纪律 A4**：不经 shell（`shell: false`）、不接管道、退出码直取子进程状态。
//
// ⚠️ **口径**：容差 = 0（逐字节相等，仅行尾归一化）—— 理由见 tools/balance-report-lock.mjs 头注。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBalanceReport, expectedSampleScope, parseActualTotalGames } from './balance-report-lock.mjs';
import { SCALES } from '../engine/scales.ts';

/** 仓库根 = 本脚本所在目录的上一级（**不**依赖 cwd —— 见头注）。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 权威规格文件（模拟口径的**独立**期望值来源）。 */
const SPEC = resolve(ROOT, 'docs', 'superpowers', 'specs', '2026-11-07-creative-mountain-liveness-design.md');

/** 主题包目录（主题数由**实际存在的包**派生，不手抄）。 */
const THEMES_DIR = resolve(ROOT, 'themes');

/**
 * 解析命令行参数。
 *
 * ⚠️ `--report` / `--games` **只供负样本自证**用（让端到端样本能在几十秒内跑完）；
 *   **门 ⑮ 不传任何参数** ⇒ 用默认值（入库报告 + 报告的生成口径）。
 *   ⚠️ 误用行为**不对称**：`--games` 误用是**安全侧失败**（期望口径按局数等比缩放 ⇒
 *     与入库版口径不符 ⇒ 必然判红）；但 `--report` 误用（指向重跑产物）**会恒绿**
 *     ⇒ 故代码里有**显式自比护栏**拒绝该情形。
 *   ⚠️ **没有任何开关能关闭「防缩样本」能力**（B94 第二轮复核修复：曾有一个「期望口径取自
 *     本次重跑版」的自证开关 ⇒ 它会让期望值取自被检查的一侧 ⇒ 能力整体失效且门禁全绿
 *     ⇒ **已删除**；自证改用「权威期望按 --games 等比缩放」⇒ 仍是派生自规格的独立锚点）。
 *
 * @param {readonly string[]} argv 命令行参数。
 * @returns {{ report: string, games: number | null }}
 */
function parseArgs(argv) {
  const out = { report: resolve(ROOT, 'docs', 'balance-report.md'), games: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // ⚠️ 绝对路径原样使用；相对路径按**仓库根**解析（不按 cwd —— 见头注的根定位纪律）。
    if (a === '--report') { out.report = resolve(ROOT, String(argv[++i])); }
    else if (a === '--games') {
      const raw = Number(argv[++i]);
      if (!Number.isInteger(raw) || raw <= 0) {
        console.error('✗ --games 必须是**正整数**（收到：' + String(argv[i]) + '）');
        process.exit(1);
      }
      out.games = raw;
    } else {
      // ⚠️ 未知参数**必须报错**：静默忽略会让拼错的 flag（如 `--reportt`）回落到默认值，
      //   而「回落到默认值」在本门里等于「看起来正常」⇒ 掩盖误用。
      console.error('✗ 未知参数：' + a + '（可用：--report <路径> --games <正整数>）');
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// ⚠️ **文件名带 pid**：同一 checkout 内并发跑两次本门会互相覆盖 / 读到半写文件 ⇒ 可能的**假红**
//   （不是假绿，但同样会误导人）⇒ 每次用**独立**文件名。
const FRESH_REL = '.tmp/balance-report-fresh-' + String(process.pid) + '.md';
const FRESH = resolve(ROOT, FRESH_REL);

console.log('== 平衡报告入库一致性（门 ⑮）==');

// ⚠️ **自比护栏**（B94 盲审发现）：若 `--report` 指向本次重跑的产物 ⇒
//   expected 与 actual 是**同一份文件** ⇒ 必然相等 ⇒ **恒绿** ⇒ 比对面形同虚设。
//   ⇒ 显式拒绝「比对面 == 被比对象」。
if (args.report === FRESH) {
  console.error('✗ 比对面不能是本次重跑的产物（--report 指向了重跑输出）⇒ 会恒绿。');
  process.exit(1);
}

if (!existsSync(args.report)) {
  console.error('✗ 入库版平衡报告不存在：' + args.report);
  console.error('  （门 ⑮ 的比对面缺失 ⇒ 报告已漂移或被误删；恢复方式：'
    + 'node tests/sim/run.mjs --out docs/balance-report.md）');
  process.exit(1);
}

// ① 重跑：按报告的生成口径（**默认参数**）产出新版到临时文件。
mkdirSync(resolve(ROOT, '.tmp'), { recursive: true });
const simArgs = [resolve(ROOT, 'tests', 'sim', 'run.mjs'), '--out', FRESH_REL];
if (args.games !== null) { simArgs.push('--games', String(args.games)); }
const sim = spawnSync(process.execPath, simArgs, {
  encoding: 'utf8',
  shell: false,
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
});
if (sim.status !== 0) {
  console.error('✗ 平衡报告重跑失败（exit ' + String(sim.status) + '）：');
  console.error((sim.stdout ?? '') + '\n' + (sim.stderr ?? ''));
  process.exit(1);
}
if (!existsSync(FRESH)) {
  console.error('✗ 重跑未产出报告文件：' + FRESH);
  process.exit(1);
}

// ② 比对：入库版（只读） ↔ 新版（临时）。
const expected = readFileSync(args.report, 'utf8');
const actual = readFileSync(FRESH, 'utf8');
// ② 权威期望口径：从**规格 §9.2** 派生（主题数取实际主题包、档数取 engine/scales.ts）
//   ⇒ 独立于被比对的两侧 ⇒ 才防得住「改了 sim 默认参数并重生成报告 ⇒ 样本被静默缩小」。
let expectedScope = null;
try {
  const themeCount = readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(resolve(THEMES_DIR, e.name, 'theme.json')))
    .length;
  // ⚠️ 自证用小口径时，期望口径**按局数等比缩放**（仍派生自规格权威值 ⇒ 仍是独立锚点）。
  expectedScope = expectedSampleScope(readFileSync(SPEC, 'utf8'), themeCount, SCALES.length, args.games);
} catch (e) {
  console.error('✗ 无法派生权威样本口径（规格 §9.2）：' + String(e instanceof Error ? e.message : e));
  process.exit(1);
}
const result = checkBalanceReport(expected, actual, expectedScope);

// ②b **实际模拟量核对**（B94 第二轮复核 · EXP-G）：sim 进程 stdout 里的「合计 N 局」
//   是**实际跑出来的局数** ⇒ 不可由报告生成器伪造（报告里的口径行可以被人为改写）。
//   ⇒ 把「报告自称的口径」与「实际跑的局数」与「权威期望」三方对齐。
const actualTotal = parseActualTotalGames(sim.stdout ?? '');
if (actualTotal === null) {
  console.error('✗ 解析不到 sim 实际跑的局数（stdout 无「合计 N 局」）⇒ 口径无法核实 ⇒ 判红');
  console.error('  （这是**失败关闭**：宁可红，也不能在无法核实口径时放行）');
  process.exit(1);
}
if (actualTotal !== expectedScope.totalGames) {
  console.error('✗ **实际模拟量与权威期望不符**｜权威期望：' + String(expectedScope.totalGames)
    + ' 局｜sim 实际跑了：' + String(actualTotal) + ' 局');
  console.error('  期望值来源：' + expectedScope.source);
  console.error('  ⇒ 说明**模拟规模被缩小**（或期望值本身漂了）⇒ 平衡结论的精度不可信 ⇒ 判红');
  process.exit(1);
}

// ③ 收尾：临时产物清掉（不留工件在共享工作树）。
rmSync(FRESH, { force: true });

if (result.ok) {
  console.log('✓ 入库版与重跑版**逐字节一致**（容差 0，仅行尾归一化）· '
    + '入库 ' + String(result.expectedLines) + ' 行 / 重跑 ' + String(result.actualLines) + ' 行');
  console.log('  ⇒ 报告仍由当前引擎产生 ⇒ 无漂移（口径：每档 '
    + String(result.scopeExpected.gamesPerCell) + ' 局 / 合计 '
    + String(result.scopeExpected.totalGames) + ' 局｜权威期望：每档 '
    + String(expectedScope.gamesPerCell) + ' 局 / 合计 ' + String(expectedScope.totalGames) + ' 局）');
  process.exit(0);
}

if (result.scopeIssues.length > 0) {
  console.error('✗ **模拟口径不一致**（逐字节相等也可能发生：改了 sim 默认参数并重生成 ⇒ 样本被静默缩小）');
  for (const s of result.scopeIssues) { console.error('  ' + s); }
  console.error('');
}
console.error('✗ 平衡报告已漂移：入库版与当前引擎的重跑结果**不一致**（共 '
  + String(result.diffs.length) + ' 处差异）');
console.error('  比对面：' + args.report);
for (const d of result.diffs.slice(0, 20)) { console.error('  ' + d); }
if (result.diffs.length > 20) {
  console.error('  …… 另有 ' + String(result.diffs.length - 20) + ' 处差异未显示');
}
console.error('');
console.error('  含义：入库报告**已不再**由当前引擎产生（引擎演进后未重生成，E153）。');
console.error('  处置：若本次改动**确实**改变了平衡 ⇒ 重生成并与改动同批提交：');
console.error('    node tests/sim/run.mjs --out docs/balance-report.md');
console.error('  若**不该**变 ⇒ 改动引入了非预期行为，须先定位再重生成（**禁止**直接重生成掩盖）。');
process.exit(1);
