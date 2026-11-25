// B86 · 门禁第 ⑭ 道：数字轨浏览器走查与可观测断言。
//
// 为什么要有这道门：门 ⑩（tests/e2e/duel-e2e.mjs）只覆盖「对峙链路」
//   （触发对峙 → 回合锁定 → 选牌 → 揭晓 → 解锁），其余界面面**没有真浏览器断言**：
//   主题矩阵、几何、响应式、非法输入的可见错误信号 —— 改了版式只能靠人看渲染图。
//   B86 的缘起正是「探针数字全绿 ≠ 页面没坏」。
//
// ⚠️ 三条硬约束：
//   ① 必须用 **file://** 打开 —— 产品承诺是「单文件 HTML 双击即玩、离线可用」，
//      换成 http 预览等于把要验的东西换掉（B58 探针同款纪律）。
//   ② console / pageerror 监听必须在 **goto 之前**注册，否则收不到错误。
//   ③ 期望值一律**从真值源派生**（theme.json 的 terms、engine/scales.ts 的规模表），
//      不在本文件手抄（E98：计划里的具体值一律现查现用）。
//
// 纪律 A4：不经 shell、不接管道；退出码直取。

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SCALES } from '../../engine/scales.ts';

const ROOT = process.env.CM_REPO_ROOT !== undefined ? resolve(process.env.CM_REPO_ROOT) : process.cwd();
const require = createRequire(resolve(ROOT, 'package.json'));
const { chromium } = require('playwright');

/** 被验的单文件产物（门 ④ 的 dist/）。负样本用 CM_E2E_BUNDLE 指向副本产物。 */
const BUNDLE = process.env.CM_E2E_BUNDLE !== undefined
  ? resolve(process.env.CM_E2E_BUNDLE)
  : resolve(ROOT, 'dist', '创界山-活人认证.html');

/** 横向溢出容差（px）—— 留 1px 给亚像素取整。⚠️ 负样本 C 注入它 ⇒ 必须独立成常量。 */
const OVERFLOW_TOLERANCE = 1;

/** 棋盘格数允许区间 = **派生**自规模表（规格 §8；不手抄具体值）。 */
const BOARD_LENGTH_RANGE = [
  Math.min(...SCALES.map((r) => r.boardLength)),
  Math.max(...SCALES.map((r) => r.boardLength)),
];

/**
 * 棋盘格的**可接受下限**（px）。
 * ⚠️ 只判「> 0」是**恒真**的：`.tile` 有 1px 边框 ⇒ 注入 `width:0;height:0` 后实测盒子仍是 2×2px
 *   ⇒ 走查照样全绿（B86 独立盲审用变异实测抓出）。规格是 42px ⇒ 这里取一个够严又不脆的下限。
 */
const MIN_TILE_SIZE = 20;

/**
 * 已知无害的 console 错误（**显式登记**，不静默吞掉）。
 * 空数组 = 不豁免任何错误；新增条目必须写明为什么无害。
 */
const KNOWN_BENIGN_CONSOLE = [];

const THEME_IDS = ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid'];
/** 人数档：主题矩阵跑 4 人（默认），另跑 3 / 8 人验证规模表联动。 */
const MATRIX_PLAYERS = 4;
const EXTRA_PLAYER_COUNTS = [3, 8];

/** 主题真值（从 theme.json 派生）。 */
function loadThemes() {
  return THEME_IDS.map((id) => {
    const raw = JSON.parse(readFileSync(resolve(ROOT, 'themes', id, 'theme.json'), 'utf8'));
    return { id, name: raw.meta.name, path: raw.terms.path };
  });
}

/** 规模表真值（engine/scales.ts）。 */
function scaleOf(players) {
  const row = SCALES.find((r) => r.players === players);
  if (row === undefined) { throw new Error('规模表没有 ' + String(players) + ' 人档'); }
  return row;
}

const failures = [];
let checks = 0;

function check(scope, name, ok, detail) {
  checks += 1;
  if (!ok) { failures.push(scope + ' · ' + name + '：' + detail); }
  return ok;
}

if (!existsSync(BUNDLE)) {
  console.error('走查产物不存在：' + BUNDLE + '（先跑 npm run build）');
  process.exit(1);
}

const themes = loadThemes();
const pageUrl = pathToFileURL(BUNDLE).href;

const browser = await chromium.launch({ headless: true });
// ⚠️ console 错误收集器声明在 try **之外** —— 末尾的 summary 在 try 外引用它
//   （放进去 ⇒ ReferenceError，走查根本跑不完 —— B86 自查当场抓到）。
const consoleErrors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // ⚠️ 硬约束 ②：监听必须在 goto 之前注册。
  page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push('console: ' + m.text()); } });
  page.on('pageerror', (e) => { consoleErrors.push('pageerror: ' + e.message); });

  await page.goto(pageUrl);

  // ---- 页面级契约 ----
  check('页面', '标题', await page.title() === '创界山·活人认证', 'title=' + JSON.stringify(await page.title()));

  const selects = page.locator('select');
  const themeSel = selects.nth(0);
  const countSel = selects.nth(1);
  const seatSel = selects.nth(3);

  /** 开一局并等棋盘渲染出来。 */
  async function startGame(players) {
    await countSel.selectOption(String(players));
    await page.getByRole('button', { name: '新开一局' }).click();
    await page.waitForSelector('.board .tile', { timeout: 15000 });
  }

  /** 读当前手番座位号（.status 的「当前… 座N」）。 */
  async function currentSeat() {
    const text = await page.locator('.status').first().innerText();
    const m = /当前\S* 座(\d+)/.exec(text);
    return m === null ? null : Number(m[1]);
  }

  /** 量真实盒子（不是源码形状）。 */
  async function measure() {
    return page.evaluate(() => {
      const doc = document.documentElement;
      const tiles = [...document.querySelectorAll('.board .tile')].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, left: r.left, right: r.right };
      });
      const cards = [...document.querySelectorAll('.hand .card')].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, right: r.right };
      });
      const panels = [...document.querySelectorAll('.panel')].map((el) => {
        const body = el.querySelector('.panel-body');
        return { title: (el.querySelector('.panel-title')?.textContent ?? '').trim(), bodyLen: (body?.textContent ?? '').trim().length };
      });
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        tiles,
        cards,
        panels,
        players: document.querySelectorAll('.players .player').length,
        cardsCount: document.querySelectorAll('.hand .card').length,
        titles: [...document.querySelectorAll('.panel-title')].map((el) => (el.textContent ?? '').trim()),
        bodyText: document.body.innerText,
      };
    });
  }

  // ---- 主题矩阵（每套主题各跑一局）----
  for (const theme of themes) {
    const scope = '主题[' + theme.name + ']';
    await themeSel.selectOption({ label: theme.name });
    await startGame(MATRIX_PLAYERS);

    const m = await measure();
    const expectLen = scaleOf(MATRIX_PLAYERS).boardLength;

    check(scope, '玩家行数', m.players === MATRIX_PLAYERS, '实际 ' + String(m.players) + ' 行，期望 ' + String(MATRIX_PLAYERS));
    check(scope, '棋盘格数', m.tiles.length === expectLen,
      '实际 ' + String(m.tiles.length) + ' 格，规格期望 ' + String(expectLen) + ' 格（scales[' + String(MATRIX_PLAYERS) + '].boardLength）');
    check(scope, '棋盘格数区间', m.tiles.length >= BOARD_LENGTH_RANGE[0] && m.tiles.length <= BOARD_LENGTH_RANGE[1],
      '实际 ' + String(m.tiles.length) + ' 格，超出规格区间 ' + BOARD_LENGTH_RANGE.join('–'));
    check(scope, '手牌非空', m.cardsCount > 0, '手牌 ' + String(m.cardsCount) + ' 张');
    check(scope, '面板标题取主题词', m.titles.some((t) => t.includes(theme.path)),
      '面板标题 ' + JSON.stringify(m.titles) + ' 里没有该主题的 path 叶「' + theme.path + '」');
    check(scope, '占位符残留', !/\{[a-z_]+\}/i.test(m.bodyText),
      '正文出现未展开的占位符：' + JSON.stringify((/\{[a-z_]+\}/i.exec(m.bodyText) ?? [''])[0]));
    check(scope, '面板无空白', m.panels.every((p) => p.bodyLen > 0),
      '空白面板：' + JSON.stringify(m.panels.filter((p) => p.bodyLen === 0).map((p) => p.title)));
    check(scope, '棋盘格尺寸达标', m.tiles.every((t) => t.w >= MIN_TILE_SIZE && t.h >= MIN_TILE_SIZE),
      '有 ' + String(m.tiles.filter((t) => t.w < MIN_TILE_SIZE || t.h < MIN_TILE_SIZE).length)
      + ' 个被压扁/消失的格（实测尺寸 < ' + String(MIN_TILE_SIZE) + 'px）');
    check(scope, '横向溢出', m.scrollWidth <= m.clientWidth + OVERFLOW_TOLERANCE,
      '横向溢出：scrollWidth=' + String(m.scrollWidth) + ' > clientWidth=' + String(m.clientWidth));
    check(scope, '手牌不越界', m.cards.every((c) => c.right <= m.clientWidth + OVERFLOW_TOLERANCE),
      '有手牌越出视口右边界');
  }

  // ---- 人数档联动（基准主题）----
  for (const players of EXTRA_PLAYER_COUNTS) {
    const scope = '人数[' + String(players) + ']';
    await startGame(players);
    const m = await measure();
    const expectLen = scaleOf(players).boardLength;
    check(scope, '玩家行数', m.players === players, '实际 ' + String(m.players) + ' 行，期望 ' + String(players));
    check(scope, '棋盘格数', m.tiles.length === expectLen,
      '实际 ' + String(m.tiles.length) + ' 格，规格期望 ' + String(expectLen) + ' 格');
  }

  // ---- 错误路径：非法 seed 必须给出可见错误信号 ----
  {
    const scope = '错误路径[seed]';
    const seedInput = page.locator('input[aria-label="Seed"]');
    // ⚠️ 输入框是 type=number ⇒ 用户能造出的非法值是**小数 / 空**，不是字母（浏览器直接拒绝）。
    //   这两条都是**真实用户可达**的路径（Playwright 的 fill 同样不能往 number 里塞字母）。
    for (const bad of ['1.5', '']) {
      await seedInput.fill(bad);
      const invalid = await seedInput.getAttribute('aria-invalid');
      const title = await seedInput.getAttribute('title');
      check(scope, '非法 seed 标记[' + JSON.stringify(bad) + ']', invalid === 'true',
        'aria-invalid=' + JSON.stringify(invalid));
      check(scope, '非法 seed 提示文案[' + JSON.stringify(bad) + ']',
        typeof title === 'string' && title.includes('4294967295'), 'title=' + JSON.stringify(title));
    }
    await seedInput.fill('42');
    const cleared = await seedInput.getAttribute('aria-invalid');
    check(scope, '合法 seed 清除标记', cleared === null, 'aria-invalid=' + JSON.stringify(cleared));
  }

  // ---- 交互路径：切到当前手番座 → 行棋 → 日志增加 ----
  {
    const scope = '交互[行棋]';
    const before = await page.locator('.log-line').count();
    let seat = await currentSeat();
    if (seat === null) {
      for (const candidate of [0, 1, 2, 3]) {
        await seatSel.selectOption(String(candidate));
        if (await page.getByRole('button', { name: /^行棋/ }).count() > 0) { seat = candidate; break; }
      }
    } else {
      await seatSel.selectOption(String(seat));
    }
    const moveBtn = page.getByRole('button', { name: /^行棋/ });
    if (await moveBtn.count() > 0) {
      await moveBtn.first().click();
      await page.waitForTimeout(150);
      const after = await page.locator('.log-line').count();
      check(scope, '行棋后日志增加', after > before, '日志行数 ' + String(before) + ' → ' + String(after));
    } else {
      check(scope, '行棋按钮存在', false, '当前座位没有「行棋」按钮（seat=' + String(seat) + '）');
    }
  }

  // ---- 响应式：窄屏不得横向溢出 ----
  {
    const scope = '响应式[390]';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const m = await measure();
    check(scope, '横向溢出', m.scrollWidth <= m.clientWidth + OVERFLOW_TOLERANCE,
      '窄屏横向溢出：scrollWidth=' + String(m.scrollWidth) + ' > clientWidth=' + String(m.clientWidth));
    check(scope, '棋盘格在视口内', m.tiles.every((t) => t.left >= -OVERFLOW_TOLERANCE && t.right <= m.clientWidth + OVERFLOW_TOLERANCE),
      '有棋盘格越出窄屏视口');
  }

  // ---- console 错误 ----
  {
    const scope = 'console';
    const unexpected = consoleErrors.filter((e) => !KNOWN_BENIGN_CONSOLE.some((k) => e.includes(k)));
    check(scope, '无 console/page 错误', unexpected.length === 0,
      '共 ' + String(unexpected.length) + ' 条：' + JSON.stringify(unexpected.slice(0, 3)));
  }

} catch (err) {
  failures.push('走查致命错误：' + (err && err.stack ? err.stack : String(err)));
} finally {
  await browser.close();
}

const summary = { ok: failures.length === 0, checks, failures, consoleErrors, bundle: BUNDLE };
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  for (const f of failures) { console.error('✗ ' + f); }
  process.exit(1);
}
console.log('✓ 数字轨浏览器走查：' + String(checks) + ' 条断言全过');
