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

test('host 子项目暴露了走查入口（npm run test:walkthrough）', () => {
  assert.ok(existsSync(PKG), 'host package.json 缺失');
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  assert.ok(pkg.scripts && typeof pkg.scripts['test:walkthrough'] === 'string',
    'host package.json 缺少 test:walkthrough script');
});
