export const DEFAULT_SEED = 42;
export const MAX_SEED = 0xffffffff;

/** 只接受十进制 uint32；拒绝空串、负号、小数、科学计数和十六进制。 */
export function parseSeed(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) { return null; }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SEED) { return null; }
  return value;
}
