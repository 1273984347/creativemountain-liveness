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
/** 指令表（结构主题无关，规格 §3.2；其中的资源名随主题）。 */
function instructionTable(terms) {
  const r = terms.resource;
  return [
  [1, '抽 1 张牌'], [2, r + ' +1'], [3, '抽 2 张牌'], [4, r + ' -1（给自己）'],
  [5, '掷 6 面移动骰并按点数前进'], [6, '前进 2 格'], [7, '抽 1 张牌 + ' + r + ' +1'],
  [8, '弃 1 张牌抽 2 张'], [9, '前进 1 格并抽 1 张牌'], [10, '全员弃 1 张牌'],
  [11, '指定一名玩家弃 1 张牌'], [12, '指定一名玩家后退 1 格'], [13, '获得 1 张指定类型手牌'],
  [14, '立即再掷一次 20 面指令骰并执行（不可再连锁）'], [15, '免疫本回合的「封口」'],
  [16, '与一名玩家交换手牌各 1 张'], [17, '本回合移动 +2 格'], [18, '获得 1 枚' + r + '（不超上限）'],
  [19, '指定一名玩家抽 1 张牌'], [20, '自由执行一次「阵营轮」效果'],
  ].map(([face, t]) => ({ face, text: t }));
}

/** 从 theme.json 生成 IR 文档。 */
export function buildIr(theme, scales) {
  const terms = termsOf(theme);
  const ir = {
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
    instructionTable: instructionTable(terms),
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
    trials: (theme.trials ?? []).map((t) => ({ id: t.id, text: t.text })),
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
