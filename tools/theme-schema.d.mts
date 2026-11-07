// theme-schema.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// 工具本体是 .mjs（零 TS 编译负担、可被 Node 直接执行），
// 但测试是 .ts 且受 tsc 门禁管辖，故在此补声明。

import type { OpName, PredicateName, GoalKind, CardType, NegativeStatus, TileKind } from '../engine/types/theme.ts';
import type { CompareOp, CostOp } from '../engine/types/common.ts';

/** 算子的参数规格。 */
export interface OpParamSpec {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

/** 派生出的主题包 Schema。 */
export interface ThemeSchema {
  readonly ops: Readonly<Record<string, OpParamSpec>>;
  readonly opNames: readonly OpName[];
  readonly predicateNames: readonly PredicateName[];
  readonly goalKinds: readonly GoalKind[];
  readonly cardTypes: readonly CardType[];
  readonly negativeStatuses: readonly NegativeStatus[];
  readonly compareOps: readonly CompareOp[];
  readonly costOps: readonly CostOp[];
  readonly tileKinds: readonly TileKind[];
  /** 谓词的字符串字面量取值白名单（如 phase_is 的 night/day）。 */
  readonly predicateEnums: Readonly<Record<string, readonly string[]>>;
}

export declare function readThemeSource(): string;
export declare function readCommonSource(): string;
export declare function stripComments(source: string): string;
/** 只去注释、保留字符串字面量（谓词取值白名单必须用它）。 */
export declare function stripCommentsOnly(source: string): string;
export declare function unionMembers(source: string, typeName: string): string[];
export declare function parseEffectMap(source: string): Record<string, OpParamSpec>;
export declare function predicateEnumValues(source: string, predName: string): string[];
export declare function deriveThemeSchema(): ThemeSchema;
