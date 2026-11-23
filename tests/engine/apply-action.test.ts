import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction } from '../../engine/core/apply-action.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { castVote } from '../../engine/core/council.ts';
import { certifyAbstain } from '../../engine/core/certification.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { councilScene, mk, pendingScene } from './fixtures.ts';

test('行动面：MOVE 与真实 UI 路径 performAction + advanceTurn 逐字一致', () => {
  const s = mk(4, 7);
  const expected = advanceTurn(performAction(s, 0, 'move'), 'standard');
  assert.deepEqual(applyAction(s, { type: 'MOVE', actor: 0, steps: 0 }), expected);
});

test('行动面：ROLL_WHEEL 与真实路径逐字一致', () => {
  const s = mk(4, 11);
  const expected = advanceTurn(performAction(s, 0, 'ask'), 'standard');
  assert.deepEqual(applyAction(s, { type: 'ROLL_WHEEL', actor: 0 }), expected);
});

test('拒绝语义：非法 VOTE 返回原引用', () => {
  const s = councilScene(4, 7);
  assert.equal(applyAction(s, { type: 'VOTE', actor: 0, target: 0 }), s);
});

test('Ask1=A 引擎级强制：AI 认证人即使拿到合法 SIGN 候选也被提交口拒绝', () => {
  const base = pendingScene(4, 7);
  const s = {
    ...base,
    players: base.players.map((p) => p.seat === 1 ? { ...p, controlledBy: 'ai' as const } : p),
  };
  const legalSign = getLegalActions(s, 1).find((a) => a.type === 'CERTIFY_SIGN');
  assert.ok(legalSign, '前提：人类认证人确有 SIGN 候选');
  assert.equal(applyAction(s, legalSign), s);
});

test('山议面：VOTE 不推进手番，与 castVote 逐字一致', () => {
  const s = councilScene(4, 7);
  const expected = castVote(s, 0, 1);
  assert.equal(expected.ok, true);
  assert.deepEqual(applyAction(s, { type: 'VOTE', actor: 0, target: 1 }), expected.state);
});

test('认证面：CERTIFY_ABSTAIN 不推进手番，与引擎入口逐字一致', () => {
  const s = pendingScene(4, 7);
  const expected = certifyAbstain(s, 1, 0);
  assert.equal(expected.ok, true);
  assert.deepEqual(applyAction(s, { type: 'CERTIFY_ABSTAIN', actor: 1, target: 0 }), expected.state);
});

test('候选一致性：对每个真实候选 applyAction 都不得原样返回', () => {
  const scenes = [mk(4, 7), councilScene(4, 7), pendingScene(4, 7)];
  for (const s of scenes) {
    for (const seat of s.players.map((p) => p.seat)) {
      for (const action of getLegalActions(s, seat)) {
        assert.notEqual(applyAction(s, action), s, `合法候选被提交口拒绝：${actionKey(action)}`);
      }
    }
  }
});
