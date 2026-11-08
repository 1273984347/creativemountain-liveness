// 门 ③（doc-sync）的 **C10 规则书地形覆盖**的常驻负样本自证。
//
// 为什么用**隔离副本**：进程级负样本要真的让 `node tools/doc-sync.mjs` 判红，
//   而 doc-sync 读的是仓库里的规格与规则书叙述 ⇒ 直接改共享工作树会污染并行的门 ②。
//   ⇒ 复制到临时目录改**副本**，共享工作树全程只读。
//
// 两级负样本：
//   ① **函数级**：直接调 C10，构造缺项叙述 ⇒ 精确、快速；
//   ② **进程级**：副本里跑真门禁 `node tools/doc-sync.mjs` ⇒ 证明「门禁真的会红」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { checkRulesBookTerrain, TERRAIN_CONTRACT } from '../../tools/rules-book-contract.mjs';
import { DOC_SYNC_INCLUDE, makeIsolatedRepo } from '../../tools/repo-copy.mjs';
import { narrationHtml } from '../../build/narration.ts';

const ROOT = process.cwd();
const SPEC_REL = 'docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md';
const NARRATION_REL = 'print/规则书叙述.md';

/** 建立隔离副本（清单与门禁负样本共用 `tools/repo-copy.mjs` 的**单一事实源**）。 */
function makeCopy(): string {
  return makeIsolatedRepo(ROOT, DOC_SYNC_INCLUDE);
}

/** 在副本里跑真门禁（门 ③ doc-sync）。 */
function runDocSync(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [resolve(cwd, 'tools', 'doc-sync.mjs')], {
    cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 读当前规则书叙述模板。 */
function narration(): string {
  return readFileSync(resolve(ROOT, NARRATION_REL), 'utf8');
}

/** 读当前规格。 */
function spec(): string {
  return readFileSync(resolve(ROOT, SPEC_REL), 'utf8');
}

/** 破坏副本里的裂隙小节（整节删除）。 */
function breakRiftSection(cwd: string): void {
  const p = resolve(cwd, NARRATION_REL);
  const src = readFileSync(p, 'utf8');
  const i = src.indexOf('### {{rift}}');
  assert.ok(i >= 0, '副本应含裂隙小节');
  const j = src.indexOf('### {{gate}}', i);
  assert.ok(j > i, '副本应含关隘小节作为删除终点');
  writeFileSync(p, src.slice(0, i) + src.slice(j), 'utf8');
}

test('正样本 C（构建链）：占位符 map 覆盖契约里的全部地形词（防成品残留 {{...}}）', () => {
  // ⚠️ 规则书写的是 `{{rift}}` 这类占位符；若 `renderNarration` 的 map 里没有 rift，
  //   成品规则书会**字面印出 `{{rift}}`** —— 玩家看到乱码，而所有门禁都是绿的。
  const src = readFileSync(resolve(ROOT, 'build', 'build-print.ts'), 'utf8');
  for (const c of TERRAIN_CONTRACT) {
    assert.match(src, new RegExp('\\b' + c.term + ':'), `占位符 map 缺少 ${c.term}（成品会残留 {{${c.term}}}）`);
  }
  assert.match(src, /\bplain:/, '占位符 map 缺少 plain（地形表用到 {{plain}}）');
});

test('正样本 D（渲染链）：叙述渲染支持三级小节 / 表格 / 行内粗体（成品不得字面印出 Markdown）', () => {
  // ⚠️ 原实现只认 `#` / `##` ⇒ 成品里字面印出 `### 福地`、`| 福地 | ... |`、`**加粗**`。
  const md = [
    '### {{boon}}',
    '',
    '**加粗**与表格：',
    '',
    '| 格位 | 效果 |',
    '|---|---|',
    '| {{plain}} | 无 |',
  ].join('\n');
  const html = narrationHtml(md);
  assert.match(html, /<h4 class="ch">/, '三级小节应渲染为 h4');
  assert.match(html, /<strong>加粗<\/strong>/, '行内粗体应渲染为 strong');
  assert.match(html, /<table class="grid compact">/, '表格应渲染为 table');
  assert.doesNotMatch(html, /\|---/, '表格分隔行不应出现在输出里');
  assert.doesNotMatch(html, /###/, '输出不应残留 Markdown 标记 ###');
});

test('防复活（B17 裁定）：规格 §3.4 险径行与规则书都不得再出现「失去本回合剩余行动」', () => {
  const s = spec();
  const i = s.indexOf('### 3.4 地形');
  const j = s.indexOf('### 3.5', i);
  assert.ok(i >= 0 && j > i, '规格应含 §3.4 地形段');
  const row = s.slice(i, j).split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.includes('险径'));
  assert.ok(row !== undefined, '§3.4 应有险径行');
  assert.doesNotMatch(row, /失去本回合剩余行动/, 'B17 已裁定删除该子句，规格不得回填');
  assert.doesNotMatch(narration(), /失去本回合剩余行动/, '规则书不得保留已删除的子句');
});

test('裂隙判定口径（B18-b 更正）：小节与地形总表口径一致（都必须是「后来者」）', () => {
  // ⚠️ 只改小节不改总表 ⇒ 规则书**内部自相矛盾**（实测踩过），故两处都要钉。
  const n = narration();
  const row = n.split(/\r?\n/).find((l) => l.trim().startsWith('|') && l.includes('{{rift}}'));
  assert.ok(row !== undefined, '地形总表应有裂隙行');
  assert.match(row, /后来者/, '地形总表的裂隙口径必须是「后来者」：' + row);
  assert.doesNotMatch(row, /持有者经过时需判定/, '总表不得残留旧口径');
});

test('裂隙判定口径（B18-b 更正）：后来者经过才判定，放置者当次不受影响', () => {
  assert.match(narration(), /后来者.*经过该格都需判定/, '规则书应写明后来者经过需判定');
  assert.match(narration(), /放置者当次不受影响/, '规则书应写明放置者当次不受影响');
  assert.doesNotMatch(narration(), /包括放置封路印的人本人/, '不得残留 B17 的旧口径');
});

test('正样本（函数级）：当前规则书覆盖规格 §3.4 全部地形', () => {
  const r = checkRulesBookTerrain(spec(), narration());
  assert.equal(r.ok, true, 'C10 应通过：' + r.detail);
});

test('负样本 A（函数级）：规则书缺少某类地形小节 ⇒ C10 判红', () => {
  const src = narration();
  const i = src.indexOf('### {{rift}}');
  const j = src.indexOf('### {{gate}}', i);
  const broken = src.slice(0, i) + src.slice(j);
  const r = checkRulesBookTerrain(spec(), broken);
  assert.equal(r.ok, false, '删掉裂隙小节后 C10 必须判红');
  assert.match(r.detail, /裂隙小节|缺少小节/, '应报出缺少小节：' + r.detail);
});

test('负样本 B（函数级）：地形小节在但缺少关键规则要点 ⇒ C10 判红', () => {
  // ⚠️ 必须 replaceAll：「停 1 回合」在规则书里出现两次（表格行 + 小节行）——
  //   只替换第一处时，小节里的要点仍在 ⇒ C10 仍绿（负样本静默失效）。
  const broken = narration().replaceAll('失败则停 1 回合', '失败则很惨');
  assert.notEqual(broken, narration(), '负样本：应能替换掉「停 1 回合」要点');
  const r = checkRulesBookTerrain(spec(), broken);
  assert.equal(r.ok, false, '缺要点后 C10 必须判红');
  assert.match(r.detail, /停 1 回合/, '应报出缺失的要点：' + r.detail);
});

test('负样本 C（函数级）：规格新增地形而契约未登记 ⇒ C10 判红', () => {
  const broken = spec().replace('| 峰顶 | 进入待认证区，见 §5 |', '| 沼泽 | 泥泞难行 |\n| 峰顶 | 进入待认证区，见 §5 |');
  assert.notEqual(broken, spec(), '负样本：应能在规格地形表里插入新地形');
  const r = checkRulesBookTerrain(broken, narration());
  assert.equal(r.ok, false, '规格新增地形未登记契约时 C10 必须判红');
  assert.match(r.detail, /沼泽/, '应报出未登记的地形：' + r.detail);
});

test('负样本 D（隔离副本 · 进程级）：真门禁 doc-sync 必红', () => {
  const dir = makeCopy();
  try {
    assert.equal(existsSync(resolve(dir, NARRATION_REL)), true, '副本应含规则书叙述');
    breakRiftSection(dir);
    const r = runDocSync(dir);
    assert.notEqual(r.status, 0, '破坏规则书后门 ③ 必须判红');
    assert.match(r.out, /C10/, '应报出 C10 判红：' + r.out.slice(-400));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('正样本 B（隔离副本 · 进程级）：未破坏时真门禁必绿', () => {
  const dir = makeCopy();
  try {
    const r = runDocSync(dir);
    assert.equal(r.status, 0, '未破坏时门 ③ 必须绿：' + r.out.slice(-400));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
