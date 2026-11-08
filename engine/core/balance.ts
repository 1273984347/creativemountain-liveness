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

/**
 * 关隘试炼的**目标通过率区间**（B26）—— 按牌 id 给出 `[下限, 上限]`（%）。
 *
 * ⚠️ 为什么要显式声明：`has_card` 只能判「有没有 ≥1 张」⇒ 条件型试炼的真实通过率高达 73%–100%
 *   （B24 实测）⇒ 挑战性名存实亡；B26 引入 `has_card_count`（「至少 N 张」）后，每张牌都要
 *   **落到一个有意义的区间**（按关隘难度递进）⇒ 这里就是那张表（**单一事实源**，
 *   定向长跑与门禁 ⑪ 共用）。
 * ⚠️ 口径：区间对**定向长跑**口径生效（固定 8 人局、座 0 站在该牌所在关隘、抽 400 次）。
 */
export const TRIAL_PASS_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  // 6 号关（最易）：单色两张 ⇒ 近乎稳过（区间上界留到 100）
  t_mirror: [85, 100],
  t_sword: [85, 100],
  t_oath: [45, 70],
  // 14 号关（t_wind 仍按解析理论期望 75% 判定）
  t_wind: [65, 85],
  t_sutra: [45, 70],
  t_stone: [45, 70],
  // 22 号关：单类型两张（≈55%）与「类型+颜色」两张（≈22%）
  t_mantra: [45, 70],
  t_silent: [15, 35],
  t_vital: [15, 35],
  // 30 号关（最难）：组合两张 ≈ 20%；t_star 按解析理论期望 45% 判定
  t_star: [35, 55],
  t_empty: [12, 32],
  t_toll: [12, 32],
};

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
