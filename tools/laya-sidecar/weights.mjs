// 权重对拍的**单一事实源**（B55）。
//
// ⚠️ 为什么抽出来：`env-check.mjs`（P0 自检）与 `serve.mjs`（反代）**都要**对拍同一份权重
//   ⇒ 两处各写一份期望值 = 两套口径 ⇒ 迟早漂（E100 同款：能机器核的不要人核）。

import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';

/** 权重文件（多语言判断模型，643 MB）。 */
export const WEIGHT_PATH = 'D:/<local-libs>/laya-multilingual/model.safetensors';
/** 期望字节数（锁定值）。 */
export const EXPECT_WEIGHT_BYTES = 643835514;
/** 期望 sha256 前缀（前 8 位足以判定，避免把 64 位写进文档）。 */
export const EXPECT_WEIGHT_SHA_PREFIX = '9d628fd9';

/**
 * 流式算 sha256（643 MB 不可整体读入内存）。
 *
 * @param {string} file 文件路径
 * @returns {Promise<string>} 十六进制摘要
 */
export function sha256Of(file) {
  return new Promise((done, fail) => {
    const h = createHash('sha256');
    const s = createReadStream(file);
    s.on('data', (chunk) => h.update(chunk));
    s.on('error', fail);
    s.on('end', () => done(h.digest('hex')));
  });
}

/**
 * 对拍一份权重文件。
 *
 * ⚠️ **只判「字节数 + sha256 前缀」** —— 全量摘要比对会因字节级差异而误报，
//   而前缀足以判定「是不是同一份权重」。
 *
 * @param {string} file 权重文件路径
 * @returns {Promise<{ ok: boolean, bytes: number, sha256: string, detail: string }>}
 */
export async function verifyWeight(file) {
  let bytes;
  try {
    bytes = statSync(file).size;
  } catch (e) {
    return { ok: false, bytes: -1, sha256: '', detail: `权重文件不存在或不可读：${file}（${String(e.message)}）` };
  }
  if (bytes !== EXPECT_WEIGHT_BYTES) {
    return {
      ok: false,
      bytes,
      sha256: '',
      detail: `权重字节数不符：${bytes} ≠ ${EXPECT_WEIGHT_BYTES}`,
    };
  }
  const sha256 = await sha256Of(file);
  if (!sha256.startsWith(EXPECT_WEIGHT_SHA_PREFIX)) {
    return {
      ok: false,
      bytes,
      sha256,
      detail: `权重 sha256 前缀不符：${sha256.slice(0, 16)}… ≠ ${EXPECT_WEIGHT_SHA_PREFIX}…`,
    };
  }
  return { ok: true, bytes, sha256, detail: '对拍通过' };
}
