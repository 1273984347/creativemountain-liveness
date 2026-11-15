// ir-validate.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

import type { ScalesRow } from '../engine/scales.ts';

/** 校验结果。 */
export interface IrValidateResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** 顶层必备键。 */
export declare const IR_TOP_KEYS: readonly string[];

/** 被逐字比对覆盖的 IR 顶层键（B78 T17 元守卫的输入）。 */
export declare const TRACEABLE_KEYS: readonly string[];

/** 只受结构校验的键 → 原因（每项必须写原因）。 */
export declare const STRUCTURAL_KEYS_MAP: Readonly<Record<string, string>>;

/** `Object.keys(STRUCTURAL_KEYS_MAP)`（同源清单）。 */
export declare const STRUCTURAL_KEYS: readonly string[];

/** 校验 ir.json。 */
export declare function validateIr(
  ir: unknown,
  theme: unknown,
  scales: readonly ScalesRow[],
): IrValidateResult;
