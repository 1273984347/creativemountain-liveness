// 实体件 SVG 生成：卡牌 / 棋盘 / 筹码 / 身份牌 / 阵营牌 / 认证题卡。
//
// 所有 SVG 以 `width="..mm" height="..mm" viewBox="0 0 .. .."` 输出，
// 保证打印尺寸与画布坐标 1:1 对应。

import { CARD_H, CARD_PAD, CARD_RADIUS, CARD_W, CHIP_D, A2_H, A2_W, esc, wrap } from './print-templates.ts';
// 页脚句的唯一口径在 build/trial-text.mjs（B78 §4 R2：题面括注 / 页脚 / 规则书三处同源）。
import { renderTrialFooter } from './trial-text.mjs';

import type { IrBoard, IrCard, IrDocument, IrFaction, IrIdentity } from '../engine/types/ir.ts';

/** 卡牌颜色（红/黑）。 */
const COLOR_BG: Record<string, string> = { red: '#f6efe6', black: '#e8ecf0' };
const COLOR_EDGE: Record<string, string> = { red: '#c05a4a', black: '#4a5a6a' };

/** 一张卡牌的 SVG。 */
// ⚠️ B78：原来的第二参 `opts?: {index,total}` 从未被任何调用点使用（build-print /
//   cardRowSvg 全部只传 card）⇒ 删掉。它是本文件第一次被 .ts 测试引用时（T8）
//   由门 ① 的 noUnusedParameters 暴露出来的既有死参数，不是本批引入。
export function cardSvg(card: IrCard): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const bg = COLOR_BG[card.color] ?? '#f2ece2';
  const edge = COLOR_EDGE[card.color] ?? '#8a7c6a';
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="${bg}" stroke="${edge}" stroke-width="0.4"/>`);
  // 顶部条：费用 + 类型
  parts.push(`<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="7" fill="${edge}" opacity="0.14"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 5.2}" font-size="3.4" fill="${edge}" font-weight="700">${esc(String(card.cost))}</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 5.2}" font-size="2.6" fill="${edge}" text-anchor="end">${esc(card.type)}</text>`);
  // 名称
  parts.push(`<text x="${pad + 2}" y="${pad + 13}" font-size="4.4" fill="#1a1613" font-weight="700">${esc(card.name)}</text>`);
  // 效果文本
  const lines = wrap(card.text, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 20 + i * 4.4}" font-size="3.2" fill="#3a322a">${esc(l)}</text>`);
  });
  // 点数角标
  parts.push(`<circle cx="${w - pad - 6}" cy="${h - pad - 6}" r="4" fill="${edge}" opacity="0.85"/>`);
  parts.push(`<text x="${w - pad - 6}" y="${h - pad - 4.8}" font-size="3.6" fill="#f6efe6" text-anchor="middle" font-weight="700">${esc(card.rankLabel ?? String(card.rank))}</text>`);
  // 边框加粗（裁切线参考）
  parts.push(`<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="${CARD_RADIUS - 0.5}" fill="none" stroke="${edge}" stroke-width="0.25" stroke-dasharray="1.2 0.8" opacity="0.7"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

/** 多个卡牌排成一行（打印页用）。 */
export function cardRowSvg(cards: readonly IrCard[], perRow: number, gap = 4): string {
  const w = CARD_W;
  const h = CARD_H;
  const rows = Math.ceil(cards.length / perRow);
  const totalW = perRow * w + (perRow - 1) * gap;
  const totalH = rows * h + (rows - 1) * gap;
  const parts: string[] = [];
  cards.forEach((c, i) => {
    const r = Math.floor(i / perRow);
    const col = i % perRow;
    const x = col * (w + gap);
    const y = r * (h + gap);
    parts.push(`<g transform="translate(${x},${y})">${cardSvg(c)}</g>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}mm" height="${totalH}mm" viewBox="0 0 ${totalW} ${totalH}">${parts.join('')}</svg>`;
}
/**
 * 主题术语（从 IR 的 glossary 取，缺键回退通用词）。
 *
 * ⚠️ 实体件的文本必须随主题走 —— 基准仙侠的「灵枢 / 符箓 / 灵力 / 山道」
 *   曾被硬编码进所有实体件模板，导致其余三套主题的实体件串戏。
 */
export type Terms = Readonly<Record<string, string>>;

/** 取术语。 */
export function term(terms: Terms, key: string, fallback: string): string {
  return terms[key] ?? fallback;
}

/** 棋盘 SVG（A2 = A4×4 拼接）。 */
export function boardSvg(board: IrBoard, ir: IrDocument): string {
  const W = A2_W;
  const H = A2_H;
  const margin = 18;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f7f2e9"/>`);
  parts.push(`<text x="${margin}" y="${margin}" font-size="9" fill="#1a1613" font-weight="700">${esc(ir.meta.name)} · ${term(ir.glossary, 'path', '山道')}</text>`);
  parts.push(`<text x="${margin}" y="${margin + 8}" font-size="4.4" fill="#6a5f52">${esc(ir.meta.tagline)}</text>`);
  // 山道：蛇形 7 列 × N 行
  const cols = 7;
  const cell = 44;
  const gap = 5;
  const top = margin + 26;
  const rows = Math.ceil(board.tiles.length / cols);
  board.tiles.forEach((tile, i) => {
    const row = Math.floor(i / cols);
    const raw = i % cols;
    const col = row % 2 === 0 ? raw : cols - 1 - raw;
    const x = margin + col * (cell + gap);
    const y = top + row * (cell + gap);
    const fill = tile.kind === 'peak' ? '#c99a4a'
      : tile.kind === 'gate' ? '#e3d3b0'
      : tile.kind === 'boon' ? '#d6e4cf'
      : tile.kind === 'hazard' ? '#eed2c8'
      : tile.kind === 'rift' ? '#ded2e8'
      : tile.kind === 'junction' ? '#d2dde8'
      : '#ffffff';
    const stroke = tile.kind === 'peak' ? '#8a6420' : '#b8ab99';
    parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
    parts.push(`<text x="${x + 3}" y="${y + 7}" font-size="3" fill="#8a7c6a">${tile.index}</text>`);
    const nameLines = wrap(tile.name, 6);
    nameLines.forEach((l, k) => {
      parts.push(`<text x="${x + 3}" y="${y + 16 + k * 5}" font-size="3.6" fill="#1a1613" font-weight="600">${esc(l)}</text>`);
    });
    if (tile.gateFee !== undefined) {
      parts.push(`<text x="${x + 3}" y="${y + cell - 4}" font-size="3.2" fill="#8a6420">过路 ${tile.gateFee} ${term(ir.glossary, 'resource', '资源')}</text>`);
    }
    if (tile.branchTo !== undefined) {
      parts.push(`<text x="${x + 3}" y="${y + cell - 4}" font-size="3.2" fill="#4a5a6a">支路 → ${tile.branchTo.join(' / ')}</text>`);
    }
  });
  // 图例
  const legendTop = top + rows * (cell + gap) + 12;
  const legend: [string, string][] = [
    ['#ffffff', term(ir.glossary, 'plain', '平原')], ['#d6e4cf', term(ir.glossary, 'boon', '福地')],
    ['#eed2c8', term(ir.glossary, 'hazard', '险径')], ['#ded2e8', term(ir.glossary, 'rift', '裂隙')],
    ['#d2dde8', term(ir.glossary, 'branch', '支路')], ['#e3d3b0', term(ir.glossary, 'gate', '关隘')],
    ['#c99a4a', term(ir.glossary, 'peak', '峰顶')],
  ];
  legend.forEach(([color, label], i) => {
    const x = margin + (i % 7) * 52;
    const y = legendTop + Math.floor(i / 7) * 12;
    parts.push(`<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${color}" stroke="#b8ab99" stroke-width="0.4"/>`);
    parts.push(`<text x="${x + 10}" y="${y + 5.6}" font-size="3.6" fill="#3a322a">${esc(label)}</text>`);
  });
  parts.push(`<text x="${margin}" y="${H - margin}" font-size="3.4" fill="#8a7c6a">共 ${board.length} 格，${term(ir.glossary, 'peak', '峰顶')}在第 ${board.peakIndex} 格 · 登顶≠胜利，须通过活人认证</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

/** 身份牌 SVG（63×88 标准牌尺寸）。 */
export function identitySvg(identity: IrIdentity): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#1f2a24" stroke="#c99a4a" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 9}" font-size="5.2" fill="#e8d9b8" font-weight="700">${esc(identity.name)}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 15}" font-size="3.2" fill="#9fb3a4">${esc(identity.id)}</text>`);
  parts.push(`<line x1="${pad}" y1="${pad + 18}" x2="${w - pad}" y2="${pad + 18}" stroke="#c99a4a" stroke-width="0.3" opacity="0.6"/>`);
  const pl = wrap(identity.passiveText, 15);
  pl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 26 + i * 4.4}" font-size="3.2" fill="#d8e0d6">${esc(l)}</text>`);
  });
  const gl = wrap('目标：' + identity.goalText, 15);
  gl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 44 + i * 4.4}" font-size="3.2" fill="#e8d9b8">${esc(l)}</text>`);
  });
  if (identity.flavor !== undefined) {
    const fl = wrap(identity.flavor, 15);
    fl.forEach((l, i) => {
      parts.push(`<text x="${pad + 2}" y="${h - pad - 12 + i * 4}" font-size="2.8" fill="#7f9182" font-style="italic">${esc(l)}</text>`);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}
/** 阵营牌 SVG。 */
export function factionSvg(faction: IrFaction, terms: Terms): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#2a2620" stroke="#8a7c6a" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 10}" font-size="5.6" fill="#e8e0d4" font-weight="700">${esc(faction.name)}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 16}" font-size="3" fill="#9a8e7e">${esc(faction.id)}</text>`);
  parts.push(`<line x1="${pad}" y1="${pad + 19}" x2="${w - pad}" y2="${pad + 19}" stroke="#8a7c6a" stroke-width="0.3" opacity="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 27}" font-size="3.4" fill="#c08b3e">基础${term(terms, 'hp', '体力')} ${faction.hpBase} · 初始${term(terms, 'resource', '资源')} ${faction.resourceBase}</text>`);
  const al = wrap('阵营能力：' + faction.abilityText, 15);
  al.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 35 + i * 4.4}" font-size="3.2" fill="#d8d0c2">${esc(l)}</text>`);
  });
  const wl = wrap('阵营轮：' + faction.wheelText, 15);
  wl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 56 + i * 4.4}" font-size="3.2" fill="#c08b3e">${esc(l)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

/** 认证题卡 SVG。 */
export function certCardSvg(item: { readonly id: string; readonly prompt: string }, index: number): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#f0e9dc" stroke="#7a8b7f" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 8}" font-size="3.4" fill="#7a8b7f">认证题卡</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 8}" font-size="4.6" fill="#3a322a" text-anchor="end" font-weight="700">#${index + 1}</text>`);
  const lines = wrap(item.prompt, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 20 + i * 4.8}" font-size="3.4" fill="#1a1613">${esc(l)}</text>`);
  });
  parts.push(`<text x="${pad + 2}" y="${h - pad - 5}" font-size="2.6" fill="#8a7c6a">须当场可验证 · 答对 2 问即通过</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

/** 天机牌 SVG（回合开始时翻开，对全场生效）。 */
export function heavenSvg(item: { readonly id: string; readonly name: string; readonly text: string }, index: number): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#e9e3f0" stroke="#5a4a6a" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 8}" font-size="3.4" fill="#5a4a6a">天机牌</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 8}" font-size="4.6" fill="#3a322a" text-anchor="end" font-weight="700">#${index + 1}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 15}" font-size="4.4" fill="#1a1613" font-weight="700">${esc(item.name)}</text>`);
  const lines = wrap(item.text, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 23 + i * 4.8}" font-size="3.4" fill="#3a322a">${esc(l)}</text>`);
  });
  parts.push(`<text x="${pad + 2}" y="${h - pad - 5}" font-size="2.6" fill="#8a7c6a">回合开始时翻开，对全场生效</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}
/** 试炼牌 SVG（关隘试炼用，标准牌尺寸）。 */
export function trialSvg(
  item: { readonly id: string; readonly name?: string; readonly text: string },
  index: number,
  terms: Terms,
): string {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#f4efe4" stroke="#8a6420" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 8}" font-size="3.4" fill="#8a6420">${term(terms, 'gate', '关隘')}试炼</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 8}" font-size="4.6" fill="#3a322a" text-anchor="end" font-weight="700">#${index + 1}</text>`);
  // B78 §3.2 甲案：类目行不动（它是玩家识别牌型的第一层信息），name 起独立第二行；
  //   正文起点**固定** pad+27（规格 r1.5：空 name 也占位 —— 偏移不许是数据的函数）。
  //   弃乙案（类目挪页脚）：页脚现在承载派生规则句（renderTrialFooter），再堆就撞。
  const name = item.name ?? '';
  const bodyTop = pad + 27;
  if (name.length > 0) {
    parts.push(`<text x="${pad + 2}" y="${pad + 15}" font-size="4.4" fill="#1a1613" font-weight="700">${esc(name)}</text>`);
  }
  const lines = wrap(item.text, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${bodyTop + i * 4.8}" font-size="3.4" fill="#1a1613">${esc(l)}</text>`);
  });
  parts.push(`<text x="${pad + 2}" y="${h - pad - 5}" font-size="2.6" fill="#8a7c6a">${esc(renderTrialFooter())}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}
/** 筹码 SVG（直径 25mm）。 */
export function chipSvg(label: string, sub?: string): string {
  const d = CHIP_D;
  const parts: string[] = [];
  parts.push(`<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 1}" fill="#e8d9b8" stroke="#8a6420" stroke-width="1"/>`);
  parts.push(`<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 3}" fill="none" stroke="#8a6420" stroke-width="0.4" opacity="0.6"/>`);
  parts.push(`<text x="${d / 2}" y="${d / 2 + (sub === undefined ? 1.2 : 0.4)}" font-size="5" fill="#3a2f1a" text-anchor="middle" font-weight="700">${esc(label)}</text>`);
  if (sub !== undefined) {
    parts.push(`<text x="${d / 2}" y="${d / 2 + 5}" font-size="2.6" fill="#6a5f4a" text-anchor="middle">${esc(sub)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}mm" height="${d}mm" viewBox="0 0 ${d} ${d}">${parts.join('')}</svg>`;
}
