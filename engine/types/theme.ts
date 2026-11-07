// 主题包数据契约（唯一真相源）
//
// 规格 §6.5。本文件是 `tools/theme-validate.mjs` 生成 JSON Schema 的依据（实施计划 §0.1 规则 3），
// 也是 B4 验收「类型同源」链路的起点：改本文件 → schema 自动变 → 故意写错主题 → 校验报错。
//
// 硬约束：主题包是**纯数据**，不得内联代码。所有效果以「算子 + 参数」表达，
// 算子必须在 `engine/ops/registry.ts` 中注册（规格 §6.4 铁律）。

import type {
  CardColor,
  CardFilter,
  CardType,
  CompareOp,
  NegativeStatus,
} from './common.ts';
import type { Phase } from './common.ts';

export type { CardColor, CardFilter, CardType, CompareOp, NegativeStatus };

/**
 * 算子参数表 —— **每个算子的参数结构**（规格 §6.4，盘点文档 §13）。
 *
 * 这是「四层契约」里最关键的一层：`Effect` 由它派生为**判别式联合**，
 * 因此主题包里写错算子名或参数名会在**编译期**暴露，而不是运行时才炸。
 */
export interface EffectMap {
  // ---- 资源 ----
  gain_resource: { readonly amount: number };
  spend_resource: { readonly amount: number };
  transfer_resource: { readonly amount: number; readonly target: number };
  set_resource: { readonly amount: number; readonly target?: number };
  // ---- 牌 ----
  draw_cards: { readonly count: number; readonly target?: number };
  gain_card: { readonly count?: number; readonly target?: number; readonly filter: CardFilter };
  discard_self: { readonly count: number; readonly mode?: 'any' | 'chosen' };
  discard_opponent: { readonly count: number; readonly target: number };
  exhaust_card: { readonly cardId: string; readonly target?: number };
  peek_deck: { readonly count: number };
  add_to_deck: { readonly cardIds: readonly string[]; readonly target?: number };
  remove_from_deck: { readonly cardIds: readonly string[]; readonly target?: number };
  swap_deck_top: { readonly count: number };
  // ---- 位移 ----
  move_forward: { readonly amount: number; readonly target?: number };
  move_backward: { readonly amount: number; readonly target: number };
  move_to_tile: { readonly tileIndex: number; readonly target?: number };
  move_relative_to: { readonly amount: number; readonly target: number };
  swap_position: { readonly target: number };
  teleport: { readonly tileIndex: number; readonly target?: number };
  /** 掷 faces 面骰并前进该点数（规格 §3.2 第 5 条；步数来自运行时骰子结果） */
  move_by_dice: { readonly faces: 6; readonly target?: number };
  // ---- 骰子 ----
  extra_roll: { readonly count: number };
  reroll: { readonly count: number };
  keep_die: { readonly count: number };
  set_die_result: { readonly value: number };
  roll_opponent: { readonly target: number };
  // ---- 状态 ----
  shield: { readonly amount: number; readonly target?: number };
  poison: { readonly amount: number; readonly target?: number };
  slow: { readonly amount: number; readonly target?: number };
  silence: { readonly amount: number; readonly target?: number };
  skip_turn: { readonly amount: number; readonly target?: number };
  immunity: { readonly status: NegativeStatus; readonly amount: number; readonly target?: number };
  double_next_vote: { readonly target?: number };
  extra_signatures_required: { readonly amount: number; readonly target?: number };
  set_phase: { readonly value: 'night' | 'day' };
  set_flag: { readonly flag: string; readonly value?: unknown; readonly target?: number };
  clear_flag: { readonly flag: string; readonly target?: number };
  // ---- 战斗 ----
  damage: { readonly amount: number; readonly target: number };
  heal: { readonly amount: number; readonly target?: number };
  compare_cards: { readonly cardId: string; readonly target: number };
  disarm: { readonly target: number };
  // ---- 投票 ----
  vote_modifier: { readonly amount: number; readonly target?: number };
  extra_vote: { readonly amount: number; readonly target?: number };
  cancel_vote: { readonly target: number };
  exempt_from_vote: { readonly target?: number };
  // ---- 认证 ----
  certify_extra_signer: { readonly amount: number };
  certify_free_pass: { readonly target?: number };
  certify_extra_round: { readonly amount: number };
  certify_forbid_challenge: { readonly target?: number };
  // ---- 阵营 ----
  spirit_wheel: { readonly source?: 'manual' | 'command'; readonly target?: number };
  // ---- 组合 ----
  sequence: { readonly effects: readonly Effect[] };
  conditional: { readonly pred: Predicate; readonly then: Effect; readonly else?: Effect };
  count: { readonly count: number; readonly effect: Effect };
  random_from_deck: { readonly count: number; readonly target?: number; readonly filter?: CardFilter };
  // ---- 棋盘 ----
  place_barrier: { readonly tileIndex: number };
  // ---- 判定与装备 ----
  modify_judgement: { readonly target?: number };
  create_card: { readonly cardId: string; readonly target?: number };
  equip_card: { readonly cardId: string; readonly target?: number };
}

/** 算子名（显式联合——doc-sync 门禁从源码文本解析此列表）。 */
export type OpName =
  | 'gain_resource'
  | 'spend_resource'
  | 'transfer_resource'
  | 'set_resource'
  | 'draw_cards'
  | 'gain_card'
  | 'discard_self'
  | 'discard_opponent'
  | 'exhaust_card'
  | 'peek_deck'
  | 'add_to_deck'
  | 'remove_from_deck'
  | 'swap_deck_top'
  | 'move_forward'
  | 'move_backward'
  | 'move_to_tile'
  | 'move_relative_to'
  | 'swap_position'
  | 'teleport'
  | 'move_by_dice'
  | 'extra_roll'
  | 'reroll'
  | 'keep_die'
  | 'set_die_result'
  | 'roll_opponent'
  | 'shield'
  | 'poison'
  | 'slow'
  | 'silence'
  | 'skip_turn'
  | 'immunity'
  | 'double_next_vote'
  | 'extra_signatures_required'
  | 'set_phase'
  | 'set_flag'
  | 'clear_flag'
  | 'damage'
  | 'heal'
  | 'compare_cards'
  | 'disarm'
  | 'vote_modifier'
  | 'extra_vote'
  | 'cancel_vote'
  | 'exempt_from_vote'
  | 'certify_extra_signer'
  | 'certify_free_pass'
  | 'certify_extra_round'
  | 'certify_forbid_challenge'
  | 'spirit_wheel'
  | 'sequence'
  | 'conditional'
  | 'count'
  | 'random_from_deck'
  | 'place_barrier'
  | 'modify_judgement'
  | 'create_card'
  | 'equip_card';

/**
 * 效果（判别式联合）。
 *
 * `op` 是判别式字段：TypeScript 会据此收窄参数类型——
 * 写 `{ op: 'gain_resource', amount: 1 }` 合法，
 * 写 `{ op: 'gain_resource', amout: 1 }` **编译期报错**。
 */
export type Effect = { [K in OpName]: { readonly op: K } & EffectMap[K] }[OpName];

/** 地形种类。 */
export type TileKind = 'plain' | 'boon' | 'hazard' | 'rift' | 'gate' | 'junction' | 'peak';

/** 条件谓词参数表。 */
export interface PredicateMap {
  tile_kind: { readonly kind: TileKind; readonly tileIndex?: number };
  has_card: { readonly filter: CardFilter };
  resource_at_least: { readonly amount: number };
  hand_count: { readonly count: number; readonly op: CompareOp };
  is_pending_cert: Record<string, never>;
  phase_is: { readonly value: Phase };
  players_alive: { readonly count: number; readonly op: CompareOp };
  card_type_is: { readonly type: CardType };
  identity_is: { readonly identityId: string };
  faction_is: { readonly factionId: string };
  hp_at_least: { readonly amount: number };
  flag_set: { readonly flag: string };
  last_dice_even: Record<string, never>;
  dice_is_at_least: { readonly amount: number; readonly faces: number };
  card_color_is: {
    readonly color: CardColor;
    readonly source:
      | { readonly kind: 'deckTop' }
      | { readonly kind: 'cardId'; readonly cardId: string };
  };
}

/** 谓词名（显式联合——doc-sync 门禁从源码文本解析此列表）。 */
export type PredicateName =
  | 'tile_kind'
  | 'has_card'
  | 'resource_at_least'
  | 'hand_count'
  | 'is_pending_cert'
  | 'phase_is'
  | 'players_alive'
  | 'card_type_is'
  | 'identity_is'
  | 'faction_is'
  | 'hp_at_least'
  | 'flag_set'
  | 'last_dice_even'
  | 'dice_is_at_least'
  | 'card_color_is';

/** 条件谓词（判别式联合）。 */
export type Predicate = { [K in PredicateName]: { readonly kind: K } & PredicateMap[K] }[PredicateName];

/** 终局目标 kind 枚举（规格 §6.4 表格，B2 在 goals/registry.ts 实现）。 */
export type GoalKind =
  | 'pass_gates' | 'equip_count' | 'draw_count' | 'veto_success'
  | 'survive_with_hp' | 'steal_count' | 'reroll_count' | 'successful_challenge';

/** 终局目标声明。`count` 缺省为 1。 */
export interface Goal {
  readonly kind: GoalKind;
  readonly count?: number;
}


// ---- 主题包数据实体（规格 §6.5）----

/** 阵营（四阵营槽位，主题包各给 4 个）。 */
export interface Faction {
  readonly id: string;
  readonly name: string;
  readonly hpBase: number;
  readonly resourceBase: number;
  readonly ability: Effect;
  readonly wheel: Effect;
  readonly deckTags: readonly string[];
}

/** 身份（8 个槽位，全主题共用特权与目标，仅换名字与 flavor）。 */
export interface Identity {
  readonly id: string;
  readonly name: string;
  readonly passive: Effect;
  readonly goal: Goal;
  readonly flavor?: string;
}

/** 卡牌（规格 §6.5；`rank` 见 §3.3 点数比较规则）。 */
export interface Card {
  readonly id: string;
  readonly name: string;
  readonly type: CardType;
  readonly cost: number;
  readonly color: CardColor;
  /** 花色：主题风味，**不参与任何比较** */
  readonly suit?: string;
  /** 点数比较优先级（数值，必填，2–14：A=14、K=13、Q=12、J=11、10…2） */
  readonly rank: number;
  /** 显示用标签（如仙侠「天/地/玄/黄」），可选 */
  readonly rankLabel?: string;
  readonly text: string;
  readonly effects: readonly Effect[];
}

/** 关隘（副本）定义。 */
export interface Gate {
  readonly fee: number;
  readonly trialIds: readonly string[];
}

/** 支路选项。 */
export interface Branch {
  readonly to: number;
  readonly label: string;
  readonly effect?: Effect;
}

/** 山道格位。 */
export interface Tile {
  readonly index: number;
  readonly kind: TileKind;
  readonly name: string;
  readonly gate?: Gate;
  readonly branches?: readonly Branch[];
  /** 封路印（规格 §3.4 裂隙；`place_barrier` 放置） */
  readonly barrier?: boolean;
}

/** 棋盘定义。峰顶为 peakIndex。 */
export interface BoardDef {
  readonly length: number;
  readonly tiles: readonly Tile[];
  readonly peakIndex: number;
}

/** 天机牌（回合开始时翻开，对全场生效）。 */
export interface HeavenCard {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly effects: readonly Effect[];
}

/** 认证题卡（保底题库，主题化，≥8 张）。 */
export interface CertificationCard {
  readonly id: string;
  readonly prompt: string;
}

/** 关隘试炼牌。 */
export interface TrialCard {
  readonly id: string;
  readonly text: string;
  readonly effects?: readonly Effect[];
}

/**
 * 造物牌（匠师「免费造物」的来源）。
 * 独立牌堆，不可从普通牌库抽取；装备后不占手牌上限，公开可见，**V1 无被动效果**。
 */
export interface CreationCard {
  readonly cardId: string;
  readonly name: string;
  readonly text: string;
  readonly type?: CardType;
  readonly cost?: number;
  readonly color?: CardColor;
  readonly suit?: string;
  readonly rank?: number;
  readonly rankLabel?: string;
  readonly effects?: readonly Effect[];
}

/** 主题元信息。 */
export interface ThemeMeta {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly resourceName: string;
  readonly deckName: string;
}

/** 术语表：至少覆盖 HP / deck / hand / resource 四个核心术语。 */
export interface Glossary {
  readonly HP: string;
  readonly deck: string;
  readonly hand: string;
  readonly resource: string;
  readonly [key: string]: string;
}

/** 数量配置。 */
export interface Counts {
  readonly handStart: number;
  readonly deckTotal: number;
  readonly trialTotal: number;
  readonly certTotal: number;
}

/** 主题包完整结构。 */
export interface ThemePack {
  readonly meta: ThemeMeta;
  readonly glossary: Glossary;
  readonly counts: Counts;
  readonly factions: readonly Faction[];
  readonly identities: readonly Identity[];
  readonly cards: readonly Card[];
  readonly board: BoardDef;
  readonly heavenCards: readonly HeavenCard[];
  readonly certificationCards: readonly CertificationCard[];
  readonly trials?: readonly TrialCard[];
  /** 造物牌堆（规格 §6.5；`create_card` 的唯一来源） */
  readonly creationDeck?: readonly CreationCard[];
}
