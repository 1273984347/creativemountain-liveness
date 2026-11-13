// B75.2：「生成器输出 == 入库 theme.json」常驻一致性门（B75 批次记录 §7 遗留 2 的收口）。
//
// ⚠️ 为什么必须有一条机器门：B21（36 格扩盘）/ B12（改运卡改 op）/ B22（试炼文本）三波手工
//   维护都没有回灌生成器 ⇒ 分叉静默累积，直到 `node build/build-themes.mjs` 直接跑不动
//   才被发现（B75 记录 §7.2）。「生成器与手工真值并存」没有一致性门 = 迟早再漂。
//
// ⚠️ 判据是**逐字比较**（JSON.stringify）：任何字段差异（哪怕一个格名）都红；
//   失败信息必须给出**第一条差异路径**与两侧摘要 ⇒ 直接指向根因，不许只报「不相等」。
//   数据清单取自生成器导出的 `THEME_DATA`（同一出处，不另抄主题 id 列表）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildTheme, THEME_DATA } from '../../build/build-themes.mjs';
import type { ThemePack } from '../../engine/types/theme.ts';

const BASE = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;

/** 返回第一条差异的 `路径: 生成=… | 入库=…`；完全一致返回 null。 */
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) { return null; }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null
    || Array.isArray(a) !== Array.isArray(b)) {
    return `${path}: 生成=${JSON.stringify(a)} | 入库=${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { return `${path}.length: 生成=${a.length} | 入库=${b.length}`; }
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d !== null) { return d; }
    }
    return null;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d !== null) { return d; }
  }
  return null;
}

test('B75.2：THEME_DATA 的每个主题，生成器输出与入库 theme.json 逐字一致', () => {
  assert.ok(THEME_DATA.length >= 3, '前提：生成器至少覆盖三套派生主题');
  for (const data of THEME_DATA) {
    const onDisk = JSON.parse(readFileSync(resolve('themes', data.id, 'theme.json'), 'utf8')) as ThemePack;
    const generated = buildTheme(BASE, data);
    const diff = firstDiff(generated, onDisk);
    assert.equal(diff, null, `主题 ${data.id} 的生成器输出与入库文件漂移 ⇒ 重跑 node build/build-themes.mjs 或同步 theme-data：${diff ?? ''}`);
  }
});

test('B75.2：生成产物结构完好（不是空壳/残包）', () => {
  for (const data of THEME_DATA) {
    const generated = buildTheme(BASE, data);
    assert.equal(generated.meta.id, data.id, `${data.id} 的 meta.id`);
    assert.equal(generated.cards.length, BASE.cards.length, `${data.id} 卡牌数与基准同池`);
    assert.equal((generated.trials ?? []).length, (BASE.trials ?? []).length, `${data.id} 试炼数与基准同构`);
    assert.equal(generated.board.tiles.length, BASE.board.tiles.length, `${data.id} 棋盘格数与基准同构`);
    assert.equal(generated.identities.length, BASE.identities.length, `${data.id} 身份槽位与基准同构`);
  }
});
