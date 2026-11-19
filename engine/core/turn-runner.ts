// 回合编排器（规格 §3.1 回合结构 + §3.3 移动与山道 + §5.6 山议 + §5 认证）
//
// 把 §3.1 的 8 个步骤串成可驱动的流程：
//   1 天机 → 2 行动 → 3 结算 → 4 裁牌 → 5 经济 → 6 牌库循环 → 7 山议 → 8 认证
//
// **round 末才触发山议与认证**（§3.1 术语定义）；手番内只走 1–6。

import { applyEffect } from '../ops/registry.ts';
import { rollD20 } from './dice.ts';
import { nextTurn, advanceRound, currentPlayer, isRoundEnd } from './round.ts';
import { cardHasMovement, cardNeedsTarget } from './targeting.ts';
import { passiveOf } from './passives.ts';
import { pendingGate } from './gate.ts';
import { judgeBarrier, pendingBarrier } from './barrier.ts';
import { startDuel } from './duel.ts';
import { drawCards, discardDownToLimit } from './hand.ts';
import { gainResource, spendResource } from './resource.ts';
// ⚠️ B75：计数写入的唯一出处（不得在分支里手写 `(p.counters.X ?? 0) + 1`）。
import { bumpCounterOf } from './counters.ts';
import { openCouncil, resolveCouncil, shouldHoldCouncil } from './council.ts';
import { advanceCertificationRound, enterPendingCertification } from './certification.ts';
import { resolveVictory } from './victory.ts';
import { settleRoundEndGoals } from '../goals/settle.ts';
import type { RuleMode } from '../scales.ts';
import type { Effect } from '../types/theme.ts';
import { clearTurnStates, type State } from './state.ts';
// B77 家族 B：状态结算的唯一出处（力竭递减仍留在 endRound，两者不同锚，见规格 §4）。
import { isActionBlocked, STATUS_LOG_PREFIX, statusOf, tickPlayerStatuses } from './statuses.ts';
import { recoverFromExhaustion, triggerExhaustion } from './exhaustion.ts';

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
  // ⚠️ B13：地形结算与**对峙**检测必须**分离** —— 两者写在一起时，
  //   `boon` / `hazard` / `peak` 分支直接 `return` ⇒ 落到这三类格子时对峙**永不触发**。
  let next = state;
  switch (tile.kind) {
    case 'boon': {
      next = drawCards(state, seat, 2);
      next = gainResource(next, seat, 1);
      break;
    }
    case 'hazard': {
      // 翻开牌堆顶 1 张判色（§3.4）：红安全，黑扣体力并失去本回合剩余行动
      const top = state.decks.deck[0];
      if (top === undefined) { return state; }
      // ⚠️ B12：织梦者「改写自己的险径判定为安全」（自动消费点，§4.1）——
      //   标记在发动时挂上、这里消费（**无论牌色都消费**，否则标记会无限留存）。
      const self = state.players[seat];
      if (self?.flags.judgementModified === true) {
        next = {
          ...state,
          players: state.players.map((p) => (p.seat === seat
            ? { ...p, flags: { ...p.flags, judgementModified: false } }
            : p)),
          log: [...state.log, {
            round: state.round, turnIndex: state.turnIndex, actor: seat, kind: 'passive',
            message: `[被动:modify_judgement] {identity:${String(seat)}}改写了{hazard}判定：安全通过`,
          }],
        };
        break;
      }
      // ⚠️ B13 修正：**红牌同样要翻开并移除牌堆顶**。
      //   原实现红牌直接 return、**不移除** ⇒ 牌堆顶永远不变、每次经过险径
      //   都是同一张牌（黑牌分支却会移除 ⇒ 牌库行为前后不一致）。
      //   规格 §3.4「翻开牌堆顶 1 张牌」——翻开即从牌库顶取出。
      const deckAfterFlip = state.decks.deck.slice(1);
      if (top.color === 'red') {
        next = { ...state, decks: { ...state.decks, deck: deckAfterFlip } };
        break;
      }
      const players = state.players.map((p) =>
        p.seat === seat ? { ...p, hp: Math.max(0, p.hp - 1) } : p,
      );
      next = { ...state, players, decks: { ...state.decks, deck: deckAfterFlip } };
      // ⚠️ B76：归零 ⇒ 力竭（与 damage 同一实现——两路径统一，设计规格 §2）。
      if (players[seat]!.hp === 0) {
        next = triggerExhaustion(next, seat);
      }
      break;
    }
    case 'rift': {
      // ⚠️ B18-b：封路印所在的裂隙格，**任何玩家**经过都需判定（沿用险径判色）。
      //   「无印」的裂隙格不在这里处理 —— 那里要等结算期的「放印 / 不放」二选一。
      if (tile.barrier !== true) { break; }
      const judged = judgeBarrier(state, seat);
      next = judged.state;
      next = {
        ...next,
        log: [...next.log, {
          round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'barrier',
          message: judged.blocked
            ? '{rift}：撞上封路印 —— 黑牌，停 1 回合'
            : '{rift}：撞上封路印 —— 红牌，通过',
        }],
      };
      break;
    }
    case 'peak': {
      if (player.pendingCert) { break; }
      const r = enterPendingCertification(state, seat);
      next = r.ok ? r.state : state;
      break;
    }
    default:
      break;
  }
  // ⚠️ B13：落点与**其他存活玩家同格** ⇒ 进入对峙（规格 §3.3「移动为跳到位，只结算终点格的地形与对峙」）。
  //   待认证锁定的玩家停在峰顶、**不参与**对峙（用 next 里的最新状态判断）。
  const me = next.players[seat];
  if (me !== undefined && !me.pendingCert) {
    const rival = next.players.find((p) => p.alive && p.seat !== seat && p.position === me.position);
    if (rival !== undefined) {
      next = startDuel(next, seat, rival.seat);
    }
  }
  return next;
}
/**
 * 开局：发牌已在 createInitialState 完成；此处只补开局天机与首回合准备。
 */
export function startGame(state: State): State {
  return state;
}

// 20 面指令表**不在本文件**（B78 §4 R3）：唯一出处是 `engine/core/instruction-table.ts`，
// 消费方是 `web/ui/log.ts` 与 `build/build-ir.mjs`；引擎只报骰面与指令序号（见 :275/:418 的 ask 日志）。

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
/**
 * `performAction` 的第五个入参形状 ⇒ 与 `Action` 成员的映射**必须**是显式 `Record`：
 * 三元链在新增动作时会静默落到最后一个分支（例：新增 `'pass'` 却映射成 `'RECUPERATE'`），
 * 而 `Record<ActionFace, string>` 少一个键就直接 tsc 报错（同"穷尽 switch 不加 default"的纪律）。
 *
 * ⚠️ `ask` ↔ `ROLL_WHEEL`（问天）：命名是原作「转盘」的遗留，映射见 `probe.ts:105`。
 */
export type ActionFace = 'move' | 'ask' | 'act' | 'equip' | 'recuperate' | 'pass';
const FACE_OF_ACTION: Record<ActionFace, string> = {
  move: 'MOVE',
  ask: 'ROLL_WHEEL',
  act: 'PLAY_CARD',
  equip: 'EQUIP_CARD',
  recuperate: 'RECUPERATE',
  // PASS 属豁免族（isActionBlocked 恒 false）⇒ 上面那道封锁检查对它不起作用，
  // 「没人封你时拒 PASS」由下面的 `case 'pass'` 自己判。
  pass: 'PASS',
};

export function performAction(
  state: State,
  seat: number,
  action: ActionFace,
  payload: { readonly cardId?: string; readonly target?: number } = {},
): State {
  const player = state.players[seat];
  if (player === undefined) { return state; }
  // ⚠️ B18：停在**未通过的关隘** ⇒ 只能选通过通道（付费 / 试炼），其它行动一律拒绝。
  //   这是**引擎层**的正确性保证：UI 的候选限制只是辅助，绕过 UI 调引擎也必须被拒。
  //   （否则玩家可以在关隘格上反复行棋直到离开 ⇒ 关隘形同虚设。）
  if (pendingGate(state, seat) !== null) { return state; }
  // ⚠️ B18-b：停在**可放印的裂隙格** ⇒ 同样只能选通道（放印 / 不放）。
  if (pendingBarrier(state, seat) !== null) { return state; }
  // B77：被封者的行动一律**引用相等**拒绝（与 pendingCert / B65 灵枢不足同款形状 ⇒ 探针认得）。
  //   判据读 statuses 的唯一出处，枚举层只是**少发**候选，真正的门禁在这里（绕过 UI 调引擎也必须被拒）。
  if (isActionBlocked(state, seat, FACE_OF_ACTION[action])) { return state; }
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
        next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'passive', message: '[被动:move_forward] {identity:' + String(seat) + '}：本回合首次移动 +' + String(firstMoveBonus) + ' 格' }] };
      }
      const steps = next.lastDice;
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'move', message: `行棋：掷出 ${steps}，前进至第 ${next.players[seat]?.position ?? before} 格`, diceRoll: steps }] };
      break;
    }
    case 'ask': {
      const face = rollD20(next.rng);
      next = { ...next, lastDice: face };
      next = applyInstruction(next, seat, face);
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'ask', message: `问天：掷出 ${face}，执行第 ${face} 条指令`, diceRoll: face }] };
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
      // ⚠️ **B66：待认证锁定的引擎层加固（G-b 收口）** —— 规格 §5.1：「待认证者在峰顶
      //   **不能主动移动、不能使用移动类卡牌或位移能力**」。唯一离开方式是「判罚后退」。
      //   ⇒ 此前只有 `move` 分支查 `pendingCert`，`act` 分支**不查** ⇒ 锁定者能打位移牌
      //      绕过锁定（登顶是单向门的设计被击穿）⇒ 引擎层必须拒绝。
      //   ⚠️ **只拦「含位移」的牌**：攻击 / 防御 / 资源类牌**照打**（规格只禁位移，不禁一切行动）——
      //      ⚠️ 若连非位移牌也禁 ⇒ 锁定者在认证期间**完全无法行动** ⇒ 与「签印 / 质疑 / 弃权」
      //      认证面并存的设计冲突（且那三项走的是 certify* 入口，不受此分支影响，但代价是玩家
      //      在认证期连攒资源都不行）⇒ 口径取**只禁位移**。
      //   ⚠️ **判位移按 op 语义、不只看 `card.type === 'motion'`**（见 `cardHasMovement`：
      //      主题包有一张 utility 类型的位移牌 `c_throwspirit` ⇒ 只看 type 会漏掉它）。
      if (player.pendingCert && cardHasMovement(card)) {
        return state;   // ⚠️ 引用相等 = `probeAction` 认得的拒绝信号
      }
      // ⚠️ **B65：出牌付费（G-a 收口）** —— 打出卡牌须支付该牌的 `cost`（规格 §3.1「行事」/§4.3）。
      //   **灵枢不足 ⇒ 拒绝该动作**（不扣、不出牌、状态不变）⇒ 与 §3.5 付费通道、
      //   §5.3 申请复议的「资源不足即拒绝」同款。
      //   ⚠️ **为什么扣费放在「移出手牌」之前**：先扣后弃 ⇒ 扣费失败时手牌与灵枢都原样不动；
      //   若先弃牌再扣 ⇒ 扣费失败会留下「牌已弃、钱没扣」的坏状态。
      //   ⚠️ **为什么用 `spendResource`（既有算子）**：灵枢不足的语义（ok:false + 状态不变）
      //   已由它定义（§4.3 / §5.3.4 同款）⇒ 这里不另写一份「够不够」的判断。
      const paid = spendResource(next, seat, card.cost);
      if (!paid.ok) { return state; }   // ⚠️ 引用相等 = `probeAction` 认得的拒绝信号
      next = paid.state;
      // 打出：移出手牌 → 依次结算效果
      const hand = next.players[seat]?.hand.filter((c) => c.id !== cardId) ?? [];
      next = { ...next, players: next.players.map((p) => (p.seat === seat ? { ...p, hand } : p)) };
      for (const eff of card.effects) {
        next = applyEffect({ state: next, actor: seat, sourceCard: card }, retarget(eff, payload.target)).state;
      }
      next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'card', message: `行事：打出「${card.name}」` }] };
      break;
    }
    // ⚠️ B76：力竭恢复（设计规格 §3）——**自恢**（无 target：本人力竭、扣 2 灵枢）
    //   与**救援**（有 target：自己不力竭、目标力竭存活、扣 1 灵枢、任意距离）。
    //   ⚠️ 拒绝以引用相等表达（probeAction 认得的拒绝信号）；生效路径走 recoverFromExhaustion
    //     （唯一实现，engine/core/exhaustion.ts）。**pendingCert 下允许**（不是位移，不触 §5.1；
    //     此前两条暂停早退已拦关隘 / 裂隙暂停期——与 B75 equip 同款）。
    case 'recuperate': {
      // ⚠️ 最终审查 I1：对峙未决 ⇒ 拒绝（枚举层对峙面整面清零，执行层必须同判——
      //   规格 §6 builder-check ①的「对峙期天然被拒」此前**不成立**：advanceTurn 阻塞推进
      //   ≠ performAction 拒绝动作。引用相等 = probeAction 认得的拒绝信号）。
      if (state.duel !== null) { return state; }
      const target = payload.target;
      if (target === undefined) {
        // 自恢
        if ((player.exhaustedRounds ?? 0) === 0) { return state; }
        if (player.resource < 2) { return state; }
        const spent = spendResource(next, seat, 2);
        if (!spent.ok) { return state; }
        next = spent.state;
        return recoverFromExhaustion(next, seat, '自恢');
      }
      // 救援
      if ((player.exhaustedRounds ?? 0) > 0) { return state; }
      const tp = state.players[target];
      if (tp === undefined || !tp.alive || (tp.exhaustedRounds ?? 0) === 0) { return state; }
      if (player.resource < 1) { return state; }
      const spentRescue = spendResource(next, seat, 1);
      if (!spentRescue.ok) { return state; }
      next = spentRescue.state;
      return recoverFromExhaustion(next, target, '救援');
    }
    case 'equip': {
      // ⚠️ B75（设计 §4.1）：装备 = 把手牌**转为常驻装备**（公开可见、无被动效果、免费、不占手牌上限）。
      //   本分支**必须**位于上面两条早退（`pendingGate` / `pendingBarrier`）之后：
      //   规格 §3.5 / §3.4 说「到达未通过的关隘 / 可放印裂隙时该手番已暂停」（通道选择属**结算阶段**，
      //   不是行动阶段）⇒ 这一手番的行动已在「到达」时用掉 ⇒ 不得再装备（提到早退之前就等于同一手番两次行动）。
      //   反之**不查** `pendingCert`：装备不产生位移（§5.1 只禁位移），锁定期间仍该能装备。
      const cardId = payload.cardId;
      if (cardId === undefined) { return state; }   // ⚠️ 引用相等 = `probeAction` 认得的拒绝信号
      if (!player.alive) { return state; }
      const card = player.hand.find((c) => c.id === cardId);
      if (card === undefined) { return state; }
      next = {
        ...state,
        players: state.players.map((p) => (p.seat === seat
          ? { ...p, hand: p.hand.filter((c) => c.id !== cardId), equipment: [...p.equipment, card] }
          : p)),
      };
      // 计数走唯一出处（`equipsTotal` 是规格 §6.4 的内建计数器，`equip_count` 目标的判据）
      next = bumpCounterOf(next, seat, 'equipsTotal', 1);
      next = {
        ...next,
        log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'equip', message: `装备「${card.name}」` }],
      };
      break;
    }
    case 'pass': {
      // B77：被停手番者的唯一出口。**只写日志**——结算（地形 / 收入 / 护盾 / 裁牌）与推进
      //   仍归 `advanceTurn` → `finishTurn`，否则 PASS 会变成第二条"绕过地形结算"的捷径
      //   （B18-c 把回合末流程与手番推进解耦的本意就在这）。
      // ⚠️ 判据是 skip_turn 本身，不是 isActionBlocked —— PASS 属豁免族，对它恒 false。
      if (statusOf(state, seat, 'skip_turn') <= 0) { return state; }   // 没人封你 ⇒ 拒（引用相等）
      next = {
        ...state,
        log: [...state.log, {
          round: state.round, turnIndex: state.turnIndex, actor: seat, kind: 'status',
          message: `${STATUS_LOG_PREFIX.skip_turn_applied}座位 ${String(seat)}`,
        }],
      };
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
      return { ...chained, log: [...chained.log, { round: chained.round, turnIndex: chained.turnIndex, actor: seat, kind: 'ask', message: `链式问天：掷出 ${face2}，执行第 ${face2} 条指令`, diceRoll: face2 }] };
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
    next = { ...next, log: [...next.log, { round: next.round, turnIndex: next.turnIndex, actor: seat, kind: 'passive', message: '[被动:shield] {identity:' + String(seat) + '}：回合结束获得 ' + String(passive.amount) + ' 点护盾' }] };
  }
  // ⚠️ B75.2 更正：昼夜复位**不在**手番末 —— 规格 §6.5 的天机牌「本回合为夜」的
  //   「回合」= round（§3.1 术语：所有存活玩家各行动一次），手番末复位会让夜间
  //   只覆盖首个手番（其余玩家在白天行动）。此前夜间可达性全靠 `turn.finished`
  //   泄漏（跳过 finishTurn ⇒ 复位被跳过）撑着——B75.2 修复该泄漏后此缺口暴露。
  //   复位点移到 `endRound`（每 round 一次，天机牌在下一 round 开局重翻）。
  // 家族 B 状态结算（规格 B77 §4）：地形结算 / 收入 / 护盾都在上面，本行**必须**在它们之后 ——
  // poison 触发的力竭要赶上本 round 末的家族 A 递减，两条触发路径才等长（§3.1）。
  // ⚠️ 锚点是手番而非 round：每人每 round 只有一个手番，挂 round 末会让状态在其下次
  //   行动前被抹平（r3 的立项理由，反证见 tests/engine/status-anchor.test.ts）。
  next = tickPlayerStatuses(next, seat);
  return next;
}

/**
 * 推进一个手番（行动 → 收尾 → 手番切换）。
 *
 * 若本手番是 round 的最后一个，则在此触发**山议（7）与认证（8）**，
 * 随后进入下一个 round。
 */
export function advanceTurn(state: State, mode: RuleMode): State {
  // ⚠️ B13：**对峙未结算 ⇒ 回合阻塞**（双方还没各自锁定亮牌，不能推进到下一手番）。
  if (state.duel !== null) { return state; }
  const seat = currentPlayer(state);
  if (seat < 0) { return state; }
  const player = state.players[seat];
  // ⚠️ B13：手番**已结算**（上一轮因进入对峙而暂停）⇒ 跳过重复结算，直接推进。
  let next = player?.turn.finished === true ? state : finishTurn(state, seat);
  if (player?.turn.finished !== true) {
    next = {
      ...next,
      players: next.players.map((p) => (p.seat === seat ? { ...p, turn: { ...p.turn, finished: true } } : p)),
    };
    // 结算后进入对峙 ⇒ **暂停推进**（等双方锁定亮牌后再来一次 advanceTurn）
    if (next.duel !== null) { return next; }
  }
  // ⚠️ B18：停在**未通过的关隘** ⇒ **暂停推进**（等玩家选付费 / 试炼通道）。
  //   与对峙同款：turn.finished 已置 ⇒ 再来一次 advanceTurn 不会重复结算地形。
  // ⚠️ 检查必须在**块外**（每次 advanceTurn 都查）：若只放在首次结算的块内，
  //   第二次调用（turn.finished 已为 true）会跳过该块 ⇒ 关隘被无声跳过。
  if (pendingGate(next, seat) !== null) { return next; }
  // ⚠️ B18-b：裂隙的「放印 / 不放」二选一同样阻塞推进。
  if (pendingBarrier(next, seat) !== null) { return next; }
  next = nextTurn(next);
  if (!isRoundEnd(next)) {
    return next;
  }
  return endRound(next, mode);
}

/**
 * **回合末流程**（规格 §3.1 步骤 7–8 与回合末结算）——与「手番推进」**解耦**的独立入口（B18-c）。
 *
 * ⚠️ 为什么解耦：此前回合末流程与手番推进挤在 `advanceTurn` 的一段里 ⇒
 *   **阻塞路径**（关隘 / 裂隙的结算期通道选择）一旦提前 return，整段回合末流程被一并跳过
 *   ⇒ 手牌上限、跨 round、天机牌、终局判定全都可能被延后。
 *   解耦后：① 回合末流程有**独立入口与独立契约**；② 阻塞路径只影响「手番推进」；
 *   ③ 结算期通道选择**自己负责它带来的副作用**（关隘试炼发的牌当场裁 ⇒ `gate.ts`）。
 *
 * ⚠️ 仍然延后的情形（**预期**，不是缺陷）：末位手番的玩家还卡在关隘 / 裂隙上没选通道时，
 *   回合末**本就还没到**（该玩家还没走完这个手番）⇒ 回合末流程要等他选完通道后才跑。
 */
function endRound(next: State, mode: RuleMode): State {
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
  // ---- round 末：终局目标判定（规格 §6.4「回合末结算统一检查」+ §4.1「达成即发印记」）----
  //   ⚠️ 位置：**山议开启之后、认证之前** ——
  //     · 认证**之前** ⇒ 本回合达成目标的玩家，其【印记】在本回合认证中即生效
  //       （§4.1：持印记者所需签印数减半）⇒ 印记不是「下一回合才有用」的空头奖励。
  //   ⚠️ **山议在这里只是「开启」**（`openCouncil` ⇒ `council.resolved = false`），
  //   真正的**放逐发生在山议被结算时**（由 UI / 模拟器在本函数返回之后驱动）⇒
  //   **判定执行时玩家尚未被放逐** ⇒ 本回合末刚拿到印记的玩家可能随后被放逐。
  //   ⇒ §5.6「被放逐者……其身上的印记作废」由**放逐侧**负责（`council.ts` 放逐时清 `hasMark`），
  //     本处**不**依赖判定顺序来保证。
  next = settleRoundEndGoals(next);
  // ---- round 末：认证（8）----
  if (next.certification.pending.length > 0) {
    const adv = advanceCertificationRound(next);
    if (adv.ok) { next = adv.state; }
  }
  // ---- 回合末裁牌（规格 §3.1 步骤 4）----
  // 天机牌对**全场**生效 ⇒ 非当前行动者也会收到牌；
  // 手番末只裁当前玩家 ⇒ 别人会累积超限（实测：手牌 15 > 上限 6）。
  // 故回合末再对所有玩家裁一次。
  // ⚠️ B18 修正：**含已出局玩家**。被放逐者只被置 `alive: false`、手牌不清（§5.6），
  //   而此前这里只裁存活玩家 ⇒ 被放逐者的手牌**永远不会被裁** ⇒ 终局体检报
  //   「手牌超上限」（实测 24000 局 4 条 ≈ 1/7000 局；关隘接线只是放大了触发概率）。
  //   手牌上限是**通用规则**（谁的牌都不超过上限），与是否出局无关 ⇒ 全体裁。
  for (const p of next.players) {
    next = discardDownToLimit(next, p.seat);
  }
  // ---- 公开亮牌离场（规格 §3.3：两张牌留在场上公开，直至本 round 结束）----
  next = { ...next, publicCards: [] };
  // ---- 回合末清零（规格 §6.2：Player.turn 的「本回合」语义）----
  // ⚠️ B75.2 补接线：`clearTurnStates` 自 B1 起存在但从未被调用（只写不读）⇒
  //   `abilityUsedThisTurn` 整局不清 ⇒「每回合 1 次」类被动实际每局 1 次
  //   （reroll_count / steal_count 不可达的真正根因）；`movedThisTurn` 同病（开拓者）；
  //   `finished` 同病（被暂停过的手番会让下一 round 跳过 finishTurn 的结算/收入）。
  //   位置：认证结算**之后**、跨 round **之前** ⇒ 本回合内无人再读这些标志。
  //   ⚠️ `moveBonus` 不清（用后清零，见 state.ts 的 clearTurnStates 注释）。
  next = clearTurnStates(next);
  // ---- 力竭递减（B76：round 级状态，触发当轮末照减——r1.2 落定的 ≈1.5 轮口径）----
  //   归零瞬间调 recoverFromExhaustion（max 保底回血 + 日志 cause='自然'）。
  for (const p of next.players) {
    const n = p.exhaustedRounds ?? 0;
    if (n <= 0 || !p.alive) { continue; }   // ⚠️ 最终审查 I2：死者不递减（放逐侧已清，这里是防御）
    if (n - 1 === 0) {
      next = recoverFromExhaustion(next, p.seat, '自然');
    } else {
      next = { ...next, players: next.players.map((x) => (x.seat === p.seat ? { ...x, exhaustedRounds: n - 1 } : x)) };
    }
  }
  // ---- 昼夜复位（每 round 一次；天机牌「本回合为夜」覆盖整个 round，见 finishTurn 注释）----
  next = { ...next, phaseValue: 'day' };
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
