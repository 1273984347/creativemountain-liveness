// 对峙（规格 §3.3，B13 权威实现）。
//
// ⚠️ B13 修正：此前引擎里只有一个**半成品** op `compare_cards` —— **无人调用**
//   ⇒ 对峙至今**不可达**；且语义与规格不符（它把**对手的牌抢过来**，
//   而规格 §3.3 规定「胜者把败者**推后 1 格**，败者**抽 1 张牌**；胜者不获额外收益」）。
//   本模块按规格逐条实现，是对峙的唯一权威路径。
//
// 流程（**双方各自选牌、选完才同时揭晓** —— B13 裁定）：
//   1. 移动落点与对手同格 ⇒ `startDuel` 进入待决对峙；
//   2. 双方各自 `submitDuelCard` 锁定一张手牌（**对对方不可见**）；
//   3. 两人都锁定 ⇒ 一次性比较并结算（推后 / 抽牌 / 弃牌 / 公开留场）。

import { applyEffect } from '../ops/registry.ts';
import type { Card } from '../types/theme.ts';
import type { State } from './state.ts';
import type { PublicCard } from './flow.ts';

/** 对峙比较结果。 */
export type DuelOutcome = 'a' | 'b' | 'tie';

/**
 * 两张牌的比较（规格 §3.3）：
 *   1. 先比颜色：红 > 黑；
 *   2. 同色比点数（`rank` 数值，A=14 最大）；
 *   3. 颜色与点数均相同 → 平局。
 */
export function compareCards(a: Card, b: Card): DuelOutcome {
  const colorRank = (c: Card): number => (c.color === 'red' ? 1 : 0);
  const cc = colorRank(a) - colorRank(b);
  if (cc > 0) { return 'a'; }
  if (cc < 0) { return 'b'; }
  return a.rank > b.rank ? 'a' : (a.rank < b.rank ? 'b' : 'tie');
}

/** 推后 1 格（山道从 1 起 ⇒ 最小 1）。 */
function pushBack(state: State, seat: number): State {
  const p = state.players[seat];
  if (p === undefined) { return state; }
  return {
    ...state,
    players: state.players.map((x) => (x.seat === seat ? { ...x, position: Math.max(1, x.position - 1) } : x)),
  };
}

/** 从手牌移除一张（亮牌不回手牌）。 */
function removeFromHand(state: State, seat: number, cardId: string): State {
  return {
    ...state,
    players: state.players.map((x) => (x.seat === seat
      ? { ...x, hand: x.hand.filter((c) => c.id !== cardId) }
      : x)),
  };
}

/** 抽 1 张牌（败者补偿，规格 §3.3 第 4 条）。 */
function drawOne(state: State, seat: number): State {
  const r = applyEffect({ state, actor: seat }, { op: 'draw_cards', count: 1 });
  return r.ok ? r.state : state;
}

/**
 * 开始一次对峙。
 *
 * 任一方手牌为空 ⇒ **直接结算**（规格 §3.3 第 5 条：自动落败，不进入待决）。
 */
export function startDuel(state: State, seatA: number, seatB: number): State {
  const a = state.players[seatA];
  const b = state.players[seatB];
  if (a === undefined || b === undefined) { return state; }
  // ⚠️ B13：任一方**手牌为空** ⇒ 自动落败（规格 §3.3 第 5 条）——
  //   注意与「尚未选牌」区分：这里判的是**手牌为空**，不是 pick 未锁定。
  if (a.hand.length === 0 || b.hand.length === 0) {
    const loser = a.hand.length === 0 ? seatA : seatB;
    return autoLose(state, seatA, seatB, loser);
  }
  return { ...state, duel: { seatA, seatB } };
}

/**
 * 自动落败（规格 §3.3 第 5 条）：该方被推后 1 格、**不抽牌**；另一方获胜。
 *
 * ⚠️ 单独成函数而非复用 `settleDuel` —— `settleDuel` 的「未选牌」分支与
 * 「手牌为空」是两回事（前者是流程未完成，后者是规则判负）。
 */
function autoLose(state: State, seatA: number, seatB: number, loser: number): State {
  const winner = loser === seatA ? seatB : seatA;
  const next = pushBack(state, loser);
  return logDuel({ ...next, duel: null }, '座' + String(winner) + ' 胜（座' + String(loser) + ' 无牌可亮，自动落败）');
}

/**
 * 自动为对峙双方各选一张牌并结算（**AI 陪练 / 教学演示 / 脚本对局**用）。
 *
 * ⚠️ 为什么放在引擎里（B13 教训）：对峙会**阻塞回合推进**（`advanceTurn` 在对峙未决时
 *   直接返回）⇒ 任何自己驱动对局的调用方（测试、脚本、AI）都必须处理对峙，
 *   否则对局会在第一次同格相遇时**卡死**（天机牌不再翻开、昼夜分支不再可达）。
 *   ⇒ 提供统一的自动选牌出口，避免每个调用方各写一套（且策略不一致）。
 *
 * 选牌策略：**红优先、同色点数大优先**。
 */
export function autoResolveDuel(state: State): State {
  const d = state.duel;
  if (d === null) { return state; }
  const pick = (seat: number): string | null => {
    const p = state.players[seat];
    if (p === undefined || p.hand.length === 0) { return null; }
    let best = p.hand[0];
    for (const c of p.hand) {
      if (best === undefined) { best = c; continue; }
      const bc = best.color === 'red' ? 1 : 0;
      const cc = c.color === 'red' ? 1 : 0;
      if (cc > bc || (cc === bc && c.rank > best.rank)) { best = c; }
    }
    return best === undefined ? null : best.id;
  };
  let next = state;
  const pa = pick(d.seatA);
  if (pa !== null) { next = submitDuelCard(next, d.seatA, pa).state; }
  const pb = pick(d.seatB);
  if (pb !== null) { next = submitDuelCard(next, d.seatB, pb).state; }
  return next;
}

/** 该座位是否是当前对峙的参与者。 */
export function isDuelParticipant(state: State, seat: number): boolean {
  const d = state.duel;
  return d !== null && (d.seatA === seat || d.seatB === seat);
}

/** 当前对峙中，对手座位（不是参与者则返回 -1）。 */
export function duelOpponent(state: State, seat: number): number {
  const d = state.duel;
  if (d === null) { return -1; }
  if (d.seatA === seat) { return d.seatB; }
  if (d.seatB === seat) { return d.seatA; }
  return -1;
}

/** 该参与者是否已锁定亮牌。 */
export function duelPicked(state: State, seat: number): boolean {
  const d = state.duel;
  if (d === null) { return false; }
  return (d.seatA === seat ? d.pickA : d.pickB) !== undefined;
}

/** 锁定一张亮牌；两人都锁定时立即结算并揭晓。 */
export function submitDuelCard(
  state: State,
  seat: number,
  cardId: string,
): { ok: boolean; state: State; note: string } {
  const d = state.duel;
  if (d === null) { return { ok: false, state, note: '当前没有待决对峙' }; }
  const player = state.players[seat];
  if (player === undefined) { return { ok: false, state, note: '座位不存在' }; }
  const isA = d.seatA === seat;
  if (!isA && d.seatB !== seat) { return { ok: false, state, note: '你不是本次对峙的参与者' }; }
  const already = isA ? d.pickA : d.pickB;
  if (already !== undefined) { return { ok: false, state, note: '你已锁定亮牌' }; }
  if (!player.hand.some((c) => c.id === cardId)) { return { ok: false, state, note: '手牌中无此牌' }; }
  const duel = isA ? { ...d, pickA: cardId } : { ...d, pickB: cardId };
  const next: State = { ...state, duel };
  const both = next.duel?.pickA !== undefined && next.duel?.pickB !== undefined;
  if (!both) {
    return { ok: true, state: next, note: '已锁定亮牌（等待对方选牌）' };
  }
  return { ok: true, state: settleDuel(next, d.seatA, d.seatB, next.duel.pickA, next.duel.pickB), note: '对峙揭晓' };
}

/**
 * 结算对峙（规格 §3.3）。
 *
 * - 任一方手牌为空 ⇒ 该方**自动落败**（被推后 1 格，不抽牌）；
 * - 分出胜负 ⇒ 败者**推后 1 格 + 抽 1 张牌**；胜者**不获额外收益**；
 *   两张亮牌**公开留场**（不回任何人的手牌，round 末清空）；
 * - 平局 ⇒ 双方**均不后退**，**各弃 1 张**（即各自的亮牌弃掉，不公开留场）。
 */
function settleDuel(
  state: State,
  seatA: number,
  seatB: number,
  pickA: string | undefined,
  pickB: string | undefined,
): State {
  const a = state.players[seatA];
  const b = state.players[seatB];
  if (a === undefined || b === undefined) { return { ...state, duel: null }; }
  const cardA = pickA !== undefined ? a.hand.find((c) => c.id === pickA) : undefined;
  const cardB = pickB !== undefined ? b.hand.find((c) => c.id === pickB) : undefined;
  let next: State = { ...state, duel: null };
  const notes: string[] = [];
  // ⚠️ 防御：两人都**已锁定**才会走到这里；若某方缺牌（理论上不会，
  //   手牌为空时 `startDuel` 已直接判负）⇒ 保守按「该方自动落败」处理。
  if (cardA === undefined || cardB === undefined) {
    const loser = cardA === undefined ? seatA : seatB;
    const winner = cardA === undefined ? seatB : seatA;
    next = pushBack(next, loser);
    notes.push('座' + String(winner) + ' 胜（座' + String(loser) + ' 无牌可亮，自动落败）');
    const pub: PublicCard[] = [];
    if (cardA !== undefined) { pub.push(pubCard(seatA, cardA)); }
    if (cardB !== undefined) { pub.push(pubCard(seatB, cardB)); }
    next = { ...next, publicCards: [...next.publicCards, ...pub] };
    if (cardA !== undefined) { next = removeFromHand(next, seatA, cardA.id); }
    if (cardB !== undefined) { next = removeFromHand(next, seatB, cardB.id); }
    return logDuel(next, notes.join('；'));
  }
  const outcome = compareCards(cardA, cardB);
  if (outcome === 'tie') {
    // 平局：双方均不后退，各弃 1 张（亮牌即弃掉的那张 ⇒ 不公开留场）
    next = removeFromHand(next, seatA, cardA.id);
    next = removeFromHand(next, seatB, cardB.id);
    notes.push('平局（' + cardA.name + ' vs ' + cardB.name + '）：双方均不后退，各弃 1 张');
    return logDuel(next, notes.join('；'));
  }
  const aWins = outcome === 'a';
  const winner = aWins ? seatA : seatB;
  const loser = aWins ? seatB : seatA;
  const loserCard = aWins ? cardB : cardA;
  // 亮牌公开留场（规格 §3.3：留在场上公开，不回手牌，round 末清空）
  next = { ...next, publicCards: [...next.publicCards, pubCard(seatA, cardA), pubCard(seatB, cardB)] };
  next = removeFromHand(next, seatA, cardA.id);
  next = removeFromHand(next, seatB, cardB.id);
  // 败者：推后 1 格 + 抽 1 张牌；胜者不获额外收益
  next = pushBack(next, loser);
  next = drawOne(next, loser);
  notes.push('座' + String(winner) + ' 胜（' + cardA.name + ' vs ' + cardB.name + '）：座'
    + String(loser) + ' 推后 1 格并抽 1 张牌');
  void loserCard;
  return logDuel(next, notes.join('；'));
}

/** 公开牌记录。 */
function pubCard(seat: number, card: Card) {
  return { seat, cardId: card.id, name: card.name, color: card.color, rank: card.rank };
}

/** 写对峙日志（kind='duel' ⇒ 模拟器可统计对峙触发次数）。 */
function logDuel(state: State, message: string): State {
  const d = state.duel;
  const actor = d?.seatA ?? -1;
  return {
    ...state,
    log: [...state.log, { round: state.round, turnIndex: state.turnIndex, actor, kind: 'duel', message: '对峙：' + message }],
  };
}
