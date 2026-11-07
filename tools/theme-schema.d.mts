// theme-schema.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// 工具本体是 .mjs（零 TS 编译负担、可被 Node 直接执行），
// 但测试是 .ts 且受 tsc 门禁管辖，故在此补声明。

import type { OpName, PredicateName, GoalKind, CardType, NegativeStatus } from '../engine/types/theme.ts';

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
}

export declare function readThemeSource(): string;
export declare function readCommonSource(): string;
export declare function stripComments(source: string): string;
export declare function unionMembers(source: string, typeName: string): string[];
export declare function parseEffectMap(source: string): Record<string, OpParamSpec>;
export declare function deriveThemeSchema(): ThemeSchema;
