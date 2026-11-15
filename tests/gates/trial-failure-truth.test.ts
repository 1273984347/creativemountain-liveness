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
import { GATE_PAY_FAIL_CLAUSE, renderTrialFailure, renderTrialFooter } from '../../build/trial-text.mjs';
import { sectionBody } from '../../tools/rules-book-contract.mjs';

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

// ---- T9 / R2+R7：规则书小节 ↔ 真值（七条各自独立，漏改哪条就红哪条）----
const narr = (): string => readFileSync(resolve('print', '规则书叙述.md'), 'utf8');
const gateBody = (): string => sectionBody(narr(), '### {{gate}}');
const certPart = (): string => sectionBody(narr(), '### 判罚权与申诉') + sectionBody(narr(), '### 质疑的成本');
const duelPart = (): string => sectionBody(narr(), '## 对峙');
const statusPart = (): string => sectionBody(narr(), '# 负面状态');

test('R2-1：关隘小节逐字含派生后果句，且不含旧假话', () => {
  const body = gateBody();
  assert.ok(body.includes(renderTrialFailure({ op: 'gate_fallback_pay' }, GLOSSARY)), '缺「本关改为付费」口径');
  assert.ok(body.includes(GATE_PAY_FAIL_CLAUSE), '缺「仍未付足则判未通过…」');
  assert.equal(body.includes(FAKE), false, '规则书不许把退格封口归给试炼失败');
});

test('R2-2：关隘小节举的例子必须是**真实存在的判定**（门槛 ∈ {6,12}、不出现已删的资源型）', () => {
  const body = gateBody();
  const theme = JSON.parse(readFileSync(resolve('themes', 'xianxia2026', 'theme.json'), 'utf8')) as any;
  const amounts = new Set<number>(theme.trials.flatMap((t: any) =>
    (t.effects ?? []).filter((e: any) => e.pred?.kind === 'dice_is_at_least').map((e: any) => e.pred.amount)));
  const quoted = [...body.matchAll(/≥\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(quoted.length > 0, '前提：小节确有举例门槛');
  for (const n of quoted) { assert.ok(amounts.has(n), `举例 ≥${String(n)} 不存在于任何判定（真值 ${[...amounts].join('/')}）`); }
  assert.equal(/出示 4 枚/.test(body), false, '「出示 4 枚资源」是 B22 已替换的旧判定，举例不许留');
});

test('R7-1：认证小节写明「答对 ≤1 ⇒ 待认证者后退 1 格」', () => {
  assert.ok(certPart().includes('后退 1 格'), '认证代价不全：certification.ts:186');
});

test('R7-2：认证小节写明「复议失败 ⇒ 额外扣一枚并后退」', () => {
  const t = certPart();
  assert.ok(t.includes('复议失败'), '缺复议失败的代价（certification.ts:304,355）');
  assert.ok(/复议失败[^。]*扣/.test(t), '复议失败的扣费未写');
});

test('R7-3：对峙「亮牌留场」必须有平局例外', () => {
  const t = duelPart();
  assert.ok(t.includes('留在场上公开'), '前提：留场句仍在');
  assert.ok(t.includes('平局除外'), '漏抄主规格 :183 的 B13 裁定（平局亮牌当场弃掉、不留场）');
});

test('R7-4：负面状态小节的单位词唯一（不许「N 回合」与「N 个手番」并存）', () => {
  const t = statusPart();
  assert.equal(/N 回合/.test(t), false, '仍有「N 回合」标题 ⇒ 与正文/引擎口径（statuses.ts:75）冲突');
  assert.ok(t.includes('N 个手番'), '前提：小节的正确单位词仍在');
});

test('R7-5 反向钉住：两处**引擎实现缺口**的文档承诺不许被删（L-B78-2 / L-B78-3）', () => {
  assert.ok(gateBody().includes('不再被抽取'),
    '删这句 = 把 L-B78-2 伪装成「文档本来就没错」；主规格 :240 要求排除');
  assert.ok(certPart().includes('再扣一枚'),
    '删这句 = 把 L-B78-3 伪装成文档瑕疵；主规格 §5.3.4 :432 要求共扣 2');
});
