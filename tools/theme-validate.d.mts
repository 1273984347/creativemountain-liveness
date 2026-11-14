// theme-validate.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

import type { ThemeSchema } from './theme-schema.mjs';

/** 校验结果。 */
export interface ValidateResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** 校验一个主题包。 */
export declare function validateTheme(theme: unknown, schema: ThemeSchema): ValidateResult;

/** 门 ⑤ 自动覆盖的主题包清单（新增主题免登记）。 */
export declare function listThemePaths(root?: string): string[];

/**
 * 手写题面（`fallback: true`）的期望条数（B77 §6.3 第 3 条）。
 * 今天 48/48 判定都可派生 ⇒ 0；改这个数字必须走批次记录。
 */
export declare const EXPECTED_FALLBACK_COUNT: number;
