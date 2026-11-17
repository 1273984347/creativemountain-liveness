// tools/theme-word-scan.mjs 的类型声明（`.ts` 测试引 `.mjs` 需要；严格 tsc 不开 allowJs）。
//
// ⚠️ 只声明**契约形状**，不重抄实现细节；禁字表条目结构在这里写清，是因为测试要按字段断言，
//   而 `.mjs` 侧的 JSDoc 不参与 tsc 检查。

/** 禁字表的一项：某个主题词值 + 它属于哪个叶 + 哪些主题用它。 */
export interface LeafWord {
  readonly word: string;
  readonly leaf: string;
  readonly themes: readonly string[];
}

/** R1 的扫描域（规格 §5.4）。 */
export declare const SENTENCE_DOMAINS: readonly string[];

/** R1 域的文件级放行表——**必须恒为空集**（规格 §5.2）。 */
export declare const SENTENCE_WHITELIST: Map<string, string[]>;

/** 禁字表：从 `themes/<id>/theme.json` 的 `terms` 派生，不手抄。 */
export declare function leafWordsFromThemes(root?: string): LeafWord[];

/** 递归收集 `.ts/.tsx/.mjs/.mts` 源文件。 */
export declare function listSources(dir: string): string[];

/** 扫描主题词字面量，返回 `相对路径:行号 「词」 叶=… 主题=…`。 */
export declare function scanThemeWords(
  root: string,
  domains: readonly string[],
  words: readonly LeafWord[],
  whitelist?: Map<string, string[]> | null,
): string[];

/** R2：alert 参数里直含占位符字面量的位置。 */
export declare function scanUnexpandedAlerts(root: string): string[];

/** 兜底词黑名单（B79 §2.4）——只收本批已清零的词。 */
export declare const FALLBACK_BAN: readonly string[];

/** 扫兜底词（与 scanThemeWords 共用行过滤与注释豁免规则）。 */
export declare function scanFallbackWords(
  root: string,
  domains: readonly string[],
  words?: readonly string[],
): string[];

// ---------- B79 T16：R5 断言形式 + R7 数据类登记表 ----------

/** 机制名同形词（规格 §5.1.1 甲′）：域级豁免，只在这里声明一次。 */
export declare const MECHANISM_HOMOGRAPHS: readonly string[];

/** R7 在 tests 域用的禁字表 = 叶词并集 − 机制名同形词。 */
export declare function pureLeafWords(root?: string): LeafWord[];

/** R7 登记表的一行：一个文件 + 允许的词值 + 一行理由（规格 §5.2 粒度定案）。 */
export interface ThemeWordRow {
  readonly file: string;
  readonly words: readonly string[];
  reason: string;
}

export declare const TESTS_WORD_REGISTRY: readonly ThemeWordRow[];

/** 把登记表转成 `scanThemeWords` 需要的文件级放行表。 */
export declare function testsWhitelist(registry?: readonly ThemeWordRow[]): Map<string, string[]>;

/** 一条 `assert.` 语句（折行的续行已合并）。 */
export interface AssertionStatement {
  readonly line: number;
  readonly text: string;
}

/** 取出源码里所有 `assert.(match|notMatch|equal|notEqual)` 语句。 */
export declare function assertionStatements(src: string): AssertionStatement[];

/** 切出 `assert.x(…)` 的顶层实参（跳过字符串/正则/嵌套括号）。 */
export declare function topLevelArgs(text: string): string[];

/** R5 的三件读数。 */
export interface AssertionFormReport {
  readonly offenders: string[];
  readonly statements: number;
  readonly baseExpanded: number;
}

/** R5：直接断言引擎结果的语句，期望值里不许出现主题词。 */
export declare function scanAssertionForms(
  root: string,
  domain: string,
  foreignWords: readonly LeafWord[],
  baseWords: readonly string[],
): AssertionFormReport;
