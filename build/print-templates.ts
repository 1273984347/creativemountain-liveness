// 实体件 SVG 模板（规格 §6.7：实体规格定稿）。
//
// 尺寸契约（V1 固定，不得自行变更）：
//   · 卡牌   63×88mm + 3mm 出血 + 3mm 圆角 → 画布 69×94mm
//   · 棋盘   A4×4 拼接（等效 A2 = 420×594mm），可选 A3×1 单张
//   · 筹码   直径 25mm
//   · 规则书 A4 双面
//
// **数值溯源**：规则书表格的每个数值单元格带 `data-src` 属性（§6.7.2），
// 属性值即 IR 中的溯源路径；渲染文本必须是裸数值，便于机器比对。

/** 卡牌画布宽（含左右各 3mm 出血） */
export const CARD_W = 63 + 3 + 3;
/** 卡牌画布高（含上下各 3mm 出血） */
export const CARD_H = 88 + 3 + 3;
/** 卡牌内容区起点（出血之后） */
export const CARD_PAD = 3;
/** 圆角半径 */
export const CARD_RADIUS = 3;
/** 筹码直径 */
export const CHIP_D = 25;
/** A2 幅面（= A4×4 拼接） */
export const A2_W = 420;
export const A2_H = 594;

/** XML 转义（文本进 SVG 必须转义）。 */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 文本按宽度折行。 */
export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (cur.length >= maxChars) {
      lines.push(cur);
      cur = '';
    }
  }
  if (cur.length > 0) { lines.push(cur); }
  return lines;
}
