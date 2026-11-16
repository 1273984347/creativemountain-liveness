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
 * 任何一套主题的五个叶词：引擎文本里出现其中之一，就是引擎替某个主题作了主张。
 *
 * `noUncheckedIndexedAccess` 下 `t[k]` 是 `string | undefined` ⇒ 显式收窄（叶子的齐备性
 * 由门 ⑤ 与 `tests/gates/theme-leaf-upgrade.test.ts` 保证，不在这里再兜一次值）。
 */
const LEAF_WORDS = [...new Set(IDS.flatMap((id) => {
  const t = themeOf(id).terms as Record<string, string | undefined>;
  return ['resource', 'gate', 'path', 'peak', 'hp']
    .map((k) => t[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}))];

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
        for (const w of LEAF_WORDS) {
          assert.equal(text.includes(w), false,
            `${id}：算子文本「${text}」含主题词「${w}」⇒ 引擎不该持有主题文案（改用 {resource} 等占位符）`);
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
