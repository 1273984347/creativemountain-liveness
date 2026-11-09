// 山议投票面板（规格 §5.6）。
//
// 匿名投票：UI **不显示谁投了谁**——只显示各目标的票数。
//
// ⚠️ **可点性判据只有一份**（B15 收口）：`web/legal-gate.ts` 的 `uiBlockNotice`。
//   本文件原先**自算**「存活 ∧ 非自己」（自带一套规则）⇒ 与 `legal-gate.ts` 并列两处口径，
//   `legal-gate.ts` 头部「UI 可点性的唯一来源」这句话在此文件上**不成立**。
//   现改为：渲染与点击**都**走 `uiAllows` / `uiBlockNotice` ⇒ 判据只剩一份。

import type { State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el, button, section } from './dom.ts';
import { uiAllows, uiBlockNotice } from '../legal-gate.ts';

/**
 * 山议面板的**可投目标集合**（座位号升序）。
 *
 * ⚠️ 抽成独立函数是为了**可测**：渲染函数需要 DOM，测试跑不了；
 *   而「面板允许投谁」正是 UI 与引擎必须一致的那一条 ⇒ 单一来源、单一函数。
 *
 * @param state 当前局面
 * @param seat 投票人座位
 * @returns 可投目标的座位号（已投票 / 山议未开 / 非存活时为空）。
 */
export function councilVoteTargets(state: State, seat: number): number[] {
  const out: number[] = [];
  for (const target of state.players) {
    const action = { type: 'VOTE' as const, actor: seat, target: target.seat };
    if (uiAllows(state, seat, action)) { out.push(target.seat); }
  }
  return out;
}
/**
 * 渲染山议面板。
 *
 * `onVote(target)` 投票；`onResolve()` 结算。
 */
export function renderCouncil(
  state: State,
  theme: ThemePack,
  seat: number,
  onVote: (target: number) => void,
  onResolve: () => void,
): HTMLElement {
  const c = state.council;
  const alive = state.players.filter((p) => p.alive);
  const alreadyVoted = c.votes[seat] !== undefined;
  const counts = new Map<number, number>();
  for (const t of Object.values(c.votes)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const body: (Node | string)[] = [];
  if (alreadyVoted) {
    body.push(el('span', { class: 'muted', text: '你已投票，等待其他人。' }));
  } else {
    body.push(el('span', { class: 'muted', text: '选择一名玩家（匿名投票）：' }));
    // 拒因槽：点击被拒时填入拒因（默认空 ⇒ 不占可见空间）
    const noticeSlot = el('div', { class: 'warn' });
    const row = el('div', { class: 'btn-row' });
    for (const targetSeat of councilVoteTargets(state, seat)) {
      const action = { type: 'VOTE' as const, actor: seat, target: targetSeat };
      row.append(button('座' + targetSeat, () => {
        const notice = uiBlockNotice(state, seat, action);
        if (notice !== null) { noticeSlot.textContent = notice; return; }
        noticeSlot.textContent = '';
        onVote(targetSeat);
      }));
    }
    body.push(row);
    body.push(noticeSlot);
  }
  // 票数（不显示投票人）
  const tally = el('div', { class: 'tally' });
  for (const target of alive) {
    const n = counts.get(target.seat) ?? 0;
    tally.append(el('span', { class: 'tally-item', text: '座' + target.seat + '：' + n + ' 票' }));
  }
  body.push(tally);
  if (alive.length === 3) {
    body.push(el('div', { class: 'warn', text: '3 人局：山议不淘汰人，得票最高者扣 2 ' + theme.glossary.resource + '（并列各扣 1）。' }));
  }
  body.push(el('div', { class: 'btn-row' }, button('结算山议', () => { onResolve(); })));
  return section('山议（匿名投票）', ...body);
}
