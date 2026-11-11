// sim 决策点记录器的常驻测试（B56 · Task 14）。
//
// 第一不变量：**报告文件逐字不变** —— 记录器是纯旁路，开了它也不能改变任何对局行为。
//   ⚠️ 判据是**文件 diff 为空**，不是 stdout 计数行（stdout 本来就不含逐局细节）。
//
// 第二不变量：**默认关闭** ⇒ 不带 `--record-decisions` 时**不产出**任何 JSONL。
//
// ⚠️ 这些用例会真跑 sim（2 局 × 1 主题 ⇒ 秒级）⇒ 门 ② 可接受。
// ⚠️ 全部产物写**系统临时目录** ⇒ 共享工作树零写入。
// ⚠️ 最后一条用 12 局取证（实测 <1s，与门 9 的 30 局、门 12 的 100 局同量级以下）
//   ⇒ 它要覆盖到「对峙」这条只在少数局里触发的记录路径，2 局的固定 seed 轨迹里对峙桶是空的。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { actionKey, actionFromKey } from '../../engine/core/action-key.ts';
import { normalizeLegacyKey } from '../../tools/laya-probe/key-normalize.mjs';

const ROOT = process.cwd();
const SIM = resolve(ROOT, 'tests/sim/run.mjs');

/** 跑一次 sim（不经 shell ⇒ 退出码与输出都可信）。 */
function runSim(args: readonly string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SIM, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    // ⚠️ strict 下 catch 参数是 `unknown` ⇒ 需显式断言形状（否则 tsc 报 TS2339）。
    const err = e as { status?: number; stdout?: string };
    return { code: typeof err.status === 'number' ? err.status : -1, out: String(err.stdout ?? '') };
  }
}

test('sim 决策点记录器：默认关闭 ⇒ 不产出 JSONL，且报告照常生成', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const report = resolve(dir, 'on.md');
    const r = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--out', report]);
    assert.equal(r.code, 0, 'sim 必须成功退出');
    assert.ok(existsSync(report), '报告文件必须生成');
    assert.equal(existsSync(resolve(dir, 'on.jsonl')), false, '不带开关时不得产出 JSONL');
    assert.ok(readFileSync(report, 'utf8').length > 0, '报告不得为空');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sim 决策点记录器：**报告逐字不变**（开了开关也不改变对局行为）', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const on = resolve(dir, 'on.md');
    const rec = resolve(dir, 'on-rec.md');
    const jsonl = resolve(dir, 'on.jsonl');
    const a = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--out', on]);
    assert.equal(a.code, 0, '不带开关的 sim 必须成功退出');
    const b = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--record-decisions', jsonl, '--out', rec]);
    assert.equal(b.code, 0, '带开关的 sim 必须成功退出');
    const textOn = readFileSync(on, 'utf8');
    const textRec = readFileSync(rec, 'utf8');
    assert.equal(textRec, textOn, '⚠️ 报告必须**逐字一致** —— 记录器是纯旁路，不得改变任何对局行为');
    assert.ok(existsSync(jsonl), '带开关时必须产出 JSONL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sim 决策点记录器：JSONL 行字段恰为 11 个、seq 从 0 开始（seq == 行号）、themeId 正确', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const jsonl = resolve(dir, 'on.jsonl');
    const out = resolve(dir, 'on.md');
    const r = runSim(['--themes', 'xianxia2026', '--players', '4', '--games', '2', '--record-decisions', jsonl, '--out', out]);
    assert.equal(r.code, 0, 'sim 必须成功退出');
    const lines = readFileSync(jsonl, 'utf8').split('\n').filter((l) => l.trim() !== '');
    assert.ok(lines.length > 10, `决策点条数应 > 10，实际 ${String(lines.length)}`);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.deepEqual(
      Object.keys(parsed[0] ?? {}),
      ['seq', 'themeId', 'players', 'seed', 'round', 'turnIndex', 'seat', 'phase', 'face', 'heuristic', 'state'],
      '字段必须恰为这 11 个且顺序固定');
    assert.equal(parsed[1]?.seq, 1, '第二行的 seq 必须是 1（seq 从 0 开始 ⇒ seq == 行号）');
    assert.equal(parsed[0]?.themeId, 'xianxia2026', 'themeId 必须正确');
    assert.equal(parsed[0]?.players, 4, 'players 必须正确');
    assert.equal(typeof parsed[0]?.state, 'string', 'state 必须是 stateToJson 的文本');
    assert.equal(typeof parsed[0]?.heuristic, 'string', 'heuristic 必须是动作 key 字符串');
    // ⚠️ `parsed` 的值类型是 `unknown` ⇒ 直接 `?? ''` 后仍是 `{}` ⇒ 须先 `String(...)`（TS2339）。
    const firstHeuristic = String(parsed[0]?.heuristic ?? '');
    assert.ok(firstHeuristic.length > 0, 'heuristic 不得为空');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ⚠️ B70 修复轮 1（评审发现 I-1）：上面三条只钉住「heuristic 是**非空字符串**」——
//   格式回归（记录器退回手拼 / 换成等价模板串写法）在这里全是绿的。
//   ⇒ 本条把「**记录器实际写出的每一行 key 都是 actionKey 的规范形**」变成常驻行为断言，
//   取代此前只做一次的手工取证；它同时是 P6 的立足点：读侧归一化对**新写入的行**必须是空操作。
// ⚠️ B73：局数与「对峙桶非空」这个前提绑定（实测 12 局恰 12 条对峙；2/4/8 局时为 0/2/6）。
//   日后任何**合法**的启发式 / 牌池 / seed 公式改动都可能把对峙桶清零 ⇒ 改轨迹时先重估本常量。
const DUEL_BUCKET_GAMES = 12;

test('sim 决策点记录器：写出的 heuristic 逐条是规范形（含对峙桶）', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-rec-'));
  try {
    const jsonl = resolve(dir, 'on.jsonl');
    const out = resolve(dir, 'on.md');
    // 固定 seed 轨迹（`seedBase + g*97 + players*13 + themeSeed`）⇒ 同参数同结果，不是抽奖。
    const r = runSim([
      '--themes', 'xianxia2026', '--players', '4', '--games', String(DUEL_BUCKET_GAMES),
      '--record-decisions', jsonl, '--out', out,
    ]);
    assert.equal(r.code, 0, 'sim 必须成功退出');
    assert.ok(existsSync(jsonl), '带开关时必须产出 JSONL');
    const keys = readFileSync(jsonl, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => String((JSON.parse(l) as Record<string, unknown>).heuristic));
    assert.ok(keys.length > 100, `取证规模够大才有说服力（实际决策点 ${String(keys.length)}）`);

    // ① 逐条严格往返：能被反解、且反解后重新编码与原文**逐字符相等** ⇒ 规范形。
    //    手拼的旧形在这一条直接抛错（反解层只认规范形），多余尾段/空段同理。
    // ② 旧形零残留：任何一行都不得含手拼的下划线形（比①更早、更直白地指出回归种类）。
    // ③ 读侧归一化对新行必须是**空操作** ⇒ 写读两侧同一把尺，P6 不再靠格式补丁对齐。
    const duel: string[] = [];
    for (const k of keys) {
      assert.equal(actionKey(actionFromKey(k)), k, `记录器写出的 key 必须可严格反解并往返相等：${k}`);
      assert.equal(k.includes('duel_card'), false, `记录器不得再写出手拼的下划线形：${k}`);
      assert.equal(normalizeLegacyKey(k), k, `新写入的 key 应已是规范形 ⇒ 归一化必须空操作：${k}`);
      if (k.startsWith('duel')) { duel.push(k); }
    }
    // ④ 对峙桶必须**非空**，否则上面几条对 `duel` 这一族是空转（假绿）。
    assert.ok(duel.length > 0, `${String(DUEL_BUCKET_GAMES)} 局轨迹里必须出现对峙记录，否则本守卫覆盖不到对峙桶`);
    for (const k of duel) {
      assert.match(k, /^duel:card:[^:]+$/, `对峙记录必须是三段规范形：${k}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
