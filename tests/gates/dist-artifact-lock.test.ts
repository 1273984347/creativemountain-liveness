// B98 · 门 ⑯ · dist 产物**字节基线一致性**的常驻负样本（判据级）。
//
// ⚠️ 为什么需要它：门 ⑯ 是**新增**检查项 ⇒ 必须配「违例必红」的常驻样本
//   （规格 §9.3 ⑥ /《负样本自证范式》）。否则「产物字节变了门禁会红」只是验收清单里的一句话，
//   门禁交付后没人会再验。
//
// ⚠️ **测的是被测实现本身**（tools/dist-artifact-lock.mjs 导出的纯判据），
//   **不是**另写一份近似复刻 —— 仓内纪律（先例：tests/gates/balance-report-lock.test.ts）。
//   ⇒ 本文件**直接 import** `compareArtifacts` / `parseBaseline` / `sha256Hex`，
//     断言它们的行为；不重写一遍比对逻辑。
//
// ⚠️ **共享工作树全程只读**：本文件**不写**任何仓内文件，全部用**内存里的对象/文本**
//   构造漂移 ⇒ 不会与并行测试互相污染（范式「核心难点」条）。
//   真正会构建产物的端到端部分在 dist-artifact-lock-e2e.test.ts（隔离副本里做）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { compareArtifacts, parseBaseline, sha256Hex } from '../../tools/dist-artifact-lock.mjs';

/** 构造一条合法的基线条目（形状与入库基线一致）。 */
function entry(sha256: string, bytes: number): { sha256: string; bytes: number } {
  return { sha256, bytes };
}

/** 一段「合法」的 64 位小写十六进制（用于造形状合法的样本）。 */
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

// ---------- 正样本 ----------

test('正样本：基线与实测逐字节一致 ⇒ 判绿且 issues 为空数组', () => {
  const baseline = { 'a.html': entry(SHA_A, 100), 'b.html': entry(SHA_B, 200) };
  const actual = { 'a.html': entry(SHA_A, 100), 'b.html': entry(SHA_B, 200) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, true, '一致必须判绿，实际 issues：' + JSON.stringify(r.issues));
  assert.deepEqual(r.issues, [], '一致时 issues 必须是空数组');
});

test('正样本：键的书写顺序不同但内容一致 ⇒ 仍判绿（比对不得依赖插入顺序）', () => {
  const baseline = { 'a.html': entry(SHA_A, 100), 'b.html': entry(SHA_B, 200) };
  const actual = { 'b.html': entry(SHA_B, 200), 'a.html': entry(SHA_A, 100) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, true, '顺序不同不得被误判成漂移，实际 issues：' + JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
});

// ---------- 负样本 A：字节漂移（SHA 不同）⇒ 必须点名文件与期望/实测 SHA ----------

test('负样本 A：SHA 不同 ⇒ 判红，且 issues 里点名文件与期望/实测 SHA', () => {
  const baseline = { 'a.html': entry(SHA_A, 100) };
  const actual = { 'a.html': entry(SHA_B, 120) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, false, 'SHA 不同必须判红');
  assert.equal(r.issues.length, 1, '应当只有一条漂移，实际：' + JSON.stringify(r.issues));
  const issue = r.issues[0]!;
  assert.ok(issue.includes('产物字节漂移'), 'issue 必须点名「产物字节漂移」，实际：' + issue);
  assert.ok(issue.includes('a.html'), 'issue 必须点名出问题的文件，实际：' + issue);
  assert.ok(issue.includes(SHA_A), 'issue 必须含**期望** SHA256，实际：' + issue);
  assert.ok(issue.includes(SHA_B), 'issue 必须含**实测** SHA256，实际：' + issue);
});

test('负样本 A 补充：SHA 相同但 bytes 不同 ⇒ 判红（字节数是独立判据）', () => {
  const baseline = { 'a.html': entry(SHA_A, 100) };
  const actual = { 'a.html': entry(SHA_A, 999) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, false, '字节数不同必须判红');
  assert.equal(r.issues.length, 1, '应当只有一条漂移，实际：' + JSON.stringify(r.issues));
  const issue = r.issues[0]!;
  assert.ok(issue.includes('产物字节漂移'), 'issue 必须点名「产物字节漂移」，实际：' + issue);
  assert.ok(issue.includes('a.html'), 'issue 必须点名文件，实际：' + issue);
  assert.ok(issue.includes('100') && issue.includes('999'), 'issue 必须同时含期望/实测字节数，实际：' + issue);
});

// ---------- 负样本 B：集合层（缺失 / 多出）⇒ 必须报「产物集合不一致」 ----------

test('负样本 B：基线有而实测没有（缺失）⇒ 判红且 issues 含「产物集合不一致」', () => {
  const baseline = { 'a.html': entry(SHA_A, 100), 'gone.html': entry(SHA_B, 200) };
  const actual = { 'a.html': entry(SHA_A, 100) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, false, '缺项必须判红');
  assert.ok(
    r.issues.some((i) => i.includes('产物集合不一致')),
    '必须报「产物集合不一致」，实际：' + JSON.stringify(r.issues),
  );
  assert.ok(
    r.issues.some((i) => i.includes('gone.html')),
    '集合层 issue 必须点名缺失的文件，实际：' + JSON.stringify(r.issues),
  );
});

test('负样本 C：实测有而基线没有（多出）⇒ 判红且 issues 含「产物集合不一致」', () => {
  const baseline = { 'a.html': entry(SHA_A, 100) };
  const actual = { 'a.html': entry(SHA_A, 100), 'extra.html': entry(SHA_B, 200) };
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, false, '多出必须判红');
  assert.ok(
    r.issues.some((i) => i.includes('产物集合不一致')),
    '必须报「产物集合不一致」，实际：' + JSON.stringify(r.issues),
  );
  assert.ok(
    r.issues.some((i) => i.includes('extra.html')),
    '集合层 issue 必须点多出的文件，实际：' + JSON.stringify(r.issues),
  );
});

test('负样本 B/C 补充：缺项**不得**被误报成「字节漂移」（集合层先判 ⇒ 报错指向正确原因）', () => {
  // ⚠️ 若先判字节层，缺项会被误报成「字节漂移」⇒ 报错指向错误的原因 ⇒ 排查被带偏。
  const baseline = { 'gone.html': entry(SHA_A, 100) };
  const actual = {};
  const r = compareArtifacts(baseline, actual);
  assert.equal(r.ok, false);
  assert.ok(
    !r.issues.some((i) => i.includes('产物字节漂移')),
    '缺项不得被报成字节漂移（集合层必须先判），实际：' + JSON.stringify(r.issues),
  );
  assert.ok(
    r.issues.some((i) => i.includes('产物集合不一致')),
    '必须报集合不一致，实际：' + JSON.stringify(r.issues),
  );
});

// ---------- parseBaseline：五种失败关闭（形状不合法一律抛错） ----------

test('失败关闭：非法 JSON ⇒ parseBaseline 抛错', () => {
  assert.throws(() => parseBaseline('{ 这不是 JSON'), /基线不是合法 JSON/);
});

test('失败关闭：顶层是数组 ⇒ parseBaseline 抛错', () => {
  assert.throws(() => parseBaseline('[]'), /基线顶层必须是对象/);
});

test('失败关闭：缺 artifacts 字段 ⇒ parseBaseline 抛错', () => {
  assert.throws(() => parseBaseline('{"note":"x"}'), /基线缺 artifacts/);
});

test('失败关闭：sha256 不是 64 位小写十六进制 ⇒ parseBaseline 抛错', () => {
  const bad = JSON.stringify({ artifacts: { 'a.html': { sha256: 'NOT_A_SHA', bytes: 1 } } });
  assert.throws(() => parseBaseline(bad), /sha256/);
  // 大写十六进制同样非法（判据要求**小写**）。
  const upper = JSON.stringify({ artifacts: { 'a.html': { sha256: 'A'.repeat(64), bytes: 1 } } });
  assert.throws(() => parseBaseline(upper), /sha256/);
  // 位数不足同样非法。
  const short = JSON.stringify({ artifacts: { 'a.html': { sha256: 'a'.repeat(63), bytes: 1 } } });
  assert.throws(() => parseBaseline(short), /sha256/);
});

test('失败关闭：bytes 不是非负整数 ⇒ parseBaseline 抛错', () => {
  const neg = JSON.stringify({ artifacts: { 'a.html': { sha256: SHA_A, bytes: -1 } } });
  assert.throws(() => parseBaseline(neg), /bytes/);
  const frac = JSON.stringify({ artifacts: { 'a.html': { sha256: SHA_A, bytes: 1.5 } } });
  assert.throws(() => parseBaseline(frac), /bytes/);
  const str = JSON.stringify({ artifacts: { 'a.html': { sha256: SHA_A, bytes: '10' } } });
  assert.throws(() => parseBaseline(str), /bytes/);
});

test('失败关闭：artifacts 为空 ⇒ parseBaseline 抛错（不得当成「无漂移」）', () => {
  assert.throws(() => parseBaseline('{"artifacts":{}}'), /artifacts 为空/);
});

test('失败关闭：解析不了基线时绝不能「当成空基线放行」（判据自身的性质）', () => {
  // ⚠️ 空基线若被当成「无漂移」⇒ 门禁恒绿 ⇒ 失败关闭比失败开放重要得多。
  assert.throws(() => parseBaseline(''), /基线不是合法 JSON/);
  assert.throws(() => parseBaseline('null'), /基线顶层必须是对象/);
});

test('正样本：形状合法的基线 ⇒ 解析成功且内容原样保留', () => {
  const text = JSON.stringify({ artifacts: { 'a.html': { sha256: SHA_A, bytes: 10 } } });
  const b = parseBaseline(text);
  assert.equal(b.artifacts['a.html']!.sha256, SHA_A);
  assert.equal(b.artifacts['a.html']!.bytes, 10);
});

// ---------- sha256Hex：自身性质 + 与 node:crypto 独立交叉验证 ----------

test('sha256Hex：同一字节两次调用结果相等（确定性）', () => {
  const buf = Buffer.from('创界山·活人认证', 'utf8');
  assert.equal(sha256Hex(buf), sha256Hex(buf), '同一字节两次调用必须相等');
});

test('sha256Hex：与 node:crypto 独立算出的结果一致（交叉验证，非自证）', () => {
  const samples = [
    Buffer.from('', 'utf8'),
    Buffer.from('abc', 'utf8'),
    Buffer.from('创界山·活人认证', 'utf8'),
    Buffer.from([0x00, 0xff, 0x10, 0x7f]),
  ];
  for (const buf of samples) {
    const expected = createHash('sha256').update(buf).digest('hex');
    assert.equal(sha256Hex(buf), expected, '摘要与 node:crypto 不一致：' + buf.toString('hex'));
  }
});

test('sha256Hex：已知值钉死（空输入 = e3b0c442…，防将来有人换算法）', () => {
  assert.equal(
    sha256Hex(Buffer.from('', 'utf8')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '空输入的 SHA256 必须是这个已知值',
  );
  assert.match(sha256Hex(Buffer.from('abc', 'utf8')), /^[0-9a-f]{64}$/, '必须是 64 位小写十六进制');
});
