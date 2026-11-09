// sidecar 反代的常驻负样本（B55 · Task 13）。
//
// 三条用例，**各用独立端口**（计划硬性要求：禁止三条共用 8711）。
//
// ⚠️ **这些用例不得依赖「官方服务在跑」** ⇒ 门 ②（`node --test tests/**/*.test.ts`）
//   在**没有 sidecar 的机器上也必须绿** ⇒ 用例自己起/停轻量反代，
//   且**不传 `--weights`**（跳过 643 MB 对拍 ⇒ 秒级，不拖慢门禁）。
//   权重对拍本身由用例 ① 单独验（用**字节数不符的临时小文件** ⇒ 立即失败）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const SERVE = resolve(ROOT, 'tools/laya-sidecar/serve.mjs');

/** 三条用例各占一个端口（互不干扰 ⇒ 可并发跑）。 */
const PORT_A = 18731;
const PORT_B = 18732;
const PORT_C = 18733;
/**
 * 用例 ② 的**上游**端口：必须指向一个**确定无人使用**的端口。
 *
 * ⚠️ **不能依赖「官方服务恰好没在跑」**（B55 实测踩到）：本批验证时编排进程正占着 8712
 *   ⇒ 反代转发成功 ⇒ 断言「503」失败 ⇒ 用例**依赖了环境状态**。
 *   ⇒ 显式指向一个专用端口（18999）⇒ 上游必定不可达 ⇒ 结果与环境无关。
 */
const DEAD_UPSTREAM_PORT = 18999;

/** 起一个反代子进程，等它监听后返回句柄。 */
async function startProxy(port: number, extraArgs: readonly string[] = []): Promise<{ proc: ReturnType<typeof spawn>; stderr: () => string; stop: () => Promise<void> }> {
  const proc = spawn(process.execPath, [SERVE, '--port', String(port), ...extraArgs], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  proc.stderr?.on('data', (c) => { err += String(c); });
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (await probe(port)) { break; }
    await sleep(120);
  }
  return {
    proc,
    stderr: () => err,
    stop: async () => {
      proc.kill('SIGTERM');
      await sleep(200);
      if (proc.exitCode === null) { proc.kill('SIGKILL'); }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** 探端口是否可连（用 TCP，不发 HTTP ⇒ 不产生 404 噪音）。 */
async function probe(port: number): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((done) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.on('connect', () => { sock.destroy(); done(true); });
    sock.on('error', () => done(false));
  });
}

// ---------- ① 权重对拍不符 ⇒ 拒启（退出码 ≠ 0 + stderr 点名）----------
test('sidecar 反代：权重对拍不符 ⇒ 拒启（退出码非 0、stderr 点名「对拍失败」）', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'cm-guard-'));
  try {
    // 字节数**故意不符**的临时文件（1 字节 ⇒ 立即失败，不必读 643 MB）
    const bad = resolve(dir, 'bad-weights.safetensors');
    writeFileSync(bad, 'x', 'utf8');
    const { code, stderr } = await new Promise<{ code: number; stderr: string }>((done) => {
      const proc = spawn(process.execPath, [SERVE, '--port', String(PORT_A), '--weights', bad], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      proc.stderr?.on('data', (c) => { err += String(c); });
      proc.on('close', (c) => { done({ code: c ?? -1, stderr: err }); });
    });
    assert.notEqual(code, 0, '对拍不符必须以非零退出码拒启');
    assert.match(stderr, /对拍失败/, 'stderr 必须点名「对拍失败」');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ② 上游不在 ⇒ 503 + {"unavailable":true} + ACAO 头 ----------
test('sidecar 反代：上游不可达 ⇒ 503 + body {"unavailable":true} + 响应头含 ACAO', async () => {
  const h = await startProxy(PORT_B, ['--upstream', `http://127.0.0.1:${String(DEAD_UPSTREAM_PORT)}`]);
  try {
    // 上游指向专用端口 18999 ⇒ 必定不可达（**不依赖本机是否恰好有服务在跑**）
    const res = await fetch(`http://127.0.0.1:${String(PORT_B)}/health`);
    assert.equal(res.status, 503, '上游不可达必须折叠成 503（而不是崩溃/连不上）');
    const body = await res.json() as { unavailable?: boolean };
    assert.equal(body.unavailable, true, 'body 必须是 {"unavailable":true}');
    assert.equal(res.headers.get('access-control-allow-origin'), '*', '503 响应也必须带 ACAO');
    // ⚠️ **失败原因必须可见**：反代不得把上游的真实失败**吞成沉默的 503**
    //   ⇒ stderr 必须点名「上游不可达」⇒ 运维能区分「上游没起」与「上游超时」。
    assert.match(h.stderr(), /上游不可达/, '反代必须把上游失败原因写进 stderr（不得沉默）');
  } finally {
    await h.stop();
  }
});

// ---------- ③ OPTIONS 预检 ⇒ 204 + 三个 CORS 头 ----------
test('sidecar 反代：OPTIONS /v1/systemone ⇒ 204 且 CORS 三头齐全', async () => {
  const h = await startProxy(PORT_C);
  try {
    const res = await fetch(`http://127.0.0.1:${String(PORT_C)}/v1/systemone`, { method: 'OPTIONS' });
    assert.equal(res.status, 204, '预检必须 204');
    assert.equal(res.headers.get('access-control-allow-methods'), 'POST, GET, OPTIONS',
      'allow-methods 必须逐字为「POST, GET, OPTIONS」');
    assert.equal(res.headers.get('access-control-allow-origin'), '*', '必须带 ACAO');
    assert.equal(res.headers.get('access-control-allow-headers'), 'content-type', '必须带 allow-headers');
  } finally {
    await h.stop();
  }
});
