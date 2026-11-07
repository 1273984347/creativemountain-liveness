// PDF 归一化器：让「构建时刻」不再污染产物比对。
//
// 来源：zk-quiz《check-generated.js》——产物入库与产物含构建时刻之间存在固有矛盾
// （提交前构建 ⇒ 产物里的时刻属于上一个提交；提交后构建 ⇒ 产物又变了），
// 解法是**比对时把时刻替换成占位符，其余内容逐字比**。
//
// 实测依据（本仓自测，Edge headless 连续生成同一份 HTML 的 PDF）：
//   p1.pdf len=26460 / p2.pdf len=26460
//   IDENTICAL=False            ← 长度相同但哈希不同
//   CreationDate=True ModDate=True
// ⇒ PDF **字节级不可直接比对**，必须先归一化。
//
// ⚠️ 关键纪律：**只替换时间戳的值，不整行剔除**。
// zk-quiz 曾因此漏检——手机版的版本号与时间戳注入在**同一行**，
// 整行免检会导致「用旧版产物构建也能 PASS」。

import { createHash } from 'node:crypto';

/** 被归一化的时间戳字段（PDF 的 Info 字典）。 */
const DATE_FIELDS = ['CreationDate', 'ModDate'];

/**
 * 归一化 PDF 字节：把构建时刻替换为**等长**占位符。
 *
 * ⚠️ **占位符必须等长** —— 否则该位置之后的所有字节偏移都会移位，
 * 「逐字比对」必然失败（实测：原值 23 字符 vs 占位符 13 字符 → 整段错位 → 哈希必不同）。
 * 这就是 zk-quiz「把 `__BUILD_TS__` 的值替换成占位符（不删行）」那条经验的关键细节。
 *
 * 用 latin1 做 1:1 字节映射（不引入编码错误），归一化后可直接逐字比对。
 */
export function normalizePdfBytes(buffer) {
  let text = buffer.toString('latin1');
  for (const field of DATE_FIELDS) {
    // 形如 /CreationDate (D:20261107123456+08'00') —— 只换值，保留键名与结构
    text = text.replace(new RegExp(`/${field}\\s*\\(([^)]*)\\)`, 'g'), (match, value) => {
      // 等长占位符：D: + 若干个 0 + 时区偏移，长度与原值一致
      const suffix = "+00'00'";
      const digits = Math.max(0, value.length - 2 - suffix.length);
      const placeholder = `D:${'0'.repeat(digits)}${suffix}`;
      return match.replace(value, placeholder);
    });
  }
  return Buffer.from(text, 'latin1');
}

/** 归一化后的 PDF 摘要（用于比对）。 */
export function normalizedPdfDigest(buffer) {
  return createHash('sha256').update(normalizePdfBytes(buffer)).digest('hex');
}

/** 原始摘要（用于展示「确实变了」，但**不可**用于一致性判定）。 */
export function rawPdfDigest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
