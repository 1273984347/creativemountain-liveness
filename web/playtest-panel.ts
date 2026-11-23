import { currentPlayer } from '../engine/core/round.ts';
import type { State } from '../engine/core/state.ts';
import type {
  PlaytestConfig,
  PlaytestEvent,
  PlaytestEventStore,
} from './playtest-events.ts';
import { el, button, section } from './ui/dom.ts';

type StoredPlaytestEvent = PlaytestEvent & { readonly seq: number; readonly ts: number };

interface PlaytestExport {
  readonly schema: number;
  readonly config: PlaytestConfig;
  readonly metadata: { readonly themeId: string; readonly players: number; readonly mode: string } | null;
  readonly events: StoredPlaytestEvent[];
  readonly snapshot: string | null;
}

interface PanelRuntime {
  collapsed: boolean;
  gazeDurationMs: number;
  lastNow: number;
}

const BODY_OPEN = 'playtest-panel-open';
const BODY_COLLAPSED = 'playtest-panel-collapsed';
let runtimes: WeakMap<PlaytestEventStore, PanelRuntime> | null = null;
let operatorSeats: WeakMap<PlaytestEventStore, number> | null = null;

function exportData(store: PlaytestEventStore): PlaytestExport {
  return store.toJSON() as PlaytestExport;
}

function syncGaze(runtime: PanelRuntime, now: number): void {
  if (!runtime.collapsed) {
    runtime.gazeDurationMs += Math.max(0, now - runtime.lastNow);
  }
  runtime.lastNow = now;
}

/** 由实拍控制器在每次渲染前同步 UI 的「操作者」，不把 UI 状态写进引擎 State。 */
export function setPlaytestPanelOperator(store: PlaytestEventStore, seat: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat > 5) { return; }
  operatorSeats ??= new WeakMap<PlaytestEventStore, number>();
  operatorSeats.set(store, seat);
}

function injectPanelStyle(): void {
  if (document.getElementById('playtest-panel-style') !== null) { return; }
  const style = el('style', { id: 'playtest-panel-style' });
  style.textContent = `
body.playtest-panel-open #app { margin-right:370px; }
body.playtest-panel-open.playtest-panel-collapsed #app { margin-right:78px; }
.playtest-panel { position:fixed; top:16px; right:16px; width:340px; max-height:calc(100vh - 32px); overflow:auto; z-index:40; box-shadow:0 12px 36px rgba(0,0,0,.42); }
.playtest-panel .panel-title { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.playtest-panel__toggle { flex:none; padding:3px 8px; }
.playtest-panel__meta { margin-bottom:10px; color:#c8bcac; line-height:1.5; }
.playtest-panel__group { margin:12px 0 0; padding-top:10px; border-top:1px solid var(--line); }
.playtest-panel__legend { margin:0 0 8px; color:var(--accent); font-size:13px; font-weight:600; }
.playtest-panel__fields { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.playtest-panel__field { display:flex; flex-direction:column; gap:4px; color:#b6a894; font-size:12px; }
.playtest-panel__field--wide { grid-column:1 / -1; }
.playtest-panel__input { width:100%; min-width:0; }
.playtest-panel__actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.playtest-panel__status { min-height:18px; margin-top:8px; color:#e0c060; font-size:12px; line-height:1.5; }
.playtest-panel__summary { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px; }
.playtest-panel__metric { padding:6px 8px; background:#241f1b; border:1px solid var(--line); border-radius:5px; color:#c8bcac; font-size:12px; }
.playtest-panel__poll { margin:0; padding:0; border:0; min-width:0; }
.playtest-panel__poll > fieldset:disabled { opacity:.55; }
.playtest-panel__check { display:flex; align-items:center; gap:6px; margin:8px 0; color:#c8bcac; font-size:12px; }
.playtest-panel__note { margin:6px 0 0; color:#8a7c6a; font-size:12px; line-height:1.5; }
.playtest-panel.is-collapsed { width:auto; max-height:none; overflow:visible; }
.playtest-panel.is-collapsed .panel-body { display:none; }
@media (max-width:900px) {
  body.playtest-panel-open #app { margin-right:0; margin-bottom:58vh; }
  body.playtest-panel-open.playtest-panel-collapsed #app { margin-bottom:66px; }
  .playtest-panel { top:auto; left:12px; right:12px; bottom:12px; width:auto; max-height:58vh; }
}
@media (max-width:520px) {
  .playtest-panel__fields { grid-template-columns:1fr; }
  .playtest-panel__field--wide { grid-column:auto; }
}
`;
  document.head.append(style);
}

function seatOptions(selected: number, seats: readonly number[]): HTMLSelectElement {
  const select = el('select', { class: 'sel playtest-panel__input' });
  for (const seat of seats) {
    const option = el('option', { value: String(seat), text: '座' + String(seat) });
    option.selected = seat === selected;
    select.append(option);
  }
  return select;
}

function ratingOptions(label: string): HTMLSelectElement {
  const select = el('select', { class: 'sel playtest-panel__input', 'aria-label': label });
  for (const value of [1, 2, 3, 4, 5]) {
    const option = el('option', { value: String(value), text: String(value) });
    option.selected = value === 3;
    select.append(option);
  }
  return select;
}

/** 创建独立实拍页的观察员侧栏；所有墙钟数据只进入 PlaytestEventStore。 */
export function renderPlaytestPanel(
  store: PlaytestEventStore,
  state: State,
  now: () => number,
): HTMLElement {
  const data = exportData(store);
  const operatorSeat = operatorSeats?.get(store) ?? currentPlayer(state);
  runtimes ??= new WeakMap<PlaytestEventStore, PanelRuntime>();
  const runtime = runtimes.get(store) ?? { collapsed: false, gazeDurationMs: 0, lastNow: now() };
  runtimes.set(store, runtime);
  syncGaze(runtime, now());
  injectPanelStyle();

  for (const previous of Array.from(document.querySelectorAll('.playtest-panel'))) { previous.remove(); }
  document.body.classList.add(BODY_OPEN);

  const panel = section('实拍观察员');
  panel.classList.add('playtest-panel');
  panel.setAttribute('aria-label', '实拍观察员');
  const content = panel.querySelector<HTMLDivElement>('.panel-body');
  if (content === null) { return panel; }

  const toggle = button('折叠观察员面板', () => {
    syncGaze(runtime, now());
    runtime.collapsed = !runtime.collapsed;
    panel.classList.toggle('is-collapsed', runtime.collapsed);
    document.body.classList.toggle(BODY_COLLAPSED, runtime.collapsed);
    toggle.textContent = runtime.collapsed ? '展开观察员面板' : '折叠观察员面板';
    toggle.setAttribute('aria-expanded', String(!runtime.collapsed));
  });
  toggle.classList.add('playtest-panel__toggle');
  toggle.setAttribute('aria-expanded', 'true');
  panel.querySelector('.panel-title')?.append(toggle);

  const setCollapsed = (): void => {
    panel.classList.toggle('is-collapsed', runtime.collapsed);
    document.body.classList.toggle(BODY_COLLAPSED, runtime.collapsed);
    toggle.textContent = runtime.collapsed ? '展开观察员面板' : '折叠观察员面板';
    toggle.setAttribute('aria-expanded', String(!runtime.collapsed));
  };
  setCollapsed();

  const status = el('div', { class: 'playtest-panel__status', role: 'status', 'aria-live': 'polite' });
  content.append(el('div', {
    class: 'playtest-panel__meta',
    text: 'Seed ' + String(data.config.seed) + ' · AI 座' + String(data.config.aiSeat) + ' · 5 真人 + 1 AI',
  }));

  const summary = el('div', { class: 'playtest-panel__summary' });
  const refreshSummary = (): void => {
    const events = exportData(store).events;
    const count = (type: PlaytestEvent['type']): number => events.filter((event) => event.type === type).length;
    summary.replaceChildren(
      el('div', { class: 'playtest-panel__metric', text: '同频 ' + String(count('table_attention_peak')) }),
      el('div', { class: 'playtest-panel__metric', text: '接管 ' + String(count('human_takeover_click')) }),
      el('div', { class: 'playtest-panel__metric', text: 'AI 动作 ' + String(count('ai_action_committed')) }),
      el('div', { class: 'playtest-panel__metric', text: '弃权 ' + String(count('ai_forfeit')) }),
    );
  };
  refreshSummary();
  content.append(summary);

  const observation = el('fieldset', { class: 'playtest-panel__group' });
  observation.append(el('legend', { class: 'playtest-panel__legend', text: '现场观察' }));
  const fields = el('div', { class: 'playtest-panel__fields' });
  const focusLabel = el('label', { class: 'playtest-panel__field', text: '焦点座位' });
  const focusSeat = seatOptions(data.config.aiSeat, state.players.map((player) => player.seat));
  focusSeat.setAttribute('aria-label', '焦点座位');
  focusLabel.append(focusSeat);
  const durationLabel = el('label', { class: 'playtest-panel__field', text: '持续秒数' });
  const durationInput = el('input', {
    class: 'sel playtest-panel__input', type: 'number', min: '0', step: '0.1', value: '3',
    'aria-label': '持续秒数',
  });
  durationLabel.append(durationInput);
  fields.append(focusLabel, durationLabel);
  observation.append(fields);
  observation.append(el('div', { class: 'playtest-panel__actions' },
    button('记一次同频', () => {
      const seat = Number(focusSeat.value);
      const durationSec = durationInput.valueAsNumber;
      if (!Number.isInteger(seat) || seat < 0 || seat > 5
        || !Number.isFinite(durationSec) || durationSec < 0) {
        status.textContent = '请填写合法焦点座位与非负持续秒数。';
        return;
      }
      store.record({
        type: 'table_attention_peak',
        anchorRound: state.round,
        anchorLogIndex: state.log.length - 1,
        focusSeat: seat,
        durationSec,
      });
      refreshSummary();
      status.textContent = '已记录同频：座' + String(seat) + '，' + String(durationSec) + ' 秒。';
    }),
    button('记一次看面板', () => {
      syncGaze(runtime, now());
      store.record({ type: 'gaze_panel', seat: operatorSeat, durationMs: runtime.gazeDurationMs });
      runtime.gazeDurationMs = 0;
      runtime.lastNow = now();
      status.textContent = '已记录一次看面板。';
    }),
  ));
  content.append(observation, status);

  const poll = el('form', { class: 'playtest-panel__poll' });
  const pollFieldset = el('fieldset', { class: 'playtest-panel__group' });
  pollFieldset.disabled = !state.outcome.finished;
  pollFieldset.append(el('legend', { class: 'playtest-panel__legend', text: '局后 5 人自报' }));
  if (!state.outcome.finished) {
    pollFieldset.append(el('p', { class: 'playtest-panel__note', text: '对局结束后，请 5 位真人各提交一次。' }));
  }
  const humanSeats = state.players.map((player) => player.seat).filter((seat) => seat !== data.config.aiSeat);
  const pollFields = el('div', { class: 'playtest-panel__fields' });
  const seatLabel = el('label', { class: 'playtest-panel__field', text: '自报座位' });
  const pollSeat = seatOptions(humanSeats[0] ?? 0, humanSeats);
  pollSeat.setAttribute('aria-label', '自报座位');
  seatLabel.append(pollSeat);
  const replayLabel = el('label', { class: 'playtest-panel__field', text: '愿意再玩（1–5）' });
  replayLabel.append(ratingOptions('愿意再玩'));
  const roboticLabel = el('label', { class: 'playtest-panel__field', text: '感到机械（1–5）' });
  roboticLabel.append(ratingOptions('感到机械'));
  const peakLabel = el('label', { class: 'playtest-panel__field', text: '记得的同频次数' });
  const peakCount = el('input', {
    class: 'sel playtest-panel__input', type: 'number', min: '0', step: '1', value: '0',
    'aria-label': '记得的同频次数',
  });
  peakLabel.append(peakCount);
  pollFields.append(seatLabel, replayLabel, roboticLabel, peakLabel);
  pollFieldset.append(pollFields);

  const wantHumanBackLabel = el('label', { class: 'playtest-panel__check' });
  const wantHumanBack = el('input', { type: 'checkbox' });
  wantHumanBackLabel.append(wantHumanBack, '想换回真人');
  pollFieldset.append(wantHumanBackLabel);
  const anomalyLabel = el('label', { class: 'playtest-panel__field playtest-panel__field--wide', text: '一句异常' });
  const anomaly = el('input', {
    class: 'sel playtest-panel__input', type: 'text', maxlength: '200', placeholder: '没有可留空',
    'aria-label': '一句异常',
  });
  anomalyLabel.append(anomaly);
  pollFieldset.append(anomalyLabel);
  pollFieldset.append(el('div', { class: 'playtest-panel__actions' },
    button('提交自报', () => {
      if (!state.outcome.finished || !poll.reportValidity()) { return; }
      const seat = Number(pollSeat.value);
      const wouldReplay = Number((poll.querySelector<HTMLSelectElement>('select[aria-label="愿意再玩"]')?.value ?? '0'));
      const feltRobotic = Number((poll.querySelector<HTMLSelectElement>('select[aria-label="感到机械"]')?.value ?? '0'));
      const recalledPeakCount = peakCount.valueAsNumber;
      if (!humanSeats.includes(seat)
        || !Number.isInteger(wouldReplay) || wouldReplay < 1 || wouldReplay > 5
        || !Number.isInteger(feltRobotic) || feltRobotic < 1 || feltRobotic > 5
        || !Number.isInteger(recalledPeakCount) || recalledPeakCount < 0) {
        status.textContent = '请填写合法自报数值。';
        return;
      }
      store.record({
        type: 'post_game_poll',
        seat,
        wantHumanBack: wantHumanBack.checked,
        wouldReplay,
        feltRobotic,
        recalledPeakCount,
        oneLineAnomaly: anomaly.value.trim(),
      });
      status.textContent = '已记录座' + String(seat) + ' 的局后自报。';
      poll.reset();
    }),
  ));
  poll.append(pollFieldset);
  content.append(poll);

  content.append(el('div', { class: 'playtest-panel__actions' },
    button('导出实拍记录', () => {
      const blob = new Blob([JSON.stringify(exportData(store), null, 2)], { type: 'application/json' });
      const link = el('a');
      link.href = URL.createObjectURL(blob);
      link.download = '创界山-实拍-' + String(data.config.seed) + '-' + String(data.config.aiSeat) + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      status.textContent = '已导出实拍记录。';
    }),
  ));
  return panel;
}
