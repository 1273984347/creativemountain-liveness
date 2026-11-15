// B78 §3.1 站 8：name 的两条守卫 —— 可追溯（IR↔theme.json，T14 已加）与**可见性**（IR↔SVG）。
// 可见性用「去空白后子串包含」判文本是否真被渲染（parity-check 的既有判法）。
// ⚠️ 裸 name 有误匹配风险（name 是正文/页脚子串时判不出漂移）⇒ 锚定串 = `#<序号>` + name：
//   T15 的实图顺序是「关隘试炼 / #1 / 燃朱」⇒ `#1燃朱` 在去空白串里相邻；
//   门 ⑤ 禁「数字入名」正是为了让 `#N` 之后的非数字序列唯一。
// ⚠️ 门⑧ 是**唯一**同时见到基准与全部派生主题的地方（跨套判据只能放这里）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkSvgVsIr, extractSvgTexts } from '../../tools/parity-check.mjs';
import { checkThemeDiff } from '../../tools/theme-diff-check.mjs';

const DIRS = ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid'];
const irOf = (id: string): any => JSON.parse(readFileSync(resolve('print', id, 'ir.json'), 'utf8'));
const themeOf = (id: string): any => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8'));

test('门⑦：每张试炼牌的 name 锚定串（#N + name）确实渲染进了 SVG', () => {
  for (const dir of DIRS) {
    const ir = irOf(dir);
    ir.trials.forEach((t: any, k: number) => {
      const svg = readFileSync(resolve('print', dir, 'svg',
        `试炼牌-${String(k + 1).padStart(2, '0')}-${t.id}.svg`), 'utf8');
      // ⚠️ 传**完整 IR**（与生产调用一致）：传单条子集会把它编号塌成 #1，
      //   于是第 2..12 张牌的 #N 锚定串必然落空 ⇒ 假红。
      //   按「本卡锚定串」过滤：其余 11 条缺失是单张 SVG 的正常现象。
      const needle = `：#${String(k + 1)}${t.name}`;
      const errs = checkSvgVsIr(extractSvgTexts(svg), ir)
        .filter((e: string) => e.includes('试炼牌名') && e.includes(needle));
      assert.deepEqual(errs, [], `${dir} 第 ${String(k + 1)} 张：${errs.join('; ')}`);
    });
  }
});

test('门⑦ 负样本：name 漂出版面 ⇒ 可见性判据命中（恰好一条）', () => {
  const ir = irOf('hybrid');
  const fake = { ...ir.trials[0], name: '不在牌面上的名字' };
  const irBad = { ...ir, trials: [fake, ...ir.trials.slice(1)] };
  const svg = readFileSync(resolve('print', 'hybrid', 'svg', `试炼牌-01-${fake.id}.svg`), 'utf8');
  const errs = checkSvgVsIr(extractSvgTexts(svg), irBad)
    .filter((e: string) => e.includes(`：#1${fake.name}`));
  assert.equal(errs.length, 1, '锚定串不在 SVG 时必须恰报一条可见性错误');
});

test('门⑧：派生套与基准的试炼牌名逐条互异', () => {
  const base = themeOf('xianxia2026');
  for (const dir of DIRS.slice(1)) {
    const theme = themeOf(dir);
    const same = theme.trials.filter((t: any, i: number) => t.name === base.trials[i].name).map((t: any) => t.id);
    assert.deepEqual(same, [], `${dir} 与基准同名：${same.join(', ')}`);
  }
});

test('门⑧ 负样本：派生套某条改成与基准同名 ⇒ checkThemeDiff 判红', () => {
  const base = themeOf('xianxia2026');
  const theme = themeOf('scifi-ai');
  theme.trials[3].name = base.trials[3].name;
  const { errors } = checkThemeDiff(base, theme);
  assert.ok(errors.some((e: string) => e.includes('试炼牌') && e.includes('同名')), errors.join('; '));
});

test('表集合本身逐套互异：同一序号四套不许同值（防整表复制粘贴）', () => {
  const lists = DIRS.map((d) => themeOf(d).trials.map((t: any) => t.name as string));
  for (let i = 0; i < 12; i++) {
    assert.equal(new Set(lists.map((l) => l[i])).size, 4, `第 ${String(i + 1)} 行四套未全互异`);
  }
});
