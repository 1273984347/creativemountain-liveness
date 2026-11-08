// 主题包试炼牌改造 + 关隘试炼池重排（V1.1 · B22）——**可复用工具**。
//
// 目的：① 消除**关隘试炼池重复**（14 / 22 / 30 三座共用同一池）；
//   ② 让**每张试炼牌都有判定**（此前 8 张「纯奖励」牌无论成败都通过 ⇒ 试炼通道形同免费）；
//   ③ 让**全部 12 张牌都进入某个关隘池**（此前 8 张从未被任何关隘引用 ⇒ 死数据）。
//
// 做法：4 座关隘各配 **3 张互不重复**的试炼（4×3 = 12 ⇒ 零重复、零死牌）；
//   失败后果统一为 `gate_fallback_pay`（试炼失败 ⇒ 本关改为付费，B19-b 已实现）。
//
// ⚠️ 脚本只改 **trials 段** 与 **4 座关隘的 trialIds**，其余原样 ⇒ diff 干净。
// ⚠️ 四套主题的试炼段**逐字相同**（§10.1 允许「事件池与试炼结构」复用）⇒ 一份生成文本即可。
//
// 用法：node docs/沉淀/theme-trial-challenges.mjs <主题id...>

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 12 张挑战型试炼（失败一律 gate_fallback_pay）。 */
const TRIALS = [
  { id: 't_mirror', text: '展示任意 1 张手牌（手里要有移动牌）。', pred: { kind: 'has_card', filter: { type: 'motion' } }, then: { op: 'draw_cards', count: 1 } },
  { id: 't_sword', text: '展示 2 张同色手牌（手里要有红牌）。', pred: { kind: 'has_card', filter: { color: 'red' } }, then: { op: 'draw_cards', count: 1 } },
  { id: 't_oath', text: '立誓：本关通过后免疫封口 1 回合（身上至少 2 枚灵枢）。', pred: { kind: 'resource_at_least', amount: 2 }, then: { op: 'immunity', status: 'silence', amount: 1 } },
  { id: 't_wind', text: '顺风：掷指令骰 ≥ 6，本关通过后额外获得 1 枚灵枢。', pred: { kind: 'dice_is_at_least', amount: 6, faces: 20 }, then: { op: 'gain_resource', amount: 1 } },
  { id: 't_sutra', text: '抄经：本关通过后抽 1 张牌（手里要有攻击牌）。', pred: { kind: 'has_card', filter: { type: 'attack' } }, then: { op: 'draw_cards', count: 1 } },
  { id: 't_stone', text: '养石：本关通过后恢复 1 点体力（体力不低于 5）。', pred: { kind: 'hp_at_least', amount: 5 }, then: { op: 'heal', amount: 1 } },
  { id: 't_mantra', text: '持咒：本关通过后获得 1 点护盾（手里要有黑牌）。', pred: { kind: 'has_card', filter: { color: 'black' } }, then: { op: 'shield', amount: 1 } },
  { id: 't_silent', text: '缄默：本关通过后免疫减速 1 回合（手里要有防御牌）。', pred: { kind: 'has_card', filter: { type: 'defense' } }, then: { op: 'immunity', status: 'slow', amount: 1 } },
  { id: 't_vital', text: '固元：本关通过后免疫中毒 1 回合（手里要有功能牌）。', pred: { kind: 'has_card', filter: { type: 'utility' } }, then: { op: 'immunity', status: 'poison', amount: 1 } },
  { id: 't_empty', text: '空过：身上至少 3 枚灵枢才能过关——通过后额外获得 1 枚灵枢。', pred: { kind: 'resource_at_least', amount: 3 }, then: { op: 'gain_resource', amount: 1 } },
  { id: 't_star', text: '掷指令骰，点数 ≥ 12 即通过。', pred: { kind: 'dice_is_at_least', amount: 12, faces: 20 }, then: { op: 'gain_resource', amount: 1 } },
  { id: 't_toll', text: '出示 4 枚资源（不足则本关改为付费）。', pred: { kind: 'resource_at_least', amount: 4 }, then: { op: 'draw_cards', count: 1 } },
];

/** 四座关隘的试炼池（各 3 张、互不重复；12 张全部入池）。 */
const GATE_POOLS = [
  ['t_mirror', 't_sword', 't_oath'],
  ['t_wind', 't_sutra', 't_stone'],
  ['t_mantra', 't_silent', 't_vital'],
  ['t_empty', 't_star', 't_toll'],
];

const themes = process.argv.slice(2);
if (themes.length === 0) {
  console.error('用法：node docs/沉淀/theme-trial-challenges.mjs <主题id...>');
  process.exit(2);
}

/** 生成 trials 段文本（缩进对齐顶层 key）。 */
function trialsText(eol) {
  const arr = TRIALS.map((t) => ({
    id: t.id,
    text: t.text,
    effects: [{ op: 'conditional', pred: t.pred, then: t.then, else: { op: 'gate_fallback_pay' } }],
  }));
  // ⚠️ 去掉 JSON.stringify 产出的首尾方括号（替换时自己补 ⇒ 否则会变成数组套数组）。
  const lines = JSON.stringify(arr, null, 2).split('\n');
  lines.pop();
  lines.shift();
  return lines.map((l) => (l.length > 0 ? '  ' + l : l)).join(eol);
}

for (const id of themes) {
  const path = resolve('themes', id, 'theme.json');
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  // ① 替换 trials 段（顶层数组）。
  const re = /"trials": \[[\s\S]*?\n  \],/;
  if (!re.test(raw)) { throw new Error(id + ': 未找到 trials 段'); }
  let out = raw.replace(re, '"trials": [' + eol + trialsText(eol) + eol + '  ],');
  // ② 重排 4 座关隘的 trialIds（按出现顺序）。
  let gi = 0;
  out = out.replace(/"trialIds": \[[^\]]*\]/g, (m) => {
    const pool = GATE_POOLS[gi];
    gi += 1;
    if (pool === undefined) { return m; }
    return '"trialIds": [' + pool.map((t) => '"' + t + '"').join(', ') + ']';
  });
  if (gi !== 4) { throw new Error(id + ': 预期 4 座关隘，实际匹配 ' + String(gi)); }
  // ③ 校验：12 张牌全部有判定；四池互不相交且并集 = 全部牌。
  const theme = JSON.parse(out);
  for (const t of theme.trials) {
    const eff = t.effects[0];
    if (eff === undefined || eff.op !== 'conditional') { throw new Error(id + ': ' + t.id + ' 不是挑战型'); }
    const thenJson = JSON.stringify(eff.then);
    const elseJson = JSON.stringify(eff.else);
    if (thenJson === elseJson) { throw new Error(id + ': ' + t.id + ' 的 then/else 相同 ⇒ 无判定'); }
  }
  const pools = theme.board.tiles.filter((t) => t.kind === 'gate').map((t) => t.gate.trialIds.join(','));
  const seen = new Set();
  for (const p of pools) { for (const t of p.split(',')) { if (seen.has(t)) { throw new Error(id + ': 试炼 ' + t + ' 重复入池'); } seen.add(t); } }
  if (seen.size !== theme.trials.length) { throw new Error(id + ': 入池 ' + String(seen.size) + ' 张 ≠ 全部 ' + String(theme.trials.length) + ' 张（存在死牌）'); }
  writeFileSync(path, out, 'utf8');
  console.log(id + ': 12 张挑战型试炼；四池 ' + pools.join(' | '));
}
