// 开局配置：按主题装配牌堆 / 棋盘 / 身份与阵营（规格 §4.1 / §4.2 / §6.5）。
//
// 主题包提供 8 个身份、4 个阵营、48 张卡与一整套棋盘；引擎在开局时把它们装进 State。
// **身份是公开的**（§4.1 明牌竞速），所以分配结果必须进日志。

import type { Card, Effect, ThemePack } from '../types/theme.ts';
import type { Tile } from '../types/theme.ts';
import type { Board } from './board.ts';
import type { State } from './state.ts';
import { dealInitialHands } from './hand.ts';
import { openHeaven } from './turn-runner.ts';
import { grantedFlags } from './passives.ts';

/**
 * 确定性打乱下标（Fisher–Yates，用状态的 RNG ⇒ 固定 seed 仍可复现）。
 */
function shuffledIndices(n: number, state: State): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(state.rng.next() * (i + 1));
    const a = idx[i];
    const b = idx[j];
    if (a !== undefined && b !== undefined) {
      idx[i] = b;
      idx[j] = a;
    }
  }
  return idx;
}

/**
 * 按主题**随机**分配身份与阵营。
 *
 * ⚠️ B10 修正：原实现按**座位轮转**分配（`identities[i % 8]` / `factions[i % 4]`）
 *   ⇒ 身份与阵营和座位**一一绑定**，而先行动的座位在「登顶 → 认证 → 封顶」这条主线上占先
 *   ⇒ 胜率沿座位顺序**严格单调递减**（实测 22.4% → 1.7%）。
 *   现改为**开局随机分配**（用 state.rng 打乱槽位；固定 seed ⇒ 仍可复现），
 *   身份/阵营与座位**解耦** ⇒ 胜率反映机制强度而非座位顺序。
 *
 * 保持不变的两条约束：
 *   · 每人身份**唯一**（身份槽位 8 ≥ 人数 3–8）；
 *   · 阵营人数分布不变（前 4 人各占一个阵营，其后循环）⇒ 不会出现某阵营 0 人。
 */
export function assignIdentitiesAndFactions(state: State, theme: ThemePack): State {
  const identityOrder = shuffledIndices(theme.identities.length, state);
  const factionOrder = shuffledIndices(theme.factions.length, state);
  const players = state.players.map((p, i) => {
    const identity = theme.identities[identityOrder[i % theme.identities.length] ?? 0];
    const faction = theme.factions[factionOrder[i % theme.factions.length] ?? 0];
    // ⚠️ 手牌上限 = 体力上限（§4.2），而规模表的起始手牌（§8）按人数可大于阵营体力
    //   （8 人局 handStart=7 > 散仙 hpBase=6）⇒ 直接用阵营体力会让起始手牌超限。
    //   故体力上限取两者较大值。
    const hpBase = faction?.hpBase ?? p.hpMax;
    const hpMax = Math.max(hpBase, state.scales.handStart);
    // 常驻型被动授予（如仲裁者的 extra_vote ⇒ 投票权重 2）
    const granted = grantedFlags(identity?.passive);
    return {
      ...p,
      identityId: identity?.id ?? p.identityId,
      factionId: faction?.id ?? p.factionId,
      ...(granted.extraVotes > 0
        ? { flags: { ...p.flags, extraVotes: ((p.flags.extraVotes as number | undefined) ?? 0) + granted.extraVotes } }
        : {}),
      hpMax,
      hp: hpMax,
      resource: faction?.resourceBase ?? p.resource,
    };
  });
  const names = players.map((p) => {
    const identity = theme.identities.find((i) => i.id === p.identityId);
    const faction = theme.factions.find((f) => f.id === p.factionId);
    return '座' + p.seat + ' = ' + (identity?.name ?? p.identityId) + '（' + (faction?.name ?? p.factionId) + '）';
  });
  return {
    ...state,
    players,
    log: [...state.log, { round: state.round, turnIndex: state.turnIndex, actor: -1, kind: 'setup', message: '身份与阵营分配：' + names.join('；') }],
  };
}

/** 把非 Card 的牌（天机 / 试炼 / 认证题）包成引擎可用的 Card。 */
function toCard(id: string, name: string, text: string, effects: readonly Effect[]): Card {
  return { id, name, type: 'utility', cost: 0, color: 'red', rank: 2, text, effects: [...effects] };
}

/** 确定性洗牌（用状态自己的 RNG 推进状态 ⇒ 同 seed 同结果）。 */
function shuffle(items: readonly Card[], state: State): Card[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng.next() * (i + 1));
    const ti = a[i];
    const tj = a[j];
    if (ti !== undefined && tj !== undefined) {
      a[i] = tj;
      a[j] = ti;
    }
  }
  return a;
}

/**
 * 组装牌库到**规模表要求的规模**（`scales.deckTotal`，3–8 人 = 40–80 张）。
 *
 * ⚠️ 主题包是固定 48 张（`counts.deckTotal`），而规格 §8 的牌库总量**按人数变化**：
 *   8 人局需要 8×7 = 56 张 > 48 ⇒ 若直接用主题卡池，第 8 名玩家**一张牌都发不到**
 *   （实测：hands = [7,7,7,7,7,7,6,0]）。
 *   故牌库不足时**复制**主题通用牌补足，副本 id 加 `#dupN` 后缀（不与原卡冲突）。
 *
 * 代价：数字轨的牌库规模随人数变化，而实体件只印 48 张 ⇒ 二者规模不一致，
 *   登记为遗留（B9 规模表落地时统一）。
 */
function fillDeck(theme: ThemePack, state: State, size: number): Card[] {
  const shuffled = shuffle(theme.cards, state);
  if (shuffled.length >= size) {
    return shuffled.slice(0, size);
  }
  const out = [...shuffled];
  let n = 1;
  while (out.length < size) {
    const src = theme.cards[(n - 1) % theme.cards.length];
    if (src === undefined) {
      break;
    }
    out.push({ ...src, id: src.id + '#dup' + String(n) });
    n += 1;
  }
  return out;
}

/**
 * 重置局面（**换主题 = 换一局**）。
 *
 * ⚠️ 换主题若只换牌堆与棋盘，位置 / 标记 / 中毒层 / 待认证锁定 / 昼夜都会**跨主题继承**
 *   （实测：换主题后位置、flags、statuses、pendingCert、phaseValue 全部保留）。
 *   而 B8 刚把 `phase_is` 接到 `phaseValue` 上 —— 继承来的昼夜会真实影响新主题标志卡的分支。
 *   故此处把局面重置到开局态。
 */
function resetForNewGame(state: State): State {
  const players = state.players.map((p) => ({
    ...p,
    position: 0,
    flags: {},
    statuses: {},
    shield: 0,
    pendingCert: false,
    hasMark: false,
    equipment: [],
    counters: {},
    turn: { moveBonus: 0, usedAsk: false, movedThisTurn: false },
  }));
  return {
    ...state,
    round: 1,
    turnIndex: 0,
    phase: '行动',
    phaseValue: 'day',
    lastDice: 0,
    extraRolls: 0,
    keptDice: [],
    doubleNextVote: false,
    wheelUsed: 0,
    extraSignaturesRequired: 0,
    players,
    certification: {
      // 0 = 第 1 轮尚未开始（待认证者刚登顶）—— 见 B9 修正
      round: 0,
      pending: [],
      signed: [],
      challenged: [],
      abstained: [],
      signatures: {},
      judgments: {},
      appealed: [],
      appealVotes: {},
      validityVotes: {},
      validityDecided: false,
    },
    council: { heldCount: 0, lastRound: 0, votes: {}, resolved: true, vetoUsed: false },
    outcome: { finished: false, winners: [], reason: 'no_winner' },
    log: [...state.log, { round: 1, turnIndex: 0, actor: -1, kind: 'setup', message: '新开一局' }],
  };
}

/**
 * 把主题棋盘**适配到规模表的格数**（规格 §8 `boardLength`：3–8 人 = 24/28/32/32/36/36）。
 *
 * ⚠️ B9 修正：主题包固定 28 格（4 人局），而规模表按人数给出不同格数。
 *   若不缩放 ⇒ 3 人局要爬 28 格（规则书写 24）⇒ **兜底触发率飙到 96%**（实测），
 *   且规则书与实际对局不一致。
 *
 * 缩放规则：截断时保留关隘等关键格位（前段顺序不变），峰顶永远在末格；
 * 扩展时新增格位用中性名（避免地名重复）。
 */
function fitBoard(theme: ThemePack, length: number): Board {
  const tiles = theme.board.tiles;
  if (tiles.length === length) {
    return { length, tiles: [...tiles], peakIndex: theme.board.peakIndex };
  }
  const peakTile = tiles[tiles.length - 1];
  const body = tiles.slice(0, -1);
  const out: Tile[] = [];
  for (let i = 0; i < length - 1; i++) {
    const src = body[i % body.length];
    if (src === undefined) {
      continue;
    }
    const isRepeat = i >= body.length;
    out.push({
      ...src,
      index: i + 1,
      ...(isRepeat ? { name: '山道 ' + String(i + 1) } : {}),
    });
  }
  if (peakTile !== undefined) {
    out.push({ ...peakTile, index: length });
  }
  return { length, tiles: out, peakIndex: length };
}

/**
 * 把主题包装进 State：**牌池 / 棋盘 / 天机 / 试炼 / 认证题 / 造物**。
 *
 * ⚠️ B8 补：`createInitialState` 的 `deckSize` 只是 **B1 骨架的测试牌占位**——
 *   主题包的真实卡池与棋盘此前从未进过数字轨（UI 里打的是「测试牌N」）。
 *   本函数把装配收进引擎侧，让**数字轨与对局测试共用同一条装配链**，
 *   避免「测试装配 ≠ 生产装配」这种分裂。
 *
 * 顺序：装牌堆 → 分配身份阵营（决定体力上限）→ 重置局面 → 按体力上限发牌。
 */
export function installTheme(state: State, theme: ThemePack): State {
  const creationIds = new Set((theme.creationDeck ?? []).map((c) => c.cardId));
  const withPacks: State = {
    ...state,
    board: fitBoard(theme, state.scales.boardLength),
    decks: {
      deck: fillDeck(theme, state, state.scales.deckTotal),
      discard: [],
      creation: theme.cards.filter((c) => creationIds.has(c.id)),
      exhausted: [],
      heaven: theme.heavenCards.map((h) => toCard(h.id, h.name, h.text, h.effects)),
      trial: (theme.trials ?? []).map((t) => toCard(t.id, t.id, t.text, t.effects ?? [])),
      cert: theme.certificationCards.map((c) => toCard(c.id, c.id, c.prompt, [])),
    },
    // 发牌前清空手牌：B1 骨架发的「测试牌」不能混进主题局
    players: state.players.map((p) => ({ ...p, hand: [] })),
  };
  // ⚠️ 顺序：先**重置局面**（清空 flags 等），再**分配身份**（授予常驻型被动）——
  //   反过来会把刚授予的 flags 又清掉（实测：仲裁者的额外投票权因此丢失）。
  const reset = resetForNewGame(withPacks);
  const withFactions = assignIdentitiesAndFactions(reset, theme);
  // 开局即翻开第 1 回合的天机牌（规格 §3.1 回合第 1 步）
  return openHeaven(dealInitialHands(withFactions));
}