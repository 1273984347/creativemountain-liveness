// sidecar 常驻编排（B55 · Task 12 的「常驻编排」部分）。
//
// 一条命令把两层服务拉起来，并**测量就绪秒数**（P2 的加载耗时读数来源）：
//   ① 官方 serve（`launch.py`，硬绑 127.0.0.1:8712）—— 本地权重、离线；
//   ② Node 反代（`serve.mjs`，127.0.0.1:8711）—— 补 CORS、折叠「上游不在」。
//
// ⚠️ **前台运行**（不 daemonize）：Ctrl+C 优雅停掉两个子进程 ⇒
//   不会留下「无人看管的野进程」（B54 的教训：常驻属交付物，不能随手留）。
//
// 用法：
//   node tools/laya-sidecar/up.mjs [--weights <path>] [--serve-port <n>] [--upstream-port <n>]
//   - `--weights`  传给反代做权重对拍（生产建议给；不给则反代**可见地**跳过对拍）
//   - `--serve-port`  官方 serve 端口（默认 `LAYA_SERVE_PORT` 或 8712）
//   - `--upstream-port` 反代端口（默认 `LAYA_PROXY_PORT` 或 8711）

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const LAUNCH = resolve(ROOT, 'tools/laya-sidecar/launch.py');
const SERVE = resolve(ROOT, 'tools/laya-sidecar/serve.mjs');
const PY = process.env.LAYA_PY ?? resolve(ROOT, '.laya-venv/Scripts/python.exe');

/** 解析命令行参数。 */
function parseArgs(argv) {
  const out = { weights: '', servePort: 0, upstreamPort: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--weights') { out.weights = String(argv[i + 1] ?? ''); i += 1; }
    else if (a === '--serve-port') { out.servePort = Number(argv[i + 1] ?? 0); i += 1; }
    else if (a === '--upstream-port') { out.upstreamPort = Number(argv[i + 1] ?? 0); i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
/** 编排起点（用于算总就绪秒数，含权重冷加载）。 */
const T0 = Date.now();
const SERVE_PORT = args.servePort > 0 ? args.servePort : Number(process.env.LAYA_SERVE_PORT ?? 8712);
const PROXY_PORT = args.upstreamPort > 0 ? args.upstreamPort : Number(process.env.LAYA_PROXY_PORT ?? 8711);

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** 探 HTTP 端点是否返回 200（用 fetch ⇒ 只在真正就绪时为真）。 */
async function waitHttp(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) { return (Date.now() - t0) / 1000; }
    } catch {
      // 还没起来 ⇒ 继续等
    }
    await sleep(200);
  }
  return null;
}

/** 子进程日志转前缀转发（便于人工区分两层）。 */
function pipe(tag, proc) {
  const fwd = (stream, out) => {
    stream?.on('data', (c) => {
      for (const line of String(c).split(/\r?\n/)) {
        if (line.trim() !== '') { out.write(`[${tag}] ${line}\n`); }
      }
    });
  };
  fwd(proc.stdout, process.stdout);
  fwd(proc.stderr, process.stderr);
}

const children = [];

// ---------- ① 官方 serve ----------
const serve = spawn(PY, [LAUNCH], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, LAYA_SERVE_PORT: String(SERVE_PORT) },
});
pipe('serve', serve);
children.push(serve);

const serveReady = await waitHttp(`http://127.0.0.1:${String(SERVE_PORT)}/health`, 120_000);
if (serveReady === null) {
  process.stderr.write(`[up] 官方 serve 未在 120s 内就绪（127.0.0.1:${String(SERVE_PORT)}）⇒ 放弃\n`);
  for (const c of children) { c.kill('SIGTERM'); }
  process.exit(1);
}
process.stderr.write(`[up] 官方 serve 监听就绪：${serveReady.toFixed(2)}s（http://127.0.0.1:${String(SERVE_PORT)}）\n`);

// ---------- ①b 预热（**必须**：否则首次推理会触发 643 MB 权重冷加载）----------
//
// ⚠️ **为什么必须预热（B55 实测）**：模型的权重是**懒加载**的 ⇒ 第一次推理才真正加载
//   ⇒ 实测冷加载耗时**超过反代的 30s 超时** ⇒ 不预热的话，**第一个用户请求必得 503**。
//   ⇒ 预热一次，让「就绪」意味着「能立刻应答」。
const warmBody = {
  state: '预热',
  questions: {
    act: {
      type: 'choice',
      instructions: '预热',
      criteria: { move: '行棋' },
    },
  },
};
const warmT0 = Date.now();
try {
  const warm = await fetch(`http://127.0.0.1:${String(SERVE_PORT)}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(warmBody),
  });
  const warmMs = Date.now() - warmT0;
  process.stderr.write(
    `[up] 预热完成：${warmMs}ms（status=${String(warm.status)}）⇒ 模型已加载，后续请求走热路径\n`,
  );
} catch (e) {
  process.stderr.write(`[up] ⚠️ 预热失败：${String(e?.message ?? e)}（不影响服务，但首次推理可能慢）\n`);
}

// ---------- ② 反代 ----------
const proxyArgs = ['--port', String(PROXY_PORT), '--upstream', `http://127.0.0.1:${String(SERVE_PORT)}`];
if (args.weights !== '') { proxyArgs.push('--weights', args.weights); }
const proxy = spawn(process.execPath, [SERVE, ...proxyArgs], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
pipe('proxy', proxy);
children.push(proxy);

const proxyReady = await waitHttp(`http://127.0.0.1:${String(PROXY_PORT)}/health`, 30_000);
if (proxyReady === null) {
  process.stderr.write(`[up] 反代未在 30s 内就绪（127.0.0.1:${String(PROXY_PORT)}）⇒ 放弃\n`);
  for (const c of children) { c.kill('SIGTERM'); }
  process.exit(1);
}
process.stderr.write(`[up] 反代就绪：${proxyReady.toFixed(2)}s（http://127.0.0.1:${String(PROXY_PORT)}）\n`);

// ---------- ③ 常驻 ----------
const totalReady = (Date.now() - T0) / 1000;
process.stderr.write(
  `[up] READY ⇒ 官方 serve :${String(SERVE_PORT)} · 反代 :${String(PROXY_PORT)}`
  + `（总就绪 ${totalReady.toFixed(2)}s，含权重冷加载；Ctrl+C 停止两层）\n`,
);

let stopping = false;
const shutdown = () => {
  if (stopping) { return; }
  stopping = true;
  process.stderr.write('[up] 停止两层…\n');
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* 已退出 */ }
  }
  setTimeout(() => {
    for (const c of children) {
      if (c.exitCode === null) { try { c.kill('SIGKILL'); } catch { /* 已退出 */ } }
    }
    process.exit(0);
  }, 2000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 子进程意外退出 ⇒ 编排进程一起退（不留半截状态）。
for (const c of children) {
  c.on('exit', (code) => {
    if (!stopping) {
      process.stderr.write(`[up] 子进程退出 code=${String(code)} ⇒ 编排一并停止\n`);
      shutdown();
    }
  });
}
