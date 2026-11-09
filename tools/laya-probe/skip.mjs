// P5 无服务降级自证（B59 · Task 17）。
//
// 验的是一条**产品纪律**：sidecar **不在**时，探针必须**安静地跳过**而不是崩掉。
//
// 三种固定输出形状（**逐字固定**，消费方按它判读）：
//   ① `SKIP {"reason":"sidecar-ready","status":<int>,"records":<int>}`
//   ② `SKIP {"reason":"proxy-says-unavailable","status":<int>,"records":<int>}`
//   ③ `SKIP {"reason":"no-sidecar","error":"<≤120字符>","records":<int>}`
//
// ⚠️ **退出码恒为 0**：无服务**不是失败**（判据 P5：首词 SKIP 且退出码 = 0）。
// ⚠️ **不依赖模型、不依赖权重** ⇒ 可进常驻测试。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
/** 反代端口（默认 8711）；测试用 1 ⇒ 必定连不上 ⇒ 走「无 sidecar」分支。 */
const PORT = Number(process.env.LAYA_PROXY_PORT ?? 8711);
/** 健康探测超时（毫秒）。 */
const TIMEOUT_MS = 3000;
/** 决策点记录目录（可能不存在 —— 记录是生成物，不入库）。 */
const DATA_DIR = resolve(ROOT, 'docs/预研/data');

/** 决策点记录条数（**只数行数，不读内容** —— 文件可能上百 MB）。 */
function countRecords() {
  try {
    const files = readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('decisions-') && f.endsWith('.jsonl'))
      .filter((f) => f !== 'decisions-sample.jsonl');
    let total = 0;
    for (const f of files) {
      const size = statSync(resolve(DATA_DIR, f)).size;
      if (size === 0) { continue; }
      // 逐字节数换行符（不把整个文件读进内存）。
      const buf = readFileSync(resolve(DATA_DIR, f));
      for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 10) { total += 1; }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** 截断错误文本（形状要求 ≤120 字符）。 */
function clip(text) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

const records = countRecords();

let status = 0;
let body = null;
let error = null;
try {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const res = await fetch(`http://127.0.0.1:${String(PORT)}/health`, { signal: ac.signal });
  clearTimeout(timer);
  status = res.status;
  body = await res.text();
} catch (e) {
  error = clip(e?.message ?? e);
}

if (error !== null) {
  // ③ 连不上（无反代 ⇒ 无 sidecar）
  console.log(`SKIP ${JSON.stringify({ reason: 'no-sidecar', error, records })}`);
} else if (status === 503) {
  // ② 反代在，但**上游**不可达（反代按设计折叠成 503 + unavailable）
  console.log(`SKIP ${JSON.stringify({ reason: 'proxy-says-unavailable', status, records })}`);
} else if (status === 200) {
  // ① sidecar 就绪
  console.log(`SKIP ${JSON.stringify({ reason: 'sidecar-ready', status, records })}`);
} else {
  // 兜底：形状固定为 ③（附上状态码，便于排查）
  console.log(`SKIP ${JSON.stringify({ reason: 'no-sidecar', error: clip(`反代返回意外状态 ${String(status)}`), records })}`);
}

// ⚠️ **退出码恒 0**：无服务不是失败（判据 P5）。
process.exit(0);
