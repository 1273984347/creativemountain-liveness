// §10.1 差异化清单核对（第 8 道门）
//
// 目的：把「B8 必须差异化 4 项 / 允许复用 3 项」从**人工核对清单**变成**机器判据**。
//   · 规格 §10.1 原文：「必须差异化（缺一不可，逐项核对）」「允许复用（明确写出，防止过度设计）」。
//   · 实施计划 §9.2 验收：「§10.1『必须差异化 4 项』逐项核对通过」+「『允许复用 3 项』未被过度设计」。
//
// 判据全部**机械**：主题包之间做深度比较，不靠人眼。
//
// 必须差异化 4 项（缺一不可）：
//   ① 主题标识：meta.name / meta.tagline / 四阵营 name 与基准**全部**不同
//   ② glossary 四核心术语（HP / deck / hand / resource）与基准全部不同
//   ②′ terms 句子层五叶（resource / gate / path / peak / hp）与基准全部不同（B79 §3.6），
//      并且**跨套两两互异**——只比基准看不见「两套非基准主题撞词」
//   ③ 认证题卡：≥8 张；与基准 prompt **逐字**不同；且 ≥8 张命中本主题 domainWords
//   ④ 标志性卡牌：1–2 张，且其 effects 与基准卡池**任何一张**都不同
//
// 允许复用 3 项（反向核对「没有被过度设计」）：
//   a) 通用卡牌池：按位置对位，≥46/48 张的 effects 与基准逐字相同
//   b) 事件池与试炼结构：heavenCards / trials 的 effects 与基准逐字相同
//   c) 8 身份槽位：passive 与 goal 与基准逐字相同（只换名字与 flavor）
//
// 用法：
//   `node tools/theme-diff-check.mjs`                          → 基准=仙侠，被检=themes/ 下其余全部
//   `node tools/theme-diff-check.mjs <基准> <被检> [<被检>...]`

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASE_THEME_PATH = resolve('themes/xianxia2026/theme.json');

/** 允许复用的通用卡池下限（48 张中至少 46 张与基准逐字同效果）。 */
export const MIN_REUSED_CARDS = 46;

/** 标志卡数量区间（规格 §10.1：1–2 张）。 */
export const MIN_FLAG_CARDS = 1;
export const MAX_FLAG_CARDS = 2;

/** 认证题卡最少主题化张数（规格 §10.1：至少 8 张）。 */
export const MIN_CERT_CARDS = 8;

/** 专属名词表最少词数（防「1 个平凡词蒙混过关」）。 */
export const MIN_DOMAIN_WORDS = 6;

/** 专属名词表的最短词长（单字词如「的」不具备区分度）。 */
export const MIN_DOMAIN_WORD_LEN = 2;

/**
 * 句子层五叶（B79 §3.6）：引擎与界面的中文句子里会印出来的那五个词。
 *
 * 与 `engine/core/theme-text.ts` 的 `TERM_TOKENS` 是同一集合（占位符名 = 叶名）。
 * 两处各自声明而不共用：门 ⑧ 只管「跨套撞不撞词」，渲染层只管「怎么替换」，
 * 让差异化去 import 渲染实现是把两件事焊死。**漂移由 T4 的测试钉住**
 * （`SENTENCE_LEAVES ≡ TERM_TOKENS`），不是靠人记得两边一起改。
 */
export const SENTENCE_LEAVES = ['resource', 'gate', 'path', 'peak', 'hp', 'rift', 'hazard', 'player'];

/** 深度比较前的规范化：对象键排序 ⇒ 与 JSON 键书写顺序无关。 */
export function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value;
}

/** 深度相等（与键序无关）。 */
export function deepEqual(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * 取一套主题相对基准**全新效果**的卡（标志性卡牌）。
 *
 * 判据：既不是与基准对位复用、又不在基准任何卡里出现过的同效果卡。
 */
export function flagCardsOf(base, theme) {
  const baseCards = base.cards ?? [];
  const flags = [];
  for (let i = 0; i < (theme.cards ?? []).length; i++) {
    const card = theme.cards[i];
    const slot = baseCards[i];
    if (card === undefined || slot === undefined) {
      continue;
    }
    if (deepEqual(card.effects, slot.effects)) {
      continue;
    }
    if (!baseCards.some((b) => deepEqual(card.effects, b.effects))) {
      flags.push(card);
    }
  }
  return flags;
}

/**
 * 把效果里的**卡牌引用**归一化为占位符。
 *
 * 用途：跨主题比较「机制是否复用」时使用。
 * 身份的被动（如匠师的 equip_card { cardId: 'c_talisman' }）在新主题里
 * 指向**改名后的**同一张牌 ⇒ 字面比较会误判「特权被独立设计」。
 * 归一化后比较的才是**机制**。
 */
export function normalizeRefs(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeRefs);
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (k === 'cardId') {
        out[k] = '<CARD>';
      } else if (k === 'cardIds') {
        out[k] = (value[k] ?? []).map(() => '<CARD>');
      } else {
        out[k] = normalizeRefs(value[k]);
      }
    }
    return out;
  }
  return value;
}

/** 检查一套新主题相对基准的 §10.1 两张清单。 */
/**
 * 允许跨套同名的 trial id 白名单（B78 §2.2 同侧规则）。
 * 今天为空 ⇒ 任何同名即红；登记 id 必须在批次记录写理由。
 * ⚠️ 它是**同名**判据的出口，与「同侧」无关 —— 同侧是人工维度（规格 §2.5）。
 */
export const SAME_NAME_ALLOWED = [];

export function checkThemeDiff(base, theme) {
  const errors = [];
  const notes = [];
  const tag = `[${theme.meta?.id ?? '?'}]`;

  // ---------- 必须差异化 ① 主题标识 ----------
  if (theme.meta?.name === base.meta.name) {
    errors.push(`${tag} ① 主题名与基准相同：${theme.meta.name}`);
  }
  if (theme.meta?.tagline === base.meta.tagline) {
    errors.push(`${tag} ① tagline 与基准相同`);
  }
  const baseFactionNames = new Set((base.factions ?? []).map((f) => f.name));
  for (const f of theme.factions ?? []) {
    if (baseFactionNames.has(f.name)) {
      errors.push(`${tag} ① 阵营名「${f.name}」与基准重名`);
    }
  }

  // ---------- 必须差异化 ② glossary 四核心术语 ----------
  const glossaryValues = [];
  for (const key of ['HP', 'deck', 'hand', 'resource']) {
    const v = theme.glossary?.[key];
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${tag} ② glossary 缺少核心术语：${key}`);
    } else if (v === base.glossary?.[key]) {
      errors.push(`${tag} ② glossary.${key} 与基准相同：${v}`);
    } else {
      glossaryValues.push([key, v]);
    }
  }
  // 主题内部互异：HP / deck / hand / resource 若指向同一个词，玩家仍会串戏
  for (let i = 0; i < glossaryValues.length; i++) {
    for (let j = i + 1; j < glossaryValues.length; j++) {
      const a = glossaryValues[i];
      const b = glossaryValues[j];
      if (a !== undefined && b !== undefined && a[1] === b[1]) {
        errors.push(`${tag} ② glossary.${a[0]} 与 glossary.${b[0]} 同词（${a[1]}）——四个核心术语必须互异`);
      }
    }
  }

  // ---------- 必须差异化 ②′ 句子层五叶（B79 §3.6）----------
  // 这五叶自 B79 起是**引擎与界面句子里印出来的词**（`{resource}` `{gate}` `{path}` `{peak}` `{hp}`），
  // 不再只是印刷层对照表 ⇒ 撞词不再只是「两张牌重名」，而是「非本主题的对局界面通篇说别人的话」。
  // 缺叶同样判红：占位符无词可展开时，展开器按设计**抛错**（B79 §4.1），不能让局跑到那句话才炸。
  for (const leaf of SENTENCE_LEAVES) {
    const v = theme.terms?.[leaf];
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${tag} ②′ terms.${leaf} 缺失 ⇒ 句子层占位符 {${leaf}} 无词可展开`);
    } else if (v === base.terms?.[leaf]) {
      errors.push(`${tag} ②′ terms.${leaf} 与基准相同：${v}`);
    }
  }

  // ---------- 必须差异化 ③ 认证题卡（换场景不是换措辞）----------
  const certs = theme.certificationCards ?? [];
  if (certs.length < MIN_CERT_CARDS) {
    errors.push(`${tag} ③ 认证题卡仅 ${certs.length} 张，少于 ${MIN_CERT_CARDS} 张`);
  }
  const basePrompts = new Set((base.certificationCards ?? []).map((c) => c.prompt));
  for (const c of certs) {
    if (basePrompts.has(c.prompt)) {
      errors.push(`${tag} ③ 认证题「${c.prompt}」与基准逐字相同——是换措辞不是换场景`);
    }
  }
  const words = theme.domainWords ?? [];
  if (!Array.isArray(words) || words.length === 0) {
    errors.push(`${tag} ③ 未声明 domainWords，无法机械核对「换场景」`);
  } else {
    // 专属名词表本身的强度：数量下限 + 词长下限 + 互异
    // （否则 ['的'] 这类平凡词就能让所有认证题「命中」，判据形同虚设）
    const short = words.filter((w) => typeof w !== 'string' || w.trim().length < MIN_DOMAIN_WORD_LEN);
    if (short.length > 0) {
      errors.push(
        `${tag} ③ domainWords 含过短或非字符串的词（需 ≥ ${MIN_DOMAIN_WORD_LEN} 字）：`
        + `${short.map((w) => JSON.stringify(w)).join('、')}`,
      );
    }
    if (words.length < MIN_DOMAIN_WORDS) {
      errors.push(`${tag} ③ domainWords 仅 ${words.length} 个（需 ≥ ${MIN_DOMAIN_WORDS} 个）`);
    }
    if (new Set(words).size !== words.length) {
      errors.push(`${tag} ③ domainWords 存在重复词`);
    }
    const themed = certs.filter((c) => words.some((w) => typeof w === 'string' && w.length > 0 && c.prompt.includes(w)));
    if (themed.length < certs.length) {
      errors.push(
        `${tag} ③ 有 ${certs.length - themed.length} 张认证题未命中本主题专属名词——`
        + `说明认证题仍是通用题，只换了措辞`,
      );
    }
    notes.push(`③ 主题化认证题 ${themed.length}/${certs.length} 张（专属名词表 ${words.length} 个）`);
  }

  // ---------- 必须差异化 ④ + 允许复用 a) 通用卡牌池 ----------
  const baseCards = base.cards ?? [];
  const cards = theme.cards ?? [];
  if (cards.length !== baseCards.length) {
    errors.push(`${tag} a) 卡池数量 ${cards.length} ≠ 基准 ${baseCards.length}——允许复用意味着卡池规模应一致`);
  }
  let reused = 0;
  const flags = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const slot = baseCards[i];
    if (slot === undefined) {
      continue;
    }
    if (deepEqual(card.effects, slot.effects)) {
      reused += 1;
      continue;
    }
    const sameAsAny = baseCards.some((b) => deepEqual(card.effects, b.effects));
    if (sameAsAny) {
      errors.push(
        `${tag} 卡 ${card.id} 既非对位复用、又在基准的别处有同效果卡——既不是复用也不是全新效果`,
      );
    } else {
      flags.push(card);
    }
  }
  const flagKeys = flags.map((f) => JSON.stringify(canonical(f.effects)));
  if (new Set(flagKeys).size !== flagKeys.length) {
    errors.push(`${tag} 主题内部的标志卡效果重复——两张标志卡不是两种不同机制`);
  }
  if (reused < MIN_REUSED_CARDS) {
    errors.push(`${tag} a) 通用卡牌池仅 ${reused} 张与基准同效果（应 ≥ ${MIN_REUSED_CARDS}）——被过度设计了`);
  }
  if (flags.length < MIN_FLAG_CARDS || flags.length > MAX_FLAG_CARDS) {
    errors.push(
      `${tag} ④ 标志卡 ${flags.length} 张，必须在 ${MIN_FLAG_CARDS}–${MAX_FLAG_CARDS} 张之间（规格 §10.1）`,
    );
  }
  notes.push(`a) 通用卡牌复用 ${reused}/${cards.length} 张 · ④ 标志卡 ${flags.length} 张`);
  for (const f of flags) {
    notes.push(`   标志卡：${f.name}（${f.id}）`);
  }

  // ---------- 允许复用 b) 事件池与试炼结构 ----------
  const baseHeaven = base.heavenCards ?? [];
  for (let i = 0; i < (theme.heavenCards ?? []).length; i++) {
    if (baseHeaven[i] === undefined) {
      break;
    }
    if (!deepEqual(theme.heavenCards[i].effects, baseHeaven[i].effects)) {
      errors.push(`${tag} b) 天机牌 ${theme.heavenCards[i].id} 的效果与基准不同——事件池结构应复用`);
    }
  }
  const baseTrials = base.trials ?? [];
  for (let i = 0; i < (theme.trials ?? []).length; i++) {
    if (baseTrials[i] === undefined) {
      break;
    }
    if (!deepEqual(theme.trials[i].effects, baseTrials[i].effects)) {
      errors.push(`${tag} b) 试炼牌 ${theme.trials[i].id} 的效果与基准不同——试炼结构应复用`);
    }
  }
  notes.push(`b) 天机 ${(theme.heavenCards ?? []).length} 张 / 试炼 ${(theme.trials ?? []).length} 张效果沿用基准`);

  // ---------- B78：试炼牌名跨套必须互异（同侧 = 指向同一件事，不是共用同一个名字）----------
  const baseTrialNames = new Map((base.trials ?? []).map((t) => [t.id, t.name]));
  (theme.trials ?? []).forEach((t) => {
    if (SAME_NAME_ALLOWED.includes(t.id)) { return; }
    if (baseTrialNames.get(t.id) === t.name) {
      errors.push(`${tag} b) 试炼牌 ${t.id} 的名字「${String(t.name)}」与基准同名 ⇒ 同侧不等于同名（B78 §2.2）`);
    }
  });

  // ---------- 允许复用 c) 8 身份槽位 ----------
  for (let i = 0; i < (theme.identities ?? []).length; i++) {
    const idn = theme.identities[i];
    const baseIdn = (base.identities ?? [])[i];
    if (baseIdn === undefined) {
      break;
    }
    if (!deepEqual(normalizeRefs(idn.passive), normalizeRefs(baseIdn.passive))) {
      errors.push(`${tag} c) 身份 ${idn.id} 的特权与基准不同——身份槽位应复用`);
    }
    if (!deepEqual(idn.goal, baseIdn.goal)) {
      errors.push(`${tag} c) 身份 ${idn.id} 的终局目标与基准不同——身份槽位应复用`);
    }
    if (idn.id !== baseIdn.id) {
      errors.push(`${tag} c) 身份 id ${idn.id} ≠ 基准 ${baseIdn.id}（身份槽位须对齐，引擎有硬编码）`);
    }
  }
  notes.push(`c) ${(theme.identities ?? []).length} 个身份槽位特权与目标沿用基准`);

  return { errors, notes };
}

/**
 * 收集一套主题的**术语词**（glossary 里的全部词条）。
 */
export function termsOfTheme(theme) {
  const g = theme.glossary ?? {};
  return Object.values(g).filter((v) => typeof v === 'string' && v.length > 0);
}

/**
 * 收集主题里出现的所有文本（含 id / 名称 / 文案 / 效果描述）。
 */
export function allTexts(theme) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v !== null && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(theme);
  return out;
}

/**
 * **跨主题术语串戏**检查：主题 X 的文本里不得出现主题 Y 的术语词。
 *
 * ⚠️ 背景：实体件的文本来自主题包（规则书叙述用术语占位符替换），
 *   若某套主题的文案里残留了别套主题的术语（实测：融合主题写「灵枢 / 符箓库」，
 *   而它的资源词是「灵能」、牌词是「道箓」）⇒ 实体件印出来就是串戏。
 *   这类错误人眼极难在 48 张卡 × 4 套里查全，必须机器判。
 */
export function checkTerminologyLeak(themes) {
  const errors = [];
  for (const theme of themes) {
    const own = new Set(termsOfTheme(theme));
    const texts = allTexts(theme);
    for (const other of themes) {
      if (other === theme) {
        continue;
      }
      for (const word of new Set(termsOfTheme(other))) {
        if (own.has(word)) {
          continue; // 该词也是本主题自己的术语（如两个主题共用「修士」）⇒ 不算串戏
        }
        if (word.length < 2) {
          continue; // 单字词区分度不足，不据此判红
        }
        const hit = texts.find((t) => t.includes(word));
        if (hit !== undefined) {
          errors.push(
            `[${theme.meta.id}] 文本「${hit}」含其他主题[${other.meta.id}]的术语「${word}」——串戏`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * 检查若干主题之间**两两**差异化（防止三套新主题其实是同一套换名字）。
 *
 * ⚠️ 这里必须比对**卡牌 effects**，不只比对元信息：
 *   只比主题名/术语/认证题的话，一份「48 张卡 effects 逐字照抄另一套主题、
 *   只改了名与术语」的主题包能全绿通过 —— 实测过，判据形同虚设。
 *
 * 返回形状与 `checkThemeDiff` 一致（{ errors, notes }），避免调用方写错。
 */
export function checkThemesMutuallyDistinct(themes, base = null) {
  const errors = [];
  const notes = [];
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = themes[i];
      const b = themes[j];
      const pair = `[${a.meta.id} vs ${b.meta.id}]`;
      if (a.meta.name === b.meta.name) { errors.push(`${pair} 主题名相同`); }
      if (a.meta.tagline === b.meta.tagline) { errors.push(`${pair} tagline 相同`); }
      for (const key of ['HP', 'deck', 'hand', 'resource']) {
        if (a.glossary?.[key] === b.glossary?.[key]) {
          errors.push(`${pair} glossary.${key} 相同：${a.glossary?.[key]}`);
        }
      }
      // 句子层五叶两两互异（B79 §3.6）：②′ 只比基准 ⇒ 「两套非基准主题撞词」是它的盲区，
      //   这条补的正是那个盲区（本轮 path 撞词就是基准 vs 融合套，改词后同类事故会换位置复发）。
      for (const leaf of SENTENCE_LEAVES) {
        if (a.terms?.[leaf] !== undefined && a.terms?.[leaf] === b.terms?.[leaf]) {
          errors.push(`${pair} terms.${leaf} 相同：${a.terms?.[leaf]}`);
        }
      }
      const namesA = new Set((a.factions ?? []).map((f) => f.name));
      for (const f of b.factions ?? []) {
        if (namesA.has(f.name)) { errors.push(`${pair} 阵营名重名：${f.name}`); }
      }
      const promptsA = new Set((a.certificationCards ?? []).map((c) => c.prompt));
      for (const c of b.certificationCards ?? []) {
        if (promptsA.has(c.prompt)) { errors.push(`${pair} 认证题逐字相同：${c.prompt}`); }
      }
      // 卡牌 effects 层面：任意两套主题不得共用同一张标志卡效果
      if (base !== null) {
        const flagsA = flagCardsOf(base, a);
        const flagsB = flagCardsOf(base, b);
        for (const fa of flagsA) {
          for (const fb of flagsB) {
            if (deepEqual(fa.effects, fb.effects)) {
              errors.push(
                `${pair} 标志卡效果相同：${a.meta.id} 的「${fa.name}」与 ${b.meta.id} 的「${fb.name}」——`
                + `两套主题的标志卡不能是同一张牌换皮`,
              );
            }
          }
        }
        notes.push(`${a.meta.id} 标志卡 ${flagsA.length} 张 · ${b.meta.id} 标志卡 ${flagsB.length} 张（已互相比对）`);
      }
    }
  }
  return { errors, notes };
}

/** 列出 themes/ 下的全部主题包路径。 */
export function listThemePaths(root = 'themes') {
  const dir = resolve(root);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => resolve(dir, e.name, 'theme.json'))
    .filter((p) => existsSync(p))
    .sort();
}

// ---------- CLI ----------
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const basePath = args.length > 0 ? resolve(args[0]) : BASE_THEME_PATH;
  const targetPaths = args.length > 1
    ? args.slice(1).map((p) => resolve(p))
    : listThemePaths().filter((p) => p !== basePath);

  let base;
  try {
    base = JSON.parse(readFileSync(basePath, 'utf8'));
  } catch (e) {
    console.error(`FAIL  基准主题包读取失败：${basePath}`);
    console.error(`      ${e.message}`);
    process.exit(1);
  }

  console.log(`== 主题差异化核对（规格 §10.1）==`);
  console.log(`基准：${basePath}`);
  console.log(`被检：${targetPaths.length} 套\n`);

  const allErrors = [];
  const loaded = [];
  for (const p of targetPaths) {
    let theme;
    try {
      theme = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      allErrors.push(`${p} 读取失败：${e.message}`);
      continue;
    }
    loaded.push(theme);
    const r = checkThemeDiff(base, theme);
    if (r.errors.length === 0) {
      console.log(`PASS  ${theme.meta.id}`);
      for (const n of r.notes) {
        console.log(`      ${n}`);
      }
    } else {
      console.log(`FAIL  ${theme.meta.id}`);
      for (const e of r.errors) {
        console.error(`      ${e}`);
      }
      allErrors.push(...r.errors);
    }
  }

  const leaks = checkTerminologyLeak(loaded);
  if (leaks.length === 0) {
    console.log('\nPASS  无跨主题术语串戏');
  } else {
    console.error('\nFAIL  跨主题术语串戏：');
    for (const e of leaks) {
      console.error('      ' + e);
    }
    allErrors.push(...leaks);
  }

  if (loaded.length > 1) {
    const mutual = checkThemesMutuallyDistinct(loaded, base);
    if (mutual.errors.length === 0) {
      console.log(`\nPASS  ${loaded.length} 套主题两两差异化通过`);
      for (const n of mutual.notes) {
        console.log(`      ${n}`);
      }
    } else {
      console.error(`\nFAIL  主题两两差异化未通过：`);
      for (const e of mutual.errors) {
        console.error(`      ${e}`);
      }
      allErrors.push(...mutual.errors);
    }
  }

  if (allErrors.length > 0) {
    console.error(`\nFAIL：${allErrors.length} 项差异化未通过`);
    process.exit(1);
  }
  console.log(`\nPASS：主题差异化核对全绿`);
}
