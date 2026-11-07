// 实体轨构建（B6）：ir.json → SVG 实体件 + 打印 HTML → headless Edge → PDF。
//
// 产出：
//   print/svg/*.svg   —— 可编辑的实体件源文件（棋盘/卡牌/身份牌/阵营牌/认证题卡/筹码）
//   print/*.html      —— 打印用页面（@page 精确版面）
//   print/*.pdf       —— headless Edge 产出的 PDF
//
// 规则书：**表格段由 ir.json 生成**（数值带 data-src 溯源），**叙述段手写**（print/规则书叙述.md）。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { boardSvg, cardRowSvg, cardSvg, certCardSvg, chipSvg, factionSvg, identitySvg } from './print-parts.ts';
import { cardsTable, factionsTable, identitiesTable, instructionTable, scalesTable } from './print-rules.ts';
import { esc } from './print-templates.ts';

const ROOT = process.cwd();
const PRINT = resolve(ROOT, 'print');

/** 找 headless 浏览器（优先 Edge，回退 Chrome）。 */
function findBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) {
    if (existsSync(c)) { return c; }
  }
  return null;
}
