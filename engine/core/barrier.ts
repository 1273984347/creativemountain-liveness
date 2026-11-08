// 裂隙与封路印（规格 §3.4，B18-b）。
//
// 规格原文：「对手可花 2 灵枢在此放置『封路印』，持有者经过时需判定，失败则停 1 回合」。
// B18 细化后的**可执行口径**：
//   · **放置**：玩家**行棋落到裂隙格**（该格尚无封路印、且他身上灵枢 ≥ 2）⇒ 该手番**暂停**，
//     玩家二选一：**放印**（花 2 灵枢，在**这一格**公开放置）或**不放**（直接通过）。
//   · **判定**：封路印所在的裂隙格，**任何玩家**经过都需判定（**含放置者本人**）；
//     判定**沿用险径判色** —— 翻开牌堆顶 1 张：**红 = 通过，黑 = 被拦**（`skip_turn` +1）。
//   · **不可叠加**：同一格已有封路印时不可再放。
//
// ⚠️ 为什么**不放一张新卡**（主题包加卡）：牌池 +1 会连带 `counts.deckTotal`、
//   牌库组成与平衡全变；而**规模档的牌库量 ≤ 卡池**时，新卡**可能整局抽不到**
//   ⇒ 机制半死。故放印做成**引擎内建**的结算期选择，费用走灵枢消耗。

import type { State } from './state.ts';
import type { Tile } from '../types/theme.ts';
import { applyEffectToState } from '../ops/registry.ts';

/** 放置封路印的费用（规格 §3.4：2 灵枢）。 */
export const BARRIER_COST = 2;

/** 放置封路印的结果。 */
export interface BarrierResult {
  readonly ok: boolean;
  readonly state: State;
  readonly note?: string;
}

/**
 * 玩家当前是否停在**可放印**的裂隙格上（⇒ 需要二选一）。
 *
 * ⚠️ 状态**由位置与灵枢推导**，不新增 State 字段（§6.2 契约不变）。
 *   · 该格**已有印** ⇒ 直接判定，不给选择（否则玩家会在已有印的格上反复选）。
 *   · 灵枢**不足 2** ⇒ 放不起印，不必打扰玩家（直接通过）。
 */
export function pendingBarrier(state: State, seat: number): Tile | null {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return null; }
  const tile = state.board.tiles.find((t) => t.index === p.position);
  if (tile === undefined || tile.kind !== 'rift') { return null; }
  if (tile.barrier === true) { return null; }
  if (p.resource < BARRIER_COST) { return null; }
  return tile;
}

/**
 * 封路印判定（规格 §3.4）：翻开牌堆顶 1 张 —— **红 = 通过，黑 = 被拦**（停 1 回合）。
 *
 * ⚠️ 判色**沿用险径机制**（复用同一套「翻开即取出」语义，不新增判定维度）。
 *   · 牌库为空（理论上不会发生）⇒ 直接通过（与险径同款兜底）。
 *   · ⚠️ 织梦者的「改写险径判定」**只作用于险径**（规格 §4.1 原文如此）⇒ 裂隙判定不受其影响。
 */
export function judgeBarrier(
  state: State,
  actor: number,
): { readonly state: State; readonly blocked: boolean } {
  const top = state.decks.deck[0];
  if (top === undefined) { return { state, blocked: false }; }
  const flipped = { ...state, decks: { ...state.decks, deck: state.decks.deck.slice(1) } };
  if (top.color === 'red') { return { state: flipped, blocked: false }; }
  const stopped = applyEffectToState(
    { state: flipped, actor },
    { op: 'skip_turn', amount: 1, target: actor },
  );
  return { state: stopped, blocked: true };
}

/**
 * **自动解算裂隙**（供 AI / 脚本等自行驱动对局的调用方使用）——B18-b。
 *
 * ⚠️ 策略：**放印**（灵枢够就放）。放印当次不判定自己 ⇒ 放印是**纯收益**（花 2 灵枢拦一道裂隙），
 *   故 AI 放印是合理选择（若改成「放置者也判定」，放印有 50% 自伤 ⇒ AI 永不放 ⇒ 机制成死机制）。
 */
export function autoResolveBarrier(state: State, actor: number): State {
  if (pendingBarrier(state, actor) === null) { return state; }
  const r = resolveBarrier(state, actor, 'place');
  return r.ok ? r.state : state;
}

/**
 * 裂隙通道选择（规格 §3.4，B18-b）：
 *   · `place` —— 花 2 灵枢在**这一格**放置封路印，随后**仍要面对自己的印**（判色）。
 *   · `skip` —— 不放印，直接通过（**仍写一条日志**，以便探针能区分「已处理」与「未处理」）。
 */
export function resolveBarrier(state: State, actor: number, channel: 'place' | 'skip'): BarrierResult {
  const p = state.players[actor];
  if (p === undefined) { return { ok: false, state, note: '玩家不存在' }; }
  const tile = pendingBarrier(state, actor);
  if (tile === null) { return { ok: false, state, note: '当前不在可放印的裂隙格上' }; }
  if (channel === 'skip') {
    const next = {
      ...state,
      log: [...state.log, {
        round: state.round, turnIndex: state.turnIndex, actor, kind: 'barrier',
        message: '裂隙：未放置封路印，直接通过',
      }],
    };
    return { ok: true, state: next, note: '裂隙：未放置封路印' };
  }
  // 放印：花 2 灵枢 → 在该格置印。
  // ⚠️ **放置当次不判定自己**（B18-b 更正 B17 裁定）：印只对**后来者**生效。
  //   若放置者当次也要判定 ⇒ 放印有 50% 概率**自伤**（停 1 回合）⇒ 几乎没人放 ⇒ 机制形同虚设；
  //   而「花 2 灵枢买断这道裂隙」的博弈语义要求放置者自己不被拦。放置者若日后**从别处回到**
  //   该格，仍按「任何玩家经过都需判定」被拦。
  let next = applyEffectToState({ state, actor }, { op: 'spend_resource', amount: BARRIER_COST });
  next = applyEffectToState({ state: next, actor }, { op: 'place_barrier', tileIndex: tile.index });
  next = {
    ...next,
    log: [...next.log, {
      round: next.round, turnIndex: next.turnIndex, actor, kind: 'barrier',
      message: '裂隙：放置封路印（-2 灵枢）—— 印对后来者生效',
    }],
  };
  return { ok: true, state: next, note: '裂隙：已放置封路印（-2 灵枢）' };
}
