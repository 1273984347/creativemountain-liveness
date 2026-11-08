// 规则书地形契约（机器可读）—— C10 的**唯一事实源**。
//
// 为什么单独成文件：地形规则要点同时被「规则书叙述」与「C10 校验」消费；
//   若两处各写一份 ⇒ 改规则漏改校验 = 假红（或漏检）。故单一来源。
//
// ⚠️ 术语一律用**占位符**（{{boon}} 等）：校验对象是**模板**
//   （print/规则书叙述.md，入库源），渲染时按主题 glossary 替换
//   ⇒ 契约与主题无关，四套主题共用一份叙述模板。

/**
 * 一类地形的契约项。
 *
 * ⚠️ 本文件是 `.mjs` —— **不得写 TS 语法**（`export interface` 等），类型以 JSDoc 表达。
 *
 * @typedef {Object} TerrainContract
 * @property {string} term glossary 键（占位符名），如 boon。
 * @property {string} specName 规格 §3.4 表格里的通用名（用于规格 ↔ 契约双向校验）。
 * @property {string} section 规则书里必须存在的小节标题。
 * @property {readonly string[]} required 小节内必须出现的要点（任一缺失即判红）。
 */

/**
 * 地形契约清单（规格 §3.4 / §3.5 的规则要点 → 规则书必须覆盖的内容）。
 *
 * ⚠️ `required` 里的字符串是**规则书模板里必须逐字出现**的要点，
 *   改规则书措辞时必须同步改这里（这正是 C10 存在的意义：改漏了立刻判红）。
 */
export const TERRAIN_CONTRACT = [
  {
    term: 'boon',
    specName: '福地',
    section: '### {{boon}}',
    required: ['抽 2 张', '{{resource}} +1'],
  },
  {
    term: 'hazard',
    specName: '险径',
    section: '### {{hazard}}',
    // 「翻开即取出」是规格 §3.4 的要点之一；
    // ⚠️ 原文的「黑=失去本回合剩余行动」子句已由 **B17 裁定删除**（现行节奏下无执行语义：
    //   地形在手番末结算、每回合仅一次行动）⇒ 不再是规则要点，不得回填。
    required: ['堆顶', '红', '黑', '{{hp}} -1'],
  },
  {
    term: 'rift',
    specName: '裂隙',
    section: '### {{rift}}',
    // ⚠️ 「后来者」是 B18-b 更正后的口径（**放置者当次不受影响**）—— 钉住它，防止回退成「放置者也判定」。
    required: ['封路印', '2 {{resource}}', '停 1 回合', '后来者'],
  },
  {
    term: 'gate',
    specName: '关隘',
    section: '### {{gate}}',
    // ⚠️ 「改为付费」是 B19-b 的试炼失败后果（规则书必须写明，否则玩家不知道有这条后果）。
    required: ['付费', '试炼', '试炼牌', '改为付费'],
  },
  {
    term: 'peak',
    specName: '峰顶',
    section: '### {{peak}}',
    required: ['待认证'],
  },
];

/** 无效果的地形（规格 §3.4 表里有、但无需规则小节）。 */
export const TERRAIN_NO_EFFECT = ['平原'];

/** 规则书全局必须说明的要点（规格 §3.4「结算范围」）。 */
export const RULES_BOOK_GLOBAL_REQUIRED = ['停留', '跳到位'];

/**
 * 取某小节的正文（从标题到下一个标题为止）。
 *
 * @param narration 规则书叙述模板全文
 * @param heading 小节标题（如 `### {{boon}}`）
 */
export function sectionBody(narration, heading) {
  const i = narration.indexOf(heading);
  if (i < 0) { return ''; }
  const rest = narration.slice(i + heading.length);
  const next = rest.search(/^#{2,3} /m);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * 解析规格 §3.4 地形表的第一列（地形通用名）。
 *
 * 表头行按位置丢弃（表格第一行即表头），不依赖表头文字 ⇒
 *   改表头措辞不会误伤。
 */
export function specTerrainNames(spec) {
  const i = spec.indexOf('### 3.4 地形');
  if (i < 0) { return null; }
  const j = spec.indexOf('### 3.5', i);
  const sec = spec.slice(i, j < 0 ? i + 3000 : j);
  const rows = sec
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !l.startsWith('|---'));
  const names = [];
  for (const r of rows.slice(1)) {
    const first = r.split('|')[1]?.trim() ?? '';
    if (first.length > 0) { names.push(first); }
  }
  return names;
}

/**
 * C10：规则书必须覆盖规格 §3.4 的全部地形（章节 + 要点关键词）。
 *
 * 三个方向：
 *   ① 规格 → 契约：规格地形表里的每个**有效果**地形都必须在契约清单里
 *      （规格新增地形而契约没登记 ⇒ 判红，防「规格改了规则书没跟」）；
 *   ② 契约 → 规格：契约项必须确实存在于规格地形表（防契约写飞）；
 *   ③ 契约 → 规则书：每个地形必须有对应小节，且小节内含全部要点关键词。
 */
export function checkRulesBookTerrain(spec, narration) {
  const problems = [];
  const specNames = specTerrainNames(spec);
  if (specNames === null) {
    return { id: 'C10', title: '规则书覆盖规格 §3.4 全部地形', ok: false, detail: '规格缺少 §3.4 地形' };
  }
  for (const c of TERRAIN_CONTRACT) {
    if (!specNames.includes(c.specName)) {
      problems.push(`契约项「${c.specName}」在规格 §3.4 地形表中不存在`);
    }
  }
  for (const n of specNames) {
    if (!TERRAIN_CONTRACT.some((c) => c.specName === n) && !TERRAIN_NO_EFFECT.includes(n)) {
      problems.push(`规格 §3.4 的地形「${n}」未登记进契约清单`);
    }
  }
  for (const c of TERRAIN_CONTRACT) {
    if (!narration.includes(c.section)) {
      problems.push(`规则书缺少小节「${c.section}」`);
      continue;
    }
    const body = sectionBody(narration, c.section);
    for (const kw of c.required) {
      if (!body.includes(kw)) {
        problems.push(`规则书「${c.section}」小节缺少要点「${kw}」`);
      }
    }
  }
  for (const kw of RULES_BOOK_GLOBAL_REQUIRED) {
    if (!narration.includes(kw)) {
      problems.push(`规则书缺少全局要点「${kw}」`);
    }
  }
  return {
    id: 'C10',
    title: `规则书覆盖规格 §3.4 全部地形（${TERRAIN_CONTRACT.length} 类 · 章节 + 要点关键词）`,
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}
