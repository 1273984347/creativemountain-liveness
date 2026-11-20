// B79 T21（复算入口）：验收 §6 里**能机械复算**的条目一次跑完，只打印事实、不下结论。
// 跑法：node tools/presets/b79-t21-verify.mjs
// ⚠️ 存在的理由就是 verification-before-completion 的那条：证据必须来自这次输出，不能来自记忆。
import { existsSync, readFileSync } from 'node:fs';
import { at, relOf, walkSources } from './common.mjs';
import {
  leafWordsFromThemes, pureLeafWords, scanThemeWords, scanFallbackWords, SENTENCE_DOMAINS,
  SENTENCE_WHITELIST, TESTS_WORD_REGISTRY, TESTS_DOMAIN_EXEMPT_WORDS, FALLBACK_BAN,
} from '../theme-word-scan.mjs';

const read = (p) => readFileSync(at(p), 'utf8');
const nonCommentLines = (p) => read(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
const line = (label, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' ｜ ' + detail : ''}`);

// 1 · ThemeTerms 摊平叶数 ≡ TERM_LEAVES 项数
//
// ⚠️ 判据形状在 B80 T4 改过一次：原来钉的是 **B79 当时的计数**（`leafCount === 15`、`pairKeys.length === 5`），
//   B80 把两个数都推进了（15→18、5→8）⇒ 照字面跑会常驻一条"看起来像回归"的 ✗，而复算入口长红
//   等于没有入口（读的人分不清是这批做坏了还是下批正常推进）。改成 **B79 的键仍是子集** +
//   **与主题数据摊平互验**：语义（B79 补的键都还在、表与数据不分叉）一字未松，计数不再写死。
const B79_FLAT_LEAVES = ['hp', 'deck', 'resource', 'gate', 'path', 'peak',
  'types.motion', 'types.attack', 'types.defense', 'types.utility',
  'colors.red', 'colors.black', 'statuses.poison', 'statuses.slow', 'statuses.silence'];
const tv = /const TERM_LEAVES = \[([\s\S]*?)\n\];/.exec(read('tools/theme-validate.mjs'))[1];
const flatLeaves = [...tv.matchAll(/\['([a-z]+)'(?:,\s*'([a-z]+)')?\]/g)]
  .map((m) => (m[2] === undefined ? m[1] : `${m[1]}.${m[2]}`));
const leafCount = flatLeaves.length;
const tt = /interface ThemeTerms \{([\s\S]*?)\n\}/.exec(read('engine/types/theme.ts'))[1];
const topKeys = [...tt.matchAll(/^\s{2}readonly (\w+)/gm)].map((m) => m[1]);
const hybrid = JSON.parse(read('themes/hybrid/theme.json'));
// 主题数据摊平（一层嵌套：types/colors/statuses）——第三处真值，用来和声明互验
const dataFlat = Object.entries(hybrid.terms)
  .flatMap(([k, v]) => ((v !== null && typeof v === 'object') ? Object.keys(v).map((a) => `${k}.${a}`) : [k]));
const missingLeaves = B79_FLAT_LEAVES.filter((k) => !flatLeaves.includes(k));
line(`1 TERM_LEAVES 摊平 = ${leafCount} · 主题数据摊平 = ${dataFlat.length} · ThemeTerms 顶层键 = ${topKeys.length}`
  + ` · B79 的 15 键在位 = ${missingLeaves.length === 0}`,
  leafCount === dataFlat.length && missingLeaves.length === 0,
  `hybrid terms.path=${hybrid.terms.path} · glossary.path=${hybrid.glossary.path}`
  + (missingLeaves.length === 0 ? '' : ` ⇒ 缺：${missingLeaves.join('/')}`));

// 2 · termsOf() 无 ?? 回落
const termsOfBody = /export function termsOf\(([\s\S]*?)\n\}/.exec(read('build/build-ir.mjs'))[0];
line('2 build-ir termsOf() 无 ?? 回落', !termsOfBody.includes('??'));

// 3 · 门⑤ 判等在位（B79 的五对仍是子集；B80 另加 rift/hazard/player 三对，不写死总数）
const B79_PAIRS = ['hp↔HP', 'resource↔resource', 'gate↔gate', 'path↔path', 'peak↔peak'];
const tvSrc = read('tools/theme-validate.mjs');
const pairs = /const TERMS_GLOSSARY_PAIRS = \[([\s\S]*?)\];/.exec(tvSrc)?.[1] ?? '';
const pairKeys = [...pairs.matchAll(/\['([a-zA-Z]+)',\s*'([A-Za-z]+)'\]/g)].map((m) => `${m[1]}↔${m[2]}`);
const missingPairs = B79_PAIRS.filter((p) => !pairKeys.includes(p));
line(`3 checkTermsGlossaryAgreement 在位 + 判等表 ${pairKeys.length} 对 · B79 的五对在位 = ${missingPairs.length === 0}`,
  /function checkTermsGlossaryAgreement/.test(tvSrc) && missingPairs.length === 0,
  pairKeys.join(' ') + (missingPairs.length === 0 ? '' : ` ⇒ 丢：${missingPairs.join(' ')}`));

// 4 · web/ 还读 glossary 的地方
const glossaryLines = walkSources('web').flatMap((f) => nonCommentLines(relOf(f))
  .filter((l) => /glossary\./.test(l)).map((l) => relOf(f)));
line(`4 web/** 非注释行仍读 theme.glossary 的行数 = ${glossaryLines.length}`,
  glossaryLines.length === 0, [...new Set(glossaryLines)].join(' ') || '（无）');

// 5 · ir-validate 的注释指向真实存在的判定，且不指向不存在的名字
const irv = read('tools/ir-validate.mjs');
const tvHas = (name) => new RegExp(`function ${name}\\b`).test(tvSrc) || new RegExp(`export function ${name}\\b`).test(irv);
line('5 ir-validate 注释指 checkTermsGlossaryAgreement，且该函数真存在',
  /checkTermsGlossaryAgreement/.test(irv) && tvHas('checkTermsGlossaryAgreement'));
line('5 旧句「与 terms 的三键一致由门 ⑤ 判」已清除',
  !/三键一致由门 ⑤ 判/.test(irv));

// 6 · 三把尺全 0
const words = leafWordsFromThemes();
const r1 = scanThemeWords(at('.'), SENTENCE_DOMAINS, words, SENTENCE_WHITELIST);
const fb = scanFallbackWords(at('.'), SENTENCE_DOMAINS);
const testsUnregistered = scanThemeWords(at('.'), ['tests'], pureLeafWords(),
  new Map(TESTS_WORD_REGISTRY.map((r) => [r.file, [...r.words]])));
line(`6 R1（${SENTENCE_DOMAINS.join('+')}，${words.length} 词）命中 = ${r1.length}`, r1.length === 0, r1.slice(0, 2).join(' | '));
line(`6 兜底词（${FALLBACK_BAN.join('/')}）命中 = ${fb.length}`, fb.length === 0);
line(`6 tests 域未登记命中 = ${testsUnregistered.length}（登记表 ${TESTS_WORD_REGISTRY.length} 条 · tests 域豁免 ${TESTS_DOMAIN_EXEMPT_WORDS.join('/')}）`,
  testsUnregistered.length === 0);

// 7 · 白名单空集 + action-key 机制标识
const akLines = nonCommentLines('engine/core/action-key.ts');
line(`7 SENTENCE_WHITELIST.size = ${SENTENCE_WHITELIST.size}`, SENTENCE_WHITELIST.size === 0);
line('7 action-key 用机制标识且非注释行不含叶词',
  akLines.some((l) => l.includes('key gate 通道非法')) && !words.some((w) => akLines.some((l) => l.includes(w.word))),
  // 标签跟着 B80 改口径：`裂隙` 在 B79 是"表外词（L-B79-4）"，B80 T1 之后它是**叶词**、
  // 由 R1 的 32 词表直接判 ⇒ 再说"表外"会把人指向一条已销账的遗留（#30/#31 同族：判据对、标签旧）。
  `残留「key 裂隙通道非法」（裂隙 B80 起是叶词，R1 直接判；L-B79-4 已销）= ${akLines.some((l) => l.includes('裂隙通道非法'))}`);

// 13 · 两条共享子串逐字保留
const trialText = read('build/trial-text.mjs');
const gateSrc = read('engine/core/gate.ts');
const A = /本关改为付费/.test(trialText) && /本关改为付费/.test(gateSrc);
const B = /仍未付足则判未通过，退 1 格并被封口/.test(trialText) && /退 1 格并被封口/.test(gateSrc);
line('13 共享子串 A/B 在 trial-text.mjs 与引擎两侧逐字在位', A && B, `A=${A} B=${B}`);

// 14 · 报告标签与入库生成物
const runm = read('tests/sim/run.mjs');
const rep = read('docs/balance-report.md');
line('14 PASSIVE_LABELS 偷资源 + 报告已重生成（无「偷灵枢」）',
  runm.includes("'窃火者 · 偷资源'") && !rep.includes('偷灵枢') && rep.includes('偷资源'));

// 15/20 · 文档侧
const b78 = read('docs/批次/B78-试炼牌名与文案同源-执行记录.md');
const idx = readFileSync(at('docs/沉淀/经验教训索引.md'), 'utf8');
const eRows = [...idx.matchAll(/^\| E(\d+) \|/gm)].length;
const catSum = [...idx.matchAll(/^\| [一二三四五]、[^|]+\| (\d+) \|/gm)].reduce((a, m) => a + Number(m[1]), 0);
line('15 B78 验收 12 已改「复查不成立」', b78.includes('复查不成立'));
line(`20 经验索引：E 行 ${eRows} ≡ 分类声明之和 ${catSum}`, eRows === catSum, `含 E136 = ${/\| E136 \|/.test(idx)}`);

// 21 · B80 指向：残留 = 0（刻意写的读数说明单独数出来）
const pointerFiles = [
  'docs/superpowers/specs/2026-11-14-b77-死状态家族与试炼题面真值-design.md',
  'docs/superpowers/specs/2026-11-15-b78-试炼牌名与文案同源-design.md',
  'docs/批次/B77-死状态家族与试炼题面真值-执行记录.md',
  'docs/批次/B78-试炼牌名与文案同源-执行记录.md',
];
const stale = [];
let explained = 0;
for (const f of pointerFiles) {
  for (const l of read(f).split('\n')) {
    // ⚠️ 「说明行」的标志不能写死批次号：B80 T8 把「按 B80 读」改成了「按 B82 读」（编号顺延），
    //   那句话仍是刻意的读数说明，但硬编码的 `按 B80 读` 匹配不上 ⇒ 判据自己造出一条假残留（与 #21/#27/#30 同族）。
    //   所以这里匹配的是**形状**「按 B<数字> 读」，不匹配某个具体编号。
    if (!/B79 (模型|输入|模型批)/.test(l)) continue;
    (/(按\s*\*{0,2}B\d+\*{0,2}\s*读|现编号|原记 B79|编号已定)/.test(l) ? (explained += 1, null) : stale.push(`${f}: ${l.trim().slice(0, 60)}`));
  }
}
const b80Lines = pointerFiles.reduce((a, f) => a + read(f).split('\n').filter((l) => l.includes('B80')).length, 0);
line(`21 旧式「B79 模型/输入」指向残留 = ${stale.length}（另有 ${explained} 行是刻意的读数说明）`,
  stale.length === 0, `提及 B80 的行数 = ${b80Lines}`);

if (!existsSync(at('tools/presets/common.mjs'))) line('前置：共用件缺失', false);
