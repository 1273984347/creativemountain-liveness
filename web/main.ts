// 数字轨入口（规格 §6.6）。
//
// 单文件 HTML：引擎 + UI + 主题数据内联，双击即玩、离线可用、无外部请求。

import { createInitialState, type State } from '../engine/core/state.ts';
import { currentPlayer, isRoundEnd } from '../engine/core/round.ts';
import { performAction, advanceTurn, needsCouncilVote, needsCertificationAction } from '../engine/core/turn-runner.ts';
import { castVote, resolveCouncil, useCouncilVeto } from '../engine/core/council.ts';
import { certifySign, certifyChallenge, certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote, certifyMutualSign } from '../engine/core/certification.ts';
import { stateToJson, stateFromJson } from '../engine/core/serialize.ts';
import { installTheme } from '../engine/core/setup.ts';
import type { Action } from '../engine/core/action.ts';
import { uiAllows, uiBlockNotice, uiHasLegalTarget, uiCandidates, pendingGateHere, pendingBarrierHere } from './legal-gate.ts';
import { resolveGate, resolveCompareGate } from '../engine/core/gate.ts';
import { resolveBarrier } from '../engine/core/barrier.ts';
import { THEMES, themeById } from './theme.ts';
import { termExpander } from './ui/terms.ts';
import { el, button, section } from './ui/dom.ts';
import { renderBoard } from './ui/board.ts';
import { renderHand, renderPlayers } from './ui/hand.ts';
import { cardNeedsTarget, resolveTargetPick } from '../engine/core/targeting.ts';
import { performAbility } from '../engine/core/abilities.ts';
import { abilityAvailability, activeAbilityId } from '../engine/core/passives.ts';
import { submitDuelCard } from '../engine/core/duel.ts';
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
  /** B12：发动身份被动时等待选目标（窃火者偷灵枢） */
  pendingAbility: boolean;
  /** B19-c：关隘出牌比对 —— 已选定的对手座位号（null = 未进入比对选择） */
  pendingCompareTarget: number | null;
  /**
   * B75：装备模式 —— 开启后「点一张手牌」= 装备它（而不是打出它）。
   * ⚠️ 与 `pendingTargetCardId` / `pendingCompareTarget` 互斥：进入任一模式都要清掉另两个，
   *   否则同一个点击被两条入口各认一次（装备模式 + 比对模式 = 点一张牌做两件事）。
   */
  equipMode: boolean;
  /** 一次性提示（发动结果 / 失败原因） */
  notice: string | null;
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
  pendingAbility: false,
  pendingCompareTarget: null,
  equipMode: false,
  notice: null,
};

function newGame(): void {
  const theme = themeById(ui.themeId).theme;
  ui.state = installTheme(
    createInitialState({ players: ui.playerCount, seed: 42, deckSize: theme.counts.deckTotal }),
    theme,
  );
  ui.seat = 0;
  ui.pendingTargetCardId = null;
  ui.pendingAbility = false;
  ui.pendingCompareTarget = null;
  ui.notice = null;
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
    ui.pendingCompareTarget = null;
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
 * B75：装备一张手牌（手牌 → 装备区，免费、不占手牌上限）。
 *
 * ⚠️ 与出牌同款「先问闸再提交」：判据只有 `web/legal-gate.ts` 与引擎两处，UI 不再自己判窗口；
 *   被拒时把 `uiBlockNotice` 的拒因写进 notice（拒绝不沉默），并**退出装备模式**——
 *   留在模式里会让下一次点击继续撞同一堵墙。
 */
/**
 * B76：力竭恢复（自恢 / 救援）。与装备同款「先问闸再提交」：判据只有 legal-gate 与引擎两处，
 * 被拒时把拒因写进 notice（拒绝不沉默）。恢复占掉本手番的唯一行动（自恢 2 灵枢 / 救援 1 灵枢）。
 */
function recuperate(target?: number): void {
  const seat = ui.seat;
  const action: Action = target === undefined ? { type: 'RECUPERATE', actor: seat } : { type: 'RECUPERATE', actor: seat, target };
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前不可恢复。';
    render();
    return;
  }
  ui.state = performAction(ui.state, seat, 'recuperate', target === undefined ? {} : { target });
  ui.state = advanceTurn(ui.state, ui.mode);   // 恢复占掉本手番的唯一行动（设计规格 §3）
  ui.notice = target === undefined ? '自恢成功：力竭解除。' : '救援成功：座位 ' + String(target) + ' 的力竭解除。';
  render();
}

/**
 * B77：结束手番 —— 被 `skip_turn` 封住时的唯一出口。同款「先问闸再提交」（判据只在
 * legal-gate 与引擎两处，UI 不管显隐之外的判断）；PASS 本身**不结算任何东西**，
 * 地形 / 收入 / 护盾 / 裁牌仍由随后的 `advanceTurn → finishTurn` 负责（B18-c 解耦）。
 */
function passTurn(): void {
  const seat = ui.seat;
  const action: Action = { type: 'PASS', actor: seat };
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前不能结束手番。';
    render();
    return;
  }
  ui.state = advanceTurn(performAction(ui.state, seat, 'pass'), ui.mode);
  ui.notice = '已停手番：本回合你没有采取行动（回合末结算照常）。';
  render();
}

function equipCard(cardId: string): void {
  const seat = ui.seat;
  ui.pendingTargetCardId = null;
  ui.pendingCompareTarget = null;
  const action: Action = { type: 'EQUIP_CARD', actor: seat, cardId };
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前不可装备该牌。';
    ui.equipMode = false;
    render();
    return;
  }
  ui.state = performAction(ui.state, seat, 'equip', { cardId });
  ui.state = advanceTurn(ui.state, ui.mode);   // 装备占掉本手番的唯一行动（B75 设计 §4.1）
  ui.equipMode = false;
  render();
}

/**
 * 出牌（可选带目标）。
 *
 * ⚠️ 目标由玩家**点选**决定（见 renderActions）：主题包里攻击牌的 `target: 0`
 *   只是占位，若不覆盖就会永远打座位 0。
 */
function playCard(cardId: string, target?: number): void {
  const seat = ui.seat;
  // 门禁:出牌提交 —— 提交路径（含 `onPickTarget → resolveTargetPick → playCard` 这条选目标支路）
  //   同样过闸，且按**将要提交的完整形状**问：带目标的攻击牌由此与不需目标的普通牌同闸同源
  //   （评审发现 A 旁路二·出：此前只有非选目标那一支有闸，山议阶段攻击牌照样打得出去）。
  const action: Action = target === undefined
    ? { type: 'PLAY_CARD', actor: seat, cardId }
    : { type: 'PLAY_CARD', actor: seat, cardId, target };
  ui.pendingTargetCardId = null;
  if (!uiAllows(ui.state, seat, action)) {
    // 门禁:拒绝不沉默 —— 被闸挡下时把拒因写进 ui.notice（评审发现 B：点了没反应等于死按钮）。
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前不可打出该牌。';
    render();
    return;
  }
  ui.state = performAction(ui.state, seat, 'act', target === undefined ? { cardId } : { cardId, target });
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/** 玩家点选了一个目标（座号）。点自己 = 取消。 */
function onPickTarget(picked: number): void {
  // B12：发动被动的选目标模式（窃火者偷灵枢）
  if (ui.pendingAbility) {
    if (picked === ui.seat) {
      ui.pendingAbility = false;
      render();
      return;
    }
    useAbility(picked);
    return;
  }
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

/**
 * 提交关隘通道选择（规格 §3.5，B18）：**付费** / **试炼**。
 *
 * ⚠️ 通道选择发生在**结算阶段**（到达关隘后手番暂停）⇒ 不是行动三选一的一部分。
 *   引擎层对其它行动有硬门禁（停在关隘上时一律拒绝），所以这里只有两条路可走。
 */
function resolveGateChannel(channel: 'pay' | 'trial'): void {
  const seat = ui.seat;
  const action: Action = { type: 'GATE_RESOLVE', actor: seat, channel };
  // 门禁:关隘提交 —— 与出牌 / 被动同闸（拒绝不沉默：被闸挡下要把拒因写进 notice）。
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前无法选择该通道。';
    render();
    return;
  }
  const r = resolveGate(ui.state, seat, channel);
  if (!r.ok) {
    ui.notice = '{gate}结算失败：' + r.note;
    render();
    return;
  }
  ui.state = r.state;
  ui.notice = r.note ?? '';
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/**
 * 提交裂隙通道选择（规格 §3.4，B18-b）：**放印** / **不放**。
 *
 * ⚠️ 与关隘同款：发生在**结算阶段**（落到裂隙格后手番暂停），不是行动三选一的一部分。
 */
function resolveBarrierChannel(channel: 'place' | 'skip'): void {
  const seat = ui.seat;
  const action: Action = { type: 'BARRIER_RESOLVE', actor: seat, channel };
  // 门禁:裂隙提交 —— 拒绝不沉默。
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前无法在该{rift}格放置封路印。';
    render();
    return;
  }
  const r = resolveBarrier(ui.state, seat, channel);
  if (!r.ok) {
    ui.notice = '{rift}结算失败：' + r.note;
    render();
    return;
  }
  ui.state = r.state;
  ui.notice = r.note ?? '';
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/**
 * 提交关隘**出牌比对**（规格 §3.5，B19-c）。
 *
 * ⚠️ 两段交互的第二段：玩家已选好对手，这里只差「我出哪张牌」。
 */
function submitCompare(cardId: string, target: number): void {
  const seat = ui.seat;
  ui.pendingCompareTarget = null;
  const action: Action = { type: 'COMPARE', actor: seat, cardId, target };
  // 门禁:比牌提交 —— 与出牌 / 被动 / 关隘通道同闸（拒绝不沉默）。
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '当前无法出牌比对。';
    render();
    return;
  }
  const r = resolveCompareGate(ui.state, seat, cardId, target);
  if (!r.ok) {
    ui.notice = '比牌未能进行：' + r.note;
    render();
    return;
  }
  ui.state = r.state;
  ui.notice = r.note ?? '';
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/**
 * B12：发动身份被动（规格 §4.1 主动型：匠师 / 观星者 / 窃火者 / 织梦者）。
 *
 * 发动**占用本回合的行动**（规格 §3.1 行动三选一）⇒ 成功后直接推进回合。
 */
function useAbility(target?: number): void {
  const seat = ui.seat;
  ui.pendingAbility = false;
  // 门禁:被动提交 —— 选目标模式的提交路径同样过闸，形状取**已选定目标**的那一条
  //   （与出牌同法：按钮显隐只能问「存在合法目标形状」，真提交时才确定目标）。
  const abilityId = activeAbilityId(ui.state, seat);
  const action: Action = target === undefined
    ? { type: 'ABILITY', actor: seat, abilityId }
    : { type: 'ABILITY', actor: seat, abilityId, target };
  if (!uiAllows(ui.state, seat, action)) {
    ui.notice = uiBlockNotice(ui.state, seat, action) ?? '被动未能发动。';
    render();
    return;
  }
  const r = performAbility(ui.state, seat, target);
  if (!r.ok) {
    ui.notice = '被动发动失败：' + r.note;
    render();
    return;
  }
  ui.state = r.state;
  ui.notice = r.note;
  ui.state = advanceTurn(ui.state, ui.mode);
  render();
}

/** 行动区（行棋 / 问天 / 行事）。 */
function renderActions(): HTMLElement {
  const theme = themeById(ui.themeId).theme;
  // 玩家可见文本的主题词展开器（B79 §4.3）——本函数是 notice / 面板 / 按钮的主要产地。
  const t = termExpander(theme.terms);
  const seat = ui.seat;
  const player = ui.state.players[seat];
  const body: (Node | string)[] = [];
  if (player === undefined || !player.alive) {
    body.push(el('span', { class: 'muted', text: '该玩家已出局。' }));
    return section('行动', ...body);
  }
  if (player.pendingCert) {
    body.push(el('span', { class: 'warn', text: '待认证锁定：不能主动移动（位移类牌与被动不可用）；非位移牌仍可打出手牌区打出。' }));
    return section('行动', ...body);
  }
  // ⚠️ B18：停在**未通过的关隘** ⇒ **只显示关隘面板**（回合阻塞，行棋/问天/出牌都暂不可用）。
  const gate = pendingGateHere(ui.state, seat);
  if (gate !== null) {
    const mine = player.resource;
    const canPay = mine >= gate.fee;
    body.push(el('div', { class: 'warn', text: t('{gate}：付费通过（' + String(gate.fee) + ' {resource}）或抽一张试炼牌通过。') }));
    if (!canPay) {
      body.push(el('div', { class: 'muted', text: t('{resource}不足（需 ' + String(gate.fee) + '，现有 ' + String(mine) + '）——只能走试炼通道。') }));
    }
    body.push(button('付费通过（' + String(gate.fee) + '）', () => { resolveGateChannel('pay'); }, !canPay));
    body.push(button('试炼闯关', () => { resolveGateChannel('trial'); }));
    // ⚠️ B19-c：出牌比对通道（**两段交互**：先选对手 → 再点自己的一张牌）。
    //   仅在「本关未转为付费」时提供（转为付费后只剩付费通道）。
    if (!gate.payOnly) {
      if (ui.pendingCompareTarget === null) {
        for (const other of ui.state.players) {
          if (!other.alive || other.seat === seat) { continue; }
          body.push(button('与座' + String(other.seat) + ' 比牌', () => {
            ui.pendingCompareTarget = other.seat;
            ui.notice = '已选座' + String(other.seat) + '：现在点你的一张牌（对方亮出的是他手牌顶）。';
            render();
          }));
        }
      } else {
        body.push(el('div', { class: 'warn', text: '出牌比对：已选座' + String(ui.pendingCompareTarget) + ' —— 点你的一张牌完成比对（对方亮出的是他手牌顶）。' }));
        body.push(button('取消比对', () => {
          ui.pendingCompareTarget = null;
          ui.notice = '已取消出牌比对。';
          render();
        }));
        body.push(renderHand(ui.state, theme, seat, (cardId) => {
          const target = ui.pendingCompareTarget;
          if (target === null) { return; }
          submitCompare(cardId, target);
        }));
      }
    }
    return section(t('{gate}'), ...body);
  }
  // ⚠️ B18-b：停在**可放印的裂隙格** ⇒ 只显示裂隙面板（放印 / 不放）。
  const barrier = pendingBarrierHere(ui.state, seat);
  if (barrier !== null) {
    body.push(el('div', { class: 'warn', text: t('{rift}：可花 ' + String(barrier.cost) + ' {resource} 在这一格放置「封路印」，让后来者必须判定。') }));
    body.push(button('放置封路印（-' + String(barrier.cost) + '）', () => { resolveBarrierChannel('place'); }));
    body.push(button('不放置，直接通过', () => { resolveBarrierChannel('skip'); }));
    return section(t('{rift}'), ...body);
  }
  // ⚠️ B13：对峙未结算 ⇒ **只显示对峙面板**（回合阻塞，行棋/问天/出牌都暂不可用）。
  const duel = ui.state.duel;
  if (duel !== null) {
    const isA = duel.seatA === seat;
    const myPick = isA ? duel.pickA : duel.pickB;
    const oppSeat = isA ? duel.seatB : duel.seatA;
    const oppPick = isA ? duel.pickB : duel.pickA;
    body.push(el('div', { class: 'warn', text: '对峙：座' + duel.seatA + ' vs 座' + duel.seatB + ' —— 双方各自选 1 张牌，选完才同时揭晓。' }));
    if (myPick === undefined) {
      body.push(el('div', { class: 'muted', text: '轮到你（座' + seat + '）锁定亮牌：点击下方手牌中的一张。' }));
    } else if (oppPick === undefined) {
      body.push(el('div', { class: 'muted', text: '你已锁定亮牌，等待座' + oppSeat + ' 选牌（把「操作者」切过去）。' }));
    } else {
      body.push(el('div', { class: 'muted', text: '双方已锁定亮牌 → 揭晓。' }));
    }
    body.push(renderHand(ui.state, theme, seat, (cardId) => {
      const r = submitDuelCard(ui.state, seat, cardId);
      ui.state = r.state;
      ui.notice = r.note;
      if (ui.state.duel === null) {
        // 对峙已揭晓 ⇒ 继续推进被阻塞的手番
        ui.state = advanceTurn(ui.state, ui.mode);
      }
      render();
    }, ui.pendingTargetCardId));
    return section('行动', ...body);
  }
  const row = el('div', { class: 'btn-row' });
  // ⚠️ Task 7：按钮可点性统一交 `web/legal-gate.ts` 的 `uiAllows`（规格 §7「UI 与 AI 同一枚举」）；
  //   按钮内部逻辑（performAction + advanceTurn）一字未动。
  if (uiAllows(ui.state, seat, { type: 'MOVE', actor: seat, steps: 0 })) {
    row.append(button('行棋（掷 6 面，必须走满）', () => {
      ui.state = performAction(ui.state, seat, 'move');
      ui.state = advanceTurn(ui.state, ui.mode);
      render();
    }));
  }
  if (uiAllows(ui.state, seat, { type: 'ROLL_WHEEL', actor: seat })) {
    row.append(button('问天（掷 20 面指令骰）', () => {
      ui.state = performAction(ui.state, seat, 'ask');
      ui.state = advanceTurn(ui.state, ui.mode);
      render();
    }));
  }
  body.push(row);
  // B12：发动身份被动按钮
  // 门禁:被动按钮 —— 评审发现 A 旁路一：旧代码只看 `ability.usable`（`passives.ts` 的可用性），
  //   于是山议阶段 / round 已走完时按钮照样出现、点了照样发动 ⇒ 行动窗口对它形同虚设。
  //   现在显隐交 `uiAllows`：不需目标的被动问无目标形状，需目标的被动问「存在合法目标形状」
  //   （需目标的被动**没有**合法的无目标形状 ⇒ 只能这样问，见 legal-gate 的 uiHasLegalTarget 注释）。
  const ability = abilityAvailability(ui.state, seat);
  const abilityId = activeAbilityId(ui.state, seat);
  const abilityTargetless = uiAllows(ui.state, seat, { type: 'ABILITY', actor: seat, abilityId });
  const abilityTargeted = uiHasLegalTarget(ui.state, seat, { type: 'ABILITY', abilityId });
  if (ability.usable && (abilityTargetless || abilityTargeted)) {
    const identity = theme.identities.find((i) => i.id === player.identityId);
    row.append(button('发动被动（' + (identity?.passiveText ?? '身份能力') + '）', () => {
      if (ability.needsTarget) {
        ui.pendingAbility = true;
        render();
        return;
      }
      useAbility();
    }));
  } else if (ability.reason !== '') {
    body.push(el('div', { class: 'muted', text: '被动不可用：' + ability.reason }));
  }
  if (ui.notice !== null) {
    body.push(el('div', { class: 'warn', text: t(ui.notice ?? '') }));
  }
  // ⚠️ B75：装备入口 —— 按钮**只在枚举真的发出装备候选时**出现（不自己判窗口，判据仍在 legal-gate），
  //   点击后进入「装备模式」，由手牌点击承担选牌；被闸挡下时给出拒因（门禁:拒绝不沉默）。
  if (ui.equipMode) {
    body.push(el('div', { class: 'warn', text: '装备模式：点击下方一张手牌装备它（免费、不占手牌上限，本手番就此用掉）。' }));
    body.push(button('取消装备模式', () => {
      ui.equipMode = false;
      ui.notice = '已退出装备模式。';
      render();
    }));
  }
  // ⚠️ B76：力竭恢复入口——按钮只在枚举真的发出候选时出现（判据仍在 legal-gate）。
  const recupCands = uiCandidates(ui.state, seat).filter((a) => a.type === 'RECUPERATE');
  for (const a of recupCands) {
    if (a.type !== 'RECUPERATE') { continue; }
    if (a.target === undefined) {
      body.push(button(t('自恢（2 {resource}，占本手番）'), () => { recuperate(); }));
    } else {
      body.push(button(t('救援座位 ' + String(a.target) + '（1 {resource}，占本手番）'), () => { recuperate(a.target); }));
    }
  }
  // ⚠️ B77：被停手番 ⇒ 行动面只剩这一条候选，按钮也只在枚举真的发出 PASS 时出现。
  if (uiCandidates(ui.state, seat).some((a) => a.type === 'PASS')) {
    body.push(button('结束手番（被封：本回合无法行动）', () => { passTurn(); }));
  }
  if (uiCandidates(ui.state, seat).some((a) => a.type === 'EQUIP_CARD')) {
    body.push(button('装备手牌（点一张牌）', () => {
      ui.equipMode = true;
      ui.pendingTargetCardId = null;
      ui.pendingCompareTarget = null;
      render();
    }));
    if (player.pendingCert) {
      body.push(el('div', { class: 'muted', text: '等待认证期间仍可装备手牌（装备不产生位移，不受锁定影响）。' }));
    }
  }
  body.push(el('div', { class: 'muted', text: '出牌：点击手牌中的卡牌（费用自动结算）。攻击类牌需要**再点一名对手**选定目标。' }));
  if (ui.pendingTargetCardId !== null) {
    body.push(el('div', { class: 'warn', text: '选择目标：点击下方一名对手（点自己或再次点该牌取消）。' }));
  }
  body.push(renderHand(ui.state, theme, seat, (cardId) => {
    // ⚠️ B75：装备模式下的点击=装备（**只在这一支拦截**：关隘比对支与对峙亮牌支各有自己的语义，
    //   在那里拦截会把「选比对牌 / 锁亮牌」偷换成装备）。选牌权交给玩家，判据交给闸。
    if (ui.equipMode) { equipCard(cardId); return; }
    // 已在选目标模式且再次点同一张牌 ⇒ 取消
    if (ui.pendingTargetCardId === cardId) {
      ui.pendingTargetCardId = null;
      render();
      return;
    }
    const card = player.hand.find((c) => c.id === cardId);
    // 门禁:选目标入口 —— 进入选目标模式**之前**先过闸：只有在「存在合法的带目标形状」时才进模式
    //   （评审发现 A 旁路二·进：旧写法只看 `cardNeedsTarget` + `targetCandidates.length`，
    //    山议阶段攻击牌照样进模式，随后由 onPickTarget 直通 performAction 打出）。
    if (card !== undefined && cardNeedsTarget(card)
      && uiHasLegalTarget(ui.state, seat, { type: 'PLAY_CARD', cardId })) {
      ui.pendingTargetCardId = cardId;
      render();
      return;
    }
    // 其余情形（不需目标的牌 / 无合法目标形状 / 非行动窗口）一律交给 playCard：
    // 它按将要提交的真实形状过闸，被拒时把拒因写进 ui.notice（门禁:拒绝不沉默）。
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
  const t = termExpander(theme.terms);
  const s = ui.state;

  const status = el('div', { class: 'status' });
  status.append(el('span', { text: '回合 ' + s.round + ' / 上限 ' + s.scales.globalRoundLimit }));
  status.append(el('span', { text: '当前' + t('{player}') + ' 座' + currentPlayer(s) }));
  // 行动顺序是**开局随机决定**的（B10）⇒ 显式展示，避免玩家以为「按座号轮」
  status.append(el('span', { text: '行动顺序 ' + s.turnOrder.map((x) => '座' + x).join('→') }));
  status.append(el('span', { text: '轮末 ' + (isRoundEnd(s) ? '是' : '否') }));
  status.append(el('span', { text: '签印门槛 N=' + s.scales.threshold }));
  // B11：活人席计分制 —— 对局中实时显示席位数（谁领先、领先多少）
  const seatLine = s.players
    .filter((p) => (s.liveSeats[p.seat] ?? 0) > 0)
    .map((p) => '座' + p.seat + ':' + String(s.liveSeats[p.seat] ?? 0))
    .join(' ');
  if (seatLine !== '') {
    status.append(el('span', { text: '活人席 ' + seatLine }));
  }
  // ⚠️ B13：本 round **公开**的亮牌（规格 §3.3：两张牌留在场上公开、不回手牌，round 末清空）
  if (s.publicCards.length > 0) {
    status.append(el('span', {
      text: '场上公开 ' + s.publicCards.map((c) => c.name + '（' + (c.color === 'red' ? '红' : '黑') + '）').join(' '),
    }));
  }
  if (s.outcome.finished) {
    const reason = s.outcome.reason === 'seats' ? '席位结算' : s.outcome.reason === 'fallback' ? '无人封顶兜底' : '活人缺席';
    const seatText = s.outcome.winners.map((w) => '座' + w + '(' + String(s.liveSeats[w] ?? 0) + '席)').join('、');
    status.append(el('span', { class: 'badge win', text: '本局结束：' + reason + (s.outcome.winners.length > 0 ? '（' + seatText + '）' : '（无胜者）') }));
  }

  const panels: (Node | string)[] = [
    renderToolbar(),
    section(t('{path}'), renderBoard(s)),
    renderPlayers(s, theme, (picked) => { onPickTarget(picked); }, ui.pendingTargetCardId !== null || ui.pendingAbility),
  ];
  // 山议面板
  if (needsCouncilVote(s)) {
    panels.push(renderCouncil(s, theme, ui.seat,
      // 门禁:山议投票 —— 面板显隐在 web/ui/council.ts（本任务不动那个文件），其中没有
      //   「投票人自己是否存活」这条 ⇒ 热座切到已出局座位后点名字会静默失败：
      //   提交路径在此过闸（R-1 的第四处旁路），并把拒因交出去（R-2：拒绝不得沉默）。
      (target) => {
        const action: Action = { type: 'VOTE', actor: ui.seat, target };
        if (!uiAllows(s, ui.seat, action)) {
          ui.notice = uiBlockNotice(s, ui.seat, action) ?? '当前不能投票。';
          render();
          return;
        }
        const r = castVote(s, ui.seat, target);
        ui.state = r.ok ? r.state : s;
        render();
      },
      () => { const r = resolveCouncil(s); ui.state = r.ok ? r.state : s; render(); },
      // ⚠️ B75：否决 —— 入口只有引擎的 `useCouncilVeto` 一处；被拒时把 note 交出去（拒绝不沉默）。
      //   面板上的按钮本身已由 `uiAllows` 把关，这里再核一次是**提交路径**的闸（与投票同款双保险）。
      () => {
        const r = useCouncilVeto(s, ui.seat);
        if (r.ok) { ui.state = r.state; ui.notice = '仲裁者否决：结算时本次放逐作废（每局 1 次）。'; }
        else { ui.notice = r.note ?? '当前不可使用否决。'; }
        render();
      },
    ));
  }
  // 认证面板
  if (needsCertificationAction(s) || s.certification.pending.length > 0) {
    panels.push(renderCertification(s, theme, ui.seat, {
      onSign: (target) => { const r = certifySign(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      onChallenge: (target, questions) => {
        const ch = certifyChallenge(s, ui.seat, target);
        if (!ch.ok) { alert(t(ch.note ?? '无法发起质疑')); return; }
        const withLog = { ...ch.state, log: [...ch.state.log, { round: ch.state.round, turnIndex: ch.state.turnIndex, actor: ui.seat, kind: 'certify', message: '对座' + target + ' 发起质疑：' + questions.join(' / ') }] };
        ui.state = withLog;
        render();
      },
      onAbstain: (target) => { const r = certifyAbstain(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      onJudge: (target, passed) => { const r = certifyAnswer(s, ui.seat, target, passed); ui.state = r.ok ? r.state : s; render(); },
      onAppeal: (target) => { const r = certifyAppeal(s, ui.seat, target); ui.state = r.ok ? r.state : s; render(); },
      onMutualSign: (target) => {
        // ⚠️ **B67：双人互验的互签**（§5.5）—— 待认证者本人给另一位待认证者签印。
        //   与 `onSign`（认证人签待认证者）**语义不同** ⇒ 走独立入口 `certifyMutualSign`。
        //   拒绝要说人话（R-2）⇒ 引擎拒时把 `r.note` 交出去，不静默丢弃。
        const r = certifyMutualSign(s, ui.seat, target);
        if (!r.ok) {
          ui.notice = '互签未落账：' + (r.note ?? '引擎未给出原因');
          render();
          return;
        }
        ui.notice = r.note ?? ('已与座' + String(target) + ' 互签');
        ui.state = r.state;
        render();
      },
      onAppealVote: (target, overturn) => {
        // 门禁:复议票 —— 与同级的 onChallenge 一个口径：引擎拒绝时必须把 r.note 交出去，
        //   不得静默丢弃 r.ok/r.note（评审发现 B）。按钮本身已由 uiAllows 过闸，
        //   这里是「面板过期 / 状态已被别处推进」时的兜底；G-g（复议裁定）已由 B63 接线，
        //   投票窗口在**轮末**由引擎关闭（详见 web/ui/cert.ts 的注释）。
        const r = certifyAppealVote(s, ui.seat, target, overturn);
        if (!r.ok) {
          ui.notice = '复议投票未落账：' + (r.note ?? '引擎未给出原因');
          render();
          return;
        }
        ui.notice = '复议投票已记录：' + (r.note ?? (overturn ? '推翻原判' : '维持原判'));
        ui.state = r.state;
        render();
      },
    }));
  }
  panels.push(renderActions());
  panels.push(section('日志', renderLog(s, 40, themeById(ui.themeId).theme.terms)));

  root.innerHTML = '';
  root.append(el('h1', { class: 'title', text: '创界山·活人认证 —— ' + theme.meta.name }));
  root.append(status);
  for (const p2 of panels) {
    root.append(typeof p2 === 'string' ? document.createTextNode(p2) : p2);
  }
}

render();
