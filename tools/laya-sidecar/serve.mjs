// Laya sidecar 反代（B55 · Task 13）。
//
// 职责**严格限于**（计划原文）：对拍 → 绑 `127.0.0.1` → CORS/OPTIONS → 转发 → 30s 超时 → 503 折叠。
// **不写任何决策逻辑** —— 本文件只搬运与包装，不参与「选哪个动作」。
//
// 为什么需要反代（而不是浏览器直连官方 serve）：
//   ① 官方 serve **无 CORS** ⇒ `file://` 双击即玩的单文件页面**跨源请求会被浏览器拦**；
//   ② 反代是**唯一的 SKIP 落点** —— 上游不在时返回 `503 {"unavailable":true}` 且**进程不退**
//      ⇒ 探针可以把它当成「无服务」信号，而不是崩溃。
//
// 用法：
//   node tools/laya-sidecar/serve.mjs [--weights <path>] [--port <n>] [--upstream <url>]
//   - `--weights`  给出则做权重对拍（不符 ⇒ **退出码 1** + stderr「对拍失败」）；不给则**跳过**并
//                   在 stderr 显式说明（跳过是**可见**的，不是静默）。
//   - `--port`     反代端口（默认取 `LAYA_PROXY_PORT`，再默认 8711）。
//   - `--upstream` 上游官方 serve（默认 `http://127.0.0.1:8712`）。

import { createServer } from 'node:http';

import { verifyWeight } from './weights.mjs';

/** 绑定地址**硬编码环回**（不接受任何环境变量改绑定 —— 防误暴露到局域网）。 */
const HOST = '127.0.0.1';
/** 转发超时（毫秒）。 */
const UPSTREAM_TIMEOUT_MS = 30_000;
/** 恒带的三条 CORS 头（计划锁定的字面量，测试按**逐字**比对）。 */
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

/** 解析命令行参数（简单 k=v）。 */
function parseArgs(argv) {
  const out = { weights: '', port: 0, upstream: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--weights') { out.weights = String(argv[i + 1] ?? ''); i += 1; }
    else if (a === '--port') { out.port = Number(argv[i + 1] ?? 0); i += 1; }
    else if (a === '--upstream') { out.upstream = String(argv[i + 1] ?? ''); i += 1; }
  }
  return out;
}

/** 上游不可达时的响应体（**形状固定**，探针与测试都按它判定）。 */
export const UNAVAILABLE_BODY = JSON.stringify({ unavailable: true });

const args = parseArgs(process.argv.slice(2));
const PORT = args.port > 0 ? args.port : Number(process.env.LAYA_PROXY_PORT ?? 8711);
const UPSTREAM = args.upstream !== '' ? args.upstream : 'http://127.0.0.1:8712';

// ---------- ① 对拍（先做；不符 ⇒ 拒启）----------
if (args.weights !== '') {
  const verdict = await verifyWeight(args.weights);
  if (!verdict.ok) {
    process.stderr.write(`[serve] 对拍失败：${verdict.detail}\n`);
    process.exit(1);
  }
  process.stderr.write(`[serve] 权重对拍通过：${args.weights}\n`);
} else {
  process.stderr.write('[serve] 未指定 --weights ⇒ **跳过权重对拍**（生产使用请显式指定）\n');
}

// ---------- ② 反代 ----------

/**
 * 转发到上游。
 *
 * ⚠️ **失败原因必须可见**（B55 修）：原实现把 fetch 的异常**吞成 null** ⇒ 上游报什么都只回一个
 *   沉默的 503 ⇒ 运维无法区分「上游没起」「上游超时」「上游崩了」。
 *   ⇒ 现在区分三种：**连接失败** / **超时** / **上游有响应但非 2xx**（后者原样透传，不折叠）。
 *
 * @returns {Promise<{status: number, text: string} | {error: string, kind: string} | null>}
 */
function forward(method, path, body) {
  return new Promise((done) => {
    const url = new URL(path, UPSTREAM);
    const client = globalThis.fetch;
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, UPSTREAM_TIMEOUT_MS);
    client(url, {
      method,
      headers: body !== null ? { 'content-type': 'application/json' } : {},
      body: body === null ? undefined : body,
      signal: ac.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        const text = await res.text();
        done({ status: res.status, text });
      })
      .catch((e) => {
        clearTimeout(timer);
        const kind = timedOut ? 'timeout' : 'unreachable';
        const detail = timedOut
          ? `上游超时（>${String(UPSTREAM_TIMEOUT_MS / 1000)}s）：${url.origin}${url.pathname}`
          : `上游不可达：${url.origin}${url.pathname}（${String(e?.message ?? e)}）`;
        // ⚠️ 失败原因**写进 stderr**（可见）——折叠成 503 之前先让人知道真实原因。
        process.stderr.write(`[serve] ${detail}\n`);
        done({ error: detail, kind });
      });
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const path = url.pathname;

  // OPTIONS ⇒ 204（预检）
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'content-length': '0' });
    res.end();
    return;
  }

  // 只代理计划约定的两个端点（**不写决策逻辑**，只搬运）
  if (path !== '/health' && path !== '/v1/systemone') {
    res.writeHead(404, { ...CORS_HEADERS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not proxied', path }));
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null;
    const upstream = await forward(req.method ?? 'GET', path, body);
    if (upstream === null || upstream.error !== undefined) {
      // 上游不可达/超时 ⇒ 503 + 固定形状，**进程不退**（真实原因已写 stderr）
      res.writeHead(503, { ...CORS_HEADERS, 'content-type': 'application/json' });
      res.end(UNAVAILABLE_BODY);
      return;
    }
    // 上游有响应 ⇒ **原样透传状态码与正文**（不折叠、不改写）
    res.writeHead(upstream.status, { ...CORS_HEADERS, 'content-type': 'application/json' });
    res.end(upstream.text);
  });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[serve] 反代在 http://${HOST}:${PORT} ⇒ 上游 ${UPSTREAM}\n`);
});

// 优雅退出（编排脚本会转发 SIGTERM）
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
