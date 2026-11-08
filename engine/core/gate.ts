// 关隘（规格 §3.5）
//
// 关隘是山道上的硬门槛，每座提供两条通过路径：
//   · **付费通道**：支付关隘标价（3–5 灵枢）立即通过；
//   · **试炼通道**：抽一张试炼牌执行其要求。
// 已通过同座关隘的试炼牌不再被抽取。

import type { State } from './state.ts';
import type { Tile } from '../types/theme.ts';
import { rollD20 } from './dice.ts';
import { discardDownToLimit } from './hand.ts';
import { compareCards } from './duel.ts';
import { applyEffectToState } from '../ops/registry.ts';

/**
 * AI 关隘策略的**余量门槛**：付费后仍要留有余量灵枢，才值得直接付费。
 *
 * ⚠️ 为什么改（B24）：原策略「灵枢够就付费」⇒ 试炼通道在真实对局里几乎不被使用
 *   （实测 24000 局仅 **9 次**，12 张试炼牌里 6 张一次都没出现）⇒ 试炼机制形同虚设。
 * ⚠️ 余量规则的**真实含义**：试炼失败 ⇒ 本关改为付费 ⇒ 最终仍要付费；
 *   余量不是「省下来」，而是「**先博一把**」——试炼通过还有额外收益（主题包 then 分支）。
 *   B27 实测：试炼失败中 **99.9%** 属「掏空余量仍过关」⇒ 余量规则在**试炼路径上并不保余量**。
 *
 * ⚠️ **取值 2 的选取依据**（B30 **10 组 × 3000 局** = 每取值 **3 万局**；**组数与每组规模同时放大** ⇒ σ 最小；
 *   判定用 **Welch t**（不假设等方差）而非「合并噪声 2σ」近似；仍走生产同一条代码路径）：
 *   · 余量 **0** ⇒ 试炼几乎消失（每千局 **0.1 ± 0.2** 次 ⇒ 机制隐形）⇒ 必须 > 0；
 *   · 余量 **1 / 3** ⇒ 与 2 在兜底率与平均席位上**均不显著**（Welch t ≤ 1.83 < 2.101）⇒ 1–3 等价；
 *   · 余量 **4** ⇒ **显著更差**：兜底率 +0.54pp（**Welch t = 3.51**）、平均席位 −0.034（**t = 5.95**）⇒ 不取 4；
 *   · ⇒ 维持 **2**（1–3 等价取中；4 显著更差；0 机制隐形）；
 *   · 试炼使用率对余量**单调且极显著**（0.1 → 502 → 930 → 1862 → 3461 次/千局）⇒ 因果链稳。
 *
 * ⚠️ **B31 补充（20 组 × 3000 局 = 每取值 6 万局）**：余量 **0 vs 2** 的差异**显著**
 *   （兜底率 +0.31pp，Welch |t| = 2.86；平均席位 −0.014，|t| = 3.38；df≈38，临界 2.024），
 *   且方向是「**余量 0 的平衡指标反而略好**」⇒ 因此取 2 是一笔**自觉的取舍**：
 *   **用可量化的平衡代价（兜底 +0.31pp、席位 −0.014）换试炼通道的真实可达性**（932.9 vs 0.2 次/千局）。
 *   ⇒ 只看平衡指标会选出「把机制关掉」的取值 ⇒ 阈值必须**同时**看平衡与机制使用率。
 *
 * ⚠️ **结论演进（五批样本切分不同 ⇒ 结论随之变，留痕防后人读到过时依据）**：
 *   · B27（**单组** 6000 局）称「余量 4 ⇒ 兜底率 7.9% 劣化」—— 单组**无法估 σ** ⇒ 不可判定；
 *   · B28（4 组 × 3000）判「平均席位可区分」（2σ 近似、处于边界）；
 *   · B29（10 组 × **1992**）判「全部不可区分」（每组变小 ⇒ σ 变大 ⇒ 判定退化）；
 *   · B30（10 组 × 3000 + Welch t）判「余量 4 显著更差」；
 *   · **B31（20 组 × 3000）判「余量 0 vs 2 亦显著」** ⇒ 平衡代价的**方向与幅度**首次清晰。
 *   ⇒ 教训：判可区分性必须**同时控制组数与每组规模**，并用 **t 检验 + 95% CI**（非 2σ 近似）；
 *     且**唯一判定口径**以 Welch t + 95% CI 为准（2σ 近似仅并列参考）。
 */
export const GATE_RESOURCE_RESERVE = 2;

/**
 * AI 是否**体面地**付得起这道关隘：付费后仍余 ≥ `reserve` 灵枢。
 *
 * ⚠️ **单一事实源**：`advance.ts`（要不要先比牌）与 `autoResolveGate`（付费还是试炼）共用本判据，
 *   各写一份 ⇒ 两处口径漂移 ⇒ 出现「不比对牌也不付费」或「付费了却先比牌」等怪状态。
 */
export function canPayGateWithReserve(resource: number, fee: number, reserve = GATE_RESOURCE_RESERVE): boolean {
  return resource - fee >= reserve;
}

/** 关隘操作结果。 */
export interface GateResult {
  readonly ok: boolean;
  readonly state: State;
  /** 是否通过（false = 停留/失败） */
  readonly passed: boolean;
  readonly note?: string;
}

function fail(state: State, passed: boolean, note: string): GateResult {
  return { ok: false, state, passed, note };
}

/** 玩家是否已通过该关隘（用 flags 记录 `gate_<index>`）。 */
export function hasPassedGate(state: State, seat: number, gateIndex: number): boolean {
  return state.players[seat]?.flags[`gate_${gateIndex}`] === true;
}

/**
 * 付费通道（§3.5）。
 * 支付 `tile.gate.fee` 灵枢即通过；灵枢不足则失败（状态不变）。
 */
export function payGate(state: State, actor: number, tile: Tile): GateResult {
  const fee = tile.gate?.fee;
  if (fee === undefined) { return fail(state, false, '此格不是关隘'); }
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  if (p.resource < fee) {
    return fail(state, false, `灵枢不足：关隘标价 ${fee}，现有 ${p.resource}`);
  }
  const players = state.players.map((x) =>
    x.seat === actor
      ? { ...x, resource: x.resource - fee, flags: { ...x.flags, [`gate_${tile.index}`]: true } }
      : x,
  );
  const next: State = { ...state, players };
  return { ok: true, state: next, passed: true, note: `支付 ${fee} 灵枢通过关隘` };
}

/**
 * 试炼通道（§3.5）。
 * 从 `decks.trial` 抽一张试炼牌；已通过同座关隘的试炼牌不再抽取。
 * 试炼牌的效果由 `effects` 表达；本次只负责抽牌与记录。
 */
export function drawTrial(state: State, actor: number, tile: Tile): GateResult {
  const trialIds = tile.gate?.trialIds;
  if (trialIds === undefined) { return fail(state, false, '此格不是关隘'); }
  const pool = state.decks.trial.filter((t) => trialIds.includes(t.id));
  if (pool.length === 0) { return fail(state, false, '无可用试炼牌'); }
  const idx = Math.floor(state.rng.next() * pool.length);
  const trial = pool[idx];
  if (trial === undefined) { return fail(state, false, '试炼牌抽取失败'); }
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  const players = state.players.map((x) =>
    x.seat === actor
      ? { ...x, flags: { ...x.flags, [`trial_${tile.index}`]: trial.id } }
      : x,
  );
  const next: State = { ...state, players };
  return { ok: true, state: next, passed: true, note: `试炼牌：${trial.text}` };
}

/**
 * 玩家当前是否停在**未通过**的关隘格上（⇒ 需要选择通过通道，规格 §3.5 B18 定案）。
 *
 * ⚠️ 状态**由位置与 flags 推导**，不新增 State 字段（§6.2 契约不必变更）。
 */
export function pendingGate(state: State, seat: number): Tile | null {
  const p = state.players[seat];
  if (p === undefined || !p.alive) { return null; }
  const tile = state.board.tiles.find((t) => t.index === p.position);
  if (tile === undefined || tile.kind !== 'gate') { return null; }
  if (hasPassedGate(state, seat, tile.index)) { return null; }
  // ⚠️ B19-b：已判「未通过并放行」⇒ 不再把玩家留在这座关隘上。
  if (p.flags[`gate_fail_${tile.index}`] === true) { return null; }
  return tile;
}

/**
 * 试炼通道（规格 §3.5 B18 定案 2/3）：**公开抽牌 → 掷一次 20 面指令骰 → 执行效果树**。
 *
 * ⚠️ B19-b：**通过标记由本函数按结果写**（`drawTrial` 不再直接写 `gate_<index>`）——
 *   因为试炼**可能失败**：效果树里若执行了 `gate_fallback_pay`（失败 ⇒ 本关改为付费），
 *   则本次试炼**未通过** ⇒ 不能打通过标记。
 *
 * ⚠️ 试炼的**判定与后果完全由主题包数据表达**（`trials[].effects` + 谓词），
 *   引擎**不硬编码任何试炼文案**——引擎只负责掷骰（供 `dice_is_at_least` 取值）与执行效果树。
 */
function trialChannel(state: State, actor: number, tile: Tile): GateResult {
  const drawn = drawTrial(state, actor, tile);
  if (!drawn.ok) { return drawn; }
  let next = drawn.state;
  const trialId = next.players[actor]?.flags[`trial_${tile.index}`];
  const trial = next.decks.trial.find((t) => t.id === trialId);
  if (trial === undefined) {
    return { ok: true, state: next, passed: true, note: '试炼牌已抽取' };
  }
  // 掷一次 20 面指令骰（供 dice_is_at_least 谓词取值；规格 §3.5 B18 定案 3）
  const face = rollD20(next.rng);
  next = { ...next, lastDice: face };
  // 执行效果树（成功/失败后果由主题包数据决定）
  for (const eff of trial.effects) {
    next = applyEffectToState({ state: next, actor }, eff);
  }
  // ⚠️ B18-c：**试炼发的牌当场裁到手牌上限**。
  //   理由：试炼通道发生在**手番结算之后**（结算期的通道选择），而手番末的裁牌
  //   （`finishTurn`）已经跑完 ⇒ 试炼发的牌会留在手上超限；
  //   而回合末裁牌又会被「通道选择阻塞」延后（末位手番的玩家还卡在关隘上，回合末本就还没到）
  //   ⇒ 两者都救不了。实测：24000 局 3 条「终局 手牌超上限」，超限者**全部停在关隘格**、
  //   且只超 1 张牌 ⇒ 正是试炼牌「本关通过后抽 1 张」的效果。
  //   （与 `openHeaven` 的「天机牌发的牌立即裁」同款处理。）
  next = discardDownToLimit(next, actor);
  // ⚠️ B19-b：**试炼失败判定** —— 效果树执行了 `gate_fallback_pay` ⇒ 本关改为付费。
  const fallback = next.players[actor]?.flags[`gate_pay_${tile.index}`] === true;
  next = {
    ...next,
    log: [...next.log, {
      round: next.round, turnIndex: next.turnIndex, actor, kind: 'trial',
      message: fallback
        ? `关隘试炼：${trial.text}——未通过，本关改为付费`
        : `关隘试炼：${trial.text}`,
      diceRoll: face,
      // ⚠️ B23：**结构化字段** ⇒ 平衡模拟可直接统计每张试炼牌的通过率（不必解析文案）。
      trialId: trial.id,
      trialPassed: !fallback,
    }],
  };
  if (fallback) {
    // 试炼未通过 ⇒ **不打通过标记**（玩家仍停在关隘，但此后只保留付费通道）。
    return { ok: true, state: next, passed: false, note: '试炼未通过：本关改为付费' };
  }
  return passGate(next, actor, tile, `试炼通过：${trial.text}`);
}

/**
 * 关隘通道选择（规格 §3.5 B18 定案）：
 *   · `pay`   —— 付费通道：付该格标价（3–5 灵枢）立即通过；灵枢不足 ⇒ 引擎拒绝。
 *   · `trial` —— 试炼通道：公开抽一张试炼牌并执行其效果树 ⇒ 通过。
 *
 * ⚠️ 两条通道都是「通过」——失败后果由试炼牌的效果树表达（主题包数据）。
 */
export function resolveGate(state: State, actor: number, channel: 'pay' | 'trial'): GateResult {
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  const tile = pendingGate(state, actor);
  if (tile === null) { return fail(state, false, '当前不在未通过的关隘格上'); }
  // ⚠️ B24：**本关已改为付费**（试炼失败后）⇒ 引擎层**拒绝**再走试炼通道。
  //   粗筛（legal.ts）早已只发 `pay`，但引擎层不拒 ⇒ 脚本/测试可绕过粗筛重复试炼。
  if (channel === 'trial' && p.flags[`gate_pay_${tile.index}`] === true) {
    return fail(state, false, '本关已改为付费（试炼失败后），不能再走试炼通道');
  }
  if (channel === 'pay') {
    const fee = tile.gate?.fee ?? 0;
    const mine = p.resource;
    const fallback = p.flags[`gate_pay_${tile.index}`] === true;
    if (mine < fee) {
      if (!fallback) {
        return fail(state, false, `灵枢不足：关隘标价 ${fee}，现有 ${mine}`);
      }
      // ⚠️ B19-b：本关**已改为付费**却仍付不起 ⇒ 判「未通过并放行」
      //   （否则玩家会永远卡在这座关隘上 —— 无出路即死循环）。
      return failGate(state, actor, tile, '本关已改为付费，但灵枢不足 ⇒ 判未通过');
    }
    return payGate(state, actor, tile);
  }
  return trialChannel(state, actor, tile);
}

/**
 * 关隘**出牌比对**通道（规格 §3.5，B18 定案 4 = 候选 A；B19 实现）。
 *
 * ⚠️ 规则口径（B19 裁定）：
 *   · **我出一张牌** vs **目标玩家的手牌顶**（**明牌**：对方的牌面公开）；
 *   · 比法与对峙同款（§3.3）：先比颜色（红 > 黑）→ 同色比点数（`rank`，A=14 最大）；
 *   · **胜** ⇒ 通过关隘；**败或平局** ⇒ 退 1 格并被封口（`silence` +1）；
 *   · **我方手牌为空** ⇒ 无牌可出（动作被拒）；**对方手牌为空** ⇒ 自动胜出（直接通过）；
 *   · **出牌即弃**（无论胜负，我方那张牌离手）。
 *
 * ⚠️ 为什么「对方手牌顶」是**明牌**：关隘是**公开的硬门槛**，比牌结果要当场公开；
 *   而对峙是**隐藏信息**流程（双方各自选牌、同时揭晓）—— 两者不可混用。
 */
export function resolveCompareGate(
  state: State,
  actor: number,
  cardId: string,
  target: number,
): GateResult {
  const p = state.players[actor];
  if (p === undefined) { return fail(state, false, '玩家不存在'); }
  const tile = pendingGate(state, actor);
  if (tile === null) { return fail(state, false, '当前不在未通过的关隘格上'); }
  if (target === actor) { return fail(state, false, '不能与自己比对'); }
  // ⚠️ B24：**本关已改为付费**（试炼失败后）⇒ 只剩付费通道 ⇒ 引擎层**拒绝**出牌比对。
  if (p.flags[`gate_pay_${tile.index}`] === true) {
    return fail(state, false, '本关已改为付费（试炼失败后），不能再走出牌比对通道');
  }
  const other = state.players[target];
  if (other === undefined) { return fail(state, false, '目标不存在'); }
  if (!other.alive) { return fail(state, false, '目标已出局'); }
  const myCard = p.hand.find((c) => c.id === cardId);
  if (myCard === undefined) { return fail(state, false, `手牌中无 ${cardId}`); }
  // 出牌即弃（无论胜负）。
  let next: State = {
    ...state,
    players: state.players.map((x) =>
      x.seat === actor ? { ...x, hand: x.hand.filter((c) => c.id !== cardId) } : x),
  };
  const theirCard = other.hand[0];
  if (theirCard === undefined) {
    // 对方手牌为空 ⇒ 自动胜出（与对峙「任一方空手 ⇒ 自动落败」同款，但方向相反）。
    const passed = passGate(next, actor, tile, '对方手牌为空，自动胜出');
    return passed;
  }
  const outcome = compareCards(myCard, theirCard);
  if (outcome === 'a') {
    const passed = passGate(next, actor, tile, `比牌胜出（${myCard.name} > ${theirCard.name}）`);
    return passed;
  }
  // 败 / 平局 ⇒ 退 1 格并被封口。
  // ⚠️ 退格用**显式实现**（与对峙 `duel.pushBack` 同款）—— 不走 `move_backward` 算子：
  //   该算子的 target 语义是「被移动的玩家」，实测按预期传参**未生效** ⇒ 显式更可控。
  next = {
    ...next,
    players: next.players.map((x) =>
      x.seat === actor ? { ...x, position: Math.max(1, x.position - 1) } : x),
  };
  next = applyEffectToState({ state: next, actor }, { op: 'silence', amount: 1, target: actor });
  next = {
    ...next,
    log: [...next.log, {
      round: next.round, turnIndex: next.turnIndex, actor, kind: 'gate',
      message: outcome === 'b'
        ? `比牌败北（${myCard.name} < ${theirCard.name}）—— 退 1 格并被封口`
        : `比牌平局（${myCard.name} = ${theirCard.name}）—— 退 1 格并被封口`,
    }],
  };
  return { ok: true, state: next, passed: false, note: '比牌未胜：退 1 格并被封口' };
}

/**
 * 标记关隘已通过（写 `gate_<index>` 标记并留日志）。
 */
/**
 * 判「未通过并放行」：退 1 格 + 被封口 + 写 `gate_fail_<index>` 标记
 * （该标记让 `pendingGate` 不再把玩家留在这座关隘上 —— 否则没有出路 ⇒ 死循环）。
 */
function failGate(state: State, actor: number, tile: Tile, note: string): GateResult {
  let next: State = {
    ...state,
    players: state.players.map((x) =>
      x.seat === actor
        ? { ...x, position: Math.max(1, x.position - 1), flags: { ...x.flags, [`gate_fail_${tile.index}`]: true } }
        : x),
  };
  next = applyEffectToState({ state: next, actor }, { op: 'silence', amount: 1, target: actor });
  next = {
    ...next,
    log: [...next.log, {
      round: next.round, turnIndex: next.turnIndex, actor, kind: 'gate',
      message: `关隘：${note}——退 1 格并被封口`,
    }],
  };
  return { ok: true, state: next, passed: false, note };
}

/**
 * 标记关隘已通过（写 `gate_<index>` 标记并留日志）。
 */
function passGate(state: State, actor: number, tile: Tile, note: string): GateResult {
  const next: State = {
    ...state,
    players: state.players.map((x) =>
      x.seat === actor ? { ...x, flags: { ...x.flags, [`gate_${tile.index}`]: true } } : x),
    log: [...state.log, {
      round: state.round, turnIndex: state.turnIndex, actor, kind: 'gate',
      message: `关隘：${note}`,
    }],
  };
  return { ok: true, state: next, passed: true, note };
}

/**
 * **自动解算关隘**（供 AI / 脚本等自行驱动对局的调用方使用）。
 *
 * ⚠️ 为什么必须提供这个出口：**关隘会阻塞回合推进**（与对峙同款）——
 *   任何自己驱动对局的调用方（模拟器、测试、教学脚本）不处理它就会**静默卡死**
 *   （B13 对峙的同款教训：会阻塞流程的机制，必须在引擎层给所有调用方一个统一出口）。
 *
 * 策略：**灵枢够就付费，否则走试炼**（与玩家策略同款）。
 */
/**
 * @param reserve 余量门槛（默认 `GATE_RESOURCE_RESERVE`）—— 可注入 ⇒ 余量阈值扫描走**同一条生产路径**。
 */
export function autoResolveGate(state: State, seat: number, reserve = GATE_RESOURCE_RESERVE): State {
  const tile = pendingGate(state, seat);
  if (tile === null) { return state; }
  const p = state.players[seat];
  const fee = tile.gate?.fee ?? 0;
  // ⚠️ B22：**已转为付费**（试炼失败后）⇒ 只能走付费通道；付不起时 resolveGate('pay')
  //   会判「未通过并放行」⇒ 否则 AI 会反复试炼同一张失败牌 ⇒ **死循环**（实测：超 584 步）。
  const fallback = p !== undefined && p.flags[`gate_pay_${tile.index}`] === true;
  // ⚠️ B24：**付费后仍要留有余量**才付费 ⇒ 否则走试炼（博一把：通过有额外收益，失败则改为付费）。
  //   fallback 分支仍必须走 pay（否则又回到 B22 的死循环）。
  const channel = fallback ? 'pay'
    : (canPayGateWithReserve(p?.resource ?? 0, fee, reserve) ? 'pay' : 'trial');
  const r = resolveGate(state, seat, channel);
  return r.ok ? r.state : state;
}
