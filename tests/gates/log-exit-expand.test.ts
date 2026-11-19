// B79 §4.3：日志出口必须对**全部 kind** 展开占位符（T7）。
//
// 为什么不能按 kind 分支展开（B78 的实现只碰 `ask`）：34 个引擎命中行里只有 8 行直接写
// `message:`，看着好像 note 类文案不进日志——但 `engine/core/gate.ts:350` 是
// `message: \`关隘：${note}——退 1 格并被封口\``，**把返回值的 note 插进了日志**；
// `registry.ts:707` 的「`N 号关隘`」也是 log 行。所以 note 类文案照样从日志出口露出，
// 只给 `ask` 开分支等于给泄漏留门。
//
// 这里注入**假**日志条目而不是跑引擎：本任务只证出口的形状，引擎接线在 T9–T12；
// 等接线完成后的常驻守卫是 R3（T14 跑真局）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { logLineText } from '../../web/ui/log.ts';
import type { LogEntry } from '../../engine/core/state.ts';
import type { ThemeTerms } from '../../engine/types/theme.ts';

const termsOf = (id: string): ThemeTerms =>
  JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')).terms as ThemeTerms;

const entry = (kind: string, message: string, diceRoll?: number): LogEntry =>
  diceRoll === undefined ? { kind, round: 3, turnIndex: 1, actor: 2, message }
    : { kind, round: 3, turnIndex: 1, actor: 2, message, diceRoll };

test('B79：gate 类日志的占位符也展开（此前只有 ask 会碰文案）', () => {
  const got = logLineText(entry('gate', '{gate}：支付 3 {resource}通过{gate}'), termsOf('scifi-ai'));
  assert.equal(got, 'R3·T1 座2 安全闸：支付 3 算力通过安全闸');
});

test('B79：trial / council / status 等非 ask 的 kind 一样展开（漏一个 kind 就是留一扇门）', () => {
  const terms = termsOf('urban-psych');
  const cases: readonly [string, string, string][] = [
    ['trial', '{gate}试炼：验心——未通过，本关改为付费', '封锁线试炼：验心——未通过，本关改为付费'],
    ['council', '山议裁定：座位 1 扣 2 {resource}（3 人局不淘汰）', '山议裁定：座位 1 扣 2 异能点（3 人局不淘汰）'],
    ['gain_resource', '{resource} +1', '异能点 +1'],
    ['peak', '登顶{peak}：回到{path}起点', '登顶天台：回到街区起点'],
  ];
  for (const [kind, raw, want] of cases) {
    assert.equal(logLineText(entry(kind, raw), terms), 'R3·T1 座2 ' + want, `kind=${kind} 未展开`);
  }
});

test('B79：无占位符的旧文本原样透传（展开是恒等变换，不必分支）', () => {
  assert.equal(logLineText(entry('move', '行棋：前进 2 格'), termsOf('hybrid')), 'R3·T1 座2 行棋：前进 2 格');
});

test('B79：ask 仍按结构化 diceRoll 追加指令内容（B78 的行为不回归，且解析的是字段不是文本）', () => {
  const terms = termsOf('scifi-ai');
  const got = logLineText(entry('ask', '问天：掷出 4，执行第 4 条指令', 4), terms);
  assert.equal(got, 'R3·T1 座2 问天：掷出 4，执行第 4 条指令 —— 算力 -1（给自己）');
});

test('B79：terms 缺省时保留占位符原文——这条只证降级形状，常驻守卫是 R3（T14）', () => {
  assert.match(logLineText(entry('gate', '{gate}标价 3')), /\{gate\}/);
});

// ---------- B79 §4.3 其余出口 + §3.4 取词换源（T8）----------
//
// alert 的「参数里直含占位符」由 T13 的 `scanUnexpandedAlerts` 常驻抓（同一个正则住在
// tools/theme-word-scan.mjs，正样本负样本共用——B51 教训）。本文件不另写一份近似实现，
// 否则测的是这份近似实现自己。
import { termExpander } from '../../web/ui/terms.ts';

test('B79：termExpander 绑定主题后，notice 与按钮文案都展开', () => {
  const t = termExpander(termsOf('urban-psych'));
  assert.equal(t('{resource}不足（自恢需 2）'), '异能点不足（自恢需 2）');
  assert.equal(t('自恢（2 {resource}，占本手番）'), '自恢（2 异能点，占本手番）');
  assert.equal(t('无占位符文本'), '无占位符文本');
});

test('B79：notice 的唯一渲染点必须过展开器（它是引擎 note 的主要露出口）', () => {
  const lines = readFileSync('web/main.ts', 'utf8').split('\n')
    .filter((l) => /class:\s*'warn'/.test(l) && /ui\.notice/.test(l));
  assert.equal(lines.length, 1, `notice 渲染点应当恰好一处，实际 ${String(lines.length)} 处：\n${lines.join('\n')}`);
  assert.ok(/\bt\(/.test(lines[0] ?? ''), `notice 未经展开直投：${lines[0] ?? ''}`);
});

test('B79：引擎 note 的四条「前缀 + note」拼接也要过展开器（前缀本身含主题词）', () => {
  const src = readFileSync('web/main.ts', 'utf8');
  const hits = src.split('\n').filter((l) => /ui\.notice = .*r\.note/.test(l));
  assert.ok(hits.length >= 4, `前提：「结算失败：+ note」这类拼接至少 4 处，实际 ${String(hits.length)}`);
  for (const l of hits) {
    assert.ok(/\.notice = t\(/.test(l) || /\{gate\}/.test(l) || !/'[^']*(灵枢|关隘|山道|峰顶|灵力)/.test(l),
      `note 拼接处既有裸主题词又没过展开器：${l.trim()}`);
  }
});

// §3.4 的硬依赖边**已经走完**（门⑤ 五键判等在 T2 落地）⇒ 这条判据现在可以常驻：
// 界面若再回读 `glossary`，就是「同一个 `{resource}` 两个来源」复活，而两表一旦漂，
// 界面上的词与规则书上的词会安静地分成两套。
test('B79 §3.4：web 侧不再从 glossary 取词（glossary 退回印刷层对照表）', () => {
  const files = ['web/main.ts', 'web/ui/hand.ts', 'web/ui/cert.ts', 'web/ui/council.ts', 'web/tutorial.ts'];
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) { return; }
      if (/glossary\s*[.[]/.test(t)) { offenders.push(`${f}:${String(i + 1)} ${t.slice(0, 70)}`); }
    });
  }
  assert.deepEqual(offenders, [], '⇒ 改用 theme.terms（句子层唯一取词，门⑤ 逐叶校验）');
});

// ---------- B80 §2.3：出口的第二类数据源（身份称谓，运行时主体而非静态词表） ----------

test('B80：日志出口串两步——同一条 message 里 {identity:N} 与 {resource} 都展开', () => {
  const got = logLineText(
    entry('passive', '{identity:0} 把盾给了 {identity:7}，花 2 {resource}'),
    termsOf('scifi-ai'),
    (seat) => (seat === 0 ? '守闸人' : seat === 7 ? '塔主' : '座' + String(seat)));
  assert.equal(got, 'R3·T1 座2 守闸人 把盾给了 塔主，花 2 算力');
  assert.equal(/\{/.test(got), false, '⇒ 展开后残留花括号就是漏印给玩家');
});

test('B80：两个解析器都缺省时原文透出（B79 的反证依赖这条，不许顺手加兜底）', () => {
  const raw = '{identity:0} 与 {resource}';
  assert.equal(logLineText(entry('passive', raw)).endsWith(raw), true,
    '⇒ 缺省=不展开，不是"展开成默认词"：第三套兜底词就是从这里长出来的（B79 §3.2）');
});

test('B80：只绑 terms 没接解析器 ⇒ 含 {identity:N} 的句子抛错，纯词表句子照旧工作', () => {
  const t = termExpander(termsOf('hybrid'));
  assert.equal(t('{rift}：已放置封路印（-2 {resource}）'), '崩口：已放置封路印（-2 灵能）');
  assert.throws(() => t('{identity:3} 发言'), /缺身份称谓解析器/,
    '⇒ 接线漏了要当场炸，而不是把花括号印给玩家（与缺叶同一条口径）');
});
