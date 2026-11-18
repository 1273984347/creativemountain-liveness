// B79 T21（复算入口）：§9.1 那把分类尺的**四格复算**——基线树 vs 现树 × 20 词 vs 22 词。
// 跑法：node tools/presets/b79-t21-ruler.mjs   （第一次会向 `.tmp/b79-base/` 解出基线 tests 树，几秒）
//
// 为什么要常驻：规格 §6.16 原来带着第二份计数（342 / 73 / 115），而记录 §9.1 带着 412 → 295。
// 两个数都不是错的时点错的就是尺错——跑完这张四格表才能说清差在哪（结论见记录 §14.2 末段）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { at, BATCH_BASE } from './common.mjs';
import { leafWordsFromThemes } from '../theme-word-scan.mjs';

const WORDS20 = leafWordsFromThemes().map((w) => w.word);
const WORDS22 = [...new Set([...WORDS20, '峰顶', '体力'])];
const BASE_DIR = at('.tmp', 'b79-base', 'tests');

/** 基线 tests 树（只读提取，供「尺相同、树不同」那一格用）。 */
function ensureBaseline() {
  if (existsSync(BASE_DIR)) return;
  mkdirSync(resolve(BASE_DIR, '..'), { recursive: true });
  execFileSync('tar', ['-x', '-C', resolve(BASE_DIR, '..', '..'), '-'],
    { input: execFileSync('git', ['archive', BATCH_BASE, 'tests'], { cwd: at('.'), maxBuffer: 1 << 28 }) });
}

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx?|mjs)$/.test(e)) out.push(p);
  }
  return out;
};

/** 分类器逐字沿用 b79-inventory.mjs，否则两把尺又在比别的东西。 */
const classify = (root, ALL) => {
  const cat = { TITLE: 0, MSG: 0, CODE: 0, COMMENT: 0 };
  const files = walk(resolve(root));
  for (const f of files) {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      if (!ALL.some((w) => l.includes(w))) continue;
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) cat.COMMENT += 1;
      else if (/^(test|it)(\.\w+)?\(/.test(t)) cat.TITLE += 1;
      else if (/(assert\.\w+\([\s\S]*)?['"][^'"]*(必须|应当|应该|否则|⇒|前提)/.test(t) && /['"]$|['"]\);?$/.test(t)) cat.MSG += 1;
      else cat.CODE += 1;
    }
  }
  return { files: files.length, ...cat, total: cat.TITLE + cat.MSG + cat.CODE + cat.COMMENT };
};

ensureBaseline();
for (const [label, root] of [[`基线 ${BATCH_BASE}（.tmp/b79-base/tests）`, BASE_DIR], ['现树 tests/', at('tests')]]) {
  for (const [wl, words] of [['20 词', WORDS20], ['22 词（含兜底）', WORDS22]]) {
    const r = classify(root, words);
    console.log(`${label} · ${wl}：总 ${r.total}（标题 ${r.TITLE} / 消息 ${r.MSG} / 判据与数据 ${r.CODE} / 注释 ${r.COMMENT}）· 文件 ${r.files}`);
  }
}
