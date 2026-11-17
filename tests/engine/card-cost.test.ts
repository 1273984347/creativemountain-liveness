// B65 · G-a：出牌费用语义（付费 + 灵枢不足即拒绝）
//
// ⚠️ 规格裁定（B65）：出牌**付费** —— 打出卡牌须支付该牌的 `cost`（规格 §3.1「行事」/§4.3）
//   ⇒ **灵枢不足 ⇒ 引擎拒绝该动作**（不扣、不出牌、状态不变）。
//   ⚠️ 此前（本次裁定前）：引擎 `act` 分支**既不校验也不扣**、UI 只显示不拦、
//   只有模拟器把 `cost <= resource` 当资格线 ⇒ 数字轨可**免费出牌**。
//
// ⚠️ 本文件钉住四层，缺一层就有一层可能悄悄漂回：
//   ① **引擎扣费环**：打出后灵枢恰好减 `cost`，手牌少一张；
//   ② **引擎拒绝环**：灵枢不足 ⇒ 状态**逐字不变**（不扣、不弃牌、不结算效果）；
//   ③ **UI 拒因**：`uiBlockNotice` 必须点名「灵枢不足」且给出差额（R-2 拒绝要说人话）；
//   ④ **枚举口径**：资源不足的牌**不得**出现在 `getLegalActions` 里（引擎自己拒 ⇒ 试跑如实反映）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import type { Card, ThemePack } from '../../engine/types/theme.ts';
import { createInitialState, type State } from '../../engine/core/state.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { uiAllows, uiBlockNotice } from '../../web/legal-gate.ts';
import { termExpander } from '../../web/ui/terms.ts';

const theme = JSON.parse(
  readFileSync(resolve(process.cwd(), 'themes', 'xianxia2026', 'theme.json'), 'utf8'),
) as ThemePack;

/** 取主题里第一张指定 cost 的牌（cost 是真值 ⇒ 四套主题都有）。 */
function cardOfCost(cost: number): Card {
  const card = theme.cards.find((c) => c.cost === cost);
  assert.ok(card !== undefined, '前提：主题里必须存在 cost=' + String(cost) + ' 的牌');
  return card;
}

/** 座 0 手里有指定卡、灵枢给定的局面。 */
function scene(card: Card, resource: number): State {
  const s0 = createInitialState({ players: 3, seed: 5, deckSize: 40 });
  return {
    ...s0,
    players: s0.players.map((p, i) => (i === 0 ? { ...p, hand: [card], resource } : p)),
  };
}

test('B65/A-1 引擎扣费环：打出卡牌 ⇒ 灵枢恰好减 cost，手牌少一张', () => {
  const card = cardOfCost(2);
  const s = scene(card, 5);
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.equal(r.players[0]?.resource, 3,
    '[B65/A-1 引擎扣费环] 打出 cost=' + String(card.cost) + ' 的牌 ⇒ 灵枢应从 5 减到 3');
  assert.equal(r.players[0]?.hand.length, 0,
    '[B65/A-1 引擎扣费环] 牌应已打出（手牌少一张）');
  assert.notEqual(r, s, '[B65/A-1 引擎扣费环] 状态应已改变（引用不等）');
});

test('B65/A-2 引擎拒绝环：灵枢不足 ⇒ 状态逐字不变（不扣、不弃牌、不结算效果）', () => {
  const card = cardOfCost(3);
  const s = scene(card, 1);   // 只有 1 灵枢，打 cost=3 的牌
  const r = performAction(s, 0, 'act', { cardId: card.id });
  // ⚠️ **引用相等**是 `performAction` 唯一的被拒信号（probe.ts 认的就是它）
  assert.equal(r, s,
    '[B65/A-2 引擎拒绝环] 灵枢不足 ⇒ 必须原样返回（引用相等）⇒ 探针才认得出「被拒」');
  assert.equal(r.players[0]?.resource, 1,
    '[B65/A-2 引擎拒绝环] 灵枢不足时**不得**扣费');
  assert.equal(r.players[0]?.hand.length, 1,
    '[B65/A-2 引擎拒绝环] 灵枢不足时**不得**弃牌（牌还在手里）');
});

test('B65/A-3 边界：灵枢**恰好等于** cost ⇒ 允许打出（余额归零，不得误拒）', () => {
  const card = cardOfCost(2);
  const s = scene(card, 2);
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.notEqual(r, s, '[B65/A-3 边界] 灵枢恰好等于 cost ⇒ 必须允许打出');
  assert.equal(r.players[0]?.resource, 0,
    '[B65/A-3 边界] 打出后灵枢应为 0');
  assert.equal(r.players[0]?.hand.length, 0, '[B65/A-3 边界] 牌应已打出');
});

test('B65/A-4 零费牌：cost=0 的牌打出不扣灵枢（不得因「扣费」误扣）', () => {
  const card = cardOfCost(0);
  const s = scene(card, 3);
  const r = performAction(s, 0, 'act', { cardId: card.id });
  assert.notEqual(r, s, '[B65/A-4 零费牌] cost=0 的牌必须能打出');
  assert.equal(r.players[0]?.resource, 3,
    '[B65/A-4 零费牌] cost=0 ⇒ 灵枢不得减少');
});

test('B65/A-5 UI 拒因：灵枢不足 ⇒ uiBlockNotice 必须点名「灵枢不足」并给出差额', () => {
  const card = cardOfCost(3);
  const s = scene(card, 1);
  const action = { type: 'PLAY_CARD' as const, actor: 0, cardId: card.id };
  const notice = uiBlockNotice(s, 0, action);
  assert.ok(notice !== null, '[B65/A-5 UI 拒因] 灵枢不足 ⇒ UI 必须拦下');
  // B79 §5.1：UI 拒因现在交出去的是**占位符形态**（由 notice 出口展开）⇒ 判据跟着转形式，
  //   「点名资源不足 + 给出差额」这两条要求一字没放宽；玩家真正看到的句子由 A-5b 正面钉。
  assert.match(notice ?? '', /\{resource\}不足/,
    '[B65/A-5 UI 拒因] 拒绝要说人话（R-2）⇒ 必须点名资源不足');
  assert.match(notice ?? '', /3/,
    '[B65/A-5 UI 拒因] 必须给出所需费用（3），不能只说「不够」');
  assert.match(notice ?? '', /1/,
    '[B65/A-5 UI 拒因] 必须给出玩家现有资源（1），玩家才知道差多少');
  assert.equal(uiAllows(s, 0, action), false,
    '[B65/A-5 UI 拒因] uiAllows 必须与 uiBlockNotice 同判');
});

// B79 §5.1：拒因换成占位符形态后，这条钉住「换了取词层，基准主题玩家看到的句子一字不变」。
// 这里的「灵枢」是**展开结果**（不是 UI 持有的文案），按红线**不许中性化**。
test('B65/A-5b UI 拒因展开后仍点名「灵枢不足」并给出差额（换架构不换文案）', () => {
  const card = cardOfCost(3);
  const s = scene(card, 1);
  const action = { type: 'PLAY_CARD' as const, actor: 0, cardId: card.id };
  const raw = uiBlockNotice(s, 0, action);
  assert.ok(raw !== null, '[B65/A-5b] 资源不足 ⇒ UI 必须拦下');
  const shown = termExpander(theme.terms)(raw ?? '');
  assert.match(shown, /灵枢不足/, '[B65/A-5b] 玩家看到的仍然点名「灵枢不足」（R-2 拒绝要说人话）');
  assert.match(shown, /需 3 灵枢/, '[B65/A-5b] 费用数字与资源名仍然同句出现');
  assert.match(shown, /你只有 1/, '[B65/A-5b] 仍然给出现有资源，玩家才知道差多少');
  assert.equal(/\{/.test(shown), false, `[B65/A-5b] 展开后不得残留占位符：${shown}`);
});

test('B65/A-6 UI 放行：灵枢足够 ⇒ 不得拦（否则玩家永远打不出牌）', () => {
  const card = cardOfCost(2);
  const s = scene(card, 5);
  const action = { type: 'PLAY_CARD' as const, actor: 0, cardId: card.id };
  assert.equal(uiAllows(s, 0, action), true,
    '[B65/A-6 UI 放行] 灵枢足够 ⇒ UI 必须放行');
  assert.equal(uiBlockNotice(s, 0, action), null,
    '[B65/A-6 UI 放行] uiBlockNotice 必须返回 null');
});

test('B65/A-7 枚举口径：资源不足的牌不得出现在 getLegalActions 里（引擎自己拒 ⇒ 试跑如实反映）', () => {
  const card = cardOfCost(3);
  const s = scene(card, 1);   // 打不起
  const actions = getLegalActions(s, 0);
  const cardActions = actions.filter((a) => a.type === 'PLAY_CARD' && a.cardId === card.id);
  assert.deepEqual(cardActions, [],
    '[B65/A-7 枚举口径] 灵枢不足的牌不得被枚举（引擎拒绝 ⇒ 试跑如实反映）');

  const ok = scene(card, 3);   // 打得起
  const okCardActions = getLegalActions(ok, 0)
    .filter((a) => a.type === 'PLAY_CARD' && a.cardId === card.id);
  assert.equal(okCardActions.length, 1,
    '[B65/A-7 枚举口径] 灵枢足够时该牌**必须**被枚举（否则模型与玩家都打不出）');
});

// ================= 变异自证：证明上面 7 条断言**真的有判别力** =================
//
// ⚠️ 为什么必须做（E113 同族）：断言「本来就绿」不证明它能抓住回归 ⇒ 每个关键环节都要一个 mutant。
//   ⚠️ 副本纪律（E23 / E15）：共享工作树**只读**；副本须含**被 mutant 影响的那个测试文件**
//   及其依赖 ⇒ 直接复制整个 tests/engine + web + tools + themes；
//   **直接运行副本里的测试文件**（不用 `node --test`）⇒ 在测试文件内再调用 --test 会被 Node
//   跳过（「run() is being called recursively」）⇒ 退出码恒 0 ⇒ 误判「没有专属锁」；
//   **清掉 `NODE_TEST_CONTEXT`** ⇒ 否则子进程用 TAP reporter ⇒ 失败消息不在输出里；
//   失败详情 **stdout 与 stderr 两路都收**。

/** 副本里跳过变异自证（否则副本会再跑变异 ⇒ 递归）。 */
const SKIP_MUTATION = process.env['CM_SKIP_MUTATION'] === '1';

/** 在**隔离副本**里跑 mutant ⇒ 断言「被这一层专属措辞打红」。 */
function runMutant(
  mutate: (dir: string) => void,
): { code: number; out: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-b65-'));
  const entry = 'tests/engine/card-cost.test.ts';
  try {
    cpSync(resolve('engine'), resolve(dir, 'engine'), { recursive: true });
    cpSync(resolve('themes'), resolve(dir, 'themes'), { recursive: true });
    cpSync(resolve('tools'), resolve(dir, 'tools'), { recursive: true });
    // ⚠️ **web/ 必须复制**：mutant 改的是 `web/legal-gate.ts` ⇒ 副本缺它 ⇒ patch 直接 ENOENT
    cpSync(resolve('web'), resolve(dir, 'web'), { recursive: true });
    mkdirSync(resolve(dir, 'tests'), { recursive: true });
    cpSync(resolve('tests/engine'), resolve(dir, 'tests/engine'), { recursive: true });
    cpSync(resolve('package.json'), resolve(dir, 'package.json'));
    cpSync(resolve('tsconfig.json'), resolve(dir, 'tsconfig.json'));
    mutate(dir);
    try {
      const env: Record<string, string> = { ...process.env as Record<string, string>, CM_SKIP_MUTATION: '1' };
      delete env['NODE_TEST_CONTEXT'];
      const out = execFileSync(process.execPath, [entry], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
        env,
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return {
        code: typeof err.status === 'number' ? err.status : -1,
        out: String(err.stdout ?? '') + '\n' + String(err.stderr ?? ''),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 在副本里做一次「唯一一处」的文本替换，替换不到就当场失败（避免 mutant 静默变成空操作）。 */
function patchCopy(dir: string, rel: string, from: string, to: string): void {
  const p = resolve(dir, rel);
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes(from), 'mutant 必须在 ' + rel + ' 里找到目标片段：' + from);
  writeFileSync(p, src.replace(from, to));
}


test('[B65-M1 变异自证] 撤掉引擎扣费 ⇒ 扣费环必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/turn-runner.ts',
      '      const paid = spendResource(next, seat, card.cost);',
      '      const paid = { ok: true as const, state: next };');
  });
  assert.notEqual(r.code, 0,
    '[B65-M1 变异自证] mutant（撤掉扣费）必须让测试变红 —— 否则扣费环没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B65\/A-1/.test(r.out),
    '[B65-M1 变异自证] mutant 必须红在「扣费环」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B65-M2 变异自证] 撤掉引擎的资源不足拒绝 ⇒ 拒绝环必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    patchCopy(dir, 'engine/core/turn-runner.ts',
      '      if (!paid.ok) { return state; }',
      '      if (!paid.ok) { next = paid.state; }');
  });
  assert.notEqual(r.code, 0,
    '[B65-M2 变异自证] mutant（撤掉拒绝）必须让测试变红 —— 否则拒绝环没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B65\/A-2/.test(r.out),
    '[B65-M2 变异自证] mutant 必须红在「拒绝环」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B65-M3 变异自证] UI 拒因不再点名资源不足 ⇒ UI 层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    // B79 T12：拒因改占位符形态 ⇒ before 串必须逐字跟着换（否则 patch 找不到模式、
    // mutant ≡ 原代码、r.code===0 ⇒ M3 假绿）。逐字一致性由
    // tests/gates/theme-word-runtime.test.ts 的「M3 before 串等于当前行」常驻钉住。
    patchCopy(dir, 'web/legal-gate.ts',
      "        return `{resource}不足：打出「${card.name}」需 ${String(card.cost)} {resource}，你只有 ${String(me.resource)}。`;",
      "        return '这张牌现在打不出来。';");
  });
  assert.notEqual(r.code, 0,
    '[B65-M3 变异自证] mutant（拒因不说人话）必须让测试变红 —— 否则 UI 层没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B65\/A-5/.test(r.out),
    '[B65-M3 变异自证] mutant 必须红在「UI 拒因」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});

test('[B65-M4 变异自证] 引擎不扣费（回到免费出牌）⇒ 枚举口径层必须判红', { skip: SKIP_MUTATION }, () => {
  const r = runMutant((dir) => {
    // 撤掉拒绝 ⇒ 打不起的牌会被试跑判为「接受」⇒ 进入枚举 ⇒ A-7 必须红
    patchCopy(dir, 'engine/core/turn-runner.ts',
      '      if (!paid.ok) { return state; }',
      '      if (!paid.ok) { next = paid.state; }');
  });
  assert.notEqual(r.code, 0,
    '[B65-M4 变异自证] mutant（免费出牌）必须让测试变红 —— 否则枚举口径没有专属锁');
  assert.ok(/AssertionError[^\n]*\[B65\/A-7/.test(r.out),
    '[B65-M4 变异自证] mutant 必须红在「枚举口径」层的专属措辞上；out 前 900 字=' + r.out.slice(0, 900));
});
