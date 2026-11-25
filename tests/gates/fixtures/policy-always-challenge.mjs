// B92 守卫用 fixture：**总是质疑**的策略（证明接线真的生效）。
//
// 用途：证明「注入了一个真会改变决策的策略 ⇒ 对局行为确实改变」⇒ 接线不是空转。
// ⚠️ 为什么是「总是质疑」而不是「总是选第一个」：certify 面的候选顺序里第一个通常是
//   `CERTIFY_SIGN`，而默认贪心本来就 80% 签印 ⇒ 「总是选第一个」≈ 默认 ⇒ 行为不变（实测过）。
//   「总是质疑」才与默认策略**真实不同**。
// ⚠️ 用命名导入取候选 key（与 policy.mjs 的候选过滤同一把尺：`actionKey(c)`）。
import { actionKey } from '../../../engine/core/action-key.ts';

export function createPolicy(ctx) {
  return {
    face: 'certify',
    seat: 0,
    decide: async (state, seat, candidates) => {
      const challenge = candidates.find((c) => c.type === 'CERTIFY_CHALLENGE');
      if (challenge !== undefined) { return actionKey(challenge); }
      return candidates.length > 0 ? actionKey(candidates[0]) : null;
    }
  };
}
