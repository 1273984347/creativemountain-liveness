// B8 主题包对局测试（规格 §10.1 验收：4 套主题均通过校验与对局）
//
// 覆盖三件事：
//   ① 四套主题包都能装进引擎开局 —— 主题包 → State 的装配链没断
//   ② 每套主题都能跑完整回合且状态始终合法 —— 不会因主题数据崩掉
//   ③ 每套新主题的**标志性卡牌**效果在引擎里真的能执行 ——
//      §10.1 必须差异化第 ④ 项不只是「名字不同」，而是「效果独特且可运行」
//
// ⚠️ 全部在**内存副本**上操作，不读写工作区文件（负样本必须自包含）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { performAction, advanceTurn } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { applyEffect } from '../../engine/ops/registry.ts';
import { at } from './helpers.ts';

const THEME_IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'] as const;
const NEW_THEME_IDS = ['scifi-ai', 'hybrid', 'urban-psych'] as const;

function loadTheme(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

/**
 * 主题包 → 引擎 State 的装配。
 *
 * ⚠️ 用的是**引擎侧同一个** `installTheme`（数字轨 web/main.ts 也调它）——
 *   测试与生产共用一条装配链，避免「测试装配 ≠ 生产装配」的分裂。
 */
function newGame(theme: ThemePack, players: 3 | 4 | 5 | 6 | 7 | 8, seed: number): State {
  return installTheme(createInitialState({ players, seed, deckSize: theme.cards.length }), theme);
}

/** 跑若干个 round（每个存活玩家各行动一次 = 1 round，规格 §3.1）。 */
function playRounds(start: State, rounds: number): State {
  let s = start;
  for (let r = 0; r < rounds; r++) {
    for (let t = 0; t < 8; t++) {
      const seat = currentPlayer(s);
      if (seat < 0) {
        return s;
      }
      s = performAction(s, seat, 'move');
      s = advanceTurn(s, 'standard');
      if (s.outcome.finished) {
        return s;
      }
    }
  }
  return s;
}

/** 状态合法性体检（跑完一局后逐玩家核对）。 */
function assertLegal(s: State, label: string): void {
  for (const p of s.players) {
    assert.ok(Number.isFinite(p.hp) && p.hp >= 0, `${label} 座${p.seat} 体力非法：${p.hp}`);
    assert.ok(Number.isFinite(p.resource) && p.resource >= 0, `${label} 座${p.seat} 资源非法：${p.resource}`);
    assert.ok(Number.isFinite(p.shield) && p.shield >= 0, `${label} 座${p.seat} 护盾非法：${p.shield}`);
    assert.ok(
      p.position >= 0 && p.position <= s.board.length,
      `${label} 座${p.seat} 位置越界：${p.position}`,
    );
    assert.ok(p.hand.length <= p.hpMax, `${label} 座${p.seat} 手牌 ${p.hand.length} 超过上限 ${p.hpMax}`);
  }
  assert.ok(s.decks.deck.length + s.decks.discard.length >= 0, `${label} 牌堆计数异常`);
}

/** 取某玩家的状态指纹（用于「效果真的发生了」的断言）。 */
function fingerprint(s: State, seat: number): string {
  const p = s.players[seat];
  if (p === undefined) {
    return 'none';
  }
  return [p.hand.length, p.resource, p.hp, p.shield, p.position].join('/');
}

// ---------- ① 四套主题都能开局 ----------

for (const id of THEME_IDS) {
  test(`主题 ${id}：能装进引擎并开局（3 人局）`, () => {
    const theme = loadTheme(id);
    const s = newGame(theme, 3, 20261107);
    assert.equal(s.players.length, 3);
    // 棋盘按规模表格数自适应（§8 boardLength），峰顶恒在末格
    assert.equal(s.board.length, s.scales.boardLength);
    assert.equal(s.board.peakIndex, s.board.length);
    assert.equal(s.board.tiles.length, s.board.length);
    // 牌库规模按**规模表**（人数相关）组装：主题卡池不足时复制通用牌补足
    // （否则 8 人局需要 56 张而主题只有 48 张 ⇒ 最后一名玩家 0 张手牌）
    const inHand = s.players.reduce((n, p) => n + p.hand.length, 0);
    assert.equal(
      s.decks.deck.length + inHand,
      s.scales.deckTotal,
      '牌库剩余 + 手牌应等于规模表的 deckTotal',
    );
    assert.equal(s.decks.trial.length, (theme.trials ?? []).length);
    assert.equal(s.decks.creation.length, (theme.creationDeck ?? []).length);
    // 身份与阵营按主题分配（规格 §4.1 明牌竞速 ⇒ 必须可从状态读出）；
    // B10 起为**开局随机分配**，故只校验「来自主题」而不绑定具体座位
    const identityIds = new Set(theme.identities.map((i) => i.id));
    const factionIds = new Set(theme.factions.map((f) => f.id));
    assert.ok(identityIds.has(s.players[0]?.identityId ?? ''), '身份应来自主题');
    assert.ok(factionIds.has(s.players[0]?.factionId ?? ''), '阵营应来自主题');
    const faction = theme.factions.find((f) => f.id === s.players[0]?.factionId);
    assert.ok(faction !== undefined, '阵营应能在主题里找到');
    assert.ok(
      s.players[0]?.hpMax === faction.hpBase || s.players[0]?.hpMax === s.scales.handStart,
      '体力上限应来自阵营体力或规模表起始手牌下限',
    );
    // 每人都发到起始手牌（开局天机可能额外发 1 张，故用区间）
    for (const p of s.players) {
      assert.ok(
        p.hand.length >= theme.counts.handStart && p.hand.length <= p.hpMax,
        `座${p.seat} 起始手牌数 ${p.hand.length} 不在 [${theme.counts.handStart}, ${p.hpMax}] 内`,
      );
    }
    assertLegal(s, `${id} 开局`);
  });
}

// ---------- ② 四套主题都能跑完整回合 ----------

for (const id of THEME_IDS) {
  test(`主题 ${id}：跑 12 个 round 后状态仍合法`, () => {
    const theme = loadTheme(id);
    const s0 = newGame(theme, 3, 4242);
    const s1 = playRounds(s0, 12);
    assertLegal(s1, `${id} 12 round`);
    assert.ok(s1.log.length > 0, '应有回合日志');
    assert.ok(s1.round > 1, '回合数应推进');
    // 至少有人移动过（行棋生效）
    const moved = s1.players.some((p, i) => p.position !== (s0.players[i]?.position ?? 0));
    assert.ok(moved, '应有玩家位置变化');
  });
}

// ---------- ③ 标志性卡牌的效果在引擎里可执行 ----------

for (const id of NEW_THEME_IDS) {
  test(`主题 ${id}：2 张标志卡效果可执行且真的改变局面`, () => {
    const theme = loadTheme(id);
    const flags = theme.cards.filter((c) => /_u0[12]$/.test(c.id));
    assert.equal(flags.length, 2, `${id} 应有 2 张标志卡，实际 ${flags.length}`);
    for (const flag of flags) {
      const s0 = newGame(theme, 3, 99);
      const before = fingerprint(s0, 0);
      const after = applyEffect(
        { state: s0, actor: 0, sourceCard: flag },
        at(flag.effects, 0),
      ).state;
      assert.notEqual(
        fingerprint(after, 0),
        before,
        `${id} 标志卡「${flag.name}」打出后局面毫无变化——效果没生效`,
      );
      assertLegal(after, `${id} 标志卡 ${flag.name}`);
    }
  });
}

// ---------- 8 人局：牌库必须够发（盲审实测曾出现第 8 名 0 张手牌）----------

test('8 人局：每人发满起始手牌，无人空手', () => {
  const theme = loadTheme('xianxia2026');
  const s = newGame(theme, 8, 7);
  assert.equal(s.players.length, 8);
  assert.equal(s.decks.deck.length + s.players.reduce((n, p) => n + p.hand.length, 0), s.scales.deckTotal);
  for (const p of s.players) {
    assert.ok(p.hand.length >= s.scales.handStart, `座${p.seat} 应至少发 ${s.scales.handStart} 张手牌`);
    assert.ok(p.hand.length > 0, `座${p.seat} 不得空手`);
  }
  assertLegal(s, '8 人局开局');
});

// ---------- 换主题 = 换一局（不得跨主题继承半局状态）----------

test('换主题会重置局面：位置 / 标记 / 负面状态 / 待认证锁定 / 昼夜都不继承', () => {
  const theme = loadTheme('xianxia2026');
  const dirty = newGame(theme, 3, 5);
  const dirtied: State = {
    ...dirty,
    round: 7,
    turnIndex: 2,
    phaseValue: 'night',
    players: dirty.players.map((p, i) => (i === 0
      ? {
          ...p,
          position: 11,
          flags: { x: 1 },
          statuses: { poison: 2 },
          pendingCert: true,
          hp: 3,
        }
      : p)),
  };
  const fresh = installTheme(dirtied, loadTheme('scifi-ai'));
  const p0 = fresh.players[0];
  assert.ok(p0 !== undefined);
  assert.equal(fresh.round, 1, '回合数应复位');
  assert.equal(fresh.turnIndex, 0, '手番位置应复位');
  assert.ok(
    fresh.phaseValue === 'day' || fresh.phaseValue === 'night',
    '昼夜应是新一局天机决定的值（由新局天机牌决定，而非继承旧局）',
  );
  assert.equal(p0.position, 0, '位置应复位');
  // ⚠️ B12：`flags.passive` 是**新一局分配的身份被动规格**（随身份重新分配），
  //   不是上一局的临时标记 ⇒ 断言时排除它，其余标记仍须清空。
  const { passive: _passive, ...restFlags } = p0.flags;
  assert.deepEqual(restFlags, {}, '标记应清空（身份被动规格随新一局重新分配）');
  assert.deepEqual(p0.statuses, {}, '负面状态应清空');
  assert.equal(p0.pendingCert, false, '待认证锁定应解除');
  assert.equal(fresh.outcome.finished, false, '结局应复位');
});

// ---------- 天机牌在真实对局里被翻开（phase_is 不是死代码）----------

test('天机牌每回合翻开、对全场生效，昼夜状态在真实对局中可达', () => {
  const theme = loadTheme('scifi-ai');
  const s0 = newGame(theme, 3, 2026);
  let s = s0;
  const phases = new Set<string>();
  const heavenLogs: string[] = [];
  for (let r = 0; r < 10; r++) {
    for (let t = 0; t < 8; t++) {
      const seat = currentPlayer(s);
      if (seat < 0) {
        break;
      }
      s = performAction(s, seat, 'move');
      s = advanceTurn(s, 'standard');
      phases.add(s.phaseValue);
      for (const l of s.log) {
        if (l.kind === 'heaven') {
          heavenLogs.push(l.message);
        }
      }
      if (s.outcome.finished) {
        break;
      }
    }
  }
  assert.ok(heavenLogs.length > 0, '应有天机牌被翻开');
  assert.ok(
    heavenLogs.some((m) => m.includes('静默夜') || m.includes('黎明进程')),
    `天机牌日志应含昼夜牌，实际：${heavenLogs.slice(0, 3).join(' | ')}`,
  );
  assert.ok(phases.has('night'), '真实对局中应出现过夜间（phase_is 的夜间分支必须可达）');
  assertLegal(s, '10 round');
});

test('标志卡「意识分叉」：昼夜两态产生不同结果（科幻主题的机制气质）', () => {
  const theme = loadTheme('scifi-ai');
  const flag = theme.cards.find((c) => c.id === 'c_sa_u01');
  assert.ok(flag !== undefined, '应存在意识分叉');
  // 开局会翻开天机牌 ⇒ 昼夜可能已被设定；此处显式构造两种状态
  const day: State = { ...newGame(theme, 3, 7), phaseValue: 'day' };
  const night: State = { ...day, phaseValue: 'night' };
  const eff = at(flag.effects, 0);
  const dayResult = applyEffect({ state: day, actor: 0, sourceCard: flag }, eff).state;
  const nightResult = applyEffect({ state: night, actor: 0, sourceCard: flag }, eff).state;
  assert.notEqual(
    fingerprint(dayResult, 0),
    fingerprint(nightResult, 0),
    '昼夜两态必须产生不同结果',
  );
  assertLegal(dayResult, '意识分叉·昼');
  assertLegal(nightResult, '意识分叉·夜');
});
