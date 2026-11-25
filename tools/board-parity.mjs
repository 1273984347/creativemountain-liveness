// 实体件**棋盘 SVG** ↔ 引擎规模表的**棋盘级**一致性判据（门 ⑦ 新增的一级）。
//
// ⚠️ 为什么单独成文件（而不是写进 parity-check 或测试里）：
//   正样本与负样本必须**共用同一份实现** —— 仓内纪律是「负样本测的是被测实现，
//   不是近似复刻」。本文件导出**纯函数**（不碰文件系统），
//   tools/parity-check.mjs 与 tests/gates/board-parity.test.ts 都 import 它。
//
// ⚠️ 这层比对只覆盖**棋盘级**的两个可机械判定量（过路费行数、文件名格数）；
//   **逐格内容**（格名、地形配色、支路目标）仍不在比对范围内 —— 已登记为覆盖边界
//   （见 tools/coverage-boundaries.mjs 的 print-board-gate-fee）。

/**
 * 棋盘 SVG 的**文件名约定**：棋盘-A2-<N格>-<人数档>.svg
 * （例：棋盘-A2-24格-3.svg / 棋盘-A2-32格-5人6.svg）。
 *
 * ⚠️ 捕获组 1 = 文件名里声明的**格数**。
 */
export const BOARD_FILE_PATTERN = /棋盘-A2-(\d+)格-/;

/**
 * 实体件上「过路费」那一行的**固定字样**（渲染处在 build/print-parts.ts）。
 *
 * ⚠️ 引擎只在**真正的关隘格**上认过路费（kind === 'gate'）；降级格（规模适配时
 *   把超出本档关隘数的关隘降为普通格）**引擎不认** ⇒ 实体件上多印一行就是漂移。
 */
export const GATE_FEE_MARK = '过路';

/**
 * 从文件名取出**用于报错的人读标签**（去掉「棋盘-A2-」前缀与「.svg」后缀）。
 *
 * @param {string} fileName 棋盘 SVG 的文件名。
 * @returns {string} 例：24格-3；不符合约定时原样返回文件名。
 */
export function boardLabel(fileName) {
  const s = String(fileName ?? '');
  const m = s.match(/^棋盘-A2-(.*)\.svg$/);
  return m === null ? s : m[1];
}

/**
 * 数一份棋盘 SVG 里**印了几行过路费**。
 *
 * @param {string} svgText 棋盘 SVG 全文。
 * @returns {number} 「过路」二字的出现次数。
 */
export function countGateFeeLines(svgText) {
  const s = String(svgText ?? '');
  let n = 0;
  let i = s.indexOf(GATE_FEE_MARK);
  while (i >= 0) {
    n += 1;
    i = s.indexOf(GATE_FEE_MARK, i + GATE_FEE_MARK.length);
  }
  return n;
}

/**
 * 判一份棋盘 SVG 是否与**期望的棋盘版本**一致。
 *
 * 两条判据（期望值一律由调用方从 engine/scales.ts / engine/core/board-fit.ts 派生，
 * 本函数**不含任何手抄数字**）：
 *   ① **过路费行数 == 该档关隘数** —— 降级格不得带过路费（引擎不认）；
 *   ② **文件名里的格数 == 期望格数** —— 文件名错位说明棋盘件被错命名/错版本。
 *
 * @param {{ svgText: string, fileName: string, length: number, gateCount: number }} input
 * @returns {string[]} 问题清单；**空数组 = 通过**。
 */
export function checkBoardSvg(input) {
  const svgText = input?.svgText;
  const fileName = input?.fileName;
  const length = input?.length;
  const gateCount = input?.gateCount;
  const issues = [];
  const label = boardLabel(fileName);

  // 判据二：文件名格数必须与期望格数一致。
  const m = String(fileName ?? '').match(BOARD_FILE_PATTERN);
  if (m === null || m[1] === undefined) {
    issues.push('棋盘 ' + label + '：文件名不符合「棋盘-A2-<N格>-<人数档>」约定，无法核对格数');
  } else {
    const declared = Number(m[1]);
    if (declared !== length) {
      issues.push('棋盘 ' + label + '：文件名声明 ' + String(declared) + ' 格，期望 ' + String(length) + ' 格');
    }
  }

  // 判据一：过路费行数必须等于该档关隘数。
  const feeCount = countGateFeeLines(svgText);
  if (feeCount !== gateCount) {
    issues.push('棋盘 ' + label + '：过路费出现 ' + String(feeCount) + ' 次，期望 ' + String(gateCount)
      + ' 次（降级格不得带过路费）');
  }

  return issues;
}
