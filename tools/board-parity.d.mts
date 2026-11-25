// board-parity.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// ⚠️ 仓内没有 allowJs ⇒ .ts 引 .mjs 必须有同目录 .d.mts（先例：tools/parity-check.d.mts）。

/** 棋盘 SVG 比对的输入（期望值由调用方从引擎真值派生，本模块不含手抄数字）。 */
export interface BoardSvgCheckInput {
  /** 棋盘 SVG 全文。 */
  readonly svgText: string;
  /** 棋盘 SVG 的文件名（例：棋盘-A2-24格-3.svg）。 */
  readonly fileName: string;
  /** 期望格数。 */
  readonly length: number;
  /** 期望关隘数（= 该档过路费行数）。 */
  readonly gateCount: number;
}

export declare const BOARD_FILE_PATTERN: RegExp;
export declare const GATE_FEE_MARK: string;
export declare function boardLabel(fileName: string): string;
export declare function countGateFeeLines(svgText: string): number;
export declare function checkBoardSvg(input: BoardSvgCheckInput): string[];
