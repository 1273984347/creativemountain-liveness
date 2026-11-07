// 活人认证面板（规格 §5.3–§5.5）——本作的核心交互。
//
// 三种选择：**签印 / 质疑 / 弃权**（§5.3.1）；
// 质疑需出 3 题并逐题判定（§5.3.2）；
// 判不通过时待认证者可付费申请复议（§5.3.2）。

import type { State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { el, button, section } from './dom.ts';
import { certificationThreshold, signatureCount } from '../../engine/core/certification.ts';

/** 认证面板所需的回调。 */
export interface CertCallbacks {
  readonly onSign: (target: number) => void;
  readonly onChallenge: (target: number, questions: readonly string[]) => void;
  readonly onAbstain: (target: number) => void;
  readonly onJudge: (target: number, passed: boolean) => void;
  readonly onAppeal: (target: number) => void;
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
  // ---- 认证人的选择 ----
  if (!pending.includes(seat)) {
    const used = c.signed.includes(seat) || c.challenged.includes(seat) || c.abstained.includes(seat);
    if (used) {
      body.push(el('span', { class: 'muted', text: '你本轮的认证机会已用（签印 / 质疑 / 弃权 三选一）。' }));
    } else {
      for (const target of pending) {
        const row = el('div', { class: 'btn-row' });
        row.append(button('签印 座' + target, () => { cb.onSign(target); }));
        row.append(button('质疑 座' + target, () => { showQuestionForm(target); }));
        row.append(button('弃权', () => { cb.onAbstain(target); }));
        body.push(row);
      }
    }
  }
  // ---- 待认证者的复议 ----
  if (pending.includes(seat)) {
    if (c.appealed.includes(seat)) {
      body.push(el('span', { class: 'muted', text: '你已申请本轮复议，等待第三方裁定。' }));
    } else {
      const row = el('div', { class: 'btn-row' });
      row.append(button('申请复议（-2 灵枢）', () => { cb.onAppeal(seat); }));
      body.push(row);
    }
  }
  // ---- 认证人的判定（已质疑但未判定）----
  if (c.challenged.includes(seat) && c.judgments[seat] === undefined) {
    for (const target of pending) {
      const row = el('div', { class: 'btn-row' });
      row.append(button('判定通过 座' + target, () => { cb.onJudge(target, true); }));
      row.append(button('判定不通过 座' + target, () => { cb.onJudge(target, false); }));
      body.push(row);
    }
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
