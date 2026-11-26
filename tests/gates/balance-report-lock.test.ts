// B94 · 平衡报告**入库一致性**门（门 ⑮）的常驻负样本。
//
// ⚠️ 为什么需要它：门 ⑮ 是**新增**检查项 ⇒ 必须配「违例必红、恢复必绿」的常驻样本
//   （规格 §9.3 ⑥ /《负样本自证范式》）。否则「制造漂移 ⇒ 门禁必红」只是验收清单里的一句话，
//   门禁交付后没人会再验。
//
// ⚠️ **测的是被测实现本身**（tools/balance-report-lock.mjs 导出的纯函数），
//   **不是**另写一份近似复刻 —— 仓内纪律（先例：tests/gates/board-parity.test.ts）。
//
// ⚠️ **共享工作树全程只读**：本文件**不写** docs/balance-report.md、不改任何仓内文件，
//   全部用**内存里的文本**构造漂移 ⇒ 不会与并行测试互相污染（范式「核心难点」条）。
//
// ⚠️ **为什么用小样本而不是真跑 24000 局**：门 ⑮ 的判据是**逐字节比对**，
//   漂移的**本质**是「两份文本不一致」⇒ 用**构造出来的**两份文本即可完整覆盖判据；
//   真跑 24000 局的成本（分钟级）留给门 ⑮ 自己（真跑一次），
//   而**端到端的接线有效性**由本文件末尾的「门 ⑮ 确实跑通」断言覆盖。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { checkBalanceReport, diffReportLines, expectedSampleScope, parseActualTotalGames, toLf } from '../../tools/balance-report-lock.mjs';
import { SCALES } from '../../engine/scales.ts';
import { readdirSync, existsSync } from 'node:fs';

const ROOT = process.cwd();

/** 入库版报告全文（**只读**）。 */
const REPORT_TEXT = readFileSync(resolve(ROOT, 'docs', 'balance-report.md'), 'utf8');

// ---------- 正样本 ----------

test('正样本：两份完全相同的报告 ⇒ 零差异', () => {
  const r = checkBalanceReport(REPORT_TEXT, REPORT_TEXT);
  assert.equal(r.ok, true, '同一份文本必须判为一致，实际差异：' + JSON.stringify(r.diffs));
  assert.deepEqual(r.diffs, []);
});

test('正样本：仅行尾不同（CRLF vs LF）⇒ 判为一致（环境歧义不该报红）', () => {
  const crlf = REPORT_TEXT.replace(/\n/g, '\r\n');
  const r = checkBalanceReport(REPORT_TEXT, crlf);
  assert.equal(r.ok, true, '行尾差异必须被归一化掉，实际差异：' + JSON.stringify(r.diffs));
});

test('正样本：读取的是入库的真实报告（非空、非占位）', () => {
  assert.ok(REPORT_TEXT.length > 0, '入库报告不能是空文件');
  assert.ok(REPORT_TEXT.includes('# 平衡报告'), '入库报告缺少标题行（判据对象本身不对？）');
});

// ---------- 负样本 A：数值漂移（最典型的「报告过期」）----------

test('负样本 A：改掉总览里的一个读数 ⇒ 判红并点名行号与两侧内容', () => {
  const drifted = REPORT_TEXT.replace('| 总局数 | 24000 |', '| 总局数 | 24001 |');
  assert.notEqual(drifted, REPORT_TEXT, '注入必须真的改到内容（否则本样本是空跑）');
  const r = checkBalanceReport(REPORT_TEXT, drifted);
  assert.equal(r.ok, false, '读数漂移必须判红');
  assert.equal(r.diffs.length, 1, '应恰好一处差异，实际：' + JSON.stringify(r.diffs));
  const first = r.diffs[0];
  assert.ok(first !== undefined, '差异行必须存在（长度已断言为 1）');
  assert.ok(
    first.includes('总局数 | 24000') && first.includes('总局数 | 24001'),
    '报错必须点名期望值与实测值，实际：' + first,
  );
  assert.ok(/^第 \d+ 行｜/.test(first), '报错必须带行号，实际：' + first);
});

// ---------- 负样本 B：文案漂移（标签改了、报告没重生成）----------

test('负样本 B：改一行标题文案 ⇒ 判红（容差 0 ⇒ 文案漂移也不放过）', () => {
  const drifted = REPORT_TEXT.replace('# 平衡报告（自动生成）', '# 平衡报告（手工整理）');
  assert.notEqual(drifted, REPORT_TEXT, '注入必须真的改到内容');
  const r = checkBalanceReport(REPORT_TEXT, drifted);
  assert.equal(r.ok, false, '文案漂移必须判红');
  assert.ok(r.diffs.length >= 1, '至少一处差异');
});

// ---------- 负样本 C：末尾缺行（报告被截断）----------

test('负样本 C：报告末尾被截断 ⇒ 判红并点名缺失行', () => {
  const lines = REPORT_TEXT.split('\n');
  const truncated = lines.slice(0, lines.length - 3).join('\n');
  const r = checkBalanceReport(REPORT_TEXT, truncated);
  assert.equal(r.ok, false, '截断必须判红');
  assert.ok(
    r.diffs.some((d) => d.includes('（无）')),
    '截断必须点名「实测：（无）」，实际：' + JSON.stringify(r.diffs),
  );
});

// ---------- 负样本 D：多出一行（报告被追加了手抄内容）----------

test('负样本 D：报告末尾多出一行 ⇒ 判红', () => {
  const extra = REPORT_TEXT + '\n手抄读数：位次极差 4.2pp\n';
  const r = checkBalanceReport(REPORT_TEXT, extra);
  assert.equal(r.ok, false, '多出一行必须判红');
});

// ---------- 恢复验证 ----------

test('恢复验证：漂移文本改回入库版 ⇒ 必绿（违例必红、恢复必绿）', () => {
  const drifted = REPORT_TEXT.replace('| 总局数 | 24000 |', '| 总局数 | 24001 |');
  assert.equal(checkBalanceReport(REPORT_TEXT, drifted).ok, false, '注入态必须红');
  const restored = drifted.replace('| 总局数 | 24001 |', '| 总局数 | 24000 |');
  assert.equal(restored, REPORT_TEXT, '恢复必须按原字节写回');
  assert.equal(checkBalanceReport(REPORT_TEXT, restored).ok, true, '恢复后必须绿');
});

// ---------- 负样本 E：模拟口径被缩小（改默认参数 + 重生成 ⇒ 逐字节仍相等）----------

/** 权威期望口径：从**规格 §9.2** 派生（独立于被比对的两侧 ⇒ 才防得住「缩样本」）。 */
const SPEC_TEXT = readFileSync(resolve(ROOT, 'docs', 'superpowers', 'specs', '2026-11-07-creative-mountain-liveness-design.md'), 'utf8');
const THEME_COUNT = readdirSync(resolve(ROOT, 'themes'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(resolve(ROOT, 'themes', e.name, 'theme.json')))
  .length;
const EXPECTED_SCOPE = expectedSampleScope(SPEC_TEXT, THEME_COUNT, SCALES.length);

test('负样本 E：模拟口径不一致（每档局数被改小）⇒ 判红（防「样本被静默缩小」）', () => {
  const shrunk = REPORT_TEXT.replace('| 每档局数 | 1000 |', '| 每档局数 | 100 |')
    .replace('| 总局数 | 24000 |', '| 总局数 | 2400 |');
  assert.notEqual(shrunk, REPORT_TEXT, '注入必须真的改到内容');
  const r = checkBalanceReport(REPORT_TEXT, shrunk, EXPECTED_SCOPE);
  assert.equal(r.ok, false, '口径不一致必须判红');
  assert.ok(r.scopeIssues.length > 0, '必须点名口径不一致');
  assert.ok(
    r.scopeIssues[0] !== undefined && r.scopeIssues[0].includes('权威期望'),
    '报错必须点名「权威期望」，实际：' + JSON.stringify(r.scopeIssues),
  );
});

test('负样本 E 关键：**两侧口径相同但都偏离权威期望 ⇒ 仍须判红**（防同义反复）', () => {
  // ⚠️ 这是「改了 sim 默认参数并重生成入库报告」的情形：
  //   入库版与重跑版**口径完全一致** ⇒ 两侧互比**恒绿** ⇒ 只有独立锚点才抓得到。
  const shrunk = REPORT_TEXT.replace('| 每档局数 | 1000 |', '| 每档局数 | 100 |')
    .replace('| 总局数 | 24000 |', '| 总局数 | 2400 |');
  const withAuthority = checkBalanceReport(shrunk, shrunk, EXPECTED_SCOPE);
  assert.equal(withAuthority.ok, false, '有权威期望时必须判红（否则口径检查是同义反复）');
  assert.ok(withAuthority.scopeIssues.length > 0, '必须点名口径偏离');
  // 对照：**不传**权威期望 ⇒ 两侧互比 ⇒ 抓不到（这正是必须传权威期望的理由）。
  const withoutAuthority = checkBalanceReport(shrunk, shrunk);
  assert.equal(withoutAuthority.ok, true, '不传权威期望时两侧互比恒绿（记录该事实：它防不住缩样本）');
});

test('权威期望本身派生正确（每档 1000 局 / 合计 24000 局）', () => {
  assert.equal(EXPECTED_SCOPE.gamesPerCell, 1000, '每档局数须来自规格 §9.2');
  assert.equal(EXPECTED_SCOPE.totalGames, 24000, '总局数须来自规格 §9.2');
  assert.equal(THEME_COUNT, 4, '主题数须由实际主题包派生');
  assert.equal(SCALES.length, 6, '人数档数须由 engine/scales.ts 派生');
});

test('负样本 E 补充：口径一致时 scopeIssues 为空', () => {
  const r = checkBalanceReport(REPORT_TEXT, REPORT_TEXT);
  assert.deepEqual(r.scopeIssues, [], '同口径时不得报口径问题');
  assert.equal(r.scopeExpected.gamesPerCell, '1000', '每档局数应从报告总览表派生');
  assert.equal(r.scopeExpected.totalGames, '24000', '总局数应从报告总览表派生');
});

// ---------- 接线断言：门 ⑮ **不得**带任何能关闭「防缩样本」能力的参数 ----------

test('接线断言：门 ⑮ 的 args **不含**自证参数（防将来有人加 flag ⇒ 能力静默失效）', () => {
  const gateSrc = readFileSync(resolve(ROOT, 'tools', 'gate.mjs'), 'utf8');
  // 取出门 ⑮ 那一行（按执行器的文件名定位）。
  const line = gateSrc.split('\n').find((l) => l.includes('balance-report-lock-cli.mjs') && l.includes('args:'));
  assert.ok(line !== undefined, 'tools/gate.mjs 里找不到门 ⑮ 的条目（门被删了？）');
  const l = line ?? '';
  assert.ok(!l.includes('--scope-from-report'), '门 ⑮ 不得传 --scope-from-report（该开关已删除）');
  assert.ok(!l.includes('--games'), '门 ⑮ 不得传 --games（会缩放期望口径 ⇒ 削弱防缩样本能力）');
  assert.ok(!l.includes('--report'), '门 ⑮ 不得传 --report（会换掉比对面）');
});

test('接线断言：CLI **不存在**任何「从被检查对象取期望值」的开关', () => {
  const cliSrc = readFileSync(resolve(ROOT, 'tools', 'balance-report-lock-cli.mjs'), 'utf8');
  assert.ok(!cliSrc.includes('--scope-from-report'), 'CLI 不得再有 --scope-from-report（期望值会取自被检查的一侧 ⇒ 同义反复）');
});

test('实际局数解析：sim stdout 的「合计 N 局」可解析（口径核对的锚点）', () => {
  assert.equal(parseActualTotalGames('主题 4 套 · 人数档 3/4/5/6/7/8 · 每档 1000 局 · 合计 24000 局'), 24000);
  assert.equal(parseActualTotalGames('合计 720 局'), 720);
  assert.equal(parseActualTotalGames('没有局数信息'), null, '解析不到必须返回 null（⇒ 失败关闭，不静默通过）');
});

test('实际局数解析：无法解析时必须判红（失败关闭）', () => {
  // ⚠️ 「失败关闭」比「失败开放」重要：无法核实口径 ⇒ 宁可红，也不能放行。
  assert.equal(parseActualTotalGames(''), null);
});

// ---------- 判据自身的性质（防「断言写错了」）----------

test('判据性质：空报告 vs 非空报告 ⇒ 判红（证明比对面非空、不是恒真）', () => {
  const r = checkBalanceReport('', REPORT_TEXT);
  assert.equal(r.ok, false, '空 vs 非空必须判红');
  assert.ok(r.diffs.length > 0, '必须有差异行');
});

test('判据性质：diffReportLines 对相同输入返回空数组', () => {
  assert.deepEqual(diffReportLines('a\nb', 'a\nb'), []);
});

test('判据性质：toLf 只改行尾、不动其它字节', () => {
  const src = '甲  b \n尾随空格 \n';
  assert.equal(toLf(src), '甲  b \n尾随空格 \n');
  assert.equal(toLf('a\r\nb'), 'a\nb');
});
