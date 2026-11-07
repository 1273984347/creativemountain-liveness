// build/build-print.ts
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// build/print-templates.ts
var CARD_W = 63 + 3 + 3;
var CARD_H = 88 + 3 + 3;
var CARD_PAD = 3;
var CARD_RADIUS = 3;
var CHIP_D = 25;
var A2_W = 420;
var A2_H = 594;
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function wrap(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const ch of text) {
    cur += ch;
    if (cur.length >= maxChars) {
      lines.push(cur);
      cur = "";
    }
  }
  if (cur.length > 0) {
    lines.push(cur);
  }
  return lines;
}

// build/print-parts.ts
var COLOR_BG = { red: "#f6efe6", black: "#e8ecf0" };
var COLOR_EDGE = { red: "#c05a4a", black: "#4a5a6a" };
function cardSvg(card, opts = {}) {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const bg = COLOR_BG[card.color] ?? "#f2ece2";
  const edge = COLOR_EDGE[card.color] ?? "#8a7c6a";
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="${bg}" stroke="${edge}" stroke-width="0.4"/>`);
  parts.push(`<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="7" fill="${edge}" opacity="0.14"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 5.2}" font-size="3.4" fill="${edge}" font-weight="700">${esc(String(card.cost))}</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 5.2}" font-size="2.6" fill="${edge}" text-anchor="end">${esc(card.type)}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 13}" font-size="4.4" fill="#1a1613" font-weight="700">${esc(card.name)}</text>`);
  const lines = wrap(card.text, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 20 + i * 4.4}" font-size="3.2" fill="#3a322a">${esc(l)}</text>`);
  });
  parts.push(`<circle cx="${w - pad - 6}" cy="${h - pad - 6}" r="4" fill="${edge}" opacity="0.85"/>`);
  parts.push(`<text x="${w - pad - 6}" y="${h - pad - 4.8}" font-size="3.6" fill="#f6efe6" text-anchor="middle" font-weight="700">${esc(card.rankLabel ?? String(card.rank))}</text>`);
  parts.push(`<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="${CARD_RADIUS - 0.5}" fill="none" stroke="${edge}" stroke-width="0.25" stroke-dasharray="1.2 0.8" opacity="0.7"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
function boardSvg(board, ir) {
  const W = A2_W;
  const H = A2_H;
  const margin = 18;
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f7f2e9"/>`);
  parts.push(`<text x="${margin}" y="${margin}" font-size="9" fill="#1a1613" font-weight="700">${esc(ir.meta.name)} \xB7 \u5C71\u9053</text>`);
  parts.push(`<text x="${margin}" y="${margin + 8}" font-size="4.4" fill="#6a5f52">${esc(ir.meta.tagline)}</text>`);
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
    const fill = tile.kind === "peak" ? "#c99a4a" : tile.kind === "gate" ? "#e3d3b0" : tile.kind === "boon" ? "#d6e4cf" : tile.kind === "hazard" ? "#eed2c8" : tile.kind === "rift" ? "#ded2e8" : tile.kind === "junction" ? "#d2dde8" : "#ffffff";
    const stroke = tile.kind === "peak" ? "#8a6420" : "#b8ab99";
    parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`);
    parts.push(`<text x="${x + 3}" y="${y + 7}" font-size="3" fill="#8a7c6a">${tile.index}</text>`);
    const nameLines = wrap(tile.name, 6);
    nameLines.forEach((l, k) => {
      parts.push(`<text x="${x + 3}" y="${y + 16 + k * 5}" font-size="3.6" fill="#1a1613" font-weight="600">${esc(l)}</text>`);
    });
    if (tile.gateFee !== void 0) {
      parts.push(`<text x="${x + 3}" y="${y + cell - 4}" font-size="3.2" fill="#8a6420">\u8FC7\u8DEF ${tile.gateFee} \u7075\u67A2</text>`);
    }
    if (tile.branchTo !== void 0) {
      parts.push(`<text x="${x + 3}" y="${y + cell - 4}" font-size="3.2" fill="#4a5a6a">\u652F\u8DEF \u2192 ${tile.branchTo.join(" / ")}</text>`);
    }
  });
  const legendTop = top + rows * (cell + gap) + 12;
  const legend = [
    ["#ffffff", "\u5E73\u539F"],
    ["#d6e4cf", "\u798F\u5730"],
    ["#eed2c8", "\u9669\u5F84"],
    ["#ded2e8", "\u88C2\u9699"],
    ["#d2dde8", "\u652F\u8DEF"],
    ["#e3d3b0", "\u5173\u9698"],
    ["#c99a4a", "\u5CF0\u9876"]
  ];
  legend.forEach(([color, label], i) => {
    const x = margin + i % 7 * 52;
    const y = legendTop + Math.floor(i / 7) * 12;
    parts.push(`<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${color}" stroke="#b8ab99" stroke-width="0.4"/>`);
    parts.push(`<text x="${x + 10}" y="${y + 5.6}" font-size="3.6" fill="#3a322a">${esc(label)}</text>`);
  });
  parts.push(`<text x="${margin}" y="${H - margin}" font-size="3.4" fill="#8a7c6a">\u5171 ${board.length} \u683C\uFF0C\u5CF0\u9876\u5728\u7B2C ${board.peakIndex} \u683C \xB7 \u767B\u9876\u2260\u80DC\u5229\uFF0C\u987B\u901A\u8FC7\u6D3B\u4EBA\u8BA4\u8BC1</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}
function identitySvg(identity) {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#1f2a24" stroke="#c99a4a" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 9}" font-size="5.2" fill="#e8d9b8" font-weight="700">${esc(identity.name)}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 15}" font-size="3.2" fill="#9fb3a4">${esc(identity.id)}</text>`);
  parts.push(`<line x1="${pad}" y1="${pad + 18}" x2="${w - pad}" y2="${pad + 18}" stroke="#c99a4a" stroke-width="0.3" opacity="0.6"/>`);
  const pl = wrap(identity.passiveText, 15);
  pl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 26 + i * 4.4}" font-size="3.2" fill="#d8e0d6">${esc(l)}</text>`);
  });
  const gl = wrap("\u76EE\u6807\uFF1A" + identity.goalText, 15);
  gl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 44 + i * 4.4}" font-size="3.2" fill="#e8d9b8">${esc(l)}</text>`);
  });
  if (identity.flavor !== void 0) {
    const fl = wrap(identity.flavor, 15);
    fl.forEach((l, i) => {
      parts.push(`<text x="${pad + 2}" y="${h - pad - 12 + i * 4}" font-size="2.8" fill="#7f9182" font-style="italic">${esc(l)}</text>`);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
function factionSvg(faction) {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#2a2620" stroke="#8a7c6a" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 10}" font-size="5.6" fill="#e8e0d4" font-weight="700">${esc(faction.name)}</text>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 16}" font-size="3" fill="#9a8e7e">${esc(faction.id)}</text>`);
  parts.push(`<line x1="${pad}" y1="${pad + 19}" x2="${w - pad}" y2="${pad + 19}" stroke="#8a7c6a" stroke-width="0.3" opacity="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 27}" font-size="3.4" fill="#c08b3e">\u57FA\u7840\u7075\u529B ${faction.hpBase} \xB7 \u521D\u59CB\u7075\u67A2 ${faction.resourceBase}</text>`);
  const al = wrap("\u9635\u8425\u80FD\u529B\uFF1A" + faction.abilityText, 15);
  al.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 35 + i * 4.4}" font-size="3.2" fill="#d8d0c2">${esc(l)}</text>`);
  });
  const wl = wrap("\u9635\u8425\u8F6E\uFF1A" + faction.wheelText, 15);
  wl.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 56 + i * 4.4}" font-size="3.2" fill="#c08b3e">${esc(l)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
function certCardSvg(item, index) {
  const w = CARD_W;
  const h = CARD_H;
  const pad = CARD_PAD;
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${CARD_RADIUS}" fill="#f0e9dc" stroke="#7a8b7f" stroke-width="0.5"/>`);
  parts.push(`<text x="${pad + 2}" y="${pad + 8}" font-size="3.4" fill="#7a8b7f">\u8BA4\u8BC1\u9898\u5361</text>`);
  parts.push(`<text x="${w - pad - 2}" y="${pad + 8}" font-size="4.6" fill="#3a322a" text-anchor="end" font-weight="700">#${index + 1}</text>`);
  const lines = wrap(item.prompt, 15);
  lines.forEach((l, i) => {
    parts.push(`<text x="${pad + 2}" y="${pad + 20 + i * 4.8}" font-size="3.4" fill="#1a1613">${esc(l)}</text>`);
  });
  parts.push(`<text x="${pad + 2}" y="${h - pad - 5}" font-size="2.6" fill="#8a7c6a">\u987B\u5F53\u573A\u53EF\u9A8C\u8BC1 \xB7 \u7B54\u5BF9 2 \u95EE\u5373\u901A\u8FC7</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}
function chipSvg(label, sub) {
  const d = CHIP_D;
  const parts = [];
  parts.push(`<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 1}" fill="#e8d9b8" stroke="#8a6420" stroke-width="1"/>`);
  parts.push(`<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2 - 3}" fill="none" stroke="#8a6420" stroke-width="0.4" opacity="0.6"/>`);
  parts.push(`<text x="${d / 2}" y="${d / 2 + (sub === void 0 ? 1.2 : 0.4)}" font-size="5" fill="#3a2f1a" text-anchor="middle" font-weight="700">${esc(label)}</text>`);
  if (sub !== void 0) {
    parts.push(`<text x="${d / 2}" y="${d / 2 + 5}" font-size="2.6" fill="#6a5f4a" text-anchor="middle">${esc(sub)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}mm" height="${d}mm" viewBox="0 0 ${d} ${d}">${parts.join("")}</svg>`;
}

// build/print-rules.ts
function srcTd(cell) {
  return `<td data-src="${esc(cell.src)}">${cell.value}</td>`;
}
function scalesTable(ir) {
  const row = ir.scales[0];
  const head = [
    "\u4EBA\u6570",
    "\u5C71\u9053\u683C\u6570",
    "\u5173\u9698\u6570",
    "\u521D\u59CB\u7075\u67A2",
    "\u8D77\u59CB\u624B\u724C",
    "\u724C\u5E93\u603B\u91CF",
    "\u8BD5\u70BC\u724C",
    "\u8BA4\u8BC1\u9898\u5361",
    "\u8BA4\u8BC1\u7B7E\u5370\u95E8\u69DB N",
    "\u5370\u8BB0\u540E\u95E8\u69DB",
    "\u5C71\u8BAE\u95F4\u9694\uFF08\u6807\u51C6\uFF09",
    "\u5C71\u8BAE\u95F4\u9694\uFF08\u65B0\u624B\uFF09",
    "\u653E\u9010\u4E0B\u9650",
    "\u5168\u5C40\u56DE\u5408\u4E0A\u9650"
  ];
  const keys = [
    "players",
    "boardLength",
    "gateCount",
    "initialResource",
    "handStart",
    "deckTotal",
    "trialTotal",
    "certTotal",
    "threshold",
    "thresholdWithMark",
    "councilIntervalStandard",
    "councilIntervalNewbie",
    "exileFloor",
    "globalRoundLimit"
  ];
  const thead = "<tr>" + head.map((h) => `<th>${esc(h)}</th>`).join("") + "</tr>";
  const tbody = ir.scales.map((r) => {
    const cells = keys.map((k) => {
      if (k === "players") {
        return `<td>${r.players}</td>`;
      }
      const cell = r[k];
      return cell === void 0 ? "<td>\u2014</td>" : srcTd(cell);
    });
    return "<tr>" + cells.join("") + "</tr>";
  }).join("");
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
function factionsTable(ir) {
  const head = ["\u9635\u8425", "\u57FA\u7840\u7075\u529B", "\u521D\u59CB\u7075\u67A2", "\u9635\u8425\u80FD\u529B", "\u9635\u8425\u8F6E"];
  const thead = "<tr>" + head.map((h) => `<th>${esc(h)}</th>`).join("") + "</tr>";
  const tbody = ir.factions.map(
    (f) => `<tr><td>${esc(f.name)}</td><td>${f.hpBase}</td><td>${f.resourceBase}</td><td>${esc(f.abilityText)}</td><td>${esc(f.wheelText)}</td></tr>`
  ).join("");
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
function identitiesTable(ir) {
  const head = ["\u8EAB\u4EFD", "\u88AB\u52A8\u7279\u6743", "\u7EC8\u5C40\u76EE\u6807"];
  const thead = "<tr>" + head.map((h) => `<th>${esc(h)}</th>`).join("") + "</tr>";
  const tbody = ir.identities.map(
    (i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.passiveText)}</td><td>${esc(i.goalText)}</td></tr>`
  ).join("");
  return `<table class="grid"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
function instructionTable(ir) {
  const thead = "<tr><th>\u70B9\u6570</th><th>\u6307\u4EE4</th></tr>";
  const tbody = ir.instructionTable.map(
    (x) => `<tr><td>${x.face}</td><td>${esc(x.text)}</td></tr>`
  ).join("");
  return `<table class="grid compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}
function cardsTable(ir) {
  const head = ["\u540D\u79F0", "\u7C7B\u578B", "\u7075\u67A2", "\u989C\u8272", "\u70B9\u6570", "\u6548\u679C"];
  const thead = "<tr>" + head.map((h) => `<th>${esc(h)}</th>`).join("") + "</tr>";
  const tbody = ir.cards.map(
    (c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${c.cost}</td><td>${esc(c.color)}</td><td>${esc(c.rankLabel ?? String(c.rank))}</td><td>${esc(c.text)}</td></tr>`
  ).join("");
  return `<table class="grid compact"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

// build/build-print.ts
var ROOT = process.cwd();
var PRINT = resolve(ROOT, "print");
var SVG_DIR = resolve(PRINT, "svg");
function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
}
function loadIr() {
  return JSON.parse(readFileSync(resolve(PRINT, "ir.json"), "utf8"));
}
function exportSvgs(ir) {
  mkdirSync(SVG_DIR, { recursive: true });
  const written = [];
  const put = (name, svg) => {
    writeFileSync(resolve(SVG_DIR, name), svg, "utf8");
    written.push("svg/" + name);
  };
  put("\u68CB\u76D8-A2.svg", boardSvg(ir.board, ir));
  ir.cards.forEach((c, i) => {
    put("\u5361\u724C-" + String(i + 1).padStart(2, "0") + "-" + c.id + ".svg", cardSvg(c));
  });
  ir.identities.forEach((i2, k) => {
    put("\u8EAB\u4EFD\u724C-" + String(k + 1).padStart(2, "0") + "-" + i2.id + ".svg", identitySvg(i2));
  });
  ir.factions.forEach((f, k) => {
    put("\u9635\u8425\u724C-" + String(k + 1).padStart(2, "0") + "-" + f.id + ".svg", factionSvg(f));
  });
  ir.certCards.forEach((c, k) => {
    put("\u8BA4\u8BC1\u9898\u5361-" + String(k + 1).padStart(2, "0") + ".svg", certCardSvg(c, k));
  });
  put("\u7B79\u7801-\u7075\u67A2.svg", chipSvg("\u7075\u67A2", "SP"));
  put("\u7B79\u7801-\u5370\u8BB0.svg", chipSvg("\u5370\u8BB0", "MK"));
  return written;
}
var PRINT_CSS = `
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
function narrationHtml(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) {
      closeList();
      out.push('<h2 class="ch">' + esc(line.slice(2)) + "</h2>");
    } else if (line.startsWith("## ")) {
      closeList();
      out.push('<h3 class="ch">' + esc(line.slice(3)) + "</h3>");
    } else if (line.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + esc(line.slice(2)) + "</li>");
    } else if (/^\d+\. /.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + esc(line.replace(/^\d+\. /, "")) + "</li>");
    } else if (line.length === 0) {
      closeList();
    } else {
      closeList();
      out.push("<p>" + esc(line) + "</p>");
    }
  }
  closeList();
  return out.join("\n");
}
function rulesHtml(ir, narration) {
  const body = [];
  body.push('<div class="sheet">');
  body.push('<div class="cover">');
  body.push("<h1>" + esc(ir.meta.name) + "</h1>");
  body.push("<h2>" + esc(ir.meta.tagline) + "</h2>");
  body.push("<p>\u300A\u521B\u754C\u5C71\xB7\u6D3B\u4EBA\u8BA4\u8BC1\u300B\u2014\u2014\u684C\u9762\u591A\u4EBA\u7B56\u7565\u6E38\u620F\u89C4\u5219\u4E66<br/>\u767B\u9876\u2260\u80DC\u5229\uFF1A\u5CF0\u9876\u53EA\u8BA4\u6D3B\u4EBA\u3002</p>");
  body.push("<p>\u672C\u4F5C\u7531 " + esc(ir.meta.deckName) + "\u7CFB\u7EDF\u4E0E " + esc(ir.meta.resourceName) + "\u7ECF\u6D4E\u9A71\u52A8\u3002\u89C4\u6A21\u53C2\u6570\u89C1\u4E0B\u9875\u3002</p>");
  body.push("</div></div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u89C4\u6A21\u9002\u914D\u8868</h2>');
  body.push('<p class="note">\u4E0B\u8868\u6570\u503C\u4E0E\u5F15\u64CE\u5E38\u91CF\u4E00\u4E00\u5BF9\u5E94\uFF08\u53EF\u56DE\u6EAF\uFF09\u3002\u540C\u4E00\u5957\u89C4\u5219\u53EF\u6309\u4EBA\u6570\u81EA\u52A8\u4F38\u7F29\u3002</p>');
  body.push(scalesTable(ir));
  body.push("</div>");
  body.push('<div class="sheet">');
  body.push(narrationHtml(narration));
  body.push("</div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u9635\u8425</h2>');
  body.push(factionsTable(ir));
  body.push('<h2 class="ch">\u8EAB\u4EFD</h2>');
  body.push(identitiesTable(ir));
  body.push("</div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u6307\u4EE4\u9AB0\uFF0820 \u9762\uFF09\xB7 \u95EE\u5929\u65F6\u6309\u70B9\u6570\u6267\u884C</h2>');
  body.push(instructionTable(ir));
  body.push("</div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u7B26\u7B93\u603B\u8868</h2>');
  body.push(cardsTable(ir));
  body.push("</div>");
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(ir.meta.name) + " \u89C4\u5219\u4E66</title><style>" + PRINT_CSS + "</style></head><body>" + body.join("\n") + "</body></html>";
}
function partsHtml(ir) {
  const body = [];
  body.push('<div class="sheet board-sheet">');
  body.push('<div style="width:420mm;height:594mm;margin:0 auto;">' + boardSvg(ir.board, ir) + "</div>");
  body.push("</div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u7B26\u7B93\uFF0863\xD788mm + 3mm \u51FA\u8840 \xB7 3mm \u5706\u89D2\uFF09</h2>');
  body.push('<div class="cards">');
  ir.cards.forEach((c) => {
    body.push(cardSvg(c));
  });
  body.push("</div></div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u8EAB\u4EFD\u724C</h2>');
  body.push('<div class="cards">');
  ir.identities.forEach((i2) => {
    body.push(identitySvg(i2));
  });
  body.push("</div>");
  body.push('<h2 class="ch">\u9635\u8425\u724C</h2>');
  body.push('<div class="cards">');
  ir.factions.forEach((f) => {
    body.push(factionSvg(f));
  });
  body.push("</div></div>");
  body.push('<div class="sheet">');
  body.push('<h2 class="ch">\u8BA4\u8BC1\u9898\u5361\uFF08' + ir.certCards.length + " \u5F20\uFF09</h2>");
  body.push('<div class="cards">');
  ir.certCards.forEach((c, k) => {
    body.push(certCardSvg(c, k));
  });
  body.push("</div></div>");
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(ir.meta.name) + " \u5B9E\u4F53\u4EF6</title><style>" + PRINT_CSS + "</style></head><body>" + body.join("\n") + "</body></html>";
}
async function htmlToPdf(htmlPath, pdfPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = toFileUrl(htmlPath);
    await page.goto(url, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" }
    });
    return existsSync(pdfPath);
  } catch (e) {
    console.warn("WARN  PDF \u751F\u6210\u5F02\u5E38\uFF1A" + (e instanceof Error ? e.message : String(e)).slice(0, 200));
    return false;
  } finally {
    await browser.close();
  }
}
function toFileUrl(absPath) {
  const s = absPath.replace(/\\/g, "/");
  return "file:///" + s.split("/").map((seg, i) => i === 0 ? seg : encodeURIComponent(seg)).join("/");
}
async function main() {
  mkdirSync(PRINT, { recursive: true });
  mkdirSync(SVG_DIR, { recursive: true });
  const ir = loadIr();
  const svgs = exportSvgs(ir);
  console.log("SVG \u5B9E\u4F53\u4EF6 " + svgs.length + " \u4E2A \u2192 print/svg/");
  const narrationPath = resolve(PRINT, "\u89C4\u5219\u4E66\u53D9\u8FF0.md");
  const narration = existsSync(narrationPath) ? readFileSync(narrationPath, "utf8") : "# \u89C4\u5219\u4E66";
  const rulesPath = resolve(PRINT, "\u89C4\u5219\u4E66.html");
  writeFileSync(rulesPath, rulesHtml(ir, narration), "utf8");
  console.log("\u89C4\u5219\u4E66 \u2192 print/\u89C4\u5219\u4E66.html");
  const partsPath = resolve(PRINT, "\u5B9E\u4F53\u4EF6.html");
  writeFileSync(partsPath, partsHtml(ir), "utf8");
  console.log("\u5B9E\u4F53\u4EF6 \u2192 print/\u5B9E\u4F53\u4EF6.html");
  const rulesPdf = resolve(PRINT, "\u89C4\u5219\u4E66.pdf");
  const ok1 = await htmlToPdf(rulesPath, rulesPdf);
  console.log(ok1 ? "PDF \u2192 print/\u89C4\u5219\u4E66.pdf" : "PDF \u89C4\u5219\u4E66\u5931\u8D25");
  const partsPdf = resolve(PRINT, "\u5B9E\u4F53\u4EF6.pdf");
  const ok2 = await htmlToPdf(partsPath, partsPdf);
  console.log(ok2 ? "PDF \u2192 print/\u5B9E\u4F53\u4EF6.pdf" : "PDF \u5B9E\u4F53\u4EF6\u5931\u8D25");
}
await main();
export {
  exportSvgs,
  findBrowser,
  htmlToPdf,
  narrationHtml,
  partsHtml,
  rulesHtml,
  toFileUrl
};
