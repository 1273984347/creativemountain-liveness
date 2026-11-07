// PDF 粗检（规格 §9.3 ③）：可打开 / 页数 / 字体嵌入。
//
// ⚠️ **只做粗检，不逐字比对**——中文 PDF 文本层在换行、字距、字体嵌入下极不稳定，
// 逐项比对会大量误报，门禁会退化成「每次都红、然后被手动豁免」（见 §9.3 覆盖边界表）。
//
// 页数与字体检测需要**解压 PDF 的内容流**（PDF 内部是压缩的），
// 所以这里用 zlib 把 FlateDecode 流解开后再统计。

import { inflateSync } from 'node:zlib';

/** 从 PDF 字节中解压出可搜索的文本（拼接所有 FlateDecode 流）。 */
export function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const chunks = [raw];
  // 找出所有 stream...endstream 段，尝试 inflate
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) { break; }
    try {
      chunks.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      // 非 zlib 流（图片等），跳过
    }
  }
  return chunks.join('\n');
}

/** PDF 是否可打开（文件头 %PDF-）。 */
export function isOpenablePdf(buffer) {
  return buffer.length > 32 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * 页数统计：数 `/Type /Page`（**排除** `/Type /Pages`——那是页树根节点）。
 */
export function countPdfPages(buffer) {
  const text = extractPdfText(buffer);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches === null ? 0 : matches.length;
}

/** 是否嵌入了字体（查 FontFile —— 内嵌字体才有它）。 */
export function hasEmbeddedFont(buffer) {
  const text = extractPdfText(buffer);
  return /\/FontFile[0-9]*/.test(text);
}
