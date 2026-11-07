// 牌筛选条件的实现（类型定义见 engine/types/common.ts）

import type { CardFilter, CardType, CostOp } from './common.ts';

export type { CardFilter, CardType, CostOp };

/** filter 是否匹配给定卡牌（AND 语义，空 filter 匹配任意）。 */
export function filterMatches(
  filter: CardFilter,
  card: {
    readonly id: string;
    readonly type: CardType;
    readonly color: 'red' | 'black';
    readonly suit?: string;
    readonly cost: number;
  },
): boolean {
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
