// 身份被动的**触发点与消费点**（规格 §4.1 权威被动表，B12）。
//
// ⚠️ B12 之前：这 7 个被动的 op 只出现在主题包里，引擎**没有任何消费点**
//   ⇒ 机制看着实现、实际永不触发（「只写不读」死机制）。本文件钉住每个被动的触发点。
//
// 另有一条**真实对局可达**断言在 `balance-regression.test.ts`（读模拟报告的被动触发统计）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { abilityAvailability, passiveOf } from '../../engine/core/passives.ts';
import { performAction, finishTurn } from '../../engine/core/turn-runner.ts';
import { enterPendingCertification, certifyChallenge, signatureCount } from '../../engine/core/certification.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 造一局（4 人，仙侠主题）。 */
function game(seed = 7): State {
  const base = createInitialState({ players: 4, seed, deckSize: theme.cards.length });
  return installTheme(base, theme);
}

/** 给某座位直接授予被动规格（绕过随机分配，便于精确测某个被动的消费点）。 */
function withPassive(s: State, seat: number, passive: unknown): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, passive } } : p)) };
}

// ---------- 授予 ----------

test('B12：分配身份时把被动规格授予玩家（否则被动永不触发）', () => {
  const s = game(11);
  for (const p of s.players) {
    assert.ok(passiveOf(s, p.seat) !== undefined, '座' + p.seat + ' 应持有被动规格');
  }
});

// ---------- 开拓者：每回合首次移动 +1 格 ----------

test('B12：开拓者 —— 行棋时本回合首次移动 +1 格', () => {
  const s = withPassive(game(3), 0, { op: 'move_forward', amount: 1 });
  const next = performAction(s, 0, 'move');
  const dice = next.lastDice;
  const peak = next.board.peakIndex;
  assert.equal(next.players[0]?.position, Math.min(peak, dice + 1), '位置应 = 骰子 + 1（受峰顶钳制）');
  assert.ok(next.log.some((l) => l.message.startsWith('[被动:move_forward]')), '应有被动日志');
});

// ---------- 匠师：每场限 1 次免费造物 ----------

test('B12：匠师 —— 免费造物（从造物牌堆取牌加入手牌，不花灵枢）', () => {
  const s = withPassive(game(5), 0, { op: 'create_card', cardId: 'c_talisman' });
  const before = s.players[0]?.hand.length ?? 0;
  const creationBefore = s.decks.creation.length;
  const r = performAbility(s, 0);
  assert.equal(r.ok, true, '应发动成功：' + r.note);
  assert.equal(r.state.players[0]?.hand.length, before + 1, '手牌 +1');
  assert.equal(r.state.decks.creation.length, creationBefore - 1, '造物牌堆 -1');
  assert.equal(r.state.players[0]?.counters.freeCreates, 1, '每场次数计数 +1');
  // 每场限 1 次 ⇒ 第二次不可用
  assert.equal(abilityAvailability(r.state, 0).usable, false, '每场限 1 次');
});

// ---------- 观星者：每回合可看牌堆顶 1 张 ----------

test('B12：观星者 —— 看牌堆顶 1 张（牌面记入 flags.peeked，供 UI 显示）', () => {
  const s = withPassive(game(6), 0, { op: 'peek_deck', count: 1 });
  const r = performAbility(s, 0);
  assert.equal(r.ok, true, '应发动成功：' + r.note);
  const peeked = r.state.players[0]?.flags.peeked as { name: string; color: string }[] | undefined;
  assert.ok(Array.isArray(peeked) && peeked.length === 1, '应窥视到 1 张牌');
  assert.ok(typeof peeked?.[0]?.color === 'string', '应含颜色（险径判色用）');
  // 每回合 1 次 ⇒ 同回合不可再发动
  assert.equal(abilityAvailability(r.state, 0).usable, false, '每回合限 1 次');
});

// ---------- 守夜人：回合结束获得 1 点护盾 ----------

test('B12：守夜人 —— 回合结束时获得 1 点护盾', () => {
  const s = withPassive(game(8), 0, { op: 'shield', amount: 1 });
  const before = s.players[0]?.shield ?? 0;
  const next = finishTurn(s, 0);
  assert.equal(next.players[0]?.shield, before + 1, '护盾 +1');
  assert.ok(next.log.some((l) => l.message.startsWith('[被动:shield]')), '应有被动日志');
});

// ---------- 窃火者：每回合可偷 1 枚灵枢 ----------

test('B12：窃火者 —— 偷取目标 1 枚灵枢（目标 −1、自己 +1）', () => {
  const s = withPassive(game(9), 0, { op: 'transfer_resource', amount: 1, target: 0 });
  const rich = s.players[1];
  assert.ok(rich !== undefined && rich.resource >= 1, '目标须有灵枢');
  const r = performAbility(s, 0, 1);
  assert.equal(r.ok, true, '应发动成功：' + r.note);
  assert.equal(r.state.players[1]?.resource, (rich.resource ?? 0) - 1, '目标 −1');
  assert.equal(r.state.players[0]?.resource, (s.players[0]?.resource ?? 0) + 1, '自己 +1');
});

test('B12：窃火者 —— 不选目标 / 目标无灵枢 ⇒ 发动失败（不消耗行动）', () => {
  const s = withPassive(game(9), 0, { op: 'transfer_resource', amount: 1, target: 0 });
  assert.equal(performAbility(s, 0).ok, false, '未选目标应失败');
  const poor = { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, resource: 0 } : p)) };
  assert.equal(performAbility(poor, 0, 1).ok, false, '目标无灵枢应失败');
});

// ---------- 织梦者：每回合 1 次改自己的险径判定 ----------

test('B12：织梦者 —— 改写自己的险径判定为安全（消费点在 hazard 结算）', () => {
  const s = withPassive(game(10), 0, { op: 'modify_judgement', target: 0 });
  const r = performAbility(s, 0);
  assert.equal(r.ok, true, '应发动成功：' + r.note);
  assert.equal(r.state.players[0]?.flags.judgementModified, true, '应挂上改判定标记');
  // 落到险径格 ⇒ 安全通过（不扣体力）且标记被消费
  const hazard = r.state.board.tiles.find((t) => t.kind === 'hazard');
  assert.ok(hazard !== undefined, '主题棋盘应有险径格');
  const onHazard: State = {
    ...r.state,
    players: r.state.players.map((p) => (p.seat === 0 ? { ...p, position: hazard.index } : p)),
  };
  const hpBefore = onHazard.players[0]?.hp ?? 0;
  const after = finishTurn(onHazard, 0);
  assert.equal(after.players[0]?.hp, hpBefore, '体力不应减少（判定被改写为安全）');
  assert.equal(after.players[0]?.flags.judgementModified, false, '标记应被消费');
});

// ---------- 山主：认证时首次被质疑自动通过 ----------

test('B12：山主 —— 进入待认证时挂免质疑标记，首次被质疑自动视为签印', () => {
  const s = withPassive(game(12), 0, { op: 'certify_free_pass' });
  const entered = enterPendingCertification(s, 0);
  assert.equal(entered.ok, true);
  assert.equal(entered.state.players[0]?.flags.certifyFreePass, true, '应挂上免质疑标记');
  // 认证人（座 1）发起质疑 ⇒ 自动视为签印
  const withRes = { ...entered.state, players: entered.state.players.map((p) => (p.seat === 1 ? { ...p, resource: 5 } : p)) };
  const ch = certifyChallenge(withRes, 1, 0);
  assert.equal(ch.ok, true, '质疑应成立：' + ch.note);
  assert.equal(signatureCount(ch.state, 0), 1, '待认证者应获得 1 枚签印');
  assert.equal(ch.state.players[0]?.flags.certifyFreePass, false, '标记应被消费（仅首次）');
  assert.ok(ch.state.certification.signed.includes(1), '认证人本轮机会应视为已用');
});
