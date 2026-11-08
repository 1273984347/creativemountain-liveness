// state-text.mjs 的类型声明（纯 JS 工具的 TS 侧契约；与 tools/*.d.mts 同法）。

import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';

/** 官方 `/v1/systemone` 的 choice 题面。 */
export interface ChoicePrompt {
  readonly instructions: string;
  /** `key` = `actionKey(action)`（模型只输出 key），`值` = 一句话语义（≤40 字符）。 */
  readonly criteria: Record<string, string>;
}

/**
 * 局面描述（可见性视角 = `seat`：文本里只出现该座位自己的手牌内容）。
 * `seat` 越界 ⇒ 抛错。
 */
export declare function describeState(state: State, seat: number): string;

/**
 * 一句话动作语义（≤40 字符）。
 *
 * ⚠️ `seat` 是**归属校验**：给出即要求 `action.actor === seat`，否则抛错
 * （越权描述别人的动作等于把他人私牌印在题面上）。未覆盖的动作类型一律抛错，不返回 undefined。
 */
export declare function describeAction(state: State, action: Action, seat?: number): string;

/** choice 题面；候选 key 撞车 ⇒ 抛错（绝不静默覆盖）。 */
export declare function buildChoice(state: State, seat: number): ChoicePrompt;
