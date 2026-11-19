// B80 `player` 叶的候选词体检（判据同 b80-wordcheck.mjs）。
//
// 为什么单开一个文件：`player` 是**称谓**，撞词风险比地名更细——它不只可能与别套术语同形，
// 还会与本套的身份名（`identities[].name`）争语域（hybrid 的身份名一律 `…者/…人/…师`：
// 开路者 / 观天者 / 守关人 / 织符者 / 山主）。挑出来的通用称谓若长得像某个身份，读者会以为
// 状态栏在指具体身份。所以这里除了正文/代码/术语三层，**额外把身份名也列出来对照**。
//
// 跑法：node tools/presets/b80-playerword.mjs
import { readFileSync } from 'node:fs';
import { at, walkSources } from './common.mjs';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const themeOf = (id) => JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
const bodyOf = (id) => { const t = themeOf(id); delete t.terms; delete t.glossary; return JSON.stringify(t); };
const bodies = Object.fromEntries(IDS.map((id) => [id, bodyOf(id)]));
const code = [...walkSources('engine'), ...walkSources('web'), ...walkSources('tests')].map((f) => readFileSync(f, 'utf8')).join('\n');
const current = [...new Set(IDS.flatMap((id) => [
  ...Object.values(themeOf(id).terms ?? {}),
  ...Object.values(themeOf(id).glossary ?? {}),
].map((v) => (typeof v === 'string' ? v : '')).filter(Boolean)))];

const CANDIDATES = ['行道者', '走山人', '登山人', '过路客', '旅人', '拾遗者', '行脚僧', '闯关者', '行者', '修士', '行动者', '异能者'];

console.log('=== 四套现有身份名（称谓不得与它争层级）===');
for (const id of IDS) console.log(`  ${id.padEnd(12)} ${(themeOf(id).identities ?? []).map((i) => i.name).join(' / ')}`);

console.log('\n=== player 候选 ===');
for (const w of CANDIDATES) {
  const inBody = IDS.filter((id) => bodies[id].includes(w));
  const inCode = code.includes(w);
  const isTerm = current.includes(w);
  const isIdentity = IDS.some((id) => (themeOf(id).identities ?? []).some((i) => i.name === w));
  const clean = inBody.length === 0 && !inCode && !isTerm && !isIdentity;
  console.log(`  ${clean ? '干净  ' : '有冲突 '} ${w.padEnd(4)} 正文:${inBody.length ? inBody.join(',') : '-'}`
    + ` | engine+web+tests:${inCode ? '有' : '无'} | 已是某套词:${isTerm ? '是' : '否'} | 是身份名:${isIdentity ? '是' : '否'}`);
}
