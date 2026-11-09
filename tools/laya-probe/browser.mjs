// P4 浏览器可达性探针（B58 · Task 16）。
//
// 验的是**产品承诺**：「数字轨单文件 HTML **双击即玩**（file://）**能不能叫到本地 sidecar**」。
// ⚠️ 页面必须用 `file://` 打开（用 http 预览等于**把要验的东西换掉**）⇒ 结论无效。
//
// 两条硬约束（缺一即无效）：
//   ① `page.on('console')` 与 `page.on('pageerror')` 必须在 `page.goto(...)` **之前**注册
//      —— 否则收不到 CORS / PNA 报错，而**报错正是失败层次的唯一证据**；
//   ② 页面必须用 `pathToFileURL` 以 `file://` 打开 `dist/发布包/数字轨/创界山-活人认证.html`
//      （门 ④ / build:package 的产物）。
//
// 输出：`docs/预研/data/p4-browser.json`（含 console 错误原文 + 失败分类）。

import { createRequire } from 'node:module';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.CM_REPO_ROOT !== undefined
  ? resolve(process.env.CM_REPO_ROOT)
  : process.cwd();
const require = createRequire(resolve(ROOT, 'package.json'));
const { chromium } = require('playwright');

/** 被验的页面：门 ④ / build:package 的**数字轨单文件**产物。 */
const PAGE = process.env.LAYA_P4_PAGE !== undefined
  ? resolve(process.env.LAYA_P4_PAGE)
  : resolve(ROOT, 'dist', '发布包', '数字轨', '创界山-活人认证.html');
/** 反代地址（Task 13 的产物）。 */
const PROXY = process.env.LAYA_PROXY_URL ?? 'http://127.0.0.1:8711';
/** 产出路径。 */
const OUT = resolve(ROOT, 'docs/预研/data/p4-browser.json');

/**
 * 把 console 错误原文归类到四种失败层次之一。
 *
 * ⚠️ **分类依据必须是错误原文**（不能靠猜）⇒ 命中不到就归 `unknown` 并保留原文。
 *
 * @param {string[]} errors console / pageerror 原文
 * @returns {string} 分类
 */
function classify(errors, upstreamUnavailable) {
  const text = errors.join('\n');
  // ⚠️ 「上游不在」**不是**可达性失败（反代按设计折叠成 503）⇒ 单独归类，别落进 unknown。
  if (upstreamUnavailable) { return '上游不可达（反代按设计折叠成 503；非 CORS/可达性问题）'; }
  if (text === '') { return 'none'; }
  // ① 预检方法不被允许（OPTIONS 被拒）
  if (/405|method not allowed/i.test(text)) { return 'OPTIONS 405（预检方法不被允许）'; }
  // ② 响应缺 ACAO（浏览器报 CORS 头缺失）
  if (/access-control-allow-origin|cors/i.test(text)) { return '缺 Access-Control-Allow-Origin（CORS 头缺失）'; }
  // ③ 私有网络访问（PNA）预检被拒
  if (/private network|private-network|local network access/i.test(text)) { return '私有网络访问（PNA）预检被拒'; }
  // ④ 混合内容（file:// 页面 fetch http:// 被拦）
  if (/mixed content|blocked.*insecure|not allowed to load/i.test(text)) { return '混合内容被拦（file:// → http://）'; }
  return 'unknown（见 consoleErrors 原文）';
}

const result = {
  page: PAGE,
  pageUrl: '',
  proxy: PROXY,
  health: { reachable: false, status: 0, error: null },
  post: { status: 0, ok: false, error: null, body: null },
  consoleErrors: [],
  failureClass: 'none',
  conclusion: '',
};

if (!existsSync(PAGE)) {
  console.error(`[p4] 页面产物不存在：${PAGE}（先跑 npm run build:package）`);
  result.conclusion = '未执行：页面产物不存在';
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// ⚠️ **硬约束 ①**：console / pageerror 监听**必须在 goto 之前**注册
//   （否则收不到 CORS / PNA 报错 —— 而报错正是失败层次的唯一证据）。
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push('console: ' + m.text()); } });
page.on('pageerror', (e) => { consoleErrors.push('pageerror: ' + e.message); });

// ⚠️ **硬约束 ②**：用 `file://` 打开（不得改成 http 预览）。
const fileUrl = pathToFileURL(PAGE).href;
result.pageUrl = fileUrl;
await page.goto(fileUrl);

// ---- ① GET /health ----
const health = await page.evaluate(async (proxy) => {
  try {
    const res = await fetch(proxy + '/health');
    const text = await res.text();
    return { reachable: true, status: res.status, body: text.slice(0, 200) };
  } catch (e) {
    return { reachable: false, status: 0, body: null, error: String(e?.message ?? e) };
  }
}, PROXY);
result.health = { reachable: health.reachable === true, status: health.status, error: health.error ?? null };

// ---- ② POST /v1/systemone（两选项 choice ⇒ 必触发预检）----
const post = await page.evaluate(async (proxy) => {
  try {
    const res = await fetch(proxy + '/v1/systemone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: '第1轮 第1手 阶段行动\n座0 身份 山主 阵营 守序 位1 血3/3 资源5 持牌0 装备0 席0',
        questions: {
          act: {
            type: 'choice',
            instructions: '现在轮到该玩家行动，应选哪个动作？',
            criteria: { move: '行棋：掷骰前进', ask: '问天：掷指令骰' },
          },
        },
      }),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: String(e?.message ?? e) };
  }
}, PROXY);
result.post = { status: post.status, ok: post.ok, error: post.error ?? null, body: post.body };

result.consoleErrors = consoleErrors;
const upstreamUnavailable = result.post.status === 503
  && typeof result.post.body === 'string'
  && result.post.body.includes('unavailable');
result.failureClass = classify(consoleErrors, upstreamUnavailable);
result.upstreamUnavailable = upstreamUnavailable;

// ---- 结论（措辞固定：产品级取舍，不做技术绕过）----
const reachable = result.health.reachable === true
  && (result.post.status === 200 || result.post.status === 503);
if (reachable) {
  result.conclusion = '可达：file:// 双击即玩的单文件页面能调用反代（CORS 预检通过）。';
} else {
  result.conclusion = '不可达：V2 必须走 http 预览服务，放弃双击即玩。';
}

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
console.log('输出 → ' + OUT);
