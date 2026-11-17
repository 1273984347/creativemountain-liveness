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
