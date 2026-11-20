// B80 范围与禁字表复算入口（规格 §0.1 的取证脚本）。
//
// 它回答三件事，且**在 T1/T3/T4 前后都该跑一次**——"接线做完了吗"、"禁字表并入了吗"、
// "还剩哪一处硬写"都由这里输出，不由谁的记忆回答：
//   ① 14 个 glossary 键里，每个键的词值此刻在 `engine/**`+`web/**` 非注释行出现多少次（句层字面量）；
//   ② 身份名 / 阵营名同理（它们**不在** glossary 键里，但同样是"引擎替某套说话"的载体，B80 R1''）；
//   ③ 主域禁字表应有的规模：句子层 8 叶 × 4 套（去重）+ 身份名（去重）。
//
// 跑法：node tools/presets/b80-scope.mjs（不依赖 CWD）
// ⚠️ 尺与 R1 一致：整行注释豁免 + **子串**包含 + 该行含引号（否则 `peakIndex`、类型名一类标识符会被算成命中）。
//    与 `tools/theme-word-scan.mjs` 同源但**独立实现**：本脚本要在 T4 改禁字表之前就能跑，
//    不能依赖那时还不存在的 `fullBanWords()`；两边的口径由 T4 的测试对齐（不一致即红）。
import { readFileSync } from 'node:fs';
import { at, walkSources } from './common.mjs';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const DONE_B79 = new Set(['HP', 'resource', 'gate', 'path', 'peak']);   // 术语已进 terms 的键（hp 键名是 HP）
const DONE_B80 = new Set(['rift', 'hazard', 'player']);                // B80 已接的键（收口复算 0 命中，见记录 §14.1）
const LEAF8 = ['resource', 'gate', 'path', 'peak', 'hp', 'rift', 'hazard', 'player'];

/** `--full`：把 24 处逐条列出（T1/T3 的开工原文表从这里抄，不靠记忆）。 */
const FULL = process.argv.includes('--full');

const themeOf = (id) => JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
const themes = Object.fromEntries(IDS.map((id) => [id, themeOf(id)]));
const files = [...walkSources('engine'), ...walkSources('web')];
const isComment = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');

/** 某词集在 engine/web 非注释「字符串附近」行里的命中（带 file:line）。 */
function hitsOf(words) {
  const out = [];
  for (const f of files) {
    const rel = f.slice(at('').length + 1).split('\\').join('/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (isComment(t) || !/["'`]/.test(t)) return;
      const w = words.find((x) => t.includes(x));
      if (w !== undefined) out.push(`${rel}:${String(i + 1)}「${w}」`);
    });
  }
  return out;
}

const glossaryKeys = [...new Set(IDS.flatMap((id) => Object.keys(themes[id].glossary ?? {})))];
console.log('=== ① glossary 键的句层字面量 ===');
console.log('键          状态        命中  样本');
for (const k of glossaryKeys) {
  const vals = [...new Set(IDS.map((id) => themes[id].glossary?.[k]).filter((v) => typeof v === 'string' && v.length > 0))];
  const status = DONE_B79.has(k) ? 'B79 已接'
    : DONE_B80.has(k) ? 'B80 已接'
      : vals.length > 1 ? '**待接**' : '四套同词';
  const hits = hitsOf(vals);
  console.log(`${k.padEnd(11)} ${status.padEnd(11)} ${String(hits.length).padStart(4)}  ${hits.slice(0, 3).join('  ') || '-'}`
    + `${status.includes('待接') ? '   词：' + vals.join('/') : ''}`);
}

const identityNames = [...new Set(IDS.flatMap((id) => (themes[id].identities ?? []).map((i) => i.name)))];
const factionNames = [...new Set(IDS.flatMap((id) => (themes[id].factions ?? []).map((f) => f.name)))];
const idRaw = IDS.reduce((a, id) => a + (themes[id].identities?.length ?? 0), 0);
console.log('\n=== ② 身份名 / 阵营名（R1\'\' 的对象）===');
console.log(`身份名：原始 ${String(idRaw)} 个 → 去重 ${String(identityNames.length)} 个 · engine/web 命中 = ${String(hitsOf(identityNames).length)}`);
for (const h of hitsOf(identityNames)) console.log('   ' + h);
console.log(`阵营名：去重 ${String(factionNames.length)} 个 · engine/web 命中 = ${String(hitsOf(factionNames).length)}`);

// ⚠️ 与 hitsOf 的**行级去重**口径不同：rift 在 engine 侧 13 行、web 侧另有含「裂隙」的行（T2/T3 会看到），
//   而 B79 口径的「rift 13」统计的是 engine+web 合计里首词命中为 rift 的行。这里按**词归属**分桶再合计，
//   保证一行含两个待接词时仍算 2 处、1 行。
const pendingHits = (keys) => {
  const buckets = new Map();
  for (const k of keys) buckets.set(k, new Set());
  const wordToKey = new Map();
  for (const k of keys) for (const id of IDS) {
    const v = themes[id].glossary?.[k];
    if (typeof v === 'string' && v.length > 0) wordToKey.set(v, k);
  }
  for (const f of files) {
    const rel = f.slice(at('').length + 1).split('\\').join('/');
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (isComment(t) || !/["'`]/.test(t)) return;
      for (const [w, k] of wordToKey) if (t.includes(w)) {
        buckets.get(k).add(`${rel}:${String(i + 1)}`);
        sites.push({ key: k, word: w, where: `${rel}:${String(i + 1)}`, text: t });
      }
    });
  }
  return buckets;
};
const sites = [];
const keyBuckets = pendingHits(['rift', 'hazard', 'player']);
const idBucket = new Set(hitsOf(identityNames).map((h) => h.split('「')[0]));
const totalSites = [...keyBuckets.values()].reduce((a, s) => a + s.size, 0) + idBucket.size;
const totalLines = new Set([...[...keyBuckets.values()].flatMap((s) => [...s]), ...idBucket]).size;
console.log(`\n接线面合计：${String(totalSites)} 处 → ${String(totalLines)} 行源码`
  + `（分桶：${[...keyBuckets].map(([k, s]) => `${k} ${String(s.size)}`).join(' / ')} / 身份名 ${String(idBucket.size)}）`);
// 一处 = 一个词集的一条命中，一行 = 一个 file:line ⇒ 两个数可以不等：
//   `turn-runner.ts:67` 同时含「险径」和「织梦者」，所以 24 处落在 23 行上。
//   T1/T3 逐行勾账以「行」为准（一行只改一次），规格 §2 标题若写"24 行"就与这里对不上。

const leafWords = [...new Set(IDS.flatMap((id) => LEAF8.map((k) => themes[id].terms?.[k]).filter((v) => typeof v === 'string')))];
const sameForm = leafWords.filter((w) => identityNames.includes(w));
console.log('\n=== ③ 主域禁字表规模 ===');
console.log(`terms 8 叶去重 = ${String(leafWords.length)} 词（T1 落库前应为 20，落库后 32）`);
console.log(`身份名去重 = ${String(identityNames.length)} ⇒ 并集 = ${String(new Set([...leafWords, ...identityNames]).size)} 词（T4 目标 58）`);
console.log(`同形冲突（叶词与身份名重字）= ${sameForm.length ? sameForm.join(',') : '无'}`);

if (FULL) {
  const idSites = hitsOf(identityNames).map((h) => {
    const cut = h.lastIndexOf('「');
    const word = h.slice(cut + 1, -1);
    const text = readFileSync(at(h.slice(0, h.indexOf(':'))), 'utf8').split('\n')[Number(h.slice(h.indexOf(':') + 1, cut).trim()) - 1].trim();
    return { key: 'identity', word, where: h.slice(0, cut), text };
  });
  const all = [...sites, ...idSites].sort((a, b) => (a.where < b.where ? -1 : 1));
  console.log(`\n=== ④ 接线面逐条（--full：${String(all.length)} 处 / ${String(new Set(all.map((s) => s.where)).size)} 行）===`);
  let prev = '';
  for (const s of all) {
    console.log(`${s.where === prev ? '      同上行' : s.where.padEnd(34)}[${s.key}]「${s.word}」  ${s.text.slice(0, 88)}`);
    prev = s.where;
  }
}
