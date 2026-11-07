// 平衡回归（B10 收尾④）：用模拟器跑一次、解析三组读数、断言多条性质。
//
// ⚠️ 为什么集中在一个文件：平衡读数依赖**子进程跑模拟**（1600 局 ≈ 数十秒），
//   拆散在多个文件会重复付出同一份代价 —— 这里跑一次、断言多条。
//
// 读数口径（详见 `docs/balance-report.md`）：
//   · **座位胜率**：座位与胜率是否解耦（随机化前沿座位严格单调递减 22.4% → 1.7%）。
//   · **身份胜率**：身份机制强度是否失衡（随机化前某身份与固定座位绑定）。
//   · **位次胜率**：**先手优势的直接度量** —— 位次 = 开局随机行动顺序中的位置。
//
// ⚠️ 未达成项（勿在本文件里粉饰）：**先手优势本身仍在**。
//   位次胜率仍呈严格单调递减（1 位 19.7% → 8 位 8.3%，spread 11.4pp），
//   根源是规则链「先登顶 → 77.6% 直接获胜」，属 V1.1 的抢先链规则修正。
//   下面的 `test.todo` 记录了 V1.1 的验收目标，修正后应转成正式断言。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** 跑一次模拟并解析报告里的表格。 */
function runSim(games: number, players: number): {
  seatRates: number[];
  identityRates: number[];
  posRates: number[];
  passiveOps: Map<string, number>;
  duelTotal: number;
} {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-sim-'));
  const out = resolve(dir, 'report.md');
  const res = spawnSync(process.execPath, [resolve('tests', 'sim', 'run.mjs'),
    '--games', String(games), '--players', String(players), '--out', out],
    { encoding: 'utf8', shell: false, cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 });
  assert.equal(res.status, 0, '模拟失败：' + (res.stderr ?? ''));
  const text = readFileSync(out, 'utf8');
  // 座位胜率：取「N 人局」小节下的表
  const seatSection = text.slice(text.indexOf('### ' + players + ' 人局'));
  const seatRates = [...seatSection.matchAll(/^\| 座(\d+) \| \d+ \| ([\d.]+)% \|/gm)]
    .map((m) => Number(m[2]));
  // 身份胜率：取第一张身份表
  const idSection = text.slice(text.indexOf('## 身份胜率'), text.indexOf('## 阵营胜率'));
  const identityRates = [...idSection.matchAll(/^\| [^|]+ \| \d+ \| ([\d.]+)% \|/gm)]
    .map((m) => Number(m[1]));
  // 位次胜率：取「按行动顺序位次」小节下的表（**先手优势的直接读数**）
  const posSection = text.slice(text.indexOf('## 按行动顺序位次'), text.indexOf('## 先手优势的传导路径'));
  const posRates = [...posSection.matchAll(/^\| 第(\d+) 位 \| \d+ \| ([\d.]+)% \|/gm)]
    .map((m) => Number(m[2]));
  // 对峙次数（B13 可达性证据）：`| 对峙总次数 | N |`
  const duelMatch = /\| 对峙总次数 \| (\d+) \|/.exec(text);
  const duelTotal = duelMatch === null ? 0 : Number(duelMatch[1]);
  // 被动触发统计（B12 可达性证据）：`| 名称 | `op` | 次数 | 局数 | 每百局 |`
  const passiveSection = text.slice(text.indexOf('## 身份被动触发统计'), text.indexOf('## 认证轮次分布'));
  const passiveOps = new Map<string, number>();
  for (const m of passiveSection.matchAll(/^\| [^|]+ \| `([a-z_]+)` \| (\d+) \|/gm)) {
    passiveOps.set(m[1] ?? '', Number(m[2]));
  }
  return { seatRates, identityRates, posRates, passiveOps, duelTotal };
}

// 2000 局 × 4 套主题 = 8000 局（样本再少时噪声会盖过信号；位次胜率的验收口径见规格 §9.2）
const SIM = { games: 2000, players: 8 };

/**
 * 模拟结果缓存 —— 跑一次、复用多次。
 *
 * ⚠️ 没有缓存的话每条断言都要重跑 1600 局（4 倍代价），
 *   而且**并行跑同一份模拟**会让测试时长得离谱。
 */
let cached: { seatRates: number[]; identityRates: number[]; posRates: number[]; passiveOps: Map<string, number>; duelTotal: number } | null = null;
function sim(): { seatRates: number[]; identityRates: number[]; posRates: number[]; passiveOps: Map<string, number>; duelTotal: number } {
  if (cached === null) {
    cached = runSim(SIM.games, SIM.players);
  }
  return cached;
}

test('平衡回归：座位胜率不再沿座位塌缩（随机化前 22.4% → 1.7%，spread 20.7pp）', () => {
  const { seatRates } = sim();
  assert.ok(seatRates.length >= 8, '应解析出 8 个座位的胜率');
  const spread = Math.max(...seatRates) - Math.min(...seatRates);
  assert.ok(spread < 12, `座位胜率最大差 ${spread.toFixed(1)}pp 应 < 12pp（随机化前约 20.7pp）`);
});

test('平衡回归：座位胜率不再严格单调递减（退化回座位绑定时必红）', () => {
  const { seatRates } = sim();
  assert.ok(seatRates.length >= 8, '应解析出 8 个座位的胜率');
  // 严格单调递减 ⇒ 座位与胜率仍然绑定。随机数据下恰好单调的概率 ≈ 1/8! ⇒ 极稳健。
  const strictlyDecreasing = seatRates.every((v, i) => i === 0 || v < (seatRates[i - 1] ?? Infinity));
  assert.ok(!strictlyDecreasing,
    '座位胜率仍严格单调递减（' + seatRates.map((v) => v.toFixed(1)).join(' → ') + '）—— 座位与胜率仍绑定');
});

test('平衡回归：身份胜率不再与座位绑定（随机化前最大差约 20pp）', () => {
  const { identityRates } = sim();
  assert.ok(identityRates.length >= 8, '应解析出各主题身份的胜率');
  const spread = Math.max(...identityRates) - Math.min(...identityRates);
  assert.ok(spread < 12, `身份胜率最大差 ${spread.toFixed(1)}pp 应 < 12pp（随机化前约 20pp）`);
});

test('平衡回归：行动顺序确实是随机的（位次胜率表存在且位次数正确）', () => {
  const { posRates } = sim();
  assert.equal(posRates.length, SIM.players, '应解析出每个行动顺序位次的胜率');
});

test('平衡回归：7 个身份被动在**真实对局中均触发过**（B12 可达性）', () => {
  // ⚠️ B12 之前，这 7 个被动的 op 只出现在主题包里、引擎无消费点 ⇒
  //   机制看着实现、实际永不触发（「只写不读」死机制）。
  //   本条断言它们在真实对局中**确实会触发** —— 只测「执行该算子后状态变了」不够，
  //   那证明不了链路通。
  const { passiveOps } = sim();
  const expected = ['move_forward', 'create_card', 'peek_deck', 'shield', 'transfer_resource', 'modify_judgement', 'certify_free_pass'];
  for (const op of expected) {
    const n = passiveOps.get(op) ?? 0;
    assert.ok(n > 0, `被动 ${op} 在真实对局中从未触发（死机制）`);
  }
});

test('平衡回归：对峙在真实对局中发生过（B13 可达性）', () => {
  // ⚠️ B13 之前：引擎里只有一个无人调用的半成品 op `compare_cards` ⇒ 对峙**不可达**。
  const { duelTotal } = sim();
  assert.ok(duelTotal > 0, '对峙在真实对局中从未发生（死机制）');
});

test('平衡回归：位次胜率极差 < 4pp（B11 席位制：先动不再决定胜负）', () => {
  const { posRates } = sim();
  const spread = Math.max(...posRates) - Math.min(...posRates);
  // B11 前：位次胜率严格单调递减，8 人局极差 13.0pp（首个登顶者 77.6% 直接获胜）。
  // B11 活人席计分制 + 终局得分公式后：8000 局下实测 1.1pp。
  assert.ok(spread < 4, `位次胜率最大差 ${spread.toFixed(1)}pp 应 < 4pp（B11 前约 13pp）`);
});

// ---------- 已知遗留项（V1.1）----------

test.todo('V1.1：主题包全量差异化（各自独立的卡牌池 / 事件池 / 身份设计）', () => {
  // B8 已达成最小可行差异化（标识 / 术语 / 认证题 / 1–2 张标志卡），全量差异化属 V1.1。
});
