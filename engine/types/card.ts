// 卡牌类型与筛选条件（规格 §6.4 V1.4 裁定）

import type { CardType } from './theme.ts';

export type { CardType };

/**
 * 负面状态枚举——只有这四类可被免疫。
 * `shield` / `double_next_vote` / `extra_signatures_required` 是正面或专用效果，
 * 类型层面禁止对它们免疫。
 */
export type NegativeStatus = 'poison' | 'slow' | 'silence' | 'skip_turn';

/** 费用比较运算符。 */
export type CostOp = 'lte' | 'gte' | 'eq';

/**
 * 牌筛选条件：**五字段 AND 组合**，空 filter `{}` 匹配任意牌。
 * `has_card` / `card_type_is` / `gain_card` / `random_from_deck` **共用这一个结构**，
 * 禁止各自定义 filter 语法。
 */
export interface CardFilter {
  /** 卡牌类型 */
  readonly type?: CardType;
  /** 颜色 */
  readonly color?: 'red' | 'black';
  /** 花色（主题风味，不参与比较） */
  readonly suit?: string;
  /** 费用比较 */
  readonly cost?: { readonly op: CostOp; readonly value: number };
  /** 精确匹配卡牌 id */
  readonly cardId?: string;
}

/** filter 是否匹配给定卡牌（AND 语义，空 filter 匹配任意）。 */
export function filterMatches(filter: CardFilter, card: {
  readonly id: string;
  readonly type: CardType;
  readonly color: 'red' | 'black';
  readonly suit?: string;
  readonly cost: number;
}): boolean {
  if (filter.cardId !== undefined && filter.cardId !== card.id) {
    return false;
  }
  if (filter.type !== undefined && filter.type !== card.type) {
    return false;
  }
  if (filter.color !== undefined && filter.color !== card.color) {
    return false;
  }
  if (filter.suit !== undefined && filter.suit !== card.suit) {
    return false;
  }
  if (filter.cost !== undefined) {
    const { op, value } = filter.cost;
    if (op === 'lte' && !(card.cost <= value)) {
      return false;
    }
    if (op === 'gte' && !(card.cost >= value)) {
      return false;
    }
    if (op === 'eq' && card.cost !== value) {
      return false;
    }
  }
  return true;
}
