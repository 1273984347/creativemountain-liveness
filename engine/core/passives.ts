// 身份的**常驻型被动**授予（规格 §4.1）。
//
// ⚠️ 为什么只覆盖 extra_vote：8 个身份的被动语义各不相同
//   （「每回合首次移动 +1 格」「每场限 1 次免费造物」「每回合 1 次改判定」…），
//   **无法用统一的回合末触发**实现（那样会让「改判定」自动生效、「偷资源」自动扣自己）。
//   而 extra_vote 是**常驻型**（投票权重加成）⇒ 分配身份时一次性授予即可，
//   语义与规格 §4.1「仲裁者：山议中可投 2 票」完全一致。
//
// 其余被动的逐个触发点属 V1.1（见 B10 执行记录的遗留清单）。

import type { Effect } from '../types/theme.ts';

/** 被动里授予的常驻标记。 */
export interface GrantedFlags {
  /** 投票权重加成（`extra_vote`）：投票权重 = 1 + extraVotes */
  readonly extraVotes: number;
}

/**
 * 计算一个被动里**常驻型**效果的授予值。
 *
 * 递归下探 sequence / conditional / count —— 被动也可能是组合结构。
 */
export function grantedFlags(passive: Effect | undefined): GrantedFlags {
  let extraVotes = 0;
  const walk = (e: Effect): void => {
    switch (e.op) {
      case 'extra_vote':
        extraVotes += e.amount;
        break;
      case 'sequence':
        e.effects.forEach(walk);
        break;
      case 'conditional':
        walk(e.then);
        if (e.else !== undefined) { walk(e.else); }
        break;
      case 'count':
        walk(e.effect);
        break;
      default:
        break;
    }
  };
  if (passive !== undefined) { walk(passive); }
  return { extraVotes };
}