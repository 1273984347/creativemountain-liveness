// 合法动作枚举（规格 §7）
//
// `getLegalActions(state, playerId)` 返回该玩家当前可提交的**全部合法动作**。
// UI 与（未来的）AI 都只能提交这里列出的动作 —— 保证「AI 能做的玩家都能做」。

import type { Action } from './action.ts';
import type { State } from './state.ts';
import { hasUsedCertificationTurn, isCertifier } from './certification.ts';

/** 列出该玩家的合法动作。 */
export function getLegalActions(state: State, playerId: number): Action[] {
  const actions: Action[] = [];
  const player = state.players[playerId];
  if (player === undefined || !player.alive) {
    return actions;
  }
  const others = state.players.filter((p) => p.alive && p.seat !== playerId);

  // ---- 认证阶段动作（§5.3）----
  const c = state.certification;
  if (c.pending.length > 0 && !c.pending.includes(playerId)) {
    for (const target of c.pending) {
      if (hasUsedCertificationTurn(state, playerId)) { break; }
      if (!isCertifier(state, playerId)) { continue; }
      actions.push({ type: 'CERTIFY_SIGN', actor: playerId, target });
      actions.push({ type: 'CERTIFY_CHALLENGE', actor: playerId, target });
      actions.push({ type: 'CERTIFY_ABSTAIN', actor: playerId, target });
    }
  }
  // 待认证者：可申请复议
  if (c.pending.includes(playerId) && !c.appealed.includes(playerId)) {
    for (const target of others.map((o) => o.seat)) {
      if (c.judgments[target] === false) {
        actions.push({ type: 'CERTIFY_APPEAL', actor: playerId, target });
      }
    }
  }
  // 复议投票 / 合规裁定投票：非当事人
  for (const target of c.pending) {
    if (target === playerId) { continue; }
    for (const o of others) {
      if (o.seat === playerId) { continue; }
      if (c.appealVotes[playerId] === undefined && c.appealed.includes(target)) {
        actions.push({ type: 'CERTIFY_VALIDATE_QUESTION', actor: playerId, target, valid: true });
        actions.push({ type: 'CERTIFY_VALIDATE_QUESTION', actor: playerId, target, valid: false });
      }
    }
  }

  // ---- 山议投票（§5.6）----
  if (!state.council.resolved) {
    if (state.council.votes[playerId] === undefined) {
      for (const o of others) {
        actions.push({ type: 'VOTE', actor: playerId, target: o.seat });
      }
    }
  }

  // ---- 行动阶段三选一（§3.1）----
  if (state.phase === '行动' && state.turnIndex < state.players.filter((p) => p.alive).length) {
    // 待认证者不能主动移动（§5.1 锁定）
    if (!player.pendingCert) {
      actions.push({ type: 'MOVE', actor: playerId, steps: 0 });
    }
    actions.push({ type: 'PASS', actor: playerId });
  }

  return actions;
}
