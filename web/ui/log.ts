// 日志面板。
//
// B78：`ask` 条目的指令文案由**渲染层**按主题词表展开 —— 引擎只报骰面与指令序号
//   （规格 §1.5 P1：「引擎只报机制事实，文案归渲染层」，与 gate.ts:176 同一条分工）。
//   结构化指针用既有的 `LogEntry.diceRoll`（state.ts:131，ask 两处日志早在写）：
//   不新增字段、不解析消息文本（把结构化数据拍平成文本再解析回来是倒退）。

import { instructionText } from '../../engine/core/instruction-table.ts';
import type { LogEntry, State } from '../../engine/core/state.ts';
import type { ThemeTerms } from '../../engine/types/theme.ts';
import { el } from './dom.ts';

/** 一条日志的显示文本（`ask` 条目在兜底句后追加主题化的指令内容）。 */
export function logLineText(entry: LogEntry, terms?: ThemeTerms): string {
  const head = 'R' + entry.round + '·T' + entry.turnIndex + ' 座' + entry.actor + ' ' + entry.message;
  if (entry.kind !== 'ask' || typeof entry.diceRoll !== 'number' || terms === undefined) { return head; }
  return head + ' —— ' + instructionText(entry.diceRoll, terms);
}

/** 渲染最近 N 条日志。`terms` 缺省时退回兜底句（引擎消息本身已可读，只是不含指令内容）。 */
export function renderLog(state: State, limit = 40, terms?: ThemeTerms): HTMLElement {
  const box = el('div', { class: 'log' });
  const items = state.log.slice(-limit);
  if (items.length === 0) {
    box.append(el('span', { class: 'muted', text: '（暂无记录）' }));
    return box;
  }
  for (const entry of items) {
    box.append(el('div', { class: 'log-line', text: logLineText(entry, terms) }));
  }
  return box;
}
