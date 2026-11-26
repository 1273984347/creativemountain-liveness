// balance-report-lock.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// ⚠️ 仓内没有 allowJs ⇒ .ts 引 .mjs 必须有同目录 .d.mts（先例：tools/board-parity.d.mts）。

/** 归一化行尾后的文本。 */
export declare function toLf(text: string): string;

/** 报告里声明的模拟口径（每档局数 / 总局数；缺行时为 null）。 */
export interface SampleScope {
  readonly gamesPerCell: string | null;
  readonly totalGames: string | null;
}

/** 从报告总览表抽出模拟口径。 */
export declare function extractSampleScope(text: string): SampleScope;

/** **权威**模拟口径期望值（从规格 §9.2 派生，独立于被比对的两侧）。 */
export interface ExpectedSampleScope {
  readonly gamesPerCell: number;
  readonly totalGames: number;
  /** 期望值来源说明（写进报错，让人能判断该改哪一侧）。 */
  readonly source: string;
}

/** 从规格 §9.2 派生权威样本口径（主题数/档数须与代码真值一致，否则抛错）。 */
export declare function expectedSampleScope(
  specText: string,
  themeCount: number,
  tierCount: number,
  /** 自证用的小口径（每档局数）⇒ 期望口径按局数等比缩放；正式门禁不传 ⇒ 用权威全量值。 */
  gamesPerCell?: number | null,
): ExpectedSampleScope;

/** 比对两份平衡报告，返回**全部差异行**（空数组 = 逐字节相等）。 */
export declare function diffReportLines(expected: string, actual: string): string[];

/** 平衡报告入库一致性的判定结果。 */
export interface BalanceReportCheckResult {
  /** 逐字节一致（行尾归一化后）时为 true。 */
  readonly ok: boolean;
  /** 差异行清单（每行含行号 / 期望 / 实测）。 */
  readonly diffs: string[];
  /** 入库版行数。 */
  readonly expectedLines: number;
  /** 重跑版行数。 */
  readonly actualLines: number;
  /** 模拟口径不一致的说明（空数组 = 口径一致）。 */
  readonly scopeIssues: string[];
  /** 入库版声明的模拟口径。 */
  readonly scopeExpected: SampleScope;
  /** 重跑版声明的模拟口径。 */
  readonly scopeActual: SampleScope;
}

/** 从 sim 进程的实际 stdout 解析「实际跑了多少局」（解析不到 ⇒ 返回 null ⇒ 失败关闭）。 */
export declare function parseActualTotalGames(stdout: string): number | null;

/** 判两份平衡报告是否逐字节一致（行尾归一化后）。
 *  传 `expectedScope` 才防得住「缩样本 + 重生成」（否则口径检查是两侧互比的同义反复）。 */
export declare function checkBalanceReport(
  expected: string,
  actual: string,
  expectedScope?: ExpectedSampleScope | null,
): BalanceReportCheckResult;
