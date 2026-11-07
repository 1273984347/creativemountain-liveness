// 引擎状态（规格 §6.2）
//
// 单一不可变状态对象，所有动作是纯函数 state → state'。
// B1 只实现骨架：回合机 / 骰子 / 移动 / 资源 / 手牌 / 地形（关隘、认证、山议留待 B3）。

import type { Card, Tile } from '../types/theme.ts';
import { getScales, type PlayerCount, type ScalesRow } from '../scales.ts';
import { Rng } from './dice.ts';
import type { Board } from './board.ts';
import { dealInitialHands } from './hand.ts';

/** 阶段。 */
export type Phase = '天机' | '行动' | '山议' | '认证' | '终局';

/** 玩家运行时状态。 */
export interface Player {
  /** 座位号（0 起） */
  readonly seat: number;
  /** 是否存活 */
  readonly alive: boolean;
  /** 当前体力 */
  readonly hp: number;
  /** 体力上限（= 手牌上限，规格 §4.2） */
  readonly hpMax: number;
  /** 当前灵枢 */
  readonly resource: number;
  /** 手牌 */
  readonly hand: readonly Card[];
  /** 山道位置 */
  readonly position: number;
  /** 身份 id（公开，规格 §4.1） */
  readonly identityId: string;
  /** 阵营 id */
  readonly factionId: string;
  /** 是否持有印记 */
  readonly hasMark: boolean;
  /** 是否处于待认证状态 */
  readonly pendingCert: boolean;
}

/** 引擎状态。 */
export interface State {
  /** 初始种子（复现用） */
  readonly seed: number;
  /** 随机源（权威） */
  readonly rng: Rng;
  /** 阶段 */
  readonly phase: Phase;
  /** 回合数：所有存活玩家各行动一次 = 1 个 round（规格 §3.1） */
  readonly round: number;
  /** 当前手番在 round 内的位置 */
  readonly turnIndex: number;
  /** 玩家列表（按座位序） */
  readonly players: readonly Player[];
  /** 牌库 */
  readonly deck: readonly Card[];
  /** 弃牌堆 */
  readonly discard: readonly Card[];
  /** 棋盘（格位 + 峰顶） */
  readonly board: Board;
  /** 当前局规模配置 */
  readonly scales: ScalesRow;
}

/** 构造初始状态的参数。 */
export interface InitialStateOptions {
  /** 玩家人数（3–8） */
  readonly players: PlayerCount;
  /** 随机种子 */
  readonly seed: number;
  /** 牌库容量（B1 测试用；正式由主题包 counts.deckTotal 决定） */
  readonly deckSize?: number;
}

/** 生成测试用牌（id 稳定，便于断言）。 */
function makeTestCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `test_card_${i}`,
    name: `测试牌${i}`,
    type: 'function' as const,
    cost: 0,
    color: 'red' as const,
    text: '测试用牌',
    effects: [],
  }));
}

/** 生成山道（直线，无关隘）。 */
function makeBoard(length: number): Board {
  const tiles: Tile[] = Array.from({ length }, (_, i) => ({
    index: i + 1,
    kind: (i + 1 === length ? 'peak' : 'plain') as Tile['kind'],
    name: `第${i + 1}格`,
  }));
  return { length, tiles, peakIndex: length };
}

/** 构造初始状态（含开局发牌）。 */
export function createInitialState(opts: InitialStateOptions): State {
  const scales = getScales(opts.players);
  const deckSize = opts.deckSize ?? 40;
  // B1 骨架尚无主题包，体力基准取占位值（正式值来自主题包 factions[].hpBase，B4 接入）
  const hpBase = scales.threshold + 5;
  const players: Player[] = Array.from({ length: opts.players }, (_, seat) => ({
    seat,
    alive: true,
    hp: hpBase,
    hpMax: hpBase,
    resource: scales.initialResource,
    hand: [],
    position: 0,
    identityId: `identity_${seat}`,
    factionId: `faction_${seat}`,
    hasMark: false,
    pendingCert: false,
  }));
  const base: State = {
    seed: opts.seed,
    rng: new Rng(opts.seed),
    phase: '行动',
    round: 1,
    turnIndex: 0,
    players,
    deck: makeTestCards(deckSize),
    discard: [],
    board: makeBoard(scales.boardLength),
    scales,
  };
  return dealInitialHands(base);
}
