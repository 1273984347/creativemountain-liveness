// doc-sync-lib.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。

/** 一条 doc-sync 检查的结果。 */
export interface DocSyncCheck {
  /** 检查编号（C1–C10）。 */
  readonly id: string;
  /** 人读标题（含计数）。 */
  readonly title: string;
  /** 是否通过。 */
  readonly ok: boolean;
  /** 失败详情（通过时为空串）。 */
  readonly detail: string;
}

export declare const SPEC_PATH: string;
export declare const EXEMPT_MARK: string;

export declare function readSpec(): string;
export declare function unionMembers(source: string, typeName: string): string[];
export declare function specOpNames(spec: string): string[];
export declare function specOpEntries(spec: string): { name: string; exempt: boolean }[];
export declare function tableHeaderRow(spec: string, mustContain: readonly string[]): string | undefined;
export declare function cellNumber(cell: string): number | undefined;
export declare const PENDING_OPS: ReadonlySet<string>;
export declare const DEFERRED_OPS: ReadonlySet<string>;

export declare function checkFieldNames(spec: string): DocSyncCheck;
export declare function checkScaleValues(spec: string): DocSyncCheck;
export declare function checkOps(spec: string, codeOps: readonly string[], nonOps: ReadonlySet<string>): DocSyncCheck;
export declare function checkPredicates(spec: string, codePreds: readonly string[]): DocSyncCheck;
export declare function checkGoals(spec: string, codeGoals: readonly string[]): DocSyncCheck;
export declare function checkDuplicateRows(spec: string): DocSyncCheck;
/**
 * C8：规格 §9.3 覆盖边界表与机器清单**逐条对应**（B52：由「条数一致」升级）。
 * 判据四层：结构层（首列必须是 id）/ 集合层（双向点名）/ 顺序层（第 i 行 == 第 i 条）/ 唯一层（无重复）。
 */
export declare function checkCoverageBoundaries(spec: string, boundaryIds: readonly string[]): DocSyncCheck;
export declare function checkStateContract(spec: string, stateFields: readonly string[]): DocSyncCheck;
export declare function checkExemptSyntax(spec: string): DocSyncCheck;
/**
 * C10：规则书覆盖规格 §3.4 的全部地形（章节 + 要点关键词）。
 * 实现位于 `tools/rules-book-contract.mjs`（地形契约的**单一事实源**），此处 re-export。
 */
export declare function checkRulesBookTerrain(spec: string, narration: string): DocSyncCheck;
