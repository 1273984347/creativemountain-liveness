// 实体轨构建（B6）：ir.json → SVG 实体件 + 打印 HTML → headless Edge → PDF。
//
// 产出：
//   print/svg/*.svg   —— 可编辑的实体件源文件（棋盘/卡牌/身份牌/阵营牌/认证题卡/筹码）
//   print/*.html      —— 打印用页面（@page 精确版面）
//   print/*.pdf       —— headless Edge 产出的 PDF
//
// 规则书：**表格段由 ir.json 生成**（数值带 data-src 溯源），**叙述段手写**（print/规则书叙述.md）。
//
// 运行：`npm run build:print`（esbuild 打包本文件 → node 执行）。

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { boardSvg, cardRowSvg, cardSvg, certCardSvg, chipSvg, factionSvg, heavenSvg, identitySvg, trialSvg, term } from './print-parts.ts';
import { cardsTable, factionsTable, identitiesTable, instructionTable, scalesTable } from './print-rules.ts';
import { esc } from './print-templates.ts';
// 叙述渲染已抽到独立模块（B16）—— 支持三级小节 / 表格 / 行内粗体，且可被测试直接 import。
import { narrationHtml } from './narration.ts';
export { narrationHtml };
// 棋盘按人数多版（V1.1）：与数字轨共用同一份 fitBoard ⇒ 实体件与对局必然一致。
import { BOARD_VERSIONS, fitBoard } from '../engine/core/board-fit.ts';
import type { IrDocument } from '../engine/types/ir.ts';

const ROOT = process.cwd();
/** 输出目录（CLI 参数 1；默认 print/）。按主题分目录时由编排脚本传入。 */
const OUT_DIR = resolve(ROOT, process.argv[2] ?? 'print');
/** IR 路径（CLI 参数 2；默认 print/ir.json）。 */
const IR_PATH = resolve(ROOT, process.argv[3] ?? 'print/ir.json');
const SVG_DIR = resolve(OUT_DIR, 'svg');

/** 找 headless 浏览器（优先 Edge，回退 Chrome）。 */
export function findBrowser(): string | null {
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

/** 读 ir.json。 */
function loadIr(): IrDocument {
  return JSON.parse(readFileSync(IR_PATH, 'utf8')) as IrDocument;
}

/**
 * 按主题术语替换**叙述模板**里的占位符。
 *
 * ⚠️ 规则书叙述是**一份模板**（print/规则书叙述.md，入库源），
 *   四套主题共用同一段叙述，只替换术语 —— 否则要维护四份会漂移的叙述。
 */
export function renderNarration(template: string, ir: IrDocument): string {
  const g = ir.glossary ?? {};
  const map: Record<string, string> = {
    hp: g.HP ?? '体力',
    deck: ir.meta.deckName,
    resource: g.resource ?? '资源',
    gate: g.gate ?? '关隘',
    peak: g.peak ?? '峰顶',
    path: g.path ?? '山道',
    player: g.player ?? '玩家',
    // 地形术语（B16 规则书地形章需要）—— 缺键回退通用词。
    plain: g.plain ?? '平原',
    boon: g.boon ?? '福地',
    hazard: g.hazard ?? '险径',
    rift: g.rift ?? '裂隙',
    branch: g.branch ?? '支路',
  };
  let out = template;
  for (const [k, v] of Object.entries(map)) {
    out = out.replaceAll('{{' + k + '}}', v);
  }
  return out;
}
/** 导出全部 SVG 实体件。 */
export function exportSvgs(ir: IrDocument): string[] {
  // ⚠️ B78 §4 R2：**先清空再写** —— 生成物目录必须是**确定**的。
  //   旧实现只写不删：改过试炼牌顺序/改名后，旧编号文件会留在目录里，而
  //   `build-package.mjs:43` 对本目录**整目录 cpSync** ⇒ 旧代试炼牌（页脚还是旧假话）
  //   会随发布包一起发出去。现查证据：每套 svg 目录曾积到 24 个试炼牌文件 = 12 当前 + 12 旧代。
  rmSync(SVG_DIR, { recursive: true, force: true });
  mkdirSync(SVG_DIR, { recursive: true });
  const written: string[] = [];
  const put = (name: string, svg: string): void => {
    writeFileSync(resolve(SVG_DIR, name), svg, 'utf8');
    written.push('svg/' + name);
  };
  // 棋盘：**按人数多版**（V1.1）—— 每版一张 A2，文件名带格数与适用人数。
  for (const v of BOARD_VERSIONS) {
    put('棋盘-A2-' + String(v.length) + '格-' + v.players.join('人') + '.svg', boardSvg(fitBoard(ir.board, v.length), ir));
  }
  // 卡牌：每张一个 SVG（可编辑）
  ir.cards.forEach((c, i) => {
    put('卡牌-' + String(i + 1).padStart(2, '0') + '-' + c.id + '.svg', cardSvg(c));
  });
  // 身份牌
  ir.identities.forEach((i2, k) => {
    put('身份牌-' + String(k + 1).padStart(2, '0') + '-' + i2.id + '.svg', identitySvg(i2));
  });
  // 阵营牌
  ir.factions.forEach((f, k) => {
    put('阵营牌-' + String(k + 1).padStart(2, '0') + '-' + f.id + '.svg', factionSvg(f, ir.glossary));
  });
  // 认证题卡
  ir.certCards.forEach((c, k) => {
    put('认证题卡-' + String(k + 1).padStart(2, '0') + '.svg', certCardSvg(c, k));
  });
  // 试炼牌
  ir.trials.forEach((t, k) => {
    put('试炼牌-' + String(k + 1).padStart(2, '0') + '-' + t.id + '.svg', trialSvg(t, k, ir.glossary));
  });
  // 天机牌
  ir.heavenCards.forEach((h, k) => {
    put('天机牌-' + String(k + 1).padStart(2, '0') + '-' + h.id + '.svg', heavenSvg(h, k));
  });
  // 筹码
  put('筹码-' + term(ir.glossary, 'resource', '资源') + '.svg', chipSvg(term(ir.glossary, 'resource', '资源')));
  put('筹码-印记.svg', chipSvg('印记', 'MK'));
  return written;
}

/** 打印页的 CSS（@page 精确版面）。 */
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@page board { size: A3 landscape; margin: 8mm; }
.board-sheet { page: board; }
@page :first { margin: 0; }
body { margin:0; font-family: 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif; color:#1a1613; }
.sheet { page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.cover { display:flex; flex-direction:column; align-items:center; justify-content:center; height:297mm; }
.cover h1 { font-size:34pt; margin:0 0 6mm; color:#8a6420; }
.cover h2 { font-size:15pt; margin:0 0 12mm; font-weight:400; color:#6a5f52; }
.cover p { font-size:10pt; color:#6a5f52; max-width:120mm; line-height:1.8; text-align:center; }
h2.ch { font-size:14pt; color:#8a6420; margin:8mm 0 3mm; border-bottom:1px solid #c9b89c; padding-bottom:1.5mm; }
h3.ch { font-size:11pt; color:#3a322a; margin:5mm 0 2mm; }
h4.ch { font-size:9.5pt; color:#5a4a3a; margin:4mm 0 1.5mm; }
p { font-size:9.5pt; line-height:1.75; margin:2mm 0; }
ol, ul { font-size:9.5pt; line-height:1.75; margin:2mm 0 2mm 6mm; padding:0; }
table.grid { width:100%; border-collapse:collapse; font-size:8pt; margin:3mm 0; }
table.grid th, table.grid td { border:1px solid #c9b89c; padding:1.4mm 2mm; text-align:left; vertical-align:top; }
table.grid th { background:#efe6d4; font-weight:700; }
table.grid.compact { font-size:7pt; }
table.grid.compact th, table.grid.compact td { padding:1mm 1.5mm; }
.cards { display:flex; flex-wrap:wrap; gap:4mm; }
.cards svg { display:block; }
.note { font-size:8pt; color:#8a7c6a; margin:2mm 0; }
`;

/** 生成规则书 HTML。 */
export function rulesHtml(ir: IrDocument, narration: string): string {
  const body: string[] = [];
  body.push('<div class="sheet">');
  body.push('<div class="cover">');
  body.push('<h1>' + esc(ir.meta.name) + '</h1>');
  body.push('<h2>' + esc(ir.meta.tagline) + '</h2>');
  body.push('<p>《创界山·活人认证》——桌面多人策略游戏规则书<br/>登顶≠胜利：' + esc(ir.glossary.peak ?? '峰顶') + '只认活人。</p>');
  body.push('<p>本作由 ' + esc(ir.meta.deckName) + '系统与 ' + esc(ir.meta.resourceName) + '经济驱动。规模参数见下页。</p>');
  body.push('</div></div>');
  // 规模表（带溯源）
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">规模适配表</h2>');
  body.push('<p class="note">下表数值与引擎常量一一对应（可回溯）。同一套规则可按人数自动伸缩。</p>');
  body.push(scalesTable(ir));
  body.push('</div>');
  // 叙述
  body.push('<div class="sheet">');
  body.push(narrationHtml(narration));
  body.push('</div>');
  // 阵营 / 身份 / 指令
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">阵营</h2>');
  body.push(factionsTable(ir));
  body.push('<h2 class="ch">身份</h2>');
  body.push(identitiesTable(ir));
  body.push('</div>');
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">指令骰（20 面）· 问天时按点数执行</h2>');
  body.push(instructionTable(ir));
  body.push('</div>');
  // 卡牌总表
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">' + esc(ir.meta.deckName) + '总表</h2>');
  body.push(cardsTable(ir));
  body.push('</div>');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(ir.meta.name) + ' 规则书</title><style>' + PRINT_CSS + '</style></head><body>' + body.join('\n') + '</body></html>';
}
/** 实体件打印页：棋盘 + 卡牌 + 身份牌 + 阵营牌 + 认证题卡。 */
export function partsHtml(ir: IrDocument): string {
  const body: string[] = [];
  // 棋盘：**按人数多版**（V1.1）—— 每版一页 A2，页首标明适用人数与格数。
  for (const v of BOARD_VERSIONS) {
    body.push('<div class="sheet board-sheet">');
    body.push('<h2 class="ch">' + esc(ir.meta.name) + ' 棋盘 · ' + v.players.join(' / ') + ' 人（' + String(v.length) + ' 格）</h2>');
    body.push('<div style="width:420mm;height:594mm;margin:0 auto;">' + boardSvg(fitBoard(ir.board, v.length), ir) + '</div>');
    body.push('</div>');
  }
  // 卡牌
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">' + esc(ir.meta.deckName) + '（63×88mm + 3mm 出血 · 3mm 圆角）</h2>');
  body.push('<div class="cards">');
  ir.cards.forEach((c) => { body.push(cardSvg(c)); });
  body.push('</div></div>');
  // 身份牌 + 阵营牌
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">身份牌</h2>');
  body.push('<div class="cards">');
  ir.identities.forEach((i2) => { body.push(identitySvg(i2)); });
  body.push('</div>');
  body.push('<h2 class="ch">阵营牌</h2>');
  body.push('<div class="cards">');
  ir.factions.forEach((f) => { body.push(factionSvg(f, ir.glossary)); });
  body.push('</div></div>');
  // 认证题卡
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">认证题卡（' + ir.certCards.length + ' 张）</h2>');
  body.push('<div class="cards">');
  ir.certCards.forEach((c, k) => { body.push(certCardSvg(c, k)); });
  body.push('</div></div>');
  // 试炼牌
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">关隘试炼牌（' + ir.trials.length + ' 张）</h2>');
  body.push('<div class="cards">');
  ir.trials.forEach((t, k) => { body.push(trialSvg(t, k, ir.glossary)); });
  body.push('</div></div>');
  // 天机牌
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">天机牌（' + ir.heavenCards.length + ' 张）</h2>');
  body.push('<div class="cards">');
  ir.heavenCards.forEach((h, k) => { body.push(heavenSvg(h, k)); });
  body.push('</div></div>');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(ir.meta.name) + ' 实体件</title><style>' + PRINT_CSS + '</style></head><body>' + body.join('\n') + '</body></html>';
}

/** 用 headless 浏览器把 HTML 打成 PDF。 */
export async function htmlToPdf(htmlPath: string, pdfPath: string): Promise<boolean> {
  // 用 **Playwright 自带的 Chromium**，而不是系统 Edge CLI：
  //   ① Edge CLI 的 `--print-to-pdf` 在本机会**静默失败**（退出码 0、不产出文件），
  //      且复用 user-data-dir 时第二次调用必失败；
  //   ② Playwright 直接调 `page.pdf()`，行为可控，且不依赖系统浏览器。
  //   ③ **不碰用户的浏览器进程**——headless 实例完全独立。
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = toFileUrl(htmlPath);
    await page.goto(url, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      // ⚠️ B92：**必须让 CSS 的 `@page` 生效** —— `PRINT_CSS` 里 `@page board { size: A3 landscape }`
      //   规定棋盘页用 A3 横向、其余 A4 纵向；但 `format:'A4'` 会**覆盖** CSS 的 @page 尺寸
      //   （Playwright 的 format 优先），且不设 `preferCSSPageSize` 时 @page 被忽略
      //   ⇒ 实测棋盘页曾被打成 A4 横向（尺寸与标称不符）。设 preferCSSPageSize 后由 CSS 决定。
      preferCSSPageSize: true,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
    });
    return existsSync(pdfPath);
  } catch (e) {
    console.warn('WARN  PDF 生成异常：' + (e instanceof Error ? e.message : String(e)).slice(0, 200));
    return false;
  } finally {
    await browser.close();
  }
}

/** 构造百分号编码的 file URL（中文路径必须编码）。 */
export function toFileUrl(absPath: string): string {
  const s = absPath.replace(/\\/g, '/');
  return 'file:///' + s.split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/');
}


async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SVG_DIR, { recursive: true });
  const ir = loadIr();

  // 1. SVG 实体件
  const svgs = exportSvgs(ir);
  console.log('SVG 实体件 ' + svgs.length + ' 个 → print/svg/');

  // 2. 规则书 HTML（叙述段手写 + 表格段生成）
  const narrationPath = resolve(ROOT, 'print', '规则书叙述.md');
  const template = existsSync(narrationPath) ? readFileSync(narrationPath, 'utf8') : '# 规则书';
  const narration = renderNarration(template, ir);
  const rulesPath = resolve(OUT_DIR, '规则书.html');
  writeFileSync(rulesPath, rulesHtml(ir, narration), 'utf8');
  console.log('规则书 → ' + rulesPath);

  // 3. 实体件打印 HTML
  const partsPath = resolve(OUT_DIR, '实体件.html');
  writeFileSync(partsPath, partsHtml(ir), 'utf8');
  console.log('实体件 → ' + partsPath);

  // 4. PDF
  const rulesPdf = resolve(OUT_DIR, '规则书.pdf');
  const ok1 = await htmlToPdf(rulesPath, rulesPdf);
  console.log((ok1 ? 'PDF → ' + rulesPdf : 'PDF 规则书失败'));
  const partsPdf = resolve(OUT_DIR, '实体件.pdf');
  const ok2 = await htmlToPdf(partsPath, partsPdf);
  console.log((ok2 ? 'PDF → ' + partsPdf : 'PDF 实体件失败'));
}

await main();
