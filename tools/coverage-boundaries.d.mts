// coverage-boundaries.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

export interface CoverageBoundary {
  /** 边界的稳定 id（用于机器比对与测试断言） */
  readonly id: string;
  /** 不覆盖什么（人读） */
  readonly notCovered: string;
  /** 为什么（人读） */
  readonly reason: string;
  /** 由哪条门禁/检查负责兜底（若无人兜底则为 null） */
  readonly fallback: string | null;
}

export declare const COVERAGE_BOUNDARIES: readonly CoverageBoundary[];

/** 规格 §9.3 覆盖边界表的解析结果。 */
export interface SpecCoverageRows {
  /** 是否在规格里找到「门禁覆盖边界」小节。 */
  readonly found: boolean;
  /** 逐行的边界 id（数据行首列）。 */
  readonly ids: readonly string[];
  /** 逐行的单元格（已切分、去空）。 */
  readonly rows: readonly (readonly string[])[];
  /** 人读说明（失败时说明原因）。 */
  readonly detail: string;
}

/** 规格覆盖边界表的列名约定。 */
export declare const SPEC_TABLE_ID_HEADER: string;
export declare const SPEC_TABLE_HEADER: readonly string[];

export declare function parseSpecCoverageRows(spec: string): SpecCoverageRows;
export declare function checkSpecCoverageTableStructure(spec: string): { ok: boolean; detail: string };
