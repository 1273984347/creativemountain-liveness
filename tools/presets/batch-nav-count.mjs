// 批次导航的**一致性复算入口**（B80 T8 新增）：`docs/沉淀/批次导航.md` 里的
// 「分类总览」计数 vs 各分类小节里实际行数 vs 目录里真实存在的记录文件，三者必须互洽。
//
// ⚠️ **单位定死在"一个档案文件 = 一行"**（不是"批号"）。这个单位不写死就会各算各的：
//   B80 T8 首跑实测四个数互不相等——小节行数 72 / 目录文件 78 / 批号去重 74（B18 与 B19 各占
//   三份记录），而「分类总览」的合计写 76：76 既不是行数也不是文件数，是一个没有定义的单位。
//   同一批号可以占多行（一份记录一行），所以只有"行 ≡ 文件"是机械可判的，本脚本据此检查。
//
// 为什么要这么查而不是"按关键词重跑分类"：分类规则（文件名标题关键词、跨类归首要一类）
// 是**人判**的，重跑一遍等于再猜一次；而"总览说 30、小节里只有 29 行"这种是机械事实。
// 加一个新批次时的正确动作是：先在小节里加行 → 跑这个脚本 → 它告诉你哪几个数该动。
//
// 跑法：node tools/presets/batch-nav-count.mjs     （只读；有偏差时 exit=1）
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { at, relOf } from './common.mjs';

const NAV = 'docs/沉淀/批次导航.md';
const src = readFileSync(at(NAV), 'utf8').split('\n');

/**
 * 一行的批号可以是 `B18`、`B18-b`、`B15–B16`（en dash 的合并档案）——
 * ⚠️ 本脚本第一版的正则只认 `B数字`，把 `B18-b` / `B15–B16` 这些行整行漏掉，
 *   于是同时造出两个假象：行数少算（72 vs 真实 78）+ "6 个文件没登记"（其实都登记了）。
 *   这正是本批一路在抓的"探针与事实不同尺"（#12 / #21 / #27 同族）——**先证明尺对，再谈漂移**。
 */
const ROW_ID = /^\|\s*(B\d[\d.]*(?:[-–]\d*[a-zA-Z][\d.]*|[-–]B?\d[\d.]*)*)\s*\|/;
/** `## 机制与规则（30）` ⇒ {name, declared, rows[]}。行 = 一个档案文件（单位在这里定死，见文件头）。 */
const sections = [];
let cur = null;
for (const l of src) {
  const h = /^## (.+?)（(\d+)）\s*$/.exec(l);
  if (h !== null) { cur = { name: h[1], declared: Number(h[2]), rows: [] }; sections.push(cur); continue; }
  if (/^## /.test(l)) { cur = null; continue; }
  const r = ROW_ID.exec(l);
  if (cur !== null && r !== null) {
    const file = /\]\(([^)]+)\)/.exec(l)?.[1] ?? '';
    cur.rows.push({ id: r[1], file });
  }
}

/** `## 分类总览` 表里的声明数（含合计行）。 */
const overview = new Map();
let inOverview = false;
for (const l of src) {
  if (/^## 分类总览/.test(l)) { inOverview = true; continue; }
  if (/^## /.test(l)) { inOverview = false; continue; }
  if (!inOverview) continue;
  const m = /^\|\s*\**(.+?)\**\s*\|\s*\**(\d+)\**\s*\|/.exec(l);
  if (m !== null && m[1] !== '分类') overview.set(m[1], Number(m[2]));
}

const problems = [];
console.log('分类                     总览  小节声明  实际行数  差');
for (const s of sections) {
  const ov = overview.get(s.name);
  const flag = [];
  if (ov !== s.declared) flag.push('总览≠小节标题');
  if (s.declared !== s.rows.length) flag.push('小节标题≠实际行数');
  if (flag.length > 0) problems.push(`${s.name}：${flag.join('、')}（总览 ${String(ov)} / 标题 ${String(s.declared)} / 实数 ${String(s.rows.length)}）`);
  console.log(`${s.name.padEnd(22)} ${String(ov).padStart(4)}  ${String(s.declared).padStart(8)}  ${String(s.rows.length).padStart(8)}  ${flag.length === 0 ? '✓' : '✗ ' + flag.join('/')}`);
}

const sumDeclared = sections.reduce((a, s) => a + s.declared, 0);
const sumRows = sections.reduce((a, s) => a + s.rows.length, 0);
const total = overview.get('合计');
console.log(`${'合计'.padEnd(22)} ${String(total).padStart(4)}  ${String(sumDeclared).padStart(8)}  ${String(sumRows).padStart(8)}`);
if (total !== sumDeclared) problems.push(`总览「合计」${String(total)} ≠ 各小节声明之和 ${String(sumDeclared)}`);
if (sumDeclared !== sumRows) problems.push(`各小节声明之和 ${String(sumDeclared)} ≠ 实际行数 ${String(sumRows)}`);

// 目录里的档案文件 vs 导航里登记的链接（单位 = 文件，见文件头）
const rowsAll = sections.flatMap((s) => s.rows);
const listed = new Set(rowsAll.map((r) => r.file));
const onDisk = readdirSync(at('docs', '批次')).filter((f) => f.endsWith('.md')).sort();
const missing = onDisk.filter((f) => !listed.has(f));
if (missing.length > 0) problems.push(`目录里有、导航里没有：${missing.length} 个文件 ⇒ ${missing.slice(0, 6).join(' ')}${missing.length > 6 ? ' …' : ''}`);
const dead = [...listed].filter((f) => f.length > 0 && !onDisk.includes(f));
if (dead.length > 0) problems.push(`导航链到不存在的文件：${dead.join(' ')}`);
const noLink = rowsAll.filter((r) => r.file.length === 0).length;
if (noLink > 0) problems.push(`${String(noLink)} 行没有链接（单位是文件，没链接的行无法核对）`);
const dupRef = rowsAll.length - listed.size;
if (dupRef > 0) problems.push(`同一文件被登记 ${String(dupRef)} 次`);
console.log(`\ndocs/批次/*.md 文件数 = ${String(onDisk.length)} · 导航行数 = ${String(rowsAll.length)} · 链接去重 = ${String(listed.size)}`);

if (problems.length > 0) {
  console.log('\n✗ 需要修（改**行数**，别顺手改总数）：');
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('\n✓ 总览 / 小节标题 / 实际行数 / 目录文件 四者互洽');
