// B8 主题包生成器：从仙侠基准派生三套「最小可行」主题（规格 §10.1）。
//
// 为什么用生成器而不是手抄三份 theme.json：
//   §10.1「允许复用」的三项（通用卡牌池 / 事件池与试炼结构 / 8 身份槽位）
//   要求新主题与基准**共享效果**。手抄必然漏、必然漂（改了 op 参数忘了同步另一套）。
//   生成器把「效果」从基准**继承**，只替换「名称 / 文本 / 花色 / 点数标签」，
//   ⇒ 「换名不换效果」是机械保证的，不是靠自觉。
//
// 差异化的四项（主题标识 / glossary / 认证题 / 标志卡）由 build/theme-data/*.mjs 提供，
// 其中标志卡的 effects 是**全新效果**，由 tools/theme-diff-check.mjs（第 8 道门）机械核对。
//
// 用法：node build/build-themes.mjs
//
// ⚠️ B75.2（遗留清收）：本生成器在 B21（36 格扩盘）/ B12（改运卡改 op）/ B22（试炼文本）三波
//   手工维护中与入库 theme.json 脱节，一度跑不动。本批已追平，并由
//   `tests/build/themes-generated.test.ts` 的常驻一致性门钉住「生成器输出 == 入库文件」
//   ⇒ 今后改基准或 theme-data 而不重生成（或反之）即红。CLI 用 `isMain` 守卫
//   （对齐 tools/theme-validate.mjs 的惯例）⇒ 测试可安全 import 纯函数 `buildTheme`。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderCardText } from './theme-render.mjs';
import scifiAi from './theme-data/scifi-ai.mjs';
import hybrid from './theme-data/hybrid.mjs';
import urbanPsych from './theme-data/urban-psych.mjs';

const ROOT = process.cwd();

/** 基准主题（仙侠 2026）——效果与结构的唯一来源。 */
const BASE_PATH = resolve(ROOT, 'themes/xianxia2026/theme.json');
const BASE = JSON.parse(readFileSync(BASE_PATH, 'utf8'));

/** 卡牌类型 → id 中的类型字符。 */
const TYPE_CHAR = { motion: 'm', attack: 'a', defense: 'd', utility: 'u' };

/** 主题数据表（⚠️ B75.2 起导出：一致性门从同一处取清单，不另抄一份主题 id 列表）。 */
export const THEME_DATA = [scifiAi, hybrid, urbanPsych];

/** 由基准与主题数据装配出一套完整主题包。 */
export function buildTheme(base, data) {
  // ---- 卡池：效果沿用基准，名称/文本/花色/点数标签按主题替换 ----
  const pos = { motion: 0, attack: 0, defense: 0, utility: 0 };
  const idMap = new Map();
  const cards = base.cards.map((b) => {
    const p = (pos[b.type] += 1);
    const newId = `c_${data.abbr}_${TYPE_CHAR[b.type]}${String(p).padStart(2, '0')}`;
    idMap.set(b.id, newId);
    const flag = data.flagCards?.[b.type]?.[p];
    const effects = flag === undefined ? b.effects : flag.effects;
    const name = flag === undefined ? data.cardNames[b.type][p - 1] : flag.name;
    return {
      id: newId,
      name,
      type: b.type,
      cost: b.cost,
      color: b.color,
      suit: data.suits[p - 1],
      rank: b.rank,
      rankLabel: data.rankLabels[p - 1],
      // 卡面文案由效果派生 ⇒ 文本与效果永远一致
      text: renderCardText(effects, data.terms),
      effects,
    };
  });

  // ---- 效果里的卡牌 id 重映射 ----
  //
  // 基准的身份被动（如匠师的 equip_card { cardId: 'c_talisman' }）引用的是**基准卡牌 id**。
  // 新主题的卡牌 id 已按主题改名（c_<abbr>_<类型><序号>）⇒ 若不重映射，
  // 引用会指向不存在的牌 ⇒ **匠师的造物装备机制在新主题里整个失效**。
  // （实测：靠第 ⑤ 道门的「卡牌引用完整性」检查抓到的。）
  const remapEffect = (eff) => {
    if (eff === null || typeof eff !== 'object') {
      return eff;
    }
    if (Array.isArray(eff)) {
      return eff.map(remapEffect);
    }
    const out = {};
    for (const [k, v] of Object.entries(eff)) {
      if (k === 'cardId' && typeof v === 'string' && idMap.has(v)) {
        out[k] = idMap.get(v);
      } else if (k === 'cardIds' && Array.isArray(v)) {
        out[k] = v.map((id) => (typeof id === 'string' && idMap.has(id) ? idMap.get(id) : id));
      } else if (k === 'effects' && Array.isArray(v)) {
        out[k] = v.map(remapEffect);
      } else if (k === 'then' || k === 'else' || k === 'effect') {
        out[k] = remapEffect(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  // ---- 阵营：id / 名称 / 文本差异化；效果与数值沿用基准 ----
  const factions = base.factions.map((b, i) => {
    const d = data.factions[i];
    if (d === undefined) {
      throw new Error(`主题 ${data.id} 的阵营数少于基准（${base.factions.length}）`);
    }
    return {
      id: d.id,
      name: d.name,
      hpBase: b.hpBase,
      resourceBase: b.resourceBase,
      ability: remapEffect(b.ability),
      wheel: remapEffect(b.wheel),
      deckTags: [...b.deckTags],
      abilityText: d.abilityText,
      wheelText: d.wheelText,
    };
  });

  // ---- 身份：id 必须沿用（engine/core/council.ts 硬编码 'arbiter'）；
  //      特权与终局目标沿用基准（§10.1「允许复用 8 身份槽位」），只换名称与文本 ----
  const identities = base.identities.map((b, i) => {
    const d = data.identities[i];
    if (d === undefined) {
      throw new Error(`主题 ${data.id} 的身份数少于基准（${base.identities.length}）`);
    }
    return {
      id: b.id,
      name: d.name,
      passive: remapEffect(b.passive),
      goal: { ...b.goal },
      passiveText: d.passiveText,
      // ⚠️ B75：`rights` 与 id/goal 同族 —— 是**结构**，从基准**继承**（不靠各主题手抄）；
      //   只有 `passiveText` 是风味文本，由 theme-data 提供。漏掉这一行 ⇒ 重新生成会把
      //   三套主题的否决权**静默清零**（与「换名不换效果是机械保证的」同一纪律）。
      ...(b.rights === undefined ? {} : { rights: [...b.rights] }),
      ...(d.flavor === undefined ? {} : { flavor: d.flavor }),
    };
  });

  // ---- 棋盘：地形与关隘结构沿用基准，地名主题化 ----
  const board = {
    length: base.board.length,
    peakIndex: base.board.peakIndex,
    tiles: base.board.tiles.map((t, i) => {
      const name = data.tiles[i];
      if (name === undefined) {
        throw new Error(`主题 ${data.id} 的棋盘地名数少于基准（${base.board.tiles.length}）`);
      }
      return {
        index: t.index,
        kind: t.kind,
        name,
        ...(t.gate === undefined ? {} : { gate: { fee: t.gate.fee, trialIds: [...t.gate.trialIds] } }),
        ...(t.branches === undefined ? {} : { branches: t.branches.map((b) => ({ ...b })) }),
        ...(t.barrier === undefined ? {} : { barrier: t.barrier }),
      };
    }),
  };

  // ---- 天机牌：事件池结构沿用基准，名称与文本主题化 ----
  const heavenCards = base.heavenCards.map((b, i) => {
    const d = data.heavenCards[i];
    if (d === undefined) {
      throw new Error(`主题 ${data.id} 的天机牌数少于基准（${base.heavenCards.length}）`);
    }
    return { id: b.id, name: d.name, text: d.text, effects: b.effects };
  });

  // ---- 试炼牌：结构沿用基准，文本主题化 ----
  const trials = base.trials.map((b, i) => {
    const text = data.trials[i];
    if (text === undefined) {
      throw new Error(`主题 ${data.id} 的试炼牌数少于基准（${base.trials.length}）`);
    }
    return { id: b.id, text, ...(b.effects === undefined ? {} : { effects: b.effects }) };
  });

  // ---- 造物牌：cardId 需映射到新卡池的 defense 卡 ----
  const creationDeck = (base.creationDeck ?? []).map((b, i) => {
    const d = data.creationCards[i];
    if (d === undefined) {
      throw new Error(`主题 ${data.id} 的造物牌数少于基准（${base.creationDeck.length}）`);
    }
    const cardId = idMap.get(b.cardId);
    if (cardId === undefined) {
      throw new Error(`造物牌引用的卡牌 ${b.cardId} 不在基准卡池内`);
    }
    return { cardId, name: d.name, text: d.text };
  });

  // ---- 认证题卡：全部主题化（§10.1 必须差异化第 ③ 项） ----
  const certificationCards = base.certificationCards.map((b, i) => {
    const prompt = data.certCards[i];
    if (prompt === undefined) {
      throw new Error(`主题 ${data.id} 的认证题数少于基准（${base.certificationCards.length}）`);
    }
    return { id: `cc_${data.abbr}_${String(i + 1).padStart(2, '0')}`, prompt };
  });

  return {
    meta: {
      id: data.id,
      name: data.name,
      tagline: data.tagline,
      resourceName: data.resourceName,
      deckName: data.deckName,
    },
    glossary: { ...data.glossary },
    counts: { ...base.counts },
    factions,
    identities,
    cards,
    board,
    heavenCards,
    certificationCards,
    trials,
    creationDeck,
    // 主题专属名词表：认证题「换场景不是换措辞」的机械判据（见 §10.1 与第 8 道门）
    domainWords: [...data.domainWords],
  };
}

// ---------- CLI ----------
// ⚠️ B75.2：`isMain` 守卫（对齐 tools/theme-validate.mjs:543 的仓库惯例）——
//   仅直接运行本文件时才执行写盘；被测试 import 时只暴露纯函数 `buildTheme`。
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const written = [];
  for (const data of THEME_DATA) {
    const theme = buildTheme(BASE, data);
    const dir = resolve(ROOT, 'themes', data.id);
    mkdirSync(dir, { recursive: true });
    const outPath = resolve(dir, 'theme.json');
    writeFileSync(outPath, JSON.stringify(theme, null, 2) + '\n', 'utf8');
    written.push({
      id: theme.meta.id,
      name: theme.meta.name,
      cards: theme.cards.length,
      flags: Object.values(data.flagCards ?? {}).flatMap((m) => Object.values(m)).length,
      path: `themes/${data.id}/theme.json`,
    });
  }
  for (const w of written) {
    console.log(
      `OK  ${w.path}  ${w.name}  卡牌 ${w.cards} 张（其中标志卡 ${w.flags} 张）`,
    );
  }
  console.log(`\n共生成 ${written.length} 套主题包。`);
}
