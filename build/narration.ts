// 规则书叙述的极简 Markdown → HTML 渲染（规格 §6.7）。
//
// 为什么独立成文件：叙述模板（`print/规则书叙述.md`）里用了
//   `**粗体**`、`###` 三级小节、Markdown 表格 —— 而原实现只认 `#` / `##`，
//   其余一律当普通段落 ⇒ 成品里字面印出 `**...**`、`### 福地`、`| 福地 | ... |`。
//   抽成独立模块还有一个好处：**可被测试直接 import**（不必跑整套构建）。

import { esc } from './print-templates.ts';

/**
 * 行内 Markdown → HTML（`**粗体**` / `` `代码` ``）。
 *
 * ⚠️ 必须在 `esc()` **之后**调用 —— 否则叙述内容里的尖括号会被当成标签。
 */
export function inlineMd(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** 是否是 Markdown 表格的**分隔行**（`|---|---|`）。 */
function isTableSep(line: string): boolean {
  return /^\|[\s:|-]+\|?$/.test(line.trim());
}

/** 拆分一行表格为单元格。 */
function splitRow(row: string): string[] {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** 渲染 Markdown 表格块（首行表头，`|---|` 分隔行跳过）。 */
export function tableHtml(rows: readonly string[]): string {
  const data = rows.filter((r) => !isTableSep(r));
  const head = splitRow(data[0] ?? '');
  const body = data.slice(1);
  const th = '<tr>' + head.map((c) => '<th>' + inlineMd(esc(c)) + '</th>').join('') + '</tr>';
  const trs = body.map((r) =>
    '<tr>' + splitRow(r).map((c) => '<td>' + inlineMd(esc(c)) + '</td>').join('') + '</tr>');
  return '<table class="grid compact"><thead>' + th + '</thead><tbody>' + trs.join('') + '</tbody></table>';
}

/** 把叙述 markdown 转成 HTML（标题 / 三级小节 / 列表 / 段落 / 表格 / 行内样式）。 */
export function narrationHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  let inList = false;
  const closeList = (): void => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw.trimEnd();
    // 表格块：连续以 `|` 开头的行
    if (line.trim().startsWith('|')) {
      closeList();
      const block: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        block.push((lines[i] ?? '').trim());
        i += 1;
      }
      out.push(tableHtml(block));
      continue;
    }
    i += 1;
    if (line.startsWith('# ')) {
      closeList();
      out.push('<h2 class="ch">' + inlineMd(esc(line.slice(2))) + '</h2>');
    } else if (line.startsWith('## ')) {
      closeList();
      out.push('<h3 class="ch">' + inlineMd(esc(line.slice(3))) + '</h3>');
    } else if (line.startsWith('### ')) {
      closeList();
      out.push('<h4 class="ch">' + inlineMd(esc(line.slice(4))) + '</h4>');
    } else if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inlineMd(esc(line.slice(2))) + '</li>');
    } else if (/^\d+\. /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inlineMd(esc(line.replace(/^\d+\. /, ''))) + '</li>');
    } else if (line.length === 0) {
      closeList();
    } else {
      closeList();
      out.push('<p>' + inlineMd(esc(line)) + '</p>');
    }
  }
  closeList();
  return out.join('\n');
}
