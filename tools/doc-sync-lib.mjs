// doc-sync 口径体检：代码是源，文档是派生物。
//
// 来源：GateKeeper《doc-sync口径体检设计》——
//   「方向：代码是源、文档是派生物——真值全部机器读取、fail-closed」
//   「只扫『当前态句式白名单』（宁窄勿误）：只扫当前态句，历史段整体豁免」
//   「历史叙述不改写：确需保留的过期表述用行级豁免标记（机器可读、人工可审计）」
//
// 为什么需要它：规格文档里散落着大量硬数字（算子名、谓词名、goal kind、
// 规模表 15 列 × 6 行）。这些靠人肉维护必然漂移——本仓已漂了一处：
// 规格 §6.4 的 ops 表仍列着 `revive`，而代码真相源 `OpName` 早已把它移除（V1 删除复活）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SCALES, SCALE_FIELD_NAMES } from '../engine/scales.ts';

export const SPEC_PATH = resolve('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md');

/** 行级豁免标记：机器可读、人工可审计。 */
export const EXEMPT_MARK = '<!--doc-sync:exempt';

/** 读取规格全文。 */
export function readSpec() {
  return readFileSync(SPEC_PATH, 'utf8');
}

/** 从 theme.ts 源码解析联合类型的成员名（真值取自源码文本，非手抄清单）。 */
export function unionMembers(source, typeName) {
  const i = source.indexOf(`export type ${typeName}`);
  if (i < 0) {
    return [];
  }
  const seg = source.slice(i, source.indexOf(';', i));
  return [...seg.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
}

/**
 * 抽出 §6.4「效果算子（ops）」表格里的算子名。
 *
 * ⚠️ **只取那张表，不取整个 §6.4 章节** —— 章节里还有缺口对照表，
 * 里面有 `{ amount }` / `{ tileIndex }` 等**参数名**，会被误当成算子（实测误报）。
 */
export function specOpNames(spec) {
  return specOpEntries(spec).map((e) => e.name);
}

/**
 * 同上，但**同时记录每个算子所在的行及其豁免状态**。
 *
 * 豁免 = 该行含 `<!--doc-sync:exempt ... -->`。GateKeeper《doc-sync口径体检设计》规则 3：
 * 「历史叙述不改写：确需保留的过期表述用行级豁免标记（机器可读、人工可审计）」。
 */
export function specOpEntries(spec) {
  const marker = spec.indexOf('**效果算子（ops）**');
  if (marker < 0) {
    return [];
  }
  const entries = [];
  const seen = new Set();
  for (const line of spec.slice(marker).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      if (seen.size > 0) {
        break; // 表格结束
      }
      continue;
    }
    const exempt = line.includes(EXEMPT_MARK);
    for (const m of line.matchAll(/`([a-z_0-9]+)`/g)) {
      const name = m[1];
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      entries.push({ name, exempt });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** 抽出含指定中文表头的表格行。 */
export function tableHeaderRow(spec, mustContain) {
  return spec
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('|') && mustContain.every((m) => l.includes(m)));
}

/** 从人读单元格抽取数字（「每 6 回合」→ 6；「3」→ 3）。 */
export function cellNumber(cell) {
  const m = cell.match(/-?\d+/);
  return m === null ? undefined : Number(m[0]);
}

/** 已裁定、待 B2 实现的算子——允许规格领先于代码，但必须在册。 */
export const PENDING_OPS = new Set([
  'move_by_dice',        // G1：指令骰第 5 条按骰子点数移动
  'place_barrier',      // G4：放置封路印
  'modify_judgement',   // G5：改判
  'create_card',        // G5：造物（走独立造物牌堆）
  'equip_card',         // G5：装备（V1 仅计数，无被动效果）
]);

/** 已裁定 V1 删除、仅在 §13.3 延后项保留的算子——不得出现在 §6.4 ops 表。 */
export const DEFERRED_OPS = new Set([
  'revive',             // V1 删除：本作无死亡机制，延后至 V1.1
]);

// ---------- C1 字段名契约 ----------

export function checkFieldNames(spec) {
  const contractLine = spec
    .split(/\r?\n/)
    .find((l) => l.includes('`players`') && l.includes('`boardLength`'));
  if (contractLine === undefined) {
    return {
      id: 'C1',
      title: '规模表字段名契约行存在',
      ok: false,
      detail: '规格 §8 缺少字段名契约行（应含 `players` | `boardLength` | ...）',
    };
  }
  const specFields = contractLine
    .split('|')
    .slice(1, -1)
    .map((s) => s.trim().replace(/`/g, ''))
    .filter((s) => s.length > 0);
  const codeFields = [...SCALE_FIELD_NAMES];
  const same = specFields.length === codeFields.length && specFields.every((f, i) => f === codeFields[i]);
  return {
    id: 'C1',
    title: `规模表字段名契约与代码一致（${codeFields.length} 列）`,
    ok: same,
    detail: same ? '' : `spec=[${specFields.join(',')}] code=[${codeFields.join(',')}]`,
  };
}

// ---------- C2 规模表数值 ----------

const SCALE_NUMERIC_FIELDS = [
  'boardLength', 'gateCount', 'initialResource', 'handStart', 'deckTotal',
  'trialTotal', 'certTotal', 'threshold', 'thresholdWithMark',
  'councilIntervalStandard', 'councilIntervalNewbie', 'exileFloor', 'globalRoundLimit',
];

export function checkScaleValues(spec) {
  const start = spec.indexOf('## 8. 规模自适应');
  const end = spec.indexOf('## 9. 测试与验收', start);
  const sec = spec.slice(start, end);
  const rows = sec.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l));
  const problems = [];
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((s) => s.trim());
    const players = Number(cells[0]);
    const code = SCALES.find((s) => s.players === players);
    if (code === undefined) {
      problems.push(`players=${players} 无对应代码行`);
      continue;
    }
    SCALE_NUMERIC_FIELDS.forEach((f, i) => {
      const specVal = cellNumber(cells[i + 1] ?? '');
      const codeVal = code[f];
      if (specVal !== codeVal) {
        problems.push(`players=${players} ${f}: spec=${specVal} code=${codeVal}`);
      }
    });
  }
  return {
    id: 'C2',
    title: `规模表数值与 engine/scales.ts 一致（${rows.length} 行 × ${SCALE_NUMERIC_FIELDS.length} 数值列）`,
    ok: problems.length === 0 && rows.length > 0,
    detail: problems.length === 0 ? (rows.length === 0 ? '未找到规模表数据行' : '') : problems.join('; '),
  };
}

// ---------- C3 算子双向完整性 ----------

export function checkOps(spec, codeOps, nonOps) {
  const entries = specOpEntries(spec).filter((e) => !nonOps.has(e.name));
  const specSet = new Set(entries.map((e) => e.name));
  const codeSet = new Set(codeOps);
  const problems = [];
  for (const n of codeSet) {
    if (!specSet.has(n)) {
      problems.push(`代码已注册但规格 §6.4 未列：${n}`);
    }
  }
  for (const e of entries) {
    if (codeSet.has(e.name)) {
      continue;
    }
    if (e.exempt) {
      continue; // 已登记豁免的历史表述
    }
    if (DEFERRED_OPS.has(e.name)) {
      problems.push(`规格 §6.4 仍列为现役算子，但已裁定 V1 删除：${e.name}（应从 ops 表移除，仅在 §13.3 延后项保留）`);
    } else if (!PENDING_OPS.has(e.name)) {
      problems.push(`规格列出但代码未注册：${e.name}（若为已裁定待实现，须登记进 PENDING_OPS）`);
    }
  }
  return {
    id: 'C3',
    title: `§6.4 算子清单与代码 OpName 双向一致（代码 ${codeSet.size} 个）`,
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}

// ---------- C4 谓词双向完整性 ----------

export function checkPredicates(spec, codePreds) {
  const start = spec.indexOf('### 6.4');
  const end = spec.indexOf('### 6.5', start);
  const sec = spec.slice(start, end);
  const line = sec.split(/\r?\n/).find((l) => l.includes('条件谓词（predicates）'));
  const specSet = new Set(
    line === undefined ? [] : [...line.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]),
  );
  const codeSet = new Set(codePreds);
  const PENDING_PREDS = new Set(['dice_is_at_least', 'card_color_is']);
  const problems = [];
  for (const n of codeSet) {
    if (!specSet.has(n)) {
      problems.push(`代码已注册但规格未列：${n}`);
    }
  }
  for (const n of specSet) {
    if (!codeSet.has(n) && !PENDING_PREDS.has(n)) {
      problems.push(`规格列出但代码未注册：${n}`);
    }
  }
  return {
    id: 'C4',
    title: `§6.4 谓词清单与代码 PredicateName 双向一致（代码 ${codeSet.size} 个）`,
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}

// ---------- C5 GoalKind 双向完整性 ----------

export function checkGoals(spec, codeGoals) {
  const start = spec.indexOf('### 6.4');
  const end = spec.indexOf('### 6.5', start);
  const sec = spec.slice(start, end);
  const specGoals = new Set();
  for (const line of sec.split(/\r?\n/)) {
    if (!line.trim().startsWith('| `')) {
      continue;
    }
    for (const m of line.matchAll(/`([a-z_0-9]+)`/g)) {
      specGoals.add(m[1]);
    }
  }
  const codeSet = new Set(codeGoals);
  const problems = [];
  for (const n of codeSet) {
    if (!specGoals.has(n)) {
      problems.push(`代码已注册但规格 goal 表未列：${n}`);
    }
  }
  for (const n of specGoals) {
    if (!codeSet.has(n)) {
      problems.push(`规格 goal 表列出但代码未注册：${n}`);
    }
  }
  return {
    id: 'C5',
    title: `§6.4 终局目标表与代码 GoalKind 双向一致（代码 ${codeSet.size} 个）`,
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}

// ---------- C7 ops 表重复行检测 ----------
//
// 起因：C3 用 **Set** 比较，**检测不到重复行**——同一行写两遍，
// 算子名集合不变，C3 照样绿。（实证：v1.4 回改时 `| 判定与装备 |` 行被写了两次。）
// ⇒ 必须按**行**（而非按算子名）统计重复。
export function checkDuplicateRows(spec) {
  const marker = spec.indexOf('**效果算子（ops）**');
  if (marker < 0) {
    return { id: 'C7', title: 'ops 表无重复行', ok: false, detail: '未找到「效果算子（ops）」表格' };
  }
  const seen = new Map();
  const problems = [];
  let inTable = false;
  for (const line of spec.slice(marker).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      if (inTable) {
        break; // 表格结束
      }
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((s) => s.trim());
    const key = cells.join('|');
    // 跳过表头与分隔行
    if (key.startsWith('---') || cells.includes('类别')) {
      inTable = true;
      continue;
    }
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) {
      problems.push(`重复行：| ${key} |`);
    }
  }
  return {
    id: 'C7',
    title: 'ops 表无重复行（按行统计，不用 Set）',
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}

// ---------- C8 覆盖边界登记（机器可读 ↔ 规格表逐条对应）----------
//
// A5 的落点：绿洲《发布检查表》的「门禁覆盖边界（如实登记）」。
// 边界若只写在文档里 ⇒ 门禁不知道自己看不见什么 ⇒ 「绿灯掩盖盲区」。
// 本检查强制：**规格 §9.3 覆盖边界表的条数 == 机器清单条数**。
export function checkCoverageBoundaries(spec, boundaryIds) {
  const idx = spec.indexOf('门禁覆盖边界');
  if (idx < 0) {
    return {
      id: 'C8',
      title: '规格含覆盖边界登记',
      ok: false,
      detail: '规格 §9.3 缺少「门禁覆盖边界」小节',
    };
  }
  // 取该表的数据行（以 | 开头、且不是表头/分隔行）
  const sec = spec.slice(idx, spec.indexOf('\n\n**', idx) === -1 ? idx + 2000 : spec.indexOf('\n\n**', idx));
  const rows = sec
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|'))
    .filter((l) => !l.trim().startsWith('|---') && !l.includes('| 覆盖 | 不覆盖 |'));
  // 表中「不覆盖」列以 `—` 结尾表示无兜底；条数即数据行数
  const specCount = rows.length;
  const codeCount = boundaryIds.length;
  const problems = [];
  if (specCount !== codeCount) {
    problems.push(`规格表 ${specCount} 条 vs 机器清单 ${codeCount} 条`);
  }
  return {
    id: 'C8',
    title: `覆盖边界登记：规格表与机器清单一致（${codeCount} 条）`,
    ok: problems.length === 0,
    detail: problems.join('; '),
  };
}

// ---------- C9 State 契约 ↔ 规格 §6.2 双向一致 ----------
//
// 起因（实证）：并行会话做 B3 时给 `State` 加了 `certification` / `council` / `outcome`
// 三个字段，而规格 §6.2 未同步 ⇒ 契约冻结形同虚设。
// C1–C8 全都不检查 State 字段，属于覆盖盲区。
export function checkStateContract(spec, stateFields) {
  const idx = spec.indexOf('### 6.2 引擎状态');
  if (idx < 0) {
    return { id: 'C9', title: '规格含 §6.2 引擎状态定义', ok: false, detail: '规格缺少 §6.2' };
  }
  // 取 §6.2 到下一个 ### 之间的原文
  const end = spec.indexOf('\n### ', idx + 10);
  const sec = spec.slice(idx, end === -1 ? idx + 4000 : end);
  const missing = stateFields.filter((f) => !sec.includes(f));
  return {
    id: 'C9',
    title: `State 字段与规格 §6.2 一致（${stateFields.length} 个字段）`,
    ok: missing.length === 0,
    detail: missing.length === 0 ? '' : `规格 §6.2 未登记：${missing.join('、')}`,
  };
}

// ---------- C6 豁免标记自检 ----------

export function checkExemptSyntax(spec) {
  const bad = [];
  for (const line of spec.split(/\r?\n/)) {
    const idx = line.indexOf(EXEMPT_MARK);
    if (idx < 0) {
      continue;
    }
    const reason = line.slice(idx + EXEMPT_MARK.length).replace(/\*\/?>\s*$/, '').trim();
    if (reason.length === 0) {
      bad.push(`豁免标记缺少原因：${line.trim().slice(0, 60)}`);
    }
  }
  return {
    id: 'C6',
    title: '行级豁免标记均带原因（机器可读、人工可审计）',
    ok: bad.length === 0,
    detail: bad.join('; '),
  };
}
