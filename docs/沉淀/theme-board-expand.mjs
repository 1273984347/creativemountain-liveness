// 主题包棋盘扩展到 36 格 / 4 座关隘（V1.1 · B21）——**可复用工具**。
//
// 目的：让「关隘数」与规模表 §8 的 gateCount 各档一致（3 人 2 / 4 人 3 / 5–6 人 3 / 7–8 人 4）。
// 做法：
//   · 主题包棋盘从 28 格扩到 **36 格**，关隘放在 **6 / 14 / 22 / 30**（间隔 8）；
//     于是「裁到目标格数」时天然保留**前 N 座**关隘（24 格留 2、28 格留 3、36 格留 4）。
//   · 峰顶永远在末格（36）。
//
// ⚠️ **必须文本级替换**：本仓主题包 JSON 是**手工紧凑排版**（部分成员写在同一行），
//   整体 JSON.stringify 会把全文重排 ⇒ diff 变成全文件变更。故此处只动三处文本：
//   格 14（原普通格 → 第四座前的第二座关隘）、格 28（原峰顶 → 普通格）+ 追加 29–36。
//
// 用法：node docs/沉淀/theme-board-expand.mjs <主题id...>

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 每套主题的新增关隘：14 号（改造原普通格）与 30 号（新增）。 */
const GATE_PLAN = {
  xianxia2026: { g14: { name: '朝元关', fee: 4 }, g30: { name: '镇岳关', fee: 5 } },
  'scifi-ai': { g14: { name: '安全闸·叁', fee: 4 }, g30: { name: '安全闸·肆', fee: 5 } },
  'urban-psych': { g14: { name: '封锁线·叁', fee: 4 }, g30: { name: '封锁线·肆', fee: 5 } },
  hybrid: { g14: { name: '阵门·叁', fee: 4 }, g30: { name: '阵门·肆', fee: 5 } },
};

/** 新增关隘的试炼池（与既有关隘重复 —— 见 B21 记录的待办 T1）。 */
const TRIAL_POOL = ['t_star', 't_toll'];

const themes = process.argv.slice(2);
if (themes.length === 0) {
  console.error('用法：node docs/沉淀/theme-board-expand.mjs <主题id...>');
  process.exit(2);
}

for (const id of themes) {
  const plan = GATE_PLAN[id];
  if (plan === undefined) { throw new Error(id + ': 未登记关隘命名计划'); }
  const path = resolve('themes', id, 'theme.json');
  const raw = readFileSync(path, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const L = (lines) => lines.join(eol);
  // ① 取原峰顶名（格 28）。
  const peakRe = /\{\r?\n\s*"index": 28,\r?\n\s*"kind": "peak",\r?\n\s*"name": "([^"]+)"\r?\n\s*\}/;
  const peakMatch = peakRe.exec(raw);
  if (peakMatch === null) { throw new Error(id + ': 未找到格 28 的峰顶对象'); }
  const peakName = peakMatch[1] ?? '';
  // ② 格 14：普通格 → 关隘。
  const g14Re = /\{\r?\n\s*"index": 14,\r?\n\s*"kind": "plain",\r?\n\s*"name": "[^"]+"\r?\n\s*\},/;
  if (!g14Re.test(raw)) { throw new Error(id + ': 未找到格 14 的普通格对象'); }
  const g14Text = L([
    '      {',
    '        "index": 14,',
    '        "kind": "gate",',
    '        "name": "' + plan.g14.name + '",',
    '        "gate": { "fee": ' + String(plan.g14.fee) + ', "trialIds": [' + TRIAL_POOL.map((t) => '"' + t + '"').join(', ') + '] }',
    '      },',
  ]);
  let out = raw.replace(g14Re, g14Text);
  // ③ 格 28：峰顶 → 普通格；追加 29–36（30 是第四座关隘，36 是新峰顶）。
  const tail = L([
    '      {',
    '        "index": 28,',
    '        "kind": "plain",',
    '        "name": "第 28 段"',
    '      },',
    '      { "index": 29, "kind": "plain", "name": "第 29 段" },',
    '      {',
    '        "index": 30,',
    '        "kind": "gate",',
    '        "name": "' + plan.g30.name + '",',
    '        "gate": { "fee": ' + String(plan.g30.fee) + ', "trialIds": [' + TRIAL_POOL.map((t) => '"' + t + '"').join(', ') + '] }',
    '      },',
    '      { "index": 31, "kind": "plain", "name": "第 31 段" },',
    '      { "index": 32, "kind": "plain", "name": "第 32 段" },',
    '      { "index": 33, "kind": "plain", "name": "第 33 段" },',
    '      { "index": 34, "kind": "plain", "name": "第 34 段" },',
    '      { "index": 35, "kind": "plain", "name": "第 35 段" },',
    '      {',
    '        "index": 36,',
    '        "kind": "peak",',
    '        "name": "' + peakName + '"',
    '      }',
  ]);
  const peakBlockRe = /\{\r?\n\s*"index": 28,\r?\n\s*"kind": "peak",\r?\n\s*"name": "[^"]+"\r?\n\s*\}/;
  if (!peakBlockRe.test(out)) { throw new Error(id + ': 未找到格 28 的峰顶对象（替换后）'); }
  out = out.replace(peakBlockRe, tail);
  // ④ board 段的 length / peakIndex 同步为 36。
  const metaRe = /("board": \{\s*"length": )28(,\s*"peakIndex": )28/;
  if (!metaRe.test(out)) { throw new Error(id + ': 未找到 board 段的 length/peakIndex'); }
  out = out.replace(metaRe, '$136$236');
  // ⑤ 校验：36 格 / 4 座关隘（6、14、22、30）/ 峰顶 36。
  const theme = JSON.parse(out);
  const tiles = theme.board.tiles;
  if (tiles.length !== 36) { throw new Error(id + ': 格数不是 36'); }
  const gateIdx = tiles.filter((t) => t.kind === 'gate').map((t) => t.index);
  if (gateIdx.join(',') !== '6,14,22,30') { throw new Error(id + ': 关隘位置异常 ' + gateIdx.join(',')); }
  if (theme.board.peakIndex !== 36) { throw new Error(id + ': peakIndex 不是 36'); }
  writeFileSync(path, out, 'utf8');
  console.log(id + ': 28 → 36 格，关隘 6/14/22/30，峰顶 36');
}
