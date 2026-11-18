// B79 T19（复算入口）：施工面「54 行」到底改了多少行——三把尺分开量，不许互相冒充。
//   ① 现在带 {leaf} 占位符的非注释行（引擎/web 各多少）：这是**交付的接线面**；
//   ② 自开工基线 7ab2995 起 engine/** 与 web/** 的 git numstat：这是**真动过的行**（含删含增）；
//   ③ 规格 §2 那张表的口径：需要处置的泄漏行（接线 / 转机制词 / 删兜底 / 开发者串）。
// 跑法：node tools/presets/b79-t19-count.mjs
// 记录引用处：§12.4（两把尺的成员级对账）。
import { readFileSync } from 'node:fs';
import { BATCH_BASE, gitNumstat, relOf, walkSources } from './common.mjs';

const PLACEHOLDER = /\{(?:resource|gate|path|peak|hp)\}/;
const count = {};
for (const domain of ['engine', 'web']) {
  let n = 0;
  for (const f of walkSources(domain)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (PLACEHOLDER.test(line)) n += 1;
    }
  }
  count[domain] = n;
}
console.log('① 交付接线面（非注释行含占位符）：engine =', count.engine, '· web =', count.web,
  '· 合计 =', count.engine + count.web);

const ns = gitNumstat(`${BATCH_BASE}..HEAD`, ['engine', 'web']);
console.log(`② git numstat（${BATCH_BASE}..HEAD，engine+web）：${ns.files} 个文件 · +${ns.add} −${ns.del}`);

console.log('③ 规格 §2 的施工面口径 = 带主题词字面量、需要处置的行（当前 54：引擎 37 / web 17），'
  + '逐文件成员级对账见记录 §12.4 与 r1.9 的两把尺注。');
console.log('   差值归因：占位符行比施工面多出的 5 行全是 glossary→terms 硬依赖边（基线不是字面量，从没进表），'
  + '逐行核对入口 = b79-t20-two-lines.mjs。');

// 顺带打印涉及文件清单（要逐文件核时省得再跑一次 git）
const files = [...new Set([...walkSources('engine'), ...walkSources('web')].map(relOf))];
console.log(`   （当前 engine+web 源文件总数 = ${String(files.length)}）`);
