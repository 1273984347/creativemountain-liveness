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
  return { seatRates, identityRates, posRates };
}

// 400 局 × 4 套主题 = 1600 局（样本再少时噪声会盖过信号）
const SIM = { games: 400, players: 8 };

/**
 * 模拟结果缓存 —— 跑一次、复用多次。
 *
 * ⚠️ 没有缓存的话每条断言都要重跑 1600 局（4 倍代价），
 *   而且**并行跑同一份模拟**会让测试时长得离谱。
 */
let cached: { seatRates: number[]; identityRates: number[]; posRates: number[] } | null = null;
function sim(): { seatRates: number[]; identityRates: number[]; posRates: number[] } {
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

// ---------- 已知遗留项（V1.1）----------

test.todo('V1.1：位次胜率 spread 应 < 4pp（消除残余先手优势）', () => {
  // 当前实测：1 位 19.7% → 8 位 8.3%，spread **11.4pp** 且严格单调递减。
  // 根源：规则链「先登顶 → 77.6% 直接获胜」⇒ 登顶时间几乎决定胜负。
  // 修正方向（抢先链规则级改动）：让**认证达成时间与登顶时间解耦**。
  //
  // ⚠️ node:test 语义：`todo` 用例**会被执行**（失败不计入失败数）。
  //   故此处只**记录读数**、不做判定 —— 否则每次跑都吐一个 AssertionError 堆栈，
  //   看起来像失败。V1.1 修正后把本条转正，届时打开下面的断言：
  //     assert.ok(spread < 4, `位次胜率最大差 ${spread.toFixed(1)}pp 应 < 4pp`);
  // 注意：样本量已提到 4000 局（位次胜率噪声 ≈ 3pp），阈值 4pp 才可靠。
  const { posRates } = runSim(1000, 8);
  const spread = Math.max(...posRates) - Math.min(...posRates);
  console.log('  [V1.1 遗留] 当前位次胜率 spread = ' + spread.toFixed(1) + 'pp（目标 < 4pp）');
});
