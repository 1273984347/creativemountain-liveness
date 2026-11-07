// 主题包加载（规格 §6.6：4 套主题内联进单文件 HTML）。
//
// B4 已交付仙侠 2026；B8 补齐其余三套后，这里会自动多出可选项。

import type { ThemePack } from '../engine/types/theme.ts';
import xianxia2026 from '../themes/xianxia2026/theme.json';

/** 可选主题。 */
export interface ThemeEntry {
  readonly id: string;
  readonly name: string;
  readonly theme: ThemePack;
}

const raw = xianxia2026 as unknown as ThemePack;

/** 全部主题（JSON 导入后断言为 ThemePack）。 */
export const THEMES: readonly ThemeEntry[] = [
  { id: raw.meta.id, name: raw.meta.name, theme: raw },
];

/** 按 id 取主题；找不到返回第一套。 */
export function themeById(id: string): ThemeEntry {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}
