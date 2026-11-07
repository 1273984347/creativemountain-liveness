// theme-diff-check.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

/** 差异核对结果。 */
export interface DiffCheckResult {
  readonly errors: readonly string[];
  readonly notes: readonly string[];
}

/** 主题包的最小结构（门禁只读这些字段）。 */
export interface ThemeLike {
  readonly meta: { readonly id: string; readonly name: string; readonly tagline: string };
  readonly glossary: Readonly<Record<string, string>>;
  readonly factions: readonly { readonly id: string; readonly name: string }[];
  readonly identities: readonly { readonly id: string; readonly name: string }[];
  readonly cards: readonly { readonly id: string; readonly name: string; readonly effects: readonly unknown[] }[];
  readonly certificationCards: readonly { readonly id: string; readonly prompt: string }[];
  readonly heavenCards: readonly {
    readonly id: string; readonly name: string; readonly text: string; readonly effects: readonly unknown[];
  }[];
  readonly trials: readonly { readonly id: string; readonly text: string; readonly effects?: readonly unknown[] }[];
  readonly domainWords?: readonly string[];
}

/** 深度规范化（键序无关的相等判定用）。 */
export declare function canonical(value: unknown): unknown;

/** 深度相等（与键序无关）。 */
export declare function deepEqual(a: unknown, b: unknown): boolean;

/** 检查一套新主题相对基准的 §10.1 两张清单。 */
export declare function checkThemeDiff(base: ThemeLike, theme: ThemeLike): DiffCheckResult;

/** 取一套主题相对基准**全新效果**的卡（标志性卡牌）。 */
export declare function flagCardsOf(
  base: ThemeLike,
  theme: ThemeLike,
): readonly { readonly id: string; readonly name: string; readonly effects: readonly unknown[] }[];

/** 检查若干主题之间**两两**差异化（含标志卡互异性）。 */
export declare function checkThemesMutuallyDistinct(
  themes: readonly ThemeLike[],
  base?: ThemeLike | null,
): DiffCheckResult;

/** 列出 themes/ 下的全部主题包路径。 */
export declare function listThemePaths(root?: string): readonly string[];

export declare const BASE_THEME_PATH: string;
export declare const MIN_REUSED_CARDS: number;
export declare const MIN_FLAG_CARDS: number;
export declare const MAX_FLAG_CARDS: number;
export declare const MIN_CERT_CARDS: number;
export declare const MIN_DOMAIN_WORDS: number;
export declare const MIN_DOMAIN_WORD_LEN: number;
