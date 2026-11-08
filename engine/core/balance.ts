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

/**
 * ── 精确 t 分布统计（双侧 p = 0.05 临界值）────────────────────────────
 *
 * ⚠️ 为什么需要精确值（B32）：此前用「临界值表 + 取最近较小 df」⇒ **偏保守**（df 越大偏得越多），
 *   且 df 被取整 ⇒ 丢掉 Welch–Satterthwaite 的自由度信息 ⇒ 判定口径不精确。
 *   现改为**直接求 t 分布分位数**（Lanczos logΓ + 不完全 β 连分数 + 二分求根）⇒ 任意 df 皆精确。
 */

/**
 * logΓ(z) —— **递推到 z ≥ 8 + Stirling 高阶修正**。
 *
 * ⚠️ B32 修正：Lanczos 实现一度让 CDF 越界（CDF(1, 18) = 1.21）⇒ 二分求根发散；
 *   改用「递推 + Stirling（含 1/12z − 1/360z³ + 1/1260z⁵）」⇒ 精度 ~1e-12 且实现更简单。
 */
function logGamma(z: number): number {
  let x = z;
  let shift = 0;
  while (x < 8) { shift += Math.log(x); x += 1; }
  const inv = 1 / x;
  const series = inv / 12 - (inv ** 3) / 360 + (inv ** 5) / 1260;
  return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + series - shift;
}

/** 不完全 β 函数的连分数展开（Numerical Recipes 的 betacf）。 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) { d = fpmin; }
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) { d = fpmin; }
    c = 1 + aa / c; if (Math.abs(c) < fpmin) { c = fpmin; }
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < fpmin) { d = fpmin; }
    c = 1 + aa / c; if (Math.abs(c) < fpmin) { c = fpmin; }
    d = 1 / d;
    const del = d * c;
    h *= del;
    // ⚠️ B32 修正：终止阈值取 1e-12（3e-16 远紧于连分数可达精度 ⇒ 不收敛 ⇒ 结果发散）。
    if (Math.abs(del - 1) < 1e-12) { break; }
  }
  return h;
}

/** 正则化不完全 β 函数 I_x(a, b)。 */
function betaRegularized(a: number, b: number, x: number): number {
  if (x <= 0) { return 0; }
  if (x >= 1) { return 1; }
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  // ⚠️ B32 修正：对称分支必须用 `I_{1-x}(b, a)` **自己的** beta 项 ——
  //   误用 `I_x(a, b)` 的 beta 项会让 CDF 越界（CDF(1, 18) 曾算出 1.21）⇒ 二分求根发散。
  //   递归调用最不易错：此时 1-x 更小 ⇒ 走上面的直接分支。
  return 1 - betaRegularized(b, a, 1 - x);
}

/** t 分布累积分布函数（Student's t）。 */
export function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * betaRegularized(df / 2, 0.5, x);
  return t >= 0 ? 1 - p : p;
}

/**
 * 双侧 p = 0.05 的 t 临界值（**精确求分位数**，不二分近似、不查表）。
 *
 * ⚠️ 用法：`|t| ≥ tCritical05(df)` ⇒ 拒绝原假设（p < 0.05）。
 */
export function tCritical05(df: number): number {
  if (!(df > 0)) { throw new Error('df 必须为正'); }
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < 0.975) { lo = mid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}
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
