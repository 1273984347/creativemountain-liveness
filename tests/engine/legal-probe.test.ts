// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedState, probeAction } from '../../engine/core/probe.ts';
import { performAction } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { startDuel } from '../../engine/core/duel.ts';
import {
  appealedScene, challengedScene, councilScene, lockedScene, mk, pendingScene,
} from './fixtures.ts';
import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';

test('隔离（常驻）：试跑不得推进原 state 的随机源——第 ⑨ 门确定性的护栏', () => {
  // ⚠️ 起点必须先推进一次再取快照：`createInitialState` 全程不掷骰，
  //   新建状态的 `rng.snapshot()` **逐字等于 seed**（实测 mk().rng.snapshot() === 7）。
  //   那种状态下「续接快照」`Rng.fromSnapshot(initialSeed, snapshot)` 与
  //   「重置成新序列」`new Rng(state.seed)` 完全不可区分 ⇒ 下面第 1 条断言会退化成恒真。
  //   探针要防的恰恰是「重置」式实现，所以先掷一次移动骰把起点推到 seed 之外。
  const s = performAction(mk(), 0, 'move');
  const before = s.rng.snapshot();
  assert.notEqual(before, s.seed,
    '起点自查：before 必须已偏离 seed（原 state 的随机源已被推进），否则「同一起点」那条断言对 new Rng(seed) 也成立');
  const iso = isolatedState(s);
  assert.equal(iso.rng.snapshot(), before,
    '隔离必须是**从同一起点续接**：iso.rng 的调用前快照须逐字等于 before（写成 new Rng(state.seed) 就是另起一条新序列，本条判红）');
  performAction(iso, 0, 'move');   // 内部掷移动骰
  performAction(iso, 0, 'ask');    // 内部掷指令骰
  assert.equal(s.rng.snapshot(), before, '原实例 rng 必须逐字不变');
  assert.notEqual(iso.rng.snapshot(), before, '探针实例必须被推进（否则两者共享同一实例）');
});

// ============================ Task 4：probeAction 适配三种拒绝表达 ============================
//
// 引擎表达「这个动作我不接受」共有**三条互不相同的通道**，探针必须逐条对上：
//   ① `performAction`（行棋/问天/行事）**没有返回标记** ⇒ 唯一判据是**返回引用等于入参**
//      （其每个拒绝分支都 `return state`，turn-runner.ts:182/186/223/226/229）；
//   ② `performAbility` / `castVote` / `certify*` 返回 `{ok, state, note}` ⇒ 判 `ok`，
//      并额外把「ok=true 但状态没变」也算拒；
//   ③ `PASS` 走 `advanceTurn`（同样无标记，但**引用变化不等于被接受**——round 末、
//      裁牌、日志都会产出新对象）⇒ 只能判**手番是否真的推进**（turnIndex 或 round 变了）。
//
// ⚠️ 场景一律来自 fixtures（认证字段绝不手拼），对峙也走真实入口 `startDuel`。

test('试跑：非法动作必被拒（通道 ① 引用相等 / 通道 ② ok=false）', () => {
  const s = mk();
  assert.equal(probeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: 'no_such_card' }).ok, false);
  assert.equal(probeAction(s, { type: 'VOTE', actor: 0, target: 1 }).ok, false, '山议未开 ⇒ castVote.ok=false');
  assert.equal(probeAction(s, { type: 'ABILITY', actor: 0, abilityId: 'peek_deck' }).ok, false, '未授予被动 ⇒ ok=false');
  assert.equal(probeAction(s, { type: 'CERTIFY_SIGN', actor: 0, target: 1 }).ok, false, '无待认证者 ⇒ fail');
  // 通道 ① 的正面样本：待认证锁定者连「行棋」都不该被接受，且引擎是以**原样返回**表达的
  assert.equal(probeAction(lockedScene(), { type: 'MOVE', actor: 0, steps: 0 }).ok, false,
    '§5.1 待认证锁定 ⇒ performAction 的 move 分支 return state（引用相等）');
});

test('试跑：COMPARE 必拒且拒因点名 B14（关隘入口在全仓无调用点）', () => {
  const r = probeAction(mk(), { type: 'COMPARE', actor: 0, cardId: 'c', target: 1 });
  assert.equal(r.ok, false);
  // 引擎事实：关隘两条通道 payGate / drawTrial（gate.ts:33/55）**除自身定义外零引用**，
  // COMPARE 没有任何可试跑的入口 ⇒ 只能显式判拒，不能伪装成「引擎拒绝了」。
  assert.match(r.reason, /B14/, '拒因必须点名 B14，让下游知道自己撞上的是未接线而非规则拒绝');
});

test('试跑：PASS 判据＝手番是否真的推进——mk() 上 PASS 合法（计划里那条拒因经实测不成立）', () => {
  const s = mk();
  // ⚠️ 计划 Task 4 Step 1 写的是 `probeAction(mk(), {type:'PASS', actor:0}).ok === false`，
  //   理由「座 0 不是当前手番 ⇒ 不推进」。**两条都不成立**：
  //   · `createInitialState` 的 `turnOrder` 就是座位序、`turnIndex` 为 0
  //     ⇒ `currentPlayer(mk()) === 0`（下面自查钉住）；
  //   · 更根本的是 **`advanceTurn(state, mode)` 没有 actor 参数**，
  //     「谁提交 PASS」引擎从不看，所以「不是当前手番」在引擎里根本不是一个可拒绝的理由。
  //   实测 `advanceTurn(mk(), 'standard')` 把 turnIndex 从 0 推到 1 ⇒ PASS **合法**。
  //   断言因此改成「合法（手番确实推进）」，另用下面一条把**真·被拒**的 PASS 钉住。
  assert.equal(currentPlayer(s), 0, '前提自查：mk() 的当前手番就是座 0（计划的拒因以此为反而不成立）');
  const r = probeAction(s, { type: 'PASS', actor: 0 });
  assert.equal(r.ok, true, `手番确实推进 ⇒ PASS 合法；实际拒因=${r.reason}`);
  // 试跑只发生在副本上：原 state 的手番数与随机源都必须逐字不动。
  assert.equal(s.turnIndex, 0, '原 state 的 turnIndex 不得被试跑改写');
  assert.equal(s.duel, null, '原 state 不得被试跑写入对峙');
  assert.equal(s.rng.snapshot(), mk().rng.snapshot(), '原 state 随机源不被消耗');
});

test('试跑：PASS 真·被拒的三条路径（对峙阻塞 / 无当前手番 / 结算才立对峙）', () => {
  // ① B13：对峙未结算 ⇒ `advanceTurn` 第一行就 `return state`（turn-runner.ts:371）。
  //    对峙用真实入口 startDuel 造，不手拼 duel 字段。
  const dueling = startDuel(mk(), 0, 1);
  assert.ok(dueling.duel !== null, '前提自查：startDuel 必须真的立起对峙，否则这条用例是空的');
  const blocked = probeAction(dueling, { type: 'PASS', actor: 0 });
  assert.equal(blocked.ok, false, 'duel !== null ⇒ 手番不推进 ⇒ PASS 被拒');
  assert.match(blocked.reason, /手番未推进/, `拒因要说清是「没推进」：实际=${blocked.reason}`);
  // ② 无当前手番：`currentPlayer` 返回 -1 ⇒ `advanceTurn` 同样原样返回（turn-runner.ts:373）。
  const noActor = probeAction(noActorScene(), { type: 'PASS', actor: 0 });
  assert.equal(noActor.ok, false, '全员出局 ⇒ 没有手番可推进 ⇒ PASS 被拒');
  assert.match(noActor.reason, /手番未推进/);
  // ③ 最阴的一条：**手番结算时才立起对峙**（turn-runner.ts:383 `return next`）。
  //    此时 advanceTurn 返回的是**新对象**，引用判据会说「接受」，但 turnIndex 一格没动 ⇒
  //    只有「引用变了 **且** 手番真的推进了」才是正确判据。
  //    变异实测：把判据改成只判 `r !== s`，本条立刻变绿放行（假阳性），故必须钉住。
  const settleIntoDuel = settleIntoDuelScene();
  const lateDuel = probeAction(settleIntoDuel, { type: 'PASS', actor: 0 });
  assert.equal(lateDuel.ok, false, '结算才触发对峙 ⇒ 手番未推进 ⇒ PASS 不能被记为合法');
  assert.equal(settleIntoDuel.turnIndex, 0, '原 state 的手番数不得被试跑改写');
});

test('试跑：合法动作通过且原 state 随机源不被消耗', () => {
  const s = mk();
  const card = s.players[0]?.hand[0];
  assert.ok(card !== undefined, '初始手牌必须有牌');
  const r = probeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: card.id });
  assert.equal(r.ok, true, r.reason);
  assert.equal(s.rng.snapshot(), mk().rng.snapshot());
  // ⚠️ 上面那条 rng 断言在 PLAY_CARD 上其实是**空判**：mk() 的测试牌 `effects: []`
  //   （state.ts:228-239），打出它不掷任何骰 ⇒ 变异实测「把 isolatedState 去掉」本条仍绿。
  //   ⇒ 补一条必然掷骰的动作：行棋内部掷 6 面移动骰，随机源消耗只有隔离能拦住。
  const before = s.rng.snapshot();
  assert.equal(probeAction(s, { type: 'MOVE', actor: 0, steps: 0 }).ok, true, '行棋必须被接受');
  assert.equal(s.rng.snapshot(), before,
    '掷骰动作试跑后原 state 的 rng 快照必须逐字不变（本条是 rng 隔离的真判据）');
});

test('试跑：山议投票与认证签印在对应局面合法', () => {
  assert.equal(probeAction(councilScene(), { type: 'VOTE', actor: 0, target: 1 }).ok, true);
  assert.equal(probeAction(pendingScene(), { type: 'CERTIFY_SIGN', actor: 1, target: 0 }).ok, true);
});

test('试跑：复议必须由待认证者本人发起（旧手写镜像方向有误）', () => {
  const s = pendingScene();
  assert.equal(probeAction(s, { type: 'CERTIFY_APPEAL', actor: 1, target: 0 }).ok, false, '认证人不能替别人申请');
  // 反方向也要钉住：`certifyAppeal` 的真实前置是 `target === actor` 且灵枢 >= 2，
  // 只在「非本人」一条上断言的话，把两个参数写反同样能骗过这条用例。
  assert.equal(probeAction(pendingScene(), { type: 'CERTIFY_APPEAL', actor: 0, target: 0 }).ok, true,
    '待认证者本人（座 0 灵枢 5 >= 2）申请复议必须合法');
});

test('试跑：13 个动作类型逐一有明确判定，且每次试跑都不消耗原 state 的随机源', () => {
  const covered = new Set<Action['type']>();
  for (const c of PROBE_CASES) {
    const s = c.scene();
    const before = s.rng.snapshot();
    const r = probeAction(s, c.action);
    assert.equal(r.ok, c.ok,
      `${c.label}：期望 ok=${String(c.ok)}，实际 ok=${String(r.ok)}（reason=${r.reason}）`);
    if (!r.ok) {
      assert.ok(r.reason.length > 0, `${c.label}：拒绝必须给出可读原因，不能只给布尔`);
      if (c.reasonRe !== undefined) { assert.match(r.reason, c.reasonRe, c.label); }
    }
    assert.equal(s.rng.snapshot(), before, `${c.label}：试跑不得消耗原 state 的随机源`);
    covered.add(c.action.type);
  }
  assert.equal(covered.size, 13,
    `必须覆盖 Action union 的全部 13 个成员，实际 ${[...covered].sort().join(', ')}`);
});

/** 全员出局的状态：`currentPlayer` 返回 -1 ⇒ `advanceTurn` 原样返回（只动 alive，不碰认证字段）。 */
function noActorScene(): State {
  const s = mk();
  return { ...s, players: s.players.map((p) => ({ ...p, alive: false })) };
}

/**
 * 「本手番结算时才立起对峙」的局面：全员同停第 1 格。
 *
 * `advanceTurn` 会先 `finishTurn`（其同格检测调 `startDuel`）再 `return next`
 * （turn-runner.ts:383）⇒ 返回的是**新对象但手番没推进**，
 * 专门用来拦住把判据退化成「引用是否变化」的实现。
 * 只改 `position`（棋盘坐标，与 `resolveTile` 的引擎判据一致），不碰认证字段。
 */
function settleIntoDuelScene(): State {
  const s = mk();
  return { ...s, players: s.players.map((p) => ({ ...p, position: 1 })) };
}

/** 一条试跑用例：局面 + 动作 + 期望判定 +（拒绝时）拒因必须包含的证据。 */
interface ProbeCase {
  readonly label: string;
  readonly scene: () => State;
  readonly action: Action;
  readonly ok: boolean;
  /** 仅拒绝用例使用：拒因正则（引擎 note 或探针的通道说明）。 */
  readonly reasonRe?: RegExp;
}

const PROBE_CASES: readonly ProbeCase[] = [
  // ---- 通道 ①：performAction 的原样返回 ----
  { label: 'MOVE@常规', scene: mk, action: { type: 'MOVE', actor: 0, steps: 0 }, ok: true },
  { label: 'MOVE@待认证锁定', scene: lockedScene, action: { type: 'MOVE', actor: 0, steps: 0 }, ok: false, reasonRe: /原样返回/ },
  { label: 'ROLL_WHEEL@常规', scene: mk, action: { type: 'ROLL_WHEEL', actor: 0 }, ok: true },
  { label: 'PLAY_CARD@手牌里的牌', scene: mk, action: { type: 'PLAY_CARD', actor: 0, cardId: firstCardId() }, ok: true },
  { label: 'PLAY_CARD@不存在的牌', scene: mk, action: { type: 'PLAY_CARD', actor: 0, cardId: 'no_such_card' }, ok: false, reasonRe: /原样返回/ },
  // ---- 通道 ②：{ok, state, note} 契约 ----
  { label: 'ABILITY@未授予被动', scene: mk, action: { type: 'ABILITY', actor: 0, abilityId: 'peek_deck' }, ok: false, reasonRe: /没有身份被动/ },
  { label: 'VOTE@山议未开', scene: mk, action: { type: 'VOTE', actor: 0, target: 1 }, ok: false, reasonRe: /山议未在进行中/ },
  { label: 'VOTE@山议进行中', scene: councilScene, action: { type: 'VOTE', actor: 0, target: 1 }, ok: true },
  { label: 'CERTIFY_SIGN@无待认证者', scene: mk, action: { type: 'CERTIFY_SIGN', actor: 0, target: 1 }, ok: false, reasonRe: /不在待认证状态/ },
  { label: 'CERTIFY_SIGN@认证轮', scene: pendingScene, action: { type: 'CERTIFY_SIGN', actor: 1, target: 0 }, ok: true },
  { label: 'CERTIFY_CHALLENGE@认证轮', scene: pendingScene, action: { type: 'CERTIFY_CHALLENGE', actor: 1, target: 0 }, ok: true },
  { label: 'CERTIFY_ABSTAIN@认证轮', scene: pendingScene, action: { type: 'CERTIFY_ABSTAIN', actor: 2, target: 0 }, ok: true },
  { label: 'CERTIFY_APPEAL@本人', scene: pendingScene, action: { type: 'CERTIFY_APPEAL', actor: 0, target: 0 }, ok: true },
  { label: 'CERTIFY_APPEAL@替他人', scene: pendingScene, action: { type: 'CERTIFY_APPEAL', actor: 1, target: 0 }, ok: false, reasonRe: /只有待认证者/ },
  { label: 'CERTIFY_ANSWER@已质疑', scene: challengedScene, action: { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: false }, ok: true },
  { label: 'CERTIFY_ANSWER@未质疑', scene: pendingScene, action: { type: 'CERTIFY_ANSWER', actor: 1, target: 0, passed: true }, ok: false, reasonRe: /未发起质疑/ },
  { label: 'CERTIFY_APPEAL_VOTE@复议中', scene: appealedScene, action: { type: 'CERTIFY_APPEAL_VOTE', actor: 3, target: 0, overturn: true }, ok: true },
  { label: 'CERTIFY_APPEAL_VOTE@无人复议', scene: pendingScene, action: { type: 'CERTIFY_APPEAL_VOTE', actor: 1, target: 0, overturn: true }, ok: false, reasonRe: /未申请复议/ },
  // ---- 通道 ③：PASS 以「手番是否推进」裁决 ----
  { label: 'PASS@有当前手番', scene: mk, action: { type: 'PASS', actor: 0 }, ok: true },
  { label: 'PASS@对峙未决', scene: () => startDuel(mk(), 0, 1), action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  { label: 'PASS@结算才立对峙（新对象但没推进）', scene: settleIntoDuelScene, action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  { label: 'PASS@无当前手番', scene: noActorScene, action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  // ---- 未接线：只能显式判拒 ----
  { label: 'COMPARE@关隘未接线', scene: mk, action: { type: 'COMPARE', actor: 0, cardId: 'c_gate_trial', target: 1 }, ok: false, reasonRe: /B14/ },
];

/** 用例里要「打一张真的牌」⇒ 取初始手牌第一张（mk 的后置断言保证人人有牌）。 */
function firstCardId(): string {
  const card = mk().players[0]?.hand[0];
  assert.ok(card !== undefined, 'mk() 必须发出起始手牌');
  return card.id;
}
