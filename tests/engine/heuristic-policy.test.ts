import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicPolicy, policyBand } from '../../engine/core/heuristic-policy.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { councilScene, mk, pendingScene } from './fixtures.ts';

const FORBIDDEN = new Set([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

test('启发式只从传入合法候选里选择，且确定性', () => {
  for (const s of [mk(6, 7), councilScene(6, 7), pendingScene(6, 7)]) {
    for (const seat of s.players.map((p) => p.seat)) {
      const legal = getLegalActions(s, seat);
      const a = heuristicPolicy.choose(s, seat, legal);
      const b = heuristicPolicy.choose(s, seat, legal);
      assert.deepEqual(a, b);
      if (a !== null) {
        assert.ok(legal.some((x) => actionKey(x) === actionKey(a)), '选择了候选集外动作');
        assert.equal(FORBIDDEN.has(a.type), false, `Ask1=A 禁止动作：${a.type}`);
      }
    }
  }
});

test('认证面只弃权，不签印/质疑/作答', () => {
  const s = pendingScene(6, 7);
  const legal = getLegalActions(s, 1);
  const picked = heuristicPolicy.choose(s, 1, legal);
  assert.equal(picked?.type, 'CERTIFY_ABSTAIN');
});

test('空候选返回 null，不编造动作', () => {
  const s = mk(4, 7);
  assert.equal(heuristicPolicy.choose(s, 0, []), null);
});

test('降级带：阻塞动作=1，常规行动=2，出牌/装备/PASS=3', () => {
  const s = mk(4, 7);
  const vote = getLegalActions(councilScene(4, 7), 0).find((a) => a.type === 'VOTE');
  assert.ok(vote);
  assert.equal(policyBand(vote), 1);
  assert.equal(policyBand({ type: 'MOVE', actor: 0, steps: 0 }), 2);
  assert.equal(policyBand({ type: 'PASS', actor: 0 }), 3);
  assert.equal(policyBand({ type: 'PLAY_CARD', actor: 0, cardId: 'x' }), 3);
  assert.ok(s);
});
