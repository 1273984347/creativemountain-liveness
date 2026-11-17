// B79 R6 / §A.4：指令骰 face 15 的措辞必须**说中豁免窗的真值**，且三处同词。
//
// 立项目的不是「改一句话」，是把三件事钉在一起：
//   ① 指令表 `INSTRUCTION_TABLE[15]`；② 主规格 §3.2 表行；③ 四套 IR / 快照 / 规则书（后两者由 IR 派生）。
// 三处逐字同词 ⇒ 任何一处单独回写「本回合」都会红（B78 留 L-B78-5 时缺的正是这条常驻守卫）。
//   第三处（规则书 / IR）在这里钉的是**派生关系**而不是生成物：`print/*` 由 gitignore，
//   门② 又跑在门④ 构建之前，拿 `print/<id>/ir.json` 当判据会在干净工作树里必红——
//   红的原因变成「我还没跑构建」，那不是判据想说的话。派生结果由门⑥ 与 d20 快照负责。
//
// ⚠️ 反向钉的范围（规格 r1.8）：只钉 **face 15 那一条**。全域扫「本回合」必撞 face 17
//   的正字「本回合移动 +2 格」（移动加成本来就只活一个手番）——一条会误报的判据换不来安全，
//   只会换来一条白名单。
// ⚠️ 措辞的**依据**不在这个文件里重复实现：真值是 `statuses.ts` 的 grantImmunity（加层、不清旧层）
//   + `tickPlayerStatuses`（在该玩家自己手番末衰减、授予当回合有豁免位）。第 4 条用例就地跑一遍窗长，
//   证的是「句子声称的覆盖范围 = 引擎实际给的覆盖范围」，不是再测一遍家族 B（那是 status-duration.test.ts）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INSTRUCTION_TABLE, instructionText } from '../../engine/core/instruction-table.ts';
import { applyStatus, grantImmunity, immunityOf, tickPlayerStatuses } from '../../engine/core/statuses.ts';
import { mk } from '../engine/fixtures.ts';
import type { State } from '../../engine/core/state.ts';

const FACE15 = '免疫「封口」至下一个完整手番结束';
const IDS = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];
const MAIN_SPEC = 'docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md';
const read = (p: string): string => readFileSync(resolve(p), 'utf8');
const atFace = (rows: readonly { readonly face: number; readonly text: string }[], face: number): string =>
  rows.find((r) => r.face === face)?.text ?? '(缺行)';

test('R6：指令表 face 15 ≡ 定稿措辞（A.4，用「免疫」不用「豁免」）', () => {
  assert.equal(atFace(INSTRUCTION_TABLE, 15), FACE15);
});

test('R6 三处同词：主规格 §3.2 表行 + 四套快照逐字相等，且 IR 那一处仍由本表派生', () => {
  // 主规格那一行取法：以 `| 5 | 掷 6 面移动骰` 开头、第四格是 15 的那一行；候选数必须恰好 1，
  // 否则「找到了」与「没找到」都可能是取错了行（§1065 的规模表里也有一个 15 单元格）。
  const candidates = read(MAIN_SPEC).split('\n')
    .filter((l) => l.startsWith('| 5 | ') && l.split('|')[3]?.trim() === '15');
  assert.equal(candidates.length, 1, `主规格 §3.2 的 face 15 行找到 ${String(candidates.length)} 条候选：${JSON.stringify(candidates.map((c) => c.slice(0, 60)))}`);
  assert.equal(candidates[0]?.split('|')[4]?.trim(), FACE15, `主规格表行与表不同词：${candidates[0]}`);

  const snap = JSON.parse(read('tests/gates/snapshots/instruction-d20.json')) as Record<string, Array<{ readonly face: number; readonly text: string }>>;
  assert.deepEqual(Object.keys(snap).sort(), [...IDS].sort(), '快照必须四套齐全');
  for (const id of IDS) {
    assert.equal(atFace(snap[id] ?? [], 15), FACE15, `${id} 的 d20 快照 face 15 未同步`);
  }

  // ⚠️ 第三处（规则书 / IR 产物）**不在这里读 `print/<id>/ir.json`**：`print/*` 是 gitignore 的
  //   生成物，而门② 跑在门④ 构建之前——拿它当判据，干净工作树里必红，而「红的原因是我还没跑构建」
  //   不是判据想说的话。这里钉的是**派生关系**：IR 的 instructionTable 必须由本表 + 同一替换函数算出，
  //   派生结果本身由 `instruction-d20.test.ts` 的 deepEqual 与门⑥ 负责。
  assert.match(read('build/build-ir.mjs'), /instructionTable:\s*INSTRUCTION_TABLE\.map\([\s\S]{0,120}expandThemeWords/,
    '⇒ IR 那一处不许自己写文案、也不许另找替换函数（两处派生必漂，B78 时这行就是第二份替换）');
});

test('R6 反向钉（只钉 face 15）：四处都不许回写成「本回合」，也不许改用「豁免」', () => {
  const places: Array<[string, string]> = [
    ['指令表', atFace(INSTRUCTION_TABLE, 15)],
    ['主规格 §3.2', read(MAIN_SPEC).split('\n').filter((l) => l.startsWith('| 5 | ') && l.split('|')[3]?.trim() === '15')[0] ?? '(缺行)'],
  ];
  const snap = JSON.parse(read('tests/gates/snapshots/instruction-d20.json')) as Record<string, Array<{ face: number; text: string }>>;
  for (const id of IDS) { places.push([`${id} 快照`, atFace(snap[id] ?? [], 15)]); }
  for (const [name, text] of places) {
    assert.equal(/本回合/.test(text), false, `${name} 的 face 15 回写了「本回合」⇒ 低估豁免窗（真值 = 当前剩余 + 1 个完整手番）`);
    assert.equal(/豁免/.test(text), false, `${name} 的 face 15 用了「豁免」⇒ 须与 immunity 算子、B77 状态标题同词（A.4）`);
  }
  // 反面账：face 17 的「本回合」是正字，本守卫**不该**抓它 ⇒ 若哪天有人把判据扩成全域，这条会先红提醒
  assert.match(atFace(INSTRUCTION_TABLE, 17), /^本回合/, '前提：face 17 仍写「本回合移动 +2 格」（合法用法，r1.8 的收窄就是为它）');
});

test('R6 措辞说得中窗：自己手番内授予 1 层 ⇒ 授予当回合不消耗、下一个完整手番内仍挡得住', () => {
  const seat = 1;
  const duringTurnOf = (s: State, at: number): State => ({ ...s, turnIndex: s.turnOrder.indexOf(at) });
  let s = duringTurnOf(mk(4, 7), seat);
  s = grantImmunity({ state: s, actor: seat }, seat, 'silence', 1).state;
  assert.equal(immunityOf(s, seat, 'silence'), 1, '前提：免疫窗已开（1 层）');
  s = tickPlayerStatuses(s, seat);
  assert.equal(immunityOf(s, seat, 'silence'), 1, '授予当回合不消耗额度 ⇒ 句子若写「本回合」在这里就已经错了');
  const blocked = applyStatus({ state: duringTurnOf(s, 0), actor: 0 }, seat, 'silence', 1);
  assert.equal(blocked.ok, false, '下一个完整手番内仍应被窗挡住');
  s = tickPlayerStatuses(s, seat);
  assert.equal(immunityOf(s, seat, 'silence'), 0, '该手番末窗关闭 ⇒「至下一个完整手番结束」不多不少正好这么多');
});

test('R6 附带：四套展开 face 15 同句（silence 四套同名「封口」，句子不含叶词 ⇒ 不触 R1）', () => {
  for (const id of IDS) {
    const terms = JSON.parse(read(`themes/${id}/theme.json`)).terms;
    const text = instructionText(15, terms);
    assert.equal(text, FACE15, `${id} 展开后不同词：${text}`);
    assert.equal(/\{/.test(text), false, '展开后残留占位符');
  }
});
