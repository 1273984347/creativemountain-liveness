// 主题包校验器 —— 结构 + 引用完整性 + ops 白名单 + goal kind 白名单 + 数量一致性。
//
// 全部判据**从 engine/types/theme.ts 派生**（见 tools/theme-schema.mjs），
// 不存在手抄的第二事实源。任一错误 → exit 1。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deriveThemeSchema } from './theme-schema.mjs';

const THEME_PATH = resolve(process.argv[2] ?? 'themes/xianxia2026/theme.json');

/** 校验结果。 */
export function validateTheme(theme, schema) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // ---------- 顶层结构 ----------
  if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) {
    return { errors: ['主题包根必须是对象'], warnings };
  }
  const requiredTop = ['meta', 'glossary', 'counts', 'factions', 'identities', 'cards', 'board', 'heavenCards', 'certificationCards'];
  for (const k of requiredTop) {
    if (theme[k] === undefined) { err(`缺少顶层字段：${k}`); }
  }
  if (errors.length > 0) { return { errors, warnings }; }

  // ---------- meta / glossary ----------
  for (const k of ['id', 'name', 'tagline', 'resourceName', 'deckName']) {
    if (typeof theme.meta[k] !== 'string' || theme.meta[k].length === 0) {
      err(`meta.${k} 必须是非空字符串`);
    }
  }
  // glossary 至少覆盖四个核心术语（§10.1 必须差异化项）
  for (const k of ['HP', 'deck', 'hand', 'resource']) {
    if (typeof theme.glossary[k] !== 'string' || theme.glossary[k].length === 0) {
      err(`glossary 缺少核心术语：${k}`);
    }
  }

  // ---------- counts ----------
  for (const k of ['handStart', 'deckTotal', 'trialTotal', 'certTotal']) {
    if (!Number.isInteger(theme.counts[k]) || theme.counts[k] < 0) {
      err(`counts.${k} 必须是非负整数`);
    }
  }

  // ---------- 阵营（4 个）----------
  if (!Array.isArray(theme.factions) || theme.factions.length !== 4) {
    err(`阵营必须恰好 4 个，实际 ${theme.factions?.length ?? 0}`);
  }
  const factionIds = new Set();
  for (const f of theme.factions ?? []) {
    if (typeof f.id !== 'string' || f.id.length === 0) { err('阵营缺少 id'); }
    else if (factionIds.has(f.id)) { err(`阵营 id 重复：${f.id}`); }
    else { factionIds.add(f.id); }
    if (typeof f.name !== 'string' || f.name.length === 0) { err(`阵营 ${f.id} 缺少 name`); }
    if (!Number.isInteger(f.hpBase) || f.hpBase < 1) { err(`阵营 ${f.id} 的 hpBase 必须是正整数`); }
    if (!Number.isInteger(f.resourceBase)) { err(`阵营 ${f.id} 的 resourceBase 必须是整数`); }
    if (!Array.isArray(f.deckTags)) { err(`阵营 ${f.id} 的 deckTags 必须是数组`); }
  }

  // ---------- 身份（goal kind 白名单）----------
  if (!Array.isArray(theme.identities) || theme.identities.length !== 8) {
    err(`身份必须恰好 8 个，实际 ${theme.identities?.length ?? 0}`);
  }
  const identityIds = new Set();
  for (const id of theme.identities ?? []) {
    if (typeof id.id !== 'string' || id.id.length === 0) { err('身份缺少 id'); }
    else if (identityIds.has(id.id)) { err(`身份 id 重复：${id.id}`); }
    else { identityIds.add(id.id); }
    if (id.goal === undefined) { err(`身份 ${id.id} 缺少 goal`); }
    else {
      if (!schema.goalKinds.includes(id.goal.kind)) {
        err(`身份 ${id.id} 的 goal.kind 不在白名单：${id.goal.kind}`);
      }
      if (id.goal.count !== undefined && (!Number.isInteger(id.goal.count) || id.goal.count < 1)) {
        err(`身份 ${id.id} 的 goal.count 必须是正整数`);
      }
    }
  }
  // ---------- 卡牌 ----------
  const cardIds = new Set();
  if (!Array.isArray(theme.cards)) {
    err('cards 必须是数组');
  }
  const colorCount = { red: 0, black: 0 };
  for (const c of theme.cards ?? []) {
    if (typeof c.id !== 'string' || c.id.length === 0) { err('卡牌缺少 id'); continue; }
    if (cardIds.has(c.id)) { err(`卡牌 id 重复：${c.id}`); }
    cardIds.add(c.id);
    if (typeof c.name !== 'string' || c.name.length === 0) { err(`卡牌 ${c.id} 缺少 name`); }
    if (!schema.cardTypes.includes(c.type)) {
      err(`卡牌 ${c.id} 的 type 不在白名单：${c.type}（允许 ${schema.cardTypes.join('/')}）`);
    }
    if (!Number.isInteger(c.cost) || c.cost < 0) { err(`卡牌 ${c.id} 的 cost 必须是非负整数`); }
    if (c.color !== 'red' && c.color !== 'black') { err(`卡牌 ${c.id} 的 color 必须是 red/black`); }
    else { colorCount[c.color] += 1; }
    if (!Number.isInteger(c.rank) || c.rank < 2 || c.rank > 14) {
      err(`卡牌 ${c.id} 的 rank 必须是 2–14 的整数（A=14），实际 ${c.rank}`);
    }
    if (typeof c.text !== 'string' || c.text.length === 0) { err(`卡牌 ${c.id} 缺少 text`); }
    if (!Array.isArray(c.effects)) { err(`卡牌 ${c.id} 的 effects 必须是数组`); }
  }
  // 红黑比例（§3.3 建议各半）——建议级，不判红
  const total = colorCount.red + colorCount.black;
  if (total > 0) {
    const ratio = colorCount.red / total;
    if (ratio < 0.4 || ratio > 0.6) {
      warn(`红黑比例偏离各半：红 ${colorCount.red} / 黑 ${colorCount.black}（建议各半）`);
    }
  }

  // ---------- 效果（ops 白名单 + 参数）----------
  /** 递归校验一个 effect 及其嵌套。 */
  function checkEffect(effect, path) {
    if (effect === null || typeof effect !== 'object') {
      err(`${path}：效果必须是对象`);
      return;
    }
    const op = effect.op;
    if (typeof op !== 'string') { err(`${path}：效果缺少 op`); return; }
    const spec = schema.ops[op];
    if (spec === undefined) {
      err(`${path}：未注册的算子「${op}」`);
      return;
    }
    const present = Object.keys(effect).filter((k) => k !== 'op');
    for (const r of spec.required) {
      if (!present.includes(r)) { err(`${path}（${op}）：缺少必填参数 ${r}`); }
    }
    for (const o of spec.optional) {
      if (present.includes(o) && effect[o] === undefined) {
        err(`${path}（${op}）：可选参数 ${o} 不应为 undefined`);
      }
    }
    for (const k of present) {
      if (!spec.required.includes(k) && !spec.optional.includes(k)) {
        err(`${path}（${op}）：多余参数 ${k}`);
      }
    }
    // 递归嵌套
    if (op === 'sequence') {
      if (!Array.isArray(effect.effects)) { err(`${path}（sequence）：effects 必须是数组`); }
      else { effect.effects.forEach((e, i) => checkEffect(e, `${path}.effects[${i}]`)); }
    }
    if (op === 'conditional') {
      checkPredicate(effect.pred, `${path}.pred`);
      checkEffect(effect.then, `${path}.then`);
      if (effect.else !== undefined) { checkEffect(effect.else, `${path}.else`); }
    }
    if (op === 'count') {
      checkEffect(effect.effect, `${path}.effect`);
    }
  }
  /** 递归校验一个谓词。 */
  function checkPredicate(pred, path) {
    if (pred === null || typeof pred !== 'object') { err(`${path}：谓词必须是对象`); return; }
    if (!schema.predicateNames.includes(pred.kind)) {
      err(`${path}：未注册的谓词「${pred.kind}」`);
    }
    if (pred.kind === 'conditional') { checkPredicate(pred.pred, `${path}.pred`); }
  }
  for (const c of theme.cards ?? []) {
    (c.effects ?? []).forEach((e, i) => checkEffect(e, `card[${c.id}].effects[${i}]`));
  }
  for (const f of theme.factions ?? []) {
    if (f.ability !== undefined) { checkEffect(f.ability, `faction[${f.id}].ability`); }
    if (f.wheel !== undefined) { checkEffect(f.wheel, `faction[${f.id}].wheel`); }
  }
  for (const id of theme.identities ?? []) {
    if (id.passive !== undefined) { checkEffect(id.passive, `identity[${id.id}].passive`); }
  }
  for (const h of theme.heavenCards ?? []) {
    (h.effects ?? []).forEach((e, i) => checkEffect(e, `heaven[${h.id}].effects[${i}]`));
  }
  for (const t of theme.trials ?? []) {
    (t.effects ?? []).forEach((e, i) => checkEffect(e, `trial[${t.id}].effects[${i}]`));
  }
  for (const cc of theme.creationDeck ?? []) {
    (cc.effects ?? []).forEach((e, i) => checkEffect(e, `creation[${cc.cardId}].effects[${i}]`));
  }
  // ---------- 棋盘 ----------
  const board = theme.board;
  if (!Number.isInteger(board.length) || board.length < 2) { err('board.length 必须是 ≥2 的整数'); }
  if (!Number.isInteger(board.peakIndex) || board.peakIndex !== board.length) {
    err(`board.peakIndex 必须等于 board.length（峰顶即末格）`);
  }
  if (!Array.isArray(board.tiles)) { err('board.tiles 必须是数组'); }
  else {
    const tileIdx = new Set();
    for (const t of board.tiles) {
      if (!Number.isInteger(t.index) || t.index < 1 || t.index > board.length) {
        err(`格位 index 越界：${t.index}`);
      }
      if (tileIdx.has(t.index)) { err(`格位 index 重复：${t.index}`); }
      tileIdx.add(t.index);
      if (typeof t.kind !== 'string') { err(`格位 ${t.index} 缺少 kind`); }
      if (t.gate !== undefined) {
        if (!Number.isInteger(t.gate.fee) || t.gate.fee < 0) { err(`关隘 ${t.index} 的 fee 必须是非负整数`); }
        if (!Array.isArray(t.gate.trialIds) || t.gate.trialIds.length === 0) {
          err(`关隘 ${t.index} 必须声明 trialIds`);
        }
      }
      if (t.branches !== undefined) {
        if (!Array.isArray(t.branches) || t.branches.length === 0) { err(`支路格 ${t.index} 的 branches 不能为空`); }
        for (const br of t.branches ?? []) {
          if (!Number.isInteger(br.to) || br.to < 1 || br.to > board.length) {
            err(`支路 ${t.index} 的终点越界：${br.to}`);
          }
        }
      }
    }
    if (board.tiles.length !== board.length) {
      err(`棋盘格数与 length 不符：${board.tiles.length} ≠ ${board.length}`);
    }
  }

  // ---------- 引用完整性 ----------
  const trialIds = new Set((theme.trials ?? []).map((t) => t.id));
  for (const t of board.tiles ?? []) {
    for (const tid of t.gate?.trialIds ?? []) {
      if (!trialIds.has(tid)) { err(`关隘 ${t.index} 引用了不存在的试炼牌：${tid}`); }
    }
  }
  for (const cc of theme.creationDeck ?? []) {
    if (typeof cc.cardId !== 'string' || cc.cardId.length === 0) { err('造物牌缺少 cardId'); continue; }
    if (!cardIds.has(cc.cardId)) { err(`造物牌引用了不存在的卡牌：${cc.cardId}`); }
    if (typeof cc.name !== 'string' || cc.name.length === 0) { err(`造物牌 ${cc.cardId} 缺少 name`); }
    if (typeof cc.text !== 'string' || cc.text.length === 0) { err(`造物牌 ${cc.cardId} 缺少 text`); }
  }

  // ---------- 数量一致性 ----------
  if (theme.counts.deckTotal !== (theme.cards?.length ?? 0)) {
    err(`counts.deckTotal（${theme.counts.deckTotal}）与 cards 实际数量（${theme.cards?.length ?? 0}）不符`);
  }
  if (theme.counts.trialTotal !== (theme.trials?.length ?? 0)) {
    err(`counts.trialTotal（${theme.counts.trialTotal}）与 trials 实际数量（${theme.trials?.length ?? 0}）不符`);
  }
  if (theme.counts.certTotal !== (theme.certificationCards?.length ?? 0)) {
    err(`counts.certTotal（${theme.counts.certTotal}）与 certificationCards 实际数量（${theme.certificationCards?.length ?? 0}）不符`);
  }
  // 认证题卡 ≥ 8 张且主题化（§10.1 必须差异化项）
  if ((theme.certificationCards?.length ?? 0) < 8) {
    err(`认证题卡至少 8 张，实际 ${theme.certificationCards?.length ?? 0}（§10.1 必须差异化项）`);
  }
  for (const cc of theme.certificationCards ?? []) {
    if (typeof cc.prompt !== 'string' || cc.prompt.length === 0) { err(`认证题卡 ${cc.id} 缺少 prompt`); }
  }
  // 天机牌 / 试炼牌基本结构
  if ((theme.heavenCards?.length ?? 0) === 0) { err('天机牌不得为空'); }
  for (const h of theme.heavenCards ?? []) {
    if (typeof h.name !== 'string' || h.name.length === 0) { err(`天机牌 ${h.id} 缺少 name`); }
    if (typeof h.text !== 'string' || h.text.length === 0) { err(`天机牌 ${h.id} 缺少 text`); }
  }
  for (const t of theme.trials ?? []) {
    if (typeof t.text !== 'string' || t.text.length === 0) { err(`试炼牌 ${t.id} 缺少 text`); }
  }

  return { errors, warnings };
}

// ---------- CLI ----------
const schema = deriveThemeSchema();
let theme;
try {
  theme = JSON.parse(readFileSync(THEME_PATH, 'utf8'));
} catch (e) {
  console.error(`FAIL  主题包读取/解析失败：${THEME_PATH}`);
  console.error(`      ${e.message}`);
  process.exit(1);
}
const result = validateTheme(theme, schema);
for (const w of result.warnings) {
  console.log(`WARN  ${w}`);
}
if (result.errors.length > 0) {
  for (const e of result.errors) {
    console.error(`FAIL  ${e}`);
  }
  console.error(`\n主题包校验失败：${result.errors.length} 项错误（${THEME_PATH}）`);
  process.exit(1);
}
console.log(`PASS  主题包校验通过：${THEME_PATH}`);
console.log(`      卡牌 ${theme.cards.length} · 阵营 ${theme.factions.length} · 身份 ${theme.identities.length} · 天机 ${theme.heavenCards.length} · 试炼 ${(theme.trials ?? []).length} · 认证题 ${theme.certificationCards.length} · 造物 ${(theme.creationDeck ?? []).length}`);
