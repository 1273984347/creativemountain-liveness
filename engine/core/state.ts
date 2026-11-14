// 引擎状态（规格 §6.2）
//
// 单一不可变状态对象，所有动作是纯函数 state → state'。
// B1 只实现骨架：回合机 / 骰子 / 移动 / 资源 / 手牌 / 地形（关隘、认证、山议留待 B3）。
//
// ⚠️ **B1 契约已冻结**：State / Player / Decks / PlayerTurnState 的字段集在 B1 定稿后
// 不再变更。B2（ops registry）与 B3（关隘/山议/认证）**只实现逻辑，不新增或改名 State 字段**——
// 若确需新字段，先改规格 §6.2 并同步本文件，再动手写逻辑。

import type { Card, Tile } from '../types/theme.ts';
import type { NegativeStatus } from '../types/common.ts';
import { getScales, type PlayerCount, type ScalesRow } from '../scales.ts';
import { Rng } from './dice.ts';
import type { Board } from './board.ts';
import type { CertificationState, CouncilState, DuelState, Outcome, PublicCard } from './flow.ts';
import { dealInitialHands } from './hand.ts';

/** 阶段。 */
export type Phase = '天机' | '行动' | '山议' | '认证' | '终局';

/**
 * 玩家身上的**回合内临时状态**（规格 §6.2 B1 锁定契约）。
 *
 * 三个字段都是「本回合」语义，**回合末一并清零**——放在子对象里便于整体替换
 * （`player.turn = EMPTY_TURN`），避免逐字段清零时漏清。
 */
export interface PlayerTurnState {
  /** 本回合位移加成（指令 17「本回合移动 +2 格」等）——叠加式，回合末清零 */
  readonly moveBonus: number;
  /** 本回合是否已使用过「问天」——链式问天不得连锁（§3.2 第 14 条） */
  readonly usedAsk: boolean;
  /** 本回合是否已发生过位移——「每回合首次移动 +1 格」类效果的判定基准（§4.1 开拓者） */
  readonly movedThisTurn: boolean;
  /**
   * 本手番**是否已结算**（B13）。
   *
   * ⚠️ 为什么需要：落点结算（地形 + 对峙）发生在手番收尾时，而对峙要**双方选牌后**才能结算；
   *   若此时回合已推进，对峙的选牌就没有「当前手番」可挂靠。
   *   ⇒ 结算完进入对峙时**暂停推进**并置此标记；对手选完牌后再次调用 advanceTurn，
   *   看到此标记便**跳过重复结算**、直接推进（回合末一并清零）。
   */
  readonly finished?: boolean;
  /**
   * 本回合是否已发动过身份被动——「每回合 1 次」类被动的次数闸门（§4.1 观星者 / 窃火者 / 织梦者）。
   *
   * ⚠️ **可选字段**（B12）：回合末清零 ⇒ 缺省即「未发动」；
   *   做成必填会让所有手写 `turn` 字面量（引擎 / 测试）都要跟着改 ⇒ 徒增维护面。
   *   读取一律用 `=== true` 判定。
   */
  readonly abilityUsedThisTurn?: boolean;
  /**
   * 本手番内是否被授予过负面状态 / 免疫（B77 家族 B 递减豁免）。
   *
   * ⚠️ **为什么需要它**：`skip_turn` / `silence` / `immunity` 的写入点全部在**该玩家自己的
   *   手番内**（撞印判色、关隘失败、行动阶段自己出牌），而家族 B 的衰减也挂手番末
   *   ⇒ 没有豁免位，「免疫 1 回合」会在授予它的同一手番末就被吃成 0，`t_oath` 一类
   *   试炼奖励结构性恒为 0（B77 规格 §4 豁免条）。
   * ⚠️ 可选字段（同 `abilityUsedThisTurn` 的理由：做成必填会让所有手写 `turn` 字面量
   *   跟着改，徒增维护面）；读取一律 `=== true`。
   */
  readonly statusGrantedThisTurn?: boolean;
}

/** 清零用的空回合状态。 */
export const EMPTY_TURN: PlayerTurnState = {
  moveBonus: 0,
  usedAsk: false,
  movedThisTurn: false,
  abilityUsedThisTurn: false,
  statusGrantedThisTurn: false,
  finished: false,
};

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
  /** 手牌（手牌上限 = 体力上限） */
  readonly hand: readonly Card[];
  /**
   * 装备区（V1.4）：**不占手牌上限**、**公开可见**、**V1 无被动效果**（纯计数目标）。
   */
  readonly equipment: readonly Card[];
  /** 山道位置 */
  readonly position: number;
  /** 身份 id（公开，规格 §4.1） */
  readonly identityId: string;
  /** 阵营 id */
  readonly factionId: string;
  /** 是否持有印记 */
  readonly hasMark: boolean;
  /**
   * 是否处于待认证状态（**待认证锁定**，规格 §5.1）：
   * 峰顶不能主动移动、不能用位移类牌；唯一离开方式是判罚后退。
   */
  readonly pendingCert: boolean;
  /** B76 力竭：HP 归零置 2，每 round 末递减（round 级，不入 PlayerTurnState）。0 = 未力竭。 */
  readonly exhaustedRounds: number;
  /** 回合内临时状态（回合末清零，见 PlayerTurnState） */
  readonly turn: PlayerTurnState;
  /** 负面状态层数/剩余回合数（规格 §6.4 状态类算子） */
  readonly statuses: Readonly<Partial<Record<NegativeStatus, number>>>;
  /** 护盾值（吸收伤害） */
  readonly shield: number;
  /** 玩家标记（`set_flag` / `clear_flag`） */
  readonly flags: Readonly<Record<string, unknown>>;
  /** 目标计数器（goal kind 对应，规格 §6.4 目标判定表） */
  readonly counters: Readonly<Record<string, number>>;
}

/**
 * 日志条目。
 *
 * ⚠️ B23：此处原有**两份完全重复**的 `LogEntry` 声明（复制粘贴遗留，靠 TS 的声明合并侥幸无害）⇒ 本批合并为一份。
 */
export interface LogEntry {
  readonly round: number;
  readonly turnIndex: number;
  readonly actor: number;
  readonly kind: string;
  readonly message: string;
  /** 掷骰记录（`move_by_dice` 等需要记录骰值） */
  readonly diceRoll?: number;
  /** 试炼牌 id（`kind='trial'` 时给出）—— B23：让「每张试炼牌的通过率」可机器统计 */
  readonly trialId?: string;
  /** 试炼是否通过（`kind='trial'` 时给出）—— B23：失败 ⇒ 改为付费（`gate_fallback_pay`） */
  readonly trialPassed?: boolean;
}

/** 各类牌堆（规格 §6.2）。 */
export interface Decks {
  /** 主牌库 */
  readonly deck: readonly Card[];
  /** 弃牌堆（牌库抽空时洗回主牌库） */
  readonly discard: readonly Card[];
  /** 造物牌堆（V1.4）：`create_card` 的唯一来源 */
  readonly creation: readonly Card[];
  /** 已耗尽的牌（`exhaust_card` 移出，不进弃牌堆） */
  readonly exhausted: readonly Card[];
  /** 天机牌 */
  readonly heaven: readonly Card[];
  /** 关隘试炼牌 */
  readonly trial: readonly Card[];
  /** 认证题卡 */
  readonly cert: readonly Card[];
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
  /**
   * 行动顺序：座位序列（**开局随机决定**，B10）。
   *
   * ⚠️ 为什么要有它：行动顺序若固定按座位，座 0 永远先动 ⇒ 永远先登顶 ⇒
   *   先进认证池 ⇒ 先完成认证 ⇒ 先终局 ⇒ **座位与胜率绑定**（实测残余 ±4pp）。
   *   随机决定后，「先手」不再绑定任何固定座位，各座位胜率趋于均匀。
   */
  readonly turnOrder: readonly number[];
  /** 当前手番在 round 内的位置 */
  readonly turnIndex: number;
  /** 玩家列表（按座位序） */
  readonly players: readonly Player[];
  /** 棋盘（格位 + 峰顶） */
  readonly board: Board;
  /** 各类牌堆 */
  readonly decks: Decks;
  /** 当前局规模配置 */
  readonly scales: ScalesRow;
  /** 全局阶段值（`set_phase`：night / day） */
  readonly phaseValue: 'night' | 'day';
  /** 上次掷骰结果（`last_dice_even` / `dice_is_at_least` 谓词用） */
  readonly lastDice: number;
  /** 本回合额外掷骰次数（`extra_roll`） */
  readonly extraRolls: number;
  /** 保留的骰子结果（`keep_die`） */
  readonly keptDice: readonly number[];
  /** 下一票翻倍标记（`double_next_vote`） */
  readonly doubleNextVote: boolean;
  /** 阵营轮使用次数（每局限 1 次；`spirit_wheel` source=manual 消耗） */
  readonly wheelUsed: number;
  /** 待认证者额外需要的签印数（`extra_signatures_required`） */
  readonly extraSignaturesRequired: number;
  /**
   * 待决对峙（规格 §3.3，B13）。
   *
   * 双方各自选牌、选完才同时揭晓 ⇒ 对峙未结算时**回合阻塞**（不能推进到下一手番）。
   */
  readonly duel: DuelState | null;
  /**
   * 本 round **公开**的亮牌（规格 §3.3）：比较后留在场上公开、不回手牌，round 末清空。
   */
  readonly publicCards: readonly PublicCard[];
  /**
   * 活人席数：`key` = 座位号，`value` = 该玩家已获得的活人席数。
   *
   * ⚠️ B11 活人席计分制（规格 §5.7）：**认证通过不再直接终局** ——
   *   封顶 = 拿到 1 席并回到山道起点（可再次登顶再取席），
   *   对局打到全局回合上限后按席位数排名。
   *   引入前，先登顶者 77.6% 直接获胜（位次胜率极差 12.7pp）；
   *   引入后「先登顶」只领先 1 席，可被后来者追平 ⇒ 先手优势不再决定胜负。
   */
  readonly liveSeats: Readonly<Record<number, number>>;
  /** 日志 */
  readonly log: readonly LogEntry[];
  /** 认证流程状态（§5） */
  readonly certification: CertificationState;
  /** 山议流程状态（§5.6） */
  readonly council: CouncilState;
  /** 对局结局（§5.7–§5.8） */
  readonly outcome: Outcome;
}

/** 构造初始状态的参数。 */
export interface InitialStateOptions {
  /** 玩家人数（3–8） */
  readonly players: PlayerCount;
  /** 随机种子 */
  readonly seed: number;
  /** 主牌库容量（B1 测试用；正式由主题包 counts.deckTotal 决定） */
  readonly deckSize?: number;
}

/** 生成测试用牌（id 稳定，便于断言）。 */
function makeTestCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `test_card_${i}`,
    name: `测试牌${i}`,
    type: 'utility' as const,
    cost: 0,
    color: 'red' as const,
    rank: 2 + (i % 13),
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
    equipment: [],
    position: 0,
    identityId: `identity_${seat}`,
    factionId: `faction_${seat}`,
    hasMark: false,
    pendingCert: false,
    exhaustedRounds: 0,
    turn: EMPTY_TURN,
    statuses: {},
    shield: 0,
    flags: {},
    counters: {},
  }));
  const base: State = {
    seed: opts.seed,
    rng: new Rng(opts.seed),
    phase: '行动',
    round: 1,
    turnOrder: players.map((p) => p.seat),
    turnIndex: 0,
    players,
    board: makeBoard(scales.boardLength),
    decks: {
      deck: makeTestCards(deckSize),
      discard: [],
      creation: [],
      exhausted: [],
      heaven: [],
      trial: [],
      cert: [],
    },
    scales,
    phaseValue: 'day',
    lastDice: 0,
    extraRolls: 0,
    keptDice: [],
    doubleNextVote: false,
    wheelUsed: 0,
    certification: {
      // 0 = 第 1 轮尚未开始（待认证者刚登顶）
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
    council: { heldCount: 0, lastRound: 0, votes: {}, resolved: true, vetoUsed: false, vetoBy: null },
    outcome: { finished: false, winners: [], reason: 'no_winner' },
    extraSignaturesRequired: 0,
    liveSeats: {},
    duel: null,
    publicCards: [],
    log: [],
  };
  return dealInitialHands(base);
}

/**
 * 回合末清零：把所有玩家的 `turn` 临时状态复位（「本回合」语义的字段归零）。
 *
 * 规格 §6.2：`usedAsk` / `movedThisTurn` / `abilityUsedThisTurn` 是「本回合」语义，回合末清零。
 * ⚠️ **`moveBonus` 例外（B75.2 定案）**：保留不清 —— 指令 17「本回合移动 +2 格」在
 *   「一回合一行动」节奏下（§3.1：问天的同一手番不可能再移动）只能**跨手番**生效，
 *   回合末清零会让它 100% 失效（死指令）。现行语义是**用后清零**
 *   （`ops/registry.ts` 的 `move_forward` / `move_by_dice` 消费点置 0）。
 *   —— 与 B17 删除「失去本回合剩余行动」子句同一款裁定：规格措辞按现行节奏校准。
 *
 * ⚠️ **B75.2 接线**：本函数自 B1 起存在但**从未被调用**（只写不读的死代码）⇒
 *   「每回合 1 次」类被动（观星者 / 窃火者 / 织梦者）实际整局只能用 1 次、
 *   开拓者「每回合首次移动 +1」实际每局只有首次 ⇒ `reroll_count` / `steal_count`
 *   在策略层面根本不可达（B75 遗留「阈值/策略未达标」的真正根因）。
 *   现由回合末流程（`turn-runner.ts` 的 `endRound`）调用。
 */
export function clearTurnStates(state: State): State {
  const players = state.players.map((p) => {
    const t = p.turn;
    if (t.usedAsk === false && t.movedThisTurn === false
      && t.abilityUsedThisTurn !== true && t.statusGrantedThisTurn !== true && t.finished !== true) {
      return p;   // 已是干净状态（moveBonus 不参与判断）⇒ 原样返回，保持引用稳定
    }
    return {
      ...p,
      // ⚠️ 必须从 EMPTY_TURN **展开**，不得逐字段手写清零对象：
      //   本文件头就写着「整体替换（player.turn = EMPTY_TURN），避免逐字段清零时漏清」，
      //   而 B75.2 为了保留 moveBonus 改成手写清单后，两者已经漂移过一次——
      //   B77 新增的 statusGrantedThisTurn 在手写清单里静默不被清（跨 round 残留），
      //   是 tests/engine/state-contract.test.ts 那条 B77 用例抓出来的。
      turn: { ...EMPTY_TURN, moveBonus: t.moveBonus },   // 例外：moveBonus 用后清零（见上），回合末不清
    };
  });
  return { ...state, players };
}
