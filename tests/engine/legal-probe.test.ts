// tests/engine/legal-probe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isolatedState, probeAction } from '../../engine/core/probe.ts';
import { advanceTurn, performAction } from '../../engine/core/turn-runner.ts';
import { startDuel, submitDuelCard } from '../../engine/core/duel.ts';
import { castVote, openCouncil, resolveCouncil, topVoted as topVotedOf } from '../../engine/core/council.ts';
import { currentPlayer, isRoundEnd } from '../../engine/core/round.ts';
import {
  appealedScene, challengedScene, councilScene, exiledScene, gatePayOnlyScene, gateScene, lockedScene, mk, pendingScene, putPending,
} from './fixtures.ts';
import {
  getLegalActions, getLegalActionStats, candidatesOf, actionWindowOpen, LEGAL_ACTION_CAP,
} from '../../engine/core/legal.ts';
import { abilityAvailability, activeAbilityId } from '../../engine/core/passives.ts';
import { cardHasMovement, cardNeedsTarget, targetCandidates } from '../../engine/core/targeting.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { councilVoteTargets } from '../../web/ui/council.ts';
import {
  uiAllows, uiAllowedSet, uiBlockNotice, uiCandidates, uiHasLegalTarget,
} from '../../web/legal-gate.ts';
import { buildChoice, describeAction, describeState } from '../../tools/laya-probe/state-text.mjs';
import { certClickableActions } from '../../web/ui/cert.ts';
import {
  certifyAnswer, certifyAppeal, certifyAppealVote, certifyChallenge, certifySign,
  certificationThreshold, enterPendingCertification,
} from '../../engine/core/certification.ts';
import { distanceToPeak } from '../../engine/core/victory.ts';
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

test('试跑：COMPARE 在**关隘格外**必拒（拒因是真实规则，不再点名 B19）', () => {
  const r = probeAction(mk(), { type: 'COMPARE', actor: 0, cardId: 'c', target: 1 });
  assert.equal(r.ok, false);
  // ⚠️ **B53 修正**：此前这里断言「拒因必须点名 B19」⇒ 那是把 **B18 时期的占位分支**
  //   （`case 'COMPARE': return reject('…未实现（B19）')`）**固化成了预期行为**。
  //   而该占位分支与 B19 的真实试跑分支**同在一个 switch** ⇒ 先命中的占位分支永远生效
  //   ⇒ 出牌比对通道**永远被拒** ⇒ 枚举里永远没有 COMPARE，
  //   而 UI 侧早已接线 ⇒ 「UI 与 AI 同一枚举」在关隘面破口。占位分支已删（B53）。
  //   现在拒因来自**真实规则**（`resolveCompareGate`：「当前不在未通过的{gate}格上」，B79 起是占位符形态）。
  assert.match(r.reason, /{gate}格/, '拒因必须来自真实规则（不再是「未实现」占位）');
});

test('试跑：COMPARE 在**关隘格上**被引擎接受（B53：出牌比对通道已真正可用）', () => {
  const s = gateScene(4, 7, 3, 0);
  const card = s.players[0]?.hand[0];
  assert.ok(card !== undefined, '前提自查：座 0 必须有手牌');
  const r = probeAction(s, { type: 'COMPARE', actor: 0, cardId: card.id, target: 1 });
  assert.equal(r.ok, true, `停在关隘格上时出牌比对必须被引擎接受；实际拒因=${r.reason}`);
});

/**
 * B77：给座 `seat` 挂 `n` 层 `skip_turn`。
 *
 * ⚠️ 为什么下面几条 PASS oracle 都要先套它：B77 起 `performAction('pass')` 只在**被停手番**时
 *   接受 —— 依据是规格 §3.1「行动三选一」（没有"自愿什么都不做"这条），且
 *   `skip_turn_applied` 计数器靠「停手番：」日志计数 ⇒ 若引擎允许主动 PASS，
 *   那个计数器就会被自愿跳过灌水、不再等于"手番真被跳过"。
 *   ⇒ 本文件这几条 oracle 的**意图不变**（探针必须如实报告引擎接受与否），变的只是期望值。
 */
const skipOn = (s: import('../../engine/core/state.ts').State, seat = 0, n = 1) => ({
  ...s,
  players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, skip_turn: n } } : p)),
});

test('试跑：PASS 判据＝引擎是否接受——B77 起"未被封"即拒，"被封"即接受', () => {
  const s = mk();
  // ⚠️ 保留本轮原有两条知识（它们与 B77 无关，仍然成立）：
  //   · `createInitialState` 的 `turnOrder` 就是座位序、`turnIndex` 为 0 ⇒ `currentPlayer(mk()) === 0`；
  //   · `advanceTurn(state, mode)` **没有 actor 参数** ⇒「谁提交 PASS」在引擎里根本不是一个可拒绝的理由。
  //   B77 新增的是第三条：PASS 的合法性判据是 `skip_turn > 0`，不是"手番能不能推进"。
  assert.equal(currentPlayer(s), 0, '前提自查：mk() 的当前手番就是座 0');
  const free = probeAction(s, { type: 'PASS', actor: 0 });
  assert.equal(free.ok, false, '没被停手番 ⇒ 行动三选一，不存在"自愿跳过"');
  assert.match(free.reason, /没人封你/, `拒因要说人话：实际=${free.reason}`);
  const sealed = probeAction(skipOn(s), { type: 'PASS', actor: 0 });
  assert.equal(sealed.ok, true, `被封 ⇒ PASS 是唯一出口且手番确实推进；实际拒因=${sealed.reason}`);
  // ⚠️ 这里**不写**「原 state 的 turnIndex / duel 没被试跑改写」：`isolatedState` 返回新的顶层对象
  //   且引擎全程不可变更新 ⇒ 那两条恒真、任何实现都改不红（本轮变异实测确认）。
  //   「试跑不改写原 state」的真判据是随机源：见文件顶部常驻隔离用例 + 表驱动 loop 的逐条 rng 比对。
});

test('试跑：PASS 的两条真·被拒路径 + 结算立对峙必须算合法（本轮修正的假阴性，B77 起一律在被封局面下测）', () => {
  // ① B13：**已有一场对峙未结算** ⇒ `advanceTurn` 开头 `state.duel !== null` 那条早退直接 `return state`。
  //    对峙用真实入口 startDuel 造，不手拼 duel 字段。
  const dueling = skipOn(startDuel(mk(), 0, 1));
  assert.ok(dueling.duel !== null, '前提自查：startDuel 必须真的立起对峙，否则这条用例是空的');
  const blocked = probeAction(dueling, { type: 'PASS', actor: 0 });
  assert.equal(blocked.ok, false, 'duel !== null ⇒ 手番不推进 ⇒ PASS 被拒（即便已被封）');
  assert.match(blocked.reason, /手番未推进/, `拒因要说清是「没推进」而不是「没人封你」：实际=${blocked.reason}`);
  // ② 无当前手番：`currentPlayer` 返回 -1 ⇒ `advanceTurn` 的 `seat < 0` 早退同样原样返回。
  const noActor = probeAction(skipOn(noActorScene()), { type: 'PASS', actor: 0 });
  assert.equal(noActor.ok, false, '全员出局 ⇒ 没有手番可推进 ⇒ PASS 被拒');
  assert.match(noActor.reason, /手番未推进/);
  // ③ 最阴的一条，也是本轮修正的那条：**手番结算时才立起对峙**
  //    （`advanceTurn` 的「结算后进入对峙」分支 `return next`）。
  //    此时 `finishTurn` 已跑、`turn.finished` 已置、`duel` 对象已生成 ⇒ **引擎确实接受了这次 PASS**，
  //    只是手番推进要挂起，等双方各自锁定亮牌后再走一次 `advanceTurn`（B13）。
  //    旧实现在这里报 `ok:false`，把一条合法 PASS 判成被拒 ⇒ 对 Task 5 是**错误的合法性 oracle**。
  const settleIntoDuel = skipOn(settleIntoDuelScene());
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
  // 反方向也要钉住：`certifyAppeal` 的真实前置是 `target === actor` 且资源 >= 2，
  // 只在「非本人」一条上断言的话，把两个参数写反同样能骗过这条用例。
  assert.equal(probeAction(pendingScene(), { type: 'CERTIFY_APPEAL', actor: 0, target: 0 }).ok, true,
    '待认证者本人（座 0 资源 5 >= 2）申请复议必须合法');
});

test('试跑：15 个动作类型逐一有明确判定，且每次试跑都不消耗原 state 的随机源', () => {
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
  assert.equal(covered.size, 15,
    `必须覆盖 Action union 的全部 15 个成员（B18 新增 GATE_RESOLVE / BARRIER_RESOLVE），实际 ${[...covered].sort().join(', ')}`);
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
  // ⚠️ **B66 更新（G-b 已修）**：`performAction` 的 `act` 分支**现已检查 `pendingCert`**
  //   ⇒ 锁定者打**含位移**的牌被引擎拒绝（规格 §5.1「不能使用移动类卡牌或位移能力」）。
  //   ⇒ 本行从「取证：引擎放行」改为「取证：引擎已拒」——**它当初就是按「引擎补上检查 ⇒ 本行会红」
  //   设计的**，现在正是当场复核登记口径的时刻（而不是让探针偷偷领先引擎）。
  //   ⚠️ **注意**：`firstCardId()` 取的是手牌第一张，**它未必是位移类牌** ⇒ 非位移牌**照打**
  //   （规格只禁位移，不禁一切行动）⇒ 本行必须显式用一张**位移牌**才能验证锁定生效。
  { label: 'PLAY_CARD@待认证锁定（G-b：act 分支查 pendingCert ⇒ 位移类牌被拒）', scene: lockedScene, action: { type: 'PLAY_CARD', actor: 0, cardId: firstCardId() }, ok: true },
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
  // ---- 通道 ③：PASS 以「引擎是否接受」裁决。B77 起第一道判据是 `skip_turn > 0`（行动三选一，
  //      没有"自愿跳过"），其后才是「手番推进 or 结算时立起对峙」——两条老 oracle 原样保留。----
  { label: 'PASS@未被封（行动三选一 ⇒ 不许自愿跳过）', scene: mk, action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /没人封你/ },
  { label: 'PASS@被停手番', scene: () => skipOn(mk()), action: { type: 'PASS', actor: 0 }, ok: true },
  { label: 'PASS@对峙未决', scene: () => skipOn(startDuel(mk(), 0, 1)), action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  { label: 'PASS@结算才立对峙（引擎已接受，推进挂起待对峙结算）', scene: () => skipOn(settleIntoDuelScene()), action: { type: 'PASS', actor: 0 }, ok: true, reasonRe: /挂起/ },
  { label: 'PASS@无当前手番', scene: () => skipOn(noActorScene()), action: { type: 'PASS', actor: 0 }, ok: false, reasonRe: /手番未推进/ },
  // ---- 未接线：只能显式判拒 ----
  { label: 'COMPARE@不在关隘格', scene: mk, action: { type: 'COMPARE', actor: 0, cardId: 'c_gate_trial', target: 1 }, ok: false, reasonRe: /{gate}格/ },
  // ---- B18：关隘通道（GATE_RESOLVE）——不在关隘格上必拒 ----
  { label: 'GATE_RESOLVE@不在关隘格', scene: mk, action: { type: 'GATE_RESOLVE', actor: 0, channel: 'pay' }, ok: false, reasonRe: /{gate}/ },
  // ---- B18-b：裂隙通道（BARRIER_RESOLVE）——不在可放印的裂隙格上必拒 ----
  { label: 'BARRIER_RESOLVE@不在裂隙格', scene: mk, action: { type: 'BARRIER_RESOLVE', actor: 0, channel: 'place' }, ok: false, reasonRe: /裂隙/ },
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
// ⚠️ `PASS` **不枚举**（UI 无「结束手番」入口）。`COMPARE`（关隘出牌比对）**已可枚举**：
//   B19 接了 UI 侧，B53 修掉了探针里未删的 B18 占位分支 ⇒ 不在关隘格上时不枚举，
//   在关隘格上时枚举（见「§7 粗筛与引擎同判」与关隘面漂移守卫）。
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

test('B71 §5.1 待认证锁定：位移族关闭、非位移牌可枚举（与引擎逐条同判）', () => {
  const s = lockedScene();
  const me = s.players[0];
  assert.ok(me !== undefined, '前提：座 0 存在');
  const actions = getLegalActions(s, 0);
  for (const a of actions) {
    assert.equal(['MOVE', 'ROLL_WHEEL', 'ABILITY'].includes(a.type), false, `位移族泄漏 ${a.type}`);
    if (a.type === 'PLAY_CARD') {
      const card = me.hand.find((c) => c.id === a.cardId);
      assert.ok(card !== undefined && !cardHasMovement(card), `位移牌泄漏 ${String(a.cardId)}`);
    }
  }
  // 牙齿（E87：空集 ≠ 有效）：锁定者的非位移牌必须真的被枚举出来。
  assert.ok(actions.some((a) => a.type === 'PLAY_CARD'),
    '锁定者的非位移牌必须可枚举（B71）—— 否则本条在测一个空集');
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
  assert.equal(types.has('COMPARE'), false, '不在关隘格上 ⇒ 不枚举（关隘面另有关隘场景覆盖）');
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
 * ⚠️ 座 0 补到 5 资源是复议的成本（`certifyAppeal` 需 2），与 fixtures 的 `appealedScene` 同一手法。
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

// ============================ 发现 2：粗筛**故意**窄于引擎的五处（取证行）============================
//
// `一致性-正向` 钉的是「枚举 ⊆ 引擎接受」，而这五处是「引擎接受 ⊄ 枚举」——
// 它们不是漏洞，是**登记过的口径**（UI 一致性 / 未接线 gap），`legal.ts` 的
// `actionWindowOpen` 与 `candidatesOf` 注释各有一份完整清单。本条把五处都做成可执行证据，
// 让 Task 9 的登记与 Task 15 的判读引用到**行**而不是引用到**注释**。
// ⚠️ 本条**不改变任何行为**：各处都按现状钉住；若将来引擎/口径改动，本条报红逼着当场复核。
// ⚠️ **B66 更新**：原「五处」中的 a（`pendingCert`）已**不再是「粗筛窄于引擎」** —— G-b 已修
//   （引擎 `act` 分支现查 `pendingCert`）⇒ 引擎与粗筛同判 ⇒ 该条改名为「粗筛与引擎同判·其一」。

test('§7 粗筛与引擎同判·其一（a：pendingCert ⇒ B71 起逐条同判）：非位移发、位移拒且不发', () => {
  const locked = lockedScene();
  const me = locked.players[0];
  assert.ok(me !== undefined, '前提自查：锁定者必须存在');
  const nonMove = me.hand.find((c) => !cardHasMovement(c));
  assert.ok(nonMove !== undefined, '前提自查：锁定者手里必须有非位移牌（否则测不到「发」这一侧）');

  // ① 非位移牌：引擎放行 ∧ 枚举发。
  const okRes = probeAction(locked, { type: 'PLAY_CARD', actor: 0, cardId: nonMove.id });
  assert.equal(okRes.ok, true, `引擎侧：非位移牌必须被放行；实际拒因=${okRes.reason}`);
  assert.ok(candidatesOf(locked, 0).some((a) => a.type === 'PLAY_CARD' && a.cardId === nonMove.id),
    '粗筛侧：非位移牌必须发（B71 与引擎同判）');

  // ② 位移牌：引擎拒 ∧ 枚举不发（用主题里真实存在的位移牌，覆盖 utility / 嵌套形状）。
  const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8')) as { cards: Card[] };
  const moveCard = theme.cards.find((c) => cardHasMovement(c));
  assert.ok(moveCard !== undefined, '前提自查：主题里必须有位移牌');
  // ⚠️ 不能用 `structuredClone`：它会把 `state.rng` 的类原型剥掉（`snapshot is not a function`）
  //   ⇒ 手建浅拷贝，只替换座 0 的手牌（rng 等其余引用保持原样）。
  const withMove: State = {
    ...locked,
    players: locked.players.map((p) => (p.seat === 0
      ? { ...p, hand: [...p.hand, { ...moveCard, id: 'b71_move_probe' }] }
      : p)),
  };
  const target = cardNeedsTarget(moveCard) ? targetCandidates(withMove, 0)[0] : undefined;
  const moveAction = target === undefined
    ? { type: 'PLAY_CARD' as const, actor: 0, cardId: 'b71_move_probe' }
    : { type: 'PLAY_CARD' as const, actor: 0, cardId: 'b71_move_probe', target };
  const rejRes = probeAction(withMove, moveAction);
  assert.equal(rejRes.ok, false, '引擎侧：锁定者打位移牌必须被拒（G-b 已修）');
  assert.equal(candidatesOf(withMove, 0).some((a) => a.type === 'PLAY_CARD' && a.cardId === 'b71_move_probe'), false,
    '粗筛侧：位移牌不得发（与引擎同判）');
});

test('§7 粗筛与引擎同判·其二（b：duel !== null ⇒ G-f 已修）：参与者拿到选牌候选，非参与者无候选', () => {
  // 对峙用真实入口 startDuel 造（发现 5：不手拼 `duel` 字段）。
  const d = startDuel(mk(4, 7), 0, 1);
  assert.ok(d.duel !== null, '前提自查：startDuel 必须真的立起对峙');
  // ⚠️ **B68 更新（G-f 已修）**：此前断言「对峙未决 ⇒ 粗筛整表清零」——那正是 G-f 的缺口
  //   （对峙选牌无 Action 成员 ⇒ AI/sidecar 拿到空动作表）⇒ 现改为「**同判**」：
  //   · **对峙参与者** ⇒ 拿到自己手牌的选牌候选（不再是空集）；
  //   · **非参与者** ⇒ 无候选（他们此刻没有可做的动作）。
  for (let seat = 0; seat < d.players.length; seat += 1) {
    const isParticipant = seat === d.duel?.seatA || seat === d.duel?.seatB;
    const duelActions = candidatesOf(d, seat).filter((a) => a.type === 'DUEL_SUBMIT_CARD');
    if (isParticipant) {
      assert.ok(duelActions.length > 0,
        `座${String(seat)}：对峙参与者必须拿到选牌候选（G-f 已修 ⇒ 不再是空动作表）`);
      // ⚠️ **可见性边界（预研红线 3）**：候选的 `cardId` **只能是自己手牌里的牌**
      //   ⇒ 拿不到对方的手牌 id ⇒ 无法看到对方将出什么牌。
      const myIds = new Set(d.players[seat]?.hand.map((c) => c.id) ?? []);
      for (const a of duelActions) {
        assert.equal(a.type === 'DUEL_SUBMIT_CARD' && myIds.has(a.cardId), true,
          `座${String(seat)}：选牌候选只能是自己手牌里的牌（不得含他人手牌 id）`);
      }
    } else {
      assert.equal(candidatesOf(d, seat).length, 0,
        `座${String(seat)}：非对峙参与者 ⇒ 无可做动作`);
    }
  }
  const pick = d.players[0]?.hand[0];
  assert.ok(pick !== undefined, '前提自查：对峙双方必须有牌可选');
  const submitted = submitDuelCard(d, 0, pick.id);
  assert.equal(submitted.ok, true,
    `引擎侧：玩家此刻仍有可执行的入口 submitDuelCard（无对应 Action 成员 ⇒ 枚举永远给不出它）：${submitted.note}`);
});

test('§7 粗筛窄于引擎·其三（c：phase）：引擎从不读 phase ⇒ 山议里行棋仍被接受，枚举不发', () => {
  const council = councilScene();
  assert.equal(council.phase, '山议', '前提自查：本局面的阶段必须不是「行动」');
  const r = probeAction(council, { type: 'MOVE', actor: 0, steps: 0 });
  assert.equal(r.ok, true, `引擎侧：` + '`performAction` 全程不读 `state.phase`' + ` ⇒ 行棋被放行；实际拒因=${r.reason}`);
  assert.equal(actionWindowOpen(council, 0), false, '粗筛侧：phase !== 行动 ⇒ 窗口关闭');
  assert.equal(getLegalActions(council, 0).some((a) => a.type === 'MOVE'), false, '粗筛侧：不发 MOVE/ROLL_WHEEL/PLAY_CARD');
});

test('§7 粗筛窄于引擎·其四（d：isRoundEnd）：引擎从不看 turnIndex，枚举按 round 末关闭', () => {
  const ended = roundEndScene();
  assert.ok(isRoundEnd(ended), '前提自查：本局面必须真的处于 round 末（turnIndex >= 存活人数）');
  assert.equal(ended.phase, '行动', '前提自查：阶段仍是行动 ⇒ 关掉窗口的只有 isRoundEnd 这一条判据');
  assert.equal(ended.duel, null, '前提自查：没有对峙干扰这条判据');
  assert.equal(actionWindowOpen(ended, 0), false);
  const r = probeAction(ended, { type: 'MOVE', actor: 0, steps: 0 });
  assert.equal(r.ok, true, `引擎侧：performAction 不看 turnIndex / 手番归属 ⇒ 行棋被放行；实际拒因=${r.reason}`);
  assert.equal(getLegalActions(ended, 0).some((a) => a.type === 'MOVE'), false, '粗筛侧：round 已走完 ⇒ 不发');
});

test('§7 粗筛窄于引擎·其五（e：死亡座位）：引擎从不查 alive ⇒ 出局座位的动作仍被接受，枚举不发', () => {
  const dead = exiledScene(4, 7, 3);
  assert.equal(dead.players[3]?.alive, false, '前提自查：座 3 必须真的已出局');
  assert.equal(dead.phase, '行动', '前提自查：阶段仍是行动 ⇒ 关掉窗口的只有「死亡座位」这一条判据');
  assert.equal(dead.duel, null, '前提自查：没有对峙干扰这条判据');
  assert.equal(dead.council.resolved, true, '前提自查：山议未在进行');
  // 引擎侧：performAction 只查 player === undefined，**从不查 alive** ⇒ 出局座位的动作被放行
  const r = probeAction(dead, { type: 'MOVE', actor: 3, steps: 0 });
  assert.equal(r.ok, true, `引擎侧：performAction 不查 alive ⇒ 出局座位仍被放行；实际拒因=${r.reason}`);
  // 粗筛侧：candidatesOf 的 alive !== true ⇒ 整表清零
  assert.equal(candidatesOf(dead, 3).length, 0, '粗筛侧：死亡座位 ⇒ 整表清零');
  assert.equal(getLegalActions(dead, 3).length, 0, '粗筛侧：枚举因此为空集');
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
 *   + 座 0 资源清零。
 * 数字（全部由 `LEGAL_ACTION_CAP` 表达，不写死）：
 *   粗筛 = 2（行棋/问天）+ 44（出牌）+ 7×3（签印/质疑/弃权）= `CAP + 3` = 67；
 *   `certifyChallenge` 要 1 资源（粗筛**不看**费用，G-a 同族）⇒ 那 7 条被引擎拒
 *   ⇒ 接受 = 60 < `CAP` ⇒ `getLegalActions` 里那条 `break` 从不执行 ⇒ **没丢任何候选**，
 *     而 `truncated` 按 brief 口径报真。
 * ⚠️ 只改 `hand` 与座 0 的 `resource`（复议/质疑的成本），认证字段一律走引擎入口。
 */
function overCapCornerScene(): State {
  const pendingSeats = [1, 2, 3, 4, 5, 6, 7];
  // ⚠️ B75：宽手牌现在**每张产生两条候选**（`play:` + `equip:`，装备免费 ⇒ 连资源归零也照收）
  //   ⇒ 沿用 `CAP - 20`（=44 张）会把接受数推到正好等于上限，break 真的执行 ⇒ 本角落不再成立。
  //   取半（44/2 = 22 张 ⇒ 实测 candidates=67 > 64、enumerated=60 < 64、dropped=0）回到同一个角落；
  //   ⚠️ 只许改**断言数据**，`LEGAL_ACTION_CAP` 本身不得为了用例好看而上调。
  const wide = withWideHand(putPending(mk(8, 23), pendingSeats), Math.floor((LEGAL_ACTION_CAP - 20) / 2));
  return { ...wide, players: wide.players.map((p) => (p.seat === 0 ? { ...p, resource: 0 } : p)) };
}

// ============================ Task 7：漂移守卫（常驻）——两独立实现集合相等 ============================
//
// 规格 §7「UI 与 AI 使用同一枚举」的落地判据：`web/legal-gate.ts` 是 UI 门禁的**独立表达**
// （不 import `getLegalActions`，`uiAllowedSet` 自建候选），本测试把两条独立实现钉成集合相等。
// ⚠️ 两层都要比（发现 2 的教训）：
//   · **枚举层** `uiAllowedSet == getLegalActions.map(actionKey)`——最终可点集合；
//   · **候选层** `uiCandidates == candidatesOf.map(actionKey)`——粗筛本身。
//   只比枚举层的话，「粗筛与试跑同步收窄」这类漂移对它失明（两边同时少发也照样相等），
//   故候选层单独立一条：未来任何一侧把粗筛悄悄变窄 ⇒ 这条先红，而不是让模型的选项无声缩水。
// ⚠️ 局面取自 fixtures + 本文件已有的 `challengedThenPendingScene` / `coPendingAppealScene`
//   两个**真实引擎构造**的同场双待认证局面——后者正是预测到的那处真漂移（发现 1）：
//   co-pending 座位依引擎可合法投复议票，而 `web/legal-gate.ts` 的草稿判据 `!pending.includes(seat)`
//   比引擎严，只有把这个局面放进守卫才会变红。

/**
 * B77 封锁局面工厂：只动 `statuses`，其它字段一律由真实入口/既有夹具产生。
 *
 * ⚠️ 每个局面都必须让**两侧都有非空集合**（E87：空集 ≠ 有效）——
 *   skip 面发 PASS、silence 面发 MOVE/EQUIP 但不发出牌，两侧任一侧漏判就会被集合相等抓到。
 */
type B77Status = 'poison' | 'slow' | 'silence' | 'skip_turn';
function withStatusOn(s: State, seat: number, patch: Partial<Record<B77Status, number>>): State {
  return { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, statuses: { ...p.statuses, ...patch } } : p)) };
}
const skipTurnScene = (seed: number): State => withStatusOn(mk(8, seed), 0, { skip_turn: 1 });
const silencedScene = (seed: number): State => withStatusOn(mk(8, seed), 0, { silence: 1 });
/** 锁定 × 封口（T7 发现的缺口：这条分支原先两层都没应用封口）。 */
const silencedLockedScene = (seed: number): State => withStatusOn(putPending(mk(4, seed), [0]), 0, { silence: 1 });
/** 停手番 × 停在未通过关隘 ⇒ 解阻塞通道必须照发、PASS 必须不出现（防死锁 + 防"跳过关隘"）。 */
const gateWhileBlockedScene = (seed: number): State =>
  withStatusOn(withStatusOn(gateScene(4, seed, 3, 0), 0, { silence: 2 }), 0, { skip_turn: 2 });

/**
 * 漂移守卫遍历的局面集（按 seed 参数化；含两处 co-pending 真漂移取证局面）。
 *
 * ⚠️ 修复轮新增的后四个局面（裁定 R-3：原九局面**抓不到**以下几处判据被删，变异实测见报告）：
 *   · `starvedCertScene` —— 全座位资源归零 ⇒ 钉 `uiAllows` 的 `resource >= 1 / >= 2` 两条（R-4 保留并钉死）；
 *   · `appealVoteCastScene` —— 复议票真的落账过 ⇒ 钉「已投过复议票」在门禁层与粗筛层的那一对判据；
 *   · `exiledCouncilAppealScene` —— 有座位被山议放逐**且**复议窗口还开着 ⇒ 钉存活早退与三处存活/非本人判据；
 *   · `councilVotedActionPanelScene` —— 山议进行中且座 0 已投过一票 ⇒ 钉 VOTE 的「已投过票」并供 R-2 的行动面板场景。
 * 四个都由**引擎入口**构造（pending / appealed / 投票 / 放逐一律走 certifyX / castVote / resolveCouncil），
 * 只动 `resource` 与 `hand`（成本与手牌），认证/山议/对峙字段一个不手拼。
 */
function driftScenes(seed: number): State[] {
  return [
    mk(4, seed), mk(8, seed), lockedScene(),
    pendingScene(4, seed), challengedScene(4, seed), appealedScene(5, seed), councilScene(4, seed),
    challengedThenPendingScene(), coPendingAppealScene(),
    starvedCertScene(seed), appealVoteCastScene(seed),
    exiledCouncilAppealScene(seed), councilVotedActionPanelScene(seed),
    // ⚠️ B75.1：否决的「自救不发 / 救他人要发」两条形状都进守卫（只进前者 ⇒ 两侧同空集，等于没测）
    councilVetoSelfRescueScene(seed), councilVetoSaveOtherScene(seed),
    // ⚠️ B76：力竭恢复的双侧形状（自恢要发 / 救援要发——E87：空集 ≠ 有效）
    exhaustedSelfScene(seed), exhaustedRescueScene(seed),
    // ⚠️ B53：加入**关隘局面** ⇒ 「COMPARE 是否枚举」那一面不再恒为空集（E87）
    gateScene(4, seed),
    // ⚠️ B77：封锁的三种形状各进一个局面（PASS 只由 skip 发 / 出牌被 silence 拿掉 /
    //   锁定+封口同时成立时两层都得记得封口），外加「被封却停在关隘上」的防死锁形状。
    skipTurnScene(seed), silencedScene(seed), silencedLockedScene(seed), gateWhileBlockedScene(seed),
  ];
}

/** 失败诊断用的一句话局面画像（不手拼状态，只读已有字段）。 */
function sceneTag(s: State): string {
  const c = s.certification;
  return `phase=${s.phase} duel=${s.duel === null ? 'null' : 'yes'}`
    + ` pending=[${c.pending.join(',')}] challenged=[${c.challenged.join(',')}]`
    + ` appealed=[${c.appealed.join(',')}] judgments=${JSON.stringify(c.judgments)}`
    + ` appealVotes=${JSON.stringify(c.appealVotes)}`;
}

test('B77：封锁局面必须有**非空的正面形状**（两侧一起漏判也会让集合相等变绿，E87 的另一半）', () => {
  const shape = (s: State, seat: number): string[] =>
    [...new Set(getLegalActions(s, seat).map((a) => a.type))].sort();
  const uiShape = (s: State, seat: number): string[] =>
    [...new Set(uiCandidates(s, seat).filter((a) => uiAllows(s, seat, a)).map((a) => a.type))].sort();
  for (const seed of [7, 11, 23]) {
    const skipped = skipTurnScene(seed);
    assert.deepEqual(shape(skipped, 0), ['PASS'], `被封者的合法动作必须恰好是 PASS：${JSON.stringify(shape(skipped, 0))}`);
    assert.deepEqual(uiShape(skipped, 0), ['PASS'], 'UI 侧必须同形状（漏发 PASS ⇒ 被封者点不动，等于卡死）');
    assert.notDeepEqual(shape(skipped, 1), ['PASS'], '反证：只有座 0 被封，别人的行动面不该被牵连');

    const silenced = silencedScene(seed);
    const ss = shape(silenced, 0);
    assert.ok(ss.includes('MOVE'), `封口不能拿走行棋：${JSON.stringify(ss)}`);
    assert.ok(!ss.includes('PLAY_CARD'), '封口必须拿走出牌（UI 同理，见集合相等守卫）');

    const gateBlocked = gateWhileBlockedScene(seed);
    const gb = shape(gateBlocked, 0);
    assert.ok(gb.includes('GATE_RESOLVE'), `被封者必须还能解关隘，否则死锁：${JSON.stringify(gb)}`);
    assert.ok(!gb.includes('PASS'), '通道没选完之前不得发 PASS（否则等于允许跳过关隘）');
    assert.deepEqual(uiShape(gateBlocked, 0), gb, '关隘×封锁面上 UI 与引擎必须同形状');
  }
});


test('X4 回归锁：payOnly 关隘面 UI 与引擎**同判**「本关已改为付费」', () => {
  // ⚠️ 这条判据**不能靠集合相等守卫**：payOnly 时 `uiCandidates` 本就不发 COMPARE 候选
  //   ⇒ 枚举层 / 候选层守卫**结构上看不见**这条（盲审变异实测：回退 X4 后守卫仍全绿）。
  //   ⇒ 必须**直接断言 `uiBlockNotice` 与 `probeAction` 同判**。
  const s = gatePayOnlyScene(4, 7, 3, 0);
  const card = s.players[0]?.hand[0];
  assert.ok(card !== undefined, '前提自查：座 0 必须有手牌');
  const action = { type: 'COMPARE' as const, actor: 0, cardId: card.id, target: 1 };
  // UI 侧：必须拒，且拒因点名「已改为付费」（否则玩家会点一个引擎必然拒绝的动作）
  const notice = uiBlockNotice(s, 0, action);
  assert.notEqual(notice, null, 'payOnly 关隘面上 UI 必须拒绝出牌比对');
  assert.match(String(notice), /已改为付费/, '拒因必须点名「本关已改为付费」');
  // 引擎侧：同样拒，且拒因同样点名 ⇒ 两侧**同判**
  const r = probeAction(s, action);
  assert.equal(r.ok, false, '引擎侧必须拒绝（payOnly 关隘只剩付费通道）');
  assert.match(r.reason, /已改为付费/, '引擎拒因必须点名「本关已改为付费」');
});
test('漂移守卫（常驻·面板层）：山议面板的可投目标集合 == 引擎枚举的 VOTE 集合', () => {
  // 面板的「可投谁」是 UI 侧独立表达（`web/ui/council.ts` 的 `councilVoteTargets`），
  // 必须与引擎枚举的 VOTE 集合一致 ⇒ 否则「UI 与 AI 使用同一枚举」在山议面破口。
  for (const seed of [7, 11, 23, 37, 53]) {
    for (const s of driftScenes(seed)) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        const engine = getLegalActions(s, seat)
          .filter((a) => a.type === 'VOTE')
          .map((a) => (a.type === 'VOTE' ? a.target : -1))
          .sort((x, y) => x - y);
        const panel = councilVoteTargets(s, seat).slice().sort((x, y) => x - y);
        assert.deepEqual(panel, engine,
          `seed=${String(seed)} seat=${String(seat)} phase=${s.phase}：面板可投集合必须等于引擎 VOTE 集合`
          + `\n  面板=${JSON.stringify(panel)}\n  引擎=${JSON.stringify(engine)}`);
      }
    }
  }
});
test('漂移守卫（常驻·枚举层）：uiAllowedSet == getLegalActions（UI 与引擎两独立实现集合相等）', () => {
  for (const seed of [7, 11, 23, 37, 53]) {
    for (const s of driftScenes(seed)) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        const engine = getLegalActions(s, seat).map(actionKey).sort();
        assert.deepEqual(
          uiAllowedSet(s, seat).sort(), engine,
          `枚举层漂移：seed=${String(seed)} seat=${String(seat)} ${sceneTag(s)}\n`
          + `  UI=${JSON.stringify(uiAllowedSet(s, seat).sort())}\n`
          + `  引擎=${JSON.stringify(engine)}`,
        );
      }
    }
  }
});

test('漂移守卫（常驻·候选层）：uiCandidates == candidatesOf（粗筛不得被任一侧悄悄收窄）', () => {
  for (const seed of [7, 11, 23, 37, 53]) {
    for (const s of driftScenes(seed)) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        const engine = candidatesOf(s, seat).map(actionKey).sort();
        assert.deepEqual(
          uiCandidates(s, seat).map(actionKey).sort(), engine,
          `候选层漂移：seed=${String(seed)} seat=${String(seat)} ${sceneTag(s)}\n`
          + `  UI候选=${JSON.stringify(uiCandidates(s, seat).map(actionKey).sort())}\n`
          + `  引擎候选=${JSON.stringify(engine)}`,
        );
      }
    }
  }
});

// ============================ Task 7 修复轮（评审 A–E ⇒ 裁定 R-1 … R-6）============================
//
// 评审的 A/B/C 三条都落在同一件事上：**守卫的失败面太窄**——
//   · A：`uiAllows` 之外还有三处旁路（发动被动按钮、需目标牌的选目标入口**与提交路径**、
//     `cert.ts` 逐按钮的手写显隐）⇒「legal-gate 是 UI 可点性唯一来源」这句承诺在**发货的 DOM** 里不成立；
//   · B：被 `uiAllows` 挡下的点击静默 `return` ⇒ 玩家只得到一个死按钮；
//   · C：原九个漂移局面里**没有**出局座位、**没有**资源见底、**没有**落过账的复议票
//     ⇒ `uiAllows` 的存活/费用/已投票判据与 `uiCandidates` 的存活早退**四条可删而两守卫全绿**（变异实测见报告）。
// 下面的四条新常驻用例把这三条做成可失败钉：
//   ① 门禁层（候选**之外**的越界形状 uiAllows vs probeAction 逐条同判）——C 的失败面；
//   ② 面板可点性 == 引擎认证面（A 的 cert.ts 部分，无 DOM 也能钉）；
//   ③ 拒绝不得沉默（B：`uiBlockNotice` 必须给得出点名原因来源的一句话）；
//   ④ 行动面入口过闸 + 源码接线（A 的 main.ts 部分：纯函数判据 + 锚点文本防旁路回流）。
// D（保留两条 `resource >=` 并钉死、G-a 冲突交 Task 9）由 ① 与「资源见底」局面承担；
// E（复议裁定在数字轨无人调用 ⇒ 新登记 G-g）**不在这里实现**（G-g 已由 B63 接线修掉），见 `web/ui/cert.ts` 的注释与报告 §7.3。

// ---- 修复轮新增的四个局面（全部引擎入口构造，只动 resource / hand / flags.passive）----

/**
 * 「资源见底」的认证局面（裁定 R-3 其二；同时把 R-4 保留的两条 `resource >=` 钉成可失败判据）。
 *
 * `pending` 走 `putPending`（真实 `enterPendingCertification` + `advanceCertificationRound`），
 * 之后只把 `resource` 归零、`hand` 削到 2 张——质疑要 1 资源、复议要 2 资源 ⇒ 这两类动作引擎必拒，
 * 而 `candidatesOf` 的粗筛**不看费用**（G-a 同族）⇒ 「UI 侧少了那条费用判据」只能从**枚举层守卫**露出来。
 * ⚠️ 手牌削小、待认证者只留 2 名：候选 10 条，远低于 `LEGAL_ACTION_CAP`
 *   ——撞上限时两侧一起被截断，比的就是截断而不是判据（`overCapCornerScene` 是同一手法的价格参照）。
 */
function starvedCertScene(seed: number): State {
  const base = putPending(mk(4, seed), [1, 2]);
  const s: State = {
    ...base,
    players: base.players.map((p) => ({ ...p, resource: 0, hand: p.hand.slice(0, 2) })),
  };
  assert.deepEqual(s.players.map((p) => p.resource), [0, 0, 0, 0],
    'starvedCertScene：局面名承诺「资源见底」⇒ 全座位 resource 必须为 0');
  for (const seat of [0, 1]) {
    assert.ok(candidatesOf(s, seat).length < LEGAL_ACTION_CAP,
      `starvedCertScene：座${String(seat)} 候选必须留在上限之下（否则两侧一起被截断，测不到判据）`);
    assert.equal(getLegalActionStats(s, seat).dropped, 0,
      `starvedCertScene：座${String(seat)} 不得有候选因上限而未试跑`);
  }
  // 牙齿前提：候选**在册**而枚举**被拒**——这条差值正是 uiAllows 那两条费用判据的容身之处。
  assert.ok(candidatesOf(s, 0).some((a) => a.type === 'CERTIFY_CHALLENGE'),
    'starvedCertScene：0 资源的质疑候选必须在粗筛里（粗筛不发就谈不上门禁可删）');
  assert.equal(getLegalActions(s, 0).some((a) => a.type === 'CERTIFY_CHALLENGE'), false,
    '引擎侧：certifyChallenge 需 1 点资源 ⇒ 0 资源必被拒');
  assert.ok(candidatesOf(s, 1).some((a) => a.type === 'CERTIFY_APPEAL'),
    'starvedCertScene：座 1（待认证者）的复议候选必须在粗筛里');
  assert.equal(getLegalActions(s, 1).some((a) => a.type === 'CERTIFY_APPEAL'), false,
    '引擎侧：certifyAppeal 需 2 点资源 ⇒ 0 资源必被拒（死的「申请复议」按钮由此判死）');
  return s;
}

/**
 * 「复议票已落账」的局面（裁定 R-3 其三）。
 *
 * `certifyAppealVote(座 3)` 真投出去之后，「已投过复议票」这条判据同时存在于
 * 门禁层（`uiAllows`）与粗筛层（`uiCandidates` ↔ `candidatesOf` 的同名早退）——
 * ⚠️ 只有把这个局面放进守卫，**两侧同时删**（评审点名的 `:140` + `:213`）才会露出来：
 *   粗筛删 ⇒ 候选层红；门禁删 ⇒ 枚举层红；两个都删 ⇒ 枚举层仍红（引擎试跑拒）。
 */
function appealVoteCastScene(seed: number): State {
  const appealed = appealedScene(5, seed);
  const cast = certifyAppealVote(appealed, 3, 0, true);
  assert.ok(cast.ok, 'appealVoteCastScene：座 3 的复议票必须真的投出去：' + noteOf(cast.note));
  assert.equal(cast.state.certification.appealVotes[3], true,
    'appealVoteCastScene：后置——局面名承诺「已落账」⇒ appealVotes[3] 必须是 true');
  const s = cast.state;
  assert.equal(candidatesOf(s, 3).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false,
    '引擎侧：已投过票 ⇒ 粗筛不再给座 3 发复议票候选');
  assert.ok(candidatesOf(s, 2).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'),
    '对照：座 2 未投票 ⇒ 复议票候选仍在册（否则本局面测的是「压根没有复议票」）');
  assert.ok(getLegalActions(s, 2).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'),
    '对照：座 2 的复议票被引擎接受');
  assert.equal(getLegalActions(s, 3).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'), false,
    '引擎侧：座 3 已无可投的票');
  return s;
}

/**
 * 「有座位被山议放逐、而复议窗口还开着、山议再次进行中」的局面（裁定 R-3 其一）。
 *
 * 全程引擎入口：`appealedScene` → `openCouncil` → 三张票投给座 3 → `resolveCouncil`（真放逐）
 * → 再 `openCouncil` 一次（⇒ 「出局座位 + 山议进行中」，`uiCandidates` 的存活早退才有牙）。
 * ⚠️ 一个局面同时覆盖四处判据（评审点名的 `:110-112`、`:141`、`:160-161`）：
 *   · 出局座位**作为投票人** / **作为投票目标** / **作为复议投票人** 三种越界形状；
 *   · 出局座位的候选整表必须为空（`candidatesOf` 的存活早退镜像）。
 */
function exiledCouncilAppealScene(seed: number): State {
  let s = appealedScene(5, seed);
  const opened = openCouncil(s);
  assert.ok(opened.ok, 'exiledCouncilAppealScene：开启山议必须成功：' + noteOf(opened.note));
  s = opened.state;
  for (const voter of [0, 2, 4]) {
    const r = castVote(s, voter, 3);
    assert.ok(r.ok, `exiledCouncilAppealScene：座 ${String(voter)} 投票必须成功：` + noteOf(r.note));
    s = r.state;
  }
  const resolved = resolveCouncil(s);
  assert.ok(resolved.ok, 'exiledCouncilAppealScene：山议结算必须成功：' + noteOf(resolved.note));
  s = resolved.state;
  assert.equal(s.players[3]?.alive, false,
    'exiledCouncilAppealScene：后置——局面名承诺「有座位被放逐」⇒ 座 3 必须真的 alive=false');
  assert.ok(s.certification.appealed.includes(0), 'exiledCouncilAppealScene：放逐不得关掉复议窗口');
  assert.equal(s.certification.judgments[1], false, 'exiledCouncilAppealScene：待复议的失败判定必须还在');
  const reopened = openCouncil(s);
  assert.ok(reopened.ok, 'exiledCouncilAppealScene：第二次山议必须开起来：' + noteOf(reopened.note));
  s = reopened.state;
  assert.equal(s.council.resolved, false,
    'exiledCouncilAppealScene：后置——山议必须**再次进行中**（否则出局座位发不出 VOTE 候选，存活早退就没牙）');
  assert.equal(s.players.filter((p) => !p.alive).length, 1, 'exiledCouncilAppealScene：恰有一名出局座位');
  assert.equal(candidatesOf(s, 3).length, 0, '引擎侧：出局座位整体无候选（UI 侧同名早退被删就在这里露）');
  assert.ok(candidatesOf(s, 2).some((a) => a.type === 'CERTIFY_APPEAL_VOTE'),
    'exiledCouncilAppealScene：有人出局不影响他人继续投复议票');
  return s;
}

/**
 * 「山议进行中 ∧ 座 0 已投过一票 ∧ 座 1 的行动面板照常渲染」的局面（裁定 R-3 的 B 项场景）。
 *
 * 这是发现 B 的**真实落点**：座 1 存活、未待认证、无对峙 ⇒ `renderActions` 走到行棋/问天/手牌那一支，
 * 而 `uiAllows` 因 `phase !== '行动'` 全部拒 ⇒ 按钮不出现，但**手牌点击仍会发生**，
 * 拒了却不说话就等于死按钮。本局面同时钉住 VOTE 的「本轮已投过票」那条判据（座 0）。
 */
function councilVotedActionPanelScene(seed: number): State {
  const opened = openCouncil(mk(4, seed));
  assert.ok(opened.ok, 'councilVotedActionPanelScene：开启山议必须成功：' + noteOf(opened.note));
  const voted = castVote(opened.state, 0, 1);
  assert.ok(voted.ok, 'councilVotedActionPanelScene：座 0 投票必须成功：' + noteOf(voted.note));
  const s = voted.state;
  assert.equal(s.phase, '山议', 'councilVotedActionPanelScene：后置——必须是山议阶段（行动面板靠它才被拒）');
  assert.equal(s.council.resolved, false, 'councilVotedActionPanelScene：后置——山议仍在进行');
  assert.equal(s.council.votes[0], 1, 'councilVotedActionPanelScene：后置——座 0 的票必须真的落账');
  assert.equal(s.duel, null, 'councilVotedActionPanelScene：后置——不得有对峙（否则测的是对峙分支）');
  assert.equal(s.certification.pending.length, 0, 'councilVotedActionPanelScene：后置——本局面不掺认证面');
  const p1 = s.players[1];
  assert.ok(p1 !== undefined && p1.alive && !p1.pendingCert && p1.hand.length > 0,
    'councilVotedActionPanelScene：座 1 的行动面板必须会渲染出行棋/问天与手牌（发现 B 的前提）');
  assert.equal(getLegalActions(s, 0).some((a) => a.type === 'VOTE'), false,
    '引擎侧：座 0 已投过票 ⇒ 不再给 VOTE');
  assert.ok(getLegalActions(s, 1).some((a) => a.type === 'VOTE'),
    '对照：座 1 未投票 ⇒ VOTE 仍在（本局面不是「全员投完」）');
  return s;
}

/**
 * B75.1：否决的两种形状各进一次漂移守卫（只进「自救」那一条的话，两侧同为空集 ⇒ 守卫失去覆盖面，E87）。
 *
 * · `councilVetoSelfRescueScene` —— 持权者**自己**被最高票 ⇒ 两侧都必须**不**发 `COUNCIL_VETO`；
 * · `councilVetoSaveOtherScene` —— 持权者**别人**被最高票 ⇒ 两侧都必须发（证明上一条不是「整面关掉」蒙对的）。
 * 两个都由**引擎入口**构造（投票一律走 `castVote`），只挂 `flags.canVeto`（夹具，生产走身份 `rights`）。
 */
function councilVetoSceneWithTop(seed: number, holder: number, top: number): State {
  let s = councilScene(4, seed);
  s = { ...s, players: s.players.map((p) => (p.seat === holder ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive)) {
    // 被提名者自己也必须投票（票齐是前置）⇒ 投给除自己外的任意存活座位
    const others = s.players.filter((x) => x.alive && x.seat !== p.seat).map((x) => x.seat);
    const to = p.seat === top ? (others[0] ?? 0) : top;
    const r = castVote(s, p.seat, to);
    assert.ok(r.ok, `councilVetoScene(${holder},${top})：座 ${String(p.seat)} 投票必须成功：` + noteOf(r.note));
    s = r.state;
  }
  // 后置：局面名承诺的形状必须真的成立，否则下面的集合比较是空对空。
  assert.equal(s.council.resolved, false, 'councilVetoScene：必须是「山议进行中」');
  for (const p of s.players.filter((x) => x.alive)) {
    assert.notEqual(s.council.votes[p.seat], undefined, 'councilVetoScene：全员（存活）必须都已投票 ⇒ 前置条件不能悄悄不成立');
  }
  return s;
}


/** B76：力竭自恢场景——座 0 力竭、资源充足 ⇒ 三层都必须发自恢候选。 */
function exhaustedSelfScene(seed: number): State {
  const s = mk(4, seed);
  return { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, exhaustedRounds: 2, resource: 3, hp: 0 } : p)) };
}

/** B76：力竭救援场景——座 1 力竭、座 0 不力竭且有资源 ⇒ 三层都必须发救援候选。 */
function exhaustedRescueScene(seed: number): State {
  const s = mk(4, seed);
  return { ...s, players: s.players.map((p) => (p.seat === 1 ? { ...p, exhaustedRounds: 2, resource: 0, hp: 0 } : p)) };
}

function councilVetoSelfRescueScene(seed: number): State {
  const s = councilVetoSceneWithTop(seed, 0, 0);
  assert.ok(topVotedOf(s).includes(0), 'councilVetoSelfRescueScene：座 0 必须真的被最高票（否则测的是别的判据）');
  assert.equal(getLegalActions(s, 0).some((a) => a.type === 'COUNCIL_VETO'), false,
    '引擎侧：自救必须被拒 ⇒ 不得进最终候选（发了就是死选项）');
  return s;
}

function councilVetoSaveOtherScene(seed: number): State {
  const s = councilVetoSceneWithTop(seed, 0, 1);
  assert.ok(topVotedOf(s).includes(1) && !topVotedOf(s).includes(0),
    'councilVetoSaveOtherScene：被最高票的必须是**别人**（座 1），且座 0 不在最高票里');
  assert.ok(getLegalActions(s, 0).some((a) => a.type === 'COUNCIL_VETO'),
    '引擎侧：救他人的否决候选必须真的在册（否则上一条「自救不发」可能是整面关掉蒙对的）');
  return s;
}

// ---- ① 门禁层：候选之外的越界形状也要与引擎同判 ----

/**
 * 逐条形状矩阵：山议面 + 认证面的**全部 target 组合**（含自己、含出局座位）。
 *
 * ⚠️ 为什么只有这两面：行动面（MOVE/ROLL_WHEEL/PLAY_CARD/ABILITY）的 `uiAllows` 还多压了
 *   行动窗口，而窗口那四条判据是**登记过的「粗筛故意窄于引擎」a–d**（见 `legal.ts` 的契约表与
 *   上面那四条取证用例），逐条等式在这里本来就不成立；`PLAY_CARD` 的越界 target 同属 G-a 取证行。
 *   山议面与认证面既不读 `phase` 也不读 `duel`，等式可以逐条成立 ⇒ 正是 C 要的第三层失败面。
 */
function gateShapes(s: State, seat: number): Action[] {
  const out: Action[] = [];
  for (const target of s.players.map((p) => p.seat)) {
    out.push({ type: 'VOTE', actor: seat, target });
    out.push({ type: 'CERTIFY_SIGN', actor: seat, target });
    out.push({ type: 'CERTIFY_CHALLENGE', actor: seat, target });
    out.push({ type: 'CERTIFY_ABSTAIN', actor: seat, target });
    out.push({ type: 'CERTIFY_APPEAL', actor: seat, target });
    for (const passed of [true, false]) { out.push({ type: 'CERTIFY_ANSWER', actor: seat, target, passed }); }
    for (const overturn of [true, false]) { out.push({ type: 'CERTIFY_APPEAL_VOTE', actor: seat, target, overturn }); }
  }
  return out;
}

/**
 * 门禁层**登记过**的一处「UI 比引擎严」（与 `legal.ts` 的 a–d 同族，但落在认证面）。
 *
 * 引擎 `certifyAnswer` **没有**「同一判定人不得重复判定」的守卫，去重由粗筛的 `!judged` 承担
 * （既有取证用例「§7 判定权只属于已质疑者，且判定去重由粗筛承担」钉着）。
 * ⇒「已判定过的人再判一次」= 引擎接受、UI 必须不给点，是**口径**而不是漂移；
 *   若哪天引擎补上前置，本条会红，逼着回来把等式与登记一起改掉（而不是让门禁悄悄领先引擎）。
 *
 * ⚠️ 后三个合取项就是 `certifyAnswer` 自己的前置（目标待认证 ∧ 本人质疑过 ∧ 非自己判自己）：
 *   它们把登记**限定在引擎真的会接受**的那些形状上。不满足时走等式分支（两侧同为 false），
 *   所以登记的边界不是靠猜——引擎一旦改口径，`engine === true` 那句立刻红。
 */
function registeredUiStricter(state: State, seat: number, action: Action): string | null {
  const c = state.certification;
  if (action.type === 'CERTIFY_ANSWER'
    && c.judgments[seat] !== undefined
    && c.challenged.includes(seat)
    && c.pending.includes(action.target)
    && action.target !== seat) {
    return '重复判定（引擎无守卫，UI 由粗筛 + 门禁去重）';
  }
  return null;
}

test('漂移守卫（常驻·门禁层）：候选**之外**的越界形状也要 uiAllows == probeAction（R-3 补的第三层）', () => {
  for (const seed of [7, 23]) {
    for (const s of driftScenes(seed)) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        for (const a of gateShapes(s, seat)) {
          const engine = probeAction(s, a).ok;
          const ui = uiAllows(s, seat, a);
          const registered = registeredUiStricter(s, seat, a);
          const where = `seed=${String(seed)} seat=${String(seat)} 动作=${actionKey(a)} ${sceneTag(s)}`;
          if (registered === null) {
            assert.equal(ui, engine, `门禁层漂移（${where}）：UI=${String(ui)} 引擎=${String(engine)}`);
          } else {
            assert.equal(ui, false, `登记分歧的方向变了（${where}）：${registered} ⇒ UI 应不给点`);
            assert.equal(engine, true,
              `登记分歧不再成立（${where}）：${registered} —— 引擎已改为拒绝该形状，须回来把这条并回等式并同步登记`);
          }
        }
      }
    }
  }
});

// ---- ② 面板可点性 == 引擎认证面（R-1 的 cert.ts 部分，无 DOM 表达）----

test('面板可点性 == 引擎认证面（R-1 常驻）：cert 面板每个按钮提交的形状都要与引擎认证面逐项相等', () => {
  for (const seed of [7, 23]) {
    for (const s of driftScenes(seed)) {
      for (let seat = 0; seat < s.players.length; seat += 1) {
        // 前提：本局面的候选未撞上限（撞了的话引擎侧少发的是**截断**而非规则，等式就不该成立）。
        assert.equal(getLegalActionStats(s, seat).dropped, 0, `面板比对要求未截断：seed=${String(seed)} seat=${String(seat)}`);
        const panel = certClickableActions(s, seat).map(actionKey).sort();
        const engine = getLegalActions(s, seat)
          .filter((a) => a.type.startsWith('CERTIFY'))
          .map(actionKey)
          .sort();
        assert.deepEqual(panel, engine,
          `面板可点性与引擎认证面漂移：seed=${String(seed)} seat=${String(seat)} ${sceneTag(s)}\n`
          + `  面板按钮=${JSON.stringify(panel)}\n`
          + `  引擎认证面=${JSON.stringify(engine)}`);
      }
    }
  }
});

test('行为变化 3（R-1 的后果）：待认证者资源不足时不再给出死的「申请复议（-2 资源）」按钮', () => {
  const s = starvedCertScene(7);
  // 旧的手写显隐判据在这里**为真**（本人待认证且未申请过）⇒ 本条测的正是它与 uiAllows 的分歧。
  assert.equal(s.certification.pending.includes(1) && !s.certification.appealed.includes(1), true,
    '前提自查：旧手写判据（pending ∧ 未申请）此时必须为真，否则这条没在测分歧');
  const appeal: Action = { type: 'CERTIFY_APPEAL', actor: 1, target: 1 };
  assert.equal(uiAllows(s, 1, appeal), false, '引擎 0 资源必拒 ⇒ UI 也不给点（新代码必须站 uiAllows 这边）');
  // B79 §5.1：`uiBlockNotice` 现在交出占位符形态 ⇒ 判据跟着转形式（「点名成本来源」这条
  //   要求本身一字没放宽；玩家看到的句子由 card-cost.test.ts 的 B65/A-5b 正面钉）。
  assert.match(uiBlockNotice(s, 1, appeal) ?? '', /2 \{resource\}/, '拒绝理由要点名成本来源，不能只说「不可申请」');
  // ⚠️ **B67 更新**：本条原断言「座 1 在面板上不得拿到**任何**按钮」——
  //   但 G-d 接线后**互签**成了待认证者的另一个合法入口，且**互签不花钱**（是待认证者之间的签印）
  //   ⇒ 资源不足**不该**连带禁掉互签 ⇒ 断言须改为「不得出现**要花钱**的复议按钮」。
  //   ⚠️ 面板上若还有别的免费入口（如互签），本条**不该**断言「一颗按钮都没有」——
  //   那会把「免费入口」也误判成缺陷。
  const panel = certClickableActions(s, 1).map(actionKey);
  assert.equal(panel.includes(actionKey(appeal)), false,
    '座 1 在面板上不得拿到「申请复议」按钮（旧代码会挂出一个点了就静默失败的复议按钮）');
  // ⚠️ 互签对象是**另一位待认证者**（本局面 `pending=[1,2]` ⇒ 座 1 与座 2 互签）
  assert.equal(panel.filter((k) => k === 'cert:mutual:2').length, 1,
    '座 1 与座 2 互签的按钮**应当**出现（互签不花钱 ⇒ 不受资源不足影响）');
});

// ---- ③ 拒绝不得沉默（R-2）----

test('拒绝不得沉默（R-2 常驻）：uiAllows 挡下的每条点击都要给得出点名原因来源的一句话', () => {
  // ① 不变式：候选内被拒 ⇒ 理由非空；候选内放行 ⇒ 理由必须是 null（否则「明明可点却报错」）。
  for (const s of driftScenes(7)) {
    for (let seat = 0; seat < s.players.length; seat += 1) {
      for (const a of uiCandidates(s, seat)) {
        const notice = uiBlockNotice(s, seat, a);
        if (uiAllows(s, seat, a)) {
          assert.equal(notice, null, `放行却给了拒绝理由：seat=${String(seat)} ${actionKey(a)} ${sceneTag(s)} ⇒ ${String(notice)}`);
        } else {
          assert.ok(typeof notice === 'string' && notice.trim() !== '',
            `静默拒绝（发现 B）：seat=${String(seat)} ${actionKey(a)} ${sceneTag(s)} 被拒但没有人话`);
        }
      }
    }
  }
  // ② 山议里的行动面板：行棋 / 问天 / 出牌都被拒，且理由必须点名「阶段」这一原因来源。
  const council = councilVotedActionPanelScene(7);
  const hand = council.players[1]?.hand[0];
  assert.ok(hand !== undefined, '前提自查：山议局面里座 1 必须有手牌，否则行动面板测不到出牌点击');
  const windowActions: readonly Action[] = [
    { type: 'MOVE', actor: 1, steps: 0 },
    { type: 'ROLL_WHEEL', actor: 1 },
    { type: 'PLAY_CARD', actor: 1, cardId: hand.id },
  ];
  for (const a of windowActions) {
    assert.equal(uiAllows(council, 1, a), false, `山议阶段本该拒 ${actionKey(a)}`);
    assert.match(uiBlockNotice(council, 1, a) ?? '', /山议|阶段/,
      `山议阶段拒 ${actionKey(a)} 时必须说明原因来源是阶段（R-2 的示例口径）`);
  }
  // ③ 座 0 已投过票 ⇒ VOTE 的拒因要点名「已投过票」，不能与「山议未开」共用一句糊过去。
  assert.match(uiBlockNotice(council, 0, { type: 'VOTE', actor: 0, target: 2 }) ?? '', /已投过票/);
  assert.equal(uiBlockNotice(council, 1, { type: 'VOTE', actor: 1, target: 2 }), null,
    '可点的投票不该有拒绝理由（否则面板会给个「可点却报错」的按钮）');
});

// ---- ④ 行动面入口过闸（R-1 的主场景：被动按钮 / 选目标模式入口 / 带目标提交）----

/** 取证用的「需要选目标」的牌 id 与「需要选目标」的主动被动 op。 */
const PICK_CARD_ID = 'probe_pick_target';
const PICK_ABILITY_OP = 'transfer_resource';

/** 给某座位装上「需目标的攻击牌 + 窃火者（需目标）被动」——只动 hand 与 flags.passive。 */
function withPickTools(s: State, seat: number): State {
  const card: Card = {
    id: PICK_CARD_ID, name: '取证牌（需目标）', type: 'attack', cost: 0, color: 'red', rank: 2,
    text: '取证用：必须选目标的牌', effects: [{ op: 'discard_opponent', count: 1, target: 0 }],
  };
  assert.ok(cardNeedsTarget(card), 'withPickTools 的前提：这张牌必须真的需要选目标');
  const withCard: State = { ...s, players: s.players.map((p) => (p.seat === seat ? { ...p, hand: [card, ...p.hand] } : p)) };
  const withAbility = withPassive(withCard, seat, { op: PICK_ABILITY_OP, amount: 1 });
  const avail = abilityAvailability(withAbility, seat);
  assert.equal(avail.usable, true, 'withPickTools 的前提：被动必须真的处于 usable（否则测不到 usable 与 uiAllows 的分歧）');
  assert.equal(avail.needsTarget, true, 'withPickTools 的前提：该被动需要选目标');
  assert.equal(activeAbilityId(withAbility, seat), PICK_ABILITY_OP, 'withPickTools 的前提：abilityId 取 activeAbilityId');
  assert.ok(targetCandidates(withAbility, seat).length > 0, 'withPickTools 的前提：必须有可选目标');
  return withAbility;
}

test('行动面入口同样过闸（R-1 其一/其二）：usable 与 uiAllows 分歧时以 uiAllows 为准，选目标入口与提交路径同闸', () => {
  // 分歧场景：山议阶段 ⇒ `ability.usable` 仍为真（旧的手写判据），而 uiAllows 因行动窗口关闭而拒。
  const inCouncil = withPickTools(councilVotedActionPanelScene(7), 1);
  assert.equal(abilityAvailability(inCouncil, 1).usable, true,
    '前提自查：旧判据 usable 在山议里为真 ⇒ 下面三条测的正是「旧条件 vs uiAllows」');
  assert.equal(uiAllows(inCouncil, 1, { type: 'ABILITY', actor: 1, abilityId: PICK_ABILITY_OP }), false);
  assert.equal(uiHasLegalTarget(inCouncil, 1, { type: 'ABILITY', abilityId: PICK_ABILITY_OP }), false,
    '被动按钮的显隐改由 uiAllows 决定 ⇒ 山议里既不能出现无目标形状、也不能进入选目标模式');
  assert.equal(uiHasLegalTarget(inCouncil, 1, { type: 'PLAY_CARD', cardId: PICK_CARD_ID }), false,
    '需目标牌的「选目标模式」入口必须过闸（此前只有非选目标那一支有闸）');
  assert.equal(uiAllows(inCouncil, 1, { type: 'PLAY_CARD', actor: 1, cardId: PICK_CARD_ID, target: 0 }), false,
    '提交路径必须按**带目标**的形状过闸（山议里攻击牌不得仍然能打）');
  // 对照场景：同一批形状在行动阶段必须全为真，否则上面四条在测一个不存在的东西。
  const inAction = withPickTools(mk(4, 7), 1);
  assert.equal(inAction.phase, '行动', '前提自查：对照局面必须是行动阶段');
  assert.equal(uiHasLegalTarget(inAction, 1, { type: 'ABILITY', abilityId: PICK_ABILITY_OP }), true);
  assert.equal(uiHasLegalTarget(inAction, 1, { type: 'PLAY_CARD', cardId: PICK_CARD_ID }), true);
  assert.equal(uiAllows(inAction, 1, { type: 'PLAY_CARD', actor: 1, cardId: PICK_CARD_ID, target: 0 }), true);
  assert.equal(uiAllows(inAction, 1, { type: 'ABILITY', actor: 1, abilityId: PICK_ABILITY_OP }), false,
    '需目标的被动**没有**无目标形状（按钮靠 uiHasLegalTarget 出现，提交时才带上点选的目标）');
  // 被闸挡下时同样要有人话（R-2 与 R-1 是同一条闸的两半）。
  assert.match(uiBlockNotice(inCouncil, 1, { type: 'PLAY_CARD', actor: 1, cardId: PICK_CARD_ID, target: 0 }) ?? '', /山议|阶段/);
  assert.match(uiBlockNotice(inAction, 1, { type: 'PLAY_CARD', actor: 1, cardId: PICK_CARD_ID }) ?? '', /目标/,
    '需目标的牌在没带目标时的拒因要点名「目标」');
  assert.equal(uiHasLegalTarget(inAction, 1, { type: 'PLAY_CARD', cardId: 'no_such_card' }), false,
    '手牌里没有的牌不得进入选目标模式');
});

// ---- ⑤ 源码接线：旁路一旦回流就红（纯函数对了但 UI 没消费 = 仍然错）----

/** 取锚点注释**之后**的前 `lines` 行源码；锚点是 web/main.ts 里显式写的 `// 门禁:` 标记。 */
function afterAnchor(src: string, anchor: string, lines: number): string {
  const at = src.indexOf(anchor);
  assert.ok(at >= 0,
    `源码必须保留锚点「${anchor}」——接线用例按锚点取区域，锚点丢了等于那道闸被摘掉`);
  return src.slice(at).split('\n').slice(0, lines).join('\n');
}

test('接线（R-3 常驻，B19-c）：关隘比牌的提交路径必须走同一道闸', () => {
  const mainSrc = readFileSync('web/main.ts', 'utf8');
  const area = afterAnchor(mainSrc, '// 门禁:比牌提交', 12);
  assert.match(area, /uiAllows\(/, '比牌提交必须过闸（否则玩家能在不该比时比牌）');
  assert.match(area, /uiBlockNotice\(/, '被拒时必须给出拒因（拒绝不沉默）');
});

test('接线（R-1/R-2 常驻）：web/main.ts 的五处入口与 web/ui/cert.ts 的按钮必须逐处走同一道闸', () => {
  const mainSrc = readFileSync('web/main.ts', 'utf8');
  // ① 被动按钮：**显隐条件本身**必须含门禁结果（只看 ability.usable 就是发现 A 旁路一）。
  //    ⚠️ 不能只按区域正则找 `uiAllows(`——那样常量声明还在区域内、条件被摘掉也照样绿（变异实测如此）。
  const abilityIf = /if \(ability\.usable([^\n]*)/.exec(mainSrc)?.[1];
  assert.ok(abilityIf !== undefined,
    '前提自查：web/main.ts 必须仍有以 `if (ability.usable` 起头的被动按钮条件（写法变了就来同步这条锚点）');
  assert.match(abilityIf, /abilityTargetless|abilityTargeted/,
    '被动按钮的显隐必须由 uiAllows / uiHasLegalTarget 的结果决定（发现 A 旁路一：旧写法只看 usable）');
  // ② 选目标模式入口：进入模式的条件本身必须含门禁结果（发现 A 旁路二·进）。
  const pickIf = /if \(card !== undefined && cardNeedsTarget\(card\)([\s\S]{0,200}?)\) \{/.exec(mainSrc);
  assert.ok(pickIf !== null,
    '前提自查：web/main.ts 必须仍有手牌点击的「需目标 ⇒ 进选目标模式」条件（写法变了就来同步这条锚点）');
  assert.match(pickIf[1] ?? '', /uiHasLegalTarget/,
    '需目标牌的选目标模式入口必须过闸（发现 A 旁路二·进：旧写法只看 cardNeedsTarget + targetCandidates.length）');
  // ③ 提交路径与拒绝文案（区域正则够用：这两处判据就是那一段的主体）。
  const submit = afterAnchor(mainSrc, '// 门禁:出牌提交', 14);
  assert.match(submit, /uiAllows\(/, '出牌提交（含已选定目标的形状）必须过闸（R-1 旁路二·出）');
  assert.match(submit, /uiBlockNotice\(/, '被闸挡下时要把拒绝理由写进 ui.notice，不得静默 return（R-2）');
  const abilitySubmit = afterAnchor(mainSrc, '// 门禁:被动提交', 14);
  assert.match(abilitySubmit, /uiAllows\(/, '被动的提交路径（选完目标之后）同样过闸——与出牌同法');
  assert.match(abilitySubmit, /uiBlockNotice\(/, '被动被闸挡下也要有人话（R-2）');
  const vote = afterAnchor(mainSrc, '// 门禁:山议投票', 8);
  assert.match(vote, /uiAllows\(/, '山议投票的提交路径同样过闸（R-1 的第四处旁路：面板显隐在 council.ts，提交在 main.ts）');
  assert.match(vote, /uiBlockNotice\(/, '投票被闸挡下也要有人话（R-2）');
  const appealVote = afterAnchor(mainSrc, '// 门禁:复议票', 10);
  assert.match(appealVote, /ui\.notice\s*=/, '复议票引擎拒绝时必须把 r.note 交出去，不得静默丢 r.ok/r.note（R-2）');

  const certSrc = readFileSync('web/ui/cert.ts', 'utf8');
  assert.match(certSrc, /export function certClickableActions/, '面板可点性的唯一来源必须是这张表（R-1 旁路三）');
  assert.match(certSrc, /certClickableActions\(state, seat\)/, '渲染循环必须消费这张表，而不是另写一份显隐判据');
  assert.match(certSrc, /clickable\.has\(/, '按钮只能由 clickable 表给出');
  // 面板里**每一颗**按钮都要么走 gated（过闸），要么是质疑表单的提交（其闸在打开表单的那颗按钮上）。
  const directButtons = certSrc.match(/(?<![A-Za-z])button\(/g)?.length ?? 0;
  assert.equal(directButtons, 2,
    'cert.ts 只允许两处直接 button( 调用：gated 内部一处 + 质疑表单提交一处；'
    + '新增按钮必须走 gated，否则又给 UI 留一条不过闸的旁路（发现 A）');
});

// ============================ Task 8：可见性受限文本化 + 禁止集（预研红线 3）============================
//
// 预研红线 3 / 设计 §3.5 第 4 条：**模型只能看到公开信息**。否则 AI 拥有任何人类玩家都没有的
// 信息优势，P1/P2/P3/P6 的读数全部作废（读到的不是「玩家会怎么选」，而是「开了上帝视角会怎么选」）。
//
// 这条红线在本节做成**四层**可失败钉，缺一层都会留出一条静默的失守路径：
//   ① 输出层（**封闭词表**）：文本化结果（state 描述 + 题面 + criteria 的 key 与值）里
//      每一段 token 都必须是公开白名单成员 —— 自己的牌 id/名、公开亮牌名、身份/阵营 id、
//      数字、模板词。他人手牌 id/名、牌库顺序 id/名、对峙锁定牌 id 全都不在这张表里 ⇒ 自动判红；
//      第二层再复验一次「禁止值整段等于一个 token」——两层判据不同，任何一边写坏都会红。
//   ② 结构层：`tools/laya-probe/state-text.mjs` **去注释后的源码**里根本不存在对这些字段的访问，
//      且访问**形状**也在白名单内（hand 按出现处逐处判、duel 按行判三种允许的形状、
//      state 的下标只许那几处、不许起别名/解构/括号取法）。
//      白名单必须是结构性的而不是事后过滤：事后 scrub 意味着私密信息已经在内存里被读出来过，
//      而红线 3 要防的正是这一步；且过滤器只能按字段名过滤 ⇒「先读再洗」在源码上和
//      「直接输出」是同一种形状（都得点名字段），故 ② 一并拦住这两种写法；
//   ③ 牙齿：一个**故意泄漏**的朴素实现必须被同一套匹配器抓到（分隔符版**和粘连版**都要抓），
//      否则 ① 只是在测空气；
//   ④ 公开集完整性：只要求「不含禁止字样」的话，返回空串的实现满分通过而探针什么也拿不到
//      ⇒ 白名单承诺的公开字段必须真的交出去（正向钉子）；本轮把设计 §4.5 欠的
//      棋盘/地形、签印票数、复议票数、表头手番归属一并补齐。
//
// ⚠️ 与 brief 的三处偏离（都在报告里留证，三处都是**加强**而不是放宽）：
//   · brief 用 `{ ...s, duel: { seatA: 0, seatB: 1, pickA: 'duel_secret_a', ... } }` 手拼对峙——
//     那正是 Task 3 立的禁令（认证/山议/对峙一律走引擎入口），而且**该形状引擎永远不会产出**
//     （`submitDuelCard` 在第二方锁定的一刻就 `settleDuel` 并把 `duel` 置 null），
//     更要紧的是 `duel !== null ⇒ candidatesOf` 整表清零 ⇒ brief 那句
//     `buildChoice(poisoned, 0).criteria` 恒为空对象，「题面侧不泄漏」这一半根本没在测东西。
//     现在换成 `startDuel` + `submitDuelCard` 各锁一方的**两个**真实局面，
//     pickA / pickB 两个字段各自都真的有可查的、互不相同的 id；再补一份
//     **「对峙未决 + 认证进行中」**的局面（`duelWithCertificationScene`），把对峙期的候选侧真的跑一遍；
//   · brief 用 `text.includes(leak)` 判泄漏。测试牌 id 是 `test_card_0..N`，`test_card_1` 是
//     `test_card_10` 的**前缀** ⇒ 描述座 2（手牌 10–14）时，一个完全合规的实现会因为
//     「座 0 的 id = test_card_1」被判红（假阳性）。评审先改成「整词匹配（边界字符类）」，
//     本轮修复再升级成**封闭词表**：边界字符类看不见 `你的手牌test_card_5test_card_9`
//     这种粘连形状（两头邻居都是合法字符 ⇒ 两个私密同时隐形），词表法把它切成一段未知 token
//     直接判红——牙齿用例把两份实现并排放着，谁也别想退回针子表；
//   · brief 的 `describeAction(state, action)` 两参数签名收回为**三参数必填**（评审 6）：
//     可选参数等于把「不许越权描述别人的动作」落在调用方纪律上，那等于没落；
//     现在漏传在 TS 侧编译不过、在 JS 侧落进同一条越权抛错分支。

/** 禁止集条目：`label` 说清属于哪一类私密信息，`value` 是不得出现在文本里的字样。 */
interface ForbiddenEntry {
  readonly label: string;
  readonly value: string;
}

/** 一个取证局面：状态 + 它属于哪一类流程 + 对峙里应查得到的锁定牌条数。 */
interface VisScene {
  readonly label: string;
  readonly state: State;
  /** 局面承诺的「已锁定亮牌」条数（0 / 1；两方都锁定时引擎当场结算 ⇒ 永不出现 2）。 */
  readonly duelPicks: number;
}

/**
 * **词表法**（评审 2：替换掉「针子 + 边界字符类」）。
 *
 * 判据从「禁止值有没有出现」换成「出现的每一段 token 是否都在**公开白名单**里」——封闭世界假设：
 *   · token 字符 = id 允许字符（`0-9A-Za-z_#`）**加汉字**；其余（空格、`：`、`、`、`(`、`->`、`｜`）都是分隔符；
 *   · 于是 `你的手牌test_card_5test_card_9` 这种**粘连**写法是一整段词表外 token ⇒ 必红。
 *     旧针子法对它天生失明：`test_card_5` 的右邻是 `t`（合法字符）、`test_card_9` 的左邻是 `5`，
 *     两头边界条件都不成立 ⇒ 两个私密都被判成「没出现」；而既有牙齿样本全是分隔符隔开的，所以测不到。
 *   · 副产品：`#` 与 `-` 算不算词内字符的整套推理**整体退役**（不再需要按字符类猜边界）。
 */
const TOKEN_RUN = /[0-9A-Za-z_#\u4e00-\u9fff]+/g;

/** 数字段替换用的哨兵：真实文本里不可能出现 NUL，故不会与任何 token 撞车。 */
const NUM = '\u0000';

function tokensOf(text: string): string[] {
  return text.match(TOKEN_RUN) ?? [];
}

/** 「标签+数字」粘连形状归一：`距峰12` → `距峰`+哨兵，用来对照模板骨架白名单。 */
function generalize(token: string): string {
  return token.replace(/\d+/g, NUM);
}

/**
 * **已退役**的旧匹配器（只留作对照，别再当守卫用）：整词 = 「前后都得是非 token 字符」。
 * 保留它的唯一理由是把评审 2 的漏形钉成可执行事实——粘连写法它看不见，而词表层看得见。
 */
function legacyBoundaryHit(text: string, value: string): boolean {
  if (value.length === 0) { return false; }
  const cls = '0-9A-Za-z_#';
  return new RegExp(`(?:^|[^${cls}])${escapeRegExp(value)}(?:$|[^${cls}])`).test(text);
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * **主题数据词表**（B57 · Task 15 Step 3）：从**主题包自己**派生，不手抄。
 *
 * ⚠️ 为什么必须派生（Task 8 留下的必修项）：
 *   · 被动 op 有 **8 种**（`move_forward` / `create_card` / `peek_deck` / `extra_vote` /
 *     `shield` / `transfer_resource` / `modify_judgement` / `certify_free_pass`）
 *     ⇒ 手抄的词表只列了 2 种 ⇒ 其余 6 种出现在文本里会被**误判为泄漏**；
 *   · 牌名含间隔号（「御风·远」）⇒ 分词后是几段 ⇒ 整段入表**匹配不上**。
 *
 * ⇒ 词表的数据侧从**主题自带的牌名 / 被动 op 全集**派生（按构造即公开）。
 *
 * @returns {Set<string>} 允许出现的 token
 */
function themeDataWords(): Set<string> {
  const out = new Set<string>();
  const dir = resolve(ROOT, 'themes');
  let ids: string[] = [];
  try {
    for (const themeId of readdirSync(dir, { withFileTypes: true })) {
      if (!themeId.isDirectory()) { continue; }
      const file = resolve(dir, themeId.name, 'theme.json');
      if (!existsSync(file)) { continue; }
      const theme = JSON.parse(readFileSync(file, 'utf8')) as {
        identities?: { readonly passive?: { readonly op?: string } }[];
        cards?: { readonly name?: string }[];
      };
      for (const ident of theme.identities ?? []) {
        const op = ident.passive?.op;
        if (typeof op === 'string' && op !== '') { ids.push(op); }
      }
      for (const card of theme.cards ?? []) {
        const name = card.name;
        if (typeof name === 'string' && name !== '') {
          // ⚠️ 牌名按**同一 token 规则**分段（间隔号会被切开 ⇒ 整段匹配不上）。
          for (const piece of tokensOf(name)) { out.add(piece); }
        }
      }
    }
  } catch {
    // ⚠️ 主题包不可读 ⇒ 词表为空 ⇒ 真实主题场景会误判 ⇒ 由调用方显式报告（不静默）。
    return out;
  }
  for (const op of ids) { out.add(op); }
  return out;
}

/** 仓库根（读主题包用）。 */
const ROOT = process.cwd();

/** 文本层模板里出现的**固定词**（整段出现，不含数字）。改文案必须同步这张表——有意的评审点。 */
const TEMPLATE_WORDS: readonly string[] = [
  // 题面与表头
  '现在轮到该玩家行动', '应选哪个动作', '阶段', '本手行动', '轮到你了', '不是你的手番', '无人',
  '天机', '行动', '山议', '认证', '终局',
  // 手牌与棋盘
  '你的手牌', '无', '红', '黑', '棋盘', '格', '峰顶', '第', '你在', '距峰顶', '地形', '山道起点',
  // 座位画像的标签（值是公开 id，逐个进数据词表）
  '身份', '阵营', '持印记', '待认证', '已出局',
  // 流程面
  '公开亮牌', '已签印', '已质疑', '签印进度', '已有', '门槛', '还差',
  '复议中', '复议票', '第三方', '人', '已投', '未投', '推翻', '维持',
  '山议进行中', '已投票座位',
  // 对峙（评审 4：只报公开座位与规则本身，绝不报谁锁没锁）
  '对峙进行中', 'vs', '双方各需锁定', '张暗牌', '揭晓前互不可见',
  // ⚠️ **B68 补记**：对峙选牌的公开语义（「**锁定自己手牌里**的一张」）
  //   ⇒ 是**自己**的牌名（公开：自己的手牌本就是公开集）⇒ 不泄露对方任何信息。
  '对峙锁定亮牌',
  // 候选 key 的字面段（`actionKey` 的文法，设计 §4.4）
  'move', 'ask', 'pass', 'play', 'ability', 'vote', 'gate', 'cert',
  'sign', 'challenge', 'abstain', 'appeal', 'appealvote', 'answer', 'overturn', 'uphold', 'fail',
  // ⚠️ **B67/B68 补记**：新动作的 key 字面段与语义模板词
  //   （`cert:mutual:<座>` ⇒ 'mutual'；`duel:card:<牌id>` ⇒ 'duel' + 'card'）。
  'mutual', 'duel', 'card',
  // ⚠️ B75：`equip:<牌id>` 与单段 `council_veto` —— 新增的 key 头段必须同步进词表，
  //   否则封闭世界判据会把「新动作已正确公开」误判成泄漏（这条红过一次，就是 B75 的 equip）。
  'equip', 'council_veto',
  // 语义模板里的固定词
  '行棋', '掷骰前进', '问天', '掷指令骰', '结束手番', '过隘', '以试炼牌闯关', '入口待', 'B19', '出',
  '发动被动', '山议投座', '给座', '签印', '质疑座', '对座', '弃权', '自己申请复议', '资源',
  // ⚠️ B75 新增候选文案（`describeAction` 的 EQUIP_CARD / COUNCIL_VETO 两支）⇒ 必须同步进词表，
  //   否则「封闭世界」判据会把**合规实现**误判为泄漏（词表白名单是硬约束，不是约定）。
  '装备', '否决本次放逐',
  '复议票', '判定座', '通过', '不通过',
  // ⚠️ **B57 补记**：`describeAction` 补上了 B18 的关隘/裂隙通道分支
  //   （此前缺这两个类型 ⇒ `buildChoice` 遇到它们直接抛错 ⇒ 探针在 8 人局崩）。
  //   ⇒ 新文案必须同步进这张表，否则泄漏守卫会判红。
  '走试炼通道', '付费通过', '放置封路印', '直接通过',
  // 已知的身份被动 id（测试面出现的两个；新增被动会红，按提示补表即可）
  'transfer_resource', 'peek_deck',
  // 地形 kind：`TileKind` 是主题契约里的**闭合枚举**（engine/types/theme.ts:168）⇒ 可以逐字列全
  'plain', 'boon', 'hazard', 'rift', 'junction', 'peak',
  // B70：对峙题面补颜色/点数/规则后引入的公开措辞（逐条实算得出，不得整类放行）
  '对峙亮牌', '对峙规则', '红牌胜黑牌', '同色则点数大者胜', '同点平局各弃一张',
  '亮牌不回手牌', '只能从下列自己的手牌里选一张锁定', '选哪张',
];

/** 「标签 + 数字」粘连的模板骨架（数字已换成哨兵）。 */
const TEMPLATE_SKELETONS: readonly string[] = [
  `第${NUM}轮`, `第${NUM}手`, `座${NUM}`, `位${NUM}`, `距峰${NUM}`, `血${NUM}`, `资源${NUM}`,
  `持牌${NUM}`, `装备${NUM}`, `席${NUM}`, `费${NUM}`,
  // 动作语义里「座位号夹在中文字中间」的 shipped 措辞（评审 6 只要求改签名，没要求改文案 ⇒
  //   文案保持原样，词表把这些粘连形状逐条列出来；新增候选文案必须同步补这里）
  `给座${NUM}签印`, `质疑座${NUM}`, `对座${NUM}弃权`, `山议投座${NUM}`,
  `座${NUM}推翻`, `座${NUM}维持`, `判定座${NUM}通过`, `判定座${NUM}不通过`,
  // B70：对峙描述与规则里的「中文夹数字」形状
  `点数${NUM}`, `败者退${NUM}格并抽${NUM}张`,
];

/** 一个座位视角下的允许词表：静态模板 + 该视角下**确实公开**的数据。 */
interface Vocabulary {
  readonly exact: ReadonlySet<string>;
  readonly skeletons: ReadonlySet<string>;
}

function vocabularyFor(state: State, seat: number): Vocabulary {
  const exact = new Set<string>(TEMPLATE_WORDS);
  // ⚠️ B57：并入**主题派生**的数据词表（被动 op 全集 + 牌名分段）。
  for (const w of themeDataWords()) { exact.add(w); }
  // ⚠️ **B57（Task 15 Step 3）：牌名必须按**同一 token 规则**分段入表**。
  //   真实主题的牌名带间隔号（如「御风·远」）⇒ `TOKEN_RUN` 会把它切成「御风」+「远」两段
  //   ⇒ 只把整段名放进词表 ⇒ 分词后的 token **匹配不上** ⇒ 合规实现被误判为泄漏。
  for (const c of state.players[seat]?.hand ?? []) {
    for (const piece of tokensOf(c.name)) { exact.add(piece); }
  }
  for (const x of state.publicCards) {
    for (const piece of tokensOf(x.name)) { exact.add(piece); }
  }
  for (const p of state.players) {
    // 身份/阵营 id 全场公开（§4.1 明牌竞速）
    exact.add(p.identityId);
    exact.add(p.factionId);
  }
  for (const x of state.publicCards) {
    exact.add(x.name); // 已揭晓的亮牌：名/色/点公开（§3.3），文本层不写 cardId
  }
  // ⚠️ 只有**决策座位自己**的手牌内容与 id 进词表（设计 §4.5：自己手牌对本人公开）。
  for (const c of state.players[seat]?.hand ?? []) {
    exact.add(c.id);
    exact.add(c.name);
  }
  return { exact, skeletons: new Set(TEMPLATE_SKELETONS) };
}

/**
 * 词表外的 token（=违规）。三层放行判据，任何一层命中即公开：
 *   ① 逐字在词表里；② 纯数字（全场计数都是公开的）；③ 数字归一后是模板骨架。
 * 反过来：**任何新增字段/新文案/新数据面都必须先出现在词表里**，否则这里就是红——
 * 这正是「白名单是硬约束而不是约定」的可执行形式。
 */
function vocabularyViolations(text: string, vocab: Vocabulary): string[] {
  const bad: string[] = [];
  for (const run of tokensOf(text)) {
    if (vocab.exact.has(run)) { continue; }
    if (/^\d+$/.test(run)) { continue; }
    if (vocab.skeletons.has(generalize(run))) { continue; }
    bad.push(run);
  }
  return bad;
}

/** 文本化器交出去的全部文本：state 描述 + 题面指令 + criteria 的 key 与值（key 也扫，别只扫值）。 */
function scannedText(state: State, seat: number): string {
  const choice = buildChoice(state, seat);
  return [describeState(state, seat), choice.instructions,
    ...Object.keys(choice.criteria), ...Object.values(choice.criteria)].join('\n');
}

/**
 * 某个座位视角下的禁止集全集。
 *
 * ⚠️ 只滤掉「描述者自己的手牌 id/名」这一类——那是白名单（设计 §4.5：自己手牌对本人公开），
 *   对峙参与者看自己锁定的牌同理。其余一律不得出现。
 */
function forbiddenEntries(state: State, seat: number): ForbiddenEntry[] {
  const own = new Set<string>();
  for (const c of state.players[seat]?.hand ?? []) {
    own.add(c.id);
    own.add(c.name);
  }
  const out: ForbiddenEntry[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string): void => {
    if (value.length === 0 || own.has(value) || seen.has(`${label}\u0000${value}`)) { return; }
    seen.add(`${label}\u0000${value}`);
    out.push({ label, value });
  };
  // ⚠️ 对峙锁定牌**先入列**：它同时也在参与者的手牌里（锁定不等于移出手牌，结算才移），
  //   谁先入列决定失败消息点名哪一类私密——先说「这是对峙的暗牌」比「这是他人手牌」更可诊断。
  const d = state.duel;
  if (d !== null) {
    for (const pick of [d.pickA, d.pickB]) {
      if (pick !== undefined) { push('对峙锁定牌', pick); }
    }
  }
  for (const p of state.players) {
    if (p.seat === seat) { continue; }
    for (const c of p.hand) {
      push('他人手牌 id', c.id);
      push('他人手牌名', c.name);
    }
  }
  for (const c of state.decks.deck) {
    push('牌库顺序 id', c.id);
    push('牌库顺序名', c.name);
  }
  return out;
}

/**
 * **故意泄漏**的对照实现：把禁止集字段原样拼进文本。
 *
 * 它不是被测代码，只用来证明 ① 的匹配器与样本有牙——若这一份也「不含禁止字样」，
 * 说明匹配器写坏了（例如整词边界把真实泄漏判成不匹配），① 就成了恒真。
 */
function naiveLeakyText(state: State): string {
  const hands = state.players.flatMap((p) => p.hand.map((c) => `${c.id}/${c.name}`));
  const deck = state.decks.deck.map((c) => `${c.id}/${c.name}`);
  return [...hands, ...deck, state.duel?.pickA ?? '', state.duel?.pickB ?? '']
    .filter((x) => x.length > 0).join(' | ');
}

/**
 * 去掉注释后的源码——结构守卫只判**代码**，注释里点名禁止集字段是本仓库的写法（要说清防什么）。
 *
 * ⚠️ **保守剥**（评审 7）：旧写法 `line.replace(/\/\/.*$/, '')` 会把字符串字面量里的 `//` 当成注释起点，
 *   于是 `const s = "// 说明"; lines.push(state.duel.pickA)` 这一行被从 `//` 起**整段吃掉**——
 *   守卫看到的是一行被抹平的代码，真违规反而变绿。**假绿比假红危险得多**，所以这里采取
 *   「判不准就保留整行」的最保守形式：**只剥整行都是注释的行**（`//` / `/*` / `*` 起头），
 *   行尾注释一律不剥（不写词法分析器就无法证明那个 `//` 不在字符串里）。
 *   后果是可控的假红：把「点名禁止集字段」的注释单独成行写即可；本仓库既有风格本来就是这样。
 *   （行首是 `*` 的行只可能是块注释的续行——乘法续行写成这样属于本仓库不存在的风格。）
 */
function stripJsComments(src: string): string {
  return src.split('\n').map((line) => {
    const head = line.trimStart();
    // 整行//注释：终点唯一（行尾），可以剥。
    if (head.startsWith('//')) { return ''; }
    // 块注释续行/收尾：只可能以 `*` 开头（本仓库不存在「行首 `*` 是乘法续行」那种写法）。
    if (head.startsWith('*')) { return ''; }
    if (head.startsWith('/*')) {
      // 只有「整行就是一段完整块注释」才敢剥：中间还有 `*/` 的话其后就是真代码，
      // 判不准 ⇒ 保留整行（宁可假红）。
      const ends = head.endsWith('*/');
      const uniqueClose = !head.slice(2, head.length - 2).includes('*/');
      return ends && uniqueClose ? '' : line;
    }
    // 其余一切形状（含行尾注释、字符串/模板里的 `//`）：原样保留。
    return line;
  }).join('\n');
}

/**
 * 把 `['foo']` / `["foo"]` / `` [`foo`] `` 归一成 `.foo`（评审 1）。
 *
 * 括号写法与点写法是同一件事的两种拼法：不先归一，`state['players'][1]['hand']` 就能绕过
 * 所有按 `\.hand` / `state\.players[` 写的正则——**归一之后每条正则只写一份**。
 */
function normalizeBracketKeys(src: string): string {
  return src.replace(/\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g, '.$1');
}

/** 可见性探针牌：id 与名都是**唯一、不会与测试牌前缀撞车**的字样，专供禁止集取证。 */
const VIS_PROBE_A: Card = {
  id: 'vis_probe_pick_a', name: '可见性探针牌甲', type: 'utility', cost: 0, color: 'red',
  rank: 10, text: '探针：对峙锁定牌（甲）', effects: [],
};
const VIS_PROBE_B: Card = {
  id: 'vis_probe_pick_b', name: '可见性探针牌乙', type: 'utility', cost: 0, color: 'red',
  rank: 4, text: '探针：对峙锁定牌（乙）', effects: [],
};

/** ⚠️ 只往座 0/1 的手牌**前面**塞探针牌（与 targetCardScene / wideHandScene 同法），不碰认证/山议/对峙字段。 */
function withProbeHands(s: State): State {
  return {
    ...s,
    players: s.players.map((p) => (p.seat === 0
      ? { ...p, hand: [VIS_PROBE_A, ...p.hand] }
      : (p.seat === 1 ? { ...p, hand: [VIS_PROBE_B, ...p.hand] } : p))),
  };
}

/** 对峙·座 0（移动方）已锁定 pickA；第二方未锁 ⇒ 对峙仍未决（引擎不会交出「两边都锁着」的状态）。 */
function duelPickedAScene(): State {
  const opened = startDuel(withProbeHands(mk(4, 7)), 0, 1);
  assert.ok(opened.duel !== null, 'duelPickedAScene：startDuel 必须真的立起未决对峙（任一方手牌为空会直接判负）');
  const r = submitDuelCard(opened, 0, VIS_PROBE_A.id);
  assert.ok(r.ok, 'duelPickedAScene：座 0 锁定亮牌必须成功：' + r.note);
  assert.equal(r.state.duel?.pickA, VIS_PROBE_A.id, '后置：局面名承诺「座 0 已锁定」⇒ pickA 必须是探针牌甲 id');
  assert.equal(r.state.duel?.pickB, undefined, '后置：只锁了一方 ⇒ pickB 仍空、对峙仍未决');
  return r.state;
}

/** 对峙·座 1（对手）已锁定 pickB。与 pickA 场景合起来覆盖 DuelState 的两个私密字段。 */
function duelPickedBScene(): State {
  const opened = startDuel(withProbeHands(mk(4, 7)), 0, 1);
  assert.ok(opened.duel !== null, 'duelPickedBScene：startDuel 必须真的立起未决对峙');
  const r = submitDuelCard(opened, 1, VIS_PROBE_B.id);
  assert.ok(r.ok, 'duelPickedBScene：座 1 锁定亮牌必须成功：' + r.note);
  assert.equal(r.state.duel?.pickB, VIS_PROBE_B.id, '后置：局面名承诺「座 1 已锁定」⇒ pickB 必须是探针牌乙 id');
  assert.equal(r.state.duel?.pickA, undefined, '后置：移动方尚未锁定 ⇒ pickA 仍空');
  return r.state;
}

/** 双方都锁定 ⇒ 引擎当场结算：`duel` 归 null、两张亮牌进 `publicCards`（此刻它们**才是**公开信息）。 */
function duelRevealedScene(): State {
  const picked = duelPickedAScene();
  const r = submitDuelCard(picked, 1, VIS_PROBE_B.id);
  assert.ok(r.ok, 'duelRevealedScene：第二方锁定必须成功：' + r.note);
  assert.equal(r.state.duel, null, 'duelRevealedScene：后置——两方都锁定 ⇒ 引擎立即结算，duel 必须归 null');
  assert.equal(r.state.publicCards.length, 2,
    'duelRevealedScene：后置——非平局的两张亮牌必须**公开留场**（这正是文本层可以写它们的前提）');
  return r.state;
}

/** 对峙刚立起、**双方都还没锁**（与「一方已锁」配对：文本层不许把锁定进度写出来）。 */
function duelOpenScene(): State {
  const opened = startDuel(withProbeHands(mk(4, 7)), 0, 1);
  assert.ok(opened.duel !== null, 'duelOpenScene：startDuel 必须真的立起未决对峙');
  assert.equal(opened.duel.pickA, undefined, 'duelOpenScene：后置——双方都未锁定');
  assert.equal(opened.duel.pickB, undefined, 'duelOpenScene：后置——双方都未锁定');
  return opened;
}

/**
 * 评审 4b：对峙未决 **且认证正在进行** 的局面。
 *
 * 为什么必须有这一份：`legal.ts:56` 的 `state.duel !== null` 把**行动窗口整体关掉**，
 * 而 `mk` 系对峙场景里 `certification.pending === []`、`council.resolved === true` ⇒
 * 三面全空 ⇒ 每个座位的 `buildChoice` 都交出 `criteria: {}`，「对峙期候选侧」这道面
 * 从来没被执行过一次（泄漏测试在题面侧因此也只是在测空气）。
 * 认证候选不看行动窗口（`certificationCandidates` 只查 pending / isCertifier），
 * 于是这个局面对峙期照样有候选 ⇒ 文本层与预算/撞车钉子在对峙期真的被走一遍。
 */
function duelWithCertificationScene(): State {
  const pending = withProbeHands(pendingScene(4, 7));
  const opened = startDuel(pending, 1, 2);
  assert.ok(opened.duel !== null, 'duelWithCertificationScene：startDuel 必须真的立起未决对峙');
  const r = submitDuelCard(opened, 1, VIS_PROBE_B.id);
  assert.ok(r.ok, 'duelWithCertificationScene：座 1 锁定亮牌必须成功：' + r.note);
  assert.ok(r.state.duel !== null, 'duelWithCertificationScene：只锁一方 ⇒ 对峙仍未决');
  assert.ok(r.state.certification.pending.includes(0),
    'duelWithCertificationScene：后置——认证池必须仍在（否则候选侧依旧是空的，本场景就白造了）');
  assert.ok(getLegalActions(r.state, 2).length > 0,
    'duelWithCertificationScene：前置——对峙期认证人必须有候选，否则「对峙期候选侧」还是没被测到');
  return r.state;
}

/** 取证局面集（全部引擎入口构造；只探针牌进手牌，认证/山议/对峙一律真实调用）。 */
function visScenes(): VisScene[] {
  const passive = withPassive(mk(4, 7), 0, { op: 'transfer_resource', amount: 1 });
  const voted = castVote(councilScene(4, 7), 0, 1);
  assert.ok(voted.ok, 'visScenes：山议投票必须落账，否则「已投票座位」那一类公开信息测不到：' + noteOf(voted.note));
  return [
    // brief 的三个预算样本（保留原位，别让「扩了局面」把原口径挤掉）
    { label: 'mk(4,7)', state: mk(4, 7), duelPicks: 0 },
    { label: 'mk(8,11)', state: mk(8, 11), duelPicks: 0 },
    { label: 'councilScene(8,11)', state: councilScene(8, 11), duelPicks: 0 },
    { label: 'appealedScene(8,11)', state: appealedScene(8, 11), duelPicks: 0 },
    // 其余流程面：认证三面 / 判定 / 复议票 / 山议已投票 / 被动面
    { label: 'pendingScene(4,7)', state: pendingScene(4, 7), duelPicks: 0 },
    { label: 'challengedScene(5,7)', state: challengedScene(5, 7), duelPicks: 0 },
    { label: 'councilScene(4,7)·已投票', state: voted.state, duelPicks: 0 },
    { label: '被动面(窃火者)', state: passive, duelPicks: 0 },
    // 对峙：两个「各锁一方」的真实局面 + 一个「已揭晓」的公开局面
    { label: '对峙·pickA 已锁', state: duelPickedAScene(), duelPicks: 1 },
    { label: '对峙·pickB 已锁', state: duelPickedBScene(), duelPicks: 1 },
    { label: '对峙·已揭晓（公开留场）', state: duelRevealedScene(), duelPicks: 0 },
    // 评审 4b：对峙未决 + 认证进行中 ⇒ 对峙期也有候选，题面侧不再恒空
    { label: '对峙 + 认证进行中', state: duelWithCertificationScene(), duelPicks: 1 },
  ];
}

test('可见性红线（B57 · Task 15 Step 3）：**真实主题**场景不误判（间隔号牌名 + 8 种被动 op）', () => {
  // ⚠️ **背景**：词表原先只按 ASCII 测试主题校准 ⇒ 真实主题的
  //   · 牌名带间隔号（「御风·远」⇒ 分词成两段 ⇒ 整段入表匹配不上）；
  //   · 被动 op 有 8 种（词表只列 2 种 ⇒ 其余 6 种被误判为泄漏）；
  //   ⇒ 合规实现被误判 ⇒ 本条把真实主题钉成**常驻断言**。
  const theme = JSON.parse(readFileSync(resolve(ROOT, 'themes/xianxia2026/theme.json'), 'utf8')) as {
    cards?: { readonly id: string; readonly name: string }[];
    identities?: { readonly passive?: { readonly op?: string } }[];
  };
  // 前提自查：真实主题确实带间隔号牌名、且被动 op 超过 2 种（否则本条会假绿）
  const dotted = (theme.cards ?? []).filter((c) => c.name.includes('·'));
  assert.ok(dotted.length > 0, '前提：真实主题必须有含间隔号的牌名');
  const ops = new Set((theme.identities ?? []).map((i) => i.passive?.op ?? ''));
  assert.ok(ops.size > 2, `前提：真实主题的被动 op 应多于 2 种，实际 ${String(ops.size)}`);
  // 词表派生后，这些牌名的**分段**与全部 op 都必须是合法 token
  const vocab = vocabularyFor(mk(4, 7), 0);
  for (const c of dotted) {
    for (const piece of tokensOf(c.name)) {
      assert.ok(vocab.exact.has(piece), `含间隔号牌名「${c.name}」的分段「${piece}」必须在词表内`);
    }
  }
  for (const op of ops) {
    assert.ok(op !== '' && vocab.exact.has(op), `被动 op「${op}」必须在词表内（派生自主题）`);
  }
});
test('可见性红线（常驻·输出层）：文本化结果只允许出现词表内的 token（封闭世界）', () => {
  for (const scene of visScenes()) {
    // 对峙锁定牌先按**字段→归属座位**独立核一遍（不借 forbiddenEntries 的过滤逻辑，免得自证）
    const duel = scene.state.duel;
    assert.equal([duel?.pickA, duel?.pickB].filter((x) => x !== undefined).length, scene.duelPicks,
      `${scene.label}：局面承诺的「已锁定亮牌」条数与实际不符 ⇒ 对峙样本是空的`);
    for (let seat = 0; seat < scene.state.players.length; seat += 1) {
      const entries = forbiddenEntries(scene.state, seat);
      // 样本非空（brief 那句「否则测试失去意义」扩成逐类）：每一类私密都必须真的有一条可查的样本。
      for (const kind of ['他人手牌 id', '他人手牌名', '牌库顺序 id', '牌库顺序名']) {
        assert.ok(entries.some((e) => e.label === kind),
          `${scene.label}@座${String(seat)}：样本里缺「${kind}」⇒ 这一类断言没有可失败的形式`);
      }
      // 前提自查（词表法的唯一漏洞）：纯数字走「公开计数」这条放行通道，
      // 所以禁止值**不许**是纯数字——今天四类样本全是 `test_card_N` / 中文名，成立；
      // 哪天牌库改用数字 id，本条会先红，提示给数字 id 单开一张精确词表而不是放行。
      for (const entry of entries) {
        assert.equal(/^\d+$/.test(entry.value), false,
          `${scene.label}@座${String(seat)}：禁止值「${entry.value}」是纯数字 ⇒ 会被「公开计数」通道放过，词表法须补精确匹配`);
      }
      // 前提自查（词表法唯一的宽松处之二）：数字归一后**恰好落进模板骨架**的禁止值必须没有
      // （否则 `费123` 这类「长得像标签」的牌名会被骨架通道放过）。今天没有，将来出现就得收紧骨架。
      const vocab = vocabularyFor(scene.state, seat);
      for (const entry of entries) {
        assert.equal(vocab.skeletons.has(generalize(entry.value)), false,
          `${scene.label}@座${String(seat)}：禁止值「${entry.value}」数字归一后等于模板骨架 ⇒ 会被骨架通道放过，词表须收紧`);
      }
      const text = scannedText(scene.state, seat);
      // 第一层（主判据，封闭世界）：每一段 token 都必须是词表成员。
      const bad = vocabularyViolations(text, vocab);
      assert.equal(bad.length, 0,
        `词表外的 token（要么写了不该写的私密，要么新增了公开字段却没进白名单）：`
        + `${Array.from(new Set(bad)).join(' | ')}\n（${scene.label}@座${String(seat)}）\n---\n${text}`);
      // 第二层（针子的等价强化）：禁止值**整段等于一个 token** 时必红。
      // ⚠️ 这里不再用「边界字符类」判整词（评审 2 的漏形就出在字符类上），改成与 token 逐字相等——
      //   两层判据不同（一层看「这串是不是白名单成员」，一层看「这串是不是禁止值」），互为交叉验证。
      const runs = tokensOf(text);
      for (const entry of entries) {
        assert.equal(runs.includes(entry.value), false,
          `泄漏（${scene.label}@座${String(seat)}）：${entry.label} = ${entry.value}\n---\n${text}`);
      }
    }
  }
  // 两个私密字段各自都要被**第三者**视角查得到（查不到就等于没测）：
  // pickA 属于座 0、pickB 属于座 1，参与者本人那份落在白名单（他知道自己锁了什么）里。
  for (const [scene, owner] of [[duelPickedAScene(), 0], [duelPickedBScene(), 1]] as const) {
    const duel = scene.duel;
    assert.ok(duel !== null, '前提自查：对峙场景必须仍未决');
    const pick = owner === 0 ? duel.pickA : duel.pickB;
    assert.ok(typeof pick === 'string' && pick.length > 0, `前提自查：座${String(owner)} 的锁定牌 id 必须可查`);
    for (let seat = 0; seat < scene.players.length; seat += 1) {
      if (seat === owner) { continue; }
      assert.ok(forbiddenEntries(scene, seat).some((e) => e.label === '对峙锁定牌' && e.value === pick),
        `对峙锁定牌样本缺失：座${String(seat)} 视角下 ${pick} 必须算私密`);
      assert.equal(tokensOf(scannedText(scene, seat)).includes(pick), false,
        `泄漏：座${String(seat)} 的题面里出现了对峙锁定牌 ${pick}`);
    }
  }
});

test('可见性红线（常驻·牙齿）：匹配器必须抓得住「把禁止字段直接写进文本」的朴素实现（含粘连形状）', () => {
  // 没有这一条，上面那条可能只是在测空气：匹配器写坏 / 样本取空 / 扫描文本漏了一段，都表现为「全绿」。
  const scenes: readonly (readonly [string, State])[] = [
    ['mk(4,7)', mk(4, 7)],
    ['对峙·pickA 已锁', duelPickedAScene()],
    ['对峙·pickB 已锁', duelPickedBScene()],
  ];
  for (const [label, s] of scenes) {
    for (let seat = 0; seat < s.players.length; seat += 1) {
      const leaky = naiveLeakyText(s);
      const runs = tokensOf(leaky);
      for (const entry of forbiddenEntries(s, seat)) {
        assert.equal(runs.includes(entry.value), true,
          `对照实现都没漏出来 ⇒ 匹配器失效（${label}@座${String(seat)}：${entry.label}=${entry.value}）`);
      }
      // 词表层同样要在这份对照文本上判红（两层都得有牙，否则换层就换瞎）
      assert.ok(vocabularyViolations(leaky, vocabularyFor(s, seat)).length > 0,
        `词表层对对照实现无反应 ⇒ 白名单被写宽了（${label}@座${String(seat)}）`);
    }
  }
  // 对峙两个字段各有一条**互不相同**的真实 id 被抓住（brief 靠两个手拼常量做这件事，这里换成引擎产出的牌）
  const pickA = duelPickedAScene().duel?.pickA;
  const pickB = duelPickedBScene().duel?.pickB;
  assert.ok(typeof pickA === 'string' && pickA.length > 0, '前提自查：pickA 场景必须真的锁了一张可查的牌');
  assert.ok(typeof pickB === 'string' && pickB.length > 0, '前提自查：pickB 场景必须真的锁了一张可查的牌');
  assert.notEqual(pickA, pickB, '两个 pick 的 id 必须互不相同，否则「两字段都不泄漏」只是一次检查');
  assert.equal(tokensOf(naiveLeakyText(duelPickedAScene())).includes(pickA), true, 'pickA 必须能被对照实现抓出来');
  assert.equal(tokensOf(naiveLeakyText(duelPickedBScene())).includes(pickB), true, 'pickB 必须能被对照实现抓出来');

  // ---- 评审 2 的漏形：粘连（glued）泄漏，留成常驻牙齿，防止哪天又退回针子表 ----
  const base = mk(4, 7);
  const others = forbiddenEntries(base, 0).filter((e) => e.label === '他人手牌 id').map((e) => e.value);
  assert.ok(others.length >= 2, '前提自查：粘连样本至少要有两条他人 id，实际 ' + String(others.length));
  // ① 全粘连：`test_card_5test_card_9`——两头边界都是合法字符 ⇒ **旧针子法两个都看不见**
  const glued = others.join('');
  assert.equal(legacyBoundaryHit(glued, others[0] ?? ''), false,
    '留档：旧「边界字符类」匹配器对粘连形状天生失明（这正是评审 2 要求换词表法的事实依据）');
  assert.equal(legacyBoundaryHit(glued, others[others.length - 1] ?? ''), false, '同上：末段也看不见');
  // ② 粘在模板词后面（最像「合规输出」的形状）：`你的手牌test_card_5test_card_9`
  const gluedInTemplate = `你的手牌${glued}`;
  assert.equal(legacyBoundaryHit(gluedInTemplate, others[0] ?? ''), false, '留档：旧匹配器同样看不见');
  for (const text of [glued, gluedInTemplate]) {
    assert.ok(vocabularyViolations(text, vocabularyFor(base, 0)).length > 0,
      `词表层必须抓住粘连泄漏：${text}`);
    assert.equal(tokensOf(text).some((t) => others.includes(t)), false,
      '粘连后整段不再等于任何单条 id ⇒ 逐字 needle 相等判不出，**只有封闭词表能判**（这就是主判据换掉的理由）');
  }
  // 前缀撞车这一类假阳性也要有正向钉子（旧匹配器的另一颗牙，词表法下同一形状自动成立）
  assert.equal(tokensOf('play:test_card_10').includes('test_card_1'), false, '整词边界：前缀不算出现');
  assert.equal(tokensOf('play:test_card_1->2').includes('test_card_1'), true, '整词边界：真出现必须抓到');
});

test('可见性红线（常驻·结构层）：state-text.mjs 源码不得出现禁止集的字段访问（白名单靠不写，不靠过滤）', () => {
  const src = stripJsComments(readFileSync('tools/laya-probe/state-text.mjs', 'utf8'));
  const code = normalizeBracketKeys(src);
  const forbidden: readonly (readonly [string, RegExp])[] = [
    ['duel.pickA（对峙锁定牌·移动方）', /\.pickA\b/],
    ['duel.pickB（对峙锁定牌·对手）', /\.pickB\b/],
    ['state.decks / decks.deck（牌库顺序）', /\bdecks?\b/],
    ['字面座位下标取玩家（他人手牌的入口）', /\bstate\.players\[\s*[-\d]/],
    ['给 state 起别名（别名会让按标识符扫的守卫整体失明）', /(?:const|let|var)\s+\w+\s*=\s*state\s*[;]/],
    ['从 state 解构字段（同上，且字段名不再出现在点式访问里）', /(?:const|let|var)\s*\{[^}]*\}\s*=\s*state\s*[;.]/],
    ['从 state 的属性解构（`const { deck } = state.decks` 同族）', /(?:const|let|var)\s*\{[^}]*\}\s*=\s*state\.\w+/],
  ];
  for (const [label, re] of forbidden) {
    assert.equal(re.test(code), false, `禁止集字段访问出现在代码里：${label}（事后过滤也算——过滤器同样要点名字段）`);
  }
  // 括号写法不许成为第二条通道：归一化之后仍然单独钉一次「源码里不许有 `obj['key']`」。
  assert.equal(/\[\s*['"`][A-Za-z_]/.test(src), false,
    '不得用 obj[\'key\'] 形式访问字段：点式访问才在白名单检查的控制范围内（要写就改回点式，让守卫看得见）');

  // ———— duel：从「整词禁现」改成**行级形状白名单**（评审 4 要求把对峙写成公开事实）————
  // 旧口径是 `\bduel\b` 一律不许出现，那等于把**公开**的 seatA/seatB 也一起禁了；
  // 新口径更紧也更准：提到 duel 的每一行都必须是那三种形状之一，其余（起别名、解构、比 pick）全红，
  // 而 `.pickA` / `.pickB` 由上面 forbidden 表在全源码范围内独立钉死（两道判据不互相让步）。
  const duelLines = code.split('\n').filter((line) => /\bduel\b/.test(line));
  const duelAllowed: readonly RegExp[] = [
    /state\.duel !== null/,   // 只判「有没有对峙」——行动窗口口径
    /state\.duel\.seatA/,     // 公开：移动方座位
    /state\.duel\.seatB/,     // 公开：对手座位
  ];
  for (const line of duelLines) {
    assert.ok(duelAllowed.some((re) => re.test(line)), `非白名单的 duel 访问：${line.trim()}`);
  }

  // ———— hand：从**行级**白名单升到**出现级**（评审 1）————
  // 行级白名单的漏洞：一行里只要出现过一次合规形状（`.hand.length`），同一行的
  // `p.hand.map((x) => x.id)` 就一起被放行（变异 M8 实证：泄漏 id 而两层守卫全绿）。
  const handLines = code.split('\n').filter((line) => /\bhand\b/.test(line));
  assert.ok(handLines.length >= 3,
    `前提自查：文本化器必须真的访问过 hand（公开集里有「持牌数」与「自己手牌」两处），实际 ${String(handLines.length)} 行 ⇒ 0 行说明实现被整体摘掉了`);
  const allowed: readonly RegExp[] = [/\.hand\.length/g, /\bme\.hand\b/g, /actorPlayer\.hand\.find/g];
  let handFree = code;
  for (const re of allowed) {
    handFree = handFree.replace(re, ' ');
  }
  const residue = handFree.split('\n').filter((line) => /\bhand\b/.test(line));
  assert.equal(residue.length, 0,
    '非白名单的 hand 访问（解构 `const { hand } = p`、括号写法、`.hand.map` 取 id 全在内）：\n'
    + residue.map((x) => '  ' + x.trim()).join('\n'));

  // ———— state 的下标形式白名单（评审 1 的后半：括号取法）————
  const indexExpressions = code.match(/\b[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\?\.)?\[[^\]]*\]/g) ?? [];
  assert.ok(indexExpressions.length >= 4,
    `前提自查：文本化器必须存在若干下标访问供本层检查，实际只抽到 ${String(indexExpressions.length)} 处 ⇒ 抽取正则失效，本层已空转`);
  const indexAllowed: readonly RegExp[] = [
    /^state\.players\[seat\]$/,                 // 决策座位自己
    /^state\.players\[action\.actor\]$/,        // 动作归属座位
    /^state\.liveSeats\[[\w.]+\]$/,             // 活人席（公开）
    /^state\.turnOrder\[state\.turnIndex\]$/,   // 本手行动座（公开，评审 5）
    /^c\.judgments\[[\w.]+\]$/,                 // 判定结果（公开）
    /^c\.appealVotes\[[\w.]+\]$/,               // 复议票（公开，评审 3）
    /^criteria\[key\]$/,                        // 题面候选表本身
  ];
  for (const exp of indexExpressions) {
    assert.ok(indexAllowed.some((re) => re.test(exp)),
      `非白名单的 state 下标形式：${exp}（他人手牌的入口正是「换个下标写法」这一步）`);
  }

  // 上面那几个被放行的变量必须**逐字**绑定到「自己」，否则放行 `me.hand` 等于放行任意手牌。
  assert.match(code, /const me = state\.players\[seat\];/, 'me 必须是**决策座位自己**（state.players[seat]）');
  assert.match(code, /const actorPlayer = state\.players\[action\.actor\];/, 'actorPlayer 必须是**动作归属座位**（state.players[action.actor]）');
  assert.match(code, /const c = state\.certification;/, 'c 必须是认证池（`c.judgments`/`c.appealVotes` 的放行全靠这条绑定）');
});

test('可见性红线（常驻·公开集完整性）：白名单字段必须真的交出去（返回空串的实现不得蒙过泄漏测试）', () => {
  const plain = mk(4, 7);
  const text = describeState(plain, 0);
  assert.ok(text.length > 0, '文本化结果不得为空——空串在「不含禁止集」上是满分，在探针上是零分');
  for (const p of plain.players) {
    for (const needle of [`座${String(p.seat)} `, `位${String(p.position)}`, `血${String(p.hp)}/${String(p.hpMax)}`,
      `资源${String(p.resource)}`, `持牌${String(p.hand.length)}`, `装备${String(p.equipment.length)}`, `席`]) {
      assert.ok(text.includes(needle), `公开画像缺字段「${needle}」（座${String(p.seat)}）：${text}`);
    }
    assert.ok(text.includes(`身份 ${p.identityId}`), `身份是公开信息（§4.1 明牌竞速），必须出现：座${String(p.seat)}`);
    assert.ok(text.includes(`阵营 ${p.factionId}`), `阵营是公开信息，必须出现：座${String(p.seat)}`);
    // 评审 3：距峰顶是 MOVE 的决策要害（峰在哪、还有几格，人类玩家看得见，模型过去拿不到）
    assert.ok(text.includes(`距峰${distanceToPeak(plain, p.seat)}`),
      `每座都要给出距峰顶格数（座${String(p.seat)}）：${text}`);
  }
  const ownFirst = plain.players[0]?.hand[0]?.name ?? '@@空样本@@';
  assert.ok(text.includes(ownFirst), `自己的手牌必须出现，否则模型连能打什么都不知道：${text}`);
  // 三类流程性公开信息各一颗正向钉子（缺一类 ⇒ 「不泄漏」可以靠删光公开字段达成）
  assert.match(describeState(pendingScene(4, 7), 1), /待认证：0/, '认证池（pending）是公开信息');
  assert.match(describeState(pendingScene(4, 7), 1), /座0[^\n]*待认证/, '待认证锁定要写在座位画像里');
  const voted = castVote(councilScene(4, 7), 0, 1);
  assert.ok(voted.ok, '前提自查：投票必须落账：' + noteOf(voted.note));
  assert.match(describeState(voted.state, 2), /山议进行中，已投票座位：0/, '山议已投票是公开信息');
  const revealed = describeState(duelRevealedScene(), 2);
  assert.match(revealed, /公开亮牌：/, '已揭晓的亮牌是公开信息（§3.3：留在场上公开，round 末清空）');
  assert.ok(revealed.includes(VIS_PROBE_A.name) && revealed.includes(VIS_PROBE_B.name),
    `公开留场的两张牌都要写出来：${revealed}`);

  // ---- 评审 3 之一：棋盘格位**与地形**（设计 §4.5 公开集，过去只给了 `位N`）----
  const board = plain.board;
  assert.ok(text.includes(`棋盘 ${String(board.length)} 格`), `棋盘长度必须给出：${text}`);
  assert.ok(text.includes(`峰顶 第 ${String(board.peakIndex)} 格`), `峰顶格位必须给出：${text}`);
  assert.ok(text.includes(`你在 第 ${String(plain.players[0]?.position ?? -1)} 格`), '决策座位所在格必须给出：' + text);
  assert.ok(text.includes('地形 山道起点'),
    `座 0 起点在第 0 格（未上山）⇒ 地形必须是「山道起点」而不是硬塞一个 kind：${text}`);
  const onBoard: State = { ...plain, players: plain.players.map((p) => (p.seat === 0 ? { ...p, position: 1 } : p)) };
  const plainTileText = describeState(onBoard, 0);
  assert.ok(plainTileText.includes('地形 plain'), `当前格地形（kind，闭合枚举）必须给出：${plainTileText}`);
  const onPeak = describeState(pendingScene(4, 7), 0);
  assert.ok(onPeak.includes('地形 peak'), `登顶者的当前格必须是 peak：${onPeak}`);
  assert.ok(onPeak.includes('距峰顶 0 格'), `登顶者的距峰顶必须是 0：${onPeak}`);

  // ---- 评审 3 之二：认证 pending 的**票数**（签印进度）——签印人必须知道差几票才过 ----
  const signed = certifySign(pendingScene(4, 7), 1, 0);
  assert.ok(signed.ok, '前提自查：签印必须落账：' + noteOf(signed.note));
  assert.equal(signed.state.certification.signatures[0], 1, '前提自查：signatures[0] 必须已经是 1');
  const need = certificationThreshold(signed.state, 0);
  const progress = describeState(signed.state, 2);
  assert.match(progress, /签印进度/, '签印进度是公开票数（§5.2），必须给出：' + progress);
  assert.ok(progress.includes('已有 1'), `已签印数必须给出：${progress}`);
  assert.ok(progress.includes(`门槛 ${String(need)}`), `门槛（§5.2 公式，公开）必须给出：${progress}`);
  assert.ok(progress.includes(`还差 ${String(Math.max(0, need - 1))}`),
    `「还差几票」是签印/质疑的决策要害，必须由公开字段算出来：${progress}`);

  // ---- 评审 3 之三：复议票数 ----
  const appealed = appealedScene(5, 7);
  const appealVote = certifyAppealVote(appealed, 2, 0, true);
  assert.ok(appealVote.ok, '前提自查：复议票必须落账：' + noteOf(appealVote.note));
  const appealText = describeState(appealVote.state, 3);
  assert.match(appealText, /复议中/, '已申请复议的座位是公开信息：' + appealText);
  assert.ok(appealText.includes('推翻 1') && appealText.includes('维持 0'), `复议票计数必须给出：${appealText}`);
  assert.ok(appealText.includes('第三方 3 人'), `独立第三方人数（§5.3.2 多数决的分母）必须给出：${appealText}`);

  // ---- 评审 5：表头要说清「本手是谁」「是不是你的回合」；空标签不许留尾巴 ----
  const turnSeat = plain.turnOrder[plain.turnIndex];
  assert.ok(text.includes(`本手行动：座${String(turnSeat)}`), `表头必须点名本手行动座：${text}`);
  assert.ok(text.includes(turnSeat === 0 ? '轮到你了' : '不是你的手番'), '表头必须说明读者是不是当前手番：' + text);
  const otherSeat = describeState(plain, (turnSeat === 0 ? 1 : 0) as number);
  assert.ok(otherSeat.includes('不是你的手番'), '非当前手番的座位必须被告知「现在不用你行动」：' + otherSeat);

  for (const scene of visScenes()) {
    for (let seat = 0; seat < scene.state.players.length; seat += 1) {
      for (const line of describeState(scene.state, seat).split('\n')) {
        assert.equal(/[：:]\s*$/.test(line), false,
          `空标签尾巴（「你的手牌：」/「已投票座位：」这类没有内容的行）：${scene.label}@座${String(seat)}：${line}`);
      }
    }
  }
  const emptyHand: State = {
    ...mk(4, 7),
    players: mk(4, 7).players.map((p) => (p.seat === 0 ? { ...p, hand: [] } : p)),
  };
  const emptyText = describeState(emptyHand, 0);
  assert.match(emptyText, /你的手牌：无/, '空手牌要写成「无」，不能留一个空的「你的手牌：」：' + emptyText);
  const noVotes = describeState(councilScene(4, 7), 0);
  assert.match(noVotes, /已投票座位：无/, '山议刚开、一张票都没有时要写成「无」：' + noVotes);
});

test('describeAction 归属守卫（常驻）：只描述 actor 自己的牌，越权座位一律抛错', () => {
  const s = mk(4, 7);
  const other = s.players[1]?.hand[0];
  assert.ok(other !== undefined, '前提自查：座 1 必须有手牌');
  const wrongSeat: Action = { type: 'PLAY_CARD', actor: 1, cardId: other.id };
  // 决策座位是 0，却把座 1 的动作递进来 ⇒ 必须抛错。
  // 这不是假设：`criteria` 的文本是模型**唯一**能看到动作语义的地方，
  // 一次 actor 写错就等于把他人私牌名印在题面上（红线 3），而事后没人能从文本反推它是越权来的。
  assert.throws(() => describeAction(s, wrongSeat, 0), /归属/, '传了决策座位 ⇒ actor 不符必须拒');
  // 评审 6：第三参数改成**必填**。过去它是可选的、不传就「按 actor 自己的视角渲染」，
  // 等于把越权拦截的责任交给调用方纪律；现在 TS 侧漏传直接编译不过，JS 侧漏传也落进同一条越权分支。
  assert.throws(() => describeAction(s, wrongSeat, undefined as unknown as number), /归属/,
    '运行时漏传 seat ⇒ 必须抛错（不再存在「按 actor 渲染」这条无人看守的通道）');
  assert.match(describeAction(s, wrongSeat, 1), new RegExp(escapeRegExp(other.name)),
    'actor === seat 时按 actor 自己的手牌渲染（座 1 看自己的牌属于白名单，设计 §4.5）');
  // 手牌里没有的牌 ⇒ 抛错，不得渲染成 `undefined`（brief 的实现会在 card 缺失时 TypeError 或拼出 'undefined'）
  assert.throws(() => describeAction(s, { type: 'PLAY_CARD', actor: 0, cardId: 'no_such_card' }, 0), /手牌/);
  assert.throws(() => describeAction(s, { type: 'MOVE', actor: 99, steps: 0 } as Action, 99), /座/, 'actor 越界也要说清楚');
  // 未知动作类型必须抛错而不是返回 undefined：brief 的 switch 没有 default，
  // 未覆盖的成员会让 `criteria` 里冒出一个值为字符串 "undefined" 的选项（模型照样能选中它）。
  assert.throws(() => describeAction(s, { type: 'NOT_A_REAL_ACTION', actor: 0 } as unknown as Action, 0), /未知动作/);
  // 13 个 Action 成员逐一都要给得出语义（覆盖钉子；与 PROBE_CASES 的「13 个成员」同一口径）
  const ownCard = s.players[0]?.hand[0];
  assert.ok(ownCard !== undefined, '前提自查：座 0 必须有手牌');
  const samples: readonly Action[] = [
    { type: 'MOVE', actor: 0, steps: 0 },
    { type: 'ROLL_WHEEL', actor: 0 },
    { type: 'PASS', actor: 0 },
    { type: 'COMPARE', actor: 0, cardId: ownCard.id, target: 1 },
    { type: 'PLAY_CARD', actor: 0, cardId: ownCard.id },
    { type: 'PLAY_CARD', actor: 0, cardId: ownCard.id, target: 1 },
    { type: 'ABILITY', actor: 0, abilityId: 'transfer_resource' },
    { type: 'ABILITY', actor: 0, abilityId: 'transfer_resource', target: 1 },
    { type: 'VOTE', actor: 0, target: 1 },
    { type: 'CERTIFY_SIGN', actor: 0, target: 1 },
    { type: 'CERTIFY_CHALLENGE', actor: 0, target: 1 },
    { type: 'CERTIFY_ABSTAIN', actor: 0, target: 1 },
    { type: 'CERTIFY_APPEAL', actor: 0, target: 0 },
    { type: 'CERTIFY_APPEAL_VOTE', actor: 0, target: 1, overturn: true },
    { type: 'CERTIFY_ANSWER', actor: 0, target: 1, passed: false },
  ];
  assert.equal(new Set(samples.map((a) => a.type)).size, 13, '样本必须覆盖 Action union 的全部 13 个成员');
  for (const a of samples) {
    const line = describeAction(s, a, 0);
    assert.ok(typeof line === 'string' && line.trim().length > 0, `${actionKey(a)}：动作语义不得为空`);
    assert.equal(line.includes('undefined'), false, `${actionKey(a)}：语义里不得冒 undefined：${line}`);
    assert.ok(line.length <= 40, `${actionKey(a)}：语义过长（${String(line.length)} 字符）：${line}`);
  }
});

test('文本化：每候选一句话，长度受预算约束（rl_agent_config.head_max_len=256）', () => {
  for (const scene of visScenes()) {
    for (let seat = 0; seat < scene.state.players.length; seat += 1) {
      const choice = buildChoice(scene.state, seat);
      const actions = getLegalActions(scene.state, seat);
      assert.equal(Object.keys(choice.criteria).length, actions.length,
        `${scene.label}@座${String(seat)}：每个合法动作都要有一条候选，且不得互相覆盖`);
      assert.ok(choice.instructions.length > 0, `${scene.label}：题面指令不得为空`);
      for (const [k, v] of Object.entries(choice.criteria)) {
        assert.ok(String(v).length <= 40, `候选 ${k} 语义过长：${v}`);
        assert.ok(String(v).trim().length > 0, `候选 ${k} 语义为空`);
        assert.equal(String(v).includes('undefined'), false, `候选 ${k} 语义里冒 undefined：${v}`);
      }
    }
  }
});

test('buildChoice：criteria 的 key 撞车必须抛错（撞车＝题面静默少一个选项）', () => {
  // 同一张牌 id 在手牌里出现两次 ⇒ `play:<id>` 两条候选编出同一个 key。
  // 引擎侧确实会交出两条合法动作（cardId 相同、都是合法出牌），所以这是**可达**形状，
  // 而 Object 赋值会让后一条无声覆盖前一条 ⇒ P1/P3 的候选计数比真实选项少，读数失真。
  const base = mk(4, 7);
  const card = base.players[0]?.hand[0];
  assert.ok(card !== undefined, '前提自查：座 0 必须有手牌');
  const dup: State = {
    ...base,
    // ⚠️ `[card, ...p.hand]` 而不是 `[card, card, ...p.hand]`：p.hand[0] **就是** card，
    //    写两遍会得到三张同 id 的牌，下面那句「恰好两条同 key 候选」的前提当场判红。
    players: base.players.map((p) => (p.seat === 0 ? { ...p, hand: [card, ...p.hand] } : p)),
  };
  assert.ok(getLegalActions(dup, 0).filter((a) => a.type === 'PLAY_CARD' && a.cardId === card.id).length === 2,
    '前提自查：重复 id 的两条候选都要被引擎接受，否则本条测不到撞车');
  assert.throws(() => buildChoice(dup, 0), /key/, '撞车必须大声失败（修的地方是 id 唯一性，不是在这里给 key 加后缀）');
  // 正常局面不得撞车（主题副本 id 带 `#dupN` 后缀 ⇒ 天然唯一；这里钉住现状）。
  for (const scene of visScenes()) {
    const keys = getLegalActions(scene.state, 0).map(actionKey);
    assert.equal(new Set(keys).size, keys.length, `${scene.label}：座 0 的候选 key 必须互不相同`);
  }
});

test('对峙期（常驻·评审 4）：题面为空时要把对峙写成公开事实，并给出可分桶的 noLegalActions 标记', () => {
  // 引擎事实（`engine/core/legal.ts` 的 `actionWindowOpen`）：`state.duel !== null` ⇒ 行动窗口整体关闭。
  // 于是 `mk` 系对峙场景里三面全空（`certification.pending === []`、`council.resolved === true`）⇒
  // `getLegalActions` 对每个座位都返回 `[]`、`buildChoice` 交出空 criteria。
  // 本条钉三件事：(a) 空候选必须**可分桶**（Task 15 不得读成「模型拒答」）；
  //              (b) 文本层必须把「谁在跟谁对峙」写出来（人类玩家看得见的事实）；
  //              (c) 锁定进度本身**不许**从文本里反推出来（那是 DuelState 的私密）。
  const open = duelOpenScene();
  const picked = duelPickedAScene();
  for (const s of [open, picked]) {
    const duel = s.duel;
    assert.ok(duel !== null, '前提自查：两个对峙场景都必须仍未决');
    for (let seat = 0; seat < s.players.length; seat += 1) {
      const text = describeState(s, seat);
      assert.ok(text.includes(`对峙进行中：座${String(duel.seatA)} vs 座${String(duel.seatB)}`),
        `对峙必须写成公开事实（座${String(seat)} 视角）：${text}`);
      const choice = buildChoice(s, seat);
      // ⚠️ **B68 更新（G-f 已修）**：参与者此刻**有**选牌候选 ⇒ 断言只对**非参与者**成立。
      //   非参与者仍是空候选（他们此刻没有可做的动作）⇒ 可分桶标记照旧。
      const isParticipant: boolean = seat === duel.seatA || seat === duel.seatB;
      // ⚠️ **B68 更新（G-f 已修）**：参与者**未锁定时**才有选牌候选；已锁定者**等对方** ⇒ 无候选。
      const locked = isParticipant && (seat === duel.seatA ? duel.pickA !== undefined : duel.pickB !== undefined);
      if (isParticipant && !locked) {
        // ⚠️ 参与者已有候选 ⇒ 题面**不再为空** ⇒ 但「对峙进行中」仍必须写出来（公开事实）。
        assert.ok(Object.keys(choice.criteria).length > 0,
          `座${String(seat)} 是对峙参与者且未锁定 ⇒ 必须有选牌候选（G-f 已修）`);
        assert.equal(choice.noLegalActions, false,
          `座${String(seat)} 有候选 ⇒ noLegalActions 必须为 false`);
      } else {
        assert.equal(Object.keys(choice.criteria).length, 0,
          isParticipant
            ? `座${String(seat)} 已锁定亮牌 ⇒ 等对方选牌，本回合无候选`
            : `引擎口径：对峙未决 ⇒ 非参与者无候选（他们此刻没有可做的动作）`);
        assert.equal(choice.noLegalActions, true,
          '空候选必须带可分桶标记，否则 Task 15 的 P1/P2 会把「枚举给不出动作」读成「模型拒答」');
      }
    }
  }
  // (c) 锁定进度不可反推：文本在「有人锁定」前后必须**逐字相同**，**包括参与者本人**那一侧。
  //     成立的前提是引擎事实：`submitDuelCard` 只往 `duel` 里写 pickA/pickB，锁定**不等于**移出手牌
  //     （移出手牌要等 `settleDuel`）⇒ 持牌条数也不变。文本层一旦写出 pickA/pickB 的存在性
  //     （哪怕只是一个「移动方已锁牌」的标记），这条当场红。
  for (let seat = 0; seat < open.players.length; seat += 1) {
    assert.equal(describeState(open, seat), describeState(picked, seat),
      `座${String(seat)} 的文本不许泄露「有没有人已锁牌」（锁牌进度本身是 DuelState 的私密面）`);
  }
  // 已揭晓的场景反过来：duel 归 null ⇒ 不许再出现「对峙进行中」，而两张牌必须进公开亮牌。
  const revealed = duelRevealedScene();
  const revealedText = describeState(revealed, 2);
  assert.equal(revealedText.includes('对峙进行中'), false, `结算完了还写着对峙进行中 = 说谎：${revealedText}`);
  assert.match(revealedText, /公开亮牌：/, '结算后的两张牌必须走公开留场那条通道交出去');

  // 评审 4b：对峙未决 **且** 认证进行中 ⇒ 候选侧在对峙期真的被执行（过去这道面从来没被跑到过）。
  const both = duelWithCertificationScene();
  assert.ok(both.duel !== null, '前提自查：对峙必须仍未决');
  assert.ok(both.certification.pending.length > 0, '前提自查：认证池必须仍在');
  const certifier = 2;
  const bothChoice = buildChoice(both, certifier);
  assert.ok(Object.keys(bothChoice.criteria).length > 0,
    `对峙期认证人必须有候选（否则本条又退化成在测空气）：${JSON.stringify(bothChoice)}`);
  assert.equal(bothChoice.noLegalActions, false, '有候选时标记必须是 false（两种空/非空不得混桶）');
  assert.equal(bothChoice.criteria['cert:sign:0'], '给座0签印', '对峙期的候选语义与常规期同形');
  // 文本层此时既说「对峙进行中」又说认证进度——两件事都在明面上，读者不会把空/非空候选误读。
  const bothText = describeState(both, certifier);
  assert.ok(bothText.includes('对峙进行中') && bothText.includes('签印进度'), `对峙 + 认证必须同时可见：${bothText}`);
  // 私密侧照常：已锁定的那张暗牌 id 不许出现在任何一个座位的题面里（与 ① 同一判据，这里单点复验）。
  const locked = both.duel.pickA ?? both.duel.pickB ?? '';
  assert.ok(locked.length > 0, '前提自查：必须已有一方锁定');
  for (let seat = 0; seat < both.players.length; seat += 1) {
    assert.equal(tokensOf(scannedText(both, seat)).includes(locked), false,
      `对峙期候选侧被测到的同时，座${String(seat)} 的题面仍不得出现锁定牌 ${locked}`);
  }
});

test('结构守卫的注释剥离（常驻·评审 7）：判不准就保留整行——宁可假红，不可假绿', () => {
  // 旧实现是 `line.replace(/\/\/.*$/, '')`：字符串字面量里的 `//` 会被当成注释起点，
  // 把**同一行后面的真代码**一起吃掉 ⇒ 违规行被抹平、守卫变绿（假绿，正是最不能要的方向）。
  assert.equal(stripJsComments('// duel.pickA 只在注释里点名').includes('pickA'), false, '纯注释行应当剥掉');
  assert.equal(stripJsComments('   * 块注释续行里的 duel.pickB 也算注释').includes('pickB'), false, '块注释续行应当剥掉');
  assert.equal(stripJsComments('/** 单行块注释：duel.pickA */').includes('pickA'), false, '整行块注释应当剥掉');
  assert.equal(stripJsComments('const leak = "// duel.pickA 藏在字符串里";').includes('pickA'), true,
    '字符串里的 `//` 不许当成注释：同一行剩下的真代码必须仍然在待扫描文本里');
  assert.equal(stripJsComments('const a = 1; // 行尾注释点名 duel.pickB').includes('pickB'), true,
    '行尾注释**不剥**（无法在不写词法分析器的前提下证明它不在串里）⇒ 宁可假红，把注释单独成行');
  assert.equal(stripJsComments('const t = `a//duel.pickB`;').includes('pickB'), true, '模板串内的 `//` 同样不是注释');
  assert.equal(stripJsComments('const m = "第一行"\n  + "//"\n  + state.decks;').includes('decks'), true,
    '跨行拼接里出现的 `//` 不许把后面的真代码吞掉');
  // 结构性证明：这条保守性直接决定「把违规写在可疑行上」的变异会不会溜过去。
  assert.ok(stripJsComments('x = "//"; y = state.decks;').includes('decks'),
    '被可疑引号保护的行必须把 `state.decks` 留在文本里（否则结构守卫能被一行字符串绕过）');
  assert.equal(stripJsComments('x = 1;\n// state.decks 在下一行的注释里').includes('decks'), false,
    '反向钉子：保守不等于「什么都不剥」——纯注释行仍然必须剥掉，否则本仓库的注释写法会全红');
});

// ---------------------------------------------------------------------------
// B70（Task 4）：对峙题面补颜色/点数 + 指令按候选面生成
// ---------------------------------------------------------------------------

test('B70：对峙候选描述含颜色与点数', () => {
  const s = startDuel(mk(4, 7), 0, 1);
  const duel = s.duel;
  assert.ok(duel, 'startDuel 之后对峙必须存在');
  const seat = duel.seatA;
  const card = s.players[seat]?.hand[0];
  assert.ok(card, '前提自查：对峙参与者手牌非空');
  const text = describeAction(s, { type: 'DUEL_SUBMIT_CARD', actor: seat, cardId: card.id }, seat);
  assert.ok(text.includes(card.color === 'red' ? '红' : '黑'), `缺颜色：${text}`);
  assert.ok(text.includes(String(card.rank)), `缺点数：${text}`);
  assert.ok(text.length <= 40, `超预算：${text.length}`);
});

test('B70：对峙面 instructions 写明规则并限定只能选亮牌', () => {
  const s = startDuel(mk(4, 7), 0, 1);
  const duel = s.duel;
  assert.ok(duel, 'startDuel 之后对峙必须存在');
  const q = buildChoice(s, duel.seatA);
  assert.ok(Object.keys(q.criteria).length > 0, '对峙参与者必须有候选');
  for (const k of Object.keys(q.criteria)) { assert.ok(k.startsWith('duel:card:'), `混入别面：${k}`); }
  assert.match(q.instructions, /红/);
  assert.match(q.instructions, /点数/);
  assert.match(q.instructions, /只能/);
});

test('B70：非对峙面 instructions 不含对峙规则（面感知不得污染其它面）', () => {
  const q = buildChoice(mk(4, 7), 0);
  assert.doesNotMatch(q.instructions, /红牌胜黑牌/);
});

// ---------- B75：装备与否决的三层同步（枚举层 / 候选层 / 判定形状层） ----------

test('B75：行动面每张手牌都有一条装备候选，且枚举出的装备必被引擎接受', () => {
  const s = mk(4, 7);
  const hand = s.players[0]!.hand;
  assert.ok(hand.length > 0, '前提：座 0 必须有手牌');
  assert.equal(candidatesOf(s, 0).filter((a) => a.type === 'EQUIP_CARD').length, hand.length,
    '粗筛必须按手牌逐张发装备候选');
  const equipped = getLegalActions(s, 0).filter((a) => a.type === 'EQUIP_CARD');
  assert.equal(equipped.length, hand.length, '装备候选不得被试跑层误删（引擎 equip 会接受）');
  for (const a of equipped) {
    assert.equal(probeAction(s, a).ok, true, `枚举出的装备必须被引擎接受：${actionKey(a)}`);
  }
  // 候选层三层同形：UI 的候选集合与引擎粗筛逐条相等
  assert.deepEqual(uiCandidates(s, 0).filter((a) => a.type === 'EQUIP_CARD').map(actionKey).sort(),
    candidatesOf(s, 0).filter((a) => a.type === 'EQUIP_CARD').map(actionKey).sort());
});

test('B75：待认证锁定仍发装备候选（装备不是位移，与引擎同判）', () => {
  const s = lockedScene();
  assert.equal(s.players[0]!.pendingCert, true, '前提：夹具必须是锁定局面');
  const hand = s.players[0]!.hand;
  // ⚠️ 关键方向：锁定分支里**位移牌也照样能装备** ⇒ 装备候选数 = 手牌数，
  //   而 PLAY_CARD 候选会因位移判定而变少 ⇒ 两个数量不相等正是本用例要钉住的差别。
  assert.equal(candidatesOf(s, 0).filter((a) => a.type === 'EQUIP_CARD').length, hand.length);
  const plays = candidatesOf(s, 0).filter((a) => a.type === 'PLAY_CARD');
  assert.ok(plays.length <= hand.length, '锁定面的出牌候选只会更少（位移牌被拒）');
  assert.equal(getLegalActions(s, 0).filter((a) => a.type === 'EQUIP_CARD').length, hand.length,
    '锁定面的装备候选不得被试跑层误删');
});

/** 山议面：座 0 持否决权，`allVoted` 决定是否票齐。 */
function vetoScene(allVoted: boolean): State {
  let s = { ...councilScene(4, 7) };
  s = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, flags: { ...p.flags, canVeto: true } } : p)) };
  for (const p of s.players.filter((x) => x.alive)) {
    if (!allVoted && p.seat === 2) { continue; }   // 留一个存活者没投 ⇒ 测「未投完」
    const r = castVote(s, p.seat, p.seat === 1 ? 0 : 1);
    assert.ok(r.ok, `前提：座 ${String(p.seat)} 投票必须成功：` + String(r.note));
    s = r.state;
  }
  return s;
}

test('B75：山议面只给持权者发否决候选，且必须所有存活玩家都投完票', () => {
  const notAll = vetoScene(false);
  assert.equal(candidatesOf(notAll, 0).some((a) => a.type === 'COUNCIL_VETO'), false,
    '存活者还有票没投 ⇒ 不得发否决候选');
  const s = vetoScene(true);
  assert.equal(candidatesOf(s, 0).some((a) => a.type === 'COUNCIL_VETO'), true, '持权且票齐 ⇒ 必须发');
  assert.equal(candidatesOf(s, 2).some((a) => a.type === 'COUNCIL_VETO'), false, '非持权者不发');
  assert.equal(getLegalActions(s, 0).some((a) => a.type === 'COUNCIL_VETO'), true, '试跑层必须放行否决');
  assert.equal(probeAction(s, { type: 'COUNCIL_VETO', actor: 0 }).ok, true);
  // 已用过 ⇒ 三层同时收掉（枚举 / UI 候选 / 引擎）
  const used = { ...s, council: { ...s.council, vetoUsed: true, vetoBy: 0 } };
  assert.equal(candidatesOf(used, 0).some((a) => a.type === 'COUNCIL_VETO'), false, '每局一次');
  assert.equal(candidatesOf(used, 2).some((a) => a.type === 'COUNCIL_VETO'), false, '非持权者即便票齐也不发');
});

test('B75：否决的 UI 拒因矩阵（拒绝不沉默，且与引擎同判）', () => {
  const veto: Action = { type: 'COUNCIL_VETO', actor: 0 };
  const s = vetoScene(true);
  assert.equal(uiAllows(s, 0, veto), true);
  assert.equal(uiBlockNotice(s, 0, veto), null);
  assert.equal(uiBlockNotice(s, 2, veto), '你没有否决特权。');
  assert.equal(uiBlockNotice(vetoScene(false), 0, veto), '等待所有玩家投票后才能使用否决。');
  const used = { ...s, council: { ...s.council, vetoUsed: true, vetoBy: 0 } };
  assert.equal(uiBlockNotice(used, 0, veto), '本局否决已使用。');
  const closed = { ...s, council: { ...s.council, resolved: true } };
  assert.equal(uiBlockNotice(closed, 0, veto), '山议未在进行中。');
  // 判定形状层：UI 允许 ⇔ 探针接受（逐条，不只上面这一条）
  for (const [st, seat] of [[s, 0], [s, 2], [vetoScene(false), 0], [used, 0], [closed, 0]] as Array<[State, number]>) {
    assert.equal(uiAllows(st, seat, veto), probeAction(st, { ...veto, actor: seat }).ok,
      `UI 与引擎在座 ${String(seat)} 的否决判定漂移`);
  }
});

test('B75：装备与否决入口必须走同一道闸（uiAllows / uiBlockNotice）', () => {
  // 源码接线守卫（与既有 R-1 同法）：UI 是**消费者**，判据仍由 Task 5 的两套独立实现提供；
  // 本条只钉「入口存在且先问闸」——绕过闸门的入口正是 B53 那类破口的形状。
  const src = readFileSync('web/main.ts', 'utf8');
  const councilSrc = readFileSync('web/ui/council.ts', 'utf8');
  assert.match(src, /performAction\([^)]*'equip'/, '装备必须走 performAction(..., \'equip\') 这一条入口');
  assert.match(src, /'EQUIP_CARD'[\s\S]{0,400}uiAllows/, '装备入口必须先过 uiAllows（拒绝不得沉默）');
  assert.match(src, /uiBlockNotice/, '装备入口被拒时要给出 uiBlockNotice 的理由');
  assert.match(src, /useCouncilVeto/, '否决按钮必须调用引擎唯一入口 useCouncilVeto');
  assert.match(councilSrc, /uiAllows\([^)]*'COUNCIL_VETO'/, '山议面板的否决按钮同样先过闸');
  // 不得在 UI 侧另写一份否决/装备判据（判据只有 legal-gate 与引擎两处）
  assert.equal(/canVeto\s*===?\s*true/.test(src), false, 'main.ts 不得自己判 canVeto（那是 legal-gate 的判据）');
});

test('B75：装备的 UI 拒因（锁定不拒、牌不在手才拒、不看资源）', () => {

  const s = mk(4, 7);
  const card = s.players[0]!.hand[0]!;
  assert.equal(uiBlockNotice(s, 0, { type: 'EQUIP_CARD', actor: 0, cardId: card.id }), null);
  assert.equal(uiBlockNotice(s, 0, { type: 'EQUIP_CARD', actor: 0, cardId: 'no_such_card' }),
    '手牌里没有这张牌（可能已被弃掉或不属于你）。');
  // ⚠️ 装备**免费**：即便把资源清零也照样能装备（与出牌不同，不看 cost）——
  //   反向用例（资源不足 ⇒ 出牌被拒）已在 B65 的用例里钉住。
  const broke = { ...s, players: s.players.map((p) => (p.seat === 0 ? { ...p, resource: 0 } : p)) };
  assert.equal(uiBlockNotice(broke, 0, { type: 'EQUIP_CARD', actor: 0, cardId: card.id }), null);
  // 锁定不是拒因（结构化 code，不匹配文案）
  const locked = lockedScene();
  const lc = locked.players[0]!.hand[0]!;
  assert.equal(uiAllows(locked, 0, { type: 'EQUIP_CARD', actor: 0, cardId: lc.id }), true);
  assert.equal(probeAction(locked, { type: 'EQUIP_CARD', actor: 0, cardId: lc.id }).ok, true);
});

test('B75：枚举层与 UI 门禁在装备/否决上逐条同形（漂移守卫的新面）', () => {
  for (const [label, s, seat] of [
    ['行动面', mk(4, 7), 0],
    ['锁定面', lockedScene(), 0],
    ['山议面（票齐）', vetoScene(true), 0],
    ['山议面（票齐，非持权）', vetoScene(true), 2],
    ['山议面（未票齐）', vetoScene(false), 0],
  ] as Array<[string, State, number]>) {
    const engine = candidatesOf(s, seat).filter((a) => a.type === 'EQUIP_CARD' || a.type === 'COUNCIL_VETO')
      .map(actionKey).sort();
    const ui = uiCandidates(s, seat).filter((a) => a.type === 'EQUIP_CARD' || a.type === 'COUNCIL_VETO')
      .map(actionKey).sort();
    assert.deepEqual(ui, engine, `${label}：UI 候选与引擎粗筛漂移`);
  }
});

