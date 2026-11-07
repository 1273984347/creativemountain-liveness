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
