// B78 §4 R3：20 面指令表的**当前输出**钉子（四套各一份，不共用「基准 + 差异表」）。
//
// ⚠️ 快照不是主题数据的第二事实源：它是「现在印出来是什么」的证据，本来就该逐套独立。
//   做成「基准 + 差异表」会多一层间接，且第 5 套主题得自己维护差异表。
// ⚠️ 判据必须是 deepEqual 而不是 includes：includes 放过「多一条」，
//   deepEqual 同时抓住条数 / 顺序 / 文案三种漂移。
// ⚠️ 主题 id 集合完整性必须显式断言：JSON 形态不像类型系统那样逼你写全，
//   漏一套 ⇒ 新主题没被钉子覆盖，测试还绿（静默失效）。
// ⚠️ face 15 也在快照里（L-B78-5 的措辞将来要改，但快照钉的是**现状**）：
//   正因钉住了，另批改措辞时快照会红、逼人同步改主规格与基线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INSTRUCTION_TABLE, instructionText } from '../../engine/core/instruction-table.ts';
import type { ThemePack, ThemeTerms } from '../../engine/types/theme.ts';

/** 快照一行。显式标注而不写 `as`（`as` 拆行会被 tsc 判 TS1434，Node 的类型剥离同样拒）。 */
type SnapRow = { face: number; text: string };
const snap: Record<string, SnapRow[]> =
  JSON.parse(readFileSync(resolve('tests/gates/snapshots/instruction-d20.json'), 'utf8'));
const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];

test('快照覆盖的主题集合 ≡ 仓内主题集合（缺一套即红）', () => {
  assert.deepEqual(Object.keys(snap).sort(), IDS, '新主题必须补一份快照，否则它没被钉子覆盖');
});

test('四套 × 20 面逐字等于快照（条数 / 顺序 / 文案三种漂移一并抓）', () => {
  for (const id of IDS) {
    const theme = JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;
    const got = INSTRUCTION_TABLE.map((r) => ({
      face: r.face,
      text: instructionText(r.face, theme.terms as ThemeTerms),
    }));
    assert.deepEqual(got, snap[id], `${id} 的 20 面输出与快照不符：${JSON.stringify(got)}`);
  }
});

test('基准主题输出与 B78 前现值逐字相同（换架构不换措辞）', () => {
  const base = snap['xianxia2026'];
  assert.equal(base?.[1]?.text, '灵枢 +1');
  assert.equal(base?.[3]?.text, '灵枢 -1（给自己）');
  assert.equal(base?.[6]?.text, '抽 1 张牌 + 灵枢 +1');
  assert.equal(base?.[17]?.text, '获得 1 枚灵枢（不超上限）');
  // L-B78-5：这句被刻意钉住（现状 = 主规格现值），另批改它时这里会红——那时要连快照一起改。
  assert.equal(base?.[14]?.text, '免疫本回合的「封口」');
});
