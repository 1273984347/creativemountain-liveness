// B77 六计数器的取证契约（规格 §9 表 + §10.2 验收）。
//
// ⚠️ 前缀是**跨任务契约**，所以它必须是**一个常量表**，而不是引擎写一份、模拟器抄一份：
//   B76 的教训是「报告按前缀扫描、测试逐字匹配、施工时各自发明就对不上」。
//   本文件因此先钉「引擎里不许再手抄字面量」，再钉「六键齐备且读数可达」。
//
// ⚠️ 六个计数器里，五个来自日志前缀，**`silence_applied` 不是**：引擎拒绝被封动作的信号是
//   **引用相等**（turn-runner.ts:239，探针据此判非法 ⇒ 绕 UI 打引擎也拦得住），在拒绝点写
//   日志就会改变引用，把探针的判据废掉。所以封口从「同一手番摘掉封口后枚举会多发几个动作」
//   取证——反事实用的仍是引擎自己的 `getLegalActions`，模拟器不复制封锁集（E94）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STATUS_LOG_PREFIX, statusOf } from '../../engine/core/statuses.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { mk } from '../engine/fixtures.ts';
import { playOne, silenceCost } from '../../tests/sim/policy.mjs';
import type { SimGameResult } from '../../tests/sim/policy.d.mts';

const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));

const LOG_KEYS = ['poison_tick', 'slow_applied', 'silence_discard', 'skip_turn_applied', 'immunity_blocked'] as const;

/** 六个计数器里由日志前缀取数的五个键（第六个 `silence_applied` 见文件头）。 */
const COUNTER_KEYS = [...LOG_KEYS, 'silence_applied'] as const;
/** §10.2 里判 > 0 的四个（slow 允许低、immunity 由 T12 的 24000 局读数裁定）。 */
const POSITIVE_KEYS = ['poison_tick', 'silence_applied', 'silence_discard', 'skip_turn_applied'] as const;

test('B77：STATUS_LOG_PREFIX 恰是五个日志键，且引擎侧不许再手抄字面量', () => {
  assert.deepEqual(Object.keys(STATUS_LOG_PREFIX).sort(), [...LOG_KEYS].sort());
  for (const [k, p] of Object.entries(STATUS_LOG_PREFIX)) {
    assert.ok(p.endsWith('：'), `${k} 的前缀必须以中文冒号结尾（消息体接在后面的格式约定）`);
  }
  // 三个写入点只能引用表：手抄一份字面量 = 第二事实源，改了表不改它就成了"日志还在、计数归零"。
  // ⇒ 把表本体从源码里摘掉之后，任何一处再出现被引号包裹的前缀都算违规。
  for (const f of ['engine/core/statuses.ts', 'engine/core/turn-runner.ts', 'engine/ops/registry.ts']) {
    const raw = readFileSync(f, 'utf8');
    const start = raw.indexOf('export const STATUS_LOG_PREFIX');
    const src = start < 0 ? raw : raw.slice(0, start) + raw.slice(raw.indexOf('} as const;', start) + 9);
    for (const p of Object.values(STATUS_LOG_PREFIX)) {
      assert.equal(src.includes(`'${p}'`), false, `${f} 手抄了前缀字面量 ${p} ⇒ 请改用 STATUS_LOG_PREFIX.<键>`);
    }
  }
});

test('B77：封口计数走反事实枚举，判据不复制封锁集', () => {
  let s = mk(4, 7);
  // 座 0：封口 1 回合 + 一张付得起的牌（cost 0）
  s = {
    ...s,
    players: s.players.map((p, i) => (i === 0
      ? { ...p, statuses: { ...p.statuses, silence: 1 }, hand: [{ ...p.hand[0]!, cost: 0 }] }
      : p)),
  };
  assert.equal(statusOf(s, 0, 'silence'), 1, '前提：座 0 被封口');
  const withSilence = getLegalActions(s, 0).filter((a) => a.type === 'PLAY_CARD' || a.type === 'ABILITY').length;
  assert.equal(withSilence, 0, '前提：封口期枚举不发 PLAY_CARD/ABILITY');
  assert.ok(silenceCost(s, 0) > 0, '被吃掉的动作数必须 > 0（这才是"生效"）');
  // 没封口 ⇒ 反事实等于现实 ⇒ 0
  const clean = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, statuses: {} } : p)) };
  assert.equal(silenceCost(clean, 0), 0);
});

test('B77：skip 判定读引擎枚举、排在 roll 之前 ⇒ 被停手番零随机消耗', () => {
  const src = readFileSync('tests/sim/policy.mjs', 'utf8');
  const anchor = "const roll = s.rng.next();";
  const rollIdx = src.indexOf(anchor);
  assert.ok(rollIdx > 0, '前提：行动分段的 roll 仍在');
  const passIdx = src.indexOf("performAction(s, seat, 'pass')");
  assert.ok(passIdx > 0, '模拟器必须有 PASS 出口（否则被停手番者空耗回合）');
  assert.ok(passIdx < rollIdx, 'PASS 分支必须排在 roll 之前 ⇒ 被 skip 的手番不消耗随机数（门 ⑨ 轨迹口径）');
  // 判据不许复制封锁集：必须是"枚举发了 PASS 才 PASS"
  const seg = src.slice(src.indexOf('B77', passIdx - 1600), passIdx);
  assert.ok(seg.includes('PASS'), 'PASS 分支的守卫注释必须声明判据来自 getLegalActions');
});

test('B77：六计数器在真实对局里齐备，且日志类读数与终局日志逐条吻合', async () => {
  let sum: Record<string, number> | null = null;
  const anomalies: string[] = [];
  let last: SimGameResult | null = null;
  for (let g = 0; g < 60; g++) {
    const r = await playOne(theme, 4, 20260 + g * 97, undefined);
    assert.ok(r.statusCounters !== undefined, 'playOne 必须返回 statusCounters');
    for (const a of r.anomalies) { anomalies.push(a); }
    last = r;
    sum ??= Object.fromEntries(COUNTER_KEYS.map((k) => [k, 0]));
    const c = r.statusCounters as Record<string, number>;
    for (const k of Object.keys(sum)) { sum[k] = (sum[k] ?? 0) + (c[k] ?? 0); }
  }
  const lastGame = last as SimGameResult;
  const lastCounters = lastGame.statusCounters as Record<string, number>;
  assert.deepEqual(anomalies, [], '带状态族对局不得出异常：' + anomalies.slice(0, 3).join(' / '));
  assert.deepEqual(Object.keys(lastGame.statusCounters).sort(), [...COUNTER_KEYS].sort(),
    '六个计数器一算子一个 + 弃牌单列 + 封口反事实');
  // 读数必须来自真实日志行：每条计数附带**取证样本**（该局第一条匹配消息），
  // 有读数却没样本 = 计数不是扫日志得来的；没读数却有样本 = 前缀口径不一致。
  for (const k of LOG_KEYS) {
    const sample = lastGame.statusLogSamples[k];
    if ((lastCounters[k] ?? 0) > 0) {
      assert.ok(typeof sample === 'string' && sample.startsWith(STATUS_LOG_PREFIX[k]),
        `${k} 计数 ${String(lastCounters[k])} 但样本不对：${String(sample)}`);
    } else {
      assert.equal(sample, null, `${k} 读数为 0 却留了样本 ⇒ 两处口径分叉`);
    }
  }
});

test('B77：60 局样本里四个"必须 > 0"的计数器确有读数（§10.2）', async () => {
  const total: Record<string, number> = Object.fromEntries(POSITIVE_KEYS.map((k) => [k, 0]));
  for (let g = 0; g < 60; g++) {
    const r = await playOne(theme, 4, 31337 + g * 97, undefined);
    const c = r.statusCounters as Record<string, number>;
    for (const k of Object.keys(total)) { total[k] = (total[k] ?? 0) + (c[k] ?? 0); }
  }
  for (const [k, v] of Object.entries(total)) {
    assert.ok(v > 0, `${k} 在 60 局里读数为 0 ⇒ 接线未生效或该状态根本发不出来：${JSON.stringify(total)}`);
  }
  // ⚠️ 单位钉子：`silence_applied` 必须按**失能手番人次**计，不是候选动作数。
  //   候选数正比于手牌张数（一手番 8 张就是 8），实测口径 2.5/局 ⇒ 与其余五行不可比、当场判红。
  const silenced = total.silence_applied ?? 0;
  assert.ok(silenced / 60 < 1,
    `封口拦截读数为每局 ${(silenced / 60).toFixed(2)} ⇒ 单位退回成候选动作数了（应 < 1 每局）`);
});
