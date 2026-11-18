// B79 T0 Step 2（复算入口）：重扫施工面，两种禁字表口径都要量。
//   A) 只从 terms 派生（计划原脚本）：T0 时 path/peak 还没进 terms ⇒ 词表不全（记录 §2.2 修正 #1）
//   B) terms ∪ glossary 的五叶取值（规格 §2 的口径）：这才是接线完工后 R1 要清空的集合
// 跑法：node tools/presets/b79-scan.mjs
// ⚠️ 行过滤规则保持 T0 那一份（含 '·' 那条），改它等于换尺，记录里的 50/54 就不复算得出来。
import { readFileSync } from 'node:fs';
import { at, walkSources } from './common.mjs';

const IDS = ['hybrid', 'scifi-ai', 'urban-psych', 'xianxia2026'];
const LEAVES = ['resource', 'gate', 'path', 'peak', 'hp'];

function wordSet(fromGlossaryToo) {
  const words = new Set();
  for (const id of IDS) {
    const theme = JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
    for (const k of LEAVES) {
      const v = theme.terms?.[k] ?? (fromGlossaryToo ? theme.glossary?.[k] : undefined);
      if (typeof v === 'string' && v.length > 0) words.add(v);
    }
    if (fromGlossaryToo) {
      for (const k of LEAVES) {
        const v = theme.glossary?.[k];
        if (typeof v === 'string' && v.length > 0) words.add(v);
      }
    }
  }
  return words;
}

const files = [...walkSources('engine'), ...walkSources('web')];
const isComment = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('·');

for (const [tag, words] of [['A 仅 terms', wordSet(false)], ['B terms ∪ glossary', wordSet(true)]]) {
  const list = [...words];
  let code = 0;
  let cmt = 0;
  const per = new Map();
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (!list.some((w) => l.includes(w))) return;
      if (isComment(t)) { cmt += 1; return; }
      code += 1;
      per.set(f, (per.get(f) ?? 0) + 1);
    });
  }
  console.log(`\n=== ${tag}：禁字表 ${String(list.length)} 词 | 非注释命中 ${String(code)} | 注释命中 ${String(cmt)}`);
  console.log([...per.entries()].sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `  ${String(n).padStart(2)}  ${f.slice(at('').length + 1).split('\\').join('/')}`).join('\n'));
  if (tag.startsWith('A')) console.log('  词：' + list.sort().join('/'));
}
