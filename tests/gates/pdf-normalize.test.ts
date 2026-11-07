// PDF 归一化门禁的负样本与实证
//
// 证明三件事：
//   1. **原始字节不可比**——同一份 HTML 两次生成，PDF 哈希必不同（构建时刻所致）。
//   2. **归一化后可比**——剔掉时间戳值后，两次生成摘要相同；
//      而内容真变了时，归一化摘要**必须不同**（否则门禁失效）。
//   3. **/Title 来自源文件名**——Chromium 在 HTML 无 `<title>` 时用它当文档标题。
//      ⇒ build-print **必须显式输出 `<title>`**，否则 /Title 会随模板文件名漂移。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { normalizePdfBytes, normalizedPdfDigest, rawPdfDigest } from '../../tools/pdf-normalize.mjs';

/** 找 Edge（Windows 自带 headless Chrome）。找不到则跳过依赖它的用例。 */
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE: string | undefined = EDGE_CANDIDATES.find((p) => existsSync(p));

/**
 * 等待文件出现且大小稳定（Edge headless 会先返回，PDF 后落盘）。
 */
function waitForStableFile(path: string, timeoutMs = 30_000): Buffer {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const size = statSync(path).size;
      if (size > 0 && size === lastSize) {
        return readFileSync(path);
      }
      lastSize = size;
    }
    const until = Date.now() + 100;
    while (Date.now() < until) {
      /* 轮询间隔 */
    }
  }
  throw new Error(`等待 PDF 落盘超时：${path}`);
}

/**
 * 清理临时目录。
 *
 * ⚠️ Edge 的后台进程可能**仍在写** profile 目录 → 直接 rmSync 会 ENOTEMPTY。
 * 故：重试若干次，每次失败只忽略。
 */
function cleanupDir(dir: string): void {
  for (let i = 0; i < 5; i++) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
      if (!existsSync(dir)) {
        return;
      }
    } catch {
      /* 忽略：Edge 可能仍在写，下一轮再试 */
    }
    const until = Date.now() + 200;
    while (Date.now() < until) {
      /* 退避 */
    }
  }
}

/**
 * 生成一份 PDF，返回其字节。
 *
 * ⚠️ 源 HTML **固定用同一个文件名** —— 这才是 build-print 的真实形态
 * （同一模板渲染到不同输出路径）。若每次换源文件名，Chromium 写进 PDF 的
 * `/Title` 会跟着变，归一化后仍不一致（/Title 属内容，不做归一化）。
 */
function renderPdf(html: string, workDir: string, edge: string, tag: string): Buffer {
  const htmlPath = join(workDir, 'page.html');
  const pdfPath = join(workDir, `${tag}.pdf`);
  writeFileSync(htmlPath, html, 'utf8');
  const profile = join(workDir, `profile_${tag}`);
  const url = `file:///${htmlPath.replace(/\\/g, '/')}`;
  spawnSync(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--virtual-time-budget=5000',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      url,
    ],
    { encoding: 'utf8', shell: false, timeout: 120_000 }
  );
  // ⚠️ Edge headless 会**先派生后台进程再立即退出**（exit 0），PDF 稍后才落盘
  return waitForStableFile(pdfPath);
}

test('PDF 归一化：同一内容两次生成，原始哈希不同但归一化后相同', { skip: EDGE === undefined ? '未找到 Edge' : false }, () => {
  const edge = EDGE;
  if (edge === undefined) {
    return;
  }
  const workDir = join(tmpdir(), `cm-pdfnorm-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const p1 = renderPdf(HTML_A, workDir, edge, 'a1');
    const p2 = renderPdf(HTML_A, workDir, edge, 'a2');

    // 前提：原始字节**确实**不可比（若哪天 Chromium 不再写时间戳，这条会失败并提醒）
    assert.notEqual(rawPdfDigest(p1), rawPdfDigest(p2), '原始 PDF 哈希本应不同（构建时刻）');

    // 归一化后必须相同——这才是可用于门禁的判据
    assert.equal(normalizedPdfDigest(p1), normalizedPdfDigest(p2), '归一化后摘要必须相同');
  } finally {
    cleanupDir(workDir);
  }
});

test('PDF 归一化：内容真变了时归一化摘要必须不同（门禁不能失效）', { skip: EDGE === undefined ? '未找到 Edge' : false }, () => {
  const edge = EDGE;
  if (edge === undefined) {
    return;
  }
  const workDir = join(tmpdir(), `cm-pdfnorm-${process.pid}-b`);
  mkdirSync(workDir, { recursive: true });
  try {
    const a = renderPdf(HTML_A, workDir, edge, 'b1');
    const b = renderPdf(HTML_B, workDir, edge, 'b2');
    assert.notEqual(normalizedPdfDigest(a), normalizedPdfDigest(b), '内容变了，归一化摘要必须不同');
  } finally {
    cleanupDir(workDir);
  }
});

test('PDF 约束：Chromium 无 <title> 时把源文件名写进 /Title ⇒ build-print 必须显式给 title', { skip: EDGE === undefined ? '未找到 Edge' : false }, () => {
  const edge = EDGE;
  if (edge === undefined) {
    return;
  }
  const workDir = join(tmpdir(), `cm-pdftitle-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const htmlPath = join(workDir, 'my-template.html');
    const pdfPath = join(workDir, 'out.pdf');
    writeFileSync(htmlPath, '<html><head><meta charset="utf-8"></head><body>x</body></html>', 'utf8');
    spawnSync(
      edge,
      ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
       '--no-default-browser-check', '--disable-extensions', '--virtual-time-budget=5000',
       `--user-data-dir=${join(workDir, 'prof')}`, `--print-to-pdf=${pdfPath}`,
       `file:///${htmlPath.replace(/\\/g, '/')}`],
      { encoding: 'utf8', shell: false, timeout: 120_000 }
    );
    const buf = waitForStableFile(pdfPath);
    const text = buf.toString('latin1');
    assert.match(text, /\/Title \(my-template\.html\)/, '/Title 确实取自源文件名');
    // ⇒ 结论：build-print 必须显式输出 <title>，否则 /Title 会随模板文件名漂移
  } finally {
    cleanupDir(workDir);
  }
});

test('PDF 归一化：只替换时间戳的值，保留字段名与结构，且**等长**', () => {
  const sample = Buffer.from(
    '<< /Type /Info /CreationDate (D:20261107120000+08\'00\') /ModDate (D:20261107120001+08\'00\') >>',
    'latin1'
  );
  const normalized = normalizePdfBytes(sample);
  const text = normalized.toString('latin1');

  // 等长是硬要求：占位符长度不同 ⇒ 后续字节偏移移位 ⇒ 逐字比对必失败
  assert.equal(normalized.length, sample.length, '归一化**不得改变字节长度**');

  assert.match(text, /\/CreationDate \(D:0+\+00'00'\)/, 'CreationDate 的值应被替换为等长占位符');
  assert.match(text, /\/ModDate \(D:0+\+00'00'\)/, 'ModDate 的值应被替换为等长占位符');
  assert.match(text, /\/Type \/Info/, '字段名与结构必须保留（不可整行剔除）');
  assert.ok(!text.includes('20261107'), '原时间戳不得残留');
});

const HTML_A = '<html><head><meta charset="utf-8"><title>固定标题</title></head><body><h1>创界山</h1><p>甲</p></body></html>';
const HTML_B = '<html><head><meta charset="utf-8"><title>固定标题</title></head><body><h1>创界山</h1><p>乙</p></body></html>';
