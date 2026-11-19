// 句子层主题词的字面量归属扫描（B79 §5 R1 / R2）。
//
// 为什么抽成模块而不是写在测试文件里（B51 教训）：扫描逻辑住测试里 ⇒ 负样本只能另写一份
//   近似实现 ⇒ 测的是负样本自己，不是被测代码。正样本与负样本必须共用同一个函数。
//
// 为什么不用 tests/gates/repo-scan.ts：它的匹配器硬编码那两个自检入口令牌（见其 :23），
//   且 ALLOWED_ROOTS 只放行 tests/ 与 docs/批次/ ⇒ 拿它扫 engine/web 会扫到 0 个文件。
//
// 禁字表**从主题数据派生**，不手抄 ⇒ 第五套主题一进来自动纳入（手抄的那份会在加主题那天
//   变成「守着一份过期名单继续判绿」的空守卫，与 B78 R6 同族）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SENTENCE_LEAVES } from './theme-diff-check.mjs';

/** R1 的扫描域（规格 §5.4）：只有引擎与界面。`build/**` 是印刷层，取词归门⑤⑥⑦ 管。 */
export const SENTENCE_DOMAINS = ['engine', 'web'];

/**
 * 禁字表：四套（或任意套）`theme.json` 的 `terms.{五个句子层叶}` 取值并集。
 *
 * ⚠️ 不含 `deck`：`scifi-ai.terms.deck` 是「指令」，与四套共用的规则词
 *   「问天指令骰 / 第 N 条指令」同形（规格 §4.4）⇒ 收进来会把合规实现判红。
 * @returns `{ word, leaf, themes[] }`，按词排序（稳定输出，便于 diff 与断言）。
 */
export function leafWordsFromThemes(root = 'themes') {
  const words = new Map();
  for (const entry of readdirSync(resolve(root))) {
    let terms;
    try {
      terms = JSON.parse(readFileSync(resolve(root, entry, 'theme.json'), 'utf8')).terms;
    } catch { continue; }                                     // 非主题目录（无 theme.json）跳过
    if (typeof terms !== 'object' || terms === null) { continue; }
    for (const leaf of SENTENCE_LEAVES) {
      const v = terms[leaf];
      if (typeof v !== 'string' || v.length === 0) { continue; }
      if (!words.has(v)) { words.set(v, { word: v, leaf, themes: [] }); }
      words.get(v).themes.push(entry);
    }
  }
  return [...words.values()].sort((a, b) => a.word.localeCompare(b.word));
}

const SOURCE_EXT = /\.(ts|tsx|mjs|mts)$/;

/** 递归收集源文件（跳过目录符号链接等不可读者由调用方保证——本仓 engine/web 下没有）。 */
export function listSources(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...listSources(p)); }
    else if (SOURCE_EXT.test(e)) { out.push(p); }
  }
  return out;
}

/**
 * 注释行不算命中：本批只管**文案的来源**，历史施工注记是证据（规格 §2 实测 214 行）。
 *
 * ⚠️ 只豁免**整行**注释——`const s = '灵枢'; // 说明` 这种尾随注释仍算命中，因为真正
 *   把词交给玩家的是前半段的代码。实测本仓 engine/web 目前零尾随命中（T12 收口时量过）。
 */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('·');
}

/**
 * 扫 `domains` 下的主题词字面量。
 *
 * @param {string} root       仓库根
 * @param {string[]} domains  相对根目录的域（如 ['engine','web']）
 * @param {Array<{word:string,leaf:string,themes:string[]}>} words 禁字表
 * @param {Map<string,string[]>} whitelist 文件级放行表：`相对路径 -> 允许的词值清单`
 * @returns {string[]} 命中清单 `相对路径:行号 「词」 叶=leaf 主题=a,b`
 */
export function scanThemeWords(root, domains, words, whitelist) {
  const hits = [];
  const allowed = whitelist ?? new Map();
  const base = resolve(root);
  for (const domain of domains) {
    for (const f of listSources(resolve(base, domain))) {
      const rel = f.slice(base.length + 1).split('\\').join('/');
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (isComment(line)) { return; }
        for (const w of words) {
          if (!line.includes(w.word)) { continue; }
          if ((allowed.get(rel) ?? []).includes(w.word)) { continue; }
          hits.push(`${rel}:${String(i + 1)} 「${w.word}」 叶=${w.leaf} 主题=${w.themes.join(',')}`);
        }
      });
    }
  }
  return hits;
}

/**
 * R1 域的白名单：**必须恒为空集**（规格 §5.2）。
 *
 * 加条目的正确顺序是「先改规格并写明理由，再改这里」——反过来做就等于给 R1 装了个逃生摇板。
 * `tests/**` 的数据类保留处由 `tests/gates/theme-word-source.test.ts` 的 R7 那张**独立**清单
 * 逐文件登记，不共用本表（共用就会让「R1 域必须空」这条判据失去意义）。
 */
export const SENTENCE_WHITELIST = new Map();

/**
 * 机制名同形词（规格 §5.1.1 甲′ 第二行）：**同时是机制名**的主题词取值。
 *
 * 主规格 §3.4/§3.5 与代码注释一直用「关隘」「山道」指代 `kind:'gate'` 的通道格与其路径；
 * 「裂隙」「险径」同理——它们是 §3.4 的**地形类名**（`tools/rules-book-contract.mjs` 的
 * `specName: '裂隙' / '险径'`，doc-sync C10 按五类地形逐条核对），测试与工具里说这两个词是在说机制。
 * 改测试措辞而不改主规格 ⇒ 两边分叉、doc-sync 链跟着动；改主规格 ⇒ 超出零行为批次范围 ⇒ 保留。
 *
 * ⚠️ **只管 tests 域**：主域（`engine/**`+`web/**`）的 R1 扫的是 `leafWordsFromThemes()` 全表，
 *   不经过这里 ⇒ 裂隙/险径 在源码里照样红（B80 §3 R1「不再在主域豁免」说的就是这个分工）。
 * ⚠️ 域级豁免**只在这里声明一次**，不摊进各文件的白名单条目：摊进去就会让人以为「关隘」在某处
 *   是例外，而它全域都合法——一张 35 行、18 行理由相同的表只会盖住真正的数据类保留处（T16 实测）。
 */
export const MECHANISM_HOMOGRAPHS = ['关隘', '山道', '裂隙', '险径'];

/** R7 在 `tests` 域用的禁字表 = 叶词并集 − 机制名同形词（规格 §5.2 r1.7）。 */
export function pureLeafWords(root) {
  return leafWordsFromThemes(root).filter((w) => !MECHANISM_HOMOGRAPHS.includes(w.word));
}

/**
 * R7 数据类保留处（规格 §5.2 r1.7）：**一条 = 一个文件 + 允许出现的词值 + 一行理由**。
 *
 * 为什么住在工具模块而不是测试文件里：这张表是**判据的数据本体**（和 `FALLBACK_BAN`、
 * `MECHANISM_HOMOGRAPHS` 同一类），测试负责断言它审计得起来。放测试里还会自相矛盾——
 * 表里要逐字写出「灵枢 / 算力 / 异能点」才能放行，写表这个动作本身就成了被测域里的主题词字面量。
 *
 * 三条常驻判据由 `tests/gates/theme-word-source.test.ts` 执行：
 *   ① 有命中的文件集合 ≡ 本表行集合（新增文件没登记 ⇒ 红；删干净了还留着 ⇒ 红）；
 *   ② 每行的词值集合 ≡ 该文件实际命中的词值集合（同文件里冒出第二个词 ⇒ 红）；
 *   ③ 每行必须带一行理由（≥ 12 字），没有理由的条目等于没有条目。
 *
 * ⚠️ 粒度是**文件级**（§5.2 定案）：不是「词 × 行号」，也不许按目录整片放行。
 */
export const TESTS_WORD_REGISTRY = [
  { file: 'tests/gates/log-exit-expand.test.ts', words: ['安全闸', '算力', '封锁线', '异能点', '街区', '天台', '灵力', '灵枢'],
    reason: '日志出口展开后的整句期望（四套各一条）：句子就是被测对象的渲染结果，§5.1 第二类' },
  { file: 'tests/build/expand-theme-words.test.ts',
    words: ['封顶台', '灵力', '灵枢', '灵能', '算力', '异能点', '安全闸',
      // B80 §2.1：三新叶的四套展开期望串（同一判据形状，只是叶从五张扩到八张）
      '修士', '行道者', '行动者', '异能者', '崩口', '险坡', '数据断层', '故障区', '断桥', '危险区'],
    reason: '展开器唯一实现的四套期望串 + 「无占位符时恒等」的输入样本，主语就是这些词' },
  { file: 'tests/engine/instruction-table.test.ts', words: ['灵力', '封顶台', '算力', '灵能', '异能点', '灵枢', '修士'],
    reason: '喂进 instructionText 的 terms(...) fixture 取值，以及基准套的展开后指令文案' },
  { file: 'tests/gates/theme-word-runtime.test.ts', words: ['安全闸', '封锁线', '阵门', '算力', '机体完整度', '灵力'],
    reason: 'R3 运行时取证的期望词表：别套词判据与「展开没用本主题词」的主语就是这些词值' },
  { file: 'tests/gates/theme-word-source.test.ts', words: ['灵枢', '机体完整度', '精神值', '灵力', '气血'],
    reason: '本守卫自己的负样本注入串与兜底词说明——判据要证明有牙就得往副本里塞主题词' },
  { file: 'tests/build/trial-text.test.ts', words: ['灵力', '灵枢', '机体完整度', '算力'],
    reason: '牌面文案同源比对喂的 terms fixture（hp/resource 取值），数据类' },
  { file: 'tests/engine/flag-cards.test.ts', words: ['算力', '灵能', '异能点', '精神值'],
    reason: '被测对象是某套主题的数据卡（意识分叉 / 量子纠缠），卡面资源词跟着它自己那套写 ⇒ §5.1.1 第三行' },
  { file: 'tests/engine/log-instruction.test.ts', words: ['灵枢', '算力', '异能点', '灵能'],
    reason: 'logLineText(entry, terms) 四套展开后的尾串期望——展开结果正是被测对象（§5.1）' },
  { file: 'tests/gates/instruction-source.test.ts', words: ['灵能', '灵枢', '算力', '异能点'],
    reason: 'THEME_WORDS 探针词表：判据是「日志里不许出现别套词」，词表就是判据的主语' },
  { file: 'tests/build/terms-card-wiring.test.ts', words: ['灵力', '灵枢'],
    reason: '接线探针用的 terms fixture 取值（hp / resource 各一词）' },
  { file: 'tests/engine/b3.test.ts', words: ['灵枢'],
    reason: '甲′ 补偿手段：标题前半句说机制（扣 1 点资源），括注「基准印『灵枢』」保画面感' },
  { file: 'tests/engine/card-cost.test.ts', words: ['灵枢'],
    reason: 'B65/A-5b 断言基准套展开后仍点名「灵枢不足」——那是 UI 出口渲染结果，不许退回占位符' },
  { file: 'tests/engine/gate.test.ts', words: ['灵枢'],
    reason: '同 b3：甲′ 括注「基准印『灵枢』」；引擎侧判据已转 /\\{resource\\}不足/ 形式' },
  { file: 'tests/engine/recuperate.test.ts', words: ['灵枢'],
    reason: '同 b3：甲′ 括注（B76 自恢用例标题），断言的是引用相等不是文案' },
  { file: 'tests/gates/instruction-d20.test.ts', words: ['灵枢'],
    reason: '基准套 IR instructionTable 的展开后期望串（快照文案一致性由本文件 deepEqual + 门⑥ 负责）' },
  { file: 'tests/gates/theme-word-diff.test.ts', words: ['索桥'],
    reason: '判据讨论的就是「山道 / 索桥」撞不撞词，中性化等于把主语抹掉 ⇒ §5.1.1 第三行' },
];

/** 把登记表转成 `scanThemeWords` 需要的文件级放行表。 */
export function testsWhitelist(registry = TESTS_WORD_REGISTRY) {
  return new Map(registry.map((r) => [r.file, [...r.words]]));
}

/**
 * 兜底词黑名单（B79 §2.4）：**不属于任何一套主题、却曾被当默认值写进文案**的词。
 *
 * 为什么单列一张表：R1 的禁字表 = 四套 `terms` 五叶取值的并集，这个定义天生看不见这类词——
 * 「体力」不是任何一套的 hp 词（灵力/气血/机体完整度/精神值），却是 `termsOf` 里
 * `hp ?? '体力'` 的默认值，同样的词还漏在引擎文案里两处（`exhaustion.ts:28`、`registry.ts:507`）。
 * 只靠禁字表，「R1 已 0 命中」会是一句**边界没说清的实话**。
 *
 * ⚠️ 入表规则：**只收本批已清零的词**。把还没接线的词（`裂隙` 13 处、`险径` 2 处，见规格
 *   §2.4 / L-B79-4）提前放进来 = 让守卫自红，然后被人顺手注释掉——那比没有守卫更糟。
 *   它们接线后按同一规则加入。`牌库` 不入表：它是中立机制词（同 `资源`，§5.1.1 甲′ 口径）。
 *
 * r1.6 加入 `峰顶`：它不是任何一套的 peak 词（封顶台/奇点台/道顶/天台），却是
 * `termsOf` 里 `peak ?? '峰顶'` 的默认值——「体力」的孪生兄弟。两处文案（`registry.ts:261`
 * 的日志、`tutorial.ts:84` 的教学）接线后实测 0 命中，才依同一规则入表。
 */
export const FALLBACK_BAN = ['体力', '峰顶'];

/** 扫兜底词（与 `scanThemeWords` 同一套行过滤，共用实现）。 */
export function scanFallbackWords(root, domains, words = FALLBACK_BAN) {
  const hits = [];
  const base = resolve(root);
  for (const domain of domains) {
    for (const f of listSources(resolve(base, domain))) {
      const rel = f.slice(base.length + 1).split('\\').join('/');
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (isComment(line)) { return; }
        for (const w of words) {
          if (line.includes(w)) { hits.push(`${rel}:${String(i + 1)} 兜底词「${w}」 ${line.trim().slice(0, 60)}`); }
        }
      });
    }
  }
  return hits;
}

/**
 * R2：`alert(...)` 的参数里**直接**出现占位符字面量 = 忘了展开（定位辅助判据，规格 §5）。
 *
 * ⚠️ 只判「直含字面量」，不判「必须经展开函数」——后者会把合规的 `alert(t(x))` 一起误报，
 *   而 `t()` 恰恰是本批要求的写法。正则里那段 `(?:(?!t\()[^)])*` 是**受约束的前视**：
 *   一路吃字符，但一旦看到 `t(` 就停 ⇒ `alert('前缀' + t('{resource}'))` 这种混排也不算直投。
 *   跨行的 alert 不在本判据范围内（R3 的运行时守卫兜得住，它看的是最终交给玩家的字符串）。
 */
export function scanUnexpandedAlerts(root) {
  const hits = [];
  const base = resolve(root);
  for (const f of listSources(resolve(base, 'web'))) {
    const rel = f.slice(base.length + 1).split('\\').join('/');
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (isComment(line)) { return; }
      if (/alert\((?:(?!t\()[^)])*\{(?:resource|gate|path|peak|hp)\}/.test(line)) {
        hits.push(`${rel}:${String(i + 1)} ${line.trim()}`);
      }
    });
  }
  return hits;
}

// ---------- R5：断言形式统一（规格 §5.1 / §5.2 r1.7）----------

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', '}', ']']);
/** 只有「前面是运算符/分隔符」时 `/` 才开正则，否则是除号（`a = b / 2` 不该被当字面量吃掉）。 */
const REGEX_OK_AFTER = new Set(['(', ',', ':', '[', '!', '&', '|', '?', '=', '{', '}', ';', ' ', '\n', '+', '-', '*', '^']);

/**
 * 扫过一段文本，跳过字符串 / 模板 / 正则 / 行注释，返回**净括号深度**与最后一个非空白字符。
 *
 * 为什么守卫要走到这一层，而不是 `split(',')` + 数括号：断言里既有 `String(r.note)` 的嵌套
 * 括号，又有 `/\{resource\}不足/` 这种带反斜杠与花括号的正则字面量。朴素切分会把实参切错，
 * 于是「期望值里出现主题词」这条判据要么漏（切丢一段）要么误报（把消息串当期望值）——
 * 而误报的代价不是多一行红，是下一个人给它加白名单。
 */
function scanDepth(text, start, prev) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === c) { i += 1; break; }
        i += 1;
      }
      prev = c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && REGEX_OK_AFTER.has(prev)) {
      let inClass = false;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        else if (text[i] === '/' && !inClass) { i += 1; break; }
        i += 1;
      }
      prev = '/';
      continue;
    }
    if (OPENERS.has(c)) depth += 1;
    if (CLOSERS.has(c)) depth -= 1;
    if (c !== ' ' && c !== '\t' && c !== '\n') prev = c;
    i += 1;
  }
  return { depth, prev };
}

/**
 * 取出以 `assert.` 开头的**语句**，折行的续行合并进来（`{ line, text }`，line 从 1 起）。
 *
 * ⚠️ 必须是语句级而不是行级（T15 修正 #27 的教训）：按单行判定会漏掉折行的断言，
 *   而「漏一类」在结果上与「那一类本来就干净」完全同形，且后者更让人放心。
 */
export function assertionStatements(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (!/^assert\.(match|notMatch|equal|notEqual)\(/.test(t)) continue;
    let text = lines[i];
    let extra = 0;
    while (scanDepth(text, 0, '').depth > 0 && i + extra + 1 < lines.length && extra < 8) {
      extra += 1;
      text += '\n' + lines[i + extra];
    }
    out.push({ line: i + 1, text });
  }
  return out;
}

/** 切出 `assert.x(…)` 的**顶层实参**（跳过字符串/正则/嵌套括号；遇到收尾 `)` 就返回）。 */
export function topLevelArgs(text) {
  const open = text.indexOf('(');
  if (open < 0) return [];
  const args = [];
  let cur = '';
  let depth = 0;
  let i = open + 1;
  let prev = '(';
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { cur += text[i] + (text[i + 1] ?? ''); i += 2; continue; }
        cur += text[i];
        if (text[i] === q) { i += 1; break; }
        i += 1;
      }
      prev = q;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && REGEX_OK_AFTER.has(prev)) {
      let inClass = false;
      cur += c;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { cur += text[i] + (text[i + 1] ?? ''); i += 2; continue; }
        cur += text[i];
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        else if (text[i] === '/' && !inClass) { i += 1; break; }
        i += 1;
      }
      prev = '/';
      continue;
    }
    if (OPENERS.has(c)) depth += 1;
    if (CLOSERS.has(c)) {
      if (depth === 0 && c === ')') { args.push(cur); return args; }
      depth -= 1;
    }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; i += 1; prev = ','; continue; }
    cur += c;
    if (c !== ' ' && c !== '\t' && c !== '\n') prev = c;
    i += 1;
  }
  args.push(cur);
  return args;
}

/**
 * R5：两套断言写法不许混用（规格 §5.1）。
 *
 * 只看**被断言的表达式自己**引用引擎结果（`.note` / `.message` / `.log[…]`）的语句，且只看它的
 * **期望值实参**：
 *   · 期望值里出现纯主题名词 ⇒ 那是「把引擎原文案当判据」⇒ 红（应写 `{resource}` 形态）；
 *   · 语句里出现过展开出口（`logLineText` / `termExpander` / `expandThemeWords`）⇒ 合法：
 *     玩家看到的句子由出口展开，那条正是 §5.1 要求基准主题**保留展开后文本**的那一半。
 *
 * ⚠️ 为什么不用「邻行窗口」判是不是引擎结果断言（计划原样）：三行窗口会把上一行的
 *   `String(r.note)` 记到下一行的**消息串**头上 ⇒ 实测误报 `gate.test.ts:148` 的
 *   `assert.equal(win.passed, true, '红牌胜出 ⇒ 通过关隘')`——机制名同形词写在消息里，
 *   不是判据。窗口式判据的误报不会停在一次红，它会换来一条白名单。
 * ⚠️ 也不许把基准主题展开断言里的「灵枢」改成 `{resource}`：那等于没人再测展开结果，
 *   `baseExpanded` 就是那一半的下限哨。
 *
 * @returns {{ offenders: string[], statements: number, baseExpanded: number }}
 *   `statements` = 认定的引擎结果断言语句数（防空转的分子，不该是 0）；
 *   `baseExpanded` = 经展开出口且期望值含基准主题词的语句数。
 */
export function scanAssertionForms(root, domain, foreignWords, baseWords) {
  const offenders = [];
  let statements = 0;
  let baseExpanded = 0;
  const base = resolve(root);
  for (const f of listSources(resolve(base, domain))) {
    const rel = f.slice(base.length + 1).split('\\').join('/');
    for (const st of assertionStatements(readFileSync(f, 'utf8'))) {
      const args = topLevelArgs(st.text);
      const tested = args[0] ?? '';
      const expected = args[1] ?? '';
      const wrapped = /logLineText|termExpander|expandThemeWords/.test(st.text);
      const engineResult = /\w\.note\b|\w\.message\b|\.log\s*\[/.test(tested);
      if (engineResult) {
        statements += 1;
        if (wrapped) continue;
        const hit = foreignWords.find((w) => expected.includes(w.word));
        if (hit !== undefined) offenders.push(`${rel}:${String(st.line)} 「${hit.word}」 ${st.text.trim().slice(0, 90)}`);
        continue;
      }
      if (wrapped && baseWords.some((w) => expected.includes(w))) baseExpanded += 1;
    }
  }
  return { offenders, statements, baseExpanded };
}

