// IR 生成器（B6 第一步）：theme.json → print/ir.json。
//
// **只搬运，不现编**：
//   · 文本从 theme.json 的 text 字段原样搬运（规则书印的就是它）；
//   · 数值原样搬运，并附 `src` 溯源路径（`scales[<players>].<field>`）。
//
// **确定性输出**：同样的输入必须产出逐字节相同的 ir.json。
// 因此：不做任何时间戳 / 随机 id / 绝对路径写入；键顺序固定。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadScalesFromSource } from '../tools/scales-parse.mjs';
// 指令表的唯一事实源（B78 §4 R3）：本文件**不再自己抄 20 条**——B78 前引擎与这里各一份，
// 引擎那份写死「灵枢」、这里按 terms 替换 ⇒ 三套主题的对局日志与规则书各说各话。
import { INSTRUCTION_TABLE } from '../engine/core/instruction-table.ts';

const ROOT = process.cwd();

/**
 * 从 engine/scales.ts 读取规模表（运行时真相源）。
 *
 * ⚠️ B11：改为**从源码派生**的共享解析器（`tools/scales-parse.mjs`）——
 *   此前 build-ir / ir-validate / parity-check **各手抄一份**字段正则，
 *   加字段要改三处、漏一处就门禁误报。
 *   数值正确性由 doc-sync C2 保证，溯源一致性由 parity-check 第 ③ 级保证。
 */
function loadScales() {
  return loadScalesFromSource(ROOT);
}

/** 溯源包装。 */
function src(players, field, value) {
  return { value, src: 'scales[' + players + '].' + field };
}

/**
 * 主题术语（从主题 glossary 取，缺键回退通用词）。
 *
 * ⚠️ 实体件的文本必须随主题走 —— 否则四套主题的规则书里会出现别的主题的词
 *   （本轮实测：基准仙侠的「灵枢」「符箓」被硬编码进了所有实体件模板）。
 */
export function termsOf(theme) {
  const g = theme.glossary ?? {};
  return {
    hp: g.HP ?? '体力',
    deck: theme.meta.deckName ?? '牌',
    resource: g.resource ?? '资源',
    gate: g.gate ?? '关隘',
    peak: g.peak ?? '峰顶',
    path: g.path ?? '山道',
  };
}

/** 目标文本（由 goal kind + count 生成——**唯一的现编文本**，且可由 kind/count 追溯）。 */
function goalText(kind, count, terms) {
  switch (kind) {
    case 'pass_gates': return '最先通过 ' + count + ' 座' + terms.gate;
    case 'equip_count': return '累计装备 ' + count + ' 件造物';
    case 'draw_count': return '累计抽牌 ' + count + ' 张';
    case 'veto_success': return '成功否决 ' + count + ' 次放逐';
    case 'survive_with_hp': return '存活至终局且' + terms.hp + '不低于初始值';
    case 'steal_count': return '累计偷取 ' + count + ' 枚' + terms.resource;
    case 'reroll_count': return '累计改判 ' + count + ' 次';
    case 'successful_challenge': return '成功质疑 ' + count + ' 次且未被复议推翻';
    default: return '未知目标';
  }
}
/** 从 theme.json 生成 IR 文档。 */
export function buildIr(theme, scales) {
  const terms = termsOf(theme);
  const ir = {
    // ⚠️ B78：trials[].name 是 IR 版本 1 的**字段扩展**，不升版本号。IR 无跨版本读取方
    //   （存档用 v:2 信封装 State，不是 IR），升版本只会逼 ir-validate 与所有 print/*/ir.json
    //   一起改，换不到任何保障；字段形状变更由 engine/types/ir.ts 的 TypeScript 类型约束。
    version: 1,
    meta: {
      id: theme.meta.id,
      name: theme.meta.name,
      tagline: theme.meta.tagline,
      resourceName: theme.meta.resourceName,
      deckName: theme.meta.deckName,
    },
    glossary: { ...theme.glossary },
    counts: { ...theme.counts },
    scales: scales.map((r) => ({
      players: r.players,
      boardLength: src(r.players, 'boardLength', r.boardLength),
      gateCount: src(r.players, 'gateCount', r.gateCount),
      initialResource: src(r.players, 'initialResource', r.initialResource),
      handStart: src(r.players, 'handStart', r.handStart),
      deckTotal: src(r.players, 'deckTotal', r.deckTotal),
      trialTotal: src(r.players, 'trialTotal', r.trialTotal),
      certTotal: src(r.players, 'certTotal', r.certTotal),
      threshold: src(r.players, 'threshold', r.threshold),
      thresholdWithMark: src(r.players, 'thresholdWithMark', r.thresholdWithMark),
      councilIntervalStandard: src(r.players, 'councilIntervalStandard', r.councilIntervalStandard),
      councilIntervalNewbie: src(r.players, 'councilIntervalNewbie', r.councilIntervalNewbie),
      exileFloor: src(r.players, 'exileFloor', r.exileFloor),
      globalRoundLimit: src(r.players, 'globalRoundLimit', r.globalRoundLimit),
      seatWeight: src(r.players, 'seatWeight', r.seatWeight),
    })),
    // 表体来自唯一事实源，{resource} 按本主题词表替换。⚠️ 不在这里重抄文案。
    instructionTable: INSTRUCTION_TABLE.map((r) => ({ face: r.face, text: r.text.split('{resource}').join(terms.resource) })),
    factions: theme.factions.map((f) => ({
      id: f.id, name: f.name, hpBase: f.hpBase, resourceBase: f.resourceBase,
      abilityText: f.abilityText, wheelText: f.wheelText, deckTags: [...f.deckTags],
    })),
    identities: theme.identities.map((i) => ({
      id: i.id, name: i.name, passiveText: i.passiveText,
      goalKind: i.goal.kind,
      goalCount: i.goal.count ?? 1,
      goalText: goalText(i.goal.kind, i.goal.count ?? 1, terms),
      // ⚠️ B75：权限位**原样搬运**（缺省空数组 ⇒ 老主题不必声明）；确定性输出要求形状稳定，
      //   所以不能写成 `...(i.rights === undefined ? {} : { rights: i.rights })`：
      //   parity-check 会拿「键不存在」与「空数组」当两种一致状态，比较判据就得跟着分叉。
      rights: [...(i.rights ?? [])],
      ...(i.flavor === undefined ? {} : { flavor: i.flavor }),
    })),
    cards: theme.cards.map((c) => ({
      id: c.id, name: c.name, type: c.type, cost: c.cost, color: c.color,
      ...(c.suit === undefined ? {} : { suit: c.suit }),
      rank: c.rank,
      ...(c.rankLabel === undefined ? {} : { rankLabel: c.rankLabel }),
      text: c.text,
    })),
    creationCards: (theme.creationDeck ?? []).map((c) => ({
      cardId: c.cardId, name: c.name, text: c.text,
    })),
    certCards: theme.certificationCards.map((c) => ({ id: c.id, prompt: c.prompt })),
    trials: (theme.trials ?? []).map((t) => ({ id: t.id, name: t.name, text: t.text })),
    heavenCards: theme.heavenCards.map((h) => ({ id: h.id, name: h.name, text: h.text })),
    board: {
      length: theme.board.length,
      peakIndex: theme.board.peakIndex,
      tiles: theme.board.tiles.map((t) => ({
        index: t.index, kind: t.kind, name: t.name,
        ...(t.gate === undefined ? {} : { gateFee: t.gate.fee, gateTrialIds: [...t.gate.trialIds] }),
        ...(t.branches === undefined ? {} : { branchTo: t.branches.map((b) => b.to) }),
      })),
    },
  };
  return ir;
}

// ---------- CLI ----------
const themePath = resolve(ROOT, process.argv[2] ?? 'themes/xianxia2026/theme.json');
const outPath = resolve(ROOT, process.argv[3] ?? 'print/ir.json');

const theme = JSON.parse(readFileSync(themePath, 'utf8'));
const ir = buildIr(theme, loadScales());

mkdirSync(resolve(ROOT, 'print'), { recursive: true });
writeFileSync(outPath, JSON.stringify(ir, null, 2) + '\n', 'utf8');
console.log('ir → ' + outPath + ' (' + ir.cards.length + ' cards, ' + ir.scales.length + ' scales)');
