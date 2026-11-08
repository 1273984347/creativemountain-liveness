// 实体棋盘**按人数多版**（规格 §6.7，V1.1）的回归测试。
//
// 覆盖：① 版本清单由规模表派生（24/28/32/36 格 ⇒ 3/4/5-6/7-8 人）；
//   ② 每版棋盘的格数、格号连续性、峰顶在末格、关隘/裂隙格保留；
//   ③ 实体件构建**确实按人数出多版**（源码接线断言，不依赖 print 产物是否已生成）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BOARD_VERSIONS, fitBoard, gateCountFor } from '../../engine/core/board-fit.ts';
import type { ThemePack } from '../../engine/types/theme.ts';

test('V1.1：棋盘版清单由规模表派生 ⇒ 24/28/32/36 格对应 3/4/5-6/7-8 人', () => {
  assert.deepEqual(BOARD_VERSIONS.map((v) => v.length), [24, 28, 32, 36], '版本格数');
  assert.deepEqual(BOARD_VERSIONS.map((v) => v.players.join('/')), ['3', '4', '5/6', '7/8'], '适用人数档');
});

test('V1.1：每版棋盘格数正确、格号连续、峰顶在末格、关隘与裂隙格保留', () => {
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  for (const v of BOARD_VERSIONS) {
    const board = fitBoard(theme.board, v.length);
    assert.equal(board.tiles.length, v.length, String(v.length) + ' 版的格数');
    assert.equal(board.peakIndex, v.length, '峰顶格号 = 末格');
    assert.equal(board.tiles[v.length - 1]?.kind, 'peak', '末格是峰顶');
    assert.ok(board.tiles.every((t, i) => t.index === i + 1), '格号连续');
    assert.ok(board.tiles.some((t) => t.kind === 'gate'), '关隘格保留（缩放不得丢掉关键格位）');
    assert.ok(board.tiles.some((t) => t.kind === 'rift'), '裂隙格保留');
  }
});

test('B21：每档棋盘的关隘数 == 规模表 gateCount（2/3/3/4）', () => {
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  for (const v of BOARD_VERSIONS) {
    const board = fitBoard(theme.board, v.length);
    const gates = board.tiles.filter((t) => t.kind === 'gate').length;
    assert.equal(gates, gateCountFor(v.length),
      String(v.length) + ' 格版的关隘数应等于规模表 gateCount');
  }
  // 规模表口径：3 人 2 座 / 4 人 3 座 / 5–6 人 3 座 / 7–8 人 4 座。
  assert.deepEqual(BOARD_VERSIONS.map((v) => gateCountFor(v.length)), [2, 3, 3, 4]);
});

test('V1.1：实体件构建按人数出多版棋盘（源码接线断言）', () => {
  const src = readFileSync(resolve('build/build-print.ts'), 'utf8');
  assert.match(src, /BOARD_VERSIONS/, '实体件必须用规模表派生的版本清单');
  assert.match(src, /fitBoard\(ir\.board, v\.length\)/, '每版棋盘必须用与数字轨共用的 fitBoard');
  assert.doesNotMatch(src, /棋盘-A2\.svg/, '单版棋盘文件名应被多版取代（否则玩家不知用哪张）');
});
