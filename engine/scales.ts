/**
 * 规模自适应表 —— 唯一真相源。
 *
 * 规格 §8。字段名契约：**规则书表格、IR、引擎三处必须用同一套字段名**，
 * 数值溯源门禁（规格 §9.3 第四级）依赖它。改字段名会让溯源门禁全体判红。
 *
 * 溯源路径格式：`scales[<players>].<fieldName>`（例：`scales[5].threshold`）。
 */

/** 人数档位：3–8 人。2 人与 9+ 不支持（活人认证至少需 3 人在场）。 */
export type PlayerCount = 3 | 4 | 5 | 6 | 7 | 8;

/** 一行规模配置。字段名与规格 §8 契约逐字对应。 */
export interface ScalesRow {
  /** 玩家人数 */
  readonly players: PlayerCount;
  /** 山道格数 */
  readonly boardLength: number;
  /** 关隘数 */
  readonly gateCount: number;
  /** 初始灵枢 */
  readonly initialResource: number;
  /** 起始手牌 */
  readonly handStart: number;
  /** 牌库总量 */
  readonly deckTotal: number;
  /** 试炼牌总数 */
  readonly trialTotal: number;
  /** 认证题卡总数 */
  readonly certTotal: number;
  /** 认证签印门槛 N */
  readonly threshold: number;
  /** 持印记后的门槛 = ceil(N/2)，最低 1 */
  readonly thresholdWithMark: number;
  /** 山议间隔（标准模式），单位：round */
  readonly councilIntervalStandard: number;
  /** 山议间隔（新手模式）= 标准 + 2 */
  readonly councilIntervalNewbie: number;
  /** 放逐下限：存活人数不得低于此值 */
  readonly exileFloor: number;
  /** 全局回合上限 = 12 + 人数 */
  readonly globalRoundLimit: number;
  /** 预计局长（分钟） */
  readonly estimatedMinutes: number;
}

/** 规则模式。 */
export type RuleMode = 'standard' | 'newbie';

/** 规模表（3–8 人六档）。数值与规格 §8 表格一致。 */
export const SCALES: readonly ScalesRow[] = [
  { players: 3, boardLength: 24, gateCount: 2, initialResource: 4, handStart: 5, deckTotal: 40,
    trialTotal: 10, certTotal: 12, threshold: 2, thresholdWithMark: 1,
    councilIntervalStandard: 6, councilIntervalNewbie: 8, exileFloor: 3,
    globalRoundLimit: 15, estimatedMinutes: 35 },
  { players: 4, boardLength: 28, gateCount: 3, initialResource: 5, handStart: 5, deckTotal: 48,
    trialTotal: 12, certTotal: 14, threshold: 3, thresholdWithMark: 2,
    councilIntervalStandard: 6, councilIntervalNewbie: 8, exileFloor: 3,
    globalRoundLimit: 16, estimatedMinutes: 45 },
  { players: 5, boardLength: 32, gateCount: 3, initialResource: 6, handStart: 6, deckTotal: 56,
    trialTotal: 12, certTotal: 14, threshold: 3, thresholdWithMark: 2,
    councilIntervalStandard: 5, councilIntervalNewbie: 7, exileFloor: 3,
    globalRoundLimit: 17, estimatedMinutes: 55 },
  { players: 6, boardLength: 32, gateCount: 3, initialResource: 6, handStart: 6, deckTotal: 64,
    trialTotal: 14, certTotal: 16, threshold: 4, thresholdWithMark: 2,
    councilIntervalStandard: 5, councilIntervalNewbie: 7, exileFloor: 3,
    globalRoundLimit: 18, estimatedMinutes: 65 },
  { players: 7, boardLength: 36, gateCount: 4, initialResource: 7, handStart: 6, deckTotal: 72,
    trialTotal: 14, certTotal: 16, threshold: 5, thresholdWithMark: 3,
    councilIntervalStandard: 4, councilIntervalNewbie: 6, exileFloor: 3,
    globalRoundLimit: 19, estimatedMinutes: 80 },
  { players: 8, boardLength: 36, gateCount: 4, initialResource: 8, handStart: 7, deckTotal: 80,
    trialTotal: 16, certTotal: 18, threshold: 5, thresholdWithMark: 3,
    councilIntervalStandard: 4, councilIntervalNewbie: 6, exileFloor: 3,
    globalRoundLimit: 20, estimatedMinutes: 90 },
];

/** 取指定人数档位的规模配置。 */
export function getScales(players: PlayerCount): ScalesRow {
  const row = SCALES.find((s) => s.players === players);
  if (row === undefined) {
    throw new Error(`不支持的人数档位：${players}（支持 3–8 人）`);
  }
  return row;
}

/** 取指定模式下的山议间隔（round）。 */
export function councilInterval(row: ScalesRow, mode: RuleMode): number {
  return mode === 'newbie' ? row.councilIntervalNewbie : row.councilIntervalStandard;
}

/**
 * 字段名白名单 —— 溯源门禁的「可解析性」判据。
 * `data-src` 路径中的 `<fieldName>` 必须属于此集合，否则判红。
 */
export const SCALE_FIELD_NAMES = [
  'players', 'boardLength', 'gateCount', 'initialResource', 'handStart', 'deckTotal',
  'trialTotal', 'certTotal', 'threshold', 'thresholdWithMark',
  'councilIntervalStandard', 'councilIntervalNewbie', 'exileFloor',
  'globalRoundLimit', 'estimatedMinutes',
] as const;

export type ScaleFieldName = (typeof SCALE_FIELD_NAMES)[number];
