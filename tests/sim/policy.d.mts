// policy.mjs 的类型声明（sim 决策层单一真相源的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 tests/sim/policy.mjs（纯 JS，无类型）。
//   改签名必须同步改 policy.mjs：门 ① 只核对 TS 侧，门 ⑨ 才核对行为。
// ⚠️ 依赖方向同 policy.mjs：本文件**不得**引用 run.mjs。

import type { State } from '../../engine/core/state.ts';
import type { RuleMode } from '../../engine/scales.ts';
import type { Card, ThemePack } from '../../engine/types/theme.ts';

/**
 * 决策点记录器的一行（B56 口径：**恰 11 个字段**，`seq` 从 0 起 ⇒ `seq` == JSONL 行号）。
 * 由 `tests/gates/sim-record.test.ts` 逐字段锁定。
 */
export interface DecisionRecord {
  readonly seq: number;
  readonly themeId: string;
  readonly players: number;
  readonly seed: number;
  readonly round: number;
  readonly turnIndex: number;
  readonly seat: number;
  readonly phase: string;
  /** 引擎产生的**骰面点数**；无骰面的决策点为 null（动作执行后回填）。 */
  readonly face: number | null;
  /** 启发式选中的动作（`actionKey`；对峙选牌用 `duel_card:<id>`）。 */
  readonly heuristic: string;
  /** `stateToJson(state)` 的**动作执行前**全量局面（⚠️ 含 rng 内部状态 ⇒ 不得直接喂模型）。 */
  readonly state: string;
}

/** 记录器（null = 关闭）。 */
export type Recorder = DecisionRecord[] | null;

/** `advanceWithDuel` 的透传选项（与 `advanceAuto` 的第三参同形）。 */
export interface AdvanceOpts {
  readonly gateReserve?: number;
  readonly onDuelPick?: (seat: number, cardId: string, stateAtPick: State) => void;
}

/**
 * 一局的统计与异常（`playOne` 的返回）。
 *
 * ⚠️ B70 只锁定下游**确实消费**的字段；其余平衡指标（`identities` / `factions` /
 *   `turnOrder` / `liveSeats` / `abilityOps` / `trialFailOutcomes` …）以索引签名放行，
 *   取值侧自行收窄 —— 本任务的原则是**零行为变更**，不在此处重新设计读数契约。
 */
export interface SimGameResult {
  readonly reason: string;
  readonly rounds: number;
  readonly winners: readonly number[];
  readonly anomalies: readonly string[];
  readonly [metric: string]: unknown;
}

/**
 * 记一个决策点。`recorder === null`（默认）时是**空操作**并返回 -1 ⇒ 日常模拟零开销。
 * 纯读：不改 state、不改控制流、不消耗 rng ⇒ 报告逐字不变。
 */
export declare function record(state: State, seat: number, heuristic: string, face?: number | null): number;

/** 由 run.mjs 装配记录器（null = 关闭）；装配时 `recordSeq` 归零。 */
export declare function setRecorder(value: Recorder): void;

/** 读取当前记录器（run.mjs 落盘段用它，不再持有模块级变量）。 */
export declare function getRecorder(): Recorder;

/** 状态合法性体检（跑完一局后逐玩家核对）；返回问题描述列表，空 = 正常。 */
export declare function checkState(s: State, label: string): string[];

/**
 * 挑一个默认出牌目标：除自己外位置最高的存活玩家**的座位号**。
 * 位置并列时**随机**选（用 `state.rng` ⇒ 仍可复现，且不引入座位号偏置）。
 * 无可挑目标 ⇒ `undefined`（不是 null —— 调用点按 `=== undefined` 判）。
 */
export declare function pickTarget(s: State, seat: number): number | undefined;

/** 山议：每人投给位置最高的对手，然后结算。 */
export declare function councilTurn(s: State): State;

/** 认证一轮：签印/质疑 → 判定 → 待认证者复议 → 第三方投票 → 复议裁定。 */
export declare function certificationTurn(s: State): State;

/** 从手牌里挑一张**付得起**且优先级最高的牌；无可打牌 ⇒ `undefined`。 */
export declare function pickPlayableCard(hand: readonly Card[], resource: number): Card | undefined;

/** 约 1/4 的行动机会发动被动；未发动 ⇒ `null`（发动成功带回新 state 与 op）。 */
export declare function maybeUseAbility(s: State, seat: number): { state: State; op: string } | null;

/** 推进手番；若结算后进入对峙 ⇒ AI 选牌后继续推进（回合阻塞 + 关隘的闭环）。 */
export declare function advanceWithDuel(s: State, mode: RuleMode, opts?: AdvanceOpts): Promise<State>;

/**
 * 跑一局，返回该局的统计与异常。
 *
 * ⚠️ `async` 是为 B70 Task 3 的**可注入策略**铺路（模型调用要 await）；
 *   Task 1 的实现**仍是 4 参签名**，多余实参按 JS 语义被忽略 ⇒ 故第 5 参起以
 *   rest 形声明为「可传、当前无效」，使缺省等价测试（显式传 undefined）在 TS 侧同样成立。
 */
export declare function playOne(
  theme: ThemePack,
  players: number,
  seed: number,
  gateReserve?: number,
  ...reservedForTask3Policy: readonly unknown[]
): Promise<SimGameResult>;
