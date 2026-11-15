// B78 §3.1 站 5–7：`name` 必须进 IR，并与 theme.json 逐字一致（可追溯性）。
//
// ⚠️ 为什么可追溯判据必须在门 ⑥（ir-validate）而不是只在测试里：
//   IR 是印刷链路的唯一输入（print 只读 IR）⇒ 「IR 里的 name 与 theme.json 不同」意味着
//   玩家手里的牌名与数据源不同，而卡片渲染、parity、规则书全都照 IR 走、查不出来。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateIr } from '../../tools/ir-validate.mjs';
import { SCALES } from '../../engine/scales.ts';   // 第三参就是 scales 常量（tools/ir-validate.mjs:175 传 loadScales() 同物）

const irOf = (id: string): any => JSON.parse(readFileSync(resolve('print', id, 'ir.json'), 'utf8'));
const themeOf = (id: string): any => JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8'));

test('站 5：四套 IR 的 trials 都带非空 name', () => {
  for (const id of ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid']) {
    irOf(id).trials.forEach((t: any, i: number) => {
      assert.equal(typeof t.name, 'string', `${id} trials[${i}] 无 name`);
      assert.ok(t.name.length > 0, `${id} trials[${i}] name 为空`);
    });
  }
});

test('站 7 前提：现值零错误（签名 (ir, theme, scales) 与 tools/ir-validate.mjs:26 一致）', () => {
  for (const id of ['xianxia2026', 'hybrid']) {
    const r = validateIr(irOf(id), themeOf(id), SCALES);
    assert.deepEqual(r.errors, [], `${id}: ${r.errors.join('; ')}`);
  }
});

test('站 7 负样本：theme.json 的 name 改了而 IR 没跟上 ⇒ 判红（内存副本，不改盘）', () => {
  const ir = irOf('hybrid');
  const theme = themeOf('hybrid');
  theme.trials[0].name = '假名字';
  const r = validateIr(ir, theme, SCALES);
  assert.ok(r.errors.some((e: string) => e.includes('name') && e.includes(ir.trials[0].id)), r.errors.join('; '));
});

test('站 6：version 仍是 1（name 是字段内扩展，不升版本）', () => {
  assert.equal(irOf('scifi-ai').version, 1, '规格 §3.3：IR 无跨版本读取方，升版本换不到保障');
});
