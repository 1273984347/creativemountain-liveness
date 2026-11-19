// 日志面板 —— 玩家可见文本的四个展开出口之一（B79 §4.3：日志 / notice / alert / 面板按钮）。
//
// B78：`ask` 条目的指令文案由**渲染层**按主题词表展开 —— 引擎只报骰面与指令序号
//   （规格 §1.5 P1：「引擎只报机制事实，文案归渲染层」，与 gate.ts:176 同一条分工）。
//   结构化指针用既有的 `LogEntry.diceRoll`（state.ts:131，ask 两处日志早在写）：
//   不新增字段、不解析消息文本（把结构化数据拍平成文本再解析回来是倒退）。
// B79：展开从「只碰 ask」扩成**全 kind 无条件**——note 会被插进 message（见 logLineText 注释）。

import { instructionText } from '../../engine/core/instruction-table.ts';
import { expandIdentityNames, expandThemeWords } from '../../engine/core/theme-text.ts';
import type { LogEntry, State } from '../../engine/core/state.ts';
import type { ThemeTerms } from '../../engine/types/theme.ts';
import { el } from './dom.ts';

/**
 * 一条日志的显示文本。
 *
 * B79 §4.3：**全部 kind 无条件展开**，不按 kind 分支。理由不是「将来可能会有」而是已经存在：
 *   `gate.ts:350` 写的是 `message: \`{gate}：${note}——退 1 格并被封口\``，把**返回值的 note
 *   插进了日志**，`registry.ts:707` 的「`N 号{gate}`」也是 log 行——只给 `ask` 开分支
 *   等于给占位符泄漏留门（取证见 `tests/gates/log-exit-expand.test.ts` 文件头）。
 * `ask` 的指令内容继续由结构化 `diceRoll` 展开（不解析消息文本，B78 的决定不变）。
 * B80 §2.3：`{identity:N}` 是同一条日志里的**第二类**数据源（座位 → 身份 → 称谓），
 *   所以在词表展开之后再过一次 `expandIdentityNames`；两步都只在拿到对应解析器时才做。
 * `terms` 与 `nameOf` 皆缺省 ⇒ 原文透出（占位符会露出来）：本函数不兜底，常驻防线是 R3（T14 跑真局）。
 */
export function logLineText(entry: LogEntry, terms?: ThemeTerms, nameOf?: (seat: number) => string): string {
  const withWords = terms === undefined ? entry.message : expandThemeWords(entry.message, terms);
  const body = nameOf === undefined ? withWords : expandIdentityNames(withWords, nameOf);
  const head = 'R' + entry.round + '·T' + entry.turnIndex + ' 座' + entry.actor + ' ' + body;
  if (entry.kind !== 'ask' || typeof entry.diceRoll !== 'number' || terms === undefined) { return head; }
  return head + ' —— ' + instructionText(entry.diceRoll, terms);
}

/** 渲染最近 N 条日志。`terms` 缺省时退回兜底句（引擎消息本身已可读，只是不含指令内容）。 */
export function renderLog(state: State, limit = 40, terms?: ThemeTerms, nameOf?: (seat: number) => string): HTMLElement {
  const box = el('div', { class: 'log' });
  const items = state.log.slice(-limit);
  if (items.length === 0) {
    box.append(el('span', { class: 'muted', text: '（暂无记录）' }));
    return box;
  }
  for (const entry of items) {
    box.append(el('div', { class: 'log-line', text: logLineText(entry, terms, nameOf) }));
  }
  return box;
}
