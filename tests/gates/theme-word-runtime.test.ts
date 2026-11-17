// B79 R3：句子层主题词的**运行时**取证（T9 起，T10/T11/T12/T14 逐段追加）。
//
// ⚠️ 为什么不能只写源码断言（E135）：占位符住在被调用的实现里时，「源码不含主题词」这条
//   会当场通过——它测的是字面量搬走了没有，不是玩家真正看到什么。所以这里让算子**真的跑**，
//   再看写进 log 的那句话与返回的 note。
//
// ⚠️ 判据形状：**本主题之外的叶词取值**不许出现在引擎文本里。引擎只报机制事实 + `{leaf}`，
//   取词归渲染层（B79 Q1 乙）。每条守卫都带「防空转」断言：取到的文本条数不够就判红，
//   免得判据悄悄退化成本来就通过的空集。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyEffect } from '../../engine/ops/registry.ts';
import { installTheme } from '../../engine/core/setup.ts';
import { mk } from '../engine/fixtures.ts';
import type { State } from '../../engine/core/state.ts';

const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];
const themeOf = (id: string): any => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8'));
/**
 * 四套主题五个叶词的**并集**（R1 源码禁字表用的就是它）。
 *
 * `noUncheckedIndexedAccess` 下 `t[k]` 是 `string | undefined` ⇒ 显式收窄（叶子的齐备性
 * 由门 ⑤ 与 `tests/gates/theme-leaf-upgrade.test.ts` 保证，不在这里再兜一次值）。
 * ⚠️ 运行时守卫**不拿并集当判据**，用下面的 `foreignWords`。
 */
const LEAF_WORDS = [...new Set(IDS.flatMap((id) => {
  const t = themeOf(id).terms as Record<string, string | undefined>;
  return ['resource', 'gate', 'path', 'peak', 'hp']
    .map((k) => t[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}))];

/** 本主题自己的五个叶词。 */
function ownWords(id: string): Set<string> {
  const t = themeOf(id).terms as Record<string, string | undefined>;
  return new Set(['resource', 'gate', 'path', 'peak', 'hp']
    .map((k) => t[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0));
}

/**
 * 某套主题局里的「别套词」= 并集 − 本套五叶（B79 §5 R3 的取词口径）。
 *
 * 运行时**必须按当前主题取词**：引擎会把主题数据回显进日志——实测仙侠局里出现
 * `封口弃牌：座位 0（弃 灵枢符）`，「灵枢」是**它自己那张牌的名字**，完全合法。
 * 拿全局并集判就会把这种本套合规文本判成泄漏（评审那一轮纠正过的正是这个形状）。
 * 「引擎不许持有本主题的词」由 R1（源码零字面量）+ 每段的占位符存在断言负责，
 * 「别套的词不许串进来」由这里负责——两条判据合起来才闭合。
 */
function foreignWords(id: string): string[] {
  const own = ownWords(id);
  return LEAF_WORDS.filter((w) => !own.has(w));
}

/** 引擎文本 = 返回值 note + 新写进 log 的行（note 也会被 gate.ts 一类插进 message，见 B79 §4.3）。 */
function textsOf(r: { ok?: boolean; state: State; note?: unknown }, beforeLogLen: number): string[] {
  const out: string[] = [];
  if (typeof r.note === 'string') { out.push(r.note); }
  for (const e of r.state.log.slice(beforeLogLen)) { out.push(e.message); }
  return out;
}

test('B79：资源算子的日志与拒因不含任何主题叶词（接线后必须是占位符形态）', () => {
  // 禁字表本身不许悄悄变短（收窄那一步若把某个叶滤掉，判据就会空转）：五叶 × 四套今天全不同 = 20
  assert.equal(LEAF_WORDS.length, 20, `禁字表只有 ${String(LEAF_WORDS.length)} 词：${LEAF_WORDS.join('/')}`);
  let checked = 0;
  for (const id of IDS) {
    let state = installTheme(mk(4, 20260), themeOf(id));
    const effects = [
      { op: 'gain_resource', amount: 1 },
      { op: 'spend_resource', amount: 99 },      // 不足 ⇒ 走 fail 的 note
      { op: 'transfer_resource', amount: 1, target: 1 },
      { op: 'set_resource', amount: 5 },
    ];
    for (const effect of effects) {
      const before = state.log.length;
      const r = applyEffect({ state, actor: 0 }, effect as never);
      const texts = textsOf(r, before);
      state = r.state;
      for (const text of texts) {
        checked += 1;
        for (const w of foreignWords(id)) {
          assert.equal(text.includes(w), false,
            `${id}：算子文本「${text}」含**别套**主题词「${w}」（本套词由 R1 与占位符断言负责）`);
        }
      }
    }
  }
  assert.equal(checked, IDS.length * 4,
    `取到 ${String(checked)} 条文本，预期 ${String(IDS.length * 4)} 条（每算子一条：ok ⇒ 一行 log，fail ⇒ 一条 note）`
    + ' ⇒ 判据形状变了，先查清楚再放行');
});

test('B79 前提：确实取到了资源算子的文本，且四条全是占位符形态（防空转 + 接线的正面证据）', () => {
  let state = installTheme(mk(4, 20260), themeOf('xianxia2026'));
  const got: string[] = [];
  for (const effect of [{ op: 'gain_resource', amount: 1 }, { op: 'spend_resource', amount: 99 },
    { op: 'transfer_resource', amount: 1, target: 1 }, { op: 'set_resource', amount: 5 }]) {
    const before = state.log.length;
    const r = applyEffect({ state, actor: 0 }, effect as never);
    got.push(...textsOf(r, before));
    state = r.state;
  }
  // 实测形状：ok 的算子各写一行 log（gain/transfer/set），fail 的只给 note（spend 不足）⇒ 共 4 条。
  assert.equal(got.length, 4, `只取到 ${String(got.length)} 条 ⇒ 判据会空转或形状已变：${JSON.stringify(got)}`);
  const withToken = got.filter((x) => x.includes('{resource}'));
  assert.equal(withToken.length, 4,
    `只有 ${String(withToken.length)}/4 条带 {resource} ⇒ 接线未生效：${JSON.stringify(got)}`);
});

test('B79 负样本的负样本：gate_fallback_pay 的开发者可见串也走占位符（:707 号{gate}）', () => {
  // 这一条同时钉住共享子串：`本关改为付费` 六个字不许动（B79 §5.3，规则书与引擎同源）。
  const theme = themeOf('scifi-ai');
  let state = installTheme(mk(4, 20260), theme);
  const gateIdx = state.board.tiles.find((t) => t.kind === 'gate')?.index ?? 0;
  state = { ...state, players: state.players.map((p) => p.seat === 0 ? { ...p, position: gateIdx } : p) };
  const before = state.log.length;
  const r = applyEffect({ state, actor: 0 }, { op: 'gate_fallback_pay', tileIndex: gateIdx } as never);
  const texts = textsOf(r, before);
  const line = texts.find((x) => x.includes('本关改为付费'));
  if (line === undefined) { assert.fail(`没取到「本关改为付费」那条：${JSON.stringify(texts)}`); }
  // assert.fail 返回 never ⇒ 下面这一行拿到的是已收窄的 string（assert.ok 不做类型收窄）
  assert.ok(line.includes('本关改为付费'), '⇒ 共享子串被改动（§5.3 红线）');
  assert.equal(/号(关隘|阵门|安全闸|封锁线)/.test(line), false, `「N 号关隘」仍写死主题词：${line}`);
  assert.ok(/\{gate\}/.test(line), `名词位没接占位符：${line}`);
});

// ---------- T10：关隘（gate.ts 12 行）----------
//
// 三条通道 + 两条「不是关隘格」的拒绝 + 「已转付费却资源不足」那条 ⇒ 12 行全覆盖。
// 资源与 flags 直接摆在测试构造的状态上（本守卫判的是**文案**，不是机制；机制归
// tests/engine/gate.test.ts 与门⑨）。
import { payGate, drawTrial, resolveGate, resolveCompareGate } from '../../engine/core/gate.ts';

/** 把座 0 放到第一座关隘上（可选：预置「已转付费」标记与资源额）。 */
function atGate(state: State, resource: number, payOnly = false): State {
  const tile = state.board.tiles.find((t) => t.kind === 'gate');
  assert.ok(tile !== undefined, '前提：棋盘上要有关隘格');
  return {
    ...state,
    players: state.players.map((p) => p.seat === 0
      ? { ...p, position: tile.index, resource, flags: payOnly ? { ...p.flags, [`gate_pay_${tile.index}`]: true } : p.flags }
      : p),
  };
}

function gateTexts(id: string, seed: number): string[] {
  const out: string[] = [];
  const base = installTheme(mk(4, seed), themeOf(id));
  const nonGate = base.board.tiles.find((t) => t.kind !== 'gate');
  assert.ok(nonGate !== undefined, '前提：棋盘上也要有非关隘格');
  const runs: Array<() => { state: State; note?: unknown }> = [
    () => payGate(atGate(base, 0), 0, base.board.tiles.find((t) => t.kind === 'gate')!),   // 资源不足
    () => payGate(atGate(base, 99), 0, base.board.tiles.find((t) => t.kind === 'gate')!),   // 付得起
    () => payGate(base, 0, nonGate),                                                        // 此格不是关隘
    () => drawTrial(base, 0, nonGate),                                                      // 同上，试炼侧
    () => resolveGate(atGate(base, 0), 0, 'trial'),                                         // 试炼：过与不过都在这条里
    () => resolveGate(atGate(base, 0, true), 0, 'pay'),                                     // 已转付费却不足
    () => resolveGate(atGate(base, 99, true), 0, 'pay'),                                    // 已转付费且付得起
    () => resolveCompareGate(atGate(base, 99), 0, 'no-such-card', 1),                        // 出牌比对侧的守门文案
  ];
  for (const run of runs) {
    const before = base.log.length;
    const r = run();
    out.push(...textsOf({ state: r.state, note: r.note }, before));
  }
  return out;
}

test('B79：关隘三通道与拒绝分支的 note/日志不含任何主题叶词', () => {
  const counts = new Map<string, number>();
  let checked = 0;
  for (const seed of [20260, 20261, 20262]) {
    for (const id of IDS) {
      const texts = gateTexts(id, seed);
      counts.set(`${id}/${String(seed)}`, texts.length);
      for (const text of texts) {
        checked += 1;
        for (const w of foreignWords(id)) {
          assert.equal(text.includes(w), false, `${id}/seed=${String(seed)}：「${text}」含别套词「${w}」`);
        }
      }
    }
  }
  // 不变量一：**同 seed 下四套的文本条数必须相同**（RNG 与主题无关 ⇒ 条数漂了就说明
  //   某套走了一条别套没走的路径，那才是真正的行为差异信号）。实测每套每 seed = 15 条。
  for (const seed of [20260, 20261, 20262]) {
    const per = IDS.map((id) => counts.get(`${id}/${String(seed)}`));
    assert.equal(new Set(per).size, 1, `seed=${String(seed)} 四套文本条数不同：${per.join(',')} ⇒ 分支覆盖不再同构`);
  }
  // 不变量二：总条数钉死（8 次调用中 resolveGate('trial') 会连带写出试炼/抽牌/封口等行 ⇒ 15/套/seed）。
  assert.equal(checked, IDS.length * 3 * 15,
    `取到 ${String(checked)} 条，预期 ${String(IDS.length * 3 * 15)} 条 ⇒ 判据形状变了，先查清楚再放行`);
});

test('B79 前提：关隘文案里确实有「退 1 格并被封口」那条日志（failGate 的 note 会进 message，§4.3）', () => {
  const got = gateTexts('xianxia2026', 20260);
  const withToken = got.filter((x) => /\{gate\}/.test(x));
  assert.ok(withToken.length >= 4, `带 {gate} 的只有 ${String(withToken.length)} 条 ⇒ 接线未生效：${JSON.stringify(got)}`);
  assert.ok(got.some((x) => x.includes('退 1 格并被封口')), '⇒ 没跑到 failGate，判据覆盖面不足');
  assert.ok(got.some((x) => x.includes('本关改为付费')), '⇒ 没跑试炼失败分支，210 行那条没被覆盖');
});

// ---------- T11：认证 / 被动 / 裂隙 / 山议 / 开发者串 ----------
//
// ⚠️ 修正 #4 命中处：计划写的 `certifyAppeal(s, 0)` 少一个参数，真实签名是
//   `(state, actor, target)`（复议由待认证者本人发起 ⇒ target === actor）。
//   按真实签名改**调用**，断言一字未放宽。
import { certifyChallenge, certifyAppeal, certifySign, advanceCertificationRound } from '../../engine/core/certification.ts';
import { resolveBarrier } from '../../engine/core/barrier.ts';
import { performAbility } from '../../engine/core/abilities.ts';
import { openCouncil, castVote, resolveCouncil } from '../../engine/core/council.ts';
import { putPending } from '../engine/fixtures.ts';
import { actionFromKey } from '../../engine/core/action-key.ts';

const resState = (s: State, seat: number, resource: number): State => ({
  ...s,
  players: s.players.map((p) => (p.seat === seat ? { ...p, resource } : p)),
});

/** 认证相关：质疑（不足 / 成功）、复议（不足 / 成功）、达成与两轮未达成的两句 `{path}`。 */
function certificationTexts(id: string): string[] {
  const out: string[] = [];
  const run = (r: { state: State; note?: unknown }, before: number) => out.push(...textsOf(r, before));
  const base = installTheme(mk(5, 20260), themeOf(id));
  const pending = putPending(base, [0]);

  run(certifyChallenge(resState(pending, 1, 0), 1, 0), pending.log.length);      // :158 不足
  run(certifyChallenge(resState(pending, 1, 5), 1, 0), pending.log.length);      // :180 成功

  const judged = certifyChallenge(resState(pending, 1, 5), 1, 0).state;
  run(certifyAppeal(resState(judged, 0, 0), 0, 0), judged.log.length);           // :271 不足
  run(certifyAppeal(resState(judged, 0, 5), 0, 0), judged.log.length);           // :275 成功

  // 达成 ⇒「回到{path}起点」（凑够签印数：门槛由 scales 决定，逐个签到人）
  let signed = putPending(base, [0]);
  for (const seat of signed.players.map((p) => p.seat)) {
    if (seat === 0) { continue; }
    signed = certifySign(signed, seat, 0).state;
  }
  run(advanceCertificationRound(signed), signed.log.length);                     // :453

  // 两轮未达成 ⇒「退回{path} 60% 位置」
  const noneSigned = putPending(base, [0]);
  const r1 = advanceCertificationRound(noneSigned);
  run(advanceCertificationRound(r1.state), r1.state.log.length);                 // :469
  return out;
}

/** 裂隙放印（:111 日志 + :114 note）、身份被动窃火（:61/:66/:75）、3 人局山议裁定（:156）。 */
function otherTexts(id: string): string[] {
  const out: string[] = [];
  const base = installTheme(mk(4, 20260), themeOf(id));

  const rift = base.board.tiles.find((t) => t.kind === 'rift');
  if (rift !== undefined) {
    const s: State = { ...base, players: base.players.map((p) => (p.seat === 0 ? { ...p, position: rift.index, resource: 9 } : p)) };
    const before = s.log.length;
    out.push(...textsOf(resolveBarrier(s, 0, 'place'), before));                 // :111 / :114
  }

  // 窃火者型被动：真实形状是 `player.flags.passive`（passiveOf 就读它，身份 id 不参与发动）
  // ⇒ 沿用 passive-abilities / exhaustion 的 withPassive 先例，不另发明一套挂载法。
  const withPassive = (st: State, seat: number, passive: unknown): State => ({
    ...st,
    players: st.players.map((p) => (p.seat === seat ? { ...p, flags: { ...p.flags, passive } } : p)),
  });
  const emberState = withPassive(base, 0, { op: 'transfer_resource', amount: 1 });
  out.push(String(performAbility(emberState, 0).note ?? ''));                     // :61
  const poor = { ...emberState, players: emberState.players.map((p) => (p.seat === 1 ? { ...p, resource: 0 } : p)) };
  out.push(String(performAbility(poor, 0, 1).note ?? ''));                        // :66
  const rich = { ...emberState, players: emberState.players.map((p) => (p.seat === 1 ? { ...p, resource: 9 } : p)) };
  const steal = performAbility(rich, 0, 1);
  out.push(String(steal.note ?? ''));                                             // :75
  out.push(...textsOf(steal, rich.log.length));

  // 3 人局山议 ⇒ 扣资源不淘汰
  const three = installTheme(mk(3, 20261), themeOf(id));
  const opened = openCouncil(three);
  if (opened.ok) {
    let st = opened.state;
    st = castVote(st, 0, 1).state;
    st = castVote(st, 1, 2).state;
    st = castVote(st, 2, 1).state;
    const before = st.log.length;
    const r = resolveCouncil(st);
    out.push(...textsOf(r, before));                                              // :156
  }
  return out.filter((x) => x !== '');
}

test('B79：认证/裂隙/被动/山议的 note 与日志不含别套主题叶词', () => {
  let checked = 0;
  for (const id of IDS) {
    for (const text of [...certificationTexts(id), ...otherTexts(id)]) {
      checked += 1;
      for (const w of foreignWords(id)) {
        assert.equal(text.includes(w), false, `${id}：「${text}」含别套词「${w}」`);
      }
    }
  }
  assert.ok(checked >= IDS.length * 8, `只取到 ${String(checked)} 条 ⇒ 判据会空转`);
});

test('B79 前提：14 行的占位符各自到位（{resource} / {path} 都真的出现在文本里）', () => {
  const got = [...certificationTexts('urban-psych'), ...otherTexts('urban-psych')];
  const has = (token: string) => got.filter((x) => x.includes(token)).length;
  assert.ok(has('{resource}') >= 4, `{resource} 只出现 ${String(has('{resource}'))} 次（质疑/复议/偷取/山议至少各一）：${JSON.stringify(got)}`);
  assert.ok(has('{path}') >= 2, `{path} 只出现 ${String(has('{path}'))} 次（:453 与 :469）`);
  assert.ok(got.some((x) => x.includes('回到{path}起点')), '⇒ :453 未覆盖');
  assert.ok(got.some((x) => x.includes('退回{path} 60% 位置')), '⇒ :469 未覆盖');
});

test('B79：action-key 的开发者串改机制标识——不用占位符、也不含任何主题词（§2.1）', () => {
  // 这条不进玩家眼睛：主题化只会让查 bug 的人对不上代码 ⇒ 判据是「既无叶词、也无占位符」。
  // 抛错点在**解码**侧（actionFromKey 的 gate:resolve 分支），不在编码侧 ⇒ 按计划的位置取真实函数。
  const bad = () => { try { actionFromKey('gate:resolve:xyz'); } catch (e) { return String((e as Error).message); } return ''; };
  const msg = bad();
  assert.ok(msg.length > 0, '前提：非法通道必须抛错');
  assert.ok(msg.includes('gate 通道非法'), `实际消息：${msg}`);
  for (const w of LEAF_WORDS) { assert.equal(msg.includes(w), false, `开发者串含主题词「${w}」：${msg}`); }
  assert.equal(msg.includes('{'), false, `开发者串不该用占位符（没有出口会展开它）：${msg}`);
});

// ---------- T12：UI 拒因（web/legal-gate.ts 8 行）+ B65-M3 变异夹具逐字串 ----------
//
// `uiBlockNotice` 拿不到 terms（§4.3 已定：不改签名、不注入词表）⇒ 它交出去的就是
// **占位符形态**，由 notice 出口展开。所以这里的判据是「不含别套词 + 含占位符」两半，
// 而「玩家看到的仍点名资源不足」由 card-cost.test.ts 的 B65/A-5b 正面钉。
import { uiBlockNotice } from '../../web/legal-gate.ts';
import { getLegalActions } from '../../engine/core/legal.ts';
import { activeAbilityId } from '../../engine/core/passives.ts';

test('B79：UI 拒因全是占位符形态，不含任何主题叶词（含 `{hp}` 以外的五叶按套判）', () => {
  let checked = 0;
  for (const id of IDS) {
    const theme = themeOf(id);
    const state = installTheme(mk(4, 20260), theme);
    // 资源清零 ⇒ 所有带成本前置的分支都会给出拒因（自恢/救援/出牌/质疑/复议/关隘两条）
    const poor: State = { ...state, players: state.players.map((p) => ({ ...p, resource: 0 })) };
    const texts: string[] = [];
    for (const a of getLegalActions(poor, 0).concat(mirrorActions(poor))) {
      const n = uiBlockNotice(poor, 0, a);
      if (typeof n === 'string') { texts.push(n); }
    }
    // 直接按动作类型构造一批候选（粗筛放行与否不影响这里：uiBlockNotice 是逐条判据）
    for (const t of texts) {
      checked += 1;
      for (const w of foreignWords(id)) {
        assert.equal(t.includes(w), false, `${id}：UI 拒因「${t}」含别套词「${w}」`);
      }
    }
    if (checked > 0) {
      assert.ok(texts.some((t) => /\{resource\}/.test(t)) || texts.length === 0,
        `${id}：一批拒因里没有任何 {resource} ⇒ 出牌/质疑/复议三条没被覆盖：${JSON.stringify(texts)}`);
    }
  }
  assert.ok(checked >= IDS.length * 2, `只取到 ${String(checked)} 条拒因 ⇒ 判据会空转`);
});

/** 手工摆一批动作给 uiBlockNotice（它的判据按 action.type 分支，与粗筛是否放行无关）。 */
function mirrorActions(state: State): Array<Parameters<typeof uiBlockNotice>[2]> {
  const hand = state.players[0]?.hand ?? [];
  const cardId = hand[0]?.id ?? 'c_none';
  const acts: Array<Parameters<typeof uiBlockNotice>[2]> = [
    { type: 'PLAY_CARD', actor: 0, cardId },
    { type: 'CERTIFY_CHALLENGE', actor: 1, target: 0 },
    { type: 'CERTIFY_APPEAL', actor: 0, target: 0 },
    { type: 'GATE_RESOLVE', actor: 0, channel: 'pay' },
    { type: 'COMPARE', actor: 0, cardId, target: 1 },
    { type: 'RECUPERATE', actor: 0 },
    { type: 'ABILITY', actor: 0, abilityId: activeAbilityId(state, 0) },
  ];
  return acts;
}

test('B79：M3 变异夹具的 before 串必须逐字等于 legal-gate.ts 的当前行', () => {
  // 为什么要这条：patchCopy 靠**逐字串匹配**改源码。接线后形状变了，而夹具不跟着改就
  // 「找不到模式 ⇒ 什么都没改 ⇒ mutant 代码 ≡ 原代码 ⇒ r.code === 0 ⇒ M3 假绿」——
  // 那是变异自证自己骗自己。这里把失败提前到施工当天，且**不在本文件写模板串**
  // （`${}` 在源码里会被当真，写了就变成测我自己的字符串而不是测夹具）。
  const fixture = readFileSync('tests/engine/card-cost.test.ts', 'utf8');
  const anchor = "patchCopy(dir, 'web/legal-gate.ts',";
  const at = fixture.indexOf(anchor);
  assert.ok(at > 0, '前提：M3 夹具要住在 card-cost.test.ts 里');
  const line = fixture.slice(at + anchor.length).split('\n').map((x) => x.trim()).filter((x) => x !== '')[0] ?? '';
  assert.ok(line.startsWith('"') && (line.endsWith('";') || line.endsWith('",') || line.endsWith('"')),
    `前提：before 串是双引号字面量，实际取到的是：${line.slice(0, 40)}`);
  const raw = line.replace(/[;,]\s*$/, '');
  const before = JSON.parse(raw) as string;
  const src = readFileSync('web/legal-gate.ts', 'utf8');
  assert.ok(src.includes(before),
    `M3 的 before 串已对不上源码 ⇒ 变异会静默空跑。夹具里是：${before.slice(0, 60)}`);
  // 反向也要成立：源码里那句出牌拒因确实已经是占位符形态
  assert.ok(src.includes('{resource}不足：打出「'), '⇒ 出牌拒因还没接线（T12 Step 3 未完成）');
  assert.ok(src.includes('{resource}，你只有 '), '⇒ 拒因后半句没接线 ⇒ M3 的 before 串无对应物');
});

// ---------- T14：R3 收尾——**真局**日志与 UI 拒因，按本主题展开后判 ----------
//
// 为什么不自己写一套「回合驱动」：那样就成了流程层的**第二份实现**（本批要治的正是这类病）。
// 仿真层每个决策点都会 `record(动作前的局面)`，而 `State.log` 只增不减 ⇒
// **取最长的那条 log 就是接近完整的真局日志**，一行驱动代码都不用重写。
import { playOne, setRecorder } from '../sim/policy.mjs';
import type { DecisionRecord } from '../sim/policy.mjs';
import { stateFromJson } from '../../engine/core/serialize.ts';
import { logLineText } from '../../web/ui/log.ts';
import { termExpander } from '../../web/ui/terms.ts';

const OWN = (id: string) => (['resource', 'gate', 'path', 'peak', 'hp'] as const)
  .map((k) => (themeOf(id).terms as Record<string, string>)[k] as string);

test('B79 R3：四套真局（3/4/5 人各两局）的日志与 UI 拒因，按本主题展开后干净', async () => {
  let logLines = 0, blockTexts = 0, ownSentences = 0;
  const games: string[] = [];

  for (const id of IDS) {
    const theme = themeOf(id);
    const foreign = foreignWords(id);
    const own = OWN(id);
    const t = termExpander(theme.terms);
    for (const players of [3, 4, 5]) {
      for (let g = 0; g < 2; g++) {
        const bag: DecisionRecord[] = [];
        setRecorder(bag);
        try {
          await playOne(theme, players, 20260 + g * 31 + players * 7);
        } finally { setRecorder(null); }
        assert.ok(bag.length > 0, `${id}/${String(players)} 人：仿真一个决策点都没记录 ⇒ 真局没跑起来`);
        games.push(`${id}/${String(players)}:${String(bag.length)} 个决策点`);

        // ① 日志：log 只增 ⇒ 最长的一条即最完整的真局日志
        let best: State['log'] = [];
        let bestState: State | null = null;
        for (const r of bag) {
          const s = stateFromJson(r.state);
          if (s.log.length > best.length) { best = s.log; bestState = s; }
        }
        assert.ok(best.length >= 10, `${id}/${String(players)} 人：真局只有 ${String(best.length)} 行日志 ⇒ 覆盖面不足`);
        for (const e of best) {
          const shown = logLineText(e, theme.terms);
          logLines += 1;
          assert.equal(/\{(?:resource|gate|path|peak|hp)\}/.test(shown), false,
            `${id}：漏展开 ⇒「${shown}」⇒ 有一类文案没接进出口（R1/R2 抓不到这一类）`);
          for (const w of foreign) {
            assert.equal(shown.includes(w), false, `${id}：日志「${shown}」含别套词「${w}」`);
          }
          if (own.some((w) => shown.includes(w))) { ownSentences += 1; }
        }

        // ② UI 拒因：拿真局面去试**会被挡**的动作形状。
        //    ⚠️ 不能扫 `getLegalActions` 的结果——合法的动作 `uiBlockNotice` 按设计返回 null
        //    （UI 与引擎同判是 R-1 的硬约束），扫它恒得 0 条，那就是一条空转判据。
        if (bestState !== null) {
          const s0 = bestState;
          const hand = s0.players[0]?.hand ?? [];
          const attempts: Array<Parameters<typeof uiBlockNotice>[2]> = [
            ...hand.map((c) => ({ type: 'PLAY_CARD' as const, actor: 0, cardId: c.id })),
            { type: 'GATE_RESOLVE' as const, actor: 0, channel: 'pay' },
            { type: 'GATE_RESOLVE' as const, actor: 0, channel: 'trial' },
            { type: 'CERTIFY_APPEAL' as const, actor: 0, target: 0 },
            { type: 'CERTIFY_CHALLENGE' as const, actor: 0, target: 1 },
            { type: 'RECUPERATE' as const, actor: 0 },
            { type: 'ABILITY' as const, actor: 0, abilityId: activeAbilityId(s0, 0) },
          ];
          for (const a of attempts) {
            const n = uiBlockNotice(s0, 0, a);
            if (typeof n !== 'string') { continue; }
            blockTexts += 1;
            const shown = t(n);
            assert.equal(/\{(?:resource|gate|path|peak|hp)\}/.test(shown), false,
              `${id}：拒因漏展开 ⇒「${shown}」`);
            for (const w of foreign) {
              assert.equal(shown.includes(w), false, `${id}：拒因「${shown}」含别套词「${w}」`);
            }
          }
        }
      }
    }
  }
  // 防空转：三个读数都得够量，否则上面的循环可能一次都没进
  assert.ok(logLines >= 200, `只收集到 ${String(logLines)} 条真局日志 ⇒ 判据会空转`);
  assert.ok(blockTexts >= 4, `只有 ${String(blockTexts)} 条真局拒因被检查（四套 × 若干局）⇒ 覆盖面不足：${games.join(' | ')}`);
  assert.ok(ownSentences >= 20, `只有 ${String(ownSentences)} 句带本主题叶词 ⇒ 展开可能整体没生效`);
});

test('B79 R3 反证：故意不传 terms ⇒ 占位符会露出来（证明上一条的「干净」来自展开，不是来自恒等）', () => {
  const theme = themeOf('scifi-ai');
  const raw = '支付 3 {resource}通过{gate}';
  const entry = { kind: 'gate', round: 1, turnIndex: 0, actor: 0, message: raw };
  assert.match(logLineText(entry), /\{resource\}/, '不展开时**应当**看到占位符 ⇒ 若这里不露，说明前提（会露）不成立，上一条就是空判据');
  const shown = logLineText(entry, theme.terms);
  assert.equal(/\{/.test(shown), false, `展开后仍有花括号：${shown}`);
  assert.equal(shown.includes('算力'), true, `展开没用本主题词：${shown}`);
});
