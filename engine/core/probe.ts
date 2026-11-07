// 试跑基础设施（规格 §7 落地）。
//
// ⚠️ 为什么不能拿原 state 直接试跑：`State.rng` 是**可变类实例**
//   （`Rng.next()` 写内部 `s`；`readonly rng` 只锁引用、不锁内容）
//   ⇒ 直接试跑会推进随机源、改变对局轨迹，毁掉第 ⑨ 门与 balance-report 的固定 seed 复现。

import { Rng } from './dice.ts';
import { advanceTurn, performAction } from './turn-runner.ts';
import { performAbility } from './abilities.ts';
import { castVote } from './council.ts';
import {
  certifyAbstain, certifyAnswer, certifyAppeal, certifyAppealVote,
  certifyChallenge, certifySign,
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
//      而它的每一条拒绝分支都写成 `return state`（turn-runner.ts:182/186/223/226/229）
//      ⇒ 「返回引用 === 入参引用」是它唯一的被拒信号。
//   ② **`{ok, state, note}` 契约**（`performAbility` / `castVote` / `certify*`）：判 `ok`；
//      另把「ok=true 但状态未变」也计为拒（防御：将来某个入口 ok 与落账脱钩时不至于静默放行）。
//   ③ **手番是否推进**（`PASS`）：`advanceTurn` 同样只返回 `State`，但**引用变化不等于被接受**
//      —— 收尾结算、裁牌、日志、天机都会产出新对象。唯一可靠信号是
//      `turnIndex` 或 `round` 真的变了（对峙未决 / 无当前手番时它连对象都不换，
//      而即使换了也不能证明推进，故两者都要判）。
//
// ⚠️ 三条通道都**只问引擎要答案**，不在探针里手写规则镜像——Task 5 的存在意义正是
//   「`legal.ts` 的手写前置与引擎真实前置漂移」（复议方向就是已注册的历史事故）。

/** 试跑使用的规则档位：标准档（新手档只改山议间隔，不影响动作可接受性）。 */
const MODE: RuleMode = 'standard';

/** 试跑结果：`reason` 为拒绝原因（接受时为引擎 note 或空串）。 */
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
      return r !== s && (r.turnIndex !== s.turnIndex || r.round !== s.round)
        ? { ok: true, reason: '' }
        : reject('手番未推进（对峙阻塞或无当前手番）');
    }
    case 'ABILITY': { const r = performAbility(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'VOTE': { const r = castVote(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'COMPARE': return reject('关隘入口未接线（B14）');   // payGate/drawTrial 全仓零引用
    case 'CERTIFY_SIGN': { const r = certifySign(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_CHALLENGE': { const r = certifyChallenge(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ABSTAIN': { const r = certifyAbstain(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL': { const r = certifyAppeal(s, action.actor, action.target); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_ANSWER': { const r = certifyAnswer(s, action.actor, action.target, action.passed); return byFlag(r.ok, r.note, r.state, s); }
    case 'CERTIFY_APPEAL_VOTE': { const r = certifyAppealVote(s, action.actor, action.target, action.overturn); return byFlag(r.ok, r.note, r.state, s); }
  }
}
