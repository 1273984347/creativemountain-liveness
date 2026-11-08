// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedState, probeAction } from '../../engine/core/probe.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { currentPlayer } from '../../engine/core/round.ts';
import { startDuel } from '../../engine/core/duel.ts';
import {
  appealedScene, challengedScene, councilScene, lockedScene, mk, pendingScene,
} from './fixtures.ts';
import {
  getLegalActions, getLegalActionStats, candidatesOf, actionWindowOpen, LEGAL_ACTION_CAP,
} from '../../engine/core/legal.ts';
import { activeAbilityId } from '../../engine/core/passives.ts';
import { cardNeedsTarget, targetCandidates } from '../../engine/core/targeting.ts';
import { certifyAnswer } from '../../engine/core/certification.ts';
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
  const s: State = { ...mk(), duel: { seatA: 0, seatB: 1 } };
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
  const votedOnce = { ...s, council: { ...s.council, votes: { ...s.council.votes, 0: 1 } } };
  assert.equal(getLegalActions(votedOnce, 0).some((a) => a.type === 'VOTE'), false);
});

test('一致性-正向（常驻）：枚举出的每个动作必被引擎接受', () => {
  const scenes = [mk(), mk(8, 23), lockedScene(), pendingScene(), challengedScene(), appealedScene(), councilScene()];
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

test('§7 上限：枚举结果永不超过 LEGAL_ACTION_CAP', () => {
  for (const s of [mk(8, 23), councilScene(8, 23), appealedScene(8, 23)]) {
    for (let seat = 0; seat < s.players.length; seat += 1) {
      assert.ok(getLegalActions(s, seat).length <= LEGAL_ACTION_CAP,
        `座${String(seat)} 枚举 ${String(getLegalActions(s, seat).length)} 条 > ${LEGAL_ACTION_CAP}`);
    }
  }
});

/** 已判定过的局面（用真实入口推进，不手拼字段）。 */
function certifyAnswerRun(s: State): State { return certifyAnswer(s, 1, 0, false).state; }

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
  }
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

/**
 * 手牌特别多（无效果、不需目标 ⇒ 每张都可打）的局面：把行动阶段候选推过 `LEGAL_ACTION_CAP`。
 * ⚠️ 只改 `hand`，不碰认证/山议字段（那些必须走 fixtures 的引擎入口）。
 */
function wideHandScene(handSize: number): State {
  const cards: Card[] = Array.from({ length: handSize }, (_, i) => ({
    id: `wide_card_${String(i)}`,
    name: `宽手牌${String(i)}`,
    type: 'utility' as const,
    cost: 0,
    color: 'red' as const,
    rank: 1,
    text: '取证用：无效果、不需目标',
    effects: [],
  }));
  const s = mk();
  return { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, hand: cards } : p)) };
}
