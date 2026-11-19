// B80 候选词体检（门⑧ 判据的预演）。
//
// 用途：给 `terms` 挑新词时，先按门⑧ 实际会用的判据筛一遍——**但探针不能替代门禁**，
// 最终仍以 `node tools/theme-diff-check.mjs` 实跑为准（规格 §5 验收 3 专门写了这句）。
//
// 为什么必须"两表都比"：`rift`/`hazard`/`player` 在接线前**只活在 glossary**，
// 本探针第一版只比 `terms`，于是 urban-psych 的「断桥」被当成干净候选放过了（规格 §2.1.1 记了这个坑）。
//
// 跑法：node tools/presets/b80-wordcheck.mjs
// 改候选词：直接编辑下面两个数组（B81 给棋盘格名挑词时也用这套判据）。
import { readFileSync } from 'node:fs';
import { at, walkSources } from './common.mjs';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const themeOf = (id) => JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
/** 主题正文 = theme.json 去掉 terms / glossary（那两处是术语自身，不算"正文里已有这个词"）。 */
const bodyOf = (id) => { const t = themeOf(id); delete t.terms; delete t.glossary; return JSON.stringify(t); };
const bodies = Object.fromEntries(IDS.map((id) => [id, bodyOf(id)]));
const code = [...walkSources('engine'), ...walkSources('web'), ...walkSources('tests')].map((f) => readFileSync(f, 'utf8')).join('\n');
const current = [...new Set(IDS.flatMap((id) => [
  ...Object.values(themeOf(id).terms ?? {}),
  ...Object.values(themeOf(id).glossary ?? {}),
].map((v) => (typeof v === 'string' ? v : '')).filter(Boolean)))];

const RIFT = ['残骸带', '断裂面', '缺口', '裂谷', '崩口', '断层带', '裂隙', '断桥'];
const HAZARD = ['危段', '事故带', '塌陷段', '坏路段', '封锁段', '险坡', '险径', '危险区'];

/** 门⑧ 的判据形状：子串包含（「碎云阶」含「云阶」即红），所以候选必须是"没被当过具体地名"的词。 */
function verdict(w) {
  const inBody = IDS.filter((id) => bodies[id].includes(w));
  const inCode = code.includes(w);
  const isTerm = current.includes(w);
  const clean = inBody.length === 0 && !inCode && !isTerm;
  console.log(`  ${clean ? '干净  ' : '有冲突 '} ${w.padEnd(4)} 正文:${inBody.length ? inBody.join(',') : '-'.padEnd(30)}`
    + ` | engine+web+tests:${inCode ? '有' : '无'} | 已是某套词:${isTerm ? '是' : '否'}`);
}

console.log('=== rift 候选 ===');
for (const w of RIFT) verdict(w);
console.log('\n=== hazard 候选 ===');
for (const w of HAZARD) verdict(w);
