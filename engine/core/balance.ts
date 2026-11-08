// 位次胜率极差的**统计与门禁口径**（规格 §9.2，B25 校准）。
//
// ⚠️ 为什么单列一个模块：阈值是**验收口径**，必须**单一事实源** ——
//   规格正文、平衡报告、门禁判定都从这里取 ⇒ 否则三处各写一个数字 ⇒ 必然漂移。
//
// ⚠️ **极差是噪声主导的统计量**：它只由**单个离群位次**决定（max − min）⇒ 小样本下噪声极大
//   （实测：6000 局时，跨 4 组独立样本的极差在 **4.7–8.0pp** 波动，而真实先手优势可能不足 1pp）
//   ⇒ 因此分**两层口径**：
//   · **统计口径**（`POSITION_SPREAD_LIMIT`）：**大样本**（≥ 24000 局）下的上限；
//   · **门禁口径**（`POSITION_SPREAD_GATE_LIMIT` / `POSITION_RMS_GATE_LIMIT`）：
//     **固定 seed + 固定局数**下的确定性回归锁（同 seed ⇒ 同结果 ⇒ 零 flake）。

/** 统计口径：大样本（≥ 24000 局）下跨人数档的最大位次胜率极差上限（pp）。 */
export const POSITION_SPREAD_LIMIT = 6;

/** 门禁口径：固定 seed（1000）+ 每档 100 局（2400 局）下的最大极差上限（pp）。基线 8.6pp ⇒ 余量 ≈ 28%。 */
export const POSITION_SPREAD_GATE_LIMIT = 11;

/** 门禁口径：同上的最大 **RMS 偏离**上限（pp）—— RMS 用到全部位次 ⇒ 比极差稳健。基线 3.38pp。 */
export const POSITION_RMS_GATE_LIMIT = 4.5;

/** 位次胜率相对均匀分布的偏离统计量。 */
export interface PositionSpread {
  readonly max: number;
  readonly min: number;
  /** 极差（max − min，pp）—— 噪声主导，只作参考。 */
  readonly spread: number;
  /** RMS 偏离（pp）—— 用到全部位次 ⇒ 稳健。 */
  readonly rms: number;
  /** 是否严格单调（先手优势的定性信号；⚠️ 小样本下噪声也能造出 ⇒ 不可单独当门禁）。 */
  readonly monotone: boolean;
}

/**
 * 由各位次的偏离值（pp，相对均匀分布）算出统计量。
 *
 * ⚠️ 纯函数（无状态、无随机）⇒ 可被单测直接覆盖 ⇒ 门禁与报告共用同一份实现。
 */
export function computePositionSpread(devs: readonly number[]): PositionSpread {
  if (devs.length === 0) { return { max: 0, min: 0, spread: 0, rms: 0, monotone: false }; }
  let up = true;
  let down = true;
  for (let i = 1; i < devs.length; i++) {
    const prev = devs[i - 1] ?? 0;
    const cur = devs[i] ?? 0;
    if (!(cur > prev)) { up = false; }
    if (!(cur < prev)) { down = false; }
  }
  const max = Math.max(...devs);
  const min = Math.min(...devs);
  const rms = Math.sqrt(devs.reduce((a, d) => a + d * d, 0) / devs.length);
  return { max, min, spread: max - min, rms, monotone: up || down };
}
