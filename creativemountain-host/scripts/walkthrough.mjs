#!/usr/bin/env node
// =============================================
// 创界山·活人认证 — React host（creativemountain-host）浏览器走查
//
// 目标：在 host 子项目内自起 vite dev server，用 Playwright 逐页走查，
//       输出**可观测事实**（状态码 / 正文长度 / console 错误 / 溢出 /
//       testid 命中 / 窄屏主区宽度 / 交互结果），
//       退出码 0 = 全绿，非 0 = 有断言失败。
//
// 纪律（仓内硬规）：
//   - 不使用 shell: true（会改退出码语义）；不把命令接进管道。
//   - 退出码直取 child 'exit' / spawnSync status。
//   - 只 import node 内置模块 + 根仓 playwright（createRequire 解析）。
//   - 只杀自己起的 vite 子进程，不动端口占用者。
//
// 静态守卫锚点（勿删）：page.on('console' / pageerror / scrollWidth / clientWidth
//   以及下方 ROUTE_EXPECTATIONS 路由清单字面量 —— 根仓门禁按此比对。
//
// ⚠️ 判定只认 **data-testid**（L-B86-1）：脚本里**不出现任何界面文案**，
//   改一次 UI 文案不得打断走查（⇒ ROUTE_EXPECTATIONS 只登记路由，其余看 TESTIDS）。
// =============================================

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

// 仓根 = host 子项目的**父目录**（⚠️ 不写死本机绝对路径：换机/换目录且未设 CM_REPO_ROOT
//   时原写法会解析不到 playwright，报 MODULE_NOT_FOUND 而非可读错误 —— B86 盲审抓出）。
const HOST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// CM_REPO_ROOT 可显式覆盖（根仓静态守卫 / 隔离副本用）。
// ⚠️ host 子项目内没有 playwright 依赖 ⇒ 从**仓根**的 node_modules 解析（createRequire）。
const ROOT = resolve(process.env.CM_REPO_ROOT ?? resolve(HOST_DIR, '..'));
const require = createRequire(resolve(ROOT, 'package.json'));
const { chromium } = require('playwright');

// ---- 路由清单 = **真正驱动走查的那个常量** --------------------------------
// ⚠️ 早先这里另有一个**从未被使用的** `const ROUTES = [...]` 字面量，而根仓静态守卫比对的正是它
//   ⇒ 从真正驱动走查的期望表里删掉一页，守卫照样全绿（假绿 —— B86 独立盲审抓出）。
//   ⇒ 现在**只有一份事实源**（ROUTE_EXPECTATIONS），守卫直接比对它的 route 字段。
// 来源：src/flows/host-screen/host-screen.tsx 的 <Routes>：
//   '/' → Navigate to '/flow1'（replace）
//   '/flow1' / '/flow2' / '/flow3' / '/flow4' 四个 flow 入口
// 每页**只登记路由**；页面上"应当存在什么"完全由下方 TESTIDS 决定。
//   ⚠️ 这里**不得**出现任何界面文案（改 UI 文案不得打断走查 —— L-B86-1）。
const ROUTE_EXPECTATIONS = [
  { route: '/' },
  { route: '/flow1' },
  { route: '/flow2' },
  { route: '/flow3' },
  { route: '/flow4' },
];

// ---- data-testid **唯一事实源**（L-B86-1） --------------------------------
// ⚠️ 判定用到的**每一个** testid 都必须写在这张表里；断言代码一律从这里取值，
//   **不得**再出现第二份 testid 字面量数组/对象（那是「死常量」假绿的形状 —— B86 盲审抓出）。
//   下面每一项都真的被断言代码使用（见 assertTestidVisible / 交互断言 / 窄屏断言）。
const TESTIDS = {
  // 路由 → 页面根容器 testid
  '/': 'flow1-root',
  '/flow1': 'flow1-root',
  '/flow2': 'flow2-root',
  '/flow3': 'flow3-root',
  '/flow4': 'flow4-root',
  // 路由 → 关键可点击控件 testid
  'control:/': 'flow1-drill',
  'control:/flow1': 'flow1-drill',
  'control:/flow2': 'flow2-enter',
  'control:/flow3': 'flow3-rank',
  'control:/flow4': 'flow4-generate',
  // flow1 内部锚点
  'flow1:board': 'flow1-board',
  'flow1:screen:drill': 'flow1-drill-screen',
  // 各 flow 的**屏号指示器**（B87：屏号以机器可读属性 data-screen 承载 ⇒ 走查不靠中文正文）
  'flow1:screen:indicator': 'flow1-screen-indicator',
  'flow2:screen:indicator': 'flow2-screen-indicator',
  'flow3:screen:indicator': 'flow3-screen-indicator',
  'flow4:screen:indicator': 'flow4-screen-indicator',
  // 各 flow 页头翻页按钮 testid（窄屏页头压扁的观测点）
  'flow1:header:prev': 'flow1-prev',
  'flow1:header:next': 'flow1-next',
  'flow2:header:prev': 'flow2-prev',
  'flow2:header:next': 'flow2-next',
  'flow3:header:prev': 'flow3-prev',
  'flow3:header:next': 'flow3-next',
  'flow4:header:prev': 'flow4-prev',
  // host 外壳锚点（host-screen.tsx）
  'shell:main': 'host-main',
  'shell:sidebar': 'host-sidebar',
  'shell:nav': 'host-nav',
  'shell:theme:narrow': 'host-theme-toggle-narrow',
  'shell:theme:desktop': 'host-theme-toggle-desktop',
};

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];
const CANDIDATE_PORTS = [5199, 5200, 5201];
const SERVER_READY_TIMEOUT_MS = 30000;
const MIN_TEXT_LENGTH = 80;
// 窄屏（390px）主内容区最小宽度阈值（L-B86-2）。
// ⚠️ 旧布局侧栏固定 w-56(224px) + shrink-0 ⇒ 390 视口下主区只剩约 166px。
//   改成窄屏顶部导航条后主区应占满宽度（≈390px）⇒ 阈值 320px。
const MIN_NARROW_MAIN_WIDTH = 320;
// 桌面（≥768px）侧栏宽度下限（w-56 = 224px，桌面态不得被窄屏改动影响）。
const MIN_DESKTOP_SIDEBAR_WIDTH = 224;
// 页头翻页按钮最小宽度（窄屏下按钮不得被压到装不下自身文字；同时满足触控友好）。
const MIN_HEADER_BUTTON_WIDTH = 44;
// 页头按钮的**高度**下限（px）—— 防「被压成细条」。
// ⚠️ 44px 的触控口径针对**宽度**（本页头按钮实测 66×26px）；高度按设计系统的 sm 尺寸取现实下限，
//   若把高度也钉到 44，断言会**恒红** ⇒ 那不是守卫，是误判。
const MIN_HEADER_BUTTON_HEIGHT = 20;
// 已知无害的 console 噪声（单列，不吞掉）。
// ⚠️ **不得**豁免通用 404：那会连带吞掉真实的资源/chunk 缺失（B86 独立盲审抓出）⇒ 只豁免 favicon。
const KNOWN_ERROR_PATTERNS = [/favicon/i];

const failures = [];
const knownErrors = [];

function fail(message) {
  failures.push(message);
}

function isKnownError(text) {
  return KNOWN_ERROR_PATTERNS.some((re) => re.test(text));
}

// ---- testid 命中 + 可见性判定（唯一入口，全部走 TESTIDS）------------------
// 断言：元素**存在** 且 **有非零盒子宽高**（可见）⇒ 才算命中。
async function assertTestidVisible(page, route, viewportWidth, testid, role) {
  const locator = page.locator('[data-testid="' + testid + '"]').first();
  const count = await locator.count();
  if (count === 0) {
    fail('[' + route + '@' + String(viewportWidth) + '] 未找到 data-testid="' + testid + '"（' + role + '）');
    return null;
  }
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    fail('[' + route + '@' + String(viewportWidth) + '] data-testid="' + testid + '" 不可见（零盒子）：' + role);
    return null;
  }
  return box;
}

// ---- 各 flow 的页头翻页按钮（testid 取自唯一事实源 TESTIDS）------------
function headerButtonSpecs(flowKey) {
  if (flowKey === 'flow1') {
    return [
      { role: 'prev', testid: TESTIDS['flow1:header:prev'] },
      { role: 'next', testid: TESTIDS['flow1:header:next'] },
    ];
  }
  if (flowKey === 'flow2') {
    return [
      { role: 'prev', testid: TESTIDS['flow2:header:prev'] },
      { role: 'next', testid: TESTIDS['flow2:header:next'] },
    ];
  }
  if (flowKey === 'flow3') {
    return [
      { role: 'prev', testid: TESTIDS['flow3:header:prev'] },
      { role: 'next', testid: TESTIDS['flow3:header:next'] },
    ];
  }
  if (flowKey === 'flow4') {
    return [
      { role: 'prev', testid: TESTIDS['flow4:header:prev'] },
    ];
  }
  return [];
}

// ---- testid 存在性判定（元素存在即可，不要求可见）------------------------
// ⚠️ 响应式元素（窄屏顶部导航条 / 桌面侧栏）在另一个视口下**理应不可见**
//   ⇒ 它们的"必须存在"用本函数，"必须可见/必须不可见"按视口分别判定。
async function assertTestidExists(page, route, viewportWidth, testid, role) {
  const locator = page.locator('[data-testid="' + testid + '"]').first();
  if ((await locator.count()) === 0) {
    fail('[' + route + '@' + String(viewportWidth) + '] 未找到 data-testid="' + testid + '"（' + role + '）');
    return false;
  }
  return true;
}

// ---- vite 可执行入口定位 ------------------------------------------------
function resolveViteBin() {
  const direct = resolve(HOST_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(direct)) {
    return direct;
  }
  const pkgPath = resolve(HOST_DIR, 'node_modules', 'vite', 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error('找不到 vite：' + HOST_DIR + ' 下既无 node_modules/vite/bin/vite.js 也无 package.json');
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.vite;
  return resolve(HOST_DIR, 'node_modules', 'vite', bin);
}

function portFree(port) {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once('error', () => done(false));
    srv.once('listening', () => srv.close(() => done(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function waitFor200(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status === 200) {
        return true;
      }
    } catch {
      // 服务还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// ---- 起 dev server（最多试 3 个端口，不杀别人的进程）--------------------
async function startServer() {
  const viteBin = resolveViteBin();
  let lastErr = '';
  for (const port of CANDIDATE_PORTS) {
    if (!(await portFree(port))) {
      lastErr = '端口 ' + port + ' 已被占用';
      continue;
    }
    const child = spawn(
      process.execPath,
      [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: HOST_DIR, stdio: ['ignore', 'pipe', 'pipe'], shell: false },
    );
    let stderr = '';
    child.stderr.on('data', (buf) => { stderr += buf.toString(); });
    child.stdout.on('data', () => {});
    const exited = new Promise((done) => child.on('exit', (code) => done(code)));
    const ready = await waitFor200('http://127.0.0.1:' + port + '/', SERVER_READY_TIMEOUT_MS);
    if (ready) {
      return { child, port, baseUrl: 'http://127.0.0.1:' + port, stderr: () => stderr, exited };
    }
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 2000))]);
    lastErr = '端口 ' + port + ' 启动失败（exit=' + code + '）\n' + stderr;
    try { child.kill(); } catch { /* 已经退出 */ }
  }
  throw new Error('vite dev server 启动失败：' + lastErr);
}

// ---- 主流程 -------------------------------------------------------------
let server = null;
let browser = null;

try {
  server = await startServer();
  const baseUrl = server.baseUrl;
  browser = await chromium.launch({ headless: true });

  const pages = [];
  const viewports = [];
  const testids = [];
  const headerButtonWidths = [];
  const responsive = [];
  const interaction = { route: '/flow1', element: '', clicked: false, before: '', after: '', changed: false, url: '', detail: '' };

  for (const vp of VIEWPORTS) {
    const vpEntry = { width: vp.width, height: vp.height, overflow: false, routes: [] };
    for (const exp of ROUTE_EXPECTATIONS) {
      const consoleErrors = [];
      const pageErrors = [];
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      // 监听必须在 goto 之前注册，否则收不到早期 console 错误。
      page.on('console', (m) => {
        if (m.type() === 'error') {
          consoleErrors.push(m.text());
        }
      });
      page.on('pageerror', (e) => {
        pageErrors.push('pageerror: ' + e.message);
      });

      let status = 0;
      let textLen = 0;
      let overflow = null;
      try {
        const resp = await page.goto(baseUrl + exp.route, { waitUntil: 'load', timeout: 30000 });
        status = resp ? resp.status() : 0;
        await page.waitForTimeout(400);

        textLen = await page.evaluate(() => document.body ? document.body.innerText.length : 0);

        // React 挂载健康
        const mount = await page.evaluate(() => {
          const root = document.getElementById('root');
          return {
            rootChildren: root ? root.children.length : 0,
            nodeCount: document.querySelectorAll('*').length,
          };
        });
        if (mount.rootChildren < 1) {
          fail('[' + exp.route + '@' + vp.width + '] #root 没有子节点（React 未挂载）');
        }
        if (mount.nodeCount <= 10) {
          fail('[' + exp.route + '@' + vp.width + '] DOM 节点数 ' + mount.nodeCount + ' <= 10（页面疑似空壳）');
        }

        // ---- 关键元素：改用 data-testid 判定（不再依赖中文文案）----
        const rootBox = await assertTestidVisible(page, exp.route, vp.width, TESTIDS[exp.route], '页面根容器');
        const controlBox = await assertTestidVisible(
          page, exp.route, vp.width, TESTIDS['control:' + exp.route], '关键可点击控件',
        );
        testids.push({
          route: exp.route,
          viewport: vp.width,
          rootTestid: TESTIDS[exp.route],
          rootVisible: rootBox !== null,
          controlTestid: TESTIDS['control:' + exp.route],
          controlVisible: controlBox !== null,
          // 诊断信息（只打 testid，不含任何界面文案）：判定所依据的锚点
          assertedTestids: [TESTIDS[exp.route], TESTIDS['control:' + exp.route]],
        });

        // ---- 外壳 testid：主内容区（两视口都可见） + 侧栏/顶部导航条（各视口只有一个可见）----
        const mainBox = await assertTestidVisible(page, exp.route, vp.width, TESTIDS['shell:main'], '主内容区 main');
        await assertTestidExists(page, exp.route, vp.width, TESTIDS['shell:sidebar'], '桌面侧栏 aside');
        await assertTestidExists(page, exp.route, vp.width, TESTIDS['shell:nav'], '窄屏顶部导航条 nav');
        // 可见性按视口判定（窄屏只显示导航条，桌面只显示侧栏）。
        const sidebarBox = vp.width < 768
          ? null
          : await assertTestidVisible(page, exp.route, vp.width, TESTIDS['shell:sidebar'], '桌面侧栏 aside');
        const navBox = vp.width < 768
          ? await assertTestidVisible(page, exp.route, vp.width, TESTIDS['shell:nav'], '窄屏顶部导航条 nav')
          : null;
        // 另一个视口下"应隐藏"的元素：不可见（零盒子）才算对
        if (vp.width < 768) {
          const hiddenSidebar = page.locator('[data-testid="' + TESTIDS['shell:sidebar'] + '"]').first();
          if ((await hiddenSidebar.count()) > 0) {
            const hb = await hiddenSidebar.boundingBox();
            if (hb && hb.width > 0 && hb.height > 0) {
              fail('[' + exp.route + '@' + String(vp.width) + '] 窄屏下桌面侧栏仍可见（应仅 ≥768px 显示）');
            }
          }
        } else {
          const hiddenNav = page.locator('[data-testid="' + TESTIDS['shell:nav'] + '"]').first();
          if ((await hiddenNav.count()) > 0) {
            const nb = await hiddenNav.boundingBox();
            if (nb && nb.width > 0 && nb.height > 0) {
              fail('[' + exp.route + '@' + String(vp.width) + '] 桌面视口下窄屏顶部导航条仍可见（应仅 <768px 显示）');
            }
          }
        }

        // ---- 响应式判定（L-B86-2）----
        // ---- flow1 山道棋盘容器（flow1 专属锚点）----
        if (exp.route === '/' || exp.route === '/flow1') {
          await assertTestidVisible(page, exp.route, vp.width, TESTIDS['flow1:board'], '山道棋盘容器');
        }

        // ---- 页头翻页按钮宽度断言（窄屏页头曾被压扁 ⇒ 按钮宽度不足）----
        const flowKey = exp.route === '/' ? 'flow1' : exp.route.slice(1);
        // ⚠️ 键的取用方式（**与实现一致，勿再写反**）：页头锚点键在本函数里**逐字引用**
        //   （如 TESTIDS['flow1:header:prev']）；路由键与 control 键则经变量拼接访问
        //   （TESTIDS[exp.route] / TESTIDS['control:' + exp.route]）。
        //   ⇒「键在表里却没人用」的死常量形状由**根仓静态守卫逐键核对**钉住
        //   （tests/gates/host-walkthrough-contract.test.ts），不靠本文件的注释背书。
        const headerButtons = headerButtonSpecs(flowKey);
        for (const hb of headerButtons) {
          const box = await assertTestidVisible(page, exp.route, vp.width, hb.testid, '页头翻页按钮(' + hb.role + ')');
          const width = box ? Math.round(box.width) : 0;
          const height = box ? Math.round(box.height) : 0;
          headerButtonWidths.push({
            route: exp.route,
            viewport: vp.width,
            role: hb.role,
            testid: hb.testid,
            width,
            height,
          });
          if (vp.width < 768 && box !== null && width < MIN_HEADER_BUTTON_WIDTH) {
            fail('[' + exp.route + '@' + String(vp.width) + '] 窄屏页头翻页按钮 data-testid="' + hb.testid
              + '" 宽度 ' + width + 'px < ' + MIN_HEADER_BUTTON_WIDTH + 'px（页头被压扁，按钮容不下自身文字）');
          }
          if (vp.width < 768 && box !== null && height < MIN_HEADER_BUTTON_HEIGHT) {
            fail('[' + exp.route + '@' + String(vp.width) + '] 窄屏页头翻页按钮 data-testid="' + hb.testid
              + '" 高度 ' + height + 'px < ' + MIN_HEADER_BUTTON_HEIGHT + 'px（按钮被压成细条）');
          }
        }

        if (vp.width < 768) {
          // 窄屏：顶部导航条接管、侧栏隐藏、主区占满宽度
          if (mainBox !== null && mainBox.width < MIN_NARROW_MAIN_WIDTH) {
            fail('[' + exp.route + '@' + String(vp.width) + '] 窄屏主内容区宽度 ' + Math.round(mainBox.width)
              + 'px < ' + MIN_NARROW_MAIN_WIDTH + 'px（主区被侧栏挤扁）');
          }
          await assertTestidVisible(page, exp.route, vp.width, TESTIDS['shell:theme:narrow'], '窄屏亮/暗色切换');
          await assertTestidExists(page, exp.route, vp.width, TESTIDS['shell:theme:desktop'], '桌面亮/暗色切换');
          responsive.push({
            route: exp.route,
            viewport: vp.width,
            mode: 'narrow',
            mainWidth: mainBox ? Math.round(mainBox.width) : null,
            minMainWidth: MIN_NARROW_MAIN_WIDTH,
            navVisible: navBox !== null,
            sidebarVisible: sidebarBox !== null,
          });
        } else {
          // 桌面：侧栏保持 224px、顶部导航条隐藏
          if (sidebarBox !== null && sidebarBox.width < MIN_DESKTOP_SIDEBAR_WIDTH) {
            fail('[' + exp.route + '@' + String(vp.width) + '] 桌面侧栏宽度 ' + Math.round(sidebarBox.width)
              + 'px < ' + MIN_DESKTOP_SIDEBAR_WIDTH + 'px（桌面态被窄屏改动影响）');
          }
          await assertTestidVisible(page, exp.route, vp.width, TESTIDS['shell:theme:desktop'], '桌面亮/暗色切换');
          await assertTestidExists(page, exp.route, vp.width, TESTIDS['shell:theme:narrow'], '窄屏亮/暗色切换');
          responsive.push({
            route: exp.route,
            viewport: vp.width,
            mode: 'desktop',
            mainWidth: mainBox ? Math.round(mainBox.width) : null,
            sidebarWidth: sidebarBox ? Math.round(sidebarBox.width) : null,
            minSidebarWidth: MIN_DESKTOP_SIDEBAR_WIDTH,
            navVisible: navBox !== null,
            sidebarVisible: sidebarBox !== null,
          });
        }

        // 横向溢出
        overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const overflowed = overflow.scrollWidth > overflow.clientWidth + 1;
        if (overflowed) {
          vpEntry.overflow = true;
          fail('[' + exp.route + '@' + vp.width + '] 横向溢出：scrollWidth=' + overflow.scrollWidth
            + ' > clientWidth=' + overflow.clientWidth);
        }
        vpEntry.routes.push({
          route: exp.route,
          scrollWidth: overflow.scrollWidth,
          clientWidth: overflow.clientWidth,
          overflow: overflowed,
        });

        // ⚠️ **console 判定两个视口都做**（早先版本只在 1280 判 ⇒ 390 视口收集到的错误被丢弃，
        //   既不判红也不打印 —— B86 独立盲审抓出）。
        for (const msg of [...consoleErrors, ...pageErrors]) {
          if (isKnownError(msg)) {
            knownErrors.push({ route: exp.route + '@' + String(vp.width), message: msg });
          } else {
            fail('[' + exp.route + '@' + String(vp.width) + '] console 错误：' + msg);
          }
        }
        if (vp.width === 1280) {
          // 逐页可达 + 非空正文（console 清洁已在上面两个视口都判）
          if (status !== 200) {
            fail('[' + exp.route + '] HTTP 状态 ' + status + ' ≠ 200');
          }
          if (textLen <= MIN_TEXT_LENGTH) {
            fail('[' + exp.route + '] 正文长度 ' + textLen + ' <= ' + MIN_TEXT_LENGTH + '（页面近乎空白）');
          }
          pages.push({
            route: exp.route,
            status,
            textLen,
            consoleErrors: [...consoleErrors, ...pageErrors],
            url: page.url(),
          });
        }
      } catch (err) {
        fail('[' + exp.route + '@' + vp.width + '] 走查异常：' + (err && err.message ? err.message : String(err)));
      } finally {
        await page.close();
      }
    }
    viewports.push(vpEntry);
  }

  // ---- 交互可点：flow1 仪表盘点「钻取席位」→ DOM 可观测变化 ----------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // ⚠️ 交互页的 console 错误**同样参与判定**：早先版本把它们无条件塞进 knownErrors
    //   （只打印、永不影响退出码）⇒ 交互引发的 React 异常也会 exit 0（B86 独立盲审抓出）。
    const interactionConsoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') { interactionConsoleErrors.push(m.text()); } });
    page.on('pageerror', (e) => { interactionConsoleErrors.push('pageerror: ' + e.message); });
    try {
      await page.goto(baseUrl + '/flow1', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(400);
      const drillTestid = TESTIDS['control:/flow1'];
      const drillScreenTestid = TESTIDS['flow1:screen:drill'];
      // ⚠️ 屏号读**机器可读属性**（data-screen），不从中文正文里正则提取 ——
      //   中文正则是**残余的文案依赖**：改一次 UI 文案就会打断走查（B87 独立盲审抓出）。
      const screenTestid = TESTIDS['flow1:screen:indicator'];
      const screenLocator = page.locator('[data-testid="' + screenTestid + '"]').first();
      const btn = page.locator('[data-testid="' + drillTestid + '"]').first();
      interaction.element = drillTestid;
      interaction.before = (await screenLocator.count()) > 0
        ? (await screenLocator.getAttribute('data-screen')) ?? ''
        : '';
      if ((await btn.count()) === 0) {
        fail('[interaction] 未找到 data-testid="' + drillTestid + '"（flow1 钻取按钮）');
      }
      await btn.click();
      await page.waitForTimeout(300);
      interaction.after = (await screenLocator.count()) > 0
        ? (await screenLocator.getAttribute('data-screen')) ?? ''
        : '';
      interaction.url = page.url();
      interaction.clicked = true;
      // 变化判定（testid 口径）：钻取屏 testid 变为可见 + 主区文案确实变了
      const drillScreen = page.locator('[data-testid="' + drillScreenTestid + '"]').first();
      const drillScreenVisible = (await drillScreen.count()) > 0
        ? ((await drillScreen.boundingBox())?.width ?? 0) > 0
        : false;
      interaction.changed = drillScreenVisible && interaction.before !== interaction.after;
      interaction.detail = '点击前 ' + interaction.before + ' → 点击后 ' + interaction.after
        + '；钻取屏 testid "' + drillScreenTestid + '" 可见=' + drillScreenVisible;
      if (!interaction.changed) {
        fail('[interaction] 点击 data-testid="' + drillTestid + '" 后 DOM 无可观测变化：' + interaction.detail);
      }
      for (const msg of interactionConsoleErrors) {
        if (isKnownError(msg)) {
          knownErrors.push({ route: 'interaction', message: msg });
        } else {
          fail('[interaction] console 错误：' + msg);
        }
      }
    } catch (err) {
      fail('[interaction] 交互走查异常：' + (err && err.message ? err.message : String(err)));
    } finally {
      await page.close();
    }
  }

  const out = {
    ok: failures.length === 0,
    pages,
    viewports,
    testids,
    headerButtonWidths,
    responsive,
    interaction,
    knownErrors,
    failures,
  };
  console.log(JSON.stringify(out, null, 2));
  if (failures.length > 0) {
    console.error('\n=== 走查失败明细 ===');
    for (const f of failures) {
      console.error('FAIL: ' + f);
    }
  }
  if (knownErrors.length > 0) {
    console.error('\n=== 已知无害 console 错误（单列，未吞掉）===');
    for (const k of knownErrors) {
      console.error('KNOWN: [' + k.route + '] ' + k.message);
    }
  }
  process.exitCode = failures.length === 0 ? 0 : 1;
} catch (err) {
  console.error('走查脚本致命错误：' + (err && err.stack ? err.stack : String(err)));
  if (server) {
    console.error('vite stderr：\n' + server.stderr());
  }
  console.log(JSON.stringify({
    ok: false,
    pages: [],
    viewports: [],
    testids: [],
    headerButtonWidths: [],
    responsive: [],
    interaction: { route: '/flow1', element: '', clicked: false, before: '', after: '', changed: false, url: '', detail: '' },
    knownErrors,
    failures: [String(err && err.message ? err.message : err)],
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) {
    try { await browser.close(); } catch { /* 忽略 */ }
  }
  if (server && server.child) {
    try { server.child.kill(); } catch { /* 已退出 */ }
  }
}
