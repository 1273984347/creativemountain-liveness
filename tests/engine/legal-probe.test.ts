// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedState, probeAction } from '../../engine/core/probe.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { startDuel, submitDuelCard } from '../../engine/core/duel.ts';
import { castVote } from '../../engine/core/council.ts';
import { currentPlayer, isRoundEnd } from '../../engine/core/round.ts';
import {
  appealedScene, challengedScene, councilScene, lockedScene, mk, pendingScene, putPending,
} from './fixtures.ts';
import {
  getLegalActions, getLegalActionStats, candidatesOf, actionWindowOpen, LEGAL_ACTION_CAP,
} from '../../engine/core/legal.ts';
import { activeAbilityId } from '../../engine/core/passives.ts';
import { cardNeedsTarget, targetCandidates } from '../../engine/core/targeting.ts';
import { certifyAnswer, certifyAppeal, certifyChallenge, enterPendingCertification } from '../../engine/core/certification.ts';
import type { Action } from '../../engine/core/action.ts';
import type { State } from '../../engine/core/state.ts';
import type { Card } from '../../engine/types/theme.ts';

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
// 三条拒绝通道（① 引用相等 / ② `{ok,note}` / ③ 手番是否被接受）的完整理由**只写在
// `engine/core/probe.ts` 文件头一份**；本文件按通道组织用例，引擎侧一律按**函数与分支**指认，
// 不写行号（防行号漂移）。
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
  // 引擎事实：关隘两条通道 `payGate` / `drawTrial`（engine/core/gate.ts）**除自身定义外全仓零引用**，
  // COMPARE 没有任何可试跑的入口 ⇒ 只能显式判拒，不能伪装成「引擎拒绝了」。
  assert.match(r.reason, /B14/, '拒因必须点名 B14，让下游知道自己撞上的是未接线而非规则拒绝');
});

test('试跑：PASS 判据＝引擎是否接受——mk() 上 PASS 合法（计划里那条拒因经实测不成立）', () => {
  const s = mk();
  // ⚠️ 计划 Task 4 Step 1 写的是 `probeAction(mk(), {type:'PASS', actor:0}).ok === false`，
  //   理由「座 0 不是当前手番 ⇒ 不推进」。**两条都不成立**：
  //   · `createInitialState` 的 `turnOrder` 就是座位序、`turnIndex` 为 0
  //     ⇒ `currentPlayer(mk()) === 0`（下面自查钉住）；
  //   · 更根本的是 **`advanceTurn(state, mode)` 没有 actor 参数**，
  //     「谁提交 PASS」引擎从不看，所以「不是当前手番」在引擎里根本不是一个可拒绝的理由。
  //   实测 `advanceTurn(mk(), 'standard')` 把 turnIndex 从 0 推到 1 ⇒ PASS **合法**。
  //   断言因此改成「合法（手番确实推进）」，另用下面一条钉住**真·被拒**的两条路径
  //   与「结算时立起对峙＝合法但推进挂起」这条本轮修正的假阴性。
  assert.equal(currentPlayer(s), 0, '前提自查：mk() 的当前手番就是座 0（计划的拒因以此为反而不成立）');
  const r = probeAction(s, { type: 'PASS', actor: 0 });
  assert.equal(r.ok, true, `手番确实推进 ⇒ PASS 合法；实际拒因=${r.reason}`);
  // ⚠️ 这里**不写**「原 state 的 turnIndex / duel 没被试跑改写」：`isolatedState` 返回新的顶层对象
  //   且引擎全程不可变更新 ⇒ 那两条恒真、任何实现都改不红（本轮变异实测确认）。
  //   「试跑不改写原 state」的真判据是随机源：见文件顶部常驻隔离用例 + 表驱动 loop 的逐条 rng 比对。
});

test('试跑：PASS 的两条真·被拒路径 + 结算立对峙必须算合法（本轮修正的假阴性）', () => {
  // ① B13：**已有一场对峙未结算** ⇒ `advanceTurn` 开头 `state.duel !== null` 那条早退直接 `return state`。
  //    对峙用真实入口 startDuel 造，不手拼 duel 字段。
  const dueling = startDuel(mk(), 0, 1);
  assert.ok(dueling.duel !== null, '前提自查：startDuel 必须真的立起对峙，否则这条用例是空的');
  const blocked = probeAction(dueling, { type: 'PASS', actor: 0 });
  assert.equal(blocked.ok, false, 'duel !== null ⇒ 手番不推进 ⇒ PASS 被拒');
  assert.match(blocked.reason, /手番未推进/, `拒因要说清是「没推进」：实际=${blocked.reason}`);
  // ② 无当前手番：`currentPlayer` 返回 -1 ⇒ `advanceTurn` 的 `seat < 0` 早退同样原样返回。
  const noActor = probeAction(noActorScene(), { type: 'PASS', actor: 0 });
  assert.equal(noActor.ok, false, '全员出局 ⇒ 没有手番可推进 ⇒ PASS 被拒');
  assert.match(noActor.reason, /手番未推进/);
  // ③ 最阴的一条，也是本轮修正的那条：**手番结算时才立起对峙**
  //    （`advanceTurn` 的「结算后进入对峙」分支 `return next`）。
  //    此时 `finishTurn` 已跑、`turn.finished` 已置、`duel` 对象已生成 ⇒ **引擎确实接受了这次 PASS**，
  //    只是手番推进要挂起，等双方各自锁定亮牌后再走一次 `advanceTurn`（B13）。
  //    旧实现在这里报 `ok:false`，把一条合法 PASS 判成被拒 ⇒ 对 Task 5 是**错误的合法性 oracle**。
  const settleIntoDuel = settleIntoDuelScene();
  // 前提自查：本局面必须真的走「换了对象、duel 立起、但 turnIndex 一格没动」那条分支，
  //   否则下面这条 ok=true 就成了在测一个不存在的分支（引擎一改就能悄悄失效）。
  const raw = advanceTurn(settleIntoDuel, 'standard');
  assert.ok(raw !== settleIntoDuel && raw.duel !== null && raw.turnIndex === settleIntoDuel.turnIndex,
    `前提自查：settleIntoDuelScene 的 advanceTurn 必须是「新对象 + duel 已立 + turnIndex 未动」，`
    + `实际 sameRef=${String(raw === settleIntoDuel)}、duel=${String(raw.duel !== null)}、`
    + `turnIndex=${String(settleIntoDuel.turnIndex)}→${String(raw.turnIndex)}`);
  const lateDuel = probeAction(settleIntoDuel, { type: 'PASS', actor: 0 });
  assert.equal(lateDuel.ok, true, `结算时立起对峙＝引擎已接受 ⇒ PASS 必须判合法；实际拒因=${lateDuel.reason}`);
  assert.match(lateDuel.reason, /挂起/, `接受理由必须点名「推进挂起」，否则读者会误读成「此处 PASS 非法」（实际=${lateDuel.reason}）`);
  assert.match(lateDuel.reason, /对峙/, '接受理由必须点名对峙，说清挂起的原因');
});

test('试跑：合法动作通过且原 state 随机源不被消耗', () => {
  const s = mk();
  const card = s.players[0]?.hand[0];
  assert.ok(card !== undefined, '初始手牌必须有牌');
  const r = probeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: card.id });
  assert.equal(r.ok, true, r.reason);
  // ⚠️ 这条 rng 断言是**便宜不变式**，不是判据：mk() 的测试牌 `effects: []`（makeTestCards），
  //   PASS 路径同理（turnIndex 0 → 1 不触发回合末，`openHeaven` 跑不到）⇒ 掷不到骰，
  //   「去掉 isolatedState 也照样绿」（实测见 task-4-report.md）。
  //   rng 隔离的**真**护栏是下面那条 MOVE 断言 + 表驱动用例里逐条的 rng 比对。
  const before = s.rng.snapshot();
  assert.equal(s.rng.snapshot(), mk().rng.snapshot(), '便宜不变式：新建状态的 rng 仍停在 seed');
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
    }
    // 拒因正则对**两种判定**都生效：判定为合法也可能带理由（如「推进挂起」），
    // 只在拒绝分支上校验的话，「合法但理由丢失」就没人守。
    if (c.reasonRe !== undefined) { assert.match(r.reason, c.reasonRe, c.label); }
    assert.equal(s.rng.snapshot(), before, `${c.label}：试跑不得消耗原 state 的随机源`);
    covered.add(c.action.type);
  }
  assert.equal(covered.size, 13,
    `必须覆盖 Action union 的全部 13 个成员，实际 ${[...covered].sort().join(', ')}`);
});

/** 全员出局的状态：`currentPlayer` 返回 -1 ⇒ `advanceTurn` 的 `seat < 0` 早退原样返回（只动 alive，不碰认证字段）。 */
function noActorScene(): State {
  const s = mk();
  return { ...s, players: s.players.map((p) => ({ ...p, alive: false })) };
}

/** 取证用的「真的要选目标」的牌 id（effects 里有数字 target ⇒ `cardNeedsTarget` 为真）。 */
const TARGET_CARD_ID = 'probe_needs_target';

/**
 * 座 0 手牌里塞一张**需要选择目标**的牌（主题包攻击牌形状），用于 G-a 同族取证：
 * `performAction` 的 `act` 分支不校验 `target` 是否在候选里 ⇒ 越界目标照样出牌。
 * ⚠️ 只改手牌内容，不碰认证/山议字段（那些必须走 fixtures 的引擎入口）。
 */
function targetCardScene(): State {
  const card: Card = {
    id: TARGET_CARD_ID,
    name: '取证牌（需目标）',
    type: 'attack',
    cost: 0,
    color: 'red',
    rank: 2,
    text: '取证用：必须选目标的牌',
    effects: [{ op: 'discard_opponent', count: 1, target: 0 }],
  };
  // ⚠️ 前提守卫（Task 4 评审遗留 ①）：下面「target 越界仍被接受」那行的牙齿**全靠这张牌
  //   真的要选目标**。若主题/算子改动让它不再需要目标，`act` 分支会在「需要目标却没给」
  //   处原样返回的判据就此消失，那行会在「引擎其实什么都没被检验」的情况下继续报 ok=true
  //   ⇒ 取证行必须先把**自己的前提**钉住，而不是只钉结论。
  assert.ok(cardNeedsTarget(card),
    `targetCardScene 的前提：取证牌必须真的需要选择目标（cardNeedsTarget 为假 ⇒ `
    + `「target 越界仍被接受」那行不再证明任何事，须换一张真需目标的牌）`);
  const s = mk();
  return { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hand: [card, ...p.hand] } : p)) };
}

/**
 * 「本手番结算时才立起对峙」的局面：全员同停第 1 格。
 *
 * `advanceTurn` 会先 `finishTurn`（其同格检测调 `startDuel`），再走它「结算后进入对峙」
 * 那条 `return next` ⇒ **返回新对象、duel 已生成，但 turnIndex 一格没动**。
 * 本局面钉两件事：① 引擎已接受这次 PASS ⇒ 探针必须报 `ok:true`（且理由说清「推进挂起」）；
 * ② 探针不得退化成「引用变了就算接受」那种无说明的实现（那条路径 reason 为空 ⇒ 本行报红）。
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
  /** 拒因正则：拒绝用例用它钉住「为什么拒」，接受用例用它钉住「理由有没有说清」（如推进挂起）。 */
  readonly reasonRe?: RegExp;
}

const PROBE_CASES: readonly ProbeCase[] = [
  // ---- 通道 ①：performAction 的原样返回 ----
  { label: 'MOVE@常规', scene: mk, action: { type: 'MOVE', actor: 0, steps: 0 }, ok: true },
  { label: 'MOVE@待认证锁定', scene: lockedScene, action: { type: 'MOVE', actor: 0, steps: 0 }, ok: false, reasonRe: /原样返回/ },
  { label: 'ROLL_WHEEL@常规', scene: mk, action: { type: 'ROLL_WHEEL', actor: 0 }, ok: true },
  { label: 'PLAY_CARD@手牌里的牌', scene: mk, action: { type: 'PLAY_CARD', actor: 0, cardId: firstCardId() }, ok: true },
  { label: 'PLAY_CARD@不存在的牌', scene: mk, action: { type: 'PLAY_CARD', actor: 0, cardId: 'no_such_card' }, ok: false, reasonRe: /原样返回/ },
  // ---- §5.1 引擎漂移取证（G-a / G-b）：**记录实际行为，不在探针里补规则** ----
  // G-b：`performAction` 的 `act` 分支**不检查 `pendingCert`**（只有 `move` 分支检查），
  //   于是同一个锁定者「行棋」被拒（上面 MOVE@待认证锁定）而「出牌」被放行。
  //   ⇒ 本行是 G-b 的**可执行证据**（Task 9 README 登记条目引用它）；
  //     若将来引擎补上检查，本行会红，逼着当场复核登记口径，而不是让探针偷偷领先引擎。
  { label: 'PLAY_CARD@待认证锁定（G-b 取证：act 分支不查 pendingCert ⇒ 引擎放行）', scene: lockedScene, action: { type: 'PLAY_CARD', actor: 0, cardId: firstCardId() }, ok: true },
  // G-a 同族的另一条：`act` 分支只在「需要目标却没给目标」处原样返回，
  //   **从不校验 target 是不是 `targetCandidates` 里的存活对手**（那层校验只存在于 UI 的
  //   `resolveTargetPick`）⇒ 一张真的要选目标的牌带着越界座位 99 照样出牌。
  //   （`card.cost` 同样既不校验也不扣，即 G-a 本体。）⇒ Task 9 README 的 G-a/G-b 证据行。
  { label: 'PLAY_CARD@target 越界（G-a 同族取证：act 分支不校验 target ⇒ 引擎放行）', scene: targetCardScene, action: { type: 'PLAY_CARD', actor: 0, cardId: TARGET_CARD_ID, target: 99 }, ok: true },
  // ↑ 那行的**负对照**（Task 4 评审遗留 ①：Task 4 报告称已有此负对照，实测**没有**）：
  //   同一张牌、同一个座位，只是**不给 target** ⇒ 引擎在 `act` 分支的
  //   「需要目标而未选目标」处原样返回。没有这一行，「越界仍放行」就可能在
  //   「这张牌压根不需要目标」的静默改动下继续报绿。
  { label: 'PLAY_CARD@需目标的牌未给 target（上行的负对照：引擎此处确实会拒）', scene: targetCardScene, action: { type: 'PLAY_CARD', actor: 0, cardId: TARGET_CARD_ID }, ok: false, reasonRe: /原样返回/ },
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
  // ---- 通道 ③：PASS 以「引擎是否接受」裁决（手番推进 or 结算时立起对峙）----
  { label: 'PASS@有当前手番', scene: mk, action: { type: 'PASS', actor: 0 }, ok: true },
  { label: 'PASS@对峙未决', scene: () => startDuel(mk(), 0, 1), action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  { label: 'PASS@结算才立对峙（引擎已接受，推进挂起待对峙结算）', scene: settleIntoDuelScene, action: { type: 'PASS', actor: 0 }, ok: true, reasonRe: /挂起/ },
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

// ============================ Task 5：五面试跑式枚举 ============================
//
// `getLegalActions` 的三段式：**候选粗筛 → rng 隔离试跑 → 判定收集**。
// 覆盖五个决策面：行棋 / 问天 / 出牌(×目标) / 身份被动(×目标) / 山议投票 / 认证
// （签印·质疑·弃权·复议·判定·复议票）。
// ⚠️ `PASS` 与 `COMPARE` **不枚举**：前者 UI 无「结束手番」入口、后者入口待 B14
//   —— 尽管 `probeAction` 对两者都能给答案（上面 Task 4 的表已钉住），
//   枚举口径以「玩家现在真能提交什么」为准，不是「探针会不会说合法」。
// ⚠️ 场景一律来自 fixtures；被动只改 `flags.passive`（不碰认证/山议字段）。

/** 给某座位挂一个身份被动（`PassiveSpec = Effect`，主题包里就是这么写的）。 */
function withPassive(s: State, seat: number, passive: Record<string, unknown>): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, passive } } : p)),
  };
}

test('§7 行动阶段：枚举出行棋/问天/出牌，且不消耗随机源', () => {
  const s = mk();
  const before = s.rng.snapshot();
  const types = new Set(getLegalActions(s, 0).map((a) => a.type));
  assert.ok(types.has('MOVE'), '行棋面缺失');
  assert.ok(types.has('ROLL_WHEEL'), '问天面缺失');
  assert.ok(types.has('PLAY_CARD'), '有手牌 ⇒ 至少一张可打');
  assert.equal(s.rng.snapshot(), before, '枚举不得消耗随机源');
});

test('§7 待认证锁定：行动阶段整体无动作（与 UI 禁用行动区一致）', () => {
  for (const a of getLegalActions(lockedScene(), 0)) {
    assert.equal(['MOVE', 'ROLL_WHEEL', 'PLAY_CARD', 'ABILITY'].includes(a.type), false, `泄漏 ${a.type}`);
  }
});

test('§7 对峙未决 ⇒ 行动窗口关闭（DuelState 的 pickA/pickB 是可选字段，不写 undefined）', () => {
  // 发现 5：窗口关闭必须在**真的开起来**的对峙上证明——原来这里手拼 `duel: { seatA, seatB }`，
  //   拼出来的对象没经过 `startDuel` 的任一前置（含「任一方手牌为空 ⇒ 直接判负、duel 保持 null」），
  //   等于在测一个引擎根本不会交出的形状。`startDuel` 早已 import，一行替换、语义不变。
  const s = startDuel(mk(), 0, 1);
  assert.ok(s.duel !== null, '前提自查：startDuel 必须真的立起未决对峙，否则「窗口关闭」测的是常规局面');
  assert.equal(s.duel.pickA, undefined, '后置：pickA/pickB 是可选字段 ⇒ 未锁定时应为 undefined（不是显式 null）');
  assert.equal(actionWindowOpen(s, 0), false);
  assert.equal(actionWindowOpen(mk(), 0), true);
});

test('§7 被动标识唯一来源 = activeAbilityId（PassiveSpec = Effect，没有 id 字段）', () => {
  assert.equal(activeAbilityId(mk(), 0), '', '未授予被动 ⇒ 空串，不得凭空造 id');
  const withOp = withPassive(mk(), 0, { op: 'peek_deck' });
  assert.equal(activeAbilityId(withOp, 0), 'peek_deck');
});

test('§7 需目标的牌按候选目标展开，且不含无目标版本（引擎要求有目标才可出）', () => {
  const base = mk();
  const targeted: Card = {
    id: 'test_targeted', name: '测试制敌', type: 'utility', cost: 0, color: 'red',
    rank: 5, text: '弃掉目标 1 张牌。', effects: [{ op: 'discard_opponent', count: 1, target: 1 }],
  };
  assert.ok(cardNeedsTarget(targeted), '前提自查：这张牌必须真的需要选目标，否则下面的展开断言是空的');
  const s: State = {
    ...base,
    players: base.players.map((p) => (p.seat === 0 ? { ...p, hand: [targeted, ...p.hand] } : p)),
  };
  const plays = getLegalActions(s, 0)
    .filter((a): a is Extract<Action, { readonly type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD')
    .filter((a) => a.cardId === 'test_targeted');
  assert.equal(plays.length, targetCandidates(s, 0).length, '每个存活对手一条');
  assert.equal(plays.some((a) => a.target === undefined), false, '无目标版本必被引擎拒');
});

test('§7 身份被动面：needsTarget 的被动按候选目标展开，abilityId 取 activeAbilityId', () => {
  const s = withPassive(mk(), 0, { op: 'transfer_resource', amount: 1 });
  const abilities = getLegalActions(s, 0).filter((a) => a.type === 'ABILITY');
  assert.equal(abilities.length, targetCandidates(s, 0).length, '窃火者：每个存活对手一条');
  assert.equal(abilities.every((a) => a.target !== undefined), true, '需目标的被动不得给出无目标版本');
  assert.deepEqual([...new Set(abilities.map((a) => a.abilityId))], ['transfer_resource'],
    'abilityId 必须是 `activeAbilityId` 的取法（被动的 op）——写死别的名字或退回 identityId 都会在这里红');
  // 常驻/自动型被动没有发动入口 ⇒ 该面为空（引擎 performAbility 也会拒）。
  const passiveless = getLegalActions(mk(), 0).filter((a) => a.type === 'ABILITY');
  assert.equal(passiveless.length, 0, 'mk() 未授予被动 ⇒ 身份被动面为空');
  const autoType = withPassive(mk(), 0, { op: 'shield', amount: 1 });
  assert.equal(getLegalActions(autoType, 0).some((a) => a.type === 'ABILITY'), false,
    '自动/常驻型被动无需发动 ⇒ 不得枚举 ABILITY');
});

test('§7 认证段：签印/质疑/弃权在册，未质疑者无判定权、无人复议时无复议票', () => {
  const types = new Set(getLegalActions(pendingScene(), 1).map((a) => a.type));
  assert.ok(types.has('CERTIFY_SIGN'));
  assert.ok(types.has('CERTIFY_CHALLENGE'));
  assert.ok(types.has('CERTIFY_ABSTAIN'));
  assert.equal(types.has('CERTIFY_ANSWER'), false, '未质疑 ⇒ 无判定权');
  assert.equal(types.has('CERTIFY_APPEAL_VOTE'), false);
  assert.equal(types.has('PASS'), false, 'UI 无「结束手番」入口 ⇒ 不枚举');
  assert.equal(types.has('COMPARE'), false, '关隘未接线 ⇒ 不枚举');
});

test('§7 判定权只属于已质疑者，且判定去重由粗筛承担（certifyAnswer 无重复判定守卫）', () => {
  const answered = getLegalActions(challengedScene(), 1).filter((a) => a.type === 'CERTIFY_ANSWER');
  assert.equal(answered.length, 2, '判通过 / 判不通过 各一条');
  const after = certifyAnswerRun(challengedScene());
  assert.equal(getLegalActions(after, 1).some((a) => a.type === 'CERTIFY_ANSWER'), false, '已判定 ⇒ 不再返回判定动作');
  assert.equal(getLegalActions(challengedScene(), 3).some((a) => a.type === 'CERTIFY_ANSWER'), false, '未质疑者无判定权');
});

test('§7 复议：本人可申请（target === actor），复议票只发给非当事人', () => {
  const appeal = getLegalActions(pendingScene(), 0).filter((a) => a.type === 'CERTIFY_APPEAL');
  assert.equal(appeal.length, 1, '只能对自己申请一次');
  assert.deepEqual(appeal.map((a) => a.target), [0], 'target 必须是待认证者本人');
  const voted = getLegalActions(appealedScene(), 3).filter((a) => a.type === 'CERTIFY_APPEAL_VOTE');
  assert.equal(voted.length, 2, '推翻 / 维持 两条');
  // 当事人（认证人与待认证者）都被引擎拒 ⇒ 枚举里不得出现复议票。
  const appealed = appealedScene();
  assert.equal(getLegalActions(appealed, 1).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false, '认证人不得投复议票');
  assert.equal(getLegalActions(appealed, 0).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false, '待认证者本人不得投复议票');
});

test('§7 山议：投票动作覆盖除自己外的存活玩家', () => {
  const s = councilScene();
  const votes = getLegalActions(s, 0).filter((a) => a.type === 'VOTE');
  assert.equal(votes.length, 3, '4 人局 ⇒ 3 个可投对象');
  // 已投过票 ⇒ 不再返回（`castVote` 的「本轮已投过票」由粗筛的 votes[seat] 挡住）。
  // ⚠️ 走真实入口，不手拼 `council.votes`（本批次刚把这种写法从 b3.test.ts 清出去）：
  //   手拼出来的「已投票」不是引擎记账的那个形状，且绕过了 `castVote` 的全部前置。
  const votedOnce = castVote(s, 0, 1);
  assert.ok(votedOnce.ok, `前提自查：座 0 必须真的投出一票，否则「已投过票 ⇒ 不再返回」测的是没投过票的局面：${votedOnce.note ?? '（无 note）'}`);
  assert.ok(votedOnce.state.council.votes[0] !== undefined, '前提自查：votes[0] 必须已落账');
  assert.equal(votedOnce.state.council.resolved, false,
    '前提自查：一票之后山议必须**仍未结算**——否则「没有 VOTE」是山议散会造成的，测不到 votes[seat] 那条粗筛判据');
  assert.equal(getLegalActions(votedOnce.state, 0).some((a) => a.type === 'VOTE'), false);
  // 粗筛侧也要单独钉：`castVote` 自己会拒「本轮已投过票」⇒ 只看枚举结果的话，
  //   粗筛里那条 `votes[seat] !== undefined` 判据被删掉也照样绿（变异 M10 实测如此）。
  //   它省的是试跑成本，不是正确性——但既然是登记过的判据，就用 `candidatesOf` 盯住它。
  assert.equal(candidatesOf(votedOnce.state, 0).some((a) => a.type === 'VOTE'), false,
    '粗筛侧：已投过票的座位不得再产出 VOTE 候选（这条盯的是 `councilCandidates`，不是试跑）');
});

// ============================ 发现 1：粗筛早退吞掉「引擎接受而候选缺失」的动作 ============================
//
// `一致性-正向` 只证明**反方向**（枚举出来的都被引擎接受），它**看不见**「粗筛窄于引擎」：
// 少发一条候选不会让任何既有断言变红。下面两条钉的正是这个盲区，两条都复现评审给的可达路径，
// 且都是「把 `certificationCandidates` 的 `pending.includes(seat)` 早退放回来 ⇒ 本条报红」的
// 可失败钉（变异 M7：把早退放回来 ⇒ **两条同时**报红，各缺 2 条，实测见 task-5-report.md）。

test('§7 认证段（发现 1·其一）：质疑后自己登顶的座位，复议与判定权并存', () => {
  const s = challengedThenPendingScene();
  const answers = getLegalActions(s, 2)
    .filter((a): a is Extract<Action, { readonly type: 'CERTIFY_ANSWER' }> => a.type === 'CERTIFY_ANSWER')
    .filter((a) => a.actor === 2);
  assert.equal(answers.length, 2,
    '座 2 已质疑座 0 且尚未判定 ⇒ 判通过/判不通过各一条；粗筛早退一回来这里就是 0 条');
  assert.deepEqual([...new Set(answers.map((a) => a.target))], [0], '判定对象只能是那个待认证者（座 0）');
  for (const a of answers) {
    const r = probeAction(s, a);
    assert.equal(r.ok, true, `枚举出来的判定动作必须被引擎接受：${r.reason}`);
  }
  // 待认证者本人的复议候选照旧在册（早退改掉的只是「return」，不是这条语义）。
  const appeal = getLegalActions(s, 2).filter((a) => a.type === 'CERTIFY_APPEAL');
  assert.equal(appeal.length, 1, '本人仍可申请复议一次');
  assert.deepEqual(appeal.map((a) => a.target), [2], 'target 必须是本人');
  // 但**不因此扩大**：待认证者不是认证人（`isCertifier`）⇒ 签印/质疑/弃权仍不得出现。
  const certifierFace = getLegalActions(s, 2)
    .filter((a) => a.type === 'CERTIFY_SIGN' || a.type === 'CERTIFY_CHALLENGE' || a.type === 'CERTIFY_ABSTAIN');
  assert.equal(certifierFace.length, 0, '待认证者不是认证人 ⇒ 认证人三面仍为空');
});

test('§7 认证段（发现 1·其二）：同场另一名待认证者仍是复议第三方，必须拿到复议票', () => {
  const s = coPendingAppealScene();
  const votes = getLegalActions(s, 3)
    .filter((a): a is Extract<Action, { readonly type: 'CERTIFY_APPEAL_VOTE' }> => a.type === 'CERTIFY_APPEAL_VOTE');
  assert.equal(votes.length, 2, '推翻 / 维持 两条；粗筛早退一回来这里就是 0 条');
  assert.deepEqual([...new Set(votes.map((a) => a.target))], [0], '复议票只对着已申请复议的那个待认证者');
  for (const a of votes) {
    const r = probeAction(s, a);
    assert.equal(r.ok, true, `枚举出来的复议票必须被引擎接受：${r.reason}`);
  }
  // 当事人仍无票（引擎拒 ⇒ 不得出现在枚举里）。
  assert.equal(getLegalActions(s, 0).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false, '申请人本人无复议票');
  assert.equal(getLegalActions(s, 1).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false, '判定人无复议票');
});

/** 引擎 note 的可读兜底（note 是可选属性）。 */
function noteOf(note: string | undefined): string { return note ?? '（引擎未给 note）'; }

/**
 * 「座 2 质疑座 0 之后自己登顶」的局面（发现 1·其一）。
 *
 * 全程真实引擎入口，与评审给的可达路径逐句对应：
 *   `putPending(mk(5,7),[0])` → `certifyChallenge(·,2,0)` → 座 2 落到峰顶 → `enterPendingCertification(·,2)`
 *   ⇒ `pending=[0,2]` 且 `challenged=[2]`。
 * ⚠️ 「座 2 落到峰顶」在这里直接置 `position`（棋盘坐标，fixtures 允许的字段，`settleIntoDuelScene` 同例），
 *   随后调的 `enterPendingCertification` 正是 `resolveTile` 的 `peak` 分支在真实手番末调的那一句；
 *   走骰子到峰顶不可复现，而认证字段一个都不手拼。
 */
function challengedThenPendingScene(): State {
  const first = putPending(mk(5, 7), [0]);
  const challenged = certifyChallenge(first, 2, 0);
  assert.ok(challenged.ok, 'challengedThenPendingScene：座 2 发起质疑必须成功：' + noteOf(challenged.note));
  assert.ok(challenged.state.certification.challenged.includes(2),
    'challengedThenPendingScene：局面名承诺「座 2 已质疑」⇒ challenged 必须含座 2');
  const s = challenged.state;
  const onPeak: State = { ...s, players: s.players.map((p) => (p.seat === 2 ? { ...p, position: s.board.peakIndex } : p)) };
  const entered = enterPendingCertification(onPeak, 2);
  assert.ok(entered.ok, 'challengedThenPendingScene：座 2 登顶进入待认证必须成功：' + noteOf(entered.note));
  assert.deepEqual(entered.state.certification.pending, [0, 2], '后置：pending 必须是 [0,2]');
  assert.deepEqual(entered.state.certification.challenged, [2], '后置：座 2 的判定权仍在 challenged 里');
  assert.equal(entered.state.certification.judgments[2], undefined, '后置：座 2 尚未判定');
  return entered.state;
}

/**
 * 「座 0 被质疑判不通过并申请复议，座 3 随后也登顶」的局面（发现 1·其二）。
 *
 * ⇒ `pending=[0,3]`、`appealed=[0]`、`judgments={1:false}`。
 * 引擎判据：`certifyAppealVote` 只排除**申请人**与**判定人**，而 `resolveAppeals` 把
 * 「存活 − 判定人 − 待认证对象」全算作独立第三方 ⇒ 座 3（同为待认证者）的复议票是被接受的。
 * ⚠️ 座 0 补到 5 灵枢是复议的成本（`certifyAppeal` 需 2），与 fixtures 的 `appealedScene` 同一手法。
 */
function coPendingAppealScene(): State {
  const challenged = certifyChallenge(putPending(mk(5, 7), [0]), 1, 0);
  assert.ok(challenged.ok, 'coPendingAppealScene：座 1 发起质疑必须成功：' + noteOf(challenged.note));
  const answered = certifyAnswer(challenged.state, 1, 0, false);
  assert.ok(answered.ok, 'coPendingAppealScene：判定必须落账：' + noteOf(answered.note));
  assert.equal(answered.state.certification.judgments[1], false,
    'coPendingAppealScene：局面名承诺「判不通过」⇒ judgments[1] 必须是 false');
  const judged = answered.state;
  const funded: State = { ...judged, players: judged.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)) };
  const appealed = certifyAppeal(funded, 0, 0);
  assert.ok(appealed.ok, 'coPendingAppealScene：复议申请必须成功：' + noteOf(appealed.note));
  assert.ok(appealed.state.certification.appealed.includes(0), 'coPendingAppealScene：appealed 必须含座 0');
  const s = appealed.state;
  const onPeak: State = { ...s, players: s.players.map((p) => (p.seat === 3 ? { ...p, position: s.board.peakIndex } : p)) };
  const entered = enterPendingCertification(onPeak, 3);
  assert.ok(entered.ok, 'coPendingAppealScene：座 3 登顶进入待认证必须成功：' + noteOf(entered.note));
  assert.deepEqual(entered.state.certification.pending, [0, 3], '后置：pending 必须是 [0,3]');
  assert.equal(entered.state.certification.appealVotes[3], undefined, '后置：座 3 尚未投过复议票');
  return entered.state;
}

test('一致性-正向（常驻）：枚举出的每个动作必被引擎接受', () => {
  const scenes = [mk(), mk(8, 23), lockedScene(), pendingScene(), challengedScene(), appealedScene(), councilScene(),
    challengedThenPendingScene(), coPendingAppealScene()];
  for (const s of scenes) {
    const before = s.rng.snapshot();
    for (let seat = 0; seat < s.players.length; seat += 1) {
      for (const a of getLegalActions(s, seat)) {
        const r = probeAction(s, a);
        assert.equal(r.ok, true, `${a.type}@座${String(seat)} 应合法：${r.reason}`);
      }
    }
    assert.equal(s.rng.snapshot(), before, '枚举+试跑整轮不得消耗原 state 的随机源');
  }
});

test('§7 上限：枚举结果永不超过 LEGAL_ACTION_CAP（含**真的撞上限**的局面）', () => {
  for (const s of [mk(8, 23), councilScene(8, 23), appealedScene(8, 23), wideHandScene(LEGAL_ACTION_CAP * 2, 8, 23)]) {
    for (let seat = 0; seat < s.players.length; seat += 1) {
      const n = getLegalActions(s, seat).length;
      assert.ok(n <= LEGAL_ACTION_CAP, `座${String(seat)} 枚举 ${String(n)} 条 > ${LEGAL_ACTION_CAP}`);
    }
  }
  // 牙齿（发现 4）：本条原先只跑 8–13 条候选的局面 ⇒ `getLegalActions` 里那条上限 `break`
  //   从不执行，「永不超过上限」退化成恒真。下面把「确实有一个局面撞在上限上」钉成断言：
  //   删掉/写坏那条 break ⇒ 本条报红（变异实测见 task-5-report.md 的 M8）。
  const hitting = wideHandScene(LEGAL_ACTION_CAP * 2);
  assert.ok(candidatesOf(hitting, 0).length > LEGAL_ACTION_CAP,
    '前提自查：宽手牌局面的候选确实超上限 ⇒ 截断分支真的被执行');
  assert.equal(getLegalActions(hitting, 0).length, LEGAL_ACTION_CAP,
    '上限测试必须有一个「枚举结果正好停在上限」的局面，否则整条测试没有可失败的形式');
});

// ============================ 发现 2：粗筛**故意**窄于引擎的四处（取证行）============================
//
// `一致性-正向` 钉的是「枚举 ⊆ 引擎接受」，而这四处是「引擎接受 ⊄ 枚举」——
// 它们不是漏洞，是**登记过的口径**（UI 一致性 / 未接线 gap），`legal.ts` 的
// `actionWindowOpen` 与 `candidatesOf` 注释各有一份完整清单。本条把四处都做成可执行证据，
// 让 Task 9 的登记与 Task 15 的判读引用到**行**而不是引用到**注释**。
// ⚠️ 本条**不改变任何行为**：四处都按现状钉住；若将来引擎/口径改动，本条报红逼着当场复核。

test('§7 粗筛窄于引擎四处·其一（a：pendingCert ⇒ G-b 同族）：引擎放行出牌，枚举不发', () => {
  const locked = lockedScene();
  const card = locked.players[0]?.hand[0];
  assert.ok(card !== undefined, '前提自查：锁定者必须有手牌');
  const r = probeAction(locked, { type: 'PLAY_CARD', actor: 0, cardId: card.id });
  assert.equal(r.ok, true, `引擎侧：` + '`performAction` 的 act 分支不查 pendingCert' + ` ⇒ 出牌被放行；实际拒因=${r.reason}`);
  assert.equal(getLegalActions(locked, 0).some((a) => a.type === 'PLAY_CARD'), false,
    '粗筛侧：pendingCert ⇒ 行动面整体关闭（与 UI 禁用行动区一致）⇒ 故意不发');
});

test('§7 粗筛窄于引擎四处·其二（b：duel !== null ⇒ 对峙 gap）：整表清零，而 submitDuelCard 是活的玩家入口', () => {
  // 对峙用真实入口 startDuel 造（发现 5：不手拼 `duel` 字段）。
  const d = startDuel(mk(4, 7), 0, 1);
  assert.ok(d.duel !== null, '前提自查：startDuel 必须真的立起对峙');
  for (let seat = 0; seat < d.players.length; seat += 1) {
    assert.equal(candidatesOf(d, seat).length, 0, `座${String(seat)}：对峙未决 ⇒ 粗筛整表清零`);
    assert.equal(getLegalActions(d, seat).length, 0, `座${String(seat)}：枚举因此为空集`);
  }
  const pick = d.players[0]?.hand[0];
  assert.ok(pick !== undefined, '前提自查：对峙双方必须有牌可选');
  const submitted = submitDuelCard(d, 0, pick.id);
  assert.equal(submitted.ok, true,
    `引擎侧：玩家此刻仍有可执行的入口 submitDuelCard（无对应 Action 成员 ⇒ 枚举永远给不出它）：${submitted.note}`);
});

test('§7 粗筛窄于引擎四处·其三（c：phase）：引擎从不读 phase ⇒ 山议里行棋仍被接受，枚举不发', () => {
  const council = councilScene();
  assert.equal(council.phase, '山议', '前提自查：本局面的阶段必须不是「行动」');
  const r = probeAction(council, { type: 'MOVE', actor: 0, steps: 0 });
  assert.equal(r.ok, true, `引擎侧：` + '`performAction` 全程不读 `state.phase`' + ` ⇒ 行棋被放行；实际拒因=${r.reason}`);
  assert.equal(actionWindowOpen(council, 0), false, '粗筛侧：phase !== 行动 ⇒ 窗口关闭');
  assert.equal(getLegalActions(council, 0).some((a) => a.type === 'MOVE'), false, '粗筛侧：不发 MOVE/ROLL_WHEEL/PLAY_CARD');
});

test('§7 粗筛窄于引擎四处·其四（d：isRoundEnd）：引擎从不看 turnIndex，枚举按 round 末关闭', () => {
  const ended = roundEndScene();
  assert.ok(isRoundEnd(ended), '前提自查：本局面必须真的处于 round 末（turnIndex >= 存活人数）');
  assert.equal(ended.phase, '行动', '前提自查：阶段仍是行动 ⇒ 关掉窗口的只有 isRoundEnd 这一条判据');
  assert.equal(ended.duel, null, '前提自查：没有对峙干扰这条判据');
  assert.equal(actionWindowOpen(ended, 0), false);
  const r = probeAction(ended, { type: 'MOVE', actor: 0, steps: 0 });
  assert.equal(r.ok, true, `引擎侧：performAction 不看 turnIndex / 手番归属 ⇒ 行棋被放行；实际拒因=${r.reason}`);
  assert.equal(getLegalActions(ended, 0).some((a) => a.type === 'MOVE'), false, '粗筛侧：round 已走完 ⇒ 不发');
});

/**
 * 「本 round 已走完」的局面（发现 2 的 d 项取证）。
 *
 * `turnIndex` 置成存活人数就是 `advanceTurn` 内部 `nextTurn` 与 round 末处理**真实经过**的那一瞬
 * （`isRoundEnd` 的判据在那一刻为真）；这里把它作为顶层标量直接置位取证——
 * ⚠️ 与 fixtures 的禁令无关：`certification` / `council` / `duel` 三个字段组一个都没碰。
 */
function roundEndScene(): State {
  const s = mk(4, 7);
  const alive = s.players.filter((p) => p.alive).length;
  return { ...s, turnIndex: alive };
}

/** 已判定过的局面（用真实入口推进，不手拼字段）。 */
function certifyAnswerRun(s: State): State {
  const r = certifyAnswer(s, 1, 0, false);
  // 发现 6：`.ok` 必须在**这里**断言。忽略它的话，一旦引擎前置变了，
  // 红的是下游那句 `0 !== 2`（看不出「判定根本没落账」），排查方向整个跑偏。
  assert.ok(r.ok, `certifyAnswerRun：判定必须落账，否则「已判定 ⇒ 不再返回判定动作」测的是个没判定的局面：${noteOf(r.note)}`);
  assert.equal(r.state.certification.judgments[1], false,
    'certifyAnswerRun：后置——judgments[1] 必须是 false（`.ok` 不等于「名字承诺的事发生了」）');
  return r.state;
}

// ============================ Task 6：枚举统计（P3 token 预算读数的数据源）============================
//
// `getLegalActionStats` 必须与 `getLegalActions` **共用同一个 `candidatesOf`**——
// 两处各写一份粗筛，统计就会和枚举分叉（P3 读数失去意义，正是本批次要防的镜像漂移）。

test('§7 统计：enumerated == 枚举长度，truncated 与候选数一致', () => {
  for (const s of [mk(), mk(8, 23), councilScene(8, 23), appealedScene(5, 23)]) {
    const stats = getLegalActionStats(s, 0);
    assert.equal(stats.enumerated, getLegalActions(s, 0).length);
    assert.ok(stats.enumerated <= LEGAL_ACTION_CAP);
    assert.ok(stats.candidates >= stats.enumerated);
    assert.equal(stats.truncated, stats.candidates > LEGAL_ACTION_CAP);
    // 同一个粗筛函数：候选数必须逐字等于 candidatesOf 的长度（另写一份粗筛 ⇒ 本条红）。
    assert.equal(stats.candidates, candidatesOf(s, 0).length);
    // 发现 3：这几个局面都不超上限 ⇒ 不可能有候选因为上限而**没被试跑**。
    assert.equal(stats.dropped, 0, '候选未超上限 ⇒ dropped 必须为 0');
  }
});

test('§7 统计：dropped 才是「真丢了候选」的信号——truncated 会在「候选超上限而接受数不足上限」时假阳性（发现 3）', () => {
  const s = overCapCornerScene();
  const stats = getLegalActionStats(s, 0);
  // 前提自查：必须真的落在「候选 > 上限 ∧ 接受 < 上限」这个角落，否则整条用例测的是别的东西。
  assert.ok(stats.candidates > LEGAL_ACTION_CAP,
    `前提自查：候选须超上限，实际 candidates=${String(stats.candidates)}、上限=${LEGAL_ACTION_CAP}`);
  assert.ok(stats.enumerated < LEGAL_ACTION_CAP,
    `前提自查：接受数须低于上限（⇒ 那条 break 从未触发）；实际 enumerated=${String(stats.enumerated)}`);
  assert.equal(stats.enumerated, getLegalActions(s, 0).length, '统计与枚举必须同一个数');
  assert.equal(stats.truncated, true,
    'brief 口径原样保留：truncated 就是 `candidates > LEGAL_ACTION_CAP`——这条正是假阳性的来源（不是要修的 bug，是要读对的字段）');
  assert.equal(stats.dropped, 0,
    'dropped =「因上限而**没被试跑**的候选条数」（被引擎拒的不算丢失，那是筛选）⇒ 本角落必须是 0。'
    + 'P3/Task 15 那句「truncated = 0，否则下调 LEGAL_ACTION_CAP」只能读 dropped');
  // 对照：真的被上限拦停时，剩下的候选一条都没试跑 ⇒ dropped == 超出部分。
  const w = getLegalActionStats(wideHandScene(LEGAL_ACTION_CAP * 2), 0);
  assert.equal(w.truncated, true, '对照局面：候选同样超上限');
  assert.equal(w.enumerated, LEGAL_ACTION_CAP, '对照局面：接受数正好停在上限 ⇒ break 真的执行了');
  assert.ok(w.dropped > 0, '对照局面必须真的丢候选，否则这条对照什么也没钉住');
  assert.equal(w.dropped, w.candidates - LEGAL_ACTION_CAP,
    '停在上限 ⇒ 未试跑的候选 == 超出上限的那部分（粗筛顺序稳定 ⇒ 可逐字核对）');
  // ⚠️ 发现 7 的可失败形式：上面那句 `dropped === 0` 用「两趟粗筛」的写法算不出来——
  //   分叉成 `candidates - enumerated` 的话，本角落会得到 7（= 被引擎拒的 7 条质疑），
  //   于是「下调 LEGAL_ACTION_CAP」会被一条根本没发生的截断触发。
});

test('§7 统计：出牌候选多到超上限时，枚举是候选的**定长前缀**（不写死 64）', () => {
  const s = wideHandScene(LEGAL_ACTION_CAP * 2);
  const stats = getLegalActionStats(s, 0);
  const actions = getLegalActions(s, 0);
  const candidates = candidatesOf(s, 0);
  assert.equal(stats.candidates, candidates.length);
  assert.equal(stats.candidates > LEGAL_ACTION_CAP, true, '前提自查：本局面必须真的把候选推过上限');
  assert.equal(stats.truncated, true, '超上限 ⇒ truncated 必须为真');
  assert.equal(stats.enumerated, LEGAL_ACTION_CAP, '截断点就是上限本身（写死数字的实现会在改上限时红）');
  assert.equal(actions.length, stats.enumerated);
  // 截断是**前缀**截断：保留的正是粗筛顺序的前 CAP 条 ⇒ 同一 state 下枚举结果可复现。
  assert.deepEqual(actions, candidates.slice(0, LEGAL_ACTION_CAP));
  // 上限之下不得谎报截断。
  const narrow = getLegalActionStats(mk(), 0);
  assert.equal(narrow.truncated, false);
  assert.equal(narrow.enumerated, candidatesOf(mk(), 0).length, '常规局面：候选全被接受 ⇒ 枚举==候选');
});

/** 造 `size` 张「无效果、不需目标 ⇒ 每张都可打」的取证牌。 */
function wideCards(size: number): Card[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `wide_card_${String(i)}`,
    name: `宽手牌${String(i)}`,
    type: 'utility' as const,
    cost: 0,
    color: 'red' as const,
    rank: 1,
    text: '取证用：无效果、不需目标',
    effects: [],
  }));
}

/** 把座 0 的手牌整体换成 `wideCards(size)`——⚠️ 只改 `hand`，不碰认证/山议/对峙字段。 */
function withWideHand(s: State, size: number): State {
  const cards = wideCards(size);
  return { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hand: cards } : p)) };
}

/** 手牌特别多 ⇒ 行动阶段候选推过 `LEGAL_ACTION_CAP`（撞停在上限的那条 break 上）。 */
function wideHandScene(handSize: number, players = 4, seed = 7): State {
  return withWideHand(mk(players, seed), handSize);
}

/**
 * 「候选超上限、接受数却不足上限」的角落局面（发现 3 取证）。
 *
 * 构造：8 人局 + 座 1–7 全部待认证（`putPending` 的真实引擎入口）+ 座 0 拿到 44 张可打的牌
 *   + 座 0 灵枢清零。
 * 数字（全部由 `LEGAL_ACTION_CAP` 表达，不写死）：
 *   粗筛 = 2（行棋/问天）+ 44（出牌）+ 7×3（签印/质疑/弃权）= `CAP + 3` = 67；
 *   `certifyChallenge` 要 1 灵枢（粗筛**不看**费用，G-a 同族）⇒ 那 7 条被引擎拒
 *   ⇒ 接受 = 60 < `CAP` ⇒ `getLegalActions` 里那条 `break` 从不执行 ⇒ **没丢任何候选**，
 *     而 `truncated` 按 brief 口径报真。
 * ⚠️ 只改 `hand` 与座 0 的 `resource`（复议/质疑的成本），认证字段一律走引擎入口。
 */
function overCapCornerScene(): State {
  const pendingSeats = [1, 2, 3, 4, 5, 6, 7];
  const wide = withWideHand(putPending(mk(8, 23), pendingSeats), LEGAL_ACTION_CAP - 20);
  return { ...wide, players: wide.players.map((p) => (p.seat === 0 ? { ...p, resource: 0 } : p)) };
}
