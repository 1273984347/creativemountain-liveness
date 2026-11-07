// 第 8 道门（规格 §10.1 主题差异化核对）的常驻负样本。
//
// ⚠️ **自包含**：全部在**内存副本**上制造违例，**不碰工作区主题包文件**
//   —— node:test 默认跨文件并发，改工作区文件会与其他测试互踩。
//
// 判据：每条负样本「违例必红」，且恢复后必绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkThemeDiff,
  checkThemesMutuallyDistinct,
  deepEqual,
  MIN_REUSED_CARDS,
} from '../../tools/theme-diff-check.mjs';

const base = JSON.parse(readFileSync(resolve('themes/xianxia2026/theme.json'), 'utf8'));
const scifi = JSON.parse(readFileSync(resolve('themes/scifi-ai/theme.json'), 'utf8'));
const hybrid = JSON.parse(readFileSync(resolve('themes/hybrid/theme.json'), 'utf8'));
const urban = JSON.parse(readFileSync(resolve('themes/urban-psych/theme.json'), 'utf8'));

const clone = (v: unknown): any => JSON.parse(JSON.stringify(v)) as any;

// ---------- 正样本：四套主题必须全绿 ----------

test('正样本：三套新主题相对基准的 §10.1 两张清单零错误', () => {
  for (const theme of [scifi, hybrid, urban]) {
    const r = checkThemeDiff(base, theme);
    assert.deepEqual(r.errors, [], `${theme.meta.id} 差异化核对应零错误：${r.errors.join('；')}`);
  }
});

test('正样本：三套新主题两两差异化零错误（含标志卡互异性）', () => {
  assert.deepEqual(checkThemesMutuallyDistinct([scifi, hybrid, urban], base).errors, []);
});

test('正样本：通用卡牌池复用数达下限（证明是复用而非独立卡池）', () => {
  const r = checkThemeDiff(base, scifi);
  const note = r.notes.find((n) => n.includes('通用卡牌复用'));
  assert.ok(note !== undefined, '应有复用统计');
  const reused = Number(/复用 (\d+)\/\d+/.exec(note)?.[1] ?? '0');
  assert.ok(reused >= MIN_REUSED_CARDS, `复用 ${reused} 张，应 ≥ ${MIN_REUSED_CARDS}`);
});

// ---------- 负样本：违例必红 ----------

test('负样本：主题名与基准相同 → 判红', () => {
  const bad = clone(scifi);
  bad.meta.name = base.meta.name;
  const errors = checkThemeDiff(base, bad).errors;
  assert.ok(errors.some((e) => e.includes('主题名')), '主题名与基准相同必须判红');
});

test('负样本：tagline 与基准相同 → 判红', () => {
  const bad = clone(scifi);
  bad.meta.tagline = base.meta.tagline;
  assert.ok(checkThemeDiff(base, bad).errors.some((e) => e.includes('tagline')), 'tagline 相同必须判红');
});

test('负样本：阵营名与基准重名 → 判红', () => {
  const bad = clone(scifi);
  bad.factions[0].name = base.factions[0].name;
  assert.ok(checkThemeDiff(base, bad).errors.some((e) => e.includes('阵营名')), '阵营重名必须判红');
});

test('负样本：glossary 四核心术语之一与基准相同 → 判红', () => {
  for (const key of ['HP', 'deck', 'hand', 'resource']) {
    const bad = clone(scifi);
    bad.glossary[key] = base.glossary[key];
    assert.ok(
      checkThemeDiff(base, bad).errors.some((e) => e.includes(`glossary.${key}`)),
      `glossary.${key} 与基准相同必须判红`,
    );
  }
});

test('负样本：认证题逐字照抄基准 → 判红（换措辞不是换场景）', () => {
  const bad = clone(scifi);
  bad.certificationCards[0].prompt = base.certificationCards[0].prompt;
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('逐字相同')),
    '认证题照抄基准必须判红',
  );
});

test('负样本：认证题全部不含主题专属名词 → 判红', () => {
  const bad = clone(scifi);
  bad.domainWords = ['这个词不存在于任何认证题'];
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('专属名词')),
    '认证题未命中专属名词必须判红',
  );
});

test('负样本：未声明 domainWords → 判红（无法机械核对换场景）', () => {
  const bad = clone(scifi);
  delete bad.domainWords;
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('domainWords')),
    '缺 domainWords 必须判红',
  );
});

test('负样本：通用卡池被过度设计（改 3 张通用卡为全新效果）→ 判红', () => {
  const bad = clone(scifi);
  // 第 1、2 张是标志卡；第 3、4、5 张是通用牌 —— 把它们换成全新效果
  for (const idx of [2, 3, 4]) {
    bad.cards[idx].effects = [{ op: 'gain_resource', amount: 99 }];
  }
  const errors = checkThemeDiff(base, bad).errors;
  assert.ok(
    errors.some((e) => e.includes('通用卡牌池')),
    `通用卡牌池复用不足必须判红（实际错误：${errors.join('；')}）`,
  );
});

test('负样本：卡牌效果与基准别处相同但不对位 → 判红（既非复用也非全新）', () => {
  const bad = clone(scifi);
  bad.cards[2].effects = clone(base.cards[5].effects);
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('既不是复用也不是全新效果')),
    '既非复用也非全新效果必须判红',
  );
});

test('负样本：标志卡超过 2 张 → 判红', () => {
  const bad = clone(scifi);
  for (const idx of [2, 3]) {
    bad.cards[idx].effects = [{ op: 'gain_resource', amount: 99 }];
  }
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('标志卡')),
    '标志卡超过 2 张必须判红',
  );
});

test('负样本：身份特权被独立设计 → 判红（身份槽位应复用）', () => {
  const bad = clone(scifi);
  bad.identities[0].passive = { op: 'shield', amount: 5 };
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('特权与基准不同')),
    '身份特权独立设计必须判红',
  );
});

test('负样本：身份终局目标被独立设计 → 判红', () => {
  const bad = clone(scifi);
  bad.identities[0].goal = { kind: 'pass_gates', count: 9 };
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('终局目标与基准不同')),
    '身份终局目标独立设计必须判红',
  );
});

test('负样本：天机牌事件池被独立设计 → 判红', () => {
  const bad = clone(scifi);
  bad.heavenCards[0].effects = [{ op: 'heal', amount: 3 }];
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('天机牌')),
    '天机牌独立设计必须判红',
  );
});

test('负样本：试炼结构被独立设计 → 判红', () => {
  const bad = clone(scifi);
  bad.trials[0].effects = [{ op: 'damage', amount: 3, target: 0 }];
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('试炼牌')),
    '试炼牌独立设计必须判红',
  );
});

test('负样本：两套主题的认证题逐字相同 → 判红', () => {
  const a = clone(scifi);
  const b = clone(hybrid);
  b.certificationCards[0].prompt = a.certificationCards[0].prompt;
  assert.ok(
    checkThemesMutuallyDistinct([a, b], base).errors.some((e) => e.includes('认证题逐字相同')),
    '跨主题认证题重复必须判红',
  );
});

test('负样本：两套主题的阵营名相同 → 判红', () => {
  const a = clone(scifi);
  const b = clone(urban);
  b.factions[0].name = a.factions[0].name;
  assert.ok(
    checkThemesMutuallyDistinct([a, b], base).errors.some((e) => e.includes('阵营名重名')),
    '跨主题阵营重名必须判红',
  );
});

test('负样本：跨主题标志卡效果相同（换皮）→ 判红', () => {
  const a = clone(scifi);
  const b = clone(hybrid);
  // 把 A 主题的标志卡效果原样抄给 B 主题的标志卡
  const flagA = a.cards.find((c: { id: string }) => /_u0[12]$/.test(c.id));
  const flagB = b.cards.find((c: { id: string }) => /_u0[12]$/.test(c.id));
  assert.ok(flagA !== undefined && flagB !== undefined);
  flagB.effects = clone(flagA.effects);
  assert.ok(
    checkThemesMutuallyDistinct([a, b], base).errors.some((e) => e.includes('标志卡效果相同')),
    '两套主题共用同一张标志卡效果必须判红',
  );
});

test('负样本：domainWords 用单字平凡词 → 判红（判据不能被平凡词绕过）', () => {
  const bad = clone(scifi);
  bad.domainWords = ['的'];
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('domainWords')),
    '单字平凡词必须判红',
  );
});

test('负样本：glossary 四核心术语主题内部同词 → 判红', () => {
  const bad = clone(scifi);
  bad.glossary.HP = '同一个词';
  bad.glossary.deck = '同一个词';
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('同词')),
    'glossary 内部同词必须判红',
  );
});

test('负样本：仅一张认证题未命中专属名词 → 判红（要求全部命中）', () => {
  const bad = clone(scifi);
  bad.certificationCards[0].prompt = '说一件完全与本主题无关的事。';
  assert.ok(
    checkThemeDiff(base, bad).errors.some((e) => e.includes('未命中本主题专属名词')),
    '单张认证题未主题化必须判红',
  );
});

test('正样本（恢复必绿）：所有负样本制造完后，原始四套主题仍全绿', () => {
  for (const theme of [scifi, hybrid, urban]) {
    assert.deepEqual(checkThemeDiff(base, theme).errors, []);
  }
  assert.deepEqual(checkThemesMutuallyDistinct([scifi, hybrid, urban], base).errors, []);
});

test('工具自检：deepEqual 与键序无关', () => {
  assert.ok(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), '键序不同不应影响相等判定');
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }), '值不同必须判不等');
});
