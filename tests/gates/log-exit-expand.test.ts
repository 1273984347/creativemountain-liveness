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
