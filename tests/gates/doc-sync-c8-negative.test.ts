// C8 覆盖边界**逐条对应**的负样本（B52）。
//
// 本批把 C8 由「条数一致」升级为「逐条对应」⇒ 必须证明它**会红**：
//   只跑「正例通过」时，一个恒绿的断言和一个真正生效的断言**长得一模一样**（E87）。
//
// ⚠️ **测的是生产实现本身**（`checkCoverageBoundaries` 直接 import 自 `doc-sync-lib.mjs`）
//   ⇒ 不是复刻一份近似实现来测（测错对象 = 等于没测，E92）。
//
// ⚠️ **共享工作树全程只读**：篡改只发生在**内存里的规格字符串**上，
//   不写任何仓库文件 ⇒ 不会与并行跑的其它测试互相污染（B17 教训）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkCoverageBoundaries } from '../../tools/doc-sync-lib.mjs';
import type { DocSyncCheck } from '../../tools/doc-sync-lib.mjs';
import {
  COVERAGE_BOUNDARIES,
  parseSpecCoverageRows,
} from '../../tools/coverage-boundaries.mjs';

const SPEC_PATH = resolve('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md');

/** 真实规格全文（正样本基准）。 */
const REAL_SPEC = readFileSync(SPEC_PATH, 'utf8');

/** 机器清单的 id 序列（C8 的比对对象）。 */
const CODE_IDS = COVERAGE_BOUNDARIES.map((b) => b.id);

/** 跑一次 C8（用生产实现）。 */
function check(spec: string): DocSyncCheck {
  return checkCoverageBoundaries(spec, CODE_IDS);
}

/**
 * 把覆盖边界表里第 n 条数据行的 id 换成别的值（n 从 1 开始）。
 *
 * ⚠️ **按「连续表格块」定位，不按空行 break**：
 *   小节起点行是「门禁覆盖边界」标题行（非表格行），其下先空行、再引用说明段、
 *   再空行，最后才是表 ⇒ 「遇空行即停」会在表格出现**之前**就退出。
 *   ⇒ 改为：扫出连续的表格行块，再在其中数数据行。
 *
 * ⚠️ **不能从文件开头数表格行**：规格里 §6.4 的 ops 表首列同样带反引号
 *   （`\`gain_resource\`` 等）⇒ 会数到 ops 表的行、改错对象。
 */
function replaceId(spec: string, index: number, newId: string): string {
  const lines = spec.split('\n');
  // ① 找到覆盖边界小节起点行（marker 落在某行内部 ⇒ 取含它的那一行）
  const markerIdx = spec.indexOf('门禁覆盖边界');
  if (markerIdx < 0) {
    throw new Error('规格缺「门禁覆盖边界」小节');
  }
  let offset = 0;
  let startLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    if (offset + line.length >= markerIdx) {
      startLine = i;
      break;
    }
    offset += line.length + 1;
  }
  // ② 从起点行往后找**第一个表格块**（连续以 | 开头的行）
  let tableStart = -1;
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined && line.trim().startsWith('|')) {
      tableStart = i;
      break;
    }
  }
  if (tableStart < 0) {
    throw new Error('未找到覆盖边界表');
  }
  let tableEnd = tableStart;
  while (tableEnd < lines.length) {
    const line = lines[tableEnd];
    if (line === undefined || !line.trim().startsWith('|')) {
      break;
    }
    tableEnd += 1;
  }
  // ③ 在表格块里数数据行（首列是反引号包裹的 id）
  let seen = -1;
  for (let i = tableStart; i < tableEnd; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const first = line.trim().split('|')[1]?.trim() ?? '';
    if (!first.startsWith('`')) {
      continue;
    }
    seen += 1;
    if (seen === index) {
      const replaced = line.replace(first, `\`${newId}\``);
      return lines.slice(0, i).concat([replaced], lines.slice(i + 1)).join('\n');
    }
  }
  throw new Error(`未找到覆盖边界表第 ${index + 1} 条数据行`);
}
// ---------- 正样本 ----------

test('C8 正样本：真实规格与机器清单逐条对应 ⇒ 必绿', () => {
  const r = check(REAL_SPEC);
  assert.equal(r.ok, true, `真实规格必须判绿：${r.detail}`);
});

// ---------- 负样本 1：id 错位（条数不变）----------
//
// ⚠️ 这是**旧口径漏检的那一类**：把两条边界的 id 互换 ⇒ 条数仍是 12 ⇒
//   旧的「条数一致」检查照样绿灯 ⇒ 新口径必须判红。
test('C8 负样本：两条边界 id 互换（条数不变）⇒ 必须判红', () => {
  const swapped = replaceId(REAL_SPEC, 0, 'pdf-raw-bytes');
  const r = check(swapped);
  assert.equal(r.ok, false, 'id 错位时 C8 必须判红（旧口径只比条数会漏检）');
  // ⚠️ 断言要**指名错位判定**（不是泛泛提到 id）——否则「因别的原因红」也会通过。
  assert.match(r.detail, /错位/, '必须报「错位」而不是别的失败原因');
  assert.match(r.detail, /第 \d+ 条/, '必须点名是第几条错位');
  assert.match(r.detail, /pdf-raw-bytes/, '必须点名机器清单该位置的 id');
});

// ---------- 负样本 2：机器清单有、规格表未登记 ----------
test('C8 负样本：规格表少登记一条 ⇒ 必须判红并点名', () => {
  const r = check(replaceId(REAL_SPEC, 3, 'not-registered-boundary'));
  assert.equal(r.ok, false, '规格表少一条时 C8 必须判红');
  assert.match(r.detail, /not-registered-boundary/, '报错必须点名未登记的 id');
});

// ---------- 负样本 2b：顺序层必须**可达**（回归锁）----------
//
// ⚠️ **本批自查抓到的确凿缺陷**：判据原本按「唯一层 → 集合层 → 顺序层」排列，
//   而两条 id 互换时，集合层先报「未登记」、唯一层先报「重复」⇒
//   **顺序层根本没有触发机会（永远不可达）** ⇒ 「第 N 条错位」这条最具体的
//   定位信息从不出现。⇒ 现在顺序层最先判，并用本例钉住它**确实可达**。
test('C8 负样本：id 互换必须报「第 N 条错位」（顺序层可达的回归锁）', () => {
  const swapped = replaceId(REAL_SPEC, 0, 'pdf-raw-bytes');
  const r = check(swapped);
  assert.equal(r.ok, false, 'id 互换必须判红');
  assert.match(r.detail, /第 1 条错位/, '必须报「第 1 条错位」⇒ 顺序层确实被触发');
});

// ---------- 负样本 2c：CRLF 检出必须判绿（行尾稳健性回归锁）----------
//
// ⚠️ **本批自查 + 独立盲审共同抓到**：仓库 `core.autocrlf=true` 且**无 `.gitattributes`**
//   ⇒ 全新克隆后规格文件是 **CRLF** ⇒ 若解析用 `spec.indexOf('\n\n**')` 界定小节，
//   CRLF 下匹配不到 ⇒ 兜底吃进**后续章节的表格行**（实测 12 条 → **140 条**）
//   ⇒ C8 误报「规格表有但机器清单没有」⇒ **门禁假红**。
//   ⇒ 现在解析改为**纯行级**定位（取第一个连续表格块）⇒ 与换行符无关。
//   本例把规格转成 CRLF ⇒ 结果必须与 LF **完全一致**（仍是 12 条、仍判绿）。
test('C8：规格为 CRLF 行尾时解析结果必须与 LF 一致（行尾稳健性回归锁）', () => {
  const crlf = REAL_SPEC.replace(/\r?\n/g, '\r\n');
  const parsed = parseSpecCoverageRows(crlf);
  assert.equal(parsed.ids.length, 12, 'CRLF 下必须仍解析出 12 条（不得吃进后续章节的表格行）');
  assert.deepEqual(parsed.ids, CODE_IDS, 'CRLF 下的 id 序列必须与 LF 完全一致');
  const r = check(crlf);
  assert.equal(r.ok, true, `CRLF 下 C8 必须判绿：${r.detail}`);
});

// ---------- 负样本 2d：集合层必须**可达**（回归锁，盲审 F2/M7）----------
//
// ⚠️ **盲审变异测试（M7：删掉集合层）两套测试全绿** ⇒ 集合层的**专属措辞**
//   「规格表有但机器清单没有 / 机器清单有但规格表未登记」当时**没有独立回归锁**
//   （只被顺序层顺带覆盖 ⇒ 删掉集合层仍能通过）⇒ 本例单独钉住集合层。
//   场景：把某条 id 改成机器清单里**没有**的名字（既错位、又多出一条）。
test('C8 负样本：集合层必须报「未登记/没有」（集合层可达的回归锁）', () => {
  const broken = replaceId(REAL_SPEC, 2, 'ghost-boundary-not-in-code');
  const r = check(broken);
  assert.equal(r.ok, false, '未知 id 必须判红');
  assert.match(r.detail, /规格表有但机器清单没有/, '集合层必须报「规格表有但机器清单没有」');
  assert.match(r.detail, /机器清单有但规格表未登记/, '集合层必须报「机器清单有但规格表未登记」');
});
// ---------- 负样本 3：规格表多登记一条 ----------
test('C8 负样本：规格表多出一条机器清单没有的 id ⇒ 必须判红并点名', () => {
  const marker = '| `scan-binary-and-large` |';
  const extra = marker + '\n| `extra-boundary` | 多余的边界 | 多余的边界 |';
  const r = check(REAL_SPEC.replace(marker, extra));
  assert.equal(r.ok, false, '规格表多一条时 C8 必须判红');
  assert.match(r.detail, /extra-boundary/, '报错必须点名多余的 id');
});

// ---------- 负样本 4：漏掉 id 列（表结构漂移）----------
test('C8 负样本：覆盖边界表漏掉 id 列 ⇒ 必须判红（结构层）', () => {
  const noId = REAL_SPEC
    .replace('| id | 覆盖 | 不覆盖 |', '| 覆盖 | 不覆盖 |')
    .replace('|---|---|---|\n| `pdf-text-layer` |', '|---|---|\n| `pdf-text-layer` |');
  const r = check(noId);
  assert.equal(r.ok, false, '缺少 id 列时 C8 必须判红');
  // ⚠️ 不能只断言 /id/（任何报错都含该字样 ⇒ 恒真）。
  assert.match(r.detail, /首列必须是 id/, '必须报「首列必须是 id」这一结构层失败');
  assert.doesNotMatch(r.detail, /未登记|没有/, '结构层失败不得被误报成登记问题');
});

// ---------- 负样本 5：重复 id ----------
test('C8 负样本：两条边界共用同一 id ⇒ 必须判红（重复会掩盖少一条/多一条）', () => {
  const dup = replaceId(REAL_SPEC, 1, 'pdf-text-layer');
  const r = check(dup);
  assert.equal(r.ok, false, '重复 id 时 C8 必须判红');
  assert.match(r.detail, /重复/, '报错必须点名「重复 id」');
});

// ---------- 负样本 6：缺 id 列 ⇒ 解析层不得静默取错列 ----------
//
// ⚠️ 结构层与内容层**分开**：若解析层在缺列时静默取「覆盖」列当 id，
//   报错会指向错误的原因（说「某 id 没登记」而不是「表缺 id 列」）。
test('C8 负样本：缺 id 列时必须报「缺列」而不是「某 id 未登记」', () => {
  const noId = REAL_SPEC
    .replace('| id | 覆盖 | 不覆盖 |', '| 覆盖 | 不覆盖 |')
    .replace('|---|---|---|\n| `pdf-text-layer` |', '|---|---|\n| `pdf-text-layer` |');
  const r = check(noId);
  assert.equal(r.ok, false);
  assert.doesNotMatch(
    r.detail,
    /机器清单有但规格表未登记/,
    '缺列必须由结构层报错，不能被误报成「某 id 未登记」',
  );
});

// ---------- 负样本 7：规格缺整个小节 ----------
test('C8 负样本：规格缺「门禁覆盖边界」小节 ⇒ 必须判红', () => {
  const stripped = REAL_SPEC.replace('门禁覆盖边界（如实登记，防「绿灯掩盖盲区」）', '（已删除该小节）');
  const r = check(stripped);
  assert.equal(r.ok, false, '缺少小节时 C8 必须判红');
});
