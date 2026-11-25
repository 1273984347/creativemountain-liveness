// 实体件**棋盘 SVG** 的棋盘级一致性判据 —— 常驻正负样本（门 ⑦ 的第五级）。
//
// ⚠️ 为什么需要它：门 ⑦ 此前**从不读棋盘件** ⇒ 「实体棋盘印了几行过路费」
//   这类漂移**没有任何门禁能发现**（实测：规模适配把超出本档关隘数的关隘降为
//   普通格时仍带着过路费字段 ⇒ 实体棋盘会印出引擎**不认**的过路费行）。
//   判据落在 tools/board-parity.mjs，本文件用**同一份实现**做正负样本。
//
// ⚠️ **不复制判据**：负样本 import 被测实现本身（tools/board-parity.mjs），
//   不是另写一份近似复刻 —— 仓库纪律：负样本测的是**被测实现**。
//
// ⚠️ 期望值（格数 / 关隘数 / 人数档后缀）一律从 engine/scales.ts 与
//   engine/core/board-fit.ts **派生**，不手抄。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkBoardSvg } from '../../tools/board-parity.mjs';
import { SCALES } from '../../engine/scales.ts';
import { BOARD_VERSIONS, gateCountFor } from '../../engine/core/board-fit.ts';

/** 样本档：3 人（规模表第一档）。期望值全部派生，不手抄。 */
const SAMPLE = SCALES.find((s) => s.players === 3);
if (SAMPLE === undefined) {
  throw new Error('规模表里必须有 3 人档');
}
const VERSION = BOARD_VERSIONS.find((v) => v.length === SAMPLE.boardLength);
if (VERSION === undefined) {
  throw new Error('规模表必须派生出 3 人档对应的棋盘版本');
}

/** 期望格数 / 关隘数（派生）。 */
const EXPECTED_LENGTH = VERSION.length;
const EXPECTED_GATE_COUNT = gateCountFor(VERSION.length);

/** 实体件棋盘的文件名（与 build/build-print.ts 的落盘约定一致）。 */
const FILE_NAME = '棋盘-A2-' + String(EXPECTED_LENGTH) + '格-' + VERSION.players.join('人') + '.svg';

/** 造一份「正确」的棋盘 SVG 文本：过路费行数 == 关隘数。 */
function makeSvg(gateCount: number): string {
  const lines: string[] = [];
  for (let i = 1; i <= gateCount; i += 1) {
    lines.push('<text x="1" y="1" font-size="3.2" fill="#8a6420">过路 ' + String(i) + '</text>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg">' + lines.join('') + '</svg>';
}

// ---------- 正样本 ----------

test('正样本：过路费行数 == 该档关隘数、文件名格数 == 期望格数 ⇒ 通过', () => {
  const issues = checkBoardSvg({
    svgText: makeSvg(EXPECTED_GATE_COUNT),
    fileName: FILE_NAME,
    length: EXPECTED_LENGTH,
    gateCount: EXPECTED_GATE_COUNT,
  });
  assert.deepEqual(issues, [], '正确的棋盘件必须零问题');
});

test('正样本：期望值确由规模表派生（格数 / 关隘数 / 文件名后缀）', () => {
  assert.equal(EXPECTED_LENGTH, SAMPLE.boardLength, '格数必须来自 engine/scales.ts');
  assert.equal(EXPECTED_GATE_COUNT, SAMPLE.gateCount, '关隘数必须来自 engine/scales.ts');
  assert.ok(FILE_NAME.startsWith('棋盘-A2-' + String(EXPECTED_LENGTH) + '格-'), '文件名格数必须与期望一致');
});

// ---------- 负样本 ----------

test('负样本：降级格多带一行过路费（行数多于该档关隘数）⇒ 判红并点名次数', () => {
  // 模拟「降级格仍带过路费」：把一行过路费多印一份。
  const badSvg = makeSvg(EXPECTED_GATE_COUNT) + '<text x="9" y="9">过路 9</text>';
  const issues = checkBoardSvg({
    svgText: badSvg,
    fileName: FILE_NAME,
    length: EXPECTED_LENGTH,
    gateCount: EXPECTED_GATE_COUNT,
  });
  assert.ok(issues.length > 0, '多印一行过路费必须判红');
  assert.ok(
    issues.some((e) => e.includes('过路费出现 ' + String(EXPECTED_GATE_COUNT + 1) + ' 次，期望 '
      + String(EXPECTED_GATE_COUNT) + ' 次')),
    '报错必须点名实测次数与期望次数，实际：' + JSON.stringify(issues),
  );
});

test('负样本：文件名格数与期望不符 ⇒ 判红并点名格数', () => {
  const wrongName = '棋盘-A2-' + String(EXPECTED_LENGTH + 6) + '格-' + VERSION.players.join('人') + '.svg';
  const issues = checkBoardSvg({
    svgText: makeSvg(EXPECTED_GATE_COUNT),
    fileName: wrongName,
    length: EXPECTED_LENGTH,
    gateCount: EXPECTED_GATE_COUNT,
  });
  assert.ok(issues.length > 0, '文件名格数不符必须判红');
  assert.ok(
    issues.some((e) => e.includes('文件名声明 ' + String(EXPECTED_LENGTH + 6) + ' 格，期望 '
      + String(EXPECTED_LENGTH) + ' 格')),
    '报错必须点名文件名的格数与期望格数，实际：' + JSON.stringify(issues),
  );
});

// ---------- 恢复验证 ----------

test('恢复验证：内容改回正确后 ⇒ 判绿', () => {
  const issues = checkBoardSvg({
    svgText: makeSvg(EXPECTED_GATE_COUNT),
    fileName: FILE_NAME,
    length: EXPECTED_LENGTH,
    gateCount: EXPECTED_GATE_COUNT,
  });
  assert.deepEqual(issues, [], '恢复正确内容后必须零问题');
});
