// 数字轨入口（规格 §6.6）。
//
// 单文件 HTML：引擎 + UI + 主题数据内联，双击即玩、离线可用、无外部请求。

import { createInitialState, type State } from '../engine/core/state.ts';
import { currentPlayer, isRoundEnd } from '../engine/core/round.ts';
import { performAction, advanceTurn, needsCouncilVote, needsCertificationAction } from '../engine/core/turn-runner.ts';
import { castVote, resolveCouncil } from '../engine/core/council.ts';
import { certifySign, certifyChallenge, certifyAbstain, certifyAnswer, certifyAppeal } from '../engine/core/certification.ts';
import { stateToJson, stateFromJson } from '../engine/core/serialize.ts';
import { installTheme } from '../engine/core/setup.ts';
import { THEMES, themeById } from './theme.ts';
import { el, button, section } from './ui/dom.ts';
import { renderBoard } from './ui/board.ts';
import { renderHand, renderPlayers } from './ui/hand.ts';
import { cardNeedsTarget, resolveTargetPick, targetCandidates } from '../engine/core/targeting.ts';
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
  /** 正在选目标的卡牌 id（null = 不在选目标模式） */
  pendingTargetCardId: string | null;
}

const SAVE_KEY = 'creativemountain.save.v2';

/**
 * 存档信封：**必须带主题标识**。
 *
 * ⚠️ B8 修正：此前存档只存 State，不含主题身份 —— 读一份科幻主题的档后，
 *   下拉框仍显示默认的「仙侠·2026」，而牌池装的是科幻卡；
 *   此后任何一次主题切换都会把新主题装进这个半局。
 *   （B8 之前牌库恒为测试牌，读档不涉及主题身份，故此坑此前不显形。）
 */
interface SaveEnvelope {
  readonly v: 2;
  readonly themeId: string;
  readonly state: string;
}

/** 打包存档信封。 */
function packSave(themeId: string, state: State): string {
  const envelope: SaveEnvelope = { v: 2, themeId, state: stateToJson(state) };
  return JSON.stringify(envelope);
}

/** 拆存档信封（兼容旧的裸 State 格式）。 */
function unpackSave(raw: string): { themeId: string | null; state: State } {
  let themeId: string | null = null;
  let payload = raw;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.state === 'string') {
      themeId = typeof parsed.themeId === 'string' ? parsed.themeId : null;
      payload = parsed.state;
    }
  } catch {
    // 旧格式（裸 State JSON）⇒ 按原样交给 stateFromJson
  }
  return { themeId, state: stateFromJson(payload) };
}

const initialTheme = themeById(THEMES[0]?.id ?? 'xianxia2026').theme;

const ui: Ui = {
  state: installTheme(
    createInitialState({ players: 4, seed: 42, deckSize: initialTheme.counts.deckTotal }),
    initialTheme,
  ),
  themeId: initialTheme.meta.id,
  playerCount: 4,
  mode: 'newbie',
  seat: 0,
  pendingTargetCardId: null,
};

function newGame(): void {
  const theme = themeById(ui.themeId).theme;
  ui.state = installTheme(
    createInitialState({ players: ui.playerCount, seed: 42, deckSize: theme.counts.deckTotal }),
    theme,
  );
  ui.seat = 0;
  ui.pendingTargetCardId = null;
  render();
}

function saveGame(): void {
  try {
    localStorage.setItem(SAVE_KEY, packSave(ui.themeId, ui.state));
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
    const { themeId, state } = unpackSave(raw);
    if (themeId !== null) {
      ui.themeId = themeId;
    }
    ui.state = state;
    ui.playerCount = ui.state.players.length as Ui['playerCount'];
    render();
  } catch (e) {
    alert('读档失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

function exportSave(): void {
  const blob = new Blob([packSave(ui.themeId, ui.state)], { type: 'application/json' });
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
        const { themeId, state } = unpackSave(String(reader.result));
        if (themeId !== null) {
          ui.themeId = themeId;
        }
        ui.state = state;
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
    // 换主题 = 换一局：牌池 / 棋盘 / 天机 / 试炼 / 认证题整套装上
    ui.state = installTheme(ui.state, theme);
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
    ui.pendingTargetCardId = null;
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

/**
 * 出牌（可选带目标）。
 *
 * ⚠️ 目标由玩家**点选**决定（见 renderActions）：主题包里攻击牌的 `target: 0`
 *   只是占位，若不覆盖就会永远打座位 0。
 */
function playCard(cardId: string, target?: number): void {
  const seat = ui.seat;
  ui.pendingTargetCardId = null;
  ui.state = performAction(ui.state, seat, 'act', target === undefined ? { cardId } : { cardId, target });
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/** 玩家点选了一个目标（座号）。点自己 = 取消。 */
function onPickTarget(picked: number): void {
  if (ui.pendingTargetCardId === null) {
    return;
  }
  const payload = resolveTargetPick(ui.state, ui.seat, ui.pendingTargetCardId, picked);
  if (payload === null) {
    ui.pendingTargetCardId = null;
    render();
    return;
  }
  playCard(payload.cardId, payload.target);
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
  body.push(el('div', { class: 'muted', text: '出牌：点击手牌中的卡牌（费用自动结算）。攻击类牌需要**再点一名对手**选定目标。' }));
  if (ui.pendingTargetCardId !== null) {
    body.push(el('div', { class: 'warn', text: '选择目标：点击下方一名对手（点自己或再次点该牌取消）。' }));
  }
  body.push(renderHand(ui.state, theme, seat, (cardId) => {
    // 已在选目标模式且再次点同一张牌 ⇒ 取消
    if (ui.pendingTargetCardId === cardId) {
      ui.pendingTargetCardId = null;
      render();
      return;
    }
    const card = player.hand.find((c) => c.id === cardId);
    if (card !== undefined && cardNeedsTarget(card) && targetCandidates(ui.state, seat).length > 0) {
      ui.pendingTargetCardId = cardId;
      render();
      return;
    }
    playCard(cardId);
  }, ui.pendingTargetCardId));
  return section('行动', ...body);
}
/** 教学演示弹窗。 */
function showTutorial(): void {
  const steps = runTutorial(themeById(ui.themeId).theme, ui.playerCount);
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
  // 行动顺序是**开局随机决定**的（B10）⇒ 显式展示，避免玩家以为「按座号轮」
  status.append(el('span', { text: '行动顺序 ' + s.turnOrder.map((x) => '座' + x).join('→') }));
  status.append(el('span', { text: '轮末 ' + (isRoundEnd(s) ? '是' : '否') }));
  status.append(el('span', { text: '签印门槛 N=' + s.scales.threshold }));
  if (s.outcome.finished) {
    const reason = s.outcome.reason === 'certified' ? '认证封顶' : s.outcome.reason === 'fallback' ? '回合上限兜底' : '活人缺席';
    status.append(el('span', { class: 'badge win', text: '本局结束：' + reason + (s.outcome.winners.length > 0 ? '（座 ' + s.outcome.winners.join(',') + '）' : '（无胜者）') }));
  }

  const panels: (Node | string)[] = [
    renderToolbar(),
    section('山道', renderBoard(s)),
    renderPlayers(s, theme, (picked) => { onPickTarget(picked); }, ui.pendingTargetCardId !== null),
  ];
  // 山议面板
  if (needsCouncilVote(s)) {
    panels.push(renderCouncil(s, theme, ui.seat,
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
