// B79 T15.1 前置取证（复算入口）：**表外词**在 engine/web 句层字面量里的真实计数。
// 口径：非注释行 + 行内含引号/反引号（字符串字面量附近），因此 `peakIndex` 一类标识符不算命中。
// 跑法：node tools/presets/b79-offcount.mjs
// 记录引用处：§9.4 末段「表外词现状」、规格 §2.4 与 L-B79-4。
// ⚠️ 这张表是 B80 的起点：`峰顶` 已由 r1.6 接成 `{peak}`（现应为 0），`裂隙`/`险径` 仍待 `{rift}` `{hazard}`。
import { readFileSync } from 'node:fs';
import { relOf, walkSources } from './common.mjs';

const QUOTE = /["'`]/;
const isC = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
const files = [...walkSources('engine'), ...walkSources('web')];
const WORDS = ['峰顶', '裂隙', '险径', '牌库', '体力', '封路印', '认证印', '福地', '灵地', '补给点',
  '便利店', '荒野', '平原', '空域', '支路', '岔路', '分支', '岔道'];

for (const w of WORDS) {
  const hits = [];
  for (const f of files) {
    const rel = relOf(f);
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (isC(t) || !t.includes(w) || !QUOTE.test(t)) return;
      hits.push(`${rel}:${String(i + 1)}`);
    });
  }
  console.log(`${w.padEnd(4)} ${String(hits.length).padStart(3)} 处   ${hits.slice(0, 3).join('  ')}`);
}
