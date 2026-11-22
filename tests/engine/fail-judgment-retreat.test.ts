// 「判罚后退」（`applyFailJudgment`，规格 §5.3.2 / §5.1）的三条边界契约。
//
// ⚠️ 为什么单独成文件（2026-11-23 缺口取证）：`applyFailJudgment` 此前只在
//   `tests/engine/` 里被**间接经过**（质疑判负、复议维持原判的流程会调它），
//   没有任何用例直接钉它的三条边界：
//   ① 退到哪一档为止（`Math.max(1, position - 1)` 的下界，certification.ts:239）；
//   ② 只有**真的离开峰顶**才解除待认证锁定（`leftPeak` 判据，certification.ts:240）——
//      这条决定「登顶是单向门」（B66 §5.1）到底有没有唯一的出口；
//   ③ 座位不存在时原样返回（certification.ts:237-238）——越界不许抛、也不许改状态。
//   现有用例覆盖的是「判负之后流程往前走」，不是「后退本身退到哪」，
//   所以把下界从 1 改成 0、或把 `leftPeak` 改成无条件解锁，都不会有引擎侧红证。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFailJudgment } from '../../engine/core/certification.ts';
import { mk, putPending } from './fixtures.ts';

test('判罚后退：离开峰顶是待认证锁定的唯一出口（§5.1 单向门）', () => {
  const s = putPending(mk(4, 7), [0]);
  const peak = s.board.peakIndex;
  assert.equal(s.players[0]?.position, peak, '前提：座 0 正停在峰顶且待认证');
  assert.equal(s.players[0]?.pendingCert, true, '前提：待认证锁定成立');

  const next = applyFailJudgment(s, 0);
  const me = next.players[0];
  assert.ok(me !== undefined, '座 0 必须存在');
  assert.equal(me.position, peak - 1, '后退一格是 §5.3.2 的后果本体');
  assert.equal(me.pendingCert, false,
    '只有真的离开峰顶才解锁 ⇒ 判罚后退是 B66 单向门的唯一出口，这里不解锁玩家就永远卡在山上');
  assert.equal(next.certification.pending.includes(0), false,
    '离开峰顶必须同时从 pending 摘除，否则认证循环还在等一个已经不在峰顶的人');
});

test('判罚后退：下界是 1 号格，连续判罚也不会把座位推出棋盘', () => {
  let s = putPending(mk(4, 7), [0]);
  const seen: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    s = applyFailJudgment(s, 0);
    const p = s.players[0];
    assert.ok(p !== undefined, '座 0 必须存在');
    seen.push(p.position);
    assert.ok(p.position >= 1, `第 ${String(i + 1)} 次后退把座位带到了 position=${String(p.position)}（下界必须是 1）`);
  }
  assert.equal(s.players[0]?.position, 1, '连续后退应收敛在 1 号格，而不是停在半途');
  assert.equal(new Set(seen).size, s.board.peakIndex - 1,
    '从峰顶逐格退到 1 号格 ⇒ 途经的每一档都该被访问过（一次都没退 = 判据失效的另一形状）');
});

test('判罚后退：座位不存在时原样返回，不抛也不留痕', () => {
  const s = mk(4, 7);
  const logBefore = s.log.length;
  const next = applyFailJudgment(s, s.players.length + 3);
  assert.equal(next, s, '越界座位必须返回**同一个对象引用**（返回副本会掩盖判据没生效这件事）');
  assert.equal(next.log.length, logBefore, '越界调用不许写日志');
});

test('判罚后退：双人互验时只摘走被后退的那一名，另一名仍在认证中', () => {
  const s = putPending(mk(3, 11), [0, 1]);
  assert.deepEqual(s.certification.pending.slice(), [0, 1], '前提：两名待认证者都在峰顶');
  const next = applyFailJudgment(s, 0);
  assert.deepEqual(next.certification.pending.slice(), [1],
    'pending 是**过滤**不是清空——误伤另一名会把 §5.5 双人互验直接抹掉');
  assert.equal(next.players[1]?.pendingCert, true, '另一名座 1 的锁定不许被连带解除');
  assert.equal(next.players[1]?.position, s.board.peakIndex, '另一名坐标不许被动到');
});
