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
