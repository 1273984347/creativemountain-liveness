// theme-validate.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

import type { ThemeSchema } from './theme-schema.mjs';

/** 校验结果。 */
export interface ValidateResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** 校验一个主题包。 */
export declare function validateTheme(theme: unknown, schema: ThemeSchema): ValidateResult;
