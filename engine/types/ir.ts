// IR（中间渲染数据模型）契约 —— **B6 与 B7 的唯一接口**（规格 §6.7.1）。
//
// ir.json 是 theme.json 的**扁平化展开**：
//   · **数值**原样搬运（并附 `srcRefs` 溯源路径）；
//   · **文本**原样搬运（**不在渲染期现编**，否则不可追溯）；
//   · **ops 结构**不进入 ir.json（规则书不需要它们，引擎另有来源）。
//
// 三条硬约束：
//   1. **确定性输出**——同样的 theme.json 必须产出逐字节相同的 ir.json。
//   2. **可追溯**——每段文本都能在 theme.json 找到对应字段；
//      每个数值都能通过 `srcRefs` 定位到引擎常量（scales）。
//   3. **可比对**——parity-check 主比对的就是这份文件。

import type { CardColor, CardType, GoalKind, TileKind } from './theme.ts';

/** IR 版本（结构变化时递增，配合迁移逻辑）。 */
export const IR_VERSION = 1;

/** 溯源路径：`scales[<players>].<fieldName>`。 */
export type ScaleSrcRef = string;

/** 带溯源声明的数值。 */
export interface SourcedNumber {
  /** 数值本身 */
  readonly value: number;
  /** 溯源路径（`scales[<players>].<fieldName>`） */
  readonly src: ScaleSrcRef;
}

/** 规模表的一行（全部数值都带溯源）。 */
export interface IrScaleRow {
  readonly players: number;
  readonly boardLength: SourcedNumber;
  readonly gateCount: SourcedNumber;
  readonly initialResource: SourcedNumber;
  readonly handStart: SourcedNumber;
  readonly deckTotal: SourcedNumber;
  readonly trialTotal: SourcedNumber;
  readonly certTotal: SourcedNumber;
  readonly threshold: SourcedNumber;
  readonly thresholdWithMark: SourcedNumber;
  readonly councilIntervalStandard: SourcedNumber;
  readonly councilIntervalNewbie: SourcedNumber;
  readonly exileFloor: SourcedNumber;
  readonly globalRoundLimit: SourcedNumber;
}

/** 主题元信息（搬运）。 */
export interface IrMeta {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly resourceName: string;
  readonly deckName: string;
}

/** 阵营（搬运 + 文本搬运）。 */
export interface IrFaction {
  readonly id: string;
  readonly name: string;
  readonly hpBase: number;
  readonly resourceBase: number;
  readonly abilityText: string;
  readonly wheelText: string;
  readonly deckTags: readonly string[];
}

/** 身份（搬运 + 文本搬运 + 目标展开）。 */
export interface IrIdentity {
  readonly id: string;
  readonly name: string;
  readonly passiveText: string;
  readonly goalKind: GoalKind;
  readonly goalCount: number;
  readonly goalText: string;
  readonly flavor?: string;
}

/** 卡牌（搬运；效果结构不进入 IR）。 */
export interface IrCard {
  readonly id: string;
  readonly name: string;
  readonly type: CardType;
  readonly cost: number;
  readonly color: CardColor;
  readonly suit?: string;
  readonly rank: number;
  readonly rankLabel?: string;
  readonly text: string;
}

/** 关隘格（棋盘的一格）。 */
export interface IrTile {
  readonly index: number;
  readonly kind: TileKind;
  readonly name: string;
  /** 关隘标价（非关隘为 undefined） */
  readonly gateFee?: number;
  /** 该关隘可用的试炼牌 id 列表 */
  readonly gateTrialIds?: readonly string[];
  /** 支路终点（非支路格为 undefined） */
  readonly branchTo?: readonly number[];
}

/** 棋盘。 */
export interface IrBoard {
  readonly length: number;
  readonly peakIndex: number;
  readonly tiles: readonly IrTile[];
}

/** 一条指令。 */
export interface IrInstruction {
  readonly face: number;
  readonly text: string;
}

/** 完整 IR。 */
export interface IrDocument {
  readonly version: number;
  readonly meta: IrMeta;
  readonly glossary: Readonly<Record<string, string>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly scales: readonly IrScaleRow[];
  readonly instructionTable: readonly IrInstruction[];
  readonly factions: readonly IrFaction[];
  readonly identities: readonly IrIdentity[];
  readonly cards: readonly IrCard[];
  readonly creationCards: readonly { readonly cardId: string; readonly name: string; readonly text: string }[];
  readonly certCards: readonly { readonly id: string; readonly prompt: string }[];
  readonly trials: readonly { readonly id: string; readonly text: string }[];
  readonly heavenCards: readonly { readonly id: string; readonly name: string; readonly text: string }[];
  readonly board: IrBoard;
}
