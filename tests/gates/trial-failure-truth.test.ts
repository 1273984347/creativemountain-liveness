// B78 §4 R2：试炼失败后果的三处同源（题面括注 / 卡面页脚 / 规则书小节）。
//
// 病灶：B78 前试炼卡页脚写死「失败则退 1 格并被封口」，而引擎的试炼失败分支
//   （gate.ts:204-221）**只写 gate_pay_<格>** —— 不退格、不封口。「退 1 格并被封口」
//   的真归属是比牌未胜（gate.ts:309-327）与付费不足被放行（gate.ts:337-352，主规格 :267 同口径）。
//   于是同一张牌上印着两句互相矛盾的失败后果：题面括注（真）+ 页脚（假）。
//   B77 的题面真值守卫放过它，是因为页脚**不在 text 里**、不进 IR ⇒ 门 ⑤/⑥/⑦ 结构上看不见。
//
// ⚠️ 双向对撞必须同时存在：只判「SVG 含派生句」会放过「既印对句又印错句」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { trialSvg } from '../../build/print-parts.ts';
import { renderTrialFooter } from '../../build/trial-text.mjs';

/** trialSvg 的第三参是 `Readonly<Record<string,string>>`（IR glossary 形状），字面量即可。 */
const GLOSSARY = { gate: '关隘' };
const FAKE = '失败则退 1 格并被封口';

test('R2 正样本：页脚逐字等于派生后果句', () => {
  const svg = trialSvg({ id: 't_mirror', text: '展示手里 2 张红色牌。' }, 0, GLOSSARY);
  assert.ok(svg.includes(renderTrialFooter()), `页脚应为[${renderTrialFooter()}]，实际 SVG 里没有`);
});

test('R2 反向：页脚不得再含「失败则退 1 格并被封口」（假话墓碑，防回填）', () => {
  const svg = trialSvg({ id: 't_mirror', text: '展示手里 2 张红色牌。' }, 0, GLOSSARY);
  assert.equal(svg.includes(FAKE), false,
    '退格封口属于比牌未胜 / 付费不足放行两条通道，不是试炼失败的后果（gate.ts:204-221）');
});

// ---- r1.4：印刷产物零残留（发布包会整目录复制 print/<主题>/svg）----
const DIRS = ['xianxia2026', 'urban-psych', 'scifi-ai', 'hybrid'];

test('R2：每套 svg 目录里的试炼牌**文件集合 ≡ 当前 IR 的 12 张**（旧编号/旧 id 都不许留）', () => {
  for (const id of DIRS) {
    const dir = resolve('print', id, 'svg');
    assert.ok(existsSync(dir), `${dir} 不存在 ⇒ 先跑 npm run build:print（门禁自举只在 ir.json 缺失时生成）`);
    const ir = JSON.parse(readFileSync(resolve('print', id, 'ir.json'), 'utf8')) as { trials: { id: string }[] };
    const want = ir.trials.map((t, i) => `试炼牌-${String(i + 1).padStart(2, '0')}-${t.id}.svg`).sort();
    const got = readdirSync(dir).filter((f) => f.startsWith('试炼牌-')).sort();
    assert.deepEqual(got, want,
      `${id} 的 svg 目录与当前剧本不符（残留会随发布包发货，见 build/build-package.mjs:43）`);
  }
});

test('R2：48 张当前试炼牌的页脚全部是派生句、且都不含旧假话', () => {
  const footer = renderTrialFooter();
  for (const id of DIRS) {
    const ir = JSON.parse(readFileSync(resolve('print', id, 'ir.json'), 'utf8')) as { trials: { id: string }[] };
    ir.trials.forEach((t, i) => {
      const svg = readFileSync(resolve('print', id, 'svg', `试炼牌-${String(i + 1).padStart(2, '0')}-${t.id}.svg`), 'utf8');
      assert.ok(svg.includes(footer), `${id}/${t.id} 的页脚不是派生句`);
      assert.equal(svg.includes(FAKE), false, `${id}/${t.id} 的页脚仍是旧假话`);
    });
  }
});
