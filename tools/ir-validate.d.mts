// ir-validate.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

import type { ScalesRow } from '../engine/scales.ts';

/** 校验结果。 */
export interface IrValidateResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** 顶层必备键。 */
export declare const IR_TOP_KEYS: readonly string[];

/** 校验 ir.json。 */
export declare function validateIr(
  ir: unknown,
  theme: unknown,
  scales: readonly ScalesRow[],
): IrValidateResult;
