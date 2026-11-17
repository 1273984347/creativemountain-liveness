// B79 R1 / R2 / R7：句子层不许有主题词字面量（本批的**主守卫**）。
//
// 判据全部走 `tools/theme-word-scan.mjs`——正样本与负样本共用同一套实现（B51），
// 本文件只负责断言，不自带第二份扫描逻辑。
//
// 为什么主守卫是**反向**的（禁字面量）而不是「断言每句都用了 terms」：前者只有一条判据、
// 覆盖自动增长（新代码天然被扫），后者要为每个文案点写一条正面断言，漏一个点就漏一类 bug。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  leafWordsFromThemes, scanThemeWords, scanUnexpandedAlerts, listSources,
  SENTENCE_DOMAINS, SENTENCE_WHITELIST,
} from '../../tools/theme-word-scan.mjs';
import { SENTENCE_LEAVES } from '../../tools/theme-diff-check.mjs';
import { TERM_TOKENS } from '../../engine/core/theme-text.ts';

const WORDS = leafWordsFromThemes();

test('R1 前提：禁字表从四套主题派生且非空转（20 词 = 五叶 × 四套，今天全不同）', () => {
  assert.equal(WORDS.length, 20, `实际 ${String(WORDS.length)} 词：${WORDS.map((w) => w.word).join('/')}`);
  assert.deepEqual(SENTENCE_LEAVES, [...TERM_TOKENS], '前提：叶清单与展开器同源');
  // 每个叶都真的贡献了四个不同词 ⇒ 少一套主题或空转一个叶，这里就会短
  for (const leaf of SENTENCE_LEAVES) {
    assert.equal(WORDS.filter((w) => w.leaf === leaf).length, 4, `${leaf} 只有 ${String(WORDS.filter((w) => w.leaf === leaf).length)} 词`);
  }
});

test('R1 前提：扫描域是 engine + web，且**不含** build（规格 §5.4）', () => {
  assert.deepEqual([...SENTENCE_DOMAINS].sort(), ['engine', 'web']);
  assert.equal(listSources(resolve('engine')).length >= 20, true, '前提：引擎侧确实扫到文件（空目录会让 R1 恒绿）');
  assert.equal(listSources(resolve('web')).length >= 8, true, '前提：界面侧确实扫到文件');
});

test('R1：engine/web 非注释行不含任何一套主题的五个叶词', () => {
  assert.deepEqual(
    scanThemeWords(resolve('.'), SENTENCE_DOMAINS, WORDS, SENTENCE_WHITELIST), [],
    '⇒ 改用 {resource} 等占位符，由显示出口展开（B79 §4.1/§4.3）');
});

test('R2：alert 参数不得直投占位符字面量（定位辅助，见规格 §5 R2）', () => {
  assert.deepEqual(scanUnexpandedAlerts(resolve('.')), []);
});

test('R7：R1 域的白名单是空集——它不是逃生摇板', () => {
  assert.equal(SENTENCE_WHITELIST.size, 0,
    '规格 §5.2 定的是 engine+web 域必须清空；要加条目先改规格并写明理由，再改这里');
  // deck 词不得混进禁字表（同形词「指令」，规格 §4.4）
  assert.deepEqual(WORDS.filter((w) => ['符箓', '道箓', '指令', '异能牌'].includes(w.word)), [],
    '禁字表里出现了 deck 词 ⇒ 会把规则词「第 N 条指令」「问天指令骰」一起判红');
});

// ---------- 负样本：证明 R1 有牙齿，而不是「见谁都通过」----------

test('R1 负样本：往临时副本塞一行主题词 ⇒ 扫描必须报出它', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'), "export const x = '灵枢不足';\n", 'utf8');
  const hits = scanThemeWords(dir, ['engine'], WORDS, SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `实际：${JSON.stringify(hits)}`);
  assert.match(hits[0] ?? '', /probe\.ts:1 「灵枢」 叶=resource 主题=xianxia2026/);
});

test('R1 负样本：整行注释不报（历史施工注记是证据，规格 §2 的 214 行）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1c-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'), '// 扣 2 灵枢\n/* 关隘 */\n * 山道\nexport const x = 1;\n', 'utf8');
  assert.deepEqual(scanThemeWords(dir, ['engine'], WORDS, SENTENCE_WHITELIST), []);
});

test('R1 负样本：尾随注释**不豁免**——把词交给玩家的是前半段代码', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1t-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web', 'probe.ts'), "export const s = '灵枢'; // 说明\n", 'utf8');
  const hits = scanThemeWords(dir, ['web'], WORDS, SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `尾随注释被误豁免 ⇒ 实际：${JSON.stringify(hits)}`);
});

test('R7 负样本：白名单放行某文件某词 ⇒ 同一行不再被报（机制真在起作用）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1w-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'), "export const x = '灵枢';\n", 'utf8');
  assert.equal(scanThemeWords(dir, ['engine'], WORDS, new Map([['engine/probe.ts', ['灵枢']]])).length, 0);
  // 但只放行别的词不算数（防「文件级放行 = 整文件免检」的误解）
  assert.equal(scanThemeWords(dir, ['engine'], WORDS, new Map([['engine/probe.ts', ['关隘']]])).length, 1);
});

test('R1 真实树变异：往 engine 全树副本注入一行 ⇒ 必须恰好报出那一行（注入不可见就等于没测）', () => {
  // 为什么单独立一条、且写成这个样子：
  //   T13 现场连着两次得到「0 命中」——第一次是 shell 探针把中文转义吃掉，第二次这里用
  //   `String.fromCharCode` 拼字（28467 是「漳」不是「灵」）。两次**扫描器都是对的**，
  //   错的是注入；而「注入空跑」与「守卫没牙齿」在结果上完全同形，后者还会给出更让人放心的答案。
  // ⇒ 注入词必须**从禁字表里取**（同源），并断言注入行确实含该词：这样拼错字会红在前提上，
  //   而不是红在“守卫无能”的误判上。
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1-tree-'));
  cpSync(resolve('engine'), join(dir, 'engine'), { recursive: true });
  const target = join(dir, 'engine', 'core', 'gate.ts');

  const leakWord = WORDS.find((w) => w.leaf === 'resource')?.word ?? '';
  assert.ok(leakWord.length > 0, '前提失败：禁字表里没有 resource 叶的词');
  const leakLine = `export const b79Leak = '${leakWord}不足';`;
  appendFileSync(target, `\n${leakLine}\n`, 'utf8');

  // ① 注入可见性 + 注入内容确实是禁字表里的词（回读证明，不信任 appendFileSync 没抛错）
  const lines = readFileSync(target, 'utf8').split('\n');
  const at = lines.indexOf(leakLine);
  assert.ok(at >= 0, `前提失败：注入行没进文件 ⇒ 后续判定是空转（尾部：${JSON.stringify(lines.slice(-2))}）`);
  assert.ok(leakLine.includes(leakWord), '前提失败：注入行不含禁字表词 ⇒ 这条样本没在测任何东西');

  // ② 命中必须恰好是注入那一行（行号 = 文件里的真实行号）
  const hits = scanThemeWords(dir, ['engine'], WORDS, SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `实际：${JSON.stringify(hits)}`);
  assert.match(hits[0] ?? '', /engine\/core\/gate\.ts:/, '命中位置不对 ⇒ 扫的不是注入的那个文件');
  assert.equal(/:(\d+)\s/.exec(hits[0] ?? '')?.[1], String(at + 1), '行号应指向注入行');
});

test('R2 负样本：alert 直投占位符必报；合规的 alert(t(…)) 与混排都不误伤', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r2-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web', 'probe.ts'),
    "alert('{resource}不足');\nalert(t('{resource}不足'));\nalert('前缀' + t('{gate}'));\nalert('本地文案');\n", 'utf8');
  const hits = scanUnexpandedAlerts(dir);
  assert.deepEqual(hits.map((h) => /:(\d+)\s/.exec(h)?.[1]), ['1'],
    `只该报第 1 行（直投），实际：${JSON.stringify(hits)}`);
});
