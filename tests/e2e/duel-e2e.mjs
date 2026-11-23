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
const productionHtml = readFileSync(file, 'utf8');
assert.equal(productionHtml.includes('实拍观察员'), false, '生产 HTML 不得包含观察员文案');
assert.equal(productionHtml.includes('playtest-panel'), false, '生产 HTML 不得包含实拍面板类名');

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
const operatorSeat = [0, 1, 3, 4, 5].find((seat) => seat !== currentTurnSeat);
assert.notEqual(operatorSeat, undefined, '应能选择与当前手番不同的真人操作者');
await pt.getByLabel('焦点座位').selectOption('4');
await pt.getByLabel('持续秒数').fill('7.5');
await pt.locator('select').nth(3).selectOption(String(operatorSeat));
assert.equal(await pt.getByLabel('焦点座位').inputValue(), '4', 'AI 重渲染后保留焦点座位草稿');
assert.equal(await pt.getByLabel('持续秒数').inputValue(), '7.5', 'AI 重渲染后保留持续秒数草稿');
await pt.getByRole('button', { name: '记一次同频' }).click();
await pt.clock.install();
await pt.clock.runFor(500);
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
await pt.getByLabel('感到机械').selectOption('2');
await pt.getByLabel('记得的同频次数').fill('4');
await pt.getByRole('checkbox', { name: '想换回真人' }).check();
await pt.getByLabel('一句异常').fill('测试异常');
await pt.locator('select').nth(3).selectOption('5');
assert.equal(await pt.getByLabel('自报座位').inputValue(), '1', '重渲染后保留自报座位草稿');
assert.equal(await pt.getByLabel('愿意再玩').inputValue(), '5', '重渲染后保留再玩意愿草稿');
assert.equal(await pt.getByLabel('感到机械').inputValue(), '2', '重渲染后保留机械感草稿');
assert.equal(await pt.getByLabel('记得的同频次数').inputValue(), '4', '重渲染后保留同频回忆草稿');
assert.equal(await pt.getByRole('checkbox', { name: '想换回真人' }).isChecked(), true, '重渲染后保留换回真人草稿');
assert.equal(await pt.getByLabel('一句异常').inputValue(), '测试异常', '重渲染后保留异常描述草稿');
await pt.getByRole('button', { name: '提交自报' }).click();
await pt.locator('select').nth(3).selectOption('0');
assert.equal(await pt.getByLabel('自报座位').inputValue(), '0', '成功提交后重置自报座位');
assert.equal(await pt.getByLabel('愿意再玩').inputValue(), '3', '成功提交后重置再玩意愿');
assert.equal(await pt.getByLabel('感到机械').inputValue(), '3', '成功提交后重置机械感');
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
  feltRobotic: 2,
  recalledPeakCount: 4,
  oneLineAnomaly: '测试异常',
});
assert.ok(Number.isInteger(pollSeq));
assert.ok(Number.isFinite(pollTs));
assert.equal(ptErrors.length, 0);
await pt.close();
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
