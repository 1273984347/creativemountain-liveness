// 主题包数据契约（唯一真相源）
//
// 规格 §6.5。本文件是 `tools/theme-validate.mjs` 生成 JSON Schema 的依据（实施计划 §0.1 规则 3），
// 也是 B4 验收「类型同源」链路的起点：改本文件 → schema 自动变 → 故意写错主题 → 校验报错。
//
// 硬约束：主题包是**纯数据**，不得内联代码。所有效果以「算子 + 参数」表达，
// 算子必须在 `engine/ops/registry.ts` 中注册（规格 §6.4 铁律）。

/** 效果算子名（注册表见 engine/ops/registry.ts，B2 实现）。 */
export type OpName =
  | 'gain_resource' | 'spend_resource' | 'transfer_resource' | 'set_resource'
  | 'draw_cards' | 'gain_card' | 'discard_self' | 'discard_opponent' | 'exhaust_card'
  | 'peek_deck' | 'add_to_deck' | 'remove_from_deck' | 'swap_deck_top'
  | 'move_forward' | 'move_backward' | 'move_to_tile' | 'move_relative_to' | 'swap_position' | 'teleport'
  | 'extra_roll' | 'reroll' | 'keep_die' | 'set_die_result' | 'roll_opponent'
  | 'shield' | 'poison' | 'slow' | 'silence' | 'skip_turn' | 'immunity'
  | 'double_next_vote' | 'extra_signatures_required' | 'set_phase' | 'set_flag' | 'clear_flag'
  | 'damage' | 'heal' | 'compare_cards' | 'disarm'
  | 'vote_modifier' | 'extra_vote' | 'cancel_vote' | 'exempt_from_vote'
  | 'certify_extra_signer' | 'certify_free_pass' | 'certify_extra_round' | 'certify_forbid_challenge'
  | 'spirit_wheel'
  | 'sequence' | 'conditional' | 'count' | 'random_from_deck';

/** 条件谓词名（注册表见 engine/predicates.ts，B2 实现）。 */
export type PredicateName =
  | 'tile_kind' | 'has_card' | 'resource_at_least' | 'hand_count' | 'is_pending_cert'
  | 'phase_is' | 'players_alive' | 'card_type_is' | 'identity_is' | 'faction_is'
  | 'hp_at_least' | 'flag_set' | 'last_dice_even';

/** 终局目标 kind 枚举（规格 §6.4 表格，B2 在 goals/registry.ts 实现）。 */
export type GoalKind =
  | 'pass_gates' | 'equip_count' | 'draw_count' | 'veto_success'
  | 'survive_with_hp' | 'steal_count' | 'reroll_count' | 'successful_challenge';

/** 条件谓词。`kind` 之外的参数由各谓词自行解释。 */
export interface Predicate {
  readonly kind: PredicateName;
  readonly [key: string]: unknown;
}

/** 声明式效果（op + 参数），主题包中唯一允许的效果表达形式。 */
export interface Effect {
  readonly op: OpName;
  readonly [key: string]: unknown;
}

/** 终局目标声明。`count` 缺省为 1。 */
export interface Goal {
  readonly kind: GoalKind;
  readonly count?: number;
}

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

/** 卡牌颜色（对峙比较与险径判定都依赖它）。 */
export type CardColor = 'red' | 'black';

/**
 * 卡牌类型（手牌分类）。**V1 固定四类**——新增类型 = 改引擎，不是改主题。
 * 天机牌 / 认证题卡 / 试炼牌各有独立接口（HeavenCard / CertificationCard / TrialCard），不走本类型。
 */
export type CardType = 'motion' | 'attack' | 'defense' | 'utility';

/** 卡牌。 */
export interface Card {
  readonly id: string;
  readonly name: string;
  readonly type: CardType;
  readonly cost: number;
  readonly color: CardColor;
  /** 花色：主题风味，**不参与任何比较** */
  readonly suit?: string;
  /**
   * 点数比较优先级（数值，必填，2–14：A=14、K=13、Q=12、J=11、10…2）。
   * 对峙比较只读 `rank`，**永不解析字符串**。
   */
  readonly rank: number;
  /** 显示用标签（如仙侠「天/地/玄/黄」、科幻「A/B/C/D」），可选；缺省按 rank 生成扑克牌标签 */
  readonly rankLabel?: string;
  readonly text: string;
  readonly effects: readonly Effect[];
}

/** 地形种类。 */
export type TileKind = 'plain' | 'boon' | 'hazard' | 'rift' | 'gate' | 'junction' | 'peak';

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

/** 关隘试炼牌。 */
export interface TrialCard {
  readonly id: string;
  readonly text: string;
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
  /**
   * 造物牌堆（V1.4）：`create_card` 从这里取牌加入手牌，**不是凭空生成**。
   * 造物牌必须在 theme.json 声明、在 ir.json 输出、被 parity-check 覆盖。
   */
  readonly creationDeck?: readonly CreationCard[];
}