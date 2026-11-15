// B78 §2.4：48 条试炼牌名逐字回仓核对。
//
// ⚠️ 它是人工逐字对照的**机器替身**，只替到「仓里 == 测试里」这一层：
//   测试里的表若与规格 §2.4 不符，仍要靠 T18 的人工对照（规格 §2.5 写明这条边界，
//   别以为有门就万事大吉）。
// ⚠️ 表按 **trial id** 索引、不用位置索引 ⇒ 顺带钉住「派生主题的 trials 顺序 ≡ 基准顺序」。
// ⚠️ 本文件只判「仓里 == 表」。IR 一侧不在这里再抄一遍表——
//   T14 的判据是「IR ↔ theme.json 逐字可追溯」，与本条合起来就得到 IR == 表（传递），
//   两张表并存才是第二事实源。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TRIAL_IDS = ['t_mirror', 't_sword', 't_oath', 't_wind', 't_sutra', 't_stone',
  't_mantra', 't_silent', 't_vital', 't_empty', 't_star', 't_toll'] as const;

/** 规格 §2.4 定稿表（= 第 2 节已审表 + t_toll 血守→朱守 一格替换）。 */
const NAMES: Record<string, readonly string[]> = {
  xianxia2026: ['燃朱', '沉墨', '踏阵', '顺风', '守拙', '养石', '持咒', '赤步', '固元', '藏锋', '问鼎', '朱守'],
  urbanPsych: ['心火', '暗涌', '疾移', '手气', '硬顶', '静养', '外壳', '冲刺', '清血', '夜袭', '豪赌', '热盾'],
  scifiAi: ['过载', '暗码', '跃迁', '轻掷', '铁壁', '温机', '力场', '红移', '滤净', '暗火', '临界', '赤垒'],
  hybrid: ['赤焰', '玄铁', '缩地', '占风', '铸盾', '温补', '罡罩', '焰踏', '化毒', '隐刃', '搏天', '赤盾'],
};
const DIRS = ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid'];

interface ThemeFile { readonly trials: { readonly id: string; readonly name?: string }[] }

const read = <T>(rel: string): T => JSON.parse(readFileSync(resolve(rel), 'utf8')) as T;
const wantOf = (dir: string): readonly string[] => NAMES[Object.keys(NAMES)[DIRS.indexOf(dir)]!]!;

test('前提：四套 theme.json 的 trials id 顺序 ≡ 基准', () => {
  const base = read<ThemeFile>('themes/xianxia2026/theme.json');
  assert.deepEqual(base.trials.map((t) => t.id), [...TRIAL_IDS], '基准顺序即规格列表顺序');
  for (const dir of DIRS.slice(1)) {
    assert.deepEqual(read<ThemeFile>(`themes/${dir}/theme.json`).trials.map((t) => t.id),
      base.trials.map((t) => t.id), `${dir} 的 trials 顺序漂了`);
  }
});

test('四套 theme.json × 12 条 name ≡ 规格 §2.4 表', () => {
  for (const dir of DIRS) {
    const got = read<ThemeFile>(`themes/${dir}/theme.json`).trials.map((t) => t.name);
    assert.deepEqual(got, [...wantOf(dir)], `${dir} 的名字与表不符：${JSON.stringify(got)}`);
  }
});
