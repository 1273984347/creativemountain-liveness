// 流程状态类型（规格 §5 活人认证 / §5.6 山议 / §5.7–5.8 胜负）
//
// 本文件只放**类型**，不 import State —— 避免 state.ts ↔ 各流程模块的循环依赖。

/**
 * 认证流程状态（§5.1–§5.5）。
 *
 * 待认证者最多 2 名（双人互验，§5.5）。
 */
export interface CertificationState {
  /** 当前轮次（1 或 2；§5.2 最多 2 轮） */
  readonly round: number;
  /** 待认证者座位号（0–2 名） */
  readonly pending: readonly number[];
  /** 本轮已签印的认证人座位号 */
  readonly signed: readonly number[];
  /** 本轮已发起质疑的认证人座位号 */
  readonly challenged: readonly number[];
  /** 本轮已弃权的认证人座位号 */
  readonly abstained: readonly number[];
  /**
   * 待认证者已获得的签印数（按座位号索引）。
   * 双人互验时互签也计入（§5.5）。
   */
  readonly signatures: Readonly<Record<number, number>>;
  /**
   * 本轮各质疑的判定结果：`key` = 认证人座位号，`value` = 待认证者是否通过。
   * `false` = 判不通过（触发后退与复议可能）。
   */
  readonly judgments: Readonly<Record<number, boolean>>;
  /** 已申请复议的认证人座位号（每待认证者每轮限 1 次） */
  readonly appealed: readonly number[];
  /** 复议投票：`key` = 投票人座位号，`value` = 是否推翻原判（true = 推翻） */
  readonly appealVotes: Readonly<Record<number, boolean>>;
  /** 合规裁定投票：`key` = 投票人座位号，`value` = 题目是否可验证（true = 可验证） */
  readonly validityVotes: Readonly<Record<number, boolean>>;
  /** 本轮是否已判定题目合规（避免重复裁定） */
  readonly validityDecided: boolean;
}

/** 山议流程状态（§5.6）。 */
export interface CouncilState {
  /** 本局已召开的山议次数 */
  readonly heldCount: number;
  /** 上次山议的回合号（用于间隔判定） */
  readonly lastRound: number;
  /** 当前山议的投票：`key` = 投票人座位号，`value` = 投给谁 */
  readonly votes: Readonly<Record<number, number>>;
  /** 当前山议是否已结束 */
  readonly resolved: boolean;
  /** 本局已使用仲裁者否决（每局 1 次） */
  readonly vetoUsed: boolean;
  /**
   * 本局**使用**否决的座位（未使用为 null）。
   *
   * ⚠️ 与 `vetoUsed` 分开记：`vetoUsed` 是「每局一次」的闸门，`vetoBy` 是「计数该给谁」。
   *   旧存档可能没有本字段 ⇒ 读取侧一律 `?? null` 容错（规格 §13 R4：不写迁移）。
   */
  readonly vetoBy: number | null;
}

/**
 * 待决对峙（规格 §3.3）。
 *
 * 双方**各自选牌、选完才同时揭晓**（B13 裁定）——选牌对对方不可见，
 * 两人都锁定后一次性比较并结算。
 */
export interface DuelState {
  /** 移动方座位（先到该格者） */
  readonly seatA: number;
  /** 对手座位 */
  readonly seatB: number;
  /** 移动方已锁定的亮牌 id（未锁定为 undefined） */
  readonly pickA?: string;
  /** 对手已锁定的亮牌 id（未锁定为 undefined） */
  readonly pickB?: string;
}

/**
 * 本 round **公开**的亮牌（规格 §3.3：「两张牌在比较后留在场上公开，
 * 不回到任何人的手牌，直至本 round 结束」）。
 */
export interface PublicCard {
  /** 亮牌者座位 */
  readonly seat: number;
  /** 牌 id */
  readonly cardId: string;
  /** 牌名 */
  readonly name: string;
  /** 颜色（red / black） */
  readonly color: string;
  /** 点数（rank 数值，§3.3 比较永远走数值） */
  readonly rank: number;
}

/** 对局结局（§5.7 胜利判定 / §5.8 兜底排名）。 */
export interface Outcome {
  /** 是否已结束 */
  readonly finished: boolean;
  /** 胜者座位号（可多个 = 并列封顶） */
  readonly winners: readonly number[];
  /**
   * 结束原因：
   * - `seats`：**活人席计分制结算**（B11）—— 达到全局回合上限，按席位数排名；
   * - `fallback`：达到全局回合上限且**无人取得任何席位** ⇒ 纯按距离排名；
   * - `no_winner`：活人缺席（场上仅剩 ≤1 人）。
   *
   * ⚠️ 原 `certified`（「封顶即终局」）已随 B11 计分制移除 —— 封顶不再结束对局。
   */
  readonly reason: 'seats' | 'fallback' | 'no_winner';
}
