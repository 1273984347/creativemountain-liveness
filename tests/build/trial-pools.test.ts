// 关隘试炼池（规格 §3.5，B22）的回归测试。
//
// 覆盖：① 四座关隘的试炼池**互不重复**；② **12 张牌全部入池**（无死牌 ——
//   此前 8 张「纯奖励」牌从未被任何关隘引用 ⇒ 引擎永远抽不到）；
//   ③ 每张牌都是**挑战型**（then ≠ else），失败后果统一为「本关改为付费」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ThemePack } from '../../engine/types/theme.ts';

const THEMES = ['xianxia2026', 'scifi-ai', 'urban-psych', 'hybrid'];

function themeOf(id: string): ThemePack {
  return JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
}

test('B22：四座关隘的试炼池互不重复，且全部试炼牌都入池（无死牌）', () => {
  for (const id of THEMES) {
    const theme = themeOf(id);
    const gates = theme.board.tiles.filter((t) => t.kind === 'gate');
    assert.equal(gates.length, 4, id + ' 应有 4 座关隘');
    const seen = new Set<string>();
    for (const g of gates) {
      const ids = g.gate?.trialIds ?? [];
      assert.ok(ids.length > 0, id + ' 每座关隘都要有试炼');
      for (const t of ids) {
        assert.equal(seen.has(t), false, id + ': 试炼 ' + t + ' 被多座关隘重复引用');
        seen.add(t);
      }
    }
    const all = theme.trials ?? [];
    assert.equal(seen.size, all.length,
      id + ': 入池 ' + String(seen.size) + ' 张应等于全部 ' + String(all.length) + ' 张（否则有死牌）');
  }
});

test('B22：每张试炼牌都有判定（then ≠ else），失败后果统一为「本关改为付费」', () => {
  for (const id of THEMES) {
    const theme = themeOf(id);
    for (const t of theme.trials ?? []) {
      const eff = (t.effects?.[0] ?? {}) as { op?: string; then?: unknown; else?: unknown };
      assert.equal(eff.op, 'conditional', id + '/' + t.id + ' 必须是挑战型（否则永远通过）');
      assert.notEqual(JSON.stringify(eff.then), JSON.stringify(eff.else),
        id + '/' + t.id + ' 的 then/else 相同 ⇒ 无判定');
      const els = eff.else as { op?: string } | undefined;
      assert.equal(els?.op, 'gate_fallback_pay',
        id + '/' + t.id + ' 的失败后果应统一为「本关改为付费」');
    }
  }
});
