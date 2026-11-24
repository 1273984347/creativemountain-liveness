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

interface PollDraft {
  seat: string;
  wouldReplay: string;
  feltHuman: string;
  recalledPeakCount: string;
  wantHumanBack: boolean;
  oneLineAnomaly: string;
}

interface PanelRuntime {
  collapsed: boolean;
  gazeStartedAt: number | null;
  gazeSeat: number | null;
  focusSeat: string;
  durationSec: string;
  poll: PollDraft;
}

const BODY_OPEN = 'playtest-panel-open';
const BODY_COLLAPSED = 'playtest-panel-collapsed';
let runtimes: WeakMap<PlaytestEventStore, PanelRuntime> | null = null;
let operatorSeats: WeakMap<PlaytestEventStore, number> | null = null;

function exportData(store: PlaytestEventStore): PlaytestExport {
  return store.toJSON() as PlaytestExport;
}

function defaultPollDraft(seat: number): PollDraft {
  return {
    seat: String(seat),
    wouldReplay: '3',
    feltHuman: '3',
    recalledPeakCount: '0',
    wantHumanBack: false,
    oneLineAnomaly: '',
  };
}

/** 由实拍控制器在每次渲染前同步 UI 的「操作者」，不把 UI 状态写进引擎 State。 */
export function setPlaytestPanelOperator(store: PlaytestEventStore, seat: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat > 5) { return; }
  operatorSeats ??= new WeakMap<PlaytestEventStore, number>();
  operatorSeats.set(store, seat);
}

/** 新局/读档/导入时丢弃上一局的观察草稿与进行中的注视计时。 */
export function resetPlaytestPanel(store: PlaytestEventStore): void {
  runtimes?.delete(store);
  operatorSeats?.delete(store);
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

function ratingOptions(label: string, selected: number): HTMLSelectElement {
  const select = el('select', { class: 'sel playtest-panel__input', 'aria-label': label });
  for (const value of [1, 2, 3, 4, 5]) {
    const option = el('option', { value: String(value), text: String(value) });
    option.selected = value === selected;
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
  const defaultPollSeat = state.players.find((player) => player.seat !== data.config.aiSeat)?.seat ?? 0;
  runtimes ??= new WeakMap<PlaytestEventStore, PanelRuntime>();
  const runtime = runtimes.get(store) ?? {
    collapsed: false,
    gazeStartedAt: null,
    gazeSeat: null,
    focusSeat: String(data.config.aiSeat),
    durationSec: '3',
    poll: defaultPollDraft(defaultPollSeat),
  };
  runtimes.set(store, runtime);
  injectPanelStyle();

  for (const previous of Array.from(document.querySelectorAll('.playtest-panel'))) { previous.remove(); }
  document.body.classList.add(BODY_OPEN);

  const panel = section('实拍观察员');
  panel.classList.add('playtest-panel');
  panel.setAttribute('aria-label', '实拍观察员');
  const content = panel.querySelector<HTMLDivElement>('.panel-body');
  if (content === null) { return panel; }

  const toggle = button('折叠观察员面板', () => {
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
  const focusSeat = seatOptions(Number(runtime.focusSeat), state.players.map((player) => player.seat));
  focusSeat.setAttribute('aria-label', '焦点座位');
  focusSeat.addEventListener('change', () => { runtime.focusSeat = focusSeat.value; });
  focusLabel.append(focusSeat);
  const durationLabel = el('label', { class: 'playtest-panel__field', text: '持续秒数' });
  const durationInput = el('input', {
    class: 'sel playtest-panel__input', type: 'number', min: '3', step: '0.1', value: runtime.durationSec,
    'aria-label': '持续秒数',
  });
  durationInput.addEventListener('input', () => { runtime.durationSec = durationInput.value; });
  durationLabel.append(durationInput);
  fields.append(focusLabel, durationLabel);
  observation.append(fields);
  const gazeButton = button(runtime.gazeStartedAt === null ? '开始看面板' : '结束看面板', () => {
    if (runtime.gazeStartedAt === null) {
      runtime.gazeStartedAt = now();
      runtime.gazeSeat = operatorSeat;
      status.textContent = '正在记录看面板，结束后写入时长。';
    } else {
      const durationMs = Math.max(0, now() - runtime.gazeStartedAt);
      store.record({
        type: 'gaze_panel',
        seat: runtime.gazeSeat ?? operatorSeat,
        durationMs,
      });
      runtime.gazeStartedAt = null;
      runtime.gazeSeat = null;
      status.textContent = '已记录一次看面板：' + String(durationMs) + ' 毫秒。';
    }
    gazeButton.textContent = runtime.gazeStartedAt === null ? '开始看面板' : '结束看面板';
  });
  observation.append(el('div', { class: 'playtest-panel__actions' },
    button('记一次同频', () => {
      const seat = Number(focusSeat.value);
      const durationSec = durationInput.valueAsNumber;
      if (!Number.isInteger(seat) || seat < 0 || seat > 5
        || !Number.isFinite(durationSec) || durationSec < 3) {
        status.textContent = '请填写合法焦点座位与不少于 3 秒的持续秒数。';
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
    gazeButton,
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
  const pollSeat = seatOptions(Number(runtime.poll.seat), humanSeats);
  pollSeat.setAttribute('aria-label', '自报座位');
  const submittedPollSeats = new Set(data.events
    .filter((event) => event.type === 'post_game_poll')
    .map((event) => event.seat));
  for (const option of Array.from(pollSeat.options)) {
    option.disabled = submittedPollSeats.has(Number(option.value));
  }
  pollSeat.addEventListener('change', () => { runtime.poll.seat = pollSeat.value; });
  seatLabel.append(pollSeat);
  const replayLabel = el('label', { class: 'playtest-panel__field', text: '愿意再玩（1–5）' });
  const replay = ratingOptions('愿意再玩', Number(runtime.poll.wouldReplay));
  replay.addEventListener('change', () => { runtime.poll.wouldReplay = replay.value; });
  replayLabel.append(replay);
  const humanLabel = el('label', { class: 'playtest-panel__field', text: '像人程度（1=机器，5=人）' });
  const humanRating = ratingOptions('像人程度（1=机器，5=人）', Number(runtime.poll.feltHuman));
  humanRating.addEventListener('change', () => { runtime.poll.feltHuman = humanRating.value; });
  humanLabel.append(humanRating);
  const peakLabel = el('label', { class: 'playtest-panel__field', text: '记得的同频次数' });
  const peakCount = el('input', {
    class: 'sel playtest-panel__input', type: 'number', min: '0', step: '1', value: runtime.poll.recalledPeakCount,
    'aria-label': '记得的同频次数',
  });
  peakCount.addEventListener('input', () => { runtime.poll.recalledPeakCount = peakCount.value; });
  peakLabel.append(peakCount);
  pollFields.append(seatLabel, replayLabel, humanLabel, peakLabel);
  pollFieldset.append(pollFields);

  const wantHumanBackLabel = el('label', { class: 'playtest-panel__check' });
  const wantHumanBack = el('input', { type: 'checkbox' });
  wantHumanBack.checked = runtime.poll.wantHumanBack;
  wantHumanBack.addEventListener('change', () => { runtime.poll.wantHumanBack = wantHumanBack.checked; });
  wantHumanBackLabel.append(wantHumanBack, '想换回真人');
  pollFieldset.append(wantHumanBackLabel);
  const anomalyLabel = el('label', { class: 'playtest-panel__field playtest-panel__field--wide', text: '一句异常' });
  const anomaly = el('input', {
    class: 'sel playtest-panel__input', type: 'text', maxlength: '200', placeholder: '没有可留空',
    'aria-label': '一句异常',
  });
  anomaly.value = runtime.poll.oneLineAnomaly;
  anomaly.addEventListener('input', () => { runtime.poll.oneLineAnomaly = anomaly.value; });
  anomalyLabel.append(anomaly);
  pollFieldset.append(anomalyLabel);
  const syncPollControls = (): void => {
    pollSeat.value = runtime.poll.seat;
    replay.value = runtime.poll.wouldReplay;
    humanRating.value = runtime.poll.feltHuman;
    peakCount.value = runtime.poll.recalledPeakCount;
    wantHumanBack.checked = runtime.poll.wantHumanBack;
    anomaly.value = runtime.poll.oneLineAnomaly;
  };
  pollFieldset.append(el('div', { class: 'playtest-panel__actions' },
    button('提交自报', () => {
      if (!state.outcome.finished || !poll.reportValidity()) { return; }
      runtime.poll = {
        seat: pollSeat.value,
        wouldReplay: replay.value,
        feltHuman: humanRating.value,
        recalledPeakCount: peakCount.value,
        wantHumanBack: wantHumanBack.checked,
        oneLineAnomaly: anomaly.value,
      };
      const seat = Number(runtime.poll.seat);
      const wouldReplay = Number(runtime.poll.wouldReplay);
      const feltHuman = Number(runtime.poll.feltHuman);
      const recalledPeakCount = peakCount.valueAsNumber;
      if (!humanSeats.includes(seat)
        || !Number.isInteger(wouldReplay) || wouldReplay < 1 || wouldReplay > 5
        || !Number.isInteger(feltHuman) || feltHuman < 1 || feltHuman > 5
        || !Number.isInteger(recalledPeakCount) || recalledPeakCount < 0) {
        status.textContent = '请填写合法自报数值。';
        return;
      }
      if (data.events.some((event) => event.type === 'post_game_poll' && event.seat === seat)) {
        status.textContent = '座' + String(seat) + ' 在本局已提交过自报，不能重复提交。';
        return;
      }
      store.record({
        type: 'post_game_poll',
        seat,
        wantHumanBack: runtime.poll.wantHumanBack,
        wouldReplay,
        feltHuman,
        recalledPeakCount,
        oneLineAnomaly: runtime.poll.oneLineAnomaly.trim(),
      });
      const latestEvents = exportData(store).events;
      const nextSeat = humanSeats.find((humanSeat) => !latestEvents.some((event) =>
        event.type === 'post_game_poll' && event.seat === humanSeat)) ?? humanSeats[0] ?? 0;
      runtime.poll = defaultPollDraft(nextSeat);
      syncPollControls();
      status.textContent = '已记录座' + String(seat) + ' 的局后自报。';
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
