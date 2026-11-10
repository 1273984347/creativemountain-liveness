// face-stats.mjs 的类型声明（纯 JS 工具的 TS 侧契约；与 key-normalize.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 face-stats.mjs（纯统计，无 IO、无模型）。
//   由 `tests/engine/game-arms-stats.test.ts` 判定（McNemar 校正 / 配对计数 / 固定措辞三条口径）。

/** χ²(1) 的 p=0.05 临界值（spec 权威，不得下调）。 */
export declare const CHI2_CRITICAL: 3.841;

export interface McNemarResult {
  readonly b: number;
  readonly c: number;
  /** 连续性校正 `χ²=(|b−c|−1)²/(b+c)`，六位小数；b+c=0 时为 0。 */
  readonly chi2: number;
  readonly significant: boolean;
  /** b+c=0 ⇒ 无可配对差异。 */
  readonly noDiscordant: boolean;
}

/** 同 seed 配对的 McNemar 检验（连续性校正）。 */
export declare function mcnemar(b: number, c: number): McNemarResult;

export interface PairResult {
  /** 基线赢而模型输的局数。 */
  readonly b: number;
  /** 基线输而模型赢的局数。 */
  readonly c: number;
  readonly both: number;
  readonly neither: number;
  /** b + c。 */
  readonly changed: number;
  readonly paired: number;
}

/** 逐局配对计数（winners 数组按同 seed 一一对应）。 */
export declare function pairWinners(baseWinners: ReadonlyArray<ReadonlyArray<number>>, armWinners: ReadonlyArray<ReadonlyArray<number>>, seat: number): PairResult;

/** 判定措辞 —— 只允许三种固定说法（spec 权威）。 */
export declare function verdictOf(args: { significant: boolean; improved: boolean }): string;
