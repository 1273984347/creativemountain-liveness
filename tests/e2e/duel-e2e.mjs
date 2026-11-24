// B13 对峙的浏览器端到端测试（Playwright）。
//
// 目标：稳定触发对峙 → 双方各自选牌 → 揭晓结算 → 回合解锁 → 页面无报错。
//
// ⚠️ 为什么不用内置浏览器手点：同一 seed 下轨迹可复现，门⑩固定使用 42，
//   靠随机行棋撞对峙既慢又不可靠（实测 11 轮未命中）；
//   Playwright 能高速重试（换主题/人数 ⇒ 换 rng 轨迹）⇒ 命中率高且成本低。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { advanceCertificationRound, enterPendingCertification } from '../../engine/core/certification.ts';
import { startDuel } from '../../engine/core/duel.ts';
import { gateScene } from '../engine/fixtures.ts';
import { createInitialState } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { stateToJson } from '../../engine/core/serialize.ts';
import { getScales } from '../../engine/scales.ts';
import { cardNeedsTarget } from '../../engine/core/targeting.ts';

// ⚠️ `CM_REPO_ROOT` 指向**仓库根**（默认 cwd）：副本里跑本脚本时用它解析 playwright ——
//   隔离副本没有 node_modules ⇒ 直接 `import 'playwright'` 会解析失败。
const ROOT = process.env.CM_REPO_ROOT !== undefined
  ? resolve(process.env.CM_REPO_ROOT)
  : process.cwd();
const require = createRequire(resolve(ROOT, 'package.json'));
const { chromium } = require('playwright');
// ⚠️ bundle 路径可被 **CM_E2E_BUNDLE** 覆盖 ⇒ 隔离副本里的负样本自证
//   可以指向仓库已构建的 dist，而不必在副本里重建（避免依赖 node_modules）。
const file = process.env.CM_E2E_BUNDLE !== undefined
  ? resolve(process.env.CM_E2E_BUNDLE)
  : resolve(ROOT, 'dist', '创界山-活人认证.html');
const url = 'file:///' + file.split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');
const THEMES = ['仙侠·2026', '科幻·AI 纪元', '融合·道械双修', '都市·异能纪'];
const PLAYER_COUNTS = ['3', '4'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); } });
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); });
await page.goto(url);
// B85 Task 4：默认发布页不得夹带实拍观察员文案或面板类名。
const productionHtml = readFileSync(file, 'utf8');
assert.equal(productionHtml.includes('实拍观察员'), false, '生产 HTML 不得包含观察员文案');
assert.equal(productionHtml.includes('playtest-panel'), false, '生产 HTML 不得包含实拍面板类名');
assert.equal(productionHtml.toLowerCase().includes('playtest'), false, '生产 HTML 不得包含任何实拍标识');

const seedInput = page.locator('input[aria-label="Seed"]');
await seedInput.fill('123456');
await page.getByRole('button', { name: '新开一局' }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: '导出' }).click();
const download = await downloadPromise;
const downloadPath = await download.path();
assert.ok(downloadPath, '导出必须产生可读文件');
const envelope = JSON.parse(readFileSync(downloadPath, 'utf8'));
const saved = JSON.parse(envelope.state);
assert.equal(saved.seed, 123456, '导出必须保留 UI 指定的 seed');
assert.equal(saved.rng.initialSeed, 123456, 'RNG 初始种子必须与 UI 指定值一致');
await seedInput.fill('42');
await page.getByRole('button', { name: '新开一局' }).click();

const selects = page.locator('select');
const statusText = () => page.locator('.status').first().innerText();
const duelText = async () => {
  const n = await page.locator('.warn').count();
  for (let i = 0; i < n; i++) {
    const t = await page.locator('.warn').nth(i).innerText();
    if (t.includes('对峙：座')) { return t; }
  }
  return null;
};
const moveBtn = page.getByRole('button', { name: /^行棋/ });

let found = null;
let attempts = 0;
let cursor = 0;
outer:
for (const theme of THEMES) {
  for (const pc of PLAYER_COUNTS) {
    await selects.nth(0).selectOption({ label: theme });
    await selects.nth(1).selectOption(pc);
    await page.getByRole('button', { name: '新开一局' }).click();
    attempts++;
    for (let step = 0; step < 60; step++) {
      const d = await duelText();
      if (d !== null) { found = { theme, pc, d }; break outer; }
      // ⚠️ 轮转座位（**不能每次从 0 开始** —— 否则只有座 0 在动，撞不上静止的对手）。
      let moved = false;
      for (let k = 0; k < 2 && !moved; k++) {
        const s = (cursor + k) % 2;
        await selects.nth(3).selectOption(String(s));
        if (await moveBtn.count() > 0) {
          await moveBtn.first().click();
          moved = true;
          cursor = (s + 1) % 2;
        }
      }
      if (!moved) { break; }
    }
  }
}

if (found === null) {
  console.log(JSON.stringify({ ok: false, stage: 'trigger', attempts, errors }, null, 2));
  await browser.close();
  process.exit(1);
}

const beforeStatus = await statusText();
const duelWarn = found.d;
const seats = /对峙：座(\d) vs 座(\d)/.exec(duelWarn);
const a = seats[1];
const b = seats[2];
// 对峙期间：行动区应只剩对峙面板（无「行棋」按钮）
const lockedDuringDuel = (await moveBtn.count()) === 0;
// 座 A 选牌（点对峙面板的第一张手牌）
await selects.nth(3).selectOption(a);
await page.locator('.hand .card').first().click();
const afterA = await page.locator('.muted').allInnerTexts();
const waitingText = afterA.find((t) => t.includes('已锁定亮牌')) ?? '';
// 座 B 选牌 ⇒ 揭晓
await selects.nth(3).selectOption(b);
await page.locator('.hand .card').first().click();
const duelGone = (await duelText()) === null;
const unlocked = (await moveBtn.count()) > 0;
const afterStatus = await statusText();
const bodyAll = await page.locator('body').innerText();
const logHasDuel = /对峙/.test(bodyAll);
// 公开亮牌应显示在场上（规格 §3.3）
const publicShown = /场上公开/.test(bodyAll);
// 结算应执行（败者后退 / 平局弃牌 ⇒ 日志里有结算描述）
const settled = /后退|平局|落败|抽 1 张/.test(bodyAll);

// B85 Task 3：独立实拍页、观察员动作与本地 JSON 导出。
const playtestUrl = 'file:///' + file.replace('创界山-活人认证.html', '创界山-活人认证-实拍.html')
  .split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/')
  + '?playtest=1&seed=123456&aiSeat=2';
const pt = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const ptErrors = [];
pt.on('console', (m) => { if (m.type() === 'error') { ptErrors.push(m.text()); } });
pt.on('pageerror', (e) => { ptErrors.push('pageerror: ' + e.message); });
await pt.goto(playtestUrl);
assert.equal(await pt.locator('.players .player').count(), 6, '实拍局固定为 6 人');
assert.equal(await pt.locator('select').nth(1).isDisabled(), true, '实拍局不得切换人数');
await pt.getByRole('button', { name: '新开一局' }).click();
assert.equal(await pt.getByLabel('焦点座位').inputValue(), '2', '焦点座位默认当前 AI 座位');
assert.equal(await pt.getByLabel('持续秒数').inputValue(), '3', '同频持续默认 3 秒');
assert.equal(await pt.getByLabel('自报座位').locator('option').count(), 5, '局后自报覆盖 5 位真人');
const currentTurnText = await pt.locator('.status').first().innerText();
const currentTurnSeat = Number(/当前\S* 座(\d+)/.exec(currentTurnText)?.[1]);
await pt.waitForFunction(() => {
  const text = document.querySelector('.status')?.textContent ?? '';
  return /当前\S* 座(\d+)/.exec(text)?.[1] !== '2';
});
const humanTurnText = await pt.locator('.status').first().innerText();
const humanTurnSeat = Number(/当前\S* 座(\d+)/.exec(humanTurnText)?.[1]);
const operatorSeat = [0, 1, 3, 4, 5].find((seat) => seat !== currentTurnSeat);
assert.notEqual(operatorSeat, undefined, '应能选择与当前手番不同的真人操作者');
await pt.getByLabel('焦点座位').selectOption('4');
await pt.getByLabel('持续秒数').fill('7.5');
await pt.locator('select').nth(3).selectOption(String(operatorSeat));
assert.equal(await pt.getByLabel('焦点座位').inputValue(), '4', 'AI 重渲染后保留焦点座位草稿');
assert.equal(await pt.getByLabel('持续秒数').inputValue(), '7.5', 'AI 重渲染后保留持续秒数草稿');

// 手牌是 div，不是 button：真实 DOM 点击必须同时覆盖人类手番耗时与 AI 座位接管。
await pt.clock.install();
await pt.clock.pauseAt(await pt.evaluate(() => Date.now()));
await pt.locator('select').nth(3).selectOption(String(humanTurnSeat));
await pt.clock.runFor(500);
const humanCard = pt.locator('.hand .card').first();
const humanCardControl = await humanCard.getAttribute('data-action-control');
assert.ok(humanCardControl?.startsWith('card:'), '手牌必须带稳定动作标识');
await humanCard.click();
await pt.locator('select').nth(3).selectOption('2');
const aiCard = pt.locator('.hand .card').first();
const aiCardControl = await aiCard.getAttribute('data-action-control');
assert.ok(aiCardControl?.startsWith('card:'), 'AI 手牌必须带稳定动作标识');
await aiCard.click();
const cardDownloadPromise = pt.waitForEvent('download');
await pt.getByRole('button', { name: '导出实拍记录' }).click();
const cardData = JSON.parse(readFileSync(await (await cardDownloadPromise).path(), 'utf8'));
const cardTurnDurations = cardData.events.filter((event) => event.type === 'human_turn_duration_ms');
assert.equal(cardTurnDurations.length, 1, '一次手牌点击只能记录一条人类手番耗时：'
  + JSON.stringify({ humanTurnSeat, events: cardData.events }));
assert.equal(cardTurnDurations[0].seat, humanTurnSeat);
assert.ok(Number.isFinite(cardTurnDurations[0].durationMs) && cardTurnDurations[0].durationMs >= 0);
const cardTakeovers = cardData.events.filter((event) => event.type === 'human_takeover_click');
assert.equal(cardTakeovers.length, 1, '一次 AI 手牌点击只能记录一条接管');
assert.equal(cardTakeovers[0].seat, 2);
assert.equal(cardTakeovers[0].control, aiCardControl);

await pt.getByLabel('持续秒数').fill('2.9');
await pt.getByRole('button', { name: '记一次同频' }).click();
assert.match(await pt.locator('.playtest-panel__status').innerText(), /不少于 3 秒/);
assert.match(await pt.locator('.playtest-panel__metric').first().innerText(), /同频 0/,
  '不足 3 秒不得写入同频事件');
await pt.getByLabel('持续秒数').fill('7.5');
await pt.getByRole('button', { name: '记一次同频' }).click();
await pt.clock.runFor(500);
await pt.locator('select').nth(3).selectOption(String(operatorSeat));
await pt.getByRole('button', { name: '开始看面板' }).click();
await pt.locator('select').nth(3).selectOption(operatorSeat === 0 ? '1' : '0');
await pt.clock.runFor(125);
await pt.getByRole('button', { name: '结束看面板' }).click();
const ptDownloadPromise = pt.waitForEvent('download');
await pt.getByRole('button', { name: '导出实拍记录' }).click();
const ptDownload = await ptDownloadPromise;
const ptPath = await ptDownload.path();
const ptData = JSON.parse(readFileSync(ptPath, 'utf8'));
assert.equal(ptDownload.suggestedFilename(), '创界山-实拍-123456-2.json');
assert.equal(ptData.schema, 1);
assert.equal(ptData.config.seed, 123456);
assert.equal(ptData.config.aiSeat, 2);
assert.equal(ptData.metadata.players, 6);
assert.equal(typeof ptData.snapshot, 'string');
assert.equal(JSON.parse(ptData.snapshot).state.players[2].controlledBy, 'ai', '新开实拍局必须保留 URL 指定的 AI 座位');
const attention = ptData.events.find((e) => e.type === 'table_attention_peak');
const gaze = ptData.events.find((e) => e.type === 'gaze_panel');
assert.ok(attention);
assert.equal(attention.focusSeat, 4);
assert.equal(attention.durationSec, 7.5);
assert.ok(Number.isInteger(attention.anchorRound));
assert.ok(attention.anchorLogIndex >= 0);
assert.ok(gaze);
assert.equal(ptData.events.filter((e) => e.type === 'gaze_panel').length, 1, '看面板事件只能在结束时写入一次');
assert.equal(gaze.seat, operatorSeat, '看面板事件必须取开始时的 UI 操作者');
assert.ok(gaze.durationMs >= 120 && gaze.durationMs < 500,
  '看面板时长只能来自显式开始到结束，不包含面板展开时间');

// 用现有存档/读档入口把同一实拍局置于终局，不增加任何生产测试钩子。
const finishedSave = JSON.parse(ptData.snapshot);
finishedSave.state.phase = '终局';
finishedSave.state.outcome = { finished: true, winners: [0], reason: 'fallback' };
const saveEnvelope = JSON.stringify({
  v: 2,
  themeId: await pt.locator('select').nth(0).inputValue(),
  state: JSON.stringify(finishedSave),
});
await pt.evaluate((save) => localStorage.setItem('creativemountain.save.v2', save), saveEnvelope);
await pt.getByRole('button', { name: '读档' }).click();
await pt.locator('.badge.win').waitFor();
assert.equal(await pt.getByRole('button', { name: '提交自报' }).isEnabled(), true, '终局后开放局后自报');
await pt.getByLabel('自报座位').selectOption('1');
await pt.getByLabel('愿意再玩').selectOption('5');
await pt.getByLabel('像人程度（1=机器，5=人）').selectOption('2');
await pt.getByLabel('记得的同频次数').fill('4');
await pt.getByRole('checkbox', { name: '想换回真人' }).check();
await pt.getByLabel('一句异常').fill('测试异常');
await pt.locator('select').nth(3).selectOption('5');
assert.equal(await pt.getByLabel('自报座位').inputValue(), '1', '重渲染后保留自报座位草稿');
assert.equal(await pt.getByLabel('愿意再玩').inputValue(), '5', '重渲染后保留再玩意愿草稿');
assert.equal(await pt.getByLabel('像人程度（1=机器，5=人）').inputValue(), '2', '重渲染后保留机械感草稿');
assert.equal(await pt.getByLabel('记得的同频次数').inputValue(), '4', '重渲染后保留同频回忆草稿');
assert.equal(await pt.getByRole('checkbox', { name: '想换回真人' }).isChecked(), true, '重渲染后保留换回真人草稿');
assert.equal(await pt.getByLabel('一句异常').inputValue(), '测试异常', '重渲染后保留异常描述草稿');
await pt.getByRole('button', { name: '提交自报' }).click();
await pt.locator('select').nth(3).selectOption('0');
assert.equal(await pt.getByLabel('自报座位').inputValue(), '0', '成功提交后重置自报座位');
assert.equal(await pt.getByLabel('愿意再玩').inputValue(), '3', '成功提交后重置再玩意愿');
assert.equal(await pt.getByLabel('像人程度（1=机器，5=人）').inputValue(), '3', '成功提交后重置机械感');
assert.equal(await pt.getByLabel('记得的同频次数').inputValue(), '0', '成功提交后重置同频回忆');
assert.equal(await pt.getByRole('checkbox', { name: '想换回真人' }).isChecked(), false, '成功提交后重置换回真人');
assert.equal(await pt.getByLabel('一句异常').inputValue(), '', '成功提交后重置异常描述');
const pollDownloadPromise = pt.waitForEvent('download');
await pt.getByRole('button', { name: '导出实拍记录' }).click();
const pollDownload = await pollDownloadPromise;
const pollData = JSON.parse(readFileSync(await pollDownload.path(), 'utf8'));
const pollEvent = pollData.events.find((e) => e.type === 'post_game_poll');
assert.ok(pollEvent);
const { seq: pollSeq, ts: pollTs, ...pollPayload } = pollEvent;
assert.deepEqual(pollPayload, {
  type: 'post_game_poll',
  seat: 1,
  wantHumanBack: true,
  wouldReplay: 5,
  feltHuman: 2,
  recalledPeakCount: 4,
  oneLineAnomaly: '测试异常',
});
assert.ok(Number.isInteger(pollSeq));
assert.ok(Number.isFinite(pollTs));
assert.equal(await pt.getByLabel('自报座位').locator('option[value="1"]').evaluate((option) => option.disabled), true,
  '已提交座位的选项必须禁用，防止重复自报');
assert.equal(pollData.events.filter((event) => event.type === 'post_game_poll' && event.seat === 1).length, 1);

// URL 配置在重开/读档/导入后仍是唯一真值：6 人、固定 seed、仅配置座位由 AI 控制。
const exportCurrentPlaytest = async () => {
  const pending = pt.waitForEvent('download');
  await pt.getByRole('button', { name: '导出实拍记录' }).click();
  return JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
};
await pt.getByLabel('Seed').evaluate((input) => {
  input.value = '999';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await pt.getByRole('button', { name: '新开一局' }).click();
const restarted = await exportCurrentPlaytest();
assert.equal(restarted.events.filter((event) => event.type === 'game_start').length, 1,
  '新开一局必须清空旧事件并写一条新 game_start');
assert.equal(restarted.events[0].type, 'game_start');
assert.equal(restarted.events[0].seq, 0);
assert.equal(restarted.events.some((event) => ['human_turn_duration_ms', 'human_takeover_click',
  'table_attention_peak', 'gaze_panel', 'post_game_poll'].includes(event.type)), false,
  '新开一局不得保留上一局观察事件');
assert.equal(restarted.config.seed, 123456);
assert.equal(restarted.metadata.players, 6);
assert.equal(await pt.getByLabel('Seed').isDisabled(), true, '实拍页禁止编辑 seed');
assert.equal(await pt.locator('select').nth(1).isDisabled(), true, '实拍页禁止编辑人数');

await pt.getByRole('button', { name: '存档' }).click();
const savedEnvelope = await pt.evaluate(() => localStorage.getItem('creativemountain.save.v2'));
assert.ok(savedEnvelope, '实拍页存档必须写入 localStorage');
assert.equal(JSON.parse(JSON.parse(savedEnvelope).state).state.players.length, 6);
await pt.getByRole('button', { name: '记一次同频' }).click();
await pt.getByRole('button', { name: '读档' }).click();
const savedLoaded = await exportCurrentPlaytest();
assert.equal(savedLoaded.events.filter((event) => event.type === 'game_start').length, 1,
  '读档必须写新 game_start');
assert.equal(savedLoaded.events.some((event) => event.type === 'table_attention_peak'), false,
  '读档必须清空存档前的观察事件');
assert.equal(JSON.parse(savedLoaded.snapshot).state.players.length, 6);
assert.equal(JSON.parse(savedLoaded.snapshot).state.players[2].controlledBy, 'ai');

const playtestTheme = JSON.parse(readFileSync(resolve(ROOT, 'themes', 'xianxia2026', 'theme.json'), 'utf8'));
const fourPlayerState = installTheme(createInitialState({
  players: 4, seed: 999, deckSize: getScales(4).deckTotal,
}), playtestTheme);
const fourPlayerEnvelope = JSON.stringify({
  v: 2, themeId: playtestTheme.meta.id, state: stateToJson(fourPlayerState),
});
await pt.evaluate((save) => localStorage.setItem('creativemountain.save.v2', save), fourPlayerEnvelope);
await pt.getByRole('button', { name: '读档' }).click();
assert.equal(await pt.locator('.players .player').count(), 6, '读档不得把实拍局变成 4 人局');
assert.equal(await pt.getByLabel('Seed').inputValue(), '123456', '读档不得覆盖 URL seed');
const loaded = await exportCurrentPlaytest();
assert.equal(loaded.events.filter((event) => event.type === 'game_start').length, 1, '读档必须重置事件并写 game_start');
assert.equal(loaded.events[0].type, 'game_start');
assert.equal(loaded.metadata.players, 6);
assert.equal(JSON.parse(loaded.snapshot).state.players.length, 6);
assert.deepEqual(JSON.parse(loaded.snapshot).state.players.map((player) => player.controlledBy),
  ['human', 'human', 'ai', 'human', 'human', 'human'], '读档必须恢复 URL 指定的唯一 AI 座位');

const chooserPromise = pt.waitForEvent('filechooser');
await pt.getByRole('button', { name: '导入' }).click();
const chooser = await chooserPromise;
await chooser.setFiles({ name: 'four-player.json', mimeType: 'application/json', buffer: Buffer.from(fourPlayerEnvelope) });
await pt.locator('.players .player').nth(5).waitFor();
assert.equal(await pt.locator('.players .player').count(), 6, '导入不得把实拍局变成 4 人局');
assert.equal(await pt.getByLabel('Seed').inputValue(), '123456', '导入不得覆盖 URL seed');
const imported = await exportCurrentPlaytest();
assert.equal(imported.events.filter((event) => event.type === 'game_start').length, 1, '导入必须重置事件并写 game_start');
assert.equal(imported.events[0].type, 'game_start');
assert.equal(imported.metadata.players, 6);
assert.equal(JSON.parse(imported.snapshot).state.seed, 123456);
assert.equal(JSON.parse(imported.snapshot).state.players[2].controlledBy, 'ai');
assert.equal(JSON.parse(imported.snapshot).state.players[0].controlledBy, 'human');

await pt.locator('select').nth(2).selectOption('standard');
const modeChanged = await exportCurrentPlaytest();
assert.equal(modeChanged.metadata.mode, 'standard', '新局必须刷新模式元数据');
assert.equal(modeChanged.events.filter((event) => event.type === 'game_start').length, 1);
await pt.locator('select').nth(0).selectOption({ label: '科幻·AI 纪元' });
const themeChanged = await exportCurrentPlaytest();
assert.equal(themeChanged.metadata.themeId, 'scifi-ai', '新局必须刷新主题元数据');
assert.equal(themeChanged.events.filter((event) => event.type === 'game_start').length, 1);

const targetState = installTheme(createInitialState({
  players: 6, seed: 123456, deckSize: getScales(6).deckTotal,
}), playtestTheme);
const targetCard = targetState.players[0].hand.find((card) => cardNeedsTarget(card));
assert.ok(targetCard, '前提：必须有可选目标的牌');
const orderedTargetState = {
  ...targetState,
  turnOrder: [2, 0, 1, 3, 4, 5],
  turnIndex: 0,
  players: targetState.players.map((player) => {
    if (player.seat === 2) { return { ...player, hand: [targetCard, ...player.hand.slice(1)] }; }
    if (player.seat === 0) { return { ...player, hand: player.hand.filter((card) => card.id !== targetCard.id) }; }
    return player;
  }),
};
const targetEnvelope = JSON.stringify({
  v: 2, themeId: playtestTheme.meta.id, state: stateToJson(orderedTargetState),
});
await pt.evaluate((save) => localStorage.setItem('creativemountain.save.v2', save), targetEnvelope);
await pt.getByRole('button', { name: '读档' }).click();
await pt.locator('select').nth(3).selectOption('2');
await pt.locator(`[data-action-control="card:${targetCard.id}"]`).click();
const targetRow = pt.locator('[data-action-control="target-seat:1"]');
await targetRow.waitFor();
await targetRow.click();
const targetData = await exportCurrentPlaytest();
assert.ok(targetData.events.some((event) => event.type === 'human_takeover_click'
  && event.seat === 2 && event.control === 'target-seat:1'), '玩家行目标点击必须记录 AI 座位接管');
assert.deepEqual(JSON.parse(targetData.snapshot).state.players.map((player) => player.controlledBy),
  ['human', 'human', 'ai', 'human', 'human', 'human'], '同 seed 读档也不得保留存档中的任意控制权');
assert.equal(ptErrors.length, 0);
await pt.close();

// 实拍页缺失/非法 URL 配置时，读档与导入仍须让 UI 人数跟随存档，不能强写成 6。
const playtestBaseUrl = playtestUrl.slice(0, playtestUrl.indexOf('?'));
const invalidConfigPage = await browser.newPage();
const invalidConfigErrors = [];
invalidConfigPage.on('console', (m) => { if (m.type() === 'error') { invalidConfigErrors.push(m.text()); } });
invalidConfigPage.on('pageerror', (e) => { invalidConfigErrors.push('pageerror: ' + e.message); });
const fivePlayerState = installTheme(createInitialState({
  players: 5, seed: 888, deckSize: getScales(5).deckTotal,
}), playtestTheme);
const fivePlayerEnvelope = JSON.stringify({
  v: 2, themeId: playtestTheme.meta.id, state: stateToJson(fivePlayerState),
});
for (const search of ['', '?playtest=1&seed=bad&aiSeat=2']) {
  await invalidConfigPage.goto(playtestBaseUrl + search);
  await invalidConfigPage.evaluate((save) => localStorage.setItem('creativemountain.save.v2', save), fourPlayerEnvelope);
  await invalidConfigPage.getByRole('button', { name: '读档' }).click();
  assert.equal(await invalidConfigPage.locator('.players .player').count(), 4);
  assert.equal(await invalidConfigPage.locator('select').nth(1).inputValue(), '4',
    '无有效实拍配置时，读档 UI 人数必须跟随 4 人存档');
  assert.equal(await invalidConfigPage.getByLabel('Seed').inputValue(), '999');

  const invalidChooserPromise = invalidConfigPage.waitForEvent('filechooser');
  await invalidConfigPage.getByRole('button', { name: '导入' }).click();
  const invalidChooser = await invalidChooserPromise;
  await invalidChooser.setFiles({
    name: 'five-player.json', mimeType: 'application/json', buffer: Buffer.from(fivePlayerEnvelope),
  });
  await invalidConfigPage.waitForFunction(() => document.querySelector('input[aria-label="Seed"]')?.value === '888');
  assert.equal(await invalidConfigPage.locator('.players .player').count(), 5);
  assert.equal(await invalidConfigPage.locator('select').nth(1).inputValue(), '5',
    '无有效实拍配置时，导入 UI 人数必须跟随 5 人存档');
}
assert.equal(invalidConfigErrors.length, 0);
await invalidConfigPage.close();

// K7：程序座位尝试签印时，UI 必须显示引擎拒因，不得静默重绘。
// 用生产页隔离实拍 AI 自动调度，确保点击发生在未被推进的同一认证局面。
const certTheme = JSON.parse(readFileSync(resolve(ROOT, 'themes', 'xianxia2026', 'theme.json'), 'utf8'));
let certState = installTheme(createInitialState({
  players: 6,
  seed: 123456,
  deckSize: getScales(6).deckTotal,
}), certTheme);
certState = {
  ...certState,
  players: certState.players.map((player) => player.seat === 2
    ? { ...player, controlledBy: 'ai' }
    : player),
};
certState = {
  ...certState,
  players: certState.players.map((player) => player.seat === 0
    ? { ...player, position: certState.board.peakIndex }
    : player),
};
const pending = enterPendingCertification(certState, 0);
assert.equal(pending.ok, true, '前提：座 0 进入待认证必须成功');
const opened = advanceCertificationRound(pending.state);
assert.equal(opened.ok, true, '前提：第 1 轮认证必须成功');
const gateCert = gateScene(6, 123456, 3, 2);
const k7Scenes = [
  { name: 'normal', state: opened.state },
  {
    name: 'gate',
    state: {
      ...opened.state,
      board: gateCert.board,
      decks: gateCert.decks,
      players: opened.state.players.map((player) => player.seat === 2
        ? { ...player, position: 3 }
        : player),
    },
  },
  { name: 'duel', state: startDuel(opened.state, 0, 2) },
];
for (const scene of k7Scenes) {
  const certPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await certPage.goto(url);
  const certEnvelope = JSON.stringify({
    v: 2,
    themeId: certTheme.meta.id,
    state: stateToJson(scene.state),
  });
  await certPage.evaluate((save) => localStorage.setItem('creativemountain.save.v2', save), certEnvelope);
  await certPage.getByRole('button', { name: '读档' }).click();
  await certPage.locator('select').nth(3).selectOption('2');
  await certPage.getByRole('button', { name: '签印 座0' }).click({ timeout: 1000 });
  await certPage.locator('.warn').filter({ hasText: '程序座位没有签印权' }).waitFor({
    state: 'visible',
    timeout: 1000,
  });
  await certPage.close();
}
await browser.close();

const out = {
  ok: true,
  attempts,
  duelWarn,
  lockedDuringDuel,
  waitingText,
  duelGone,
  unlocked,
  roundChanged: beforeStatus.split('\n')[0] !== afterStatus.split('\n')[0],
  beforeRound: beforeStatus.split('\n')[0],
  afterRound: afterStatus.split('\n')[0],
  logHasDuel,
  publicShown,
  settled,
  consoleErrors: errors,
  playtestConsoleErrors: ptErrors,
};
console.log(JSON.stringify(out, null, 2));
process.exit(errors.length === 0 && ptErrors.length === 0 && unlocked && duelGone && publicShown && settled ? 0 : 1);
