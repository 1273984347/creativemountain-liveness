// React host 浏览器走查脚本的**根仓静态契约守卫**（B86）。
//
// 为什么需要它：host 的走查**不在根仓门禁的执行路径内**
//   （`creativemountain-host/node_modules` 不入库 ⇒ 干净副本里起不了 vite；
//     硬塞进根仓门禁会让干净副本必然判红，违反「门禁必须可跑」的纪律）。
//   ⇒ 根仓门禁跑的是**数字轨**走查（第 ⑭ 道），host 侧用这条**静态守卫**
//     保证走查脚本「还在、还完整、还覆盖那几条路由与断言」。
//
// ⚠️ 这条守卫验的是**文件与形状**，不是「host 页面没坏」—— 后者由 host 子项目内的
//   `npm run test:walkthrough` 负责。两者的分工已登记为覆盖边界
//   （`host-walkthrough-outside-root-gate`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'creativemountain-host', 'scripts', 'walkthrough.mjs');
const PKG = resolve(ROOT, 'creativemountain-host', 'package.json');

/** host 侧必须走查的路由（与脚本内的 ROUTES 字面量逐条比对）。 */
const EXPECTED_ROUTES = ['/', '/flow1', '/flow2', '/flow3', '/flow4'];

/**
 * host 侧 **data-testid 事实源**（B87 · L-B86-1）的期望值。
 * ⚠️ 逐字对应走查脚本里的 `const TESTIDS = {...}`（唯一事实源）——
 *   键是「路由 / 角色」，值是 DOM 上的 data-testid。
 * ⚠️ 这里是**刻意的口径钉住**：脚本侧增删 testid 时，这张表必须同步改 ⇒ 门 ② 立刻红。
 */
const EXPECTED_TESTIDS: Record<string, string> = {
  '/': 'flow1-root',
  '/flow1': 'flow1-root',
  '/flow2': 'flow2-root',
  '/flow3': 'flow3-root',
  '/flow4': 'flow4-root',
  'control:/': 'flow1-drill',
  'control:/flow1': 'flow1-drill',
  'control:/flow2': 'flow2-enter',
  'control:/flow3': 'flow3-rank',
  'control:/flow4': 'flow4-generate',
  'flow1:board': 'flow1-board',
  'flow1:screen:drill': 'flow1-drill-screen',
  'flow1:screen:indicator': 'flow1-screen-indicator',
  'flow2:screen:indicator': 'flow2-screen-indicator',
  'flow3:screen:indicator': 'flow3-screen-indicator',
  'flow4:screen:indicator': 'flow4-screen-indicator',
  'flow1:header:prev': 'flow1-prev',
  'flow1:header:next': 'flow1-next',
  'flow2:header:prev': 'flow2-prev',
  'flow2:header:next': 'flow2-next',
  'flow3:header:prev': 'flow3-prev',
  'flow3:header:next': 'flow3-next',
  'flow4:header:prev': 'flow4-prev',
  'shell:main': 'host-main',
  'shell:sidebar': 'host-sidebar',
  'shell:nav': 'host-nav',
  'shell:theme:narrow': 'host-theme-toggle-narrow',
  'shell:theme:desktop': 'host-theme-toggle-desktop',
};

/**
 * 布局阈值的**下限口径**（B87 · L-B86-2）。
 * ⚠️ 守卫卡的是「**不得低于**」而非「等于」⇒ 允许上调收紧，**禁止下调保绿**
 *   （把阈值调到比实际渲染还小 ⇒ 门禁变绿而版面照坏 —— 这类"改尺保绿"必须被门禁看见）。
 */
const MIN_THRESHOLDS: { name: string; floor: number }[] = [
  { name: 'MIN_NARROW_MAIN_WIDTH', floor: 320 },
  { name: 'MIN_HEADER_BUTTON_WIDTH', floor: 44 },
  { name: 'MIN_DESKTOP_SIDEBAR_WIDTH', floor: 224 },
  { name: 'MIN_HEADER_BUTTON_HEIGHT', floor: 20 },
];

function readScript(): string {
  assert.ok(existsSync(SCRIPT), 'host 走查脚本缺失：' + SCRIPT);
  return readFileSync(SCRIPT, 'utf8');
}

test('host 走查脚本存在且不是空壳（防「删掉断言还留着文件」）', () => {
  const src = readScript();
  assert.ok(src.length > 5000, 'host 走查脚本只有 ' + String(src.length) + ' 字节 ⇒ 疑似被掏空');
});

test('host 走查脚本保留了静态守卫锚点', () => {
  const src = readScript();
  for (const anchor of ["page.on('console'", 'pageerror', 'scrollWidth', 'clientWidth', 'chromium.launch']) {
    assert.ok(src.includes(anchor), 'host 走查脚本缺少锚点：' + anchor);
  }
});

test('host 走查真正遍历的路由清单与守卫期望值逐条一致（防「少走一页」）', () => {
  const src = readScript();
  // ⚠️ 必须比对**驱动走查的那个常量**（ROUTE_EXPECTATIONS）。
  //   早先版本比对的是一个**从未被使用的** `const ROUTES = [...]` 字面量
  //   ⇒ 从 ROUTE_EXPECTATIONS 删掉一页，守卫仍绿、host 走查仍 exit 0（假绿 —— B86 独立盲审抓出）。
  const block = /const ROUTE_EXPECTATIONS = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block !== null, 'host 走查脚本里找不到 const ROUTE_EXPECTATIONS = [...] 定义');
  const inner = block[1] ?? '';
  const routes = [...inner.matchAll(/route:\s*'([^']+)'/g)].map((x) => x[1] ?? '');
  assert.deepEqual(routes, EXPECTED_ROUTES, 'host 走查路由清单与守卫期望值不一致');
  // 且必须真的被遍历（防「改了常量但没改遍历」这一种绕过）。
  assert.match(src, /for \(const exp of ROUTE_EXPECTATIONS\)/, '走查脚本必须遍历 ROUTE_EXPECTATIONS');
  // 防「死常量」复发：不得再有第二份独立的路由字面量。
  // ⚠️ 用**行首匹配**（多行模式）⇒ 只判代码，不命中注释里为留痕写的 `const ROUTES = [...]` 文字。
  assert.equal(/^\s*const ROUTES = \[/m.test(src), false, '脚本里不得再有独立的 ROUTES 字面量（路由清单只能有一份事实源）');
});


test('host 走查的 data-testid 事实源（TESTIDS）与守卫期望值逐条一致（防「少一个锚点」）', () => {
  const src = readScript();
  // ⚠️ 比对**唯一事实源** TESTIDS（断言代码真在用，见下一条）。
  const block = /const TESTIDS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block !== null, 'host 走查脚本里找不到 const TESTIDS = {...} 定义');
  const inner = block[1] ?? '';
  const entries = [...inner.matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)]
    .map((m) => [m[1] ?? '', m[2] ?? ''] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const expected = Object.entries(EXPECTED_TESTIDS).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.deepEqual(entries, expected, 'host 走查的 testid 清单与守卫期望值不一致（脚本增删 testid 时这里必须同步）');
});

test('TESTIDS 真被断言代码使用（防「死常量」假绿复发）', () => {
  const src = readScript();
  const uses = (src.match(/TESTIDS\[/g) ?? []).length;
  assert.ok(uses >= 8, 'TESTIDS 只被引用 ' + String(uses) + ' 次 ⇒ 疑似退化成死常量（应处处取值）');
  assert.match(src, /TESTIDS\['shell:main'\]/, '窄屏主区断言必须从 TESTIDS 取 main 的 testid');
  assert.match(src, /TESTIDS\['control:' \+ exp\.route\]/, '关键控件断言必须从 TESTIDS 取值');
});

test('TESTIDS **逐键**有牙（动态键必须对应真实遍历的路由，静态键必须有字面引用）', () => {
  const src = readScript();
  // 真实被遍历的路由集合（来自驱动遍历的那个常量）
  const block = /const ROUTE_EXPECTATIONS = \[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block !== null, '找不到 const ROUTE_EXPECTATIONS = [...] 定义');
  const routeSet = new Set([...(block[1] ?? '').matchAll(/route:\s*'([^']+)'/g)].map((m) => m[1] ?? ''));
  for (const key of Object.keys(EXPECTED_TESTIDS)) {
    if (key.startsWith('control:')) {
      const route = key.slice('control:'.length);
      assert.ok(routeSet.has(route), 'control 键 ' + key + ' 对应的路由不在 ROUTE_EXPECTATIONS 里（该断言根本不会被执行）');
    } else if (key.startsWith('/')) {
      assert.ok(routeSet.has(key), '路由键 ' + key + ' 不在 ROUTE_EXPECTATIONS 里（该断言根本不会被执行）');
    } else {
      // 静态锚点键必须被**字面引用**（不是变量拼 key）⇒ 死键当场暴露
      assert.ok(src.includes("'" + key + "'"), '静态锚点键 ' + key + ' 在脚本里没有字面引用（死键）');
    }
  }
});

test('host 走查不得再用中文文案做判红依据（改 UI 文案不得打断走查）', () => {
  const src = readScript();
  // ⚠️ L-B86-1 的核心：marker / control 这类**中文文案**不得参与判红
  //   （旧实现按「Flow 1 · 实时状态看板」「钻取席位」找元素 ⇒ 改一次文案就红）。
  assert.doesNotMatch(src, /exp\.marker/, '判红路径不得依赖 exp.marker（中文文案）');
  assert.doesNotMatch(src, /exp\.control/, '判红路径不得依赖 exp.control（中文文案）');
});

test('判红/定位路径不得含中文正则（防「改文案即打断走查」）', () => {
  const src = readScript();
  // ⚠️ 先剥注释（注释里的中文是留痕，不算判红依据）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 中文正则字面量（定位/判红用）⇒ 一律不允许
  const cnRegex = /\/[^\/\n]*[\u4e00-\u9fa5][^\/\n]*\/[gimsuy]*/g;
  assert.equal(cnRegex.test(code), false, '判红/定位路径里不得出现中文正则（改 UI 文案会打断走查）');
  assert.doesNotMatch(src, /exp\.marker/, '判红路径不得依赖 exp.marker（中文文案）');
  assert.doesNotMatch(src, /exp\.control/, '判红路径不得依赖 exp.control（中文文案）');
});

test('布局阈值不得被下调（防「改尺保绿」）', () => {
  const src = readScript();
  for (const t of MIN_THRESHOLDS) {
    const m = new RegExp('const ' + t.name + ' = (\\d+)').exec(src);
    assert.ok(m !== null, 'host 走查脚本缺少阈值常量：' + t.name);
    const value = Number(m[1]);
    assert.ok(value >= t.floor, t.name + ' = ' + String(value) + ' 低于口径下限 ' + String(t.floor) + '（下调阈值保绿必须被拦）');
  }
});

test('host 子项目暴露了走查入口（npm run test:walkthrough）', () => {
  assert.ok(existsSync(PKG), 'host package.json 缺失');
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  assert.ok(pkg.scripts && typeof pkg.scripts['test:walkthrough'] === 'string',
    'host package.json 缺少 test:walkthrough script');
});
