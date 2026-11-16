// 关隘通道（规格 §3.5，B18）的回归测试。
//
// 覆盖六件事：① 待过闸判定；② 付费通道成功；③ 付费通道灵枢不足被拒；
//   ④ 试炼通道成功（抽牌 + 执行效果树）；⑤ **引擎层门禁**（停在关隘上时其它行动一律被拒）；
//   ⑥ 自动解算出口（AI / 脚本用）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { autoResolveGate, pendingGate, resolveCompareGate, resolveGate } from '../../engine/core/gate.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { candidatesOf } from '../../engine/core/legal.ts';
import type { Card, ThemePack } from '../../engine/types/theme.ts';

/** 6 号格 = 落雁关（标价 3，试炼池 t_sword / t_mirror）。 */
const GATE_INDEX = 6;
const GATE_FEE = 3;

/** 装主题并把座 0 放到关隘格上（`resource` 可调，用于灵枢不足的分支）。 */
function gateScene(resource = 10): State {
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  const s0 = installTheme(createInitialState({ players: 4, seed: 7, deckSize: 40 }), theme);
  return {
    ...s0,
    players: s0.players.map((p) => (p.seat === 0 ? { ...p, position: GATE_INDEX, resource } : p)),
  };
}

/**
 * 只保留指定试炼牌 ⇒ 让「抽哪张」变成确定。
 *
 * ⚠️ B22 起试炼是**挑战型**（可能失败）⇒ 涉及抽牌结果的断言必须固定牌堆，否则随机 ⇒  flaky。
 */
function onlyTrials(s: State, ids: readonly string[]): State {
  return { ...s, decks: { ...s.decks, trial: s.decks.trial.filter((c) => ids.includes(c.id)) } };
}

/**
 * 给座 0 塞两张**身法牌** —— `t_oath` 的判定是「至少 2 张身法牌」（B26 改造后）。
 *
 * ⚠️ B26：试炼判定从「有 ≥1 张」升级为「至少 N 张」⇒ 依赖「某张牌必过/必败」的断言
 *   必须**显式构造手牌**，否则随机 ⇒ flaky。
 */
function withMotionHand(s: State): State {
  const probe: Card[] = [
    { id: 'probe-m1', name: '探针身法一', type: 'motion', cost: 0, color: 'red', rank: 3, text: '', effects: [] },
    { id: 'probe-m2', name: '探针身法二', type: 'motion', cost: 0, color: 'black', rank: 4, text: '', effects: [] },
  ];
  return { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hand: [...probe, ...p.hand] } : p)) };
}

test('B18：停在未通过的关隘 ⇒ 待过闸判定成立；通过后失效', () => {
  const s = gateScene();
  const tile = pendingGate(s, 0);
  assert.ok(tile !== null, '座 0 站在关隘格上 ⇒ 应有待过闸');
  assert.equal(tile?.index, GATE_INDEX);
  assert.equal(tile?.gate?.fee, GATE_FEE);
  assert.equal(pendingGate(s, 1), null, '别的座位不在关隘格上 ⇒ 不待过闸');
  const paid = resolveGate(s, 0, 'pay');
  assert.equal(paid.ok, true);
  assert.equal(pendingGate(paid.state, 0), null, '通过后不再待过闸');
});

test('B18：付费通道 —— 扣标价、记通过标记', () => {
  const s = gateScene(10);
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, true, '付费通道应通过：' + String(r.note));
  assert.equal(r.passed, true);
  const p0 = r.state.players[0];
  assert.equal(p0?.resource, 10 - GATE_FEE, '应扣掉标价');
  assert.equal(p0?.flags[`gate_${String(GATE_INDEX)}`], true, '应记录通过标记');
});

test('B18：付费通道 —— 灵枢不足 ⇒ 拒绝且状态不变', () => {
  const s = gateScene(1);
  const r = resolveGate(s, 0, 'pay');
  assert.equal(r.ok, false, '灵枢不足必须被拒');
  assert.equal(r.state, s, '被拒时状态必须原样返回（无副作用）');
  // B79 §5.1：引擎交出的是**占位符形态**，所以判据也跟着转形式（不是放宽——玩家看到的
  //   句子由出口展开，那条正面断言在 tests/engine/card-cost.test.ts 的 B65/A-5b 与 T14 的 R3）。
  assert.match(String(r.note), /\{resource\}不足/, '资源不足必须点名（R-2 拒绝要说人话）');
});

test('B18：试炼通道 —— 公开抽牌 + 执行效果树 + 记通过标记', () => {
  // ⚠️ B22：试炼已是**挑战型**（可能失败）⇒ 固定「只留一张必过的牌」保持确定性。
  const s = withMotionHand(onlyTrials(gateScene(10), ['t_oath']));
  const r = resolveGate(s, 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应通过：' + String(r.note));
  const p0 = r.state.players[0];
  assert.equal(p0?.flags[`gate_${String(GATE_INDEX)}`], true, '应记录通过标记');
  assert.ok(typeof p0?.flags[`trial_${String(GATE_INDEX)}`] === 'string', '应记录抽到的试炼牌 id');
  assert.ok(r.state.log.some((l) => l.kind === 'trial'), '应留下试炼日志');
});

test('B18：引擎层门禁 —— 停在关隘上时，行棋/问天/出牌一律被拒', () => {
  const s = gateScene();
  assert.equal(performAction(s, 0, 'move'), s, '关隘未过时不得行棋（否则可反复移动免费穿关）');
  assert.equal(performAction(s, 0, 'ask'), s, '关隘未过时不得问天');
  assert.equal(performAction(s, 0, 'act', { cardId: 'x' }), s, '关隘未过时不得出牌');
});

test('B18-c：关隘试炼发的牌当场裁到手牌上限（结算期通道选择不破坏手牌上限）', () => {
  // ⚠️ 根因（实测定位）：超限者**全部停在关隘格**、且只超 **1 张牌**
  //   ⇒ 关隘 6 的试炼牌 `t_sword` 无论成败都 `draw_cards(1)`；
  //   而试炼通道发生在**手番结算之后** ⇒ 手番末的裁牌已跑完、回合末裁牌又被阻塞延后 ⇒ 超限。
  const s = gateScene(1); // 灵枢 1 ⇒ 付费不够，只能走试炼
  const p0 = s.players[0];
  assert.ok(p0 !== undefined);
  // 把座 0 的手牌填满上限（不填满则「超限」测不出来）
  const full = { ...p0, hand: [...p0.hand, ...p0.hand].slice(0, p0.hpMax) };
  const fullState = { ...s, players: s.players.map((p) => (p.seat === 0 ? full : p)) };
  assert.equal(fullState.players[0]?.hand.length, fullState.players[0]?.hpMax, '前置：手牌应已满');
  const r = resolveGate(fullState, 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应通过：' + String(r.note));
  const after = r.state.players[0];
  assert.ok(
    (after?.hand.length ?? 99) <= (after?.hpMax ?? 0),
    '试炼发的牌必须当场裁到手牌上限内：' + String(after?.hand.length) + '/' + String(after?.hpMax),
  );
});

test('B19：出牌比对通道 —— 胜则通过、败则退 1 格并被封口、平局同败', () => {
  // 场景：座 0 站在关隘 6，座 1 是对手；双方手牌顶的颜色由测试指定。
  const scene = (myColor: 'red' | 'black', theirColor: 'red' | 'black'): State => {
    const s = gateScene(1);
    const me = s.players[0];
    const foe = s.players[1];
    assert.ok(me !== undefined && foe !== undefined);
    const myCard = me.hand[0];
    const theirCard = foe.hand[0];
    assert.ok(myCard !== undefined && theirCard !== undefined);
    return {
      ...s,
      players: s.players.map((p) => {
        if (p.seat === 0) { return { ...p, hand: [{ ...myCard, color: myColor, rank: 9 }, ...p.hand.slice(1)] }; }
        if (p.seat === 1) { return { ...p, hand: [{ ...theirCard, color: theirColor, rank: 5 }, ...p.hand.slice(1)] }; }
        return p;
      }),
    };
  };
  // 红 > 黑 ⇒ 胜 ⇒ 通过关隘
  const win = resolveCompareGate(scene('red', 'black'), 0, scene('red', 'black').players[0]?.hand[0]?.id ?? '', 1);
  assert.equal(win.ok, true, '比对应被受理：' + String(win.note));
  assert.equal(win.passed, true, '红牌胜出 ⇒ 通过关隘');
  assert.equal(win.state.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true, '应记录通过标记');
  // 黑 < 红 ⇒ 败 ⇒ 退 1 格并被封口
  const s2 = scene('black', 'red');
  const lose = resolveCompareGate(s2, 0, s2.players[0]?.hand[0]?.id ?? '', 1);
  assert.equal(lose.ok, true);
  assert.equal(lose.passed, false, '败北不应通过');
  assert.equal(lose.state.players[0]?.position, GATE_INDEX - 1, '败北 ⇒ 退 1 格');
  assert.equal(lose.state.players[0]?.statuses.silence ?? 0, 1, '败北 ⇒ 被封口 1 回合');
  // 目标为自己 / 目标已出局 ⇒ 被拒
  const s3 = scene('red', 'black');
  const cardId = s3.players[0]?.hand[0]?.id ?? '';
  assert.equal(resolveCompareGate(s3, 0, cardId, 0).ok, false, '不能与自己比对');
});

test('B19-b：试炼失败 ⇒ 本关改为付费（此后只剩付费通道，付不起则判未通过放行）', () => {
  // 场景：座 0 站在 30 号关隘（B22 后 t_toll 在其试炼池）。
  // ⚠️ 只有 **7–8 人局**才是 36 格 / 4 座关隘（规模表 §8 gateCount=4）⇒ 本场景用 8 人局；
  //   4 人局只有 28 格 / 3 座关隘，30 号格会被 fitBoard **降级为普通格** ⇒ 根本不是关隘。，灵枢 0 ⇒ 付费不可用 ⇒ 走试炼。
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as ThemePack;
  const s0 = installTheme(createInitialState({ players: 8, seed: 7, deckSize: 40 }), theme);
  const toll = s0.decks.trial.find((c) => c.id === 't_toll');
  assert.ok(toll !== undefined, '主题包应有 t_toll 试炼牌');
  const scene: State = {
    ...s0,
    // 只留 t_toll ⇒ 抽取必中（避免随机性让断言不稳定）
    decks: { ...s0.decks, trial: s0.decks.trial.filter((c) => c.id === 't_toll') },
    // ⚠️ B26：t_toll 的判定是「至少 2 张守御+红牌」⇒ **清空手牌**才能确定它必败。
    players: s0.players.map((p) => (p.seat === 0 ? { ...p, position: 30, resource: 0, hand: [] } : p)),
  };
  const r = resolveGate(scene, 0, 'trial');
  assert.equal(r.ok, true, '试炼通道应被受理：' + String(r.note));
  assert.equal(r.passed, false, '灵枢不足 ⇒ 试炼未通过');
  assert.equal(r.state.players[0]?.flags['gate_pay_30'], true, '应标记「本关改为付费」');
  assert.notEqual(r.state.players[0]?.flags['gate_30'], true, '未通过 ⇒ 不写通过标记');
  // 仍停在关隘上，但**只剩付费通道**（粗筛只发 pay）。
  assert.ok(pendingGate(r.state, 0) !== null, '未通过时玩家仍停在关隘');
  const candidates = candidatesOf(r.state, 0).filter((a) => a.type === 'GATE_RESOLVE');
  assert.deepEqual(candidates.map((a) => (a.type === 'GATE_RESOLVE' ? a.channel : '')), ['pay'],
    '本关已改为付费 ⇒ 只应剩付费通道');
  // 付费仍不足 ⇒ 判未通过并放行（不留死循环）。
  const poor = resolveGate(r.state, 0, 'pay');
  assert.equal(poor.ok, true);
  assert.equal(poor.passed, false);
  assert.equal(poor.state.players[0]?.flags['gate_fail_30'], true, '应写「未通过并放行」标记');
  assert.equal(pendingGate(poor.state, 0), null, '放行后不再停在关隘');
});

test('B18：自动解算出口 —— 灵枢够就付费，不够走试炼', () => {
  const rich = autoResolveGate(gateScene(10), 0);
  assert.equal(rich.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true);
  assert.equal(rich.players[0]?.resource, 10 - GATE_FEE, '灵枢够 ⇒ 自动付费');
  // ⚠️ B22：灵枢不足 ⇒ 自动走试炼；B26：试炼判定升级为「至少 2 张身法牌」⇒ 固定「只留 t_oath」并**显式构造手牌**。
  const poor = autoResolveGate(withMotionHand(onlyTrials(gateScene(2), ['t_oath'])), 0);
  assert.equal(poor.players[0]?.flags[`gate_${String(GATE_INDEX)}`], true, '灵枢不足 ⇒ 自动走试炼');
  assert.equal(poor.players[0]?.resource, 2, '试炼通道不扣灵枢（灵枢 2 原样保留）');
});
