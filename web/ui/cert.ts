// 活人认证面板（规格 §5.3–§5.5）——本作的核心交互。
//
// 三种选择：**签印 / 质疑 / 弃权**（§5.3.1）；
// 质疑需出 3 题并逐题判定（§5.3.2）；
// 判不通过时待认证者可付费申请复议（§5.3.2）。
//
// ⚠️ 修复轮（评审发现 A 旁路三）：面板上**每一颗**按钮的可点性都来自 `certClickableActions`
//   ——「这颗按钮点了会提交哪个 Action」与「该 Action 是否被 `uiAllows` 放行」是同一张表，
//   渲染循环只消费 `clickable.has(...)`，不再另写一份显隐判据。
//   此前这里有三份手写条件（`!pending.includes(seat)` / `used` / `pending.includes(seat) ∧ ¬appealed`），
//   它们与 `uiAllows` 并不等价 ⇒「UI 可点性的唯一来源是 legal-gate」这句承诺在 DOM 里是假的。
//   常驻用例「面板可点性 == 引擎认证面」与「接线（R-1/R-2 常驻）」把这条钉住。

import type { State } from '../../engine/core/state.ts';
import type { Action } from '../../engine/core/action.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el, button, section } from './dom.ts';
import { certificationThreshold, signatureCount } from '../../engine/core/certification.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { uiAllows, uiBlockNotice } from '../legal-gate.ts';

/** 认证面板所需的回调。 */
export interface CertCallbacks {
  readonly onSign: (target: number) => void;
  readonly onChallenge: (target: number, questions: readonly string[]) => void;
  readonly onAbstain: (target: number) => void;
  readonly onJudge: (target: number, passed: boolean) => void;
  readonly onAppeal: (target: number) => void;
  /** 第三方复议投票（§5.3.2）：overturn=true 推翻原判 / false 维持原判。 */
  readonly onAppealVote: (target: number, overturn: boolean) => void;
}

/**
 * 面板上每一颗按钮**将要提交**的动作（只描述「有什么按钮」，不含显隐判断）。
 *
 * ⚠️ 结构与 `candidatesOf` / `uiCandidates` 的认证面逐项对齐，其中 `pending` 为空时整面不发
 *   ——引擎此刻已没有认证窗口（`certificationCandidates` 的同一条早退），
 *   残留的 `appealed` 因此也不再发复议票候选。
 */
export function certPanelActions(state: State, seat: number): Action[] {
  const c = state.certification;
  if (c.pending.length === 0) { return []; }
  const out: Action[] = [];
  for (const target of c.pending) {
    out.push({ type: 'CERTIFY_SIGN', actor: seat, target });
    out.push({ type: 'CERTIFY_CHALLENGE', actor: seat, target });
    out.push({ type: 'CERTIFY_ABSTAIN', actor: seat, target });
    out.push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: true });
    out.push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: false });
  }
  out.push({ type: 'CERTIFY_APPEAL', actor: seat, target: seat });
  for (const target of c.appealed) {
    out.push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: true });
    out.push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: false });
  }
  return out;
}

/**
 * 面板**可点**的动作集合——渲染的唯一依据（规格 §7 / 裁定 R-1）。
 *
 * 导出是为了让 `tests/engine/legal-probe.test.ts` 在没有 DOM 的情况下断言
 * 「面板按钮集合 == 引擎认证面合法集合」：这正是发现 A 要的机器覆盖
 * （手写显隐条件一回流，这张表与引擎的比对立刻变红）。
 */
export function certClickableActions(state: State, seat: number): Action[] {
  return certPanelActions(state, seat).filter((a) => uiAllows(state, seat, a));
}

export function renderCertification(
  state: State,
  theme: ThemePack,
  seat: number,
  cb: CertCallbacks,
): HTMLElement {
  const c = state.certification;
  const body: (Node | string)[] = [];
  const pending = c.pending;
  if (pending.length === 0) {
    return section('活人认证', el('span', { class: 'muted', text: '（当前无待认证者）' }));
  }
  if (pending.length >= 2) {
    body.push(el('div', { class: 'warn', text: '双人互验：双方互相出题认证，门槛为 1 枚签印。' }));
  }
  for (const target of pending) {
    const tp = state.players[target];
    const need = certificationThreshold(state, target);
    const got = signatureCount(state, target);
    body.push(el('div', { class: 'cert-target', text: '待认证者：座' + target + '（' + (tp?.identityId ?? '?') + '）　签印 ' + got + ' / 需 ' + need }));
  }
  // ---- 可点性唯一来源：certClickableActions（= certPanelActions ∩ uiAllows）----
  const clickable = new Set(certClickableActions(state, seat).map(actionKey));
  /** 这颗按钮将要提交的动作是否被放行（判据唯一来源 = `uiAllows`）。 */
  const can = (action: Action): boolean => clickable.has(actionKey(action));
  /** 放行才产出按钮；被挡住的**不进 DOM**（发现 A：不给玩家留点了就失败的死按钮）。 */
  const gated = (action: Action, label: string, fire: () => void): HTMLButtonElement | null =>
    can(action) ? button(label, fire) : null;
  /** 有按钮才成行（空行也不留）；`prefix` 只在行真的成立时才挂上。 */
  const rowOf = (cells: (HTMLButtonElement | null)[], prefix?: Node): HTMLElement | null => {
    const live = cells.filter((x): x is HTMLButtonElement => x !== null);
    if (live.length === 0) { return null; }
    const row = el('div', { class: 'btn-row' });
    if (prefix !== undefined) { row.append(prefix); }
    for (const cell of live) { row.append(cell); }
    return row;
  };

  // ---- 认证人的选择：签印 / 质疑 / 弃权（逐按钮过闸）----
  let rows = 0;
  for (const target of pending) {
    const row = rowOf([
      gated({ type: 'CERTIFY_SIGN', actor: seat, target }, '签印 座' + target, () => { cb.onSign(target); }),
      gated({ type: 'CERTIFY_CHALLENGE', actor: seat, target }, '质疑 座' + target, () => { showQuestionForm(target); }),
      gated({ type: 'CERTIFY_ABSTAIN', actor: seat, target }, '弃权', () => { cb.onAbstain(target); }),
    ]);
    if (row !== null) { body.push(row); rows += 1; }
  }
  // ---- 待认证者的复议（同样过闸：灵枢不足时不再挂出必然失败的那颗按钮 ⇒ 行为变化 3）----
  {
    const row = rowOf([gated({ type: 'CERTIFY_APPEAL', actor: seat, target: seat },
      '申请复议（-2 ' + theme.glossary.resource + '）', () => { cb.onAppeal(seat); })]);
    if (row !== null) { body.push(row); rows += 1; }
  }
  // ---- 认证人的判定（已质疑且尚未判定；逐按钮过闸）----
  for (const target of pending) {
    const row = rowOf([
      gated({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: true }, '判定通过 座' + target, () => { cb.onJudge(target, true); }),
      gated({ type: 'CERTIFY_ANSWER', actor: seat, target, passed: false }, '判定不通过 座' + target, () => { cb.onJudge(target, false); }),
    ]);
    if (row !== null) { body.push(row); rows += 1; }
  }
  // ---- 第三方复议投票（§5.3.2）：判不通过后由非当事人裁定 ----
  // ⚠️ Task 7：数字轨此前完全没有复议票入口（人只能「申请复议」却投不了票，只有模拟器会程序化投）。
  //   显隐统一交 `uiAllows`——它已按引擎口径放行「同场另一名待认证者」（co-pending 仍是独立第三方）。
  // ⚠️ G-g（评审发现 E / 裁定 R-5）：这张票在数字轨**只被记录、无人裁定**——
  //   `resolveAppeals` 在 `engine/**` 与 `web/**` 零调用方（仅 `tests/sim/run.mjs` 调它），
  //   且 `applyAppealOutcome` 不清 `appealed` ⇒ 投票写进的是一个不会被关掉的窗口。
  //   「投票窗口何时关闭」属流程层的未决设计，已登记为 G-g 交 Task 9；本入口不等于复议端到端完成。
  for (const target of c.appealed) {
    const row = rowOf([
      gated({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: true }, '推翻原判', () => { cb.onAppealVote(target, true); }),
      gated({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn: false }, '维持原判', () => { cb.onAppealVote(target, false); }),
    ], el('span', { class: 'muted', text: '复议 座' + target + '：' }));
    if (row !== null) { body.push(row); rows += 1; }
  }
  // ---- 说明文字：只解释「为什么这一面一颗按钮都没有」，**不**参与可点性判断 ----
  // 文案直接取同一道闸的拒因（R-2：拒绝要说人话），不再另抄一份条件。
  if (rows === 0) {
    const first = pending[0];
    const why = first === undefined
      ? null
      : uiBlockNotice(state, seat, { type: 'CERTIFY_SIGN', actor: seat, target: first });
    const said = pending.includes(seat) && c.appealed.includes(seat)
      ? '你已申请本轮复议，等待第三方裁定。'
      : why ?? '（当前没有可点的认证动作）';
    body.push(el('span', { class: 'muted', text: said }));
  }

  function showQuestionForm(target: number): void {
    const form = el('div', { class: 'q-form' });
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < 3; i++) {
      const inp = el('input', { class: 'q-input', type: 'text', placeholder: '第 ' + (i + 1) + ' 问' });
      inputs.push(inp);
      form.append(inp);
    }
    const hint = el('div', { class: 'muted', text: '题目须「当场可验证」；答对 2 问即通过。' });
    form.append(hint);
    form.append(el('div', { class: 'btn-row' }, button('提交质疑', () => {
      const questions = inputs.map((i) => i.value.trim()).filter((s) => s.length > 0);
      if (questions.length === 0) { return; }
      cb.onChallenge(target, questions);
    })));
    body.push(form);
  }

  // ---- 认证题卡（主题提供保底题库）----
  if (theme.certificationCards.length > 0) {
    const pool = el('div', { class: 'cert-pool' });
    for (const cc of theme.certificationCards) {
      pool.append(el('div', { class: 'cert-prompt', text: cc.prompt }));
    }
    body.push(el('details', { class: 'cert-pool-wrap' }, el('summary', { text: '主题认证题卡（' + theme.certificationCards.length + ' 张）' }), pool));
  }

  return section('活人认证', ...body);
}
