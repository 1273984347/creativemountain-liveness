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
  | 'CERTIFY_ANSWER'
  | 'CERTIFY_MUTUAL_SIGN'
  | 'DUEL_SUBMIT_CARD'
  | 'EQUIP_CARD'
  | 'COUNCIL_VETO';

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
  | { readonly type: 'CERTIFY_ANSWER'; readonly actor: number; readonly target: number; readonly passed: boolean }
  /**
   * 双人互验的互签（规格 §5.5，B67 定案）。
   *
   * ⚠️ **与 `CERTIFY_SIGN` 语义不同、不可复用**：
   *   · `CERTIFY_SIGN` 是**认证人**（存活、非待认证者）给**待认证者**签印（引擎 `isCertifier` 守卫）；
   *   · `CERTIFY_MUTUAL_SIGN` 是**待认证者本人**给**另一位待认证者**签印（引擎 `certifyMutualSign` 守卫：
   *     双方都必须在 `pending` 里、且不能自己签自己）。
   * ⇒ 双方互签即各自达标（双人时门槛降为 1，见 §5.2 步骤 0 前置分支）⇒ **不产生死锁**。
   */
  | { readonly type: 'CERTIFY_MUTUAL_SIGN'; readonly actor: number; readonly target: number }
  /**
   * 对峙选牌（规格 §3.3，B68 定案）：锁定一张亮牌，两人都锁定即揭晓结算。
   *
   * ⚠️ **可见性边界（预研红线 3）**：亮牌**对对手不可见** ⇒ 本动作的 `cardId`
   *   **只能是行动者自己手牌里的牌** ⇒ 枚举层**只发给对峙参与者**、**且只发他自己的手牌**
   *   ⇒ 任何一方都拿不到对方的手牌 id（拿不到 ⇒ 无法看到对方将出什么牌）。
   * ⚠️ 引擎 `submitDuelCard` 的守卫同款：非参与者 ⇒ 拒；手牌中无此牌 ⇒ 拒；已锁定 ⇒ 拒。
   */
  | { readonly type: 'DUEL_SUBMIT_CARD'; readonly actor: number; readonly cardId: string }
  /**
   * 装备（B75 设计 §4.1）：把手牌里的一张牌转为常驻装备，**免费、不占手牌上限、不产生位移**。
   *
   * ⚠️ 只在行动阶段可用，且判定**位于关隘/裂隙早退之后**：到达未通过关隘时该手番已暂停
   *   （通道选择属结算阶段），装备会占用同一手番的行动 ⇒ 暂停中不可装备。
   */
  | { readonly type: 'EQUIP_CARD'; readonly actor: number; readonly cardId: string }
  /**
   * 仲裁者否决（B75 设计 §4.2）：每局 1 次，令**本次**山议放逐归零。
   *
   * ⚠️ 只能由持 `council_veto` 特权者在**所有存活玩家都已投票之后、结算之前**提交
   *   ——否决的对象是「本次投票结果」，投完票是硬前置。
   */
  | { readonly type: 'COUNCIL_VETO'; readonly actor: number };
