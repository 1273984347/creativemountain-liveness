// 数字轨入口（规格 §6.6）。
//
// 单文件 HTML：引擎 + UI + 主题数据内联，双击即玩、离线可用、无外部请求。

import { createInitialState, type State } from '../engine/core/state.ts';
import { currentPlayer, isRoundEnd } from '../engine/core/round.ts';
import { performAction, advanceTurn, needsCouncilVote, needsCertificationAction } from '../engine/core/turn-runner.ts';
import { castVote, resolveCouncil } from '../engine/core/council.ts';
import { certifySign, certifyChallenge, certifyAbstain, certifyAnswer, certifyAppeal } from '../engine/core/certification.ts';
import { stateToJson, stateFromJson } from '../engine/core/serialize.ts';
import { assignIdentitiesAndFactions } from '../engine/core/setup.ts';
import { THEMES, themeById } from './theme.ts';
import { el, button, section } from './ui/dom.ts';
import { renderBoard } from './ui/board.ts';
import { renderHand, renderPlayers } from './ui/hand.ts';
import { renderLog } from './ui/log.ts';
import { renderCouncil } from './ui/council.ts';
import { renderCertification } from './ui/cert.ts';
import { runTutorial } from './tutorial.ts';

/** UI 全局状态。 */
interface Ui {
  state: State;
  themeId: string;
  playerCount: 3 | 4 | 5 | 6 | 7 | 8;
  mode: 'standard' | 'newbie';
  seat: number;
}

const SAVE_KEY = 'creativemountain.save.v1';

const initialTheme = themeById(THEMES[0]?.id ?? 'xianxia2026').theme;

const ui: Ui = {
  state: assignIdentitiesAndFactions(
    createInitialState({ players: 4, seed: 42, deckSize: initialTheme.counts.deckTotal }),
    initialTheme,
  ),
  themeId: initialTheme.meta.id,
  playerCount: 4,
  mode: 'newbie',
  seat: 0,
};

function newGame(): void {
  const theme = themeById(ui.themeId).theme;
  ui.state = createInitialState({ players: ui.playerCount, seed: 42, deckSize: theme.counts.deckTotal });
  ui.state = assignIdentitiesAndFactions(ui.state, theme);
  ui.seat = 0;
  render();
}

function saveGame(): void {
  try {
    localStorage.setItem(SAVE_KEY, stateToJson(ui.state));
    render();
  } catch (e) {
    alert('存档失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function loadGame(): void {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw === null) {
    alert('没有找到存档');
    return;
  }
  try {
    ui.state = stateFromJson(raw);
    ui.playerCount = ui.state.players.length as Ui['playerCount'];
    render();
  } catch (e) {
    alert('读档失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function exportSave(): void {
  const blob = new Blob([stateToJson(ui.state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '创界山-活人认证-存档.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSave(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined) { return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        ui.state = stateFromJson(String(reader.result));
        ui.playerCount = ui.state.players.length as Ui['playerCount'];
        render();
      } catch (e) {
        alert('导入失败：' + (e instanceof Error ? e.message : String(e)));
      }
    };
    reader.readAsText(file);
  });
  input.click();
}
/** 主题与模式切换栏。 */
function renderToolbar(): HTMLElement {
  const bar = el('div', { class: 'toolbar' });
  // 主题
  const themeSel = el('select', { class: 'sel' });
  for (const t of THEMES) {
    const opt = el('option', { value: t.id, text: t.name });
    if (t.id === ui.themeId) { opt.selected = true; }
    themeSel.append(opt);
  }
  themeSel.addEventListener('change', () => {
    ui.themeId = themeSel.value;
    const theme = themeById(ui.themeId).theme;
    ui.state = assignIdentitiesAndFactions(ui.state, theme);
    render();
  });
  bar.append(el('label', { class: 'lbl', text: '主题' }), themeSel);
  // 人数
  const countSel = el('select', { class: 'sel' });
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const opt = el('option', { value: String(n), text: n + ' 人' });
    if (n === ui.playerCount) { opt.selected = true; }
    countSel.append(opt);
  }
  countSel.addEventListener('change', () => {
    ui.playerCount = Number(countSel.value) as Ui['playerCount'];
    newGame();
  });
  bar.append(el('label', { class: 'lbl', text: '人数' }), countSel);
  // 模式
  const modeSel = el('select', { class: 'sel' });
  for (const [v, label] of [['standard', '标准'], ['newbie', '新手（推荐首局）']] as const) {
    const opt = el('option', { value: v, text: label });
    if (v === ui.mode) { opt.selected = true; }
    modeSel.append(opt);
  }
  modeSel.addEventListener('change', () => {
    ui.mode = modeSel.value === 'standard' ? 'standard' : 'newbie';
    render();
  });
  bar.append(el('label', { class: 'lbl', text: '模式' }), modeSel);
  // 座位切换（热座：谁在操作就选谁）
  const seatSel = el('select', { class: 'sel' });
  for (const p of ui.state.players) {
    const opt = el('option', { value: String(p.seat), text: '座' + p.seat });
    if (p.seat === ui.seat) { opt.selected = true; }
    seatSel.append(opt);
  }
  seatSel.addEventListener('change', () => {
    ui.seat = Number(seatSel.value);
    render();
  });
  bar.append(el('label', { class: 'lbl', text: '操作者' }), seatSel);
  // 操作
  bar.append(button('新开一局', () => { newGame(); }));
  bar.append(button('存档', () => { saveGame(); }));
  bar.append(button('读档', () => { loadGame(); }));
  bar.append(button('导出', () => { exportSave(); }));
  bar.append(button('导入', () => { importSave(); }));
  bar.append(button('教学演示', () => { showTutorial(); }));
  return bar;
}

/** 行动区（行棋 / 问天 / 行事）。 */
function renderActions(): HTMLElement {
  const theme = themeById(ui.themeId).theme;
  const seat = ui.seat;
  const player = ui.state.players[seat];
  const body: (Node | string)[] = [];
  if (player === undefined || !player.alive) {
    body.push(el('span', { class: 'muted', text: '该玩家已出局。' }));
    return section('行动', ...body);
  }
  if (player.pendingCert) {
    body.push(el('span', { class: 'warn', text: '待认证锁定：你已在峰顶，不能主动移动（只能被质疑后退）。' }));
    return section('行动', ...body);
  }
  const row = el('div', { class: 'btn-row' });
  row.append(button('行棋（掷 6 面，必须走满）', () => {
    ui.state = performAction(ui.state, seat, 'move');
    ui.state = advanceTurn(ui.state, ui.mode);
    render();
  }));
  row.append(button('问天（掷 20 面指令骰）', () => {
    ui.state = performAction(ui.state, seat, 'ask');
    ui.state = advanceTurn(ui.state, ui.mode);
    render();
  }));
  body.push(row);
  body.push(el('div', { class: 'muted', text: '出牌：点击手牌中的卡牌（费用自动结算）。' }));
  body.push(renderHand(ui.state, theme, seat, (cardId) => {
    ui.state = performAction(ui.state, seat, 'act', { cardId });
    ui.state = advanceTurn(ui.state, ui.mode);
    render();
  }));
  return section('行动', ...body);
}
/** 教学演示弹窗。 */
function showTutorial(): void {
  const steps = runTutorial(ui.playerCount);
  const box = el('div', { class: 'modal' });
  const close = button('关闭', () => { box.remove(); });
  const body = el('div', { class: 'modal-body' });
  body.append(el('h3', { class: 'modal-title', text: '教学演示：5 回合迷你流程' }));
  for (const [i, st] of steps.entries()) {
    const item = el('div', { class: 'tut-step' });
    item.append(el('div', { class: 'tut-title', text: (i + 1) + '. ' + st.title }));
    item.append(el('div', { class: 'tut-detail', text: st.detail }));
    body.append(item);
  }
  body.append(el('div', { class: 'btn-row' }, close));
  box.append(body);
  document.body.append(box);
}

/** 主渲染。 */
function render(): void {
  const root = document.getElementById('app');
  if (root === null) { return; }
  const theme = themeById(ui.themeId).theme;
  const s = ui.state;

  const status = el('div', { class: 'status' });
  status.append(el('span', { text: '回合 ' + s.round + ' / 上限 ' + s.scales.globalRoundLimit }));
  status.append(el('span', { text: '当前行动者 座' + currentPlayer(s) }));
  status.append(el('span', { text: '轮末 ' + (isRoundEnd(s) ? '是' : '否') }));
  status.append(el('span', { text: '签印门槛 N=' + s.scales.threshold }));
  if (s.outcome.finished) {
    const reason = s.outcome.reason === 'certified' ? '认证封顶' : s.outcome.reason === 'fallback' ? '回合上限兜底' : '活人缺席';
    status.append(el('span', { class: 'badge win', text: '本局结束：' + reason + (s.outcome.winners.length > 0 ? '（座 ' + s.outcome.winners.join(',') + '）' : '（无胜者）') }));
  }

  const panels: (Node | string)[] = [
    renderToolbar(),
    section('山道', renderBoard(s)),
    renderPlayers(s, theme),
  ];
  // 山议面板
  if (needsCouncilVote(s)) {
    panels.push(renderCouncil(s, ui.seat,
      (target) => { const r = castVote(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      () => { const r = resolveCouncil(s); ui.state = r.ok ? r.state : s; render(); },
    ));
  }
  // 认证面板
  if (needsCertificationAction(s) || s.certification.pending.length > 0) {
    panels.push(renderCertification(s, theme, ui.seat, {
      onSign: (target) => { const r = certifySign(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      onChallenge: (target, questions) => {
        const ch = certifyChallenge(s, ui.seat, target);
        if (!ch.ok) { alert(ch.note ?? '无法发起质疑'); return; }
        const withLog = { ...ch.state, log: [...ch.state.log, { round: ch.state.round, turnIndex: ch.state.turnIndex, actor: ui.seat, kind: 'certify', message: '对座' + target + ' 发起质疑：' + questions.join(' / ') }] };
        ui.state = withLog;
        render();
      },
      onAbstain: (target) => { const r = certifyAbstain(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      onJudge: (target, passed) => { const r = certifyAnswer(s, ui.seat, target, passed); ui.state = r.ok ? r.state : s; render(); },
      onAppeal: (target) => { const r = certifyAppeal(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
    }));
  }
  panels.push(renderActions());
  panels.push(section('日志', renderLog(s)));

  root.innerHTML = '';
  root.append(el('h1', { class: 'title', text: '创界山·活人认证 —— ' + theme.meta.name }));
  root.append(status);
  for (const p2 of panels) {
    root.append(typeof p2 === 'string' ? document.createTextNode(p2) : p2);
  }
}

render();
