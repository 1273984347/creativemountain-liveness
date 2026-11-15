// 指令表替换函数的四端：正常替换 / 多处替换 / 面数越界 / 词表残缺。
//
// ⚠️ 越界与残缺都**抛错**，不返回兜底串：旧 `instructionText`（B78 前的 turn-runner:164）
//   返回「（无对应指令）」，会把「表少了一行」伪装成「这条指令就叫这个」，并原样印进规则书
//   ——与 B77 §1.3 的 `PASS` 空壳同判据：静默兜底比抛错更危险。
// ⚠️ 只测 `resource` 一端：`terms.statuses` 是 T10 才引入的字段，本文件不提前引用
//   （提前写会让测试依赖尚未存在的类型，T10 改签名时它不会告诉你为什么红）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INSTRUCTION_TABLE, instructionText } from '../../engine/core/instruction-table.ts';
import type { ThemeTerms } from '../../engine/types/theme.ts';

/** 造一份完整词表，只换资源词——其余字段与四套现值同形。 */
const terms = (resource: string): ThemeTerms => ({
  hp: '灵力', deck: '符箓', resource, gate: '关隘',
  types: { motion: '位移', attack: '攻击', defense: '防御', utility: '功能' },
  colors: { red: '红', black: '黑' },
});

test('表本体：20 条、face 严格 1..20 升序、无重复', () => {
  assert.equal(INSTRUCTION_TABLE.length, 20, '指令骰是 20 面');
  assert.deepEqual(INSTRUCTION_TABLE.map((r) => r.face), Array.from({ length: 20 }, (_, i) => i + 1));
  const texts = INSTRUCTION_TABLE.map((r) => r.text);
  assert.equal(new Set(texts).size, texts.length, '两面不许同文（同文意味着复制粘贴漏改）');
});

test('替换：2/4/7/18 四面含资源词，其余 16 面四套同值', () => {
  assert.equal(instructionText(2, terms('算力')), '算力 +1');
  assert.equal(instructionText(4, terms('灵能')), '灵能 -1（给自己）');
  assert.equal(instructionText(7, terms('灵能')), '抽 1 张牌 + 灵能 +1');
  assert.equal(instructionText(18, terms('异能点')), '获得 1 枚异能点（不超上限）');
  // 表本体里占位符必须**只在四面**出现：多一处 = 漏了主题化；少一处 = 主题词被写回死值
  const PLACEHOLDER_FACES = [2, 4, 7, 18];
  for (const r of INSTRUCTION_TABLE) {
    const want = PLACEHOLDER_FACES.includes(r.face);
    assert.equal(r.text.includes('{resource}'), want,
      want ? `face ${String(r.face)} 该用 {resource} 占位，却写死了主题词` : `face ${String(r.face)} 不该含占位符`);
  }
  assert.equal(instructionText(5, terms('算力')), '掷 6 面移动骰并按点数前进');
  assert.equal(instructionText(1, terms('灵枢')), '抽 1 张牌');
});

test('基准（仙侠）四面与 B78 前的现值逐字相同——换架构不换措辞', () => {
  assert.equal(instructionText(2, terms('灵枢')), '灵枢 +1');
  assert.equal(instructionText(4, terms('灵枢')), '灵枢 -1（给自己）');
  assert.equal(instructionText(7, terms('灵枢')), '抽 1 张牌 + 灵枢 +1');
  assert.equal(instructionText(18, terms('灵枢')), '获得 1 枚灵枢（不超上限）');
});

test('面数越界与词表残缺一律抛错', () => {
  assert.throws(() => instructionText(0, terms('灵枢')), /没有第 0 面/);
  assert.throws(() => instructionText(21, terms('灵枢')), /没有第 21 面/);
  assert.throws(() => instructionText(2, terms('')), /terms\.resource 缺失/);
});
