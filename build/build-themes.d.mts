// build-themes.mjs 的类型声明（B75.2 一致性门的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 build/build-themes.mjs（纯 JS，无类型）。
//   `buildTheme(base, data)` 是纯函数（守卫后 import 无副作用）；CLI 只在直接运行时执行。

import type { ThemePack, ThemeTerms } from '../engine/types/theme.ts';

/** theme-data/*.mjs 的默认导出形状（生成器输入；字段以生成器实际读取的为准）。 */
export interface ThemeData {
  readonly id: string;
  readonly abbr: string;
  readonly name: string;
  readonly tagline: string;
  readonly resourceName: string;
  readonly deckName: string;
  readonly glossary: Readonly<Record<string, string>>;
  /**
   * 术语层十叶（B77 规格 §6.2）：`types`/`colors` 缺一个叶子，生成器在派生题面时直接抛错
   * ——静默拼出 `undefined` 会一路印到实体牌上，所以这里用严格类型而不是宽 Record。
   */
  readonly terms: ThemeTerms;
  readonly suits: readonly string[];
  readonly rankLabels: readonly string[];
  readonly factions: readonly { readonly id: string; readonly name: string; readonly abilityText: string; readonly wheelText: string }[];
  readonly identities: readonly { readonly name: string; readonly passiveText: string; readonly flavor?: string }[];
  readonly cardNames: Readonly<Record<string, readonly string[]>>;
  readonly flagCards?: Readonly<Record<string, Readonly<Record<number, { readonly name: string; readonly effects: unknown }>>>>;
  readonly heavenCards: readonly { readonly name: string; readonly text: string }[];
  /** 12 条试炼牌名（B78 §2.1）。按位对位基准的 trials 顺序；缺失生成器抛错，不许回落基准名。 */
  readonly trialNames: readonly string[];
  // ⚠️ B77 §6.1：这里**没有** `trials` —— 试炼题面由 `build/trial-text.mjs` 从基准判定 +
  //   本表 `terms` 派生。手写文本列表就是那份「第二事实源」，删掉它才是修复。
  readonly creationCards: readonly { readonly name: string; readonly text: string }[];
  readonly certCards: readonly string[];
  readonly domainWords: readonly string[];
  readonly tiles: readonly string[];
}

/** 由基准主题与主题数据装配出一套完整主题包（纯函数）。 */
export declare function buildTheme(base: ThemePack, data: ThemeData): ThemePack;

/** 参与生成的主题数据清单（一致性门从同一处取，不另抄 id 列表）。 */
export declare const THEME_DATA: readonly ThemeData[];
