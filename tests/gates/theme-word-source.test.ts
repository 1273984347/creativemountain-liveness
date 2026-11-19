// B79 R1 / R2 / R7：句子层不许有主题词字面量（本批的**主守卫**）。
//
// 判据全部走 `tools/theme-word-scan.mjs`——正样本与负样本共用同一套实现（B51），
// 本文件只负责断言，不自带第二份扫描逻辑。
//
// 为什么主守卫是**反向**的（禁字面量）而不是「断言每句都用了 terms」：前者只有一条判据、
// 覆盖自动增长（新代码天然被扫），后者要为每个文案点写一条正面断言，漏一个点就漏一类 bug。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  leafWordsFromThemes, scanThemeWords, scanUnexpandedAlerts, scanFallbackWords, FALLBACK_BAN, listSources,
  SENTENCE_DOMAINS, SENTENCE_WHITELIST,
  TESTS_DOMAIN_EXEMPT_WORDS, identityWordsFromThemes, fullBanWords, pureLeafWords, TESTS_WORD_REGISTRY, testsWhitelist, scanAssertionForms,
} from '../../tools/theme-word-scan.mjs';
import { SENTENCE_LEAVES } from '../../tools/theme-diff-check.mjs';
import { TERM_TOKENS } from '../../engine/core/theme-text.ts';

const WORDS = leafWordsFromThemes();
/**
 * 主域（engine + web）禁字表 = 叶词 32 ∪ 身份名 26 = 58（B80 §3 R1/R1''）。
 *
 * R1 与它的全部负样本都用这张表；tests 域（R7）另用 `PURE`，两侧口径不同是**裁定**不是疏漏：
 * 测试标题写「仲裁者」是在说机制角色，源码写「仲裁者」是在替某一套主题说话。
 */
const FULL = fullBanWords();

test('R1 前提：禁字表从四套主题派生且非空转（32 词 = 八叶 × 四套，B80 §2.1 加三叶）', () => {
  assert.equal(WORDS.length, 32, `实际 ${String(WORDS.length)} 词：${WORDS.map((w) => w.word).join('/')}`);
  assert.equal(new Set(WORDS.map((w) => w.word)).size, WORDS.length,
    `禁字表有重复词：${WORDS.map((w) => w.word).join('/')} ⇒ 两套同词会让 R1 少扫一侧（B80 §3 R1 计数口径）`);
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

test('R1：engine/web 非注释行不含任何一套主题的叶词与身份名（58 词，B80 R1 收口）', () => {
  assert.deepEqual(
    scanThemeWords(resolve('.'), SENTENCE_DOMAINS, FULL, SENTENCE_WHITELIST), [],
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
  const hits = scanThemeWords(dir, ['engine'], FULL, SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `实际：${JSON.stringify(hits)}`);
  assert.match(hits[0] ?? '', /probe\.ts:1 「灵枢」 叶=resource 主题=xianxia2026/);
});

test('R1 负样本：整行注释不报（历史施工注记是证据，计数见规格 §2）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1c-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'), '// 扣 2 灵枢\n/* 关隘 */\n * 山道\nexport const x = 1;\n', 'utf8');
  assert.deepEqual(scanThemeWords(dir, ['engine'], FULL, SENTENCE_WHITELIST), []);
});

test('R1 负样本：尾随注释**不豁免**——把词交给玩家的是前半段代码', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1t-'));
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'web', 'probe.ts'), "export const s = '灵枢'; // 说明\n", 'utf8');
  const hits = scanThemeWords(dir, ['web'], FULL, SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `尾随注释被误豁免 ⇒ 实际：${JSON.stringify(hits)}`);
});

test('R7 负样本：白名单放行某文件某词 ⇒ 同一行不再被报（机制真在起作用）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r1w-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'), "export const x = '灵枢';\n", 'utf8');
  assert.equal(scanThemeWords(dir, ['engine'], FULL, new Map([['engine/probe.ts', ['灵枢']]])).length, 0);
  // 但只放行别的词不算数（防「文件级放行 = 整文件免检」的误解）
  assert.equal(scanThemeWords(dir, ['engine'], FULL, new Map([['engine/probe.ts', ['关隘']]])).length, 1);
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
  const hits = scanThemeWords(dir, ['engine'], FULL, SENTENCE_WHITELIST);
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

// ---------- B79 §2.3：四套共用报告的标签（T18）----------

test('B79 §2.3：平衡报告的被动标签不含任何主题叶词（一份表统四套，不许替所有主题作主张）', () => {
  // ⚠️ 计划写的是两条硬编码字符串对账（含旧串「偷灵枢」）。改成从禁字表派生有两处好处：
  //   ①旧词不再需要留在仓库里当负样本（它本身就是禁字）；②一次覆盖**七条**标签而不是改过的那一条。
  const src = readFileSync('tests/sim/run.mjs', 'utf8');
  const words = leafWordsFromThemes().map((w) => w.word);
  const labels = [...src.matchAll(/^\s{4}\w+:\s*'([^']+)',$/gm)].map((m) => m[1] ?? '');
  assert.ok(labels.length >= 7, `前提失败：PASSIVE_LABELS 只取到 ${String(labels.length)} 条 ⇒ 判据会空转`);
  const bad = labels.filter((l) => words.some((w) => l.includes(w)));
  assert.deepEqual(bad, [], `⇒ 报告是四套共用的一份表，标签写某套的词等于替所有主题作主张：${JSON.stringify(bad)}`);
  assert.ok(labels.some((l) => l.includes('偷资源')), '⇒ transfer_resource 应写成机制词「窃火者 · 偷资源」');
  // 反面账：`织梦者 · 改险径判定` 里的「险径」**不在**上面这 20 词里（它是 glossary 的未纳入键，
  // L-B79-4）。本判据只管叶词，留着「险径」不是漏网而是**已登记的边界**——扩到它需要 {hazard}。
});

// ---------- B79 §2.4：兜底词黑名单（禁字表定义范围之外的另一张网）----------

test('§2.4 兜底词：engine/web 非注释行不得出现「体力」一类的第三套词', () => {
  assert.deepEqual(scanFallbackWords(resolve('.'), SENTENCE_DOMAINS), [],
    '⇒ 「体力」不是任何一套的 hp 词（灵力/气血/机体完整度/精神值），它是 termsOf 兜底词的孪生兄弟');
});

test('§2.4 表的自洽：FALLBACK_BAN 里每个词都必须在真实树上已经清零（否则守卫上线即红会被顺手注释）', () => {
  assert.deepEqual(FALLBACK_BAN, ['体力', '峰顶'],
    '入表规则见 tools/theme-word-scan.mjs 的注释：只收已清零的词（「峰顶」r1.6 接线后入表）');
  for (const w of FALLBACK_BAN) {
    assert.deepEqual(scanFallbackWords(resolve('.'), SENTENCE_DOMAINS, [w]), [],
      `「${w}」还在表内却有命中 ⇒ 要么接线、要么把它移出黑名单，不许留着让守卫自红`);
  }
  // 反面账：未接线的表外词必须**在规格 §2.4 里有名有数**，不能既不在禁字表也不在册上
  const spec = readFileSync('docs/superpowers/specs/2026-11-16-b79-句子层主题词接线-design.md', 'utf8');
  for (const w of ['峰顶', '裂隙', '险径', '牌库']) {
    assert.ok(spec.includes(w), `§2.4 表外清单缺「${w}」⇒ 盲区必须写清，否则「R1 已 0 命中」会被读成全部清完`);
  }
});

test('§2.4 负样本：把「体力」塞回引擎副本 ⇒ 必须被报出（证明这张网有牙齿）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-fb-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  // 码点在**测试里**求值后拼进字符串（T13 的教训：把 `String.fromCharCode(...)` 当源码文本写进
  // 文件，注入根本没落地，而「没注入」与「守卫没牙齿」在结果上完全同形）
  const FALLBACK = String.fromCharCode(20307) + String.fromCharCode(21147);
  const probe = `export const heal = '恢复 3 点${FALLBACK}';\n`;
  writeFileSync(join(dir, 'engine', 'probe.ts'), probe, 'utf8');
  assert.ok(readFileSync(join(dir, 'engine', 'probe.ts'), 'utf8').includes(FALLBACK), '前提失败：注入没落地');
  const hits = scanFallbackWords(dir, ['engine'], [FALLBACK]);
  assert.equal(hits.length, 1, `实际：${JSON.stringify(hits)}`);
  assert.match(hits[0] ?? '', /probe\.ts:1/);
});

// ---------- B79 §5 R5 / §5.2 R7（r1.7 常驻）：断言形式统一 + tests 域数据类登记 ----------
//
// R7 为什么在 r1.7 从「暂不常驻」升上来（用户裁定）：登记表本身就是这批的交付物之一，
//   写完不判红 = 一张会随时间漂坏的说明书。升上来的前提是**把机制名同形词摘出去**——
//   实测 tests/ 域 20 词全扫是 209 处 / 35 文件，其中「关隘 + 山道」占 103 处（§5.1.1 明令保留）。
//   把一条域级裁定摊成 35 行文件级豁免，只会让登记表盖住真正要登记的 16 个数据类保留处。

const PURE = pureLeafWords();
const BASE_PURE = PURE.filter((w) => w.themes.includes('xianxia2026')).map((w) => w.word);

test('R7 前提：tests 域禁字表 = 全表 − 机制名同形词，且豁免只声明一次', () => {
  assert.deepEqual([...TESTS_DOMAIN_EXEMPT_WORDS].sort(), ['关隘', '山道', '裂隙', '险径'],
    '⇒ 这四词在本仓同时是机制名（主规格 §3.4/§3.5 的通道格与地形类名；`rules-book-contract.mjs` 的 `specName`）。'
    + '裂隙/险径 由 B80 §3 R1 归入 tests 域豁免——主域照旧禁（R1 扫全表，不走这里）。'
    + '要再动这张表先改规格并写理由');
  assert.equal(PURE.length, WORDS.length - TESTS_DOMAIN_EXEMPT_WORDS.length,
    `减词数不对：全表 ${String(WORDS.length)} − 同形 ${String(TESTS_DOMAIN_EXEMPT_WORDS.length)} ≠ ${String(PURE.length)}`);
  // 同形词必须**确实**在禁字表里（否则上面那个减法是在减不存在的东西，登记表也就少了一类真正的例外）
  for (const w of TESTS_DOMAIN_EXEMPT_WORDS) {
    assert.ok(WORDS.some((x) => x.word === w), `「${w}」不在叶词并集里 ⇒ 豁免了个空气`);
  }
});

test('R7：tests 域未登记的主题词字面量为 0（数据类保留处逐文件登记）', () => {
  assert.deepEqual(scanThemeWords(resolve('.'), ['tests'], PURE, testsWhitelist()), [],
    '⇒ 要么中性化，要么在 tools/theme-word-scan.mjs 的 TESTS_WORD_REGISTRY 加一行并写理由（§5.2）');
});

test('R7 结构①：登记表行集合 ≡ 实际有命中的文件集合（新文件没登记 ⇒ 红；清零还留着 ⇒ 红）', () => {
  const found = [...new Set(scanThemeWords(resolve('.'), ['tests'], PURE, new Map()).map((h) => h.split(':')[0]))].sort();
  assert.deepEqual(found, [...TESTS_WORD_REGISTRY.map((r) => r.file)].sort(),
    '⇒ 左多 = 有泄漏没登记；左少 = 条目已死（该删，留着就是下一次「顺手放行」的模板）');
});

test('R7 结构②：逐行核对——条目必须是真文件、必须有理由、词值集合不许漂', () => {
  const byFile = new Map<string, Set<string>>();
  for (const h of scanThemeWords(resolve('.'), ['tests'], PURE, new Map())) {
    const f = h.split(':')[0] ?? '';
    const w = /「(.*?)」/.exec(h)?.[1] ?? '';
    if (!byFile.has(f)) { byFile.set(f, new Set()); }
    byFile.get(f)?.add(w);
  }
  for (const r of TESTS_WORD_REGISTRY) {
    const abs = resolve(r.file);
    assert.ok(existsSync(abs) && statSync(abs).isFile(), `${r.file} ⇒ 条目必须是文件级，不许目录、子树或通配（§5.2 粒度定案）`);
    assert.ok(r.reason.trim().length >= 12, `${r.file} 的理由太短（${r.reason}）：没有理由的条目等于没有条目`);
    const found = [...(byFile.get(r.file) ?? new Set<string>())].sort();
    assert.deepEqual(found, [...r.words].sort(),
      `${r.file}：登记的词与实际命中的词不一致（左多 = 漏登记，左少 = 死词值）`);
  }
});

test('R7 负样本：新文件冒出主题词 ⇒ 红；登记后放行；只登记别的词不算放行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r7-'));
  mkdirSync(join(dir, 'tests', 'engine'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'engine', 'probe.ts'), "export const s = '灵枢不足';\n", 'utf8');
  assert.equal(scanThemeWords(dir, ['tests'], PURE, testsWhitelist()).length, 1,
    '⇒ 登记表里没有这个新文件，必须红（放行表是逐文件的，不是「tests 域免检」）');
  assert.equal(scanThemeWords(dir, ['tests'], PURE, testsWhitelist(
    [{ file: 'tests/engine/probe.ts', words: ['灵枢'], reason: '探针条目' }])).length, 0,
    '⇒ 登记「文件 + 该词」之后才放行');
  assert.equal(scanThemeWords(dir, ['tests'], PURE, testsWhitelist(
    [{ file: 'tests/engine/probe.ts', words: ['气血'], reason: '探针条目' }])).length, 1,
    '⇒ 同文件里登记另一个词不构成放行：粒度是「文件 × 词值集合」，不是整文件免检');
});

test('R5：直接断言引擎结果的语句，期望值里不得出现主题词（两套写法不许混用）', () => {
  const r = scanAssertionForms(resolve('.'), 'tests', PURE, BASE_PURE);
  assert.deepEqual(r.offenders, [],
    '⇒ 引擎交出的是占位符形态，断言就该写 /\\{resource\\}不足/；要测玩家看到的句子请显式走展开出口（§5.1）');
  // 防空转：判据得真的读到引擎结果断言，否则「0 违规」只是没看见任何东西
  assert.ok(r.statements >= 8, `认定的引擎结果断言语句只有 ${String(r.statements)} 条（今天 10 条）⇒ 判据瞎了`);
  // §5.1 的另一半：基准主题的**展开后**断言必须还在（不许顺手把「灵枢」改成 {resource}）
  assert.ok(r.baseExpanded >= 2,
    `基准展开断言只剩 ${String(r.baseExpanded)} 条（今天 2 条：expand-theme-words 的期望串 + log-instruction 的「—— 灵枢 +1」）`
    + '⇒ 把它们改成占位符形式就等于没人再测展开结果（Q3 乙被做成 Q3 甲）');
});

test('R5 负样本：五种形状各判一次——违规要红、三种合规不许误伤、折行也要抓到', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b79-r5-'));
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'probe.ts'), [
    "assert.match(String(r.note), /灵枢不足/);",                                  // 1 违规：拿引擎原文案当判据
    "assert.match(String(r.note), /\\{resource\\}不足/);",                         // 2 合规：占位符形态
    "assert.match(logLineText(entry, terms), /灵枢不足/);",                        // 3 合规：显式走展开出口
    "assert.equal(win.passed, true, '红牌胜出 ⇒ 通过灵枢');",                      // 4 合规：消息串不是期望值
    "assert.match(",                                                              // 5 违规：折行，续行里的期望值
    "  String(r.note),",
    "  /关隘标价 3 灵枢/,",
    ");",
  ].join('\n') + '\n', 'utf8');
  const r = scanAssertionForms(dir, 'tests', PURE, BASE_PURE);
  assert.equal(r.offenders.length, 2, `应恰好报第 1、5 条：${JSON.stringify(r.offenders)}`);
  assert.match(r.offenders[0] ?? '', /probe\.ts:1 /, `第 1 条位置不对：${String(r.offenders[0])}`);
  assert.match(r.offenders[1] ?? '', /probe\.ts:5 /, `折行那条没被抓到 ⇒ 行级判据，漏一类 = 那一类永久残留`);
  // ③ 那条同时喂了 baseExpanded 的哨：合规形状必须真的被认成「经出口的展开项」
  assert.equal(r.baseExpanded, 1, `baseExpanded=${String(r.baseExpanded)} ⇒ 下限哨读不到展开出口的形状，R5 的另一半就是空判据`);
});

// ---------- B80 R1''（身份名入主域禁字表）与 R1'（豁免表改名 + 只管 tests 域） ----------
//
// 为什么要 58 这个词表：T3 接完线后，引擎里再出现「守夜人」就是回归，而它**不在叶词表里**——
// R1 只看得到 terms 的取值。身份名从 `themes/*/theme.json` 的 `identities[].name` 派生，
// 手抄的表在第五套主题进来那天失效（规格 §3 R1''）。

test('B80 R1\'\'：主域禁字表 = 叶词 32 ∪ 身份名 26 = 58（派生，去重）', () => {
  const ids = identityWordsFromThemes();
  assert.equal(ids.length, 26, `身份名去重后应 26（四套 × 8 = 32，同名 6 处），实际 ${String(ids.length)}`);
  const full = fullBanWords();
  const uniq = new Set(full.map((w) => w.word));
  assert.equal(uniq.size, 58, `主域禁字表去重应 58 词，实际 ${String(uniq.size)}（表长 ${String(full.length)}）`);
  assert.equal(full.length, uniq.size, '⇒ 表里有重复条目：并集没做掉，扫描会重复计数');
  assert.equal(full.filter((w) => w.leaf === 'identity').length, 26, '身份名条目应 26 条');
  // 同形冲突 = 0（规格 §3 R1'' 实测）：若有，说明机制名与身份名撞了，得改措辞而不是改表
  for (const w of full.filter((x) => x.leaf === 'identity')) {
    assert.equal(WORDS.some((x) => x.word === w.word), false,
      `「${w.word}」既是身份名又是某套叶词 ⇒ 主域禁字表口径要先在规格里裁定`);
  }
});

test('B80 R1\'\'：往引擎塞一句硬写身份名 ⇒ 必须红（子串匹配，不给"词组豁免"留门）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b80-id-'));
  mkdirSync(join(dir, 'engine'), { recursive: true });
  writeFileSync(join(dir, 'engine', 'probe.ts'),
    "export const m = '守夜人：回合结束获得 1 点护盾';\n", 'utf8');
  const hits = scanThemeWords(dir, ['engine'], fullBanWords(), SENTENCE_WHITELIST);
  assert.equal(hits.length, 1, `注入不可见就等于没测（E136 同族）：${JSON.stringify(hits)}`);
  assert.match(hits[0] ?? '', /engine\/probe\.ts:1 「守夜人」/);
});

test('B80 R1\'：豁免只在 tests 域生效——主域照判「裂隙」，且身份名不进 tests 域豁免', () => {
  assert.deepEqual([...TESTS_DOMAIN_EXEMPT_WORDS].sort(), ['关隘', '山道', '裂隙', '险径'],
    '⇒ 这四词同时是主规格 §3.4/§3.5 的机制名。改名（原 MECHANISM_HOMOGRAPHS）本身也是判据的一部分：'
    + '语义从"全域豁免"窄成"仅 tests 域"，旧名继续挂着就是 E135/E136 的同款');
  assert.ok(fullBanWords().some((w) => w.word === '裂隙'),
    '⇒ 主域禁字表**含**裂隙（豁免不含它）——这是 R1 与 R1\' 的分工线');
  assert.equal(PURE.some((w) => w.word === '守夜人'), false,
    '⇒ tests 域的表仍是叶词口径：测试标题写身份名不红（规格 §3 R1\'\' 作用域），别顺手把 58 词喂给 R7');
});
