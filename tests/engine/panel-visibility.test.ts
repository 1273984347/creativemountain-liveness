// 面板显隐判据的行为契约：`needsCouncilVote` / `needsCertificationAction`（规格 §5.6 / §5.2）。
//
// ⚠️ 为什么单独成文件（2026-11-23 缺口取证，登记见 `docs/批次/B80-句子层三叶与身份称谓-执行记录.md` §14.2）：
//   这两个函数此前**只被消费方间接经过**——`web/main.ts:733`/`:761` 用它们决定面板显隐、
//   `tests/sim/policy.mjs:621`/`:622` 用它们当决策门——而 `tests/engine/` 里**零直接断言**。
//   判据写反（比如把 `resolved` 读反）时引擎侧不会有任何红证，表现形式是
//   「玩家看不见必须做的行动」：E2E 只走对峙流程、sim 不看显隐 ⇒ 两头都抓不住。
//   没有事实源断言的后果已经长出来了：`tests/engine/policy-injection.test.ts:230` 的
//   `inCertifyCycle` 是**手写镜像**判据，且比事实源少一条 `p.alive` ⇒ 两套口径各走各的。
//   ⇒ 本文件钉事实源本身，不钉镜像。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { State } from '../../engine/core/state.ts';
import { needsCertificationAction, needsCouncilVote } from '../../engine/core/turn-runner.ts';
import { resolveCouncil } from '../../engine/core/council.ts';
import { certifyAbstain, certifyChallenge, certifySign } from '../../engine/core/certification.ts';
import { councilScene, exiledScene, mk, pendingScene, putPending } from './fixtures.ts';

/** 引擎 note 的可读兜底（与 fixtures 同法：note 可选，缺消息也要说清是谁的断言）。 */
function why(note: string | undefined): string {
  return note ?? '（引擎未给 note）';
}

// ---------- 山议面（判据 = `council.resolved === false`） ----------

test('山议显隐：新建局为 false —— 开局不得弹投票面板', () => {
  assert.equal(needsCouncilVote(mk()), false,
    '新建局的 `council.resolved` 初值是 true（state.ts:327）⇒ 判据必须是「未结算才要面板」');
});

test('山议显隐：召开后为 true —— 与夹具后置条件同向', () => {
  const s = councilScene();
  assert.equal(s.council.resolved, false, '前提：夹具已把山议置为进行中');
  assert.equal(needsCouncilVote(s), true, '山议进行中 ⇒ 面板必须出现，否则投票没有入口');
});

test('山议显隐：结算后回到 false —— 散了会不许继续挂着面板', () => {
  const r = resolveCouncil(councilScene());
  assert.ok(r.ok, '前提：结算必须成功：' + why(r.note));
  assert.equal(r.state.council.resolved, true, '前提：结算已把 resolved 置真');
  assert.equal(needsCouncilVote(r.state), false,
    '结算后仍返回 true ⇒ 玩家可以对着已散会的山议继续投票');
});

// ---------- 认证面（判据 = 有 pending 且存在「存活、非待认证、本轮未用过机会」的认证人） ----------

test('认证显隐：无待认证者为 false', () => {
  const s = mk();
  assert.equal(s.certification.pending.length, 0, '前提：新建局没有待认证者');
  assert.equal(needsCertificationAction(s), false);
});

test('认证显隐：有人待认证且认证人未行动为 true', () => {
  assert.equal(needsCertificationAction(pendingScene()), true,
    '座 0 待认证、座 1/2/3 都还没用掉本轮机会 ⇒ 面板必须出现');
});

test('认证显隐：待认证者自己不算认证人（双人互验只剩一名认证人）', () => {
  const s = putPending(mk(3, 11), [0, 1]);     // §5.5 双人互验形状
  assert.deepEqual(s.certification.pending.slice(), [0, 1], '前提：两名待认证者都已在场');
  assert.equal(needsCertificationAction(s), true, '座 2 是仅剩的认证人且未行动 ⇒ 窗口开着');
  const r = certifySign(s, 2, 0);
  assert.ok(r.ok, '前提：座 2 签印必须成功：' + why(r.note));
  assert.equal(needsCertificationAction(r.state), false,
    '唯一认证人用完机会 ⇒ 面板必须消失，否则玩家对着没人能行动的认证循环空点');
});

test('认证显隐：签印 / 质疑 / 弃权三种机会消耗同等关窗', () => {
  const s = pendingScene();                             // 认证人 = 1,2,3
  const after1 = certifySign(s, 1, 0);
  assert.ok(after1.ok, '前提：座 1 签印必须成功：' + why(after1.note));
  assert.equal(needsCertificationAction(after1.state), true, '座 2/3 未行动 ⇒ 窗口仍开');
  const after2 = certifyChallenge(after1.state, 2, 0);
  assert.ok(after2.ok, '前提：座 2 质疑必须成功：' + why(after2.note));
  assert.equal(needsCertificationAction(after2.state), true, '座 3 未行动 ⇒ 窗口仍开');
  const after3 = certifyAbstain(after2.state, 3, 0);
  assert.ok(after3.ok, '前提：座 3 弃权必须成功：' + why(after3.note));
  assert.equal(needsCertificationAction(after3.state), false,
    '弃权同样算用掉机会 ⇒ 三人都用过之后窗口必须关闭');
});

test('认证显隐：存活认证人清零为 false —— 判据里的 `p.alive` 必须生效', () => {
  // 4 人局：座 3 由夹具出局、座 2 直接置出局 ⇒ 认证人只剩座 1（放逐是唯一出局通道，
  // 夹具 exiledScene 已有直置 alive 的先例，这里只在它之上补第二个出局座位）。
  const base: State = {
    ...exiledScene(4, 7, 3),
    players: exiledScene(4, 7, 3).players.map((p) => (p.seat === 2 ? { ...p, alive: false } : p)),
  };
  assert.equal(base.players.filter((p) => p.alive && p.seat !== 0).length, 1,
    '前提：只剩座 1 一名存活认证人');
  const s = putPending(base, [0]);
  assert.equal(needsCertificationAction(s), true, '前提：座 1 存活时窗口是开的');
  const last: State = { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, alive: false } : p)) };
  assert.equal(needsCertificationAction(last), false,
    '存活认证人清零 ⇒ 少了 `p.alive` 的镜像判据（policy-injection.test.ts:230）在这里会返回 true');
});
