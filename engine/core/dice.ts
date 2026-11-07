// 可复现随机源与骰子（规格 §3.2 双骰：6 面移动骰 / 20 面指令骰）

/**
 * 确定性随机源（mulberry32）。
 *
 * 有状态：每次取数推进内部状态，因此「同 seed 的两个独立实例产生同序列」，
 * 而「同一实例连续取数产生不同结果」。二者都是 §9.2 可复现性断言需要的。
 */
export class Rng {
  private s: number;

  /** 初始种子（用于存档与复现）。 */
  readonly initialSeed: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
    this.initialSeed = seed >>> 0;
  }

  /** 取下一个 [0,1) 浮点数并推进状态。 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let r = this.s;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  /** 当前状态快照（用于序列化 / 存档）。 */
  snapshot(): number {
    return this.s;
  }
}

/** 创建随机源。 */
export function createRng(seed: number): Rng {
  return new Rng(seed);
}

/** 掷 6 面移动骰，返回 1–6。 */
export function rollD6(rng: Rng): number {
  return Math.floor(rng.next() * 6) + 1;
}

/** 掷 20 面指令骰，返回 1–20。 */
export function rollD20(rng: Rng): number {
  return Math.floor(rng.next() * 20) + 1;
}
