// B80 T1 的**门⑤ ↔ 门⑧ 冲突取证**（规格 §2.1 承诺「不改 glossary 任何值」+ §3 承诺「门⑤ 判等 5 → 8 对」，
// 这两条在 hybrid 上不能同时成立——本脚本把两侧的后果都量出来，供裁定，不替谁说话）。
//
// 为什么值得单独立一个 preset：这不是"某处写错了"，而是**两条承诺的交集**为空。
//   判据留在记忆里，下一批会重新推一遍；留在脚本里，一条命令就能复算。
//
// 跑法：node tools/presets/b80-glossconflict.mjs
//
// ⚠️ 方向 B 不写盘：它在内存里造一份「hybrid.glossary 三键换成新词」的主题对象，
//   把门⑧ 的串戏判据（`checkTerminologyLeak`）跑一遍，看**新增**哪几条红。
//   真去改 `themes/hybrid/theme.json` 再跑门⑧ 会把工作树弄脏，比对也分不清是 B 造成的还是本来就有。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { at } from './common.mjs';
import { checkTerminologyLeak, SENTENCE_LEAVES } from '../../tools/theme-diff-check.mjs';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const NEW_LEAVES = ['rift', 'hazard', 'player'];
/** 规格 §2.1 裁定写进 `terms` 的值（hybrid 三键是新造词，其余三套从 glossary 同值升格）。 */
const PLANNED_TERMS = {
  xianxia2026: { rift: '裂隙', hazard: '险径', player: '修士' },
  hybrid: { rift: '崩口', hazard: '险坡', player: '行道者' },
  'scifi-ai': { rift: '数据断层', hazard: '故障区', player: '行动者' },
  'urban-psych': { rift: '断桥', hazard: '危险区', player: '异能者' },
};

const load = (id) => JSON.parse(readFileSync(at('themes', id, 'theme.json'), 'utf8'));
const themes = Object.fromEntries(IDS.map((id) => [id, load(id)]));

console.log('=== 方向 A：门⑤ 判等 5 → 8 对，但 glossary 一字不改（照计划 Step 3/4）===');
let conflicts = 0;
for (const id of IDS) {
  for (const leaf of NEW_LEAVES) {
    const t = PLANNED_TERMS[id][leaf];
    const g = themes[id].glossary?.[leaf];
    const same = t === g;
    if (!same) conflicts += 1;
    console.log(`  ${same ? '一致  ' : '**不一致**'} ${id.padEnd(13)} terms.${leaf}=${t}  vs  glossary.${leaf}=${String(g)}`);
  }
}
console.log(`⇒ 门⑤ 八对判等下有 ${String(conflicts)} 条 err ⇒ 门⑤ FAIL（这正是 checkTermsGlossaryAgreement 该抓的形状）`);

console.log('\n=== 方向 B：连 glossary 一起换（八对成立），门⑧ 串戏判据新增什么 ===');
// ⚠️ 串戏判据在门⑧ 里的**真实入参**是「三套非基准主题」（`tools/theme-diff-check.mjs:492` 的 `loaded` 只 push 非基准套，
//   `:517` 把这份交给 `checkTerminologyLeak`）。把基准套混进去会多出一条「岔路口 含 岔路」的假红——
//   那正是"探针与门禁不同尺"的形状，本脚本第一版就踩了。
const NON_BASE = IDS.filter((id) => id !== 'xianxia2026');
const ownLeakBefore = checkTerminologyLeak(NON_BASE.map((id) => themes[id])).length;
console.log(`现状（三套非基准原样）串戏 err = ${String(ownLeakBefore)} 条`);

// 只在内存里造 hybrid 换词后的三套：hybrid 的 glossary 三键 → 新词，terms 也带上（A/B 共有的部分）。
const hybridSwapped = {
  ...themes.hybrid,
  terms: { ...themes.hybrid.terms, ...PLANNED_TERMS.hybrid },
  glossary: { ...themes.hybrid.glossary, ...PLANNED_TERMS.hybrid },
};
const after = NON_BASE.map((id) => (id === 'hybrid' ? hybridSwapped : themes[id]));
const leakAfter = checkTerminologyLeak(after);
console.log(`hybrid 三键 glossary 换成新词后串戏 err = ${String(leakAfter.length)} 条`);
for (const e of leakAfter) console.log('   ' + e);

// 但**基准套**若一起扫（人眼会以为门禁这么判），hybrid 的棋盘格名与认证题就会暴露：
const withBase = checkTerminologyLeak(IDS.map((id) => (id === 'hybrid' ? hybridSwapped : themes[id])))
  .filter((e) => e.includes('[hybrid]'));
console.log(`\n（若把基准套也纳入串戏比对，方向 B 会额外暴露 ${String(withBase.length)} 条——门禁今天不这么扫，列出来是给 B81 看的）`);
for (const e of withBase) console.log('   ' + e);

console.log('\n=== 门⑧ 两两互异（三新叶进 SENTENCE_LEAVES 后的新判据）===');
console.log(`SENTENCE_LEAVES 现为 ${String(SENTENCE_LEAVES.length)} 项：${SENTENCE_LEAVES.join('/')}`);
for (const leaf of NEW_LEAVES) {
  const vals = IDS.map((id) => PLANNED_TERMS[id][leaf]);
  console.log(`  ${leaf.padEnd(7)} ${vals.join(' / ')} ⇒ 互异 = ${String(new Set(vals).size === vals.length)}`);
}

console.log('\n=== 方向 B 的**印品代价**（门⑧ 不拦，但印刷层会真的变字）===');
// 规则书叙述用 `{{rift}}` / `{{hazard}}` 占位符，渲染时按 **glossary** 替换（`tools/rules-book-contract.mjs:39/48`）
// ⇒ 换 hybrid 的 glossary 三键 = hybrid 规则书章节标题与术语表行跟着变；这正是规格 §1「print 零差异」的假设被推翻的地方。
const printRoot = at('print', 'hybrid');
const seen = [];
const walkDir = (d, prefix) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { walkDir(p, `${prefix}${e}/`); continue; }
    if (!/\.(html|json|md)$/.test(e)) { continue; }
    const body = readFileSync(p, 'utf8');
    const per = NEW_LEAVES.map((k) => {
      const w = themes.hybrid.glossary[k];
      const n = body.split(w).length - 1;
      return n > 0 ? `${w}×${String(n)}` : '';
    }).filter((s) => s.length > 0);
    if (per.length > 0) seen.push(`   print/hybrid/${prefix}${e}  ${per.join(' ')}`);
  }
};
walkDir(printRoot, '');
console.log(seen.join('\n'));
console.log(`⇒ 方向 B 若成立，这些行必须重生成并在提交信息里逐条列出（规格 §5 验收 12 的"产品文案变化"口径）`);
