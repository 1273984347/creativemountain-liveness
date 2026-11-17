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
