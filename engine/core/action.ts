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
  | 'GATE_RESOLVE'
  | 'BARRIER_RESOLVE'
  | 'PASS'
  | 'VOTE'
  | 'CERTIFY_SIGN'
  | 'CERTIFY_CHALLENGE'
  | 'CERTIFY_ABSTAIN'
  | 'CERTIFY_APPEAL'
  | 'CERTIFY_APPEAL_VOTE'
  | 'CERTIFY_ANSWER';

/**
 * 声明式动作。`type` 为判别式字段。
 *
 * `PLAY_CARD.target` 可选 = 真实入口 `performAction(s, seat, 'act', { cardId, target? })` 的形状
 * （设计 §3.2 / §5 的 key 文法含 `play:<cardId>` 与 `play:<cardId>-><seat>` 两式）：
 * 需选目标的牌（`cardNeedsTarget`）必须带 target，否则引擎不出牌
 * （判据在 `performAction` 的 `act` 分支：需要目标而未选目标 ⇒ 不出牌）。
 */
export type Action =
  | { readonly type: 'MOVE'; readonly actor: number; readonly steps: number }
  | { readonly type: 'PLAY_CARD'; readonly actor: number; readonly cardId: string; readonly target?: number }
  | { readonly type: 'ABILITY'; readonly actor: number; readonly abilityId: string; readonly target?: number }
  | { readonly type: 'ROLL_WHEEL'; readonly actor: number }
  | { readonly type: 'COMPARE'; readonly actor: number; readonly cardId: string; readonly target: number }
  /**
   * 关隘通道选择（规格 §3.5，B18 定案）。
   *
   * ⚠️ 发生在**结算阶段**（到达关隘后手番暂停），**不是行动阶段** —— 行动三选一已被移动占用。
   *   · `pay`：付费通道，付该格标价（3–5 灵枢）立即通过；灵枢不足 ⇒ 引擎拒绝。
   *   · `trial`：试炼通道，公开抽一张该关隘的试炼牌并执行其效果树（后果由主题包数据表达）。
   */
  | { readonly type: 'GATE_RESOLVE'; readonly actor: number; readonly channel: 'pay' | 'trial' }
  /**
   * 裂隙通道选择（规格 §3.4，B18-b）：落到**无印的裂隙格**时手番暂停，玩家二选一。
   *
   * ⚠️ `place` = 花 2 灵枢在**这一格**放置封路印（随后仍要面对自己的印）；
   *   `skip` = 不放印，直接通过。
   */
  | { readonly type: 'BARRIER_RESOLVE'; readonly actor: number; readonly channel: 'place' | 'skip' }
  | { readonly type: 'PASS'; readonly actor: number }
  | { readonly type: 'VOTE'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_SIGN'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_CHALLENGE'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_ABSTAIN'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_APPEAL'; readonly actor: number; readonly target: number }
  | { readonly type: 'CERTIFY_APPEAL_VOTE'; readonly actor: number; readonly target: number; readonly overturn: boolean }
  | { readonly type: 'CERTIFY_ANSWER'; readonly actor: number; readonly target: number; readonly passed: boolean };
