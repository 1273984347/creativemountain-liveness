// 20 面指令骰（「问天」）的唯一事实源（B78 规格 §4 R3）。
//
// ⚠️ 为什么这份表住在这里、而 `turn-runner` 不 import 它：
//   1) 指令表是**游戏规则**，主题只决定 `{resource}` 换成哪个词（主规格 §3.2：
//      「指令表是主题无关的通用表」）；
//   2) 引擎只报机制事实，文案归渲染层（规格 §1.5 P1，与 `gate.ts:176`
//      「引擎不硬编码任何试炼文案」同一条分工）。B78 前引擎在 scifi-ai 局里印
//      「灵枢 +1」，而那局根本没有灵枢 —— 那不是瑕疵，是假话；
//   3) `build/` 不在 tsconfig 的 include 里 ⇒ 表放 `build/` 就不受门 ① 类型检查
//      （取证：引擎/web 侧 `import '…mjs'` 零先例；反向 `.mjs → engine/*.ts` 有
//      `tools/ir-validate.mjs:15`、`tools/theme-validate.mjs:12`、`tools/doc-sync-lib.mjs:15` 三处）。
//
// 消费方：`web/ui/log.ts`（对局日志按 `diceRoll` 展开）与 `build/build-ir.mjs`（IR / 规则书）。
// 目录归属若将来觉得别扭，另批迁移；`tests/gates/instruction-source.test.ts` 的两条判据
// 与目录无关，迁过去原样搬。

import { expandThemeWords } from './theme-text.ts';
import type { ThemeTerms } from '../types/theme.ts';

/** 一面指令。 */
export interface InstructionRow {
  readonly face: number;
  readonly text: string;
}

/** 资源主题词的占位符（渲染时由 `instructionText` 替换）。 */
const RESOURCE = '{resource}';

/**
 * 20 面指令表（逐字取自**主规格 §3.2 的指令表**，顺序即面数）。
 *
 * ⚠️ 改任何一行都是**改规则**：必须同时动 `tests/gates/snapshots/instruction-d20.json`
 *   并在批次记录写理由 —— 快照红是特性，不是事故，它保证「改规则」这件事出现在 diff 里。
 */
export const INSTRUCTION_TABLE: readonly InstructionRow[] = [
  { face: 1, text: '抽 1 张牌' },
  { face: 2, text: `${RESOURCE} +1` },
  { face: 3, text: '抽 2 张牌' },
  { face: 4, text: `${RESOURCE} -1（给自己）` },
  { face: 5, text: '掷 6 面移动骰并按点数前进' },
  { face: 6, text: '前进 2 格' },
  { face: 7, text: `抽 1 张牌 + ${RESOURCE} +1` },
  { face: 8, text: '弃 1 张牌抽 2 张' },
  { face: 9, text: '前进 1 格并抽 1 张牌' },
  { face: 10, text: '全员弃 1 张牌' },
  { face: 11, text: '指定一名玩家弃 1 张牌' },
  { face: 12, text: '指定一名玩家后退 1 格' },
  { face: 13, text: '获得 1 张指定类型手牌' },
  { face: 14, text: '立即再掷一次 20 面指令骰并执行（不可再连锁）' },
  { face: 15, text: '免疫「封口」至下一个完整手番结束' },
  { face: 16, text: '与一名玩家交换手牌各 1 张' },
  { face: 17, text: '本回合移动 +2 格' },
  { face: 18, text: `获得 1 枚${RESOURCE}（不超上限）` },
  { face: 19, text: '指定一名玩家抽 1 张牌' },
  { face: 20, text: '自由执行一次「阵营轮」效果' },
];

/**
 * 某一面的文案（占位符按主题词表展开）。
 *
 * ⚠️ 越界 ⇒ 本函数抛错；缺叶 ⇒ `expandThemeWords` 抛错。都不返回兜底串（理由见测试文件头）。
 * ⚠️ 本表**目前**只有 `{resource}` 一个占位符，仍然改调 `expandThemeWords` 而不是自己
 *   split/join：统一实现比留一个特化替换更好——将来表里加 `{gate}` 之类不用动本函数。
 *   **不许**以「只用得到一个叶」为由退回 split/join（B79 §4.2；B78 时这里有第二份替换）。
 * ⚠️ **face 15 的措辞 ≡ 豁免窗真值**（B79 R6 / §A.4，L-B78-5 已在 T17 结账）：真值是
 *   `statuses.ts` 的 `grantImmunity`（加层、不清旧层）+ `tickPlayerStatuses`（在**该玩家自己手番末**
 *   衰减，授予当回合有 `statusGrantedThisTurn` 豁免位）⇒ 自己手番内授予 1 层 = 当前剩余 +
 *   接下来 1 个**完整手番**。三处（本表 / 主规格 §3.2 / IR 与规则书）必须同词，常驻守卫在
 *   `tests/gates/face15-wording.test.ts`——改措辞请三处一起改，别只改这里。
 */
export function instructionText(face: number, terms: ThemeTerms): string {
  const row = INSTRUCTION_TABLE.find((x) => x.face === face);
  if (row === undefined) { throw new Error(`instructionText：没有第 ${String(face)} 面指令`); }
  return expandThemeWords(row.text, terms);
}
