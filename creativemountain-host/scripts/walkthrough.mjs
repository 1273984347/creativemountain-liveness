#!/usr/bin/env node
// =============================================
// 创界山·活人认证 — React host（creativemountain-host）浏览器走查
//
// 目标：在 host 子项目内自起 vite dev server，用 Playwright 逐页走查，
//       输出**可观测事实**（状态码 / 正文长度 / console 错误 / 溢出 / 交互结果），
//       退出码 0 = 全绿，非 0 = 有断言失败。
//
// 纪律（仓内硬规）：
//   - 不使用 shell: true（会改退出码语义）；不把命令接进管道。
//   - 退出码直取 child 'exit' / spawnSync status。
//   - 只 import node 内置模块 + 根仓 playwright（createRequire 解析）。
//   - 只杀自己起的 vite 子进程，不动端口占用者。
//
// 静态守卫锚点（勿删）：page.on('console' / pageerror / scrollWidth / clientWidth
//   以及下方 ROUTES 路由清单字面量 —— 根仓门禁按此比对。
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
// 每页期望（全部来自现有源码文本 / 结构，无 data-testid 依赖；
//   ⚠️ 这些文案是 host 现状的**快照** —— 改 UI 文案时须同步这里）
const ROUTE_EXPECTATIONS = [
  { route: '/', marker: 'Flow 1 · 实时状态看板', control: '钻取席位' },
  { route: '/flow1', marker: 'Flow 1 · 实时状态看板', control: '钻取席位' },
  { route: '/flow2', marker: 'Flow 2 · 认证高潮聚焦', control: '进入认证聚焦' },
  { route: '/flow3', marker: 'Flow 3 · 终局结算 + 排名公示', control: '查看排名公示' },
  { route: '/flow4', marker: 'Flow 4 · 开局配置 + 首局教学', control: '生成会话并等待加入' },
];

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
];
const CANDIDATE_PORTS = [5199, 5200, 5201];
const SERVER_READY_TIMEOUT_MS = 30000;
const MIN_TEXT_LENGTH = 80;
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

        // 关键元素存在且可见
        const marker = page.getByText(exp.marker, { exact: false }).first();
        if ((await marker.count()) === 0) {
          fail('[' + exp.route + '@' + vp.width + '] 未找到关键文本：' + exp.marker);
        }
        const mainBox = await page.locator('main').first().boundingBox();
        if (!mainBox || mainBox.width <= 0 || mainBox.height <= 0) {
          fail('[' + exp.route + '@' + vp.width + '] 主区域 main 不可见或盒子尺寸为零');
        }
        const control = page.getByRole('button', { name: exp.control, exact: false }).first();
        if ((await control.count()) === 0) {
          fail('[' + exp.route + '@' + vp.width + '] 未找到关键控件：按钮 ' + exp.control);
        } else {
          const ctrlBox = await control.boundingBox();
          if (!ctrlBox || ctrlBox.width <= 0 || ctrlBox.height <= 0) {
            fail('[' + exp.route + '@' + vp.width + '] 控件不可见（零盒子）：' + exp.control);
          }
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
      const before = await page.locator('main').innerText();
      const btn = page.getByRole('button', { name: '钻取席位', exact: false }).first();
      interaction.element = '钻取席位';
      interaction.before = (before.match(/屏\s*\d\/\d/) || [])[0] ?? '';
      await btn.click();
      await page.waitForTimeout(300);
      const after = await page.locator('main').innerText();
      interaction.after = (after.match(/屏\s*\d\/\d/) || [])[0] ?? '';
      interaction.url = page.url();
      interaction.clicked = true;
      const crumbVisible = await page.getByText('对局总览', { exact: false }).first().count();
      interaction.changed = interaction.before !== interaction.after && crumbVisible > 0;
      interaction.detail = '点击前 ' + interaction.before + ' → 点击后 ' + interaction.after
        + '；面包屑「对局总览」命中=' + crumbVisible;
      if (!interaction.changed) {
        fail('[interaction] 点击「钻取席位」后 DOM 无可观测变化：' + interaction.detail);
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
