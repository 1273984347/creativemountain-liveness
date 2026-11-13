// build-themes.mjs 的类型声明（B75.2 一致性门的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 build/build-themes.mjs（纯 JS，无类型）。
//   `buildTheme(base, data)` 是纯函数（守卫后 import 无副作用）；CLI 只在直接运行时执行。

import type { ThemePack } from '../engine/types/theme.ts';

/** theme-data/*.mjs 的默认导出形状（生成器输入；字段以生成器实际读取的为准）。 */
export interface ThemeData {
  readonly id: string;
  readonly abbr: string;
  readonly name: string;
  readonly tagline: string;
  readonly resourceName: string;
  readonly deckName: string;
  readonly glossary: Readonly<Record<string, string>>;
  readonly terms: Readonly<Record<string, string>>;
  readonly suits: readonly string[];
  readonly rankLabels: readonly string[];
  readonly factions: readonly { readonly id: string; readonly name: string; readonly abilityText: string; readonly wheelText: string }[];
  readonly identities: readonly { readonly name: string; readonly passiveText: string; readonly flavor?: string }[];
  readonly cardNames: Readonly<Record<string, readonly string[]>>;
  readonly flagCards?: Readonly<Record<string, Readonly<Record<number, { readonly name: string; readonly effects: unknown }>>>>;
  readonly heavenCards: readonly { readonly name: string; readonly text: string }[];
  readonly trials: readonly string[];
  readonly creationCards: readonly { readonly name: string; readonly text: string }[];
  readonly certCards: readonly string[];
  readonly domainWords: readonly string[];
  readonly tiles: readonly string[];
}

/** 由基准主题与主题数据装配出一套完整主题包（纯函数）。 */
export declare function buildTheme(base: ThemePack, data: ThemeData): ThemePack;

/** 参与生成的主题数据清单（一致性门从同一处取，不另抄 id 列表）。 */
export declare const THEME_DATA: readonly ThemeData[];
