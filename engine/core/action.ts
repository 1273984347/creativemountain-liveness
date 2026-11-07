// 动作模型（规格 §6.3）
//
// 引擎只接受**声明式动作**。UI 与（未来的）AI 都只能提交引擎枚举出的合法动作。
// Action 是可辨识联合（discriminated union）——B1/B2 的类型契约基础。

/** 行动类型：每人每 round 一次行动，三选一（行棋 / 问天 / 行事）。 */
export type ActionType =
  | 'MOVE'
  | 'PLAY_CARD'
  | 'ABILITY'
  | 'ROLL_WHEEL'
  | 'COMPARE'
  | 'PASS'
  | 'VOTE'
  | 'CERTIFY_SIGN'
  | 'CERTIFY_CHALLENGE'
  | 'CERTIFY_ABSTAIN'
  | 'CERTIFY_APPEAL'
  | 'CERTIFY_APPEAL_VOTE'
  | 'CERTIFY_ANSWER';

/** 声明式动作。`type` 为判别式字段。 */
export type Action =
  | { readonly type: 'MOVE'; readonly actor: number; readonly steps: number }
  | { readonly type: 'PLAY_CARD'; readonly actor: number; readonly cardId: string }
  | { readonly type: 'ABILITY'; readonly actor: number; readonly abilityId: string; readonly target?: number }
  | { readonly type: 'ROLL_WHEEL'; readonly actor: number }
  | { readonly type: 'COMPARE'; readonly actor: number; readonly cardId: string; readonly target: number }
  | { readonly type: 'PASS'; readonly actor: number }
  | { readonly type: 'VOTE'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_SIGN'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_CHALLENGE'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_ABSTAIN'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_APPEAL'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_APPEAL_VOTE'; readonly actor: number; readonly target: number; readonly overturn: boolean }
  | { readonly type: 'CERTIFY_ANSWER'; readonly actor: number; readonly target: number; readonly passed: boolean };
