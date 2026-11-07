// 共享基础类型（避免 theme.ts ↔ state.ts 循环依赖）

/** 阶段。 */
export type Phase = '天机' | '行动' | '山议' | '认证' | '终局';

/** 数值比较运算符。 */
export type CompareOp = 'lte' | 'gte' | 'eq' | 'neq';

/** 卡牌颜色。 */
export type CardColor = 'red' | 'black';

/** 卡牌类型（手牌分类，V1 固定四类——新增类型 = 改引擎，不是改主题）。 */
export type CardType = 'motion' | 'attack' | 'defense' | 'utility';

/** 费用比较运算符。 */
export type CostOp = 'lte' | 'gte' | 'eq';

/**
 * 负面状态枚举——只有这四类可被免疫。
 * `shield` / `double_next_vote` / `extra_signatures_required` 是正面或专用效果，
 * 类型层面禁止对它们免疫。
 */
export type NegativeStatus = 'poison' | 'slow' | 'silence' | 'skip_turn';

/**
 * 牌筛选条件：**五字段 AND 组合**，空 filter `{}` 匹配任意牌。
 * `has_card` / `card_type_is` / `gain_card` / `random_from_deck` **共用这一个结构**。
 */
export interface CardFilter {
  readonly type?: CardType;
  readonly color?: CardColor;
  readonly suit?: string;
  readonly cost?: { readonly op: CostOp; readonly value: number };
  readonly cardId?: string;
}
