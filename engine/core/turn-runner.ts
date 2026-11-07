// 回合编排器（规格 §3.1 回合结构 + §3.3 移动与山道 + §5.6 山议 + §5 认证）
//
// 把 §3.1 的 8 个步骤串成可驱动的流程：
//   1 天机 → 2 行动 → 3 结算 → 4 裁牌 → 5 经济 → 6 牌库循环 → 7 山议 → 8 认证
//
// **round 末才触发山议与认证**（§3.1 术语定义）；手番内只走 1–6。

import { applyEffect } from '../ops/registry.ts';
import { rollD20 } from './dice.ts';
import { nextTurn, advanceRound, currentPlayer, isRoundEnd } from './round.ts';
import { cardNeedsTarget } from './targeting.ts';
import { passiveOf } from './passives.ts';
import { drawCards, discardDownToLimit } from './hand.ts';
import { gainResource } from './resource.ts';
import { openCouncil, resolveCouncil, shouldHoldCouncil } from './council.ts';
import { advanceCertificationRound, enterPendingCertification } from './certification.ts';
import { resolveVictory } from './victory.ts';
import type { RuleMode } from '../scales.ts';
import type { Effect } from '../types/theme.ts';
import type { State } from './state.ts';

/** 流程运行结果。 */
export interface StepResult {
  readonly state: State;
  readonly note?: string;
}

/** 地形效果（§3.4）：**只在停留（终点）时触发**。 */
function resolveTile(state: State, seat: number): State {
  const player = state.players[seat];
  if (player === undefined) { return state; }
  const tile = state.board.tiles.find((t) => t.index === player.position);
  if (tile === undefined) { return state; }
  switch (tile.kind) {
    case 'boon': {
      let next = drawCards(state, seat, 2);
      next = gainResource(next, seat, 1);
      return next;
    }
    case 'hazard': {
      // 翻开牌堆顶 1 张判色（§3.4）：红安全，黑扣体力并失去本回合剩余行动
      const top = state.decks.deck[0];
      if (top === undefined) { return state; }
      // ⚠️ B12：织梦者「改写自己的险径判定为安全」（自动消费点，§4.1）——
      //   标记在发动时挂上、这里消费（**无论牌色都消费**，否则标记会无限留存）。
      const self = state.players[seat];
      if (self?.flags.judgementModified === true) {
        return {
          ...state,
          players: state.players.map((p) => (p.seat === seat
            ? { ...p, flags: { ...p.flags, judgementModified: false } }
            : p)),
          log: [...state.log, {
            round: state.round, turnIndex: state.turnIndex, actor: seat, kind: 'passive',
            message: '[被动:modify_judgement] 织梦者改写了险径判定：安全通过',
          }],
        };
      }
      if (top.color === 'red') { return state; }
      const players = state.players.map((p) =>
        p.seat === seat ? { ...p, hp: Math.max(0, p.hp - 1) } : p,
      );
      return { ...state, players, decks: { ...state.decks, deck: state.decks.deck.slice(1) } };
    }
    case 'peak': {
      if (player.pendingCert) { return state; }
      const r = enterPendingCertification(state, seat);
      return r.ok ? r.state : state;
    }
    default:
      return state;
  }
}
/**
 * 开局：发牌已在 createInitialState 完成；此处只补开局天机与首回合准备。
 */
export function startGame(state: State): State {
  return state;
}

/**
 * 掷 20 面指令骰执行一条指令（§3.2 「问天」）。
 *
 * 指令表是**主题无关的通用表**（规格 §3.2）；主题包可覆盖个别条目。
 */
export const INSTRUCTION_TABLE: readonly { readonly face: number; readonly text: string }[] = [
  { face: 1, text: '抽 1 张牌' },
  { face: 2, text: '灵枢 +1' },
  { face: 3, text: '抽 2 张牌' },
  { face: 4, text: '灵枢 -1（给自己）' },
  { face: 5, text: '掷 6 面移动骰并按点数前进' },
  { face: 6, text: '前进 2 格' },
  { face: 7, text: '抽 1 张牌 + 灵枢 +1' },
  { face: 8, text: '弃 1 张牌抽 2 张' },
  { face: 9, text: '前进 1 格并抽 1 张牌' },
  { face: 10, text: '全员弃 1 张牌' },
  { face: 11, text: '指定一名玩家弃 1 张牌' },
  { face: 12, text: '指定一名玩家后退 1 格' },
  { face: 13, text: '获得 1 张指定类型手牌' },
  { face: 14, text: '立即再掷一次 20 面指令骰并执行（不可再连锁）' },
  { face: 15, text: '免疫本回合的「封口」' },
  { face: 16, text: '与一名玩家交换手牌各 1 张' },
  { face: 17, text: '本回合移动 +2 格' },
  { face: 18, text: '获得 1 枚灵枢（不超上限）' },
  { face: 19, text: '指定一名玩家抽 1 张牌' },
  { face: 20, text: '自由执行一次「阵营轮」效果' },
];

/** 取指令表某面的文本。 */
export function instructionText(face: number): string {
  return INSTRUCTION_TABLE.find((x) => x.face === face)?.text ?? '（无对应指令）';
}
/**
 * 改写效果里的**目标座位**（递归）。
 *
 * ⚠️ 主题包里的攻击牌把目标写成 `target: 0` —— 那只是**占位**，
 *   真实目标由使用者选择。若不覆盖，引擎会照字面打「座位 0」，
 *   等于每张攻击牌都只能打固定的那个人（实测：本地多人下攻击牌永远打座 0）。
 *   故 `performAction` 收到 `payload.target` 时，把效果树里的目标整体改写。
 */
function retarget(effect: Effect, target: number | undefined): Effect {
  if (target === undefined) {
    return effect;
  }
  if (effect === null || typeof effect !== 'object') {
    return effect;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(effect)) {
    if (k === 'target' && typeof v === 'number') {
      out[k] = target;
    } else if (k === 'effects' && Array.isArray(v)) {
      out[k] = v.map((e) => retarget(e as Effect, target));
    } else if (k === 'then' || k === 'else' || k === 'effect') {
      out[k] = retarget(v as Effect, target);
    } else {
      out[k] = v;
    }
  }
  return out as unknown as Effect;
}

/**
 * 执行一个行动（§3.1 行动阶段三选一：行棋 / 问天 / 行事）。
 *
 * - **行棋**：掷 6 面移动骰并前进（**必须走满，不得少走**）。
 * - **问天**：掷 20 面指令骰并执行对应指令（§3.2）。
 * - **行事**：打出一张手牌或发动能力。
 */
export function performAction(
  state: State,
  seat: number,
  action: 'move' | 'ask' | 'act',
  payload: { readonly cardId?: string; readonly target?: number } = {},
): State {
  const player = state.players[seat];
  if (player === undefined) { return state; }
  let next = state;
  switch (action) {
    case 'move': {
      if (player.pendingCert) { return state; } // §5.1 待认证锁定
      const before = player.position;
      // ⚠️ B12：开拓者「每回合首次移动 +1 格」（自动型被动，§4.1）——
      //   通过 `turn.moveBonus` **叠加**实现：`move_by_dice` 内部
      //   `raw = position + roll + moveBonus` ⇒ bonus 必须在**掷骰前**加上，
      //   否则「恰好够到峰顶」会差一格（事后追加 move_forward 永远晚一步）。
      const passive = passiveOf(state, seat);
      const firstMoveBonus = passive?.op === 'move_forward' && player.turn.movedThisTurn !== true
        ? passive.amount
        : 0;
      if (firstMoveBonus > 0) {
        next = {
          ...next,
          players: next.players.map((p) => (p.seat === seat
            ? { ...p, turn: { ...p.turn, moveBonus: p.turn.moveBonus + firstMoveBonus } }
            : p)),
        };
      }
      // move_by_dice 内部已掷 6 面骰并前进（**必须走满，不得少走**）
      next = applyEffect({ state: next, actor: seat }, { op: 'move_by_dice', faces: 6 }).state;
      if (firstMoveBonus > 0) {
        // ⚠️ B12：被动日志统一用 `[被动:<op>]` 前缀 ⇒ 模拟器/测试可统计**自动型**被动的触发。
        next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'passive', message: '[被动:move_forward] 开拓者：本回合首次移动 +' + String(firstMoveBonus) + ' 格' }] };
      }
      const steps = next.lastDice;
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'move', message: `行棋：掷出 ${steps}，前进至第 ${next.players[seat]?.position ?? before} 格`, diceRoll: steps }] };
      break;
    }
    case 'ask': {
      const face = rollD20(next.rng);
      next = { ...next, lastDice: face };
      next = applyInstruction(next, seat, face);
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'ask', message: `问天：掷出 ${face} —— ${instructionText(face)}`, diceRoll: face }] };
      break;
    }
    case 'act': {
      const cardId = payload.cardId;
      if (cardId === undefined) { return state; }
      const idx = player.hand.findIndex((c) => c.id === cardId);
      const card = player.hand[idx];
      if (card === undefined) { return state; }
      // ⚠️ 需要选择目标却没选 ⇒ **不出牌**（否则主题包的 target 占位 0 会误伤座位 0）
      if (cardNeedsTarget(card) && payload.target === undefined) {
        return state;
      }
      // 打出：移出手牌 → 依次结算效果
      const hand = player.hand.filter((c) => c.id !== cardId);
      next = { ...next, players: next.players.map((p) => (p.seat === seat ? { ...p, hand } : p)) };
      for (const eff of card.effects) {
        next = applyEffect({ state: next, actor: seat, sourceCard: card }, retarget(eff, payload.target)).state;
      }
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'card', message: `行事：打出「${card.name}」` }] };
      break;
    }
  }
  return next;
}

/**
 * 执行一条问天指令（§3.2 指令表）。
 *
 * 指令 14（链式问天）**不可再连锁**：只再掷一次。
 */
function applyInstruction(state: State, seat: number, face: number): State {
  const ctx = { state, actor: seat };
  switch (face) {
    case 1: return applyEffect(ctx, { op: 'draw_cards', count: 1 }).state;
    case 2: return applyEffect(ctx, { op: 'gain_resource', amount: 1 }).state;
    case 3: return applyEffect(ctx, { op: 'draw_cards', count: 2 }).state;
    case 4: return applyEffect(ctx, { op: 'spend_resource', amount: 1 }).state;
    case 5: return applyEffect(ctx, { op: 'move_by_dice', faces: 6 }).state;
    case 6: return applyEffect(ctx, { op: 'move_forward', amount: 2 }).state;
    case 7: return applyEffect(ctx, { op: 'sequence', effects: [ { op: 'draw_cards', count: 1 }, { op: 'gain_resource', amount: 1 } ] }).state;
    case 8: return applyEffect(ctx, { op: 'sequence', effects: [ { op: 'discard_self', count: 1 }, { op: 'draw_cards', count: 2 } ] }).state;
    case 9: return applyEffect(ctx, { op: 'sequence', effects: [ { op: 'move_forward', amount: 1 }, { op: 'draw_cards', count: 1 } ] }).state;
    case 10: return applyEffect(ctx, { op: 'discard_self', count: 1 }).state;
    case 11: return applyEffect(ctx, { op: 'discard_opponent', count: 1, target: 1 }).state;
    case 12: return applyEffect(ctx, { op: 'move_backward', amount: 1, target: 1 }).state;
    case 13: return applyEffect(ctx, { op: 'gain_card', filter: {} }).state;
    case 14: {
      const face2 = rollD20(state.rng);
      const chained = applyInstruction({ ...state, lastDice: face2 }, seat, face2);
      return { ...chained, log: [...chained.log, { round: chained.round, turnIndex: chained.turnIndex, actor: seat, kind: 'ask', message: `链式问天：掷出 ${face2} —— ${instructionText(face2)}`, diceRoll: face2 }] };
    }
    case 15: return applyEffect(ctx, { op: 'immunity', status: 'silence', amount: 1 }).state;
    case 16: return applyEffect(ctx, { op: 'swap_position', target: 1 }).state;
    case 17: return applyEffect(ctx, { op: 'move_forward', amount: 2 }).state;
    case 18: return applyEffect(ctx, { op: 'gain_resource', amount: 1 }).state;
    case 19: return applyEffect(ctx, { op: 'draw_cards', count: 1, target: 1 }).state;
    case 20: return applyEffect(ctx, { op: 'spirit_wheel', source: 'command' }).state;
    default: return state;
  }
}
/**
 * 回合第 1 步：翻开一张天机牌，**对全场生效**（规格 §3.1）。
 *
 * ⚠️ B8 修正：此前 `decks.heaven` 只被写入、**从无消费点**——
 *   天机牌从未被翻开 ⇒ §6.2 的「全局阶段值」(`phaseValue`) 永远是 'day'
 *   ⇒ `phase_is` 判据在真实对局里**不可达**（连同依赖昼夜分岔的标志卡）。
 *
 * 「对全场生效」的实现：把天机牌的效果**对每个存活玩家各执行一次**
 *   —— `draw_cards` / `gain_resource` 等默认作用于使用者，逐人执行即全场各得一份。
 *
 * 牌堆用尽后**循环回收**（用过的天机牌放在 `decks.exhausted`，空了再收回牌堆）：
 *   一局 15–20 回合而天机牌只有 8 张，不回收则后半场没有天机机制。
 */
export function openHeaven(state: State): State {
  let heaven = state.decks.heaven;
  let exhausted = state.decks.exhausted;
  if (heaven.length === 0) {
    const back = exhausted.filter((c) => c.id.startsWith('h_'));
    if (back.length === 0) {
      return state;
    }
    heaven = back;
    exhausted = exhausted.filter((c) => !c.id.startsWith('h_'));
  }
  const card = heaven[0];
  if (card === undefined) {
    return state;
  }
  let next: State = {
    ...state,
    decks: { ...state.decks, heaven: heaven.slice(1), exhausted: [...exhausted, card] },
    log: [
      ...state.log,
      {
        round: state.round,
        turnIndex: state.turnIndex,
        actor: -1,
        kind: 'heaven',
        message: '天机牌翻开：' + card.name + '——' + card.text,
      },
    ],
  };
  // 「对全场生效」：逐人算子对每个存活玩家各执行一次；
  // 全局算子（set_phase）只执行一次，否则日志里会重复 4 条同义记录。
  const alive = next.players.filter((p) => p.alive);
  const globalEffects = card.effects.filter((eff) => eff.op === 'set_phase');
  const perPlayerEffects = card.effects.filter((eff) => eff.op !== 'set_phase');
  const first = alive[0];
  if (first !== undefined) {
    for (const eff of globalEffects) {
      next = applyEffect({ state: next, actor: first.seat, sourceCard: card }, eff).state;
    }
  }
  for (const p of alive) {
    for (const eff of perPlayerEffects) {
      next = applyEffect({ state: next, actor: p.seat, sourceCard: card }, eff).state;
    }
    // 天机牌发的牌立即裁到手牌上限
    // （回合末才裁 ⇒ 中间窗口里手牌超限，实测报「手牌超上限」异常）
    next = discardDownToLimit(next, p.seat);
  }
  return next;
}

/**
 * 完成一个手番的收尾：结算（3）→ 裁牌（4）→ 经济（5）→ 牌库循环（6）。
 *
 * **山议（7）与认证（8）不在这里触发**——它们仅在 round 末执行（§3.1）。
 */
export function finishTurn(state: State, seat: number): State {
  let next = resolveTile(state, seat);
  next = discardDownToLimit(next, seat);
  next = gainResource(next, seat, 1);
  // ⚠️ B12：守夜人「回合结束时获得 1 点护盾」（自动型被动，§4.1）
  const passive = passiveOf(next, seat);
  if (passive?.op === 'shield') {
    next = applyEffect({ state: next, actor: seat }, { op: 'shield', amount: passive.amount, target: seat }).state;
    next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'passive', message: '[被动:shield] 守夜人：回合结束获得 ' + String(passive.amount) + ' 点护盾' }] };
  }
  // 昼夜是**回合内**状态：回合末复位（否则 set_phase 一次就整局都是夜）
  next = { ...next, phaseValue: 'day' };
  return next;
}

/**
 * 推进一个手番（行动 → 收尾 → 手番切换）。
 *
 * 若本手番是 round 的最后一个，则在此触发**山议（7）与认证（8）**，
 * 随后进入下一个 round。
 */
export function advanceTurn(state: State, mode: RuleMode): State {
  const seat = currentPlayer(state);
  if (seat < 0) { return state; }
  let next = finishTurn(state, seat);
  next = nextTurn(next);
  if (!isRoundEnd(next)) {
    return next;
  }
  // ---- round 末：山议（7）----
  if (shouldHoldCouncil(next, mode)) {
    const opened = openCouncil(next);
    if (opened.ok) {
      next = { ...opened.state, council: { ...opened.state.council, resolved: false } };
      // 山议需要玩家投票 → 交由 UI 驱动，这里只做「开启」；
      // 若无存活玩家可投则直接结算。
      const alive = next.players.filter((p) => p.alive).length;
      if (alive < 2) {
        const resolved = resolveCouncil(next);
        if (resolved.ok) { next = resolved.state; }
      }
    }
  }
  // ---- round 末：认证（8）----
  if (next.certification.pending.length > 0) {
    const adv = advanceCertificationRound(next);
    if (adv.ok) { next = adv.state; }
  }
  // ---- 回合末裁牌（规格 §3.1 步骤 4）----
  // 天机牌对**全场**生效 ⇒ 非当前行动者也会收到牌；
  // 手番末只裁当前玩家 ⇒ 别人会累积超限（实测：手牌 15 > 上限 6）。
  // 故回合末再对所有存活玩家裁一次。
  for (const p of next.players) {
    if (p.alive) {
      next = discardDownToLimit(next, p.seat);
    }
  }
  // ---- 跨 round ----
  next = advanceRound(next);
  // **下一回合**的第 1 步：天机（翻开一张天机牌，对全场生效）
  // ⚠️ 必须放在回合末之后 —— 天机若在 finishTurn 之前翻，
  //   其昼夜设定会被同一回合末的昼夜复位立刻清掉（phase_is 仍是死代码）。
  next = openHeaven(next);
  // ---- 终局判定（§5.7 / §5.8）----
  next = resolveVictory(next);
  return next;
}

/**
 * 供 UI 判断「当前是否等待玩家投票」。
 *
 * 山议进行中（未结算）→ 需要投票面板。
 */
export function needsCouncilVote(state: State): boolean {
  return state.council.resolved === false;
}

/**
 * 供 UI 判断「当前是否等待认证动作」。
 *
 * 有待认证者且本轮仍有认证人未行动 → 需要认证面板。
 */
export function needsCertificationAction(state: State): boolean {
  if (state.certification.pending.length === 0) { return false; }
  const c = state.certification;
  return state.players.some((p) =>
    p.alive
    && !c.pending.includes(p.seat)
    && !c.signed.includes(p.seat)
    && !c.challenged.includes(p.seat)
    && !c.abstained.includes(p.seat),
  );
}
