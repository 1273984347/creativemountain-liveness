// parity-check.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

import type { ScalesRow } from '../engine/scales.ts';

/** 校验结果。 */
export interface ParityResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly levels: readonly { readonly name: string; readonly passed: boolean }[];
}

export declare function extractSvgTexts(svg: string): string[];
export declare function checkIrVsTheme(ir: unknown, theme: unknown): string[];
export declare function checkSvgVsIr(svgTexts: readonly string[], ir: unknown): string[];
export declare function checkTracedCells(
  html: string,
  scales: readonly ScalesRow[],
  fieldNames: readonly string[],
): { readonly errors: string[]; readonly count: number };
export declare function checkPdfBasic(buffer: Buffer, label: string): string[];
