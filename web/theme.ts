// 主题包加载（规格 §6.6：4 套主题内联进单文件 HTML）。
//
// B4 交付仙侠 2026；B8 补齐科幻 / 融合 / 都市异能三套 —— 此处已全部内联。
// 静态 import 是**有意的**：单文件 HTML 必须断网可用，主题不能靠运行时拉取。

import type { ThemePack } from '../engine/types/theme.ts';
import xianxia2026 from '../themes/xianxia2026/theme.json';
import scifiAi from '../themes/scifi-ai/theme.json';
import hybrid from '../themes/hybrid/theme.json';
import urbanPsych from '../themes/urban-psych/theme.json';

/** 可选主题。 */
export interface ThemeEntry {
  readonly id: string;
  readonly name: string;
  readonly theme: ThemePack;
}

const rawThemes = [xianxia2026, scifiAi, hybrid, urbanPsych] as unknown as ThemePack[];

/** 全部主题（JSON 导入后断言为 ThemePack）。 */
export const THEMES: readonly ThemeEntry[] = rawThemes.map((t) => ({
  id: t.meta.id,
  name: t.meta.name,
  theme: t,
}));

/** 按 id 取主题；找不到返回第一套。 */
export function themeById(id: string): ThemeEntry {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}
