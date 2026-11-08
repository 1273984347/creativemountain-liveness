// state-text.mjs 的类型声明（纯 JS 工具的 TS 侧契约；与 tools/*.d.mts 同法）。

import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';

/** 官方 `/v1/systemone` 的 choice 题面。 */
export interface ChoicePrompt {
  readonly instructions: string;
  /** `key` = `actionKey(action)`（模型只输出 key），`值` = 一句话语义（≤40 字符）。 */
  readonly criteria: Record<string, string>;
  /**
   * 候选为空的可分桶标记（评审 4a）：`true` 说的是「引擎口径下这个座位此刻没有可枚举动作」
   * （待认证锁定 §5.1 / 对峙未决 B13+G-f / 非行动阶段），**不是**「模型拒答」。
   * Task 15 的 P1/P2 读数必须按它分桶，否则会把枚举契约的空面算成模型失败。
   */
  readonly noLegalActions: boolean;
}

/**
 * 局面描述（可见性视角 = `seat`）。
 *
 * ⚠️ 红线 3（预研）/ 设计 §4.5 的**输出侧承诺**：`describeState` 的文本里
 * **不会出现其他座位的任何牌 id**（也不会出现牌库顺序 id、对峙双方锁定的牌 id）；
 * 他人只交出**条数**（持牌数/装备数，公开），已揭晓的亮牌只交出名·色·点，同样不带 id。
 * 唯一的牌 id 来源是 `criteria` 的 key（`play:<cardId>` 等），且只可能是**决策座位自己**手牌里的牌。
 * 这一条由 `tests/engine/legal-probe.test.ts` 的封闭词表用例（常驻·输出层）逐局面逐座位判定。
 *
 * `seat` 越界 ⇒ 抛错。
 */
export declare function describeState(state: State, seat: number): string;

/**
 * 一句话动作语义（≤40 字符）。
 *
 * ⚠️ `seat` 是**必填**的归属校验（评审 6 的裁定）：必须等于 `action.actor`，否则抛错
 * —— 越权描述别人的动作等于把他人私牌印在题面上。漏传在 TS 侧直接编译不过，
 * JS 侧漏传同样落进越权分支（不再有「按 actor 自己渲染」这条无人看守的通道）。
 * 未覆盖的动作类型一律抛错，不返回 undefined。
 */
export declare function describeAction(state: State, action: Action, seat: number): string;

/** choice 题面；候选 key 撞车 ⇒ 抛错（绝不静默覆盖）。 */
export declare function buildChoice(state: State, seat: number): ChoicePrompt;
