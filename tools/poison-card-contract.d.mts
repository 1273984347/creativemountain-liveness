// poison-card-contract.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// ⚠️ 与 `tools/theme-diff-check.d.mts` 同款：纯 JS 工具若被 `tests/**/*.ts` import，
//   没有同名 `.d.mts` ⇒ tsc 报 TS7016（门 ① 红）⇒ 纯 JS 工具必须配一份手写声明。

/** 一张施加 poison 的牌。 */
export interface PoisonCard {
  readonly id: string;
  /** 牌面文案（须写明「中毒 N 层」）。 */
  readonly text: string;
  /** 施加的层数（= 毒可持续的回合数）。 */
  readonly layers: number;
}

/** 主题包的最小结构（判据只读这些字段）。 */
export interface ThemeLike {
  readonly meta: { readonly id: string };
  readonly cards: readonly { readonly id: string; readonly text?: string; readonly effects?: readonly unknown[] }[];
}

/** 契约检查结果。 */
export interface PoisonCheckResult {
  readonly errors: readonly string[];
  readonly notes: readonly string[];
}

/** B97 强档下限：任何毒牌的层数不得低于此值（1 层牌已被上移到 2 层）。 */
export declare const POISON_MIN_LAYERS: number;

/** B97 强档要求：每套主题至少有一张 ≥ 此层数的毒牌。 */
export declare const POISON_STRONG_LAYERS: number;

/** 每套主题至少应有的毒牌数量。 */
export declare const POISON_MIN_CARDS: number;

/** 收集一套主题里所有施加 poison 的牌（递归找 poison effect ⇒ 能命中嵌在 sequence 里的毒）。 */
export declare function collectPoisonCards(theme: ThemeLike): readonly PoisonCard[];

/** 判据：返回问题清单（空 = 通过）。 */
export declare function checkPoisonCards(theme: ThemeLike): PoisonCheckResult;
