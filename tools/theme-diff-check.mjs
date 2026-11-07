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

/** 检查一套新主题相对基准的 §10.1 两张清单。 */
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
  for (const key of ['HP', 'deck', 'hand', 'resource']) {
    const v = theme.glossary?.[key];
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${tag} ② glossary 缺少核心术语：${key}`);
    } else if (v === base.glossary?.[key]) {
      errors.push(`${tag} ② glossary.${key} 与基准相同：${v}`);
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
    const themed = certs.filter((c) => words.some((w) => typeof w === 'string' && w.length > 0 && c.prompt.includes(w)));
    if (themed.length < MIN_CERT_CARDS) {
      errors.push(
        `${tag} ③ 仅 ${themed.length} 张认证题命中本主题专属名词（需 ≥ ${MIN_CERT_CARDS}）——`
        + `说明认证题仍是通用题，只换了措辞`,
      );
    }
    notes.push(`③ 主题化认证题 ${themed.length}/${certs.length} 张`);
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

  // ---------- 允许复用 c) 8 身份槽位 ----------
  for (let i = 0; i < (theme.identities ?? []).length; i++) {
    const idn = theme.identities[i];
    const baseIdn = (base.identities ?? [])[i];
    if (baseIdn === undefined) {
      break;
    }
    if (!deepEqual(idn.passive, baseIdn.passive)) {
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

/** 检查若干主题之间**两两**差异化（防止三套新主题其实是同一套换名字）。 */
export function checkThemesMutuallyDistinct(themes) {
  const errors = [];
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
      const namesA = new Set((a.factions ?? []).map((f) => f.name));
      for (const f of b.factions ?? []) {
        if (namesA.has(f.name)) { errors.push(`${pair} 阵营名重名：${f.name}`); }
      }
      const promptsA = new Set((a.certificationCards ?? []).map((c) => c.prompt));
      for (const c of b.certificationCards ?? []) {
        if (promptsA.has(c.prompt)) { errors.push(`${pair} 认证题逐字相同：${c.prompt}`); }
      }
    }
  }
  return errors;
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

  if (loaded.length > 1) {
    const mutual = checkThemesMutuallyDistinct(loaded);
    if (mutual.length === 0) {
      console.log(`\nPASS  ${loaded.length} 套主题两两差异化通过`);
    } else {
      console.error(`\nFAIL  主题两两差异化未通过：`);
      for (const e of mutual) {
        console.error(`      ${e}`);
      }
      allErrors.push(...mutual);
    }
  }

  if (allErrors.length > 0) {
    console.error(`\nFAIL：${allErrors.length} 项差异化未通过`);
    process.exit(1);
  }
  console.log(`\nPASS：主题差异化核对全绿`);
}
