// IR 校验器 —— **ir.json 的字段契约**（规格 §6.7.1）。
//
// 校验内容：
//   1. **结构**：顶层键与 `engine/types/ir.ts` 的 `IrDocument` 一致；
//   2. **溯源**：每个数值都有 `src`，且路径格式合法、字段名在 §8 契约内；
//   3. **可追溯**：每段文本都能在 theme.json 找到对应字段（逐字相等）；
//   4. **引用完整性**：关隘引用的试炼牌、造物牌引用的卡牌都存在。
//
// 任一错误 → exit 1。

import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { SCALE_FIELD_NAMES } from '../engine/scales.ts';
import { loadScalesFromSource } from './scales-parse.mjs';

/** 顶层必备键（与 IrDocument 一一对应）。 */
export const IR_TOP_KEYS = [
  'version', 'meta', 'glossary', 'counts', 'scales', 'instructionTable',
  'factions', 'identities', 'cards', 'creationCards', 'certCards', 'trials',
  'heavenCards', 'board',
];

/** 校验 ir.json。 */
export function validateIr(ir, theme, scales) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (ir === null || typeof ir !== 'object') {
    return { errors: ['ir.json 根必须是对象'], warnings };
  }
  // ---------- 1. 结构 ----------
  for (const k of IR_TOP_KEYS) {
    if (ir[k] === undefined) { err('缺少顶层键：' + k); }
  }
  for (const k of Object.keys(ir)) {
    if (!IR_TOP_KEYS.includes(k)) { err('多余顶层键：' + k); }
  }
  if (ir.version !== 1) { err('ir.version 必须是 1，实际 ' + String(ir.version)); }
  if (errors.length > 0) { return { errors, warnings }; }

  // ---------- 2. 溯源 ----------
  const fieldSet = new Set(SCALE_FIELD_NAMES);
  const scaleByPlayers = new Map();
  for (const s of scales) { scaleByPlayers.set(s.players, s); }
  for (const row of ir.scales) {
    if (!Number.isInteger(row.players)) { err('scales 行的 players 必须是整数'); continue; }
    const engineRow = scaleByPlayers.get(row.players);
    if (engineRow === undefined) { err('scales 出现引擎没有的人数档：' + row.players); continue; }
    for (const [field, cell] of Object.entries(row)) {
      if (field === 'players') { continue; }
      if (cell === null || typeof cell !== 'object' || typeof cell.value !== 'number') {
        err('scales[' + row.players + '].' + field + ' 必须是 { value, src } 形态');
        continue;
      }
      if (typeof cell.src !== 'string') { err('scales[' + row.players + '].' + field + ' 缺 src'); continue; }
      const m = /^scales\[(\d+)\]\.([a-zA-Z_0-9]+)$/.exec(cell.src);
      if (m === null) { err('溯源路径格式非法：' + cell.src); continue; }
      if (Number(m[1]) !== row.players) { err('溯源路径人数与所在行不符：' + cell.src); }
      const fname = m[2];
      if (fname === undefined || !fieldSet.has(fname)) { err('溯源字段不在 §8 契约内：' + fname); continue; }
      const engineValue = engineRow[fname];
      if (engineValue !== cell.value) {
        err('溯源值与引擎常量不符：' + cell.src + '（ir=' + cell.value + ' engine=' + String(engineValue) + '）');
      }
    }
  }

  // ---------- 3. 可追溯：文本逐字相等 ----------
  const themeFaction = new Map((theme.factions ?? []).map((f) => [f.id, f]));
  for (const f of ir.factions) {
    const src2 = themeFaction.get(f.id);
    if (src2 === undefined) { err('阵营 id 不存在于 theme.json：' + f.id); continue; }
    if (f.abilityText !== src2.abilityText) { err('阵营 ' + f.id + ' 的 abilityText 与 theme.json 不一致'); }
    if (f.wheelText !== src2.wheelText) { err('阵营 ' + f.id + ' 的 wheelText 与 theme.json 不一致'); }
  }
  const themeIdentity = new Map((theme.identities ?? []).map((i) => [i.id, i]));
  for (const i of ir.identities) {
    const src2 = themeIdentity.get(i.id);
    if (src2 === undefined) { err('身份 id 不存在于 theme.json：' + i.id); continue; }
    if (i.passiveText !== src2.passiveText) { err('身份 ' + i.id + ' 的 passiveText 与 theme.json 不一致'); }
    if (i.goalKind !== src2.goal.kind) { err('身份 ' + i.id + ' 的 goalKind 与 theme.json 不一致'); }
    if (i.goalCount !== (src2.goal.count ?? 1)) { err('身份 ' + i.id + ' 的 goalCount 与 theme.json 不一致'); }
    // ⚠️ B75：权限位也要「搬运不失真」——`rights` 决定否决按钮可达性，IR 与 theme 不同步时
    //   规则书会印出引擎给不了的能力。数组先 JSON 化再逐字比（直接 !== 比引用永远不等）。
    if (JSON.stringify(i.rights ?? []) !== JSON.stringify(src2.rights ?? [])) {
      err('身份 ' + i.id + ' 的 rights 与 theme.json 不一致');
    }
  }
  const themeCard = new Map((theme.cards ?? []).map((c) => [c.id, c]));
  for (const c of ir.cards) {
    const src2 = themeCard.get(c.id);
    if (src2 === undefined) { err('卡牌 id 不存在于 theme.json：' + c.id); continue; }
    if (c.text !== src2.text) { err('卡牌 ' + c.id + ' 的 text 与 theme.json 不一致'); }
    if (c.name !== src2.name) { err('卡牌 ' + c.id + ' 的 name 与 theme.json 不一致'); }
    if (c.rank !== src2.rank) { err('卡牌 ' + c.id + ' 的 rank 与 theme.json 不一致'); }
  }
  for (const h of ir.heavenCards) {
    const src2 = (theme.heavenCards ?? []).find((x) => x.id === h.id);
    if (src2 === undefined) { err('天机牌 id 不存在于 theme.json：' + h.id); continue; }
    if (h.text !== src2.text) { err('天机牌 ' + h.id + ' 的 text 与 theme.json 不一致'); }
  }
  for (const t of ir.trials) {
    const src2 = (theme.trials ?? []).find((x) => x.id === t.id);
    if (src2 === undefined) { err('试炼牌 id 不存在于 theme.json：' + t.id); continue; }
    if (t.text !== src2.text) { err('试炼牌 ' + t.id + ' 的 text 与 theme.json 不一致'); }
  }
  for (const cc of ir.certCards) {
    const src2 = (theme.certificationCards ?? []).find((x) => x.id === cc.id);
    if (src2 === undefined) { err('认证题卡 id 不存在于 theme.json：' + cc.id); continue; }
    if (cc.prompt !== src2.prompt) { err('认证题卡 ' + cc.id + ' 的 prompt 与 theme.json 不一致'); }
  }

  // ---------- 4. 引用完整性 ----------
  const trialIds = new Set(ir.trials.map((t) => t.id));
  for (const tile of ir.board.tiles) {
    for (const tid of tile.gateTrialIds ?? []) {
      if (!trialIds.has(tid)) { err('关隘格 ' + tile.index + ' 引用了不存在的试炼牌：' + tid); }
    }
  }
  for (const cc of ir.creationCards) {
    if (!themeCard.has(cc.cardId)) { err('造物牌引用了不存在的卡牌：' + cc.cardId); }
  }
  if (ir.board.tiles.length !== ir.board.length) {
    err('棋盘格数与 length 不符：' + ir.board.tiles.length + ' ≠ ' + ir.board.length);
  }
  if (ir.board.peakIndex !== ir.board.length) {
    err('board.peakIndex 必须等于 board.length');
  }
  // ⚠️ B78：过去只判「恰好 20 条」⇒ 两份指令表各自漂移而门禁看不见内容。
  //   现在连 face 顺序与**内容**一起钉：内容钉子 = tests/gates/snapshots/instruction-d20.json
  //   （四套各一份，见 B78 规格 §4 R3）。改规则必须先改快照并在批次记录写理由。
  const faceSeq = ir.instructionTable.map((x) => x.face);
  const wantFaces = Array.from({ length: 20 }, (_, i) => i + 1);
  if (ir.instructionTable.length !== 20 || faceSeq.join(',') !== wantFaces.join(',')) {
    err('指令表必须 face 1..20 各一条且严格升序，实际 ' + JSON.stringify(faceSeq));
  }
  const snapRel = 'tests/gates/snapshots/instruction-d20.json';
  if (existsSync(snapRel)) {
    const want = JSON.parse(readFileSync(snapRel, 'utf8'))[theme.meta.id] ?? [];
    const got = ir.instructionTable.map((x) => ({ face: x.face, text: x.text }));
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      err('指令表内容与快照不符（B78 §4 R3）：改规则要先改快照并在批次记录说明理由');
    }
  }
  if (ir.certCards.length < 8) {
    err('认证题卡至少 8 张，实际 ' + ir.certCards.length);
  }

  return { errors, warnings };
}

// ---------- CLI ----------
const cwd0 = process.cwd();

/** 规模表从 engine/scales.ts 解析（与 build-ir 同源）。 */
function loadScales() {
  // ⚠️ B11：改为**从源码派生**的共享解析器（见 tools/scales-parse.mjs）。
  return loadScalesFromSource(cwd0);
}

/** 列出全部主题 id（themes/<id>/theme.json 存在者）。 */
function listThemeIds() {
  const dir = resolve(cwd0, 'themes');
  if (!existsSync(dir)) { return []; }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => existsSync(resolve(dir, id, 'theme.json')))
    .sort();
}

/** 校验一套主题的 IR（主题包 + print/<id>/ir.json）。 */
function checkOne(themeId) {
  const themePath = resolve(cwd0, 'themes', themeId, 'theme.json');
  const irPath = resolve(cwd0, 'print', themeId, 'ir.json');
  let theme;
  let ir;
  try {
    theme = JSON.parse(readFileSync(themePath, 'utf8'));
    ir = JSON.parse(readFileSync(irPath, 'utf8'));
  } catch (e) {
    return { errors: ['读取失败：' + (e instanceof Error ? e.message : String(e))], warnings: [], info: '' };
  }
  const result = validateIr(ir, theme, loadScales());
  const info = '规模行 ' + ir.scales.length + ' · 指令 ' + ir.instructionTable.length + ' 条 · 卡牌 '
    + ir.cards.length + ' · 阵营 ' + ir.factions.length + ' · 身份 ' + ir.identities.length
    + ' · 认证题 ' + ir.certCards.length;
  return { errors: result.errors, warnings: result.warnings, info };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

function cli() {
  const args = process.argv.slice(2);
  const themeIds = args.length > 0 ? args : listThemeIds();
  let failed = 0;
  for (const themeId of themeIds) {
    const r = checkOne(themeId);
    for (const w of r.warnings) { console.log('WARN  [' + themeId + '] ' + w); }
    if (r.errors.length > 0) {
      for (const e of r.errors) { console.error('FAIL  [' + themeId + '] ' + e); }
      failed += r.errors.length;
      continue;
    }
    console.log('PASS  IR 校验通过：print/' + themeId + '/ir.json');
    console.log('      ' + r.info);
  }
  if (failed > 0) {
    console.error('\nIR 校验失败：' + failed + ' 项错误');
    process.exit(1);
  }
  console.log('\nPASS：' + themeIds.length + ' 套主题的 IR 契约全部通过');
  const themePath = resolve(process.cwd(), process.argv[2] ?? 'themes/xianxia2026/theme.json');
  const irPath = resolve(process.cwd(), process.argv[3] ?? 'print/ir.json');
}

if (isMain) { cli(); }
