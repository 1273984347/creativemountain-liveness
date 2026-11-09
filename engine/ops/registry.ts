// 机制原语注册表（规格 §6.4）
//
// 主题包**不允许内联代码**——所有效果以「算子 + 参数」表达，算子在此注册并实现。
// 参数一律为**字面量**，不提供任意表达式求值（不用 eval / Function）。
//
// 关键约束：每个算子返回 `{ ok, state, note? }`——
// **效果因条件不满足而未生效时 `ok=false` 且状态不变**（与 §5.3.4 灵枢不足的语义一致）。

import type { Card, Effect, EffectMap, OpName } from '../types/theme.ts';
import { RESOURCE_CAP } from '../core/resource.ts';
import { rollD6, rollD20 } from '../core/dice.ts';
import { filterMatches } from '../types/card.ts';
import { evaluatePredicate } from '../predicates.ts';
import { enterPendingCertification } from '../core/certification.ts';
import { bumpCounterOf } from '../core/counters.ts';
import type { State } from '../core/state.ts';
export type { OpContext, OpResult } from './context.ts';
import {
  aliveTarget,
  fail,
  ok,
  withLog,
  withPlayer,
  type OpContext,
  type OpResult,
} from './context.ts';

/**
 * 到达峰顶 → **进入活人认证流程**（规格 §5.1）。
 *
 * ⚠️ B9 修正：此前移动到峰顶只设了 `pendingCert = true`，
 *   **没有调用 `enterPendingCertification`** ⇒ `certification.pending` 始终为空
 *   ⇒ 认证流程永不启动 ⇒ 没有任何人能封顶 ⇒ 兜底触发率 100%（实测）。
 *   单测没抓到，是因为它们直接调 `enterPendingCertification` 测流程，
 *   而没有测「移动到峰顶是否真的进入流程」——这是**集成缺口**。
 */
function enterPeak(state: State, seat: number, ctx: OpContext): State {
  const r = enterPendingCertification(state, seat);
  if (!r.ok) {
    return state;
  }
  return withLog(r.state, ctx, 'peak', `登顶：座位 ${seat} 进入待认证状态`);
}

/** 算子实现表。 */
export type OpHandlers = {
  [K in OpName]: (ctx: OpContext, params: EffectMap[K]) => OpResult;
};

export const OPS: OpHandlers = {
  // ================= 资源（4）=================
  gain_resource: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const cur = ctx.state.players[t.seat]?.resource ?? 0;
    const next = Math.min(RESOURCE_CAP, cur + p.amount);
    const state = withPlayer(ctx.state, t.seat, { resource: next });
    return ok(withLog(state, ctx, 'gain_resource', `灵枢 +${next - cur}`));
  },
  spend_resource: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const cur = ctx.state.players[t.seat]?.resource ?? 0;
    if (cur < p.amount) {
      return fail(ctx.state, `灵枢不足：需 ${p.amount}，现有 ${cur}`);
    }
    const state = withPlayer(ctx.state, t.seat, { resource: cur - p.amount });
    return ok(withLog(state, ctx, 'spend_resource', `灵枢 -${p.amount}`));
  },
  transfer_resource: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    if (p.target === ctx.actor) { return fail(ctx.state, '不能向自己转移资源'); }
    const src = aliveTarget(ctx, ctx.actor);
    const dst = aliveTarget(ctx, p.target);
    if (!src.ok) { return fail(ctx.state, src.note); }
    if (!dst.ok) { return fail(ctx.state, dst.note); }
    const from = ctx.state.players[src.seat]?.resource ?? 0;
    if (from < p.amount) {
      return fail(ctx.state, `灵枢不足：需 ${p.amount}，现有 ${from}`);
    }
    const to = ctx.state.players[dst.seat]?.resource ?? 0;
    let state = withPlayer(ctx.state, src.seat, { resource: from - p.amount });
    state = withPlayer(state, dst.seat, { resource: Math.min(RESOURCE_CAP, to + p.amount) });
    return ok(withLog(state, ctx, 'transfer_resource', `转移灵枢 ${p.amount}`));
  },
  set_resource: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const next = Math.max(0, Math.min(RESOURCE_CAP, p.amount));
    const state = withPlayer(ctx.state, t.seat, { resource: next });
    return ok(withLog(state, ctx, 'set_resource', `灵枢设为 ${next}`));
  },

  // ================= 牌（9）=================
  draw_cards: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    let deck = [...ctx.state.decks.deck];
    let discard = [...ctx.state.decks.discard];
    const drawn: Card[] = [];
    for (let i = 0; i < p.count; i++) {
      if (deck.length === 0) {
        if (discard.length === 0) { break; }
        deck = discard;
        discard = [];
      }
      const c = deck.shift();
      if (c === undefined) { break; }
      drawn.push(c);
    }
    if (drawn.length === 0) { return fail(ctx.state, '无可抽之牌（牌库与弃牌堆皆空）'); }
    const hand = ctx.state.players[t.seat]?.hand ?? [];
    let state = withPlayer(ctx.state, t.seat, { hand: [...hand, ...drawn] });
    // ⚠️ B61：抽到的牌计入**获得者的** `cardsDrawn`（规格 §6.4 的 `draw_count` 目标）。
    //   ⚠️ 抽牌有**两个独立实现**（本 op 与 `core/hand.ts` 的 `drawCards`，失败语义不同：
    //   本 op 牌库空 ⇒ `ok=false`、hand.ts 静默跳过）⇒ **两处都要计数**，口径相同（实到张数）。
    state = bumpCounterOf(state, t.seat, 'cardsDrawn', drawn.length);
    state = { ...state, decks: { ...state.decks, deck, discard } };
    return ok(withLog(state, ctx, 'draw_cards', `抽 ${drawn.length} 张牌`));
  },
  gain_card: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const count = p.count ?? 1;
    if (count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const deck = [...ctx.state.decks.deck];
    const chosen: Card[] = [];
    for (let i = 0; i < count; i++) {
      const idx = deck.findIndex((c) => filterMatches(p.filter, c));
      if (idx < 0) { break; }
      const c = deck.splice(idx, 1)[0];
      if (c !== undefined) { chosen.push(c); }
    }
    if (chosen.length === 0) { return fail(ctx.state, '牌库中无符合条件的牌'); }
    const hand = ctx.state.players[t.seat]?.hand ?? [];
    let state = withPlayer(ctx.state, t.seat, { hand: [...hand, ...chosen] });
    state = { ...state, decks: { ...state.decks, deck } };
    return ok(withLog(state, ctx, 'gain_card', `获得 ${chosen.length} 张指定牌`));
  },
  discard_self: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const me = ctx.state.players[ctx.actor];
    if (me === undefined) { return fail(ctx.state, '使用者不存在'); }
    if (me.hand.length < p.count) { return fail(ctx.state, '手牌不足，无法弃牌'); }
    const dropped = me.hand.slice(0, p.count);
    const state = withPlayer(ctx.state, ctx.actor, { hand: me.hand.slice(p.count) });
    const s2 = { ...state, decks: { ...state.decks, discard: [...state.decks.discard, ...dropped] } };
    return ok(withLog(s2, ctx, 'discard_self', `弃 ${p.count} 张牌`));
  },
  discard_opponent: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    if (p.target === ctx.actor) { return fail(ctx.state, '不能对自己使用此算子'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const target = ctx.state.players[t.seat];
    if (target === undefined) { return fail(ctx.state, '目标不存在'); }
    if (target.hand.length < p.count) { return fail(ctx.state, '目标手牌不足'); }
    const dropped = target.hand.slice(0, p.count);
    const state = withPlayer(ctx.state, t.seat, { hand: target.hand.slice(p.count) });
    const s2 = { ...state, decks: { ...state.decks, discard: [...state.decks.discard, ...dropped] } };
    return ok(withLog(s2, ctx, 'discard_opponent', `使座位 ${t.seat} 弃 ${p.count} 张牌`));
  },
  exhaust_card: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const target = ctx.state.players[t.seat];
    if (target === undefined) { return fail(ctx.state, '目标不存在'); }
    const idx = target.hand.findIndex((c) => c.id === p.cardId);
    if (idx < 0) { return fail(ctx.state, `手牌中无 ${p.cardId}`); }
    const card = target.hand[idx];
    if (card === undefined) { return fail(ctx.state, '手牌中无该牌'); }
    const state = withPlayer(ctx.state, t.seat, { hand: target.hand.filter((c) => c.id !== p.cardId) });
    const s2 = { ...state, decks: { ...state.decks, exhausted: [...state.decks.exhausted, card] } };
    return ok(withLog(s2, ctx, 'exhaust_card', `耗尽 ${p.cardId}`));
  },
  peek_deck: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const top = ctx.state.decks.deck.slice(0, p.count);
    if (top.length === 0) { return fail(ctx.state, '牌库为空'); }
    // ⚠️ B12：把窥视到的**牌面**记进使用者 flags ⇒ UI 能显示牌名/颜色
    //   （原先只回牌 id，玩家看不到颜色 ⇒ 「提前知道险径结果」这条设计意图落不了地）。
    const actor = ctx.state.players[ctx.actor];
    let state = ctx.state;
    if (actor !== undefined) {
      const peeked = top.map((c) => ({ id: c.id, name: c.name, color: c.color, rank: c.rank }));
      state = withPlayer(state, ctx.actor, { flags: { ...actor.flags, peeked } });
    }
    state = withLog(state, ctx, 'peek_deck', `查看牌库顶 ${top.length} 张`);
    return { ok: true, state, note: top.map((c) => c.id).join(',') };
  },
  add_to_deck: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const target = ctx.state.players[t.seat];
    if (target === undefined) { return fail(ctx.state, '目标不存在'); }
    const added: Card[] = [];
    for (const id of p.cardIds) {
      const c = target.hand.find((x) => x.id === id);
      if (c !== undefined) { added.push(c); }
    }
    if (added.length === 0) { return fail(ctx.state, '没有可加入的牌'); }
    const state = withPlayer(ctx.state, t.seat, {
      hand: target.hand.filter((c) => !p.cardIds.includes(c.id)),
    });
    const s2 = { ...state, decks: { ...state.decks, deck: [...added, ...state.decks.deck] } };
    return ok(withLog(s2, ctx, 'add_to_deck', `加入 ${added.length} 张牌到牌库顶`));
  },
  remove_from_deck: (ctx, p) => {
    const deck = [...ctx.state.decks.deck];
    let removed = 0;
    for (const id of p.cardIds) {
      const idx = deck.findIndex((c) => c.id === id);
      if (idx >= 0) { deck.splice(idx, 1); removed += 1; }
    }
    if (removed === 0) { return fail(ctx.state, '牌库中无指定牌'); }
    const state = { ...ctx.state, decks: { ...ctx.state.decks, deck } };
    return ok(withLog(state, ctx, 'remove_from_deck', `从牌库移除 ${removed} 张`));
  },
  swap_deck_top: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const deck = [...ctx.state.decks.deck];
    const discard = [...ctx.state.decks.discard];
    const n = Math.min(p.count, deck.length, discard.length);
    if (n === 0) { return fail(ctx.state, '无可交换的牌'); }
    const top = deck.splice(0, n);
    const back = discard.splice(0, n);
    const state = {
      ...ctx.state,
      decks: { ...ctx.state.decks, deck: [...back, ...deck], discard: [...top, ...discard] },
    };
    return ok(withLog(state, ctx, 'swap_deck_top', `交换牌库顶 ${n} 张`));
  },
  // ================= 位移（7）=================
  move_forward: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    if (pl.pendingCert) { return fail(ctx.state, '待认证者不能主动移动（规格 §5.1 锁定）'); }
    const peak = ctx.state.board.peakIndex;
    const bonus = pl.turn.moveBonus;
    const raw = pl.position + p.amount + bonus;
    // 越过峰顶 → clamp 在峰顶（到达即停，规格 §3.1 位移结算语义）
    const next = Math.min(peak, raw);
    const clamped = raw > peak;
    let state = withPlayer(ctx.state, t.seat, {
      position: next,
      turn: { ...pl.turn, movedThisTurn: true, moveBonus: 0 },
    });
    state = withLog(state, ctx, 'move_forward', `前进 ${next - pl.position} 格${clamped ? '（到达峰顶）' : ''}`);
    if (next === peak) {
      state = enterPeak(state, t.seat, ctx);
    }
    return ok(state);
  },
  move_backward: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    if (p.target === ctx.actor) { return fail(ctx.state, '不能对自己使用此算子'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const next = Math.max(1, pl.position - p.amount);
    let state = withPlayer(ctx.state, t.seat, { position: next });
    // 离开峰顶 → 待认证状态终止（规格 §5.1）
    if (pl.pendingCert && next !== ctx.state.board.peakIndex) {
      state = withPlayer(state, t.seat, { pendingCert: false });
    }
    return ok(withLog(state, ctx, 'move_backward', `后退 ${pl.position - next} 格`));
  },
  move_to_tile: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const tile = ctx.state.board.tiles.find((x) => x.index === p.tileIndex);
    if (tile === undefined) { return fail(ctx.state, `无此格：${p.tileIndex}`); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    if (pl.pendingCert) { return fail(ctx.state, '待认证者不能主动移动（规格 §5.1 锁定）'); }
    let state = withPlayer(ctx.state, t.seat, {
      position: tile.index,
      turn: { ...pl.turn, movedThisTurn: true },
    });
    if (tile.index === ctx.state.board.peakIndex) {
      state = enterPeak(state, t.seat, ctx);
    }
    return ok(withLog(state, ctx, 'move_to_tile', `移动到第 ${tile.index} 格`));
  },
  move_relative_to: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const anchor = ctx.state.players[t.seat];
    const me = ctx.state.players[ctx.actor];
    if (anchor === undefined || me === undefined) { return fail(ctx.state, '玩家不存在'); }
    const peak = ctx.state.board.peakIndex;
    // 远离 = 沿山道往后（盘点文档 §4 裁定）
    const next = Math.max(1, Math.min(peak, anchor.position - p.amount));
    const state = withPlayer(ctx.state, ctx.actor, { position: next });
    return ok(withLog(state, ctx, 'move_relative_to', `相对座位 ${t.seat} 移动到第 ${next} 格`));
  },
  swap_position: (ctx, p) => {
    if (p.target === ctx.actor) { return fail(ctx.state, '不能与自己交换位置'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const me = ctx.state.players[ctx.actor];
    const other = ctx.state.players[t.seat];
    if (me === undefined || other === undefined) { return fail(ctx.state, '玩家不存在'); }
    if (me.pendingCert) { return fail(ctx.state, '待认证者不能主动移动（规格 §5.1 锁定）'); }
    let state = withPlayer(ctx.state, ctx.actor, { position: other.position });
    state = withPlayer(state, t.seat, { position: me.position });
    return ok(withLog(state, ctx, 'swap_position', `与座位 ${t.seat} 交换位置`));
  },
  teleport: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const tile = ctx.state.board.tiles.find((x) => x.index === p.tileIndex);
    if (tile === undefined) { return fail(ctx.state, `无此格：${p.tileIndex}`); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    if (pl.pendingCert) { return fail(ctx.state, '待认证者不能主动移动（规格 §5.1 锁定）'); }
    let state = withPlayer(ctx.state, t.seat, {
      position: tile.index,
      turn: { ...pl.turn, movedThisTurn: true },
    });
    if (tile.index === ctx.state.board.peakIndex) {
      state = enterPeak(state, t.seat, ctx);
    }
    return ok(withLog(state, ctx, 'teleport', `传送到第 ${tile.index} 格`));
  },
  /** G1：掷 faces 面骰并前进该点数（步数来自运行时骰子结果） */
  move_by_dice: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    if (pl.pendingCert) { return fail(ctx.state, '待认证者不能主动移动（规格 §5.1 锁定）'); }
    // 额外掷骰机会：多掷一次移动骰，**取最高点**（B10 裁定）。
    // ⚠️ 机会在**行棋时消费**（用完即清零），因此「本回合获得」的卡牌
    //   实际在**下次行棋**时兑现 —— 卡面文案与规格 §3.1 已同步改为「下次行棋时」。
    const extra = Math.max(0, ctx.state.extraRolls);
    const rolls: number[] = [rollD6(ctx.state.rng)];
    for (let i = 0; i < extra; i++) { rolls.push(rollD6(ctx.state.rng)); }
    const roll = Math.max(...rolls);
    const peak = ctx.state.board.peakIndex;
    const raw = pl.position + roll + pl.turn.moveBonus;
    const next = Math.min(peak, raw);
    let state = withPlayer(ctx.state, t.seat, {
      position: next,
      turn: { ...pl.turn, movedThisTurn: true, moveBonus: 0 },
    });
    state = { ...state, lastDice: roll };
    if (extra > 0) {
      // 机会用完即清零（不累积到下一回合）
      state = { ...state, extraRolls: 0 };
    }
    const diceNote = extra > 0
      ? `掷骰 ${rolls.join('/')}（取最高 ${roll}）`
      : `掷骰 ${roll}`;
    state = withLog(state, ctx, 'move_by_dice', `${diceNote}，前进 ${next - pl.position} 格`, roll);
    if (next === peak) {
      state = enterPeak(state, t.seat, ctx);
    }
    return ok(state);
  },
  // ================= 骰子（5）=================
  extra_roll: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const state = { ...ctx.state, extraRolls: ctx.state.extraRolls + p.count };
    return ok(withLog(state, ctx, 'extra_roll', `额外掷骰次数 +${p.count}`));
  },
  reroll: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const roll = rollD20(ctx.state.rng);
    const state = { ...ctx.state, lastDice: roll };
    return ok(withLog(state, ctx, 'reroll', `重掷得 ${roll}`, roll));
  },
  keep_die: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const dice = [ctx.state.lastDice, ...ctx.state.keptDice].slice(0, p.count);
    const state = { ...ctx.state, keptDice: dice };
    return ok(withLog(state, ctx, 'keep_die', `保留骰子 ${dice.join(',')}`));
  },
  set_die_result: (ctx, p) => {
    if (p.value < 1) { return fail(ctx.state, 'value 必须为正'); }
    const state = { ...ctx.state, lastDice: p.value };
    return ok(withLog(state, ctx, 'set_die_result', `骰子点数设为 ${p.value}`, p.value));
  },
  roll_opponent: (ctx, p) => {
    if (p.target === ctx.actor) { return fail(ctx.state, '不能对自己使用此算子'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const roll = rollD20(ctx.state.rng);
    const state = { ...ctx.state, lastDice: roll };
    return ok(withLog(state, ctx, 'roll_opponent', `使座位 ${t.seat} 掷骰得 ${roll}`, roll));
  },

  // ================= 状态（11）=================
  shield: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, { shield: pl.shield + p.amount });
    return ok(withLog(state, ctx, 'shield', `护盾 +${p.amount}`));
  },
  poison: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      statuses: { ...pl.statuses, poison: (pl.statuses.poison ?? 0) + p.amount },
    });
    return ok(withLog(state, ctx, 'poison', `中毒 +${p.amount}`));
  },
  slow: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      statuses: { ...pl.statuses, slow: (pl.statuses.slow ?? 0) + p.amount },
    });
    return ok(withLog(state, ctx, 'slow', `减速 +${p.amount}`));
  },
  silence: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      statuses: { ...pl.statuses, silence: (pl.statuses.silence ?? 0) + p.amount },
    });
    return ok(withLog(state, ctx, 'silence', `封口 ${p.amount} 回合`));
  },
  skip_turn: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      statuses: { ...pl.statuses, skip_turn: (pl.statuses.skip_turn ?? 0) + p.amount },
    });
    return ok(withLog(state, ctx, 'skip_turn', `跳过 ${p.amount} 回合`));
  },
  immunity: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      flags: { ...pl.flags, [`immunity_${p.status}`]: (pl.flags[`immunity_${p.status}`] as number | undefined ?? 0) + p.amount },
    });
    return ok(withLog(state, ctx, 'immunity', `免疫 ${p.status} ${p.amount} 回合`));
  },
  double_next_vote: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const state = withPlayer(ctx.state, t.seat, { flags: { ...(ctx.state.players[t.seat]?.flags ?? {}), doubleVote: true } });
    return ok(withLog(state, ctx, 'double_next_vote', '下一票翻倍'));
  },
  extra_signatures_required: (ctx, p) => {
    if (p.amount === 0) { return fail(ctx.state, 'amount 不能为 0'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const state = { ...ctx.state, extraSignaturesRequired: ctx.state.extraSignaturesRequired + p.amount };
    return ok(withLog(state, ctx, 'extra_signatures_required', `所需签印 +${p.amount}`));
  },
  set_phase: (ctx, p) => {
    const state = { ...ctx.state, phaseValue: p.value };
    return ok(withLog(state, ctx, 'set_phase', `阶段设为 ${p.value}`));
  },
  set_flag: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, {
      flags: { ...pl.flags, [p.flag]: p.value ?? true },
    });
    return ok(withLog(state, ctx, 'set_flag', `标记 ${p.flag}`));
  },
  clear_flag: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const flags = { ...pl.flags };
    delete flags[p.flag];
    const state = withPlayer(ctx.state, t.seat, { flags });
    return ok(withLog(state, ctx, 'clear_flag', `清除标记 ${p.flag}`));
  },
  // ================= 战斗（4）=================
  damage: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    if (p.target === ctx.actor) { return fail(ctx.state, '不能对自己使用此算子'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    // 先扣护盾再扣体力（盘点文档 §7 裁定）
    const absorbed = Math.min(pl.shield, p.amount);
    const rest = p.amount - absorbed;
    const hp = Math.max(0, pl.hp - rest);
    let state = withPlayer(ctx.state, t.seat, { shield: pl.shield - absorbed, hp });
    state = withLog(state, ctx, 'damage', `对座位 ${t.seat} 造成 ${p.amount} 伤害`);
    if (hp === 0) {
      state = withPlayer(state, t.seat, { alive: false });
      state = withLog(state, ctx, 'damage', `座位 ${t.seat} 体力归零`);
    }
    return ok(state);
  },
  heal: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const hp = Math.min(pl.hpMax, pl.hp + p.amount);
    const state = withPlayer(ctx.state, t.seat, { hp });
    return ok(withLog(state, ctx, 'heal', `恢复 ${hp - pl.hp} 点体力`));
  },
  /** 对峙（规格 §3.3）：红 > 黑 → 同色比 rank（A=14 最大）→ 全同平局。 */
  compare_cards: (ctx, p) => {
    if (p.target === ctx.actor) { return fail(ctx.state, '不能与自己对峙'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const me = ctx.state.players[ctx.actor];
    const other = ctx.state.players[t.seat];
    if (me === undefined || other === undefined) { return fail(ctx.state, '玩家不存在'); }
    const myCard = me.hand.find((c) => c.id === p.cardId);
    if (myCard === undefined) { return fail(ctx.state, `手牌中无 ${p.cardId}`); }
    const theirCard = other.hand[0];
    if (theirCard === undefined) {
      // 对方空手 → 自动落败：被推后 1 格，不抽牌
      const state = withPlayer(ctx.state, t.seat, { position: Math.max(1, other.position - 1) });
      return ok(withLog(state, ctx, 'compare_cards', `座位 ${t.seat} 手牌为空，自动落败`));
    }
    const colorRank = (c: Card): number => (c.color === 'red' ? 1 : 0);
    const cCmp = colorRank(myCard) - colorRank(theirCard);
    let state = ctx.state;
    let message: string;
    if (cCmp > 0) {
      state = withPlayer(state, t.seat, { position: Math.max(1, other.position - 1) });
      const hand = other.hand.filter((c) => c.id !== theirCard.id);
      state = withPlayer(state, t.seat, { hand });
      state = withPlayer(state, ctx.actor, { hand: [...(state.players[ctx.actor]?.hand ?? []), theirCard] });
      message = `颜色胜出，座位 ${t.seat} 后退 1 格`;
    } else if (cCmp < 0) {
      const meNow = state.players[ctx.actor];
      if (meNow !== undefined) {
        state = withPlayer(state, ctx.actor, { position: Math.max(1, meNow.position - 1) });
        const hand = meNow.hand.filter((c) => c.id !== myCard.id);
        state = withPlayer(state, ctx.actor, { hand });
      }
      const otherNow = state.players[t.seat];
      if (otherNow !== undefined) {
        state = withPlayer(state, t.seat, { hand: [...otherNow.hand, myCard] });
      }
      message = `颜色落败，本方后退 1 格`;
    } else {
      const rCmp = myCard.rank - theirCard.rank;
      if (rCmp > 0) {
        state = withPlayer(state, t.seat, { position: Math.max(1, other.position - 1) });
        state = withPlayer(state, ctx.actor, { hand: [...(state.players[ctx.actor]?.hand ?? []), theirCard] });
        message = `点数胜出（rank ${myCard.rank} > ${theirCard.rank}），座位 ${t.seat} 后退 1 格`;
      } else if (rCmp < 0) {
        const meNow = state.players[ctx.actor];
        if (meNow !== undefined) {
          state = withPlayer(state, ctx.actor, { position: Math.max(1, meNow.position - 1) });
          state = withPlayer(state, ctx.actor, { hand: meNow.hand.filter((c) => c.id !== myCard.id) });
        }
        const otherNow = state.players[t.seat];
        if (otherNow !== undefined) {
          state = withPlayer(state, t.seat, { hand: [...otherNow.hand, myCard] });
        }
        message = `点数落败（rank ${myCard.rank} < ${theirCard.rank}），本方后退 1 格`;
      } else {
        // 平局：均不后退，各弃 1 张
        const meNow = state.players[ctx.actor];
        const otherNow = state.players[t.seat];
        if (meNow !== undefined) {
          state = withPlayer(state, ctx.actor, { hand: meNow.hand.slice(1) });
        }
        if (otherNow !== undefined) {
          state = withPlayer(state, t.seat, { hand: otherNow.hand.slice(1) });
        }
        message = '平局：双方均不后退，各弃 1 张';
      }
    }
    return ok(withLog(state, ctx, 'compare_cards', message));
  },
  disarm: (ctx, p) => {
    if (p.target === ctx.actor) { return fail(ctx.state, '不能对自己使用此算子'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    if (pl.equipment.length === 0) { return fail(ctx.state, '目标无装备'); }
    const dropped = pl.equipment[0];
    if (dropped === undefined) { return fail(ctx.state, '目标无装备'); }
    const state = withPlayer(ctx.state, t.seat, { equipment: pl.equipment.slice(1) });
    const s2 = { ...state, decks: { ...state.decks, discard: [...state.decks.discard, dropped] } };
    return ok(withLog(s2, ctx, 'disarm', `弃置座位 ${t.seat} 的装备`));
  },

  // ================= 投票（4）=================
  vote_modifier: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const cur = (pl.flags.voteModifier as number | undefined) ?? 0;
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, voteModifier: cur + p.amount } });
    return ok(withLog(state, ctx, 'vote_modifier', `票数修正 ${p.amount >= 0 ? '+' : ''}${p.amount}`));
  },
  extra_vote: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const cur = (pl.flags.extraVotes as number | undefined) ?? 0;
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, extraVotes: cur + p.amount } });
    return ok(withLog(state, ctx, 'extra_vote', `额外投票 +${p.amount}`));
  },
  cancel_vote: (ctx, p) => {
    if (p.target === ctx.actor) { return fail(ctx.state, '不能取消自己的投票'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, voteCancelled: true } });
    return ok(withLog(state, ctx, 'cancel_vote', `取消座位 ${t.seat} 的投票`));
  },
  /** 凭证：本次山议免于被放逐（公开信息，使用后全场可见） */
  exempt_from_vote: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, exemptFromVote: true } });
    return ok(withLog(state, ctx, 'exempt_from_vote', `座位 ${t.seat} 凭证生效`));
  },
  // ================= 认证（4）=================
  certify_extra_signer: (ctx, p) => {
    if (p.amount === 0) { return fail(ctx.state, 'amount 不能为 0'); }
    const state = { ...ctx.state, extraSignaturesRequired: ctx.state.extraSignaturesRequired + p.amount };
    return ok(withLog(state, ctx, 'certify_extra_signer', `所需签印 +${p.amount}`));
  },
  certify_free_pass: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, certifyFreePass: true } });
    return ok(withLog(state, ctx, 'certify_free_pass', `座位 ${t.seat} 本次认证免于被质疑`));
  },
  certify_extra_round: (ctx, p) => {
    if (p.amount <= 0) { return fail(ctx.state, 'amount 必须为正'); }
    // §5.2：认证最多 2 轮，不可超过
    const pl = ctx.state.players[ctx.actor];
    const used = (pl?.flags.certifyRounds as number | undefined) ?? 0;
    if (used + p.amount > 2) {
      return fail(ctx.state, `认证轮次上限 2 轮（已用 ${used}，再加 ${p.amount} 超限）`);
    }
    const state = withPlayer(ctx.state, ctx.actor, {
      flags: { ...(pl?.flags ?? {}), certifyRounds: used + p.amount },
    });
    return ok(withLog(state, ctx, 'certify_extra_round', `认证轮次 +${p.amount}`));
  },
  certify_forbid_challenge: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, forbidChallenge: true } });
    return ok(withLog(state, ctx, 'certify_forbid_challenge', `座位 ${t.seat} 本次认证不可被质疑`));
  },

  // ================= 阵营（1）=================
  /** G7：source=manual 消耗「每局限 1 次」名额；source=command（指令 20）不消耗。 */
  spirit_wheel: (ctx, p) => {
    const source = p.source ?? 'manual';
    if (source === 'manual' && ctx.state.wheelUsed >= 1) {
      return fail(ctx.state, '阵营轮本局已用过（每局限 1 次）');
    }
    const state = source === 'manual'
      ? { ...ctx.state, wheelUsed: ctx.state.wheelUsed + 1 }
      : ctx.state;
    return ok(withLog(state, ctx, 'spirit_wheel', `掷阵营轮（${source}）`));
  },

  // ================= 棋盘（1）=================
  place_barrier: (ctx, p) => {
    const tile = ctx.state.board.tiles.find((x) => x.index === p.tileIndex);
    if (tile === undefined) { return fail(ctx.state, `无此格：${p.tileIndex}`); }
    if (tile.barrier === true) { return fail(ctx.state, '该格已有封路印'); }
    const tiles = ctx.state.board.tiles.map((x) => (x.index === p.tileIndex ? { ...x, barrier: true } : x));
    const state = { ...ctx.state, board: { ...ctx.state.board, tiles } };
    return ok(withLog(state, ctx, 'place_barrier', `在第 ${p.tileIndex} 格放置封路印`));
  },

  // ================= 关隘（试炼失败 → 本关改为付费）=================
  /**
   * 关隘试炼失败 ⇒ **本关改为付费**（规格 §3.5，B19-b）。
   *
   * ⚠️ 状态落在**使用者自己的 flags**（`gate_pay_<格号>`）—— 语义是「玩家 × 这座关隘」
   *   ⇒ 无需改 Tile / IR 契约（§6.2、§6.7.1 都不动）。
   *   ⚠️ `tileIndex` 缺省 = 使用者**当前所在格**：试炼牌可能被多座关隘引用，
   *   写死格号会把主题包绑死在某一张棋盘上。
   */
  gate_fallback_pay: (ctx, p) => {
    const pl = ctx.state.players[ctx.actor];
    if (pl === undefined) { return fail(ctx.state, '玩家不存在'); }
    const idx = p.tileIndex ?? pl.position;
    const tile = ctx.state.board.tiles.find((x) => x.index === idx);
    if (tile === undefined) { return fail(ctx.state, `无此格：${idx}`); }
    if (tile.kind !== 'gate') { return fail(ctx.state, '当前不是关隘格'); }
    const state = withPlayer(ctx.state, ctx.actor, { flags: { ...pl.flags, [`gate_pay_${idx}`]: true } });
    return ok(withLog(state, ctx, 'gate_fallback_pay', `本关改为付费（${String(idx)} 号关隘）`));
  },

  // ================= 判定与装备（3）=================
  modify_judgement: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    let state = withPlayer(ctx.state, t.seat, { flags: { ...pl.flags, judgementModified: true } });
    // ⚠️ B61：改判计入**被改判者**的 `rerollCount`（规格 §6.4 的 `reroll_count` 目标，
    //   达成条件用词是「累计**改判**次数」；与 `reroll`（重掷骰子）语义不同 ⇒ 以用词为准）。
    state = bumpCounterOf(state, t.seat, 'rerollCount');
    return ok(withLog(state, ctx, 'modify_judgement', `座位 ${t.seat} 的判定被改写`));
  },
  /** 造物：从**独立造物牌堆**取牌加入手牌——**不是凭空生成**（规格 §6.5）。 */
  create_card: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const creation = [...ctx.state.decks.creation];
    const idx = creation.findIndex((c) => c.id === p.cardId);
    if (idx < 0) { return fail(ctx.state, `造物牌堆中无 ${p.cardId}`); }
    const card = creation[idx];
    if (card === undefined) { return fail(ctx.state, '造物牌不存在'); }
    creation.splice(idx, 1);
    const hand = ctx.state.players[t.seat]?.hand ?? [];
    let state = withPlayer(ctx.state, t.seat, { hand: [...hand, card] });
    state = { ...state, decks: { ...state.decks, creation } };
    return ok(withLog(state, ctx, 'create_card', `造物 ${p.cardId}`));
  },
  /** 装备：从手牌移入装备区——**不占手牌上限、公开可见、V1 无被动效果**。 */
  equip_card: (ctx, p) => {
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    const pl = ctx.state.players[t.seat];
    if (pl === undefined) { return fail(ctx.state, '目标不存在'); }
    const idx = pl.hand.findIndex((c) => c.id === p.cardId);
    if (idx < 0) { return fail(ctx.state, `手牌中无 ${p.cardId}`); }
    const card = pl.hand[idx];
    if (card === undefined) { return fail(ctx.state, '牌不存在'); }
    const hand = pl.hand.filter((c) => c.id !== p.cardId);
    const equipment = [...pl.equipment, card];
    const state = withPlayer(ctx.state, t.seat, { hand, equipment });
    return ok(withLog(state, ctx, 'equip_card', `装备 ${p.cardId}`));
  },
  // ================= 组合（4）=================
  /** 顺序执行多个算子；遇 ok=false **继续执行并记录**（盘点文档 §10 裁定）。 */
  sequence: (ctx, p) => {
    let state = ctx.state;
    for (const e of p.effects) {
      const r = applyEffect({ ...ctx, state }, e);
      state = r.state;
    }
    return ok(state);
  },
  conditional: (ctx, p) => {
    const matched = evaluatePredicate({ state: ctx.state, actor: ctx.actor }, p.pred);
    const branch = matched ? p.then : p.else;
    if (branch === undefined) {
      return fail(ctx.state, `条件不成立且无 else 分支（pred=${p.pred.kind}）`);
    }
    return applyEffect(ctx, branch);
  },
  count: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    let state = ctx.state;
    for (let i = 0; i < p.count; i++) {
      const r = applyEffect({ ...ctx, state }, p.effect);
      state = r.state;
    }
    return ok(state);
  },
  random_from_deck: (ctx, p) => {
    if (p.count <= 0) { return fail(ctx.state, 'count 必须为正'); }
    const t = aliveTarget(ctx, p.target);
    if (!t.ok) { return fail(ctx.state, t.note); }
    let deck = [...ctx.state.decks.deck];
    const chosen: Card[] = [];
    for (let i = 0; i < p.count && deck.length > 0; i++) {
      const idx = Math.floor(ctx.state.rng.next() * deck.length);
      const c = deck[idx];
      if (c === undefined) { break; }
      if (p.filter === undefined || filterMatches(p.filter, c)) {
        deck.splice(idx, 1);
        chosen.push(c);
      }
    }
    if (chosen.length === 0) { return fail(ctx.state, '未抽到符合条件的牌'); }
    const hand = ctx.state.players[t.seat]?.hand ?? [];
    let state = withPlayer(ctx.state, t.seat, { hand: [...hand, ...chosen] });
    state = { ...state, decks: { ...state.decks, deck } };
    return ok(withLog(state, ctx, 'random_from_deck', `随机取 ${chosen.length} 张`));
  },
};

/**
 * 执行一个效果。
 *
 * 实现处参数类型由 `OpHandlers` 的映射类型保证严格；
 * 此处的 cast 是跨联合类型分发的必要收敛点。
 */
export function applyEffect(ctx: OpContext, effect: Effect): OpResult {
  const handler = OPS[effect.op] as (c: OpContext, p: unknown) => OpResult;
  return handler(ctx, effect);
}

/** 执行一个效果并返回新状态（便捷入口）。 */
export function applyEffectToState(ctx: OpContext, effect: Effect): State {
  return applyEffect(ctx, effect).state;
}
