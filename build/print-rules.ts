
// 规则书 HTML 生成（规格 §6.7）。
//
// 结构：**表格段由 ir.json 生成**（数值带 `data-src` 溯源标记），
// **叙述段手写**（来自 `print/规则书叙述.md`，其数值不受溯源约束——见规格覆盖边界表）。
//
// **data-src 溯源标记（§6.7.2）**：每个数值单元格渲染为
// `<td data-src="scales[5].threshold">3</td>`，单元格内**只放裸数值**
// （单位写在表头），便于 B7 的「渲染文本 == 源字段值」比对。

import { esc } from './print-templates.ts';
import type { IrDocument } from '../engine/types/ir.ts';

/** 一个带溯源的数值单元格。 */
export function srcTd(cell: { readonly value: number; readonly src: string }): string {
  return `<td data-src="${esc(cell.src)}">${cell.value}</td>`;
}

/** 规模适配表（全部数值列带溯源）。 */
export function scalesTable(ir: IrDocument): string {
  const row = ir.scales[0];
  const head = [
    '人数', '山道格数', '关隘数', '初始灵枢', '起始手牌', '牌库总量',
    '试炼牌', '认证题卡', '认证签印门槛 N', '印记后门槛',
    '山议间隔（标准）', '山议间隔（新手）', '放逐下限', '全局回合上限',
  ];
  const keys = [
    'players', 'boardLength', 'gateCount', 'initialResource', 'handStart', 'deckTotal',
    'trialTotal', 'certTotal', 'threshold', 'thresholdWithMark',
    'councilIntervalStandard', 'councilIntervalNewbie', 'exileFloor', 'globalRoundLimit',
  ];
  const thead = '<tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
  const tbody = ir.scales.map((r) => {
    const cells = keys.map((k) => {
      if (k === 'players') { return `<td>${r.players}</td>`; }
      const cell = (r as unknown as Record<string, { readonly value: number; readonly src: string }>)[k];
      return cell === undefined ? '<td>—</td>' : srcTd(cell);
    });
    return '<tr>' + cells.join('') + '</tr>';
  }).join('');
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
/** 阵营表。 */
export function factionsTable(ir: IrDocument): string {
  const head = ['阵营', '基础灵力', '初始灵枢', '阵营能力', '阵营轮'];
  const thead = '<tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
  const tbody = ir.factions.map((f) =>
    '<tr>'
    + `<td>${esc(f.name)}</td>`
    + `<td>${f.hpBase}</td>`
    + `<td>${f.resourceBase}</td>`
    + `<td>${esc(f.abilityText)}</td>`
    + `<td>${esc(f.wheelText)}</td>`
    + '</tr>',
  ).join('');
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/** 身份表。 */
export function identitiesTable(ir: IrDocument): string {
  const head = ['身份', '被动特权', '终局目标'];
  const thead = '<tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
  const tbody = ir.identities.map((i) =>
    '<tr>'
    + `<td>${esc(i.name)}</td>`
    + `<td>${esc(i.passiveText)}</td>`
    + `<td>${esc(i.goalText)}</td>`
    + '</tr>',
  ).join('');
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/** 指令表（20 条）。 */
export function instructionTable(ir: IrDocument): string {
  const thead = '<tr><th>点数</th><th>指令</th></tr>';
  const tbody = ir.instructionTable.map((x) =>
    `<tr><td>${x.face}</td><td>${esc(x.text)}</td></tr>`,
  ).join('');
  return `<table class="grid compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/** 卡牌总表。 */
export function cardsTable(ir: IrDocument): string {
  const head = ['名称', '类型', '灵枢', '颜色', '点数', '效果'];
  const thead = '<tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
  const tbody = ir.cards.map((c) =>
    '<tr>'
    + `<td>${esc(c.name)}</td>`
    + `<td>${esc(c.type)}</td>`
    + `<td>${c.cost}</td>`
    + `<td>${esc(c.color)}</td>`
    + `<td>${esc(c.rankLabel ?? String(c.rank))}</td>`
    + `<td>${esc(c.text)}</td>`
    + '</tr>',
  ).join('');
  return `<table class="grid compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
