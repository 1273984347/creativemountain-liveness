// 身份被动的**主动发动**（规格 §4.1 权威被动表，B12）。
//
// 「主动」型被动 = 玩家在行动阶段「行事」时发动（匠师 / 观星者 / 窃火者 / 织梦者）。
// ⚠️ B12 修正：此前这些 op 只出现在主题包里，引擎**没有任何消费点** ⇒
//   机制看着实现、实际永不触发（本批为每个被动补齐触发点）。

import { applyEffect } from '../ops/registry.ts';
import type { State } from './state.ts';
import { abilityAvailability, passiveOf } from './passives.ts';
import { bumpCounterOf } from './counters.ts';

/** 发动结果。 */
export interface AbilityResult {
  readonly ok: boolean;
  readonly state: State;
  readonly note: string;
}

/**
 * 发动玩家的身份被动。
 *
 * @param target 需要目标时的目标座位（窃火者偷取）；其余被动忽略。
 *
 * 次数闸门：「每回合 1 次」置 `turn.abilityUsedThisTurn`（回合末清零）；
// 「每场 1 次」（匠师）置 `counters.freeCreates`（本局累计，不清零）。
 */
export function performAbility(state: State, seat: number, target?: number): AbilityResult {
  const avail = abilityAvailability(state, seat);
  if (!avail.usable) {
    return { ok: false, state, note: avail.reason };
  }
  const passive = passiveOf(state, seat);
  if (passive === undefined) {
    return { ok: false, state, note: '本局没有身份被动（旧存档）' };
  }
  let next = state;
  let note = '';
  let perGame = false;
  switch (passive.op) {
    case 'create_card': {
      // 匠师：**免费造物** —— 从造物牌堆取牌加入手牌（规格 §6.5），不消耗灵枢。
      const r = applyEffect({ state: next, actor: seat }, { op: 'create_card', cardId: passive.cardId, target: seat });
      if (!r.ok) { return { ok: false, state, note: r.note ?? '发动失败' }; }
      next = r.state;
      note = '免费造物 ' + passive.cardId;
      perGame = true;
      break;
    }
    case 'peek_deck': {
      // 观星者：查看牌堆顶 N 张（不消耗手牌）⇒ 提前知道险径判定结果。
      const r = applyEffect({ state: next, actor: seat }, { op: 'peek_deck', count: passive.count });
      if (!r.ok) { return { ok: false, state, note: r.note ?? '发动失败' }; }
      next = r.state;
      note = '窥视牌堆顶 ' + String(passive.count) + ' 张';
      break;
    }
    case 'transfer_resource': {
      // 窃火者：**偷取** —— 目标少 1 枚、自己多 1 枚。
      // ⚠️ `transfer_resource` 的语义是「从 actor 转给 target」⇒ 此处**以目标为 actor**
      //   执行反向转移（复用既有 op，不新增算子）。
      if (target === undefined) { return { ok: false, state, note: `偷取{resource}需要选择目标` }; }
      if (target === seat) { return { ok: false, state, note: '不能偷自己' }; }
      const tp = state.players[target];
      if (tp === undefined || !tp.alive) { return { ok: false, state, note: '目标不存在或已出局' }; }
      if (tp.resource < passive.amount) {
        return { ok: false, state, note: `目标{resource}不足（需 ${String(passive.amount)}）` };
      }
      const r = applyEffect({ state: next, actor: target }, { op: 'transfer_resource', amount: passive.amount, target: seat });
      if (!r.ok) { return { ok: false, state, note: r.note ?? '发动失败' }; }
      next = r.state;
      // ⚠️ B61：偷取计入**偷取者**的 `stolenTotal`（规格 §6.4 的 `steal_count` 目标）。
      //   ⚠️ 计价点**不是 op 本身**：`transfer_resource` 的语义是「actor 转给 target」，
      //   窃火者靠**交换 actor/target** 实现「目标 −1、自己 +1」⇒ 只有**被动发动**才是偷取。
      next = bumpCounterOf(next, seat, 'stolenTotal', passive.amount);
      note = `偷取座${String(target)} 的 ${String(passive.amount)} 枚{resource}`;
      break;
    }
    case 'modify_judgement': {
      // 织梦者：改写**自己的**险径判定（消费点在 turn-runner 的 hazard 分支）。
      const r = applyEffect({ state: next, actor: seat }, { op: 'modify_judgement', target: seat });
      if (!r.ok) { return { ok: false, state, note: r.note ?? '发动失败' }; }
      next = r.state;
      note = '改写险径判定为安全';
      break;
    }
    default:
      return { ok: false, state, note: '该被动为自动/常驻型，无需发动' };
  }
  // 次数闸门：本回合已发动（本局累计另计，供统计与「每场 1 次」判定）。
  next = {
    ...next,
    players: next.players.map((p) => (p.seat === seat
      ? {
        ...p,
        turn: { ...p.turn, abilityUsedThisTurn: true },
        counters: {
          ...p.counters,
          abilityUses: (p.counters.abilityUses ?? 0) + 1,
          ...(perGame ? { freeCreates: (p.counters.freeCreates ?? 0) + 1 } : {}),
        },
      }
      : p)),
  };
  // ⚠️ B12：被动日志统一用 `[被动:<op>]` 前缀 ⇒ 模拟器/测试可统计**主动型**被动的触发
  //   （自动型被动在各流程里写同格式日志 ⇒ 统计口径统一）。
  next = {
    ...next,
    log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'passive', message: '[被动:' + passive.op + '] ' + note }],
  };
  return { ok: true, state: next, note };
}
