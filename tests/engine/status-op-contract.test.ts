// B77 常驻守卫：五个状态算子的写入**必须**委托 statuses.ts 的唯一出处，
// 且唯一出处内部**只许累加、不许设层**。
//
// 形状承袭 B76「alive:false 只允许 council.ts 写」那条源码断言：读源码、不跑行为 ⇒
// 将来谁在别处另起一份状态写入（绕过免疫窗 / 绕过封口弃牌 / 改成设层），当场红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REG = readFileSync(join(import.meta.dirname, '../../engine/ops/registry.ts'), 'utf8');
const ST = readFileSync(join(import.meta.dirname, '../../engine/core/statuses.ts'), 'utf8');

const DELEGATED: Readonly<Record<string, string>> = {
  poison: `poison', p.amount`,
  slow: `slow', p.amount`,
  silence: `silence', p.amount`,
  skip_turn: `skip_turn', p.amount`,
};

for (const [op, tail] of Object.entries(DELEGATED)) {
  test(`B77：算子 ${op} 必须委托 applyStatus（不得就地写 statuses）`, () => {
    const line = REG.split(/\r?\n/).find((l) => new RegExp(`^\\s*${op}:\\s*\\(ctx, p\\) =>`).test(l));
    assert.ok(line !== undefined, `registry 里找不到 ${op} 算子行（改名/挪位置要同步这条守卫）`);
    assert.match(line, /applyStatus\(/, `${op} 未委托 applyStatus ⇒ 会绕过免疫窗与封口弃牌：${line}`);
    assert.match(line, new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${op} 传参形状变了：${line}`);
  });
}

test('B77：算子 immunity 必须委托 grantImmunity，且 registry 不再自己拼 immunity_ 键', () => {
  const line = REG.split(/\r?\n/).find((l) => /^\s*immunity:\s*\(ctx, p\) =>/.test(l));
  assert.ok(line !== undefined, 'registry 里找不到 immunity 算子行');
  assert.match(line, /grantImmunity\(/, `immunity 未委托 grantImmunity：${line}`);
  assert.equal((REG.match(/immunity_/g) ?? []).length, 0, 'immunity_ 前缀只允许出现在 statuses.ts');
});

test('B77：registry 里不得再出现任何 statuses 写入（唯一出处 = statuses.ts）', () => {
  assert.equal((REG.match(/statuses\s*:/g) ?? []).length, 0,
    '发现 registry 直接写 statuses ⇒ 那份实现不受免疫窗与豁免标记约束，必然漂移（E94）');
});

test('B77：唯一出处内只累加，不存在「= amount」设层', () => {
  assert.doesNotMatch(ST, /\]\s*:\s*amount\b/,
    '设层写法会让连续中毒的第二发毫无意义（规格 B77 §3 通用形状）');
  assert.match(ST, /\?\?\s*0\)\s*\+\s*amount/,
    '累加判据在位；要改形状请连这条断言与规格一起改，别悄悄放宽');
});
