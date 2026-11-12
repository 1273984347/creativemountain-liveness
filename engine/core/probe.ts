// 试跑基础设施（规格 §7 落地）。
//
// ⚠️ 为什么不能拿原 state 直接试跑：`State.rng` 是**可变类实例**
//   （`Rng.next()` 写内部 `s`；`readonly rng` 只锁引用、不锁内容）
//   ⇒ 直接试跑会推进随机源、改变对局轨迹，毁掉第 ⑨ 门与 balance-report 的固定 seed 复现。

import { Rng } from './dice.ts';
import { advanceTurn, performAction } from './turn-runner.ts';
import { performAbility } from './abilities.ts';
import { castVote } from './council.ts';
import { resolveGate, resolveCompareGate } from './gate.ts';
import { submitDuelCard } from './duel.ts';
import { resolveBarrier } from './barrier.ts';
import {
  certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote,
  certifyChallenge, certifyMutualSign, certifySign,
} from './certification.ts';
import type { Action } from './action.ts';
import type { RuleMode } from '../scales.ts';
import type { State } from './state.ts';

/** 换一个全新随机源的状态副本；起点与 `state` 相同，但推进只影响副本。 */
export function isolatedState(state: State): State {
  return { ...state, rng: Rng.fromSnapshot(state.rng.initialSeed, state.rng.snapshot()) };
}

// ============================ probeAction：把「引擎拒了」折叠成一个判据 ============================
//
// 引擎表达拒绝的方式**不止一种**，Task 5 的试跑式枚举要依赖单一判据，故在这里统一折叠：
//
//   ① **引用相等**（`performAction`）：该入口只返回 `State`，**没有任何成功/失败标记**，
//      而它的每一条拒绝分支都写成 `return state`
//      （`performAction`：座位越界取不到玩家；`move` 分支的 §5.1 待认证锁定；
//      `act` 分支的无 `cardId` / 手牌里没这张牌 / 需要目标却没给目标）
//      ⇒ 「返回引用 === 入参引用」是它唯一的被拒信号。
//   ② **`{ok, state, note}` 契约**（`performAbility` / `castVote` / `certify*`）：判 `ok`；
//      另把「ok=true 但状态未变」也计为拒（防御：将来某个入口 ok 与落账脱钩时不至于静默放行）。
//   ③ **手番是否被接受**（`PASS` → `advanceTurn`）：同样无返回标记，但**引用变化不等于被接受**
//      —— 收尾结算、裁牌、日志、天机都会产出新对象。判据落在**字段**上，两条都算合法：
//        · `turnIndex` 或 `round` 真的推进了 ⇒ 正常接受；
//        · 本次调用立起了对峙（`s.duel === null && r.duel !== null`，即 `advanceTurn`
//          「结算后进入对峙」那条 `return next`）⇒ `finishTurn` 已跑、`turn.finished` 已置、
//          `duel` 已生成，**引擎确实接受了这个动作**，只是手番推进挂起，
//          待双方各自锁定亮牌后再走一次 `advanceTurn`（B13）。把它报成 `ok:false`
//          等于对一条合法 PASS 给出错误的合法性判定 ⇒ Task 5 的 oracle 直接跟着错。
//      ⚠️ 这里**不判引用是否变化**：`turnIndex` / `round` / `duel` 都是引擎不可变更新的字段，
//      `r === s` 时它们必然逐字相同 ⇒ 「引用不同」这条前置永远不可能改变判定结果
//      （变异实测：删掉它全绿）。留着两个判据会让人以为「只判字段」不够严，故只留字段那条。
//
// ⚠️ 三条通道都**只问引擎要答案**，不在探针里手写规则镜像——Task 5 的存在意义正是
//   「`legal.ts` 的手写前置与引擎真实前置漂移」（复议方向就是已注册的历史事故）。
//   引擎自己漏掉的前置（如 `act` 分支不查 `pendingCert`、不校验 `target`）
//   由测试表里的 G-b 取证行钉住「实际行为」，修不修由批次裁定，探针不替引擎补。
//   ⚠️ **B65 更新**：`card.cost` **不再**是「引擎漏掉的前置」——G-a 已裁定出牌付费，
//   引擎 `act` 分支**自己**查 `card.cost`（灵枢不足即拒绝）⇒ 探针**照常试跑**即可得出答案
//   ⇒ 探针**仍不需要**自己查 `cost`（自己查反而是第二份镜像）。

/** 试跑使用的规则档位：标准档（新手档只改山议间隔，不影响动作可接受性）。 */
const MODE: RuleMode = 'standard';

/**
 * 试跑结果。
 *
 * `reason` **不是**「只有拒绝才有内容」的字段：拒绝时是拒因，**接受时同样可能非空**——
 *   · 通道 ② 把引擎 `note` 原样带出（如「签印」「已申请复议（-2 灵枢）」）；
 *   · 通道 ③ 的「结算时立起对峙」给的是**接受理由**（已接受，只是推进挂起）。
 * ⇒ 判据**只有 `ok` 这一条**：消费方不得用 `reason === ''` 反推「被接受」，
 *   也不得把非空 `reason` 当成失败（`legal.ts` 的试跑式枚举即按此口径写）。
 */
export interface ProbeResult {
  readonly ok: boolean;
  readonly reason: string;
}

const reject = (reason: string): ProbeResult => ({ ok: false, reason });

/** `performAction` 无返回标记 ⇒ 唯一判据是**返回引用等于入参**（各拒绝分支均 `return state`）。 */
function byRef(next: State, from: State): ProbeResult {
  return next === from ? reject('引擎原样返回（动作被拒）') : { ok: true, reason: '' };
}

/** 有 `{ok,note}` 契约的入口统一折叠；`ok=true` 但状态未变也算拒。 */
function byFlag(ok: boolean, note: string | undefined, next: State, from: State): ProbeResult {
  if (!ok) { return reject(note ?? '引擎拒绝'); }
  return next === from ? reject('ok=true 但状态未变') : { ok: true, reason: note ?? '' };
}

/**
 * 试跑一个动作：在**隔离副本**上真调引擎入口，返回「引擎是否接受」。
 *
 * 前提：`state` 只读——副本换掉 `rng` 实例，故试跑**永不消耗**原 state 的随机源
 * （第 ⑨ 门逐字等价与 balance-report 的固定 seed 复现依赖这一点）。
 *
 * ⚠️ 探针能判的只有「引擎会不会接受」，引擎**自己不看的东西它也不看**：
 *   · `MOVE.steps` 无消费点（行棋掷 6 面骰、必须走满，玩家不能指定步数）；
 *   · `ABILITY.abilityId` 无消费点（发动哪个被动由 `flags.passive` 决定）；
 *   · `PASS.actor` 无消费点（`advanceTurn(state, mode)` 压根没有 actor 参数）
 *     ⇒ **PASS 对手番持有人以外的人同样会返回 ok=true**，
 *     调用方（Task 5 的 `legal.ts`）若枚举 PASS 必须**自己**用 `currentPlayer` 把关。
 */
export function probeAction(state: State, action: Action): ProbeResult {
  const s = isolatedState(state);
  switch (action.type) {
    case 'MOVE': return byRef(performAction(s, action.actor, 'move'), s);
    case 'ROLL_WHEEL': return byRef(performAction(s, action.actor, 'ask'), s);
    case 'PLAY_CARD': {
      // `target` 可选 ⇒ 按真实入口的 payload 形状透传（需目标而未给目标的牌由引擎自己拒）。
      const payload = action.target === undefined
        ? { cardId: action.cardId }
        : { cardId: action.cardId, target: action.target };
      return byRef(performAction(s, action.actor, 'act', payload), s);
    }
    case 'PASS': {
      const r = advanceTurn(s, MODE);
      // 判据**只有字段这一条**（理由见文件头通道 ③）：手番推进 = 接受；
      // 本次调用立起对峙 = 也接受，只是推进挂起。
      // ⚠️ 不再判 `r !== s`：`turnIndex` / `round` / `duel` 都随不可变更新一起换对象，
      //   引用相同时它们必然逐字相同 ⇒ 「引用是否变化」永远不可能改变判定结果
      //   （变异实测：加不加它，用例集全绿）。留着只会误导读者以为单判字段不够。
      const advanced = r.turnIndex !== s.turnIndex || r.round !== s.round;
      // 「本次调用把对峙从无到有立起来」——只有这里能区分「结算已完成、推进等对峙」。
      const duelOpened = s.duel === null && r.duel !== null;
      if (advanced) { return { ok: true, reason: '' }; }
      if (duelOpened) {
        return {
          ok: true,
          reason: '本手番已结束（finishTurn 已结算、turn.finished 已置），推进挂起：'
            + '结算时立起对峙，需双方各自锁定亮牌后再走一次 advanceTurn 才会换人（B13）',
        };
      }
      return reject('手番未推进（已有一场对峙未结算，或无当前手番）');
    }
    case 'ABILITY': { const r = performAbility(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'VOTE': { const r = castVote(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ B19：关隘出牌比对通道已接线（规格 §3.5 B18 定案 4 = 候选 A）。
    //   ⚠️ **B53 修正**：此处原有一个 B18 时期的占位分支（`case 'COMPARE': return reject(...)`）
    //   **没被删掉** ⇒ 同一个 switch 里两个 `case 'COMPARE'`，**先命中的那个永远生效**
    //   ⇒ 出牌比对通道**永远被探针拒收** ⇒ 枚举里永远没有 COMPARE，
    //   而 UI 侧（`web/main.ts` 的出牌比对入口 + `web/legal-gate.ts` 的判据）**已接线**
    //   ⇒ 「UI 与 AI 使用同一枚举」在**关隘面破口**。现已删去占位分支。
    case 'COMPARE': { const r = resolveCompareGate(s, action.actor, action.cardId, action.target); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ B18：关隘付费 / 试炼两条通道已接线（规格 §3.5 B18 定案）。
    case 'GATE_RESOLVE': { const r = resolveGate(s, action.actor, action.channel); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ B18-b：裂隙通道（放印 / 不放）。
    case 'BARRIER_RESOLVE': { const r = resolveBarrier(s, action.actor, action.channel); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_SIGN': { const r = certifySign(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_CHALLENGE': { const r = certifyChallenge(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ABSTAIN': { const r = certifyAbstain(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL': { const r = certifyAppeal(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ANSWER': { const r = certifyAnswer(s, action.actor, action.target, action.passed); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL_VOTE': { const r = certifyAppealVote(s, action.actor, action.target, action.overturn); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ B67：双人互验的互签（§5.5）—— 待认证者给另一位待认证者签印。
    case 'CERTIFY_MUTUAL_SIGN': { const r = certifyMutualSign(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ B68：对峙选牌（§3.3）—— 引擎入口 `submitDuelCard` 返回 `{ok, state, note}` 契约。
    case 'DUEL_SUBMIT_CARD': { const r = submitDuelCard(s, action.actor, action.cardId); return byFlag(r.ok, r.note, r.state, s); }
    // ⚠️ **Task 5 替换本两支**（`case` 标签保留、body 换成真实入口分派）。
    //   写成**显式 case + 抛错**而不是 `default`，是为了保住本 switch 的穷尽性：
    //   B67/B68 的教训是「漏接线只能靠测试」，一旦加 default 就把 tsc 的兜底也丢了。
    //   此刻被调到 = 枚举/UI 提前发了候选 ⇒ 大声失败，不静默拒收。
    case 'EQUIP_CARD': throw new Error('探针未接线：EQUIP_CARD 待 Task 4 的 performAction(…, "equip") 落地（B75 Task 5）');
    case 'COUNCIL_VETO': throw new Error('探针未接线：COUNCIL_VETO 待 Task 3 的 useCouncilVeto 落地（B75 Task 5）');
  }
}
