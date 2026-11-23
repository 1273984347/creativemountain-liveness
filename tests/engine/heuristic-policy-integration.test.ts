import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playOne } from '../../tests/sim/policy.mjs';
import type { FacePolicy } from '../../tests/sim/policy.d.mts';
import type { ThemePack } from '../../engine/types/theme.ts';
import { heuristicPolicy } from '../../engine/core/heuristic-policy.ts';
import { actionKey } from '../../engine/core/action-key.ts';

const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
const FORBIDDEN = new Set([
  'CERTIFY_SIGN', 'CERTIFY_MUTUAL_SIGN', 'CERTIFY_CHALLENGE',
  'CERTIFY_ANSWER', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'COUNCIL_VETO',
]);

test('6 人局真实决策点：启发式在 play/council/certify 三面均零回落、不选禁止动作', async () => {
  for (const face of ['play', 'council', 'certify'] as const) {
    for (const seed of [7, 11, 17]) {
      const policy: FacePolicy = {
        face,
        seat: 2,
        decide: async (state, seat, candidates) => {
          const picked = heuristicPolicy.choose(state, seat, candidates);
          if (picked === null) { return null; }
          assert.equal(FORBIDDEN.has(picked.type), false, `${face}/${seed} 选了禁止动作 ${picked.type}`);
          return actionKey(picked);
        },
      };
      const result = await playOne(theme, 6, seed, undefined, policy);
      assert.equal(result.injection.fallbacks, 0, `${face}/${seed} 不得回落原启发式`);
      assert.ok(result.injection.calls > 0, `${face}/${seed} 必须真的到达决策点`);
      assert.equal(result.anomalies.includes('未分出胜负'), false, `${face}/${seed} 必须正常终局`);
      assert.ok(result.winners.length > 0, `${face}/${seed} 必须产出胜者`);
      assert.equal(result.anomalies.some((a) => a.includes('死循环')), false, `${face}/${seed} 不得死循环`);
    }
  }
});
