// B78 §4 R3：指令文案的归属守卫（规则 → 守卫 → 判据形状）。
//
// ⚠️ 为什么判**运行时的日志消息**而不是判源码字符串：
//   现值 `:275` 写的是 `… —— ${instructionText(face)}`，源码里根本没有主题词字面量
//   （它们在 INSTRUCTION_TABLE 里）⇒ 源码断言会当场绿，是一条空判据
//   （计划里已把这条列为「若直接绿说明取段取错了」的陷阱，实测确认它确实会假绿）。
//   真值只能这样取：让引擎真的跑一次 ask，看写进 log 的那句话里有没有主题词。
//
// 现查事实：turn-runner.ts:140-161 写死「灵枢」，而 build-ir.mjs:66-78 按 terms.resource
//   替换 ⇒ 三套主题的对局日志说「灵枢」、规则书说「算力 / 异能点 / 灵能」。
//   这是「说的 ≠ 判的」，与试炼卡页脚同一类病（规格 §1.1 S4 / 附录 A.2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { performAction } from '../../engine/core/turn-runner.ts';
import { INSTRUCTION_TABLE, instructionText } from '../../engine/core/instruction-table.ts';
import { mk } from '../engine/fixtures.ts';
import { fullBanWords } from '../../tools/theme-word-scan.mjs';

const RUNNER = readFileSync('engine/core/turn-runner.ts', 'utf8');
/**
 * 任何一套主题的词：引擎日志一旦含其中之一，就说明它替某个主题作了主张。
 *
 * B80 T5 起这张表**从主题数据派生**（原来手抄 7 个词：`灵枢/算力/异能点/灵能/符箓/指令库/道箓`）。
 * 手抄的那份有两个毛病，正是本批一路在治的：
 *   ① 加叶 / 加主题时它会悄悄变短（B80 的三新叶与身份名一个都不在里面）；
 *   ② 抄的人得记得"哪些词算主题词"，而这个判断的真值住在 `themes/<id>/theme.json`。
 * 口径 = 主域禁字表（八叶 32 ∪ 身份名 26）∪ 各套 `glossary.deck/hand`
 *       （牌堆名/手牌名不是句子层叶——`deck` 因同形词「指令」被 §4.4 排除，
 *        但**日志里出现「指令库」仍然是替 scifi 作主张**，所以这张网要比 R1 宽）。
 */
const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const THEME_WORDS = [...new Set([
  ...fullBanWords().map((w) => w.word),
  ...IDS.flatMap((id) => {
    const g = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8')).glossary as Record<string, string>;
    return [g.deck, g.hand].filter((v): v is string => typeof v === 'string' && v.length > 0);
  }),
])];

test('B78：日志消息体不再调用 instructionText（定义仍在文件里，由 Task 3/4 迁走）', () => {
  // 只判**调用**：`message: ...instructionText(` 这个形状就是「引擎把主题文案塞进日志」的证据。
  const calls = RUNNER.split('\n').filter((l) => /message:.*instructionText\(/.test(l));
  assert.deepEqual(calls, [], 'ask 日志仍在拼指令文案 ⇒ 引擎持有主题词');
});

test('B78：引擎 ask 日志的消息体不含任何主题词（运行时取证，非源码断言）', () => {
  let asked = 0;
  const seenFaces = new Set<number>();
  for (let seed = 0; seed < 60; seed++) {
    const before = mk(4, 20260 + seed);
    const after = performAction(before, 0, 'ask');
    const last = after.log[after.log.length - 1];
    if (last === undefined || last.kind !== 'ask') { continue; }   // 闸门拦下 ⇒ 换 seed
    asked += 1;
    if (typeof last.diceRoll === 'number') { seenFaces.add(last.diceRoll); }
    for (const w of THEME_WORDS) {
      assert.equal(last.message.includes(w), false,
        `seed=${String(seed)} 的 ask 日志含主题词「${w}」：[${last.message}] ⇒ 引擎不该持有主题文案`);
    }
  }
  assert.ok(asked >= 10, `前提失效：60 个 seed 只跑出 ${String(asked)} 条 ask 日志 ⇒ 判据会空转`);
  assert.ok(seenFaces.size >= 6, `前提失效：只覆盖到 ${String(seenFaces.size)} 个面，主题词面（2/4/7/18）可能一个没命中`);
});

test('B78：ask 日志保留可查指针与结构化骰面（UI 靠 diceRoll 展开，不靠解析文本）', () => {
  for (let seed = 0; seed < 60; seed++) {
    const after = performAction(mk(4, 20260 + seed), 0, 'ask');
    const last = after.log[after.log.length - 1];
    if (last === undefined || last.kind !== 'ask') { continue; }
    assert.equal(typeof last.diceRoll, 'number', 'ask 条目必须带 diceRoll（既有 LogEntry 字段，本批不新增）');
    assert.match(last.message, /第 \d+ 条指令/, `兜底句要能让玩家查表：[${last.message}]`);
  }
});

// ---- T4：表已迁出 turn-runner，字面量只许住在一个文件 ----
const TABLE = readFileSync('engine/core/instruction-table.ts', 'utf8');
/** 摘掉表本体后，任何文件再出现被引号包裹的指令文案都算第二事实源（B77 前缀表同法）。 */
const PROBE_ROWS = ['抽 2 张牌', '掷 6 面移动骰并按点数前进', '全员弃 1 张牌', '自由执行一次「阵营轮」效果'];
const SCOPE = ['engine/core/turn-runner.ts', 'engine/core/instruction-table.ts', 'build/build-ir.mjs', 'web/ui/log.ts'];

test('B78：表已迁出 turn-runner，引擎不再引用表或替换函数', () => {
  assert.ok(TABLE.includes('export const INSTRUCTION_TABLE'), '前提：表在 instruction-table.ts');
  assert.equal(/instructionText/.test(RUNNER), false, 'turn-runner.ts 不许出现 instructionText');
  assert.equal(/INSTRUCTION_TABLE/.test(RUNNER), false, 'turn-runner.ts 不许出现 INSTRUCTION_TABLE');
});

test('B78：指令文案字面量只出现在表文件（摘掉表本体后逐文件扫）', () => {
  const start = TABLE.indexOf('export const INSTRUCTION_TABLE');
  const end = TABLE.indexOf('];', start);
  assert.ok(start > 0 && end > start, '前提：能定位表本体');
  const stripped = TABLE.slice(0, start) + TABLE.slice(end + 2);
  for (const f of SCOPE) {
    const src = f === 'engine/core/instruction-table.ts' ? stripped : readFileSync(f, 'utf8');
    for (const p of PROBE_ROWS) {
      assert.equal(src.includes(`'${p}'`) || src.includes(`\`${p}\``), false,
        `${f} 手抄了指令文案「${p}」⇒ 请改用 INSTRUCTION_TABLE / instructionText`);
    }
  }
});

// ---- B79 §4.2（T5）：替换语义只许一份实现 ----
//
// B78 留下两份 `split('{resource}').join(...)`：`instruction-table.ts:73` 与
// `build-ir.mjs:104`。同一件事两份实现，第三份（`expandThemeWords`，T4）落地后
// 前两份都必须改调它——否则将来表里加 `{gate}`，只有展开器认识它，两处旧替换各印一半。
const EXPANDER = readFileSync('engine/core/theme-text.ts', 'utf8');
const IR_SRC = readFileSync('build/build-ir.mjs', 'utf8');

test('B79：instructionText 与 build-ir 都不再自带 split/join 替换', () => {
  assert.ok(EXPANDER.includes('export function expandThemeWords'), '前提：展开器存在（T4）');
  assert.equal(/\.split\((RESOURCE|'\{resource\}')\)/.test(TABLE), false,
    'instruction-table.ts 仍在自己替换 ⇒ 第二份实现');
  assert.equal(/\.split\('\{resource\}'\)/.test(IR_SRC), false,
    'build-ir.mjs 仍在自己替换 ⇒ 第二份实现');
  assert.ok(TABLE.includes('expandThemeWords'), 'instruction-table.ts 必须改调展开器');
  assert.ok(IR_SRC.includes('expandThemeWords'), 'build-ir.mjs 必须改调展开器');
});

test('B79：改调后 20 面输出逐字不变（换实现不换文案，face 15 由 T17 单独改）', () => {
  // 四套各比一次快照：快照是手工维护的独立钉子（见 instruction-d20.test.ts 文件头），
  // 用它当尺子才叫「输出没变」，用改前源码自比是自证。
  const snap = JSON.parse(readFileSync('tests/gates/snapshots/instruction-d20.json', 'utf8')) as
    Record<string, { face: number; text: string }[]>;
  assert.ok(Object.keys(snap).length >= 4, `前提：快照要有四套，实际 ${Object.keys(snap).join('/')}`);
  for (const [id, rows] of Object.entries(snap)) {
    const theme = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8')) as { terms: Parameters<typeof instructionText>[1] };
    assert.deepEqual(INSTRUCTION_TABLE.map((r) => instructionText(r.face, theme.terms)),
      rows.map((x) => x.text), `${id}：20 面输出与快照不符 ⇒ 换实现换掉了文案`);
  }
});
