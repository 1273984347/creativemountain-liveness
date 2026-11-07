// B7 parity-check 的负样本：每级门禁都必须能判红。
//
// ⚠️ **自包含**：负样本在**内存副本**上制造漂移，**不碰工作区文件**——
// 否则并发跑测试时会互踩（见 selfcheck.test.ts 的同款教训）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkIrVsTheme,
  checkSvgVsIr,
  checkTracedCells,
  checkPdfBasic,
  extractSvgTexts,
} from '../../tools/parity-check.mjs';
import { SCALES, SCALE_FIELD_NAMES } from '../../engine/scales.ts';

const ir = JSON.parse(readFileSync(resolve('print/xianxia2026/ir.json'), 'utf8'));
const theme = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));
const rulesHtml = readFileSync(resolve('print/xianxia2026/规则书.html'), 'utf8');

const clone = (v: unknown): any => JSON.parse(JSON.stringify(v)) as any;

// ---------- 正样本：真实产物必须全绿 ----------

test('parity-check 正样本：主比对 ir↔theme 零错误', () => {
  assert.deepEqual(checkIrVsTheme(ir, theme), []);
});

test('parity-check 正样本：SVG 辅比对零错误', () => {
  const svgDir = resolve('print/xianxia2026/svg');
  const texts: string[] = [];
  for (const f of readdirSync(svgDir).filter((x) => x.endsWith('.svg'))) {
    texts.push(...extractSvgTexts(readFileSync(resolve(svgDir, f), 'utf8')));
  }
  assert.deepEqual(checkSvgVsIr(texts, ir), []);
});

test('parity-check 正样本：数值溯源零错误且确有溯源单元格', () => {
  const r = checkTracedCells(rulesHtml, SCALES, SCALE_FIELD_NAMES);
  assert.deepEqual(r.errors, []);
  assert.ok(r.count > 0, '规则书必须带 data-src 的数值单元格');
});

test('parity-check 正样本：PDF 粗检零错误', () => {
  for (const f of ['print/xianxia2026/规则书.pdf', 'print/xianxia2026/实体件.pdf']) {
    assert.deepEqual(checkPdfBasic(readFileSync(resolve(f)), f), []);
  }
});

// ---------- 负样本：每级门禁都必须能判红 ----------

test('负样本：主比对 —— ir 与 theme 的卡牌名漂移 → 判红', () => {
  const badIr = clone(ir);
  badIr.cards[0].name = '偷偷改掉的名字';
  const errors = checkIrVsTheme(badIr, theme);
  assert.ok(errors.length > 0, '卡牌名漂移必须判红');
  assert.ok(errors.some((e) => e.includes('cards[0]') || e.includes('卡牌')), '错误信息须指向具体卡牌');
});

test('负样本：辅比对 —— SVG 漏印一个卡牌名 → 判红', () => {
  const svgTexts = extractSvgTexts(
    '<svg><text>御风</text><text>前进 3 格。</text></svg>',
  );
  const errors = checkSvgVsIr(svgTexts, ir);
  assert.ok(errors.length > 0, '漏印必须判红');
});

test('负样本：数值溯源 —— 规则书数值与引擎常量不符 → 判红', () => {
  const badHtml = rulesHtml.replace(
    '<td data-src="scales[5].threshold">3</td>',
    '<td data-src="scales[5].threshold">99</td>',
  );
  assert.notEqual(badHtml, rulesHtml, '构造的坏 HTML 必须与原文不同');
  const r = checkTracedCells(badHtml, SCALES, SCALE_FIELD_NAMES);
  assert.ok(r.errors.length > 0, '溯源值不符必须判红');
  assert.ok(r.errors.some((e) => e.includes('溯源值与引擎常量不符')), '须报「溯源值与引擎常量不符」');
});

test('负样本：数值溯源 —— 溯源路径指向不存在的字段 → 判红', () => {
  const badHtml = rulesHtml.replace('scales[5].threshold', 'scales[5].not_a_field');
  const r = checkTracedCells(badHtml, SCALES, SCALE_FIELD_NAMES);
  assert.ok(r.errors.some((e) => e.includes('不在 §8 契约内')), '非法字段名必须判红');
});

test('负样本：数值溯源 —— 溯源标记整体缺失 → 判红', () => {
  const noSrc = rulesHtml.replace(/ data-src="[^"]*"/g, '');
  const r = checkTracedCells(noSrc, SCALES, SCALE_FIELD_NAMES);
  assert.ok(r.errors.some((e) => e.includes('未找到任何带 data-src')), '标记缺失必须判红');
});

test('负样本：PDF 粗检 —— 文件头非法 → 判红', () => {
  const errors = checkPdfBasic(Buffer.from('not a pdf at all'), '坏文件');
  assert.ok(errors.some((e) => e.includes('无法打开')), '非 PDF 必须判红');
});
