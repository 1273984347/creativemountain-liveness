// 双轨一致性门禁（规格 §9.3）：ir.json 主比对 + SVG 辅比对 + 数值溯源 + PDF 粗检。
//
// 四级各自独立、任一红即 exit 1：
//   ① **主比对**：ir.json ↔ theme.json 逐字段（结构化数据，最可靠）
//   ② **辅比对**：实体件 SVG 的文本节点 ↔ ir.json（防止「IR 对但没渲染」）
//   ③ **数值溯源**：规则书 HTML 的 `data-src` 单元格 → engine/scales.ts（值级）
//   ④ **PDF 粗检**：可打开 / 页数 / 字体嵌入（**不逐字比对**——中文 PDF 文本层不稳）

import { pathToFileURL } from 'node:url';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadScalesFromSource } from './scales-parse.mjs';

import { countPdfPages, hasEmbeddedFont, isOpenablePdf } from './pdf-inspect.mjs';

export function checkIrVsTheme(ir, theme) {
  const errors = [];
  const byId = (arr, key) => new Map((arr ?? []).map((x) => [x[key], x]));
  // meta
  for (const k of ['id', 'name', 'tagline', 'resourceName', 'deckName']) {
    if (ir.meta?.[k] !== theme.meta?.[k]) {
      errors.push('meta.' + k + ' 不一致：ir=' + String(ir.meta?.[k]) + ' theme=' + String(theme.meta?.[k]));
    }
  }
  // counts
  for (const k of ['handStart', 'deckTotal', 'trialTotal', 'certTotal']) {
    if (ir.counts?.[k] !== theme.counts?.[k]) {
      errors.push('counts.' + k + ' 不一致');
    }
  }
  // factions
  const irF = byId(ir.factions, 'id');
  for (const f of theme.factions ?? []) {
    const o = irF.get(f.id);
    if (o === undefined) { errors.push('阵营 ' + f.id + ' 在 ir 中缺失'); continue; }
    for (const k of ['name', 'hpBase', 'resourceBase', 'abilityText', 'wheelText']) {
      if (o[k] !== f[k]) { errors.push('阵营 ' + f.id + ' 的 ' + k + ' 不一致'); }
    }
  }
  // identities
  const irI = byId(ir.identities, 'id');
  for (const i of theme.identities ?? []) {
    const o = irI.get(i.id);
    if (o === undefined) { errors.push('身份 ' + i.id + ' 在 ir 中缺失'); continue; }
    // ⚠️ IR 用**展开后的字段名**（goalKind / goalCount），theme 用嵌套 goal（kind / count），
    // 所以这里必须**按语义配对**，不能按同名字段比。
    const pairs = [
      ['name', o.name, i.name],
      ['passiveText', o.passiveText, i.passiveText],
      ['goalKind', o.goalKind, i.goal.kind],
      ['goalCount', o.goalCount, i.goal.count ?? 1],
      ['flavor', o.flavor, i.flavor],
    ];
    for (const [label, a, b] of pairs) {
      if (a !== b && !(label === 'flavor' && i.flavor === undefined && o.flavor === undefined)) {
        errors.push('身份 ' + i.id + ' 的 ' + label + ' 不一致');
      }
    }
  }
  // cards
  const irC = byId(ir.cards, 'id');
  for (const c of theme.cards ?? []) {
    const o = irC.get(c.id);
    if (o === undefined) { errors.push('卡牌 ' + c.id + ' 在 ir 中缺失'); continue; }
    for (const k of ['name', 'type', 'cost', 'color', 'rank', 'text', 'rankLabel', 'suit']) {
      if (o[k] !== c[k] && !(c[k] === undefined && o[k] === undefined)) {
        errors.push('卡牌 ' + c.id + ' 的 ' + k + ' 不一致');
      }
    }
  }
  // certCards / trials / heavenCards / creationCards
  // ⚠️ IR 只保留**渲染所需**的字段（§6.7.1），因此比对必须用**字段白名单**，
  // 不能拿 theme 的全字段去比 —— 例如天机牌的 effects 不进 IR（引擎另有来源）。
  const cmpList = (label, irList, themeList, key, fields) => {
    const a = new Map((irList ?? []).map((x) => [x[key], x]));
    for (const t of themeList ?? []) {
      const o = a.get(t[key]);
      if (o === undefined) { errors.push(label + ' ' + t[key] + ' 在 ir 中缺失'); continue; }
      for (const f of fields) {
        if (o[f] !== t[f]) { errors.push(label + ' ' + t[key] + ' 的 ' + f + ' 不一致'); }
      }
    }
  };
  cmpList('认证题卡', ir.certCards, theme.certificationCards, 'id', ['prompt']);
  cmpList('试炼牌', ir.trials, theme.trials, 'id', ['text']);
  cmpList('天机牌', ir.heavenCards, theme.heavenCards, 'id', ['name', 'text']);
  cmpList('造物牌', ir.creationCards, theme.creationDeck, 'cardId', ['name', 'text']);
  return errors;
}
/** 从 SVG 文本里提取所有 <text> 节点的内容（XML 精确解析）。 */
export function extractSvgTexts(svg) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const raw = m[1] ?? '';
    out.push(raw
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim());
  }
  return out;
}

/**
 * ② 辅比对：实体件 SVG 的文本节点 ↔ ir.json。
 *
 * 目的：防止「IR 正确但模板漏印」——IR 里的关键文本必须真的出现在 SVG 里。
 */
export function checkSvgVsIr(svgTexts, ir) {
  const errors = [];
  // ⚠️ SVG 里的长文本会被 wrap() **按字数硬切成多行**（多个 <text> 节点），
  // 所以整串 includes 必然落空。正确做法：**去掉所有空白后做子串判断**——
  // 折行只插入换行，字符序列本身不变。
  const squash = (s) => s.replace(/\s+/g, '');
  const haystack = squash(svgTexts.join(''));
  /** 判断一段文本是否真的被渲染进了 SVG（忽略折行差异）。 */
  const renderedAll = (value) => {
    if (typeof value !== 'string' || value.length === 0) { return false; }
    return haystack.includes(squash(value));
  };
  const must = [];
  for (const c of ir.cards ?? []) { must.push(['卡牌名', c.name]); }
  for (const i of ir.identities ?? []) { must.push(['身份名', i.name]); }
  for (const f of ir.factions ?? []) { must.push(['阵营名', f.name]); }
  for (const h of ir.heavenCards ?? []) { must.push(['天机牌名', h.name]); }
  for (const c of ir.certCards ?? []) { must.push(['认证题卡', c.prompt]); }
  for (const t of ir.trials ?? []) { must.push(['试炼牌', t.text]); }
  // 调试护栏：任何 undefined 都说明取错了字段名
  for (const [label, value] of must) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(label + ' 取值为空（IR 字段名可能不匹配）');
    }
  }
  for (const [label, value] of must) {
    if (!renderedAll(value)) {
      errors.push(label + '未渲染进 SVG：' + String(value).slice(0, 40));
    }
  }
  return errors;
}
/**
 * ③ 数值溯源比对：规则书 HTML 的 `data-src` 单元格 → engine/scales.ts。
 *
 * 三步判据（缺一不可）：
 *   1. **存在性**：每个带数值溯源的单元格必须有 `data-src`；
 *   2. **可解析性**：路径能定位到 scales 的行与字段，字段名在 §8 契约内；
 *   3. **值相等**：单元格渲染文本 == 源字段当前值。
 *
 * `scales` 形如 `[{ players: 5, threshold: 3, ... }]`。
 */
export function checkTracedCells(html, scales, fieldNames) {
  const errors = [];
  // 取所有带 data-src 的单元格
  const re = /<td\b([^>]*\bdata-src="([^"]+)"[^>]*)>([\s\S]*?)<\/td>/g;
  const allowed = new Set(fieldNames);
  const byPlayers = new Map((scales ?? []).map((r) => [r.players, r]));
  let count = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[2];
    const rendered = (m[3] ?? '').replace(/<[^>]+>/g, '').trim();
    count += 1;
    if (src === undefined) { continue; }
    const pm = /^scales\[(\d+)\]\.([a-zA-Z_0-9]+)$/.exec(src);
    if (pm === null) {
      errors.push('溯源路径格式非法：' + src);
      continue;
    }
    const players = Number(pm[1]);
    const field = pm[2];
    if (field === undefined || !allowed.has(field)) {
      errors.push('溯源字段不在 §8 契约内：' + src);
      continue;
    }
    const row = byPlayers.get(players);
    if (row === undefined) {
      errors.push('溯源路径指向不存在的人数档：' + src);
      continue;
    }
    const source = row[field];
    if (String(source) !== rendered) {
      errors.push('溯源值与引擎常量不符：' + src + '（规则书=' + rendered + ' 引擎=' + String(source) + '）');
    }
  }
  if (count === 0) {
    errors.push('规则书中未找到任何带 data-src 的数值单元格（溯源标记缺失）');
  }
  return { errors, count };
}
/**
 * ④ PDF 粗检：可打开 / 页数 > 0 / 字体已嵌入。
 *
 * **不比对 PDF 文本层**——中文 PDF 提取不稳定（见规格 §9.3 覆盖边界表）。
 */
export function checkPdfBasic(buffer, label) {
  const errors = [];
  if (!isOpenablePdf(buffer)) {
    errors.push(label + '：PDF 无法打开（文件头非法）');
    return errors;
  }
  const pages = countPdfPages(buffer);
  if (pages < 1) {
    errors.push(label + '：PDF 页数为 0');
  }
  if (!hasEmbeddedFont(buffer)) {
    errors.push(label + '：PDF 未嵌入字体（打印会掉字）');
  }
  return errors;
}
// ---------- CLI ----------
function loadScales() {
  // ⚠️ B11：改为**从源码派生**的共享解析器 —— 此前此处手抄一份字段正则，
  //   加字段漏改就会误报（实测新增 seatWeight 时 24 项溯源误报）。
  return loadScalesFromSource(process.cwd());
}

/** §8 字段名契约（白名单）。 */
function scaleFieldNames() {
  const src = readFileSync(resolve(process.cwd(), 'engine/scales.ts'), 'utf8');
  const i = src.indexOf('export const SCALE_FIELD_NAMES');
  const seg = src.slice(i, src.indexOf(']', i) + 1);
  return [...seg.matchAll(/'([a-zA-Z_0-9]+)'/g)].map((m) => m[1]);
}

/** 校验单套主题的四级一致性。 */
function checkOne(cwd, themeId) {
  const dir = resolve(cwd, 'print', themeId);
  const ir = JSON.parse(readFileSync(resolve(dir, 'ir.json'), 'utf8'));
  const theme = JSON.parse(readFileSync(resolve(cwd, 'themes', themeId, 'theme.json'), 'utf8'));
  const scales = loadScales();
  const fieldNames = scaleFieldNames();
  const levels = [];
  const allErrors = [];

  // ① 主比对
  const e1 = checkIrVsTheme(ir, theme);
  levels.push({ name: '主比对 ir↔theme', passed: e1.length === 0 });
  allErrors.push(...e1.map((e) => '[主比对] ' + e));

  // ② 辅比对：所有 SVG 的文本节点
  const svgDir = resolve(dir, 'svg');
  const svgTexts = [];
  if (existsSync(svgDir)) {
    for (const f of readdirSync(svgDir).filter((x) => x.endsWith('.svg'))) {
      svgTexts.push(...extractSvgTexts(readFileSync(resolve(svgDir, f), 'utf8')));
    }
  }
  const e2 = checkSvgVsIr(svgTexts, ir);
  levels.push({ name: '辅比对 SVG↔ir', passed: e2.length === 0 });
  allErrors.push(...e2.map((e) => '[辅比对] ' + e));

  // ③ 数值溯源
  const rulesHtml = readFileSync(resolve(dir, '规则书.html'), 'utf8');
  const e3r = checkTracedCells(rulesHtml, scales, fieldNames);
  levels.push({ name: '数值溯源 data-src↔scales', passed: e3r.errors.length === 0 });
  allErrors.push(...e3r.errors.map((e) => '[溯源] ' + e));
  console.log('  溯源单元格：' + e3r.count + ' 个带 data-src');

  // ④ PDF 粗检
  const e4 = [];
  for (const f of ['规则书.pdf', '实体件.pdf']) {
    const p = resolve(dir, f);
    if (!existsSync(p)) { e4.push(f + '：文件不存在（先跑 npm run build:print）'); continue; }
    e4.push(...checkPdfBasic(readFileSync(p), f));
  }
  levels.push({ name: 'PDF 粗检', passed: e4.length === 0 });
  allErrors.push(...e4.map((e) => '[PDF] ' + e));

  return { levels, allErrors };
}

function main() {
  const cwd = process.cwd();
  const themeIds = readdirSync(resolve(cwd, 'themes'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => existsSync(resolve(cwd, 'themes', id, 'theme.json')))
    .sort();
  let failed = 0;
  for (const themeId of themeIds) {
    console.log('== ' + themeId + ' ==');
    const dir = resolve(cwd, 'print', themeId);
    const ir = JSON.parse(readFileSync(resolve(dir, 'ir.json'), 'utf8'));
    const theme = JSON.parse(readFileSync(resolve(cwd, 'themes', themeId, 'theme.json'), 'utf8'));
    const scales = loadScales();
    const fieldNames = scaleFieldNames();
    const levels = [];
    const allErrors = [];

    const e1 = checkIrVsTheme(ir, theme);
    levels.push({ name: '主比对 ir↔theme', passed: e1.length === 0 });
    allErrors.push(...e1.map((e) => '[主比对] ' + e));

    const svgDir = resolve(dir, 'svg');
    const svgTexts = [];
    if (existsSync(svgDir)) {
      for (const f of readdirSync(svgDir).filter((x) => x.endsWith('.svg'))) {
        svgTexts.push(...extractSvgTexts(readFileSync(resolve(svgDir, f), 'utf8')));
      }
    }
    const e2 = checkSvgVsIr(svgTexts, ir);
    levels.push({ name: '辅比对 SVG↔ir', passed: e2.length === 0 });
    allErrors.push(...e2.map((e) => '[辅比对] ' + e));

    const rulesHtml = readFileSync(resolve(dir, '规则书.html'), 'utf8');
    const e3r = checkTracedCells(rulesHtml, scales, fieldNames);
    levels.push({ name: '数值溯源 data-src↔scales', passed: e3r.errors.length === 0 });
    allErrors.push(...e3r.errors.map((e) => '[溯源] ' + e));
    console.log('  溯源单元格：' + e3r.count + ' 个带 data-src');

    const e4 = [];
    for (const f of ['规则书.pdf', '实体件.pdf']) {
      const p = resolve(dir, f);
      if (!existsSync(p)) { e4.push(f + '：文件不存在（先跑 npm run build:print）'); continue; }
      e4.push(...checkPdfBasic(readFileSync(p), f));
    }
    levels.push({ name: 'PDF 粗检', passed: e4.length === 0 });
    allErrors.push(...e4.map((e) => '[PDF] ' + e));

    for (const l of levels) {
      console.log((l.passed ? 'PASS  ' : 'FAIL  ') + l.name);
    }
    if (allErrors.length > 0) {
      for (const e of allErrors) { console.error('  ' + e); }
      failed += allErrors.length;
    }
  }
  if (failed > 0) {
    console.error('\nparity-check: ' + failed + ' 项不一致');
    process.exit(1);
  }
  console.log('\nparity-check: 4 级全绿（双轨零漂移）× ' + themeIds.length + ' 套主题');
}const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) { main(); }
