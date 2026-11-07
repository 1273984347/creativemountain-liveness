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

const ROOT = process.cwd();

/** 从 engine/scales.ts 读取规模表（运行时真相源）。 */
function loadScales() {
  // scales.ts 是 TS，无法直接 import —— 这里从源码文本解析（与 doc-sync 同思路）。
  // 规模表的**数值**由 doc-sync 的 C2 检查保证与 engine/scales.ts 一致，
  // 因此这里解析出的值不会漂移；B7 的溯源比对会再次校验。
  const src = readFileSync(resolve(ROOT, 'engine/scales.ts'), 'utf8');
  const rows = [];
  const re = /\{\s*players:\s*(\d+),\s*boardLength:\s*(\d+),\s*gateCount:\s*(\d+),\s*initialResource:\s*(\d+),\s*handStart:\s*(\d+),\s*deckTotal:\s*(\d+),\s*trialTotal:\s*(\d+),\s*certTotal:\s*(\d+),\s*threshold:\s*(\d+),\s*thresholdWithMark:\s*(\d+),\s*councilIntervalStandard:\s*(\d+),\s*councilIntervalNewbie:\s*(\d+),\s*exileFloor:\s*(\d+),\s*globalRoundLimit:\s*(\d+)/g;
  for (const m of src.matchAll(re)) {
    rows.push({
      players: Number(m[1]),
      boardLength: Number(m[2]),
      gateCount: Number(m[3]),
      initialResource: Number(m[4]),
      handStart: Number(m[5]),
      deckTotal: Number(m[6]),
      trialTotal: Number(m[7]),
      certTotal: Number(m[8]),
      threshold: Number(m[9]),
      thresholdWithMark: Number(m[10]),
      councilIntervalStandard: Number(m[11]),
      councilIntervalNewbie: Number(m[12]),
      exileFloor: Number(m[13]),
      globalRoundLimit: Number(m[14]),
    });
  }
  if (rows.length === 0) {
    throw new Error('无法从 engine/scales.ts 解析规模表');
  }
  return rows;
}

/** 溯源包装。 */
function src(players, field, value) {
  return { value, src: 'scales[' + players + '].' + field };
}

/** 目标文本（由 goal kind + count 生成——**唯一的现编文本**，且可由 kind/count 追溯）。 */
const GOAL_TEXT = {
  pass_gates: (c) => '最先通过 ' + c + ' 座关隘',
  equip_count: (c) => '累计装备 ' + c + ' 件法宝',
  draw_count: (c) => '累计抽牌 ' + c + ' 张',
  veto_success: (c) => '成功否决 ' + c + ' 次放逐',
  survive_with_hp: () => '存活至终局且体力不低于初始值',
  steal_count: (c) => '累计偷取 ' + c + ' 枚灵枢',
  reroll_count: (c) => '累计改判 ' + c + ' 次',
  successful_challenge: (c) => '成功质疑 ' + c + ' 次且未被复议推翻',
};
/** 指令表（主题无关的通用表，规格 §3.2）。 */
const INSTRUCTION_TABLE = [
  [1, '抽 1 张牌'], [2, '灵枢 +1'], [3, '抽 2 张牌'], [4, '灵枢 -1（给自己）'],
  [5, '掷 6 面移动骰并按点数前进'], [6, '前进 2 格'], [7, '抽 1 张牌 + 灵枢 +1'],
  [8, '弃 1 张牌抽 2 张'], [9, '前进 1 格并抽 1 张牌'], [10, '全员弃 1 张牌'],
  [11, '指定一名玩家弃 1 张牌'], [12, '指定一名玩家后退 1 格'], [13, '获得 1 张指定类型手牌'],
  [14, '立即再掷一次 20 面指令骰并执行（不可再连锁）'], [15, '免疫本回合的「封口」'],
  [16, '与一名玩家交换手牌各 1 张'], [17, '本回合移动 +2 格'], [18, '获得 1 枚灵枢（不超上限）'],
  [19, '指定一名玩家抽 1 张牌'], [20, '自由执行一次「阵营轮」效果'],
].map(([face, t]) => ({ face, text: t }));

/** 从 theme.json 生成 IR 文档。 */
export function buildIr(theme, scales) {
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
    })),
    instructionTable: INSTRUCTION_TABLE,
    factions: theme.factions.map((f) => ({
      id: f.id, name: f.name, hpBase: f.hpBase, resourceBase: f.resourceBase,
      abilityText: f.abilityText, wheelText: f.wheelText, deckTags: [...f.deckTags],
    })),
    identities: theme.identities.map((i) => ({
      id: i.id, name: i.name, passiveText: i.passiveText,
      goalKind: i.goal.kind,
      goalCount: i.goal.count ?? 1,
      goalText: GOAL_TEXT[i.goal.kind](i.goal.count ?? 1),
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
