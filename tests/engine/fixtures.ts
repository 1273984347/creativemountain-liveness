// 测试局面的唯一来源：全部通过**真实引擎调用**构造，不手拼 certification/council 字段。
//
// ⚠️ 为什么坚持走引擎入口而不是手拼状态：
//   · `enterPendingCertification` 除了置 `pendingCert` / 追加 `pending`，还会应用
//     山主 `certify_free_pass` 免质疑标记——手拼会**静默跳过**这条真实前置；
//   · `advanceCertificationRound` 在 `round === 0` 且有待认证者时正是「开启第 1 轮」
//     的引擎语义（不掷骰、不动局势），用它把 round 从 0 推到 1 无需伪造任何字段。
//
// ⚠️ 为什么每个 builder 除了 `.ok` 还要断言**后置条件**：
//   `.ok === true` **不等于**「名字承诺的事发生了」。引擎里至少两类入口会 ok:true 却不落账——
//   · `certifyChallenge` 遇目标持山主 `certify_free_pass`：本次质疑**视为签印**，
//     `challenged` 里根本没有质疑人（certification.ts:133-145）；
//   · `certifyAppeal` **不要求**已存在失败判定（certification.ts:206-220 只查 pending、
//     target === actor、本轮未申请过、资源 >= 2）⇒ 判定若是「通过」它照样返回 ok:true。
//   若 builder 只看 `.ok`，就会把这些「假局面」交给 Tasks 6–8，表现为下游一条莫名其妙的红。
//   故每个 builder 收尾都断言「局面名承诺的字段」，失败消息里带上 builder 名与引擎 `note`。
import assert from 'node:assert/strict';
import { createInitialState, type State } from '../../engine/core/state.ts';
import {
  advanceCertificationRound,
  certifyAppeal,
  certifyAnswer,
  certifyChallenge,
  enterPendingCertification,
} from '../../engine/core/certification.ts';
import { openCouncil } from '../../engine/core/council.ts';
import { getScales } from '../../engine/scales.ts';
import type { CertificationState } from '../../engine/core/flow.ts';

export type SeatCount = 3 | 4 | 5 | 6 | 7 | 8;

/** 引擎 note 的可读兜底（note 是可选属性，缺失时消息里仍要说清楚）。 */
function noteOf(note: string | undefined): string {
  return note ?? '（引擎未给 note）';
}

/** 认证历史里**非空**的字段（`round` / `pending` 除外）——用来把「会被抹掉的东西」列清楚。 */
function certificationHistory(c: CertificationState): string[] {
  const dirty: string[] = [];
  for (const field of ['signed', 'challenged', 'abstained', 'appealed'] as const) {
    if (c[field].length > 0) { dirty.push(`${field}=[${c[field].join(', ')}]`); }
  }
  for (const field of ['signatures', 'judgments', 'appealVotes', 'validityVotes'] as const) {
    if (Object.keys(c[field]).length > 0) { dirty.push(`${field}=${JSON.stringify(c[field])}`); }
  }
  if (c.validityDecided) { dirty.push('validityDecided=true'); }
  return dirty;
}

/**
 * 初始状态。
 *
 * ✅ 保证：3–8 人**每一档的每个座位都真的发满 `scales.handStart` 张起始手牌**。
 *   `dealInitialHands` 逐座位从主牌库抽 `handStart` 张（hand.ts:68-77），牌库不足时
 *   `drawCards` **静默少发**（hand.ts:23-33）——旧写法固定 `deckSize: 40` 时
 *   7 人局末座只拿到 4/6 张、8 人局末三座拿到 5/0/0 张，注释里的「保证有手牌可打」
 *   在 Task 5/6/7/8 要传的人数档位上其实是假的。
 *   ⇒ 牌库容量改为**按人数档位取规模表的 `deckTotal`**（scales.ts 的权威值，
 *     `deckTotal >= players × handStart` 全部六档成立且留有余量），并由下面的后置断言守住，
 *     不再是注释里的口头承诺。
 */
export function mk(players = 4, seed = 7): State {
  const row = getScales(players as SeatCount);
  const deckSize = row.deckTotal;
  const state = createInitialState({ players: players as SeatCount, seed, deckSize });
  const short = state.players
    .filter((p) => p.hand.length !== row.handStart)
    .map((p) => `座${String(p.seat)}：${String(p.hand.length)}/${String(row.handStart)} 张`);
  assert.equal(short.length, 0,
    `mk(players=${String(players)}, seed=${String(seed)})：起始手牌必须人人拿满 `
    + `scales.handStart=${String(row.handStart)}（发不满就说明牌库容量没跟上人数），`
    + `实际缺牌座位 ${short.join('、')}；本次 deckSize=${String(deckSize)}`);
  return state;
}

/**
 * 把指定座位放上峰顶并置为待认证（认证第 1 轮已开启）。
 *
 * ⚠️ **前置（会被断言拦住，不满足就大声失败）**：起点必须是 `certification.round === 0`
 *   且**无任何认证历史**的状态。因为 `advanceCertificationRound` 的 round-0 分支把
 *   `certification` **整体替换**为 `emptyCertification() + round:1 + pending`
 *   （certification.ts:333-339）：
 *   · 在已有签印/判定的状态上调用 ⇒ 历史被静默抹掉；
 *   · 在第 1 轮进行中的状态上调用（例如 `putPending(pendingScene(), [1])`）
 *     ⇒ 走的是「进入第 2 轮」分支，交出的局面根本不是本函数承诺的第 1 轮。
 *   需要「第 N 轮进行中 / 带签印历史」的局面时，请在已有场景之上**继续调用真实引擎入口**，
 *   而不是回头拿 putPending 拼。
 */
export function putPending(s: State, seats: number[]): State {
  const c = s.certification;
  assert.equal(c.round, 0,
    `putPending：起点必须是 certification.round === 0（第 1 轮尚未开始），实际 round=${String(c.round)}。`
    + `round-0 分支会整体替换 certification，在非零轮调用等于把认证流程悄悄推到下一轮；`
    + `要「第 N 轮进行中」的局面请在场景上继续调用真实引擎入口。`);
  const history = certificationHistory(c);
  assert.equal(history.length, 0,
    `putPending：起点必须没有认证历史（否则会被 round-0 分支整体替换掉、静默抹除），实际残留 `
    + history.join('、'));
  // 放上峰顶是 enterPendingCertification 的语义前置（登顶才会触发认证），棋盘坐标可直接置；
  // 待认证状态本身必须走引擎入口（含山主 certify_free_pass 标记的应用）。
  let next: State = {
    ...s,
    players: s.players.map((p) => (seats.includes(p.seat) ? { ...p, position: s.board.peakIndex } : p)),
  };
  for (const seat of seats) {
    const r = enterPendingCertification(next, seat);
    assert.ok(r.ok, `putPending：座 ${String(seat)} 进入待认证必须成功：` + noteOf(r.note));
    next = r.state;
  }
  // round 0 → 1（第 1 轮尚未开始 → 进行中）走真实引擎调用，不手拼 certification.round。
  const opened = advanceCertificationRound(next);
  assert.ok(opened.ok, 'putPending：开启第 1 轮认证必须成功：' + noteOf(opened.note));
  const missing = seats.filter((seat) => !opened.state.certification.pending.includes(seat));
  assert.equal(missing.length, 0,
    `putPending：请求的座位必须全部进入 certification.pending，实际缺席 `
    + missing.map((x) => `座${String(x)}`).join('、')
    + `（现有 pending=[${opened.state.certification.pending.join(', ')}]）；引擎 note=` + noteOf(opened.note));
  return opened.state;
}

/** 座 0 待认证锁定（行动阶段应无动作）。 */
export function lockedScene(): State { return putPending(mk(), [0]); }

/** 座 0 待认证、认证轮进行中。 */
export function pendingScene(players = 4, seed = 7): State { return putPending(mk(players, seed), [0]); }

/** 座 1 已质疑座 0（获得判定权）。 */
export function challengedScene(players = 4, seed = 7): State {
  const r = certifyChallenge(pendingScene(players, seed), 1, 0);
  assert.ok(r.ok, 'challengedScene：发起质疑必须成功，否则后续断言无意义：' + noteOf(r.note));
  // 后置：`.ok` 只说明「质疑这次动作被接受」，不说明「座 1 拿到了判定权」——
  // 目标持山主 `certify_free_pass` 时质疑被记成**签印**、`challenged` 里没人。
  assert.ok(r.state.certification.challenged.includes(1),
    `challengedScene：局面名承诺「座 1 已质疑」⇒ certification.challenged 必须含座 1，`
    + `实际 challenged=[${r.state.certification.challenged.join(', ')}]、`
    + `signed=[${r.state.certification.signed.join(', ')}]（山主免质疑会把质疑改记为签印）；`
    + `引擎 note=` + noteOf(r.note));
  return r.state;
}

/** 座 1 质疑并判座 0 不通过 ⇒ 座 0 付 2 资源后复议已发起。 */
export function appealedScene(players = 5, seed = 7): State {
  const answered = certifyAnswer(challengedScene(players, seed), 1, 0, false);
  assert.ok(answered.ok, 'appealedScene：判定必须落账，否则后续断言无意义：' + noteOf(answered.note));
  // 后置：局面名承诺「判不通过」。certifyAppeal **并不**要求失败判定存在
  // （只查 pending / target === actor / 本轮未申请过 / 资源 >= 2），
  // 所以「判通过」也能一路走到 appealed=[0] ⇒ 必须在源头就把 judgments[1] === false 钉死。
  assert.equal(answered.state.certification.judgments[1], false,
    `appealedScene：局面名承诺「座 1 判座 0 不通过」⇒ certification.judgments[1] 必须是 false，`
    + `实际 judgments[1]=${String(answered.state.certification.judgments[1])}；`
    + `引擎 note=` + noteOf(answered.note));
  const judged = answered.state;
  // certifyAppeal 的前置是 resource >= 2 且 target === actor——先补足资源再申请。
  const rich: State = { ...judged, players: judged.players.map((p) => (p.seat === 0 ? { ...p, resource: 5 } : p)) };
  const r = certifyAppeal(rich, 0, 0);
  assert.ok(r.ok, 'appealedScene：复议申请必须成功，否则后续断言无意义：' + noteOf(r.note));
  assert.ok(r.state.certification.appealed.includes(0),
    `appealedScene：局面名承诺「座 0 已申请复议」⇒ certification.appealed 必须含座 0，`
    + `实际 appealed=[${r.state.certification.appealed.join(', ')}]；引擎 note=` + noteOf(r.note));
  return r.state;
}

/** 山议进行中。 */
export function councilScene(players = 4, seed = 7): State {
  const r = openCouncil(mk(players, seed));
  assert.ok(r.ok, 'councilScene：开启山议必须成功，否则后续断言无意义：' + noteOf(r.note));
  // 后置：局面名承诺「山议进行中」——`resolved === false` 才是进行中；
  // 只断言 `.ok` 的话，任何「ok:true 但没把 council 置为未结算」的引擎改动都会伪装成绿灯。
  assert.equal(r.state.council.resolved, false,
    `councilScene：局面名承诺「山议进行中」⇒ council.resolved 必须是 false，`
    + `实际 resolved=${String(r.state.council.resolved)}、phase=${r.state.phase}；`

    + `引擎 note=` + noteOf(r.note));
  return r.state;
}

/**
 * 某个座位**已出局**的局面（发现 2 的 e 项取证：粗筛窄于引擎的第五条）。
 *
 * ⚠️ 用**真实引擎入口**构造：`damage` 算子在体力归零时把目标置 `alive: false`
 *   （`engine/ops/registry.ts` 的 damage 分支）⇒ 不用手拼 `alive` 字段。
 *   打死之前先确认目标有手牌 —— 否则粗筛会因「无牌可打」而清空，
 *   取证就分不清是「死亡座位」这一条判据在起作用（⇒ 取证必须**只有这一个变量**）。
 */
export function exiledScene(players = 4, seed = 7, victimSeat = 3): State {
  const s = mk(players, seed);
  const victim = s.players[victimSeat];
  assert.ok(victim !== undefined, `前提：座 ${String(victimSeat)} 必须存在`);
  assert.ok(victim.hand.length > 0, `前提：座 ${String(victimSeat)} 必须有手牌（否则取证的变量不唯一）`);
  // ⚠️ B76：damage 不再出局（打空 ⇒ 力竭）⇒ 夹具改**直接置放逐结果**。
  //   本夹具的语义是「一个已出局的座位」，与出局方式无关（放逐是唯一出局通道，engine/core/council.ts）；
  //   消费方测的是出局者的行为，不是出局的来路（直改字段 = withGoal / withPassive 同款先例）。
  const out: State = {
    ...s,
    players: s.players.map((p) => (p.seat === victimSeat ? { ...p, alive: false } : p)),
  };
  const now = out.players[victimSeat];
  assert.equal(now?.alive, false, `前提：座 ${String(victimSeat)} 必须真的被置为出局`);
  return out;
}


/**
 * 某个座位**停在未通关隘格上**的局面（B53：把「关隘面」纳入漂移守卫的覆盖范围）。
 *
 * ⚠️ 为什么需要它：默认棋盘是 `makeBoard` 造的**直线山道（无关隘）**
 *   ⇒ 在此之前，`driftScenes` 里**没有任何关隘局面** ⇒ 「COMPARE 是否枚举」那一面
 *   在漂移守卫中恒为空集（空集 ≠ 有效，E87）⇒ UI 与引擎在关隘面的破口**无人看得见**。
 *
 * ⚠️ 为什么只改 board 与 position：仓内禁令是「不手拼 certification / council / duel 字段」
 *   （那些有专门的引擎入口与前置断言）；棋盘在**测试用直线山道**上补一个关隘格、
 *   再把玩家挪过去，是最小必要构造，不伪造任何流程状态。
 */
/**
 * `gateScene` 的**已改为付费**变体：本关只剩付费通道（试炼失败后，B24）。
 *
 * ⚠️ 为什么要单独一个场景：B53 的 X4（UI 侧漏判 `gate_pay_<index>`）**在集合类守卫里
 *   看不见** —— payOnly 时 `uiCandidates` **本就不发** COMPARE 候选 ⇒ 枚举层/候选层守卫
 *   结构上覆盖不到它 ⇒ 回退 X4 后守卫仍全绿（盲审变异实测确认）⇒ 必须另立
 *   **直接断言 `uiBlockNotice` 的**用例（不靠集合相等）。
 */
export function gatePayOnlyScene(players = 4, seed = 7, gateIndex = 3, seat = 0): State {
  const s = gateScene(players, seed, gateIndex, seat);
  const out: State = {
    ...s,
    players: s.players.map((p) => (p.seat === seat
      ? { ...p, flags: { ...p.flags, [`gate_pay_${gateIndex}`]: true } }
      : p)),
  };
  assert.equal(
    out.players[seat]?.flags[`gate_pay_${gateIndex}`],
    true,
    '前提：目标座位必须真的被标记为「本关已改为付费」');
  return out;
}
export function gateScene(players = 4, seed = 7, gateIndex = 3, seat = 0): State {
  const s = mk(players, seed);
  // ⚠️ 试炼通道需要**牌堆里真实存在**的试炼牌：`drawTrial` 按 `tile.gate.trialIds`
  //   从 `state.decks.trial` 过滤（gate.ts）⇒ 默认状态该牌堆是**空的** ⇒
  //   不补这张牌，试炼通道必拒（引擎不枚举 `trial`）⇒ 守卫会误以为两侧不等。
  const trialCard = {
    id: 'test_trial_gate',
    name: '测试试炼牌',
    type: 'utility' as const,
    cost: 0,
    color: 'red' as const,
    rank: 2,
    text: '测试用试炼牌',
    effects: [],
  };
  const tiles = s.board.tiles.map((t) =>
    t.index === gateIndex
      ? { ...t, kind: 'gate' as const, name: `第${String(gateIndex)}格关隘`, gate: { fee: 3, trialIds: [trialCard.id] } }
      : t);
  const players2 = s.players.map((p) => (p.seat === seat ? { ...p, position: gateIndex } : p));
  const out: State = {
    ...s,
    board: { ...s.board, tiles },
    players: players2,
    decks: { ...s.decks, trial: [trialCard] },
  };
  assert.equal(out.players[seat]?.position, gateIndex, '前提：目标座位必须真的停在关隘格上');
  assert.equal(
    out.board.tiles.find((t) => t.index === gateIndex)?.kind,
    'gate',
    '前提：那一格必须真的是关隘（默认棋盘是无关隘的直线山道）');
  return out;
}