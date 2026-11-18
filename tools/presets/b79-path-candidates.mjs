// B79 T3 取证（复算入口）：hybrid 的 path 候选词撞不撞「四套共用棋盘文本」与 engine/web。
// 跑法：node tools/presets/b79-path-candidates.mjs
// 结论进的是规格 r1.3 与记录 §5 修正（「栈道」被门⑧ 证伪 ⇒ 定稿「索桥」+ 登记 L-B79-3）。
//
// 门⑧ 的串戏判据是**子串包含**（「碎云阶」含「云阶」即红），而 board 的格名与岔路标签是四套逐字
// 复用的（不属 §10.1 差异化项）⇒ 任何已被当作**具体地名**的山岳词都不能当术语词。
import { readFileSync } from 'node:fs';
import { at, relOf, walkSources } from './common.mjs';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const FIVE = ['resource', 'gate', 'path', 'peak', 'hp'];

/** 主题正文 = theme.json 去掉 terms / glossary 两个取词块（那两处是术语自身，不算正文）。 */
function themeOf(id) {
  return JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
}
function bodyOf(id) {
  const t = themeOf(id);
  delete t.terms;
  delete t.glossary;
  return JSON.stringify(t);
}
const bodies = Object.fromEntries(IDS.map((id) => [id, bodyOf(id)]));
const termsOf = (id) => FIVE.map((k) => themeOf(id).terms[k]);

const code = [...walkSources('engine'), ...walkSources('web')]
  .map((f) => [relOf(f), readFileSync(f, 'utf8')]);

const CANDIDATES = ['栈道', '云阶', '石阶', '索桥', '云轨', '石径', '灵轨', '悬廊', '铁索', '山脊', '崖径', '飞桥', '格径'];

console.log('=== 现行五叶术语是否已经出现在别套正文里（今天的基线状况）===');
for (const owner of IDS) {
  for (const w of termsOf(owner)) {
    const hurt = IDS.filter((id) => id !== owner && bodies[id].includes(w));
    if (hurt.length > 0) console.log(`  「${w}」(=${owner}) 出现在 ${hurt.join(',')} 正文 ⇒ 门⑧ 会判红`);
  }
}

console.log('\n=== 候选词体检 ===');
for (const w of CANDIDATES) {
  const inBody = IDS.filter((id) => bodies[id].includes(w));
  const inCode = code.filter(([, s]) => s.includes(w)).map(([f]) => f);
  const inTerms = IDS.filter((id) => termsOf(id).includes(w));
  console.log(`  ${w.padEnd(3)} 正文:${inBody.length ? inBody.join(',') : '干净'}`
    + ` | engine+web:${inCode.length ? inCode.join(',') : '干净'} | 已是某套术语:${inTerms.join(',') || '否'}`);
}
