// B78：日志展开指令文案的两端判据 —— 有 diceRoll 才展开、展开用**本主题**词表。
//
// 为什么渲染层展开而不是引擎拼好：
//   引擎只报机制事实（规格 §1.5 P1），主题词归渲染层；结构化指针用既有的
//   `LogEntry.diceRoll`（state.ts:131，两处 ask 日志早在写），不新增字段。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { logLineText } from '../../web/ui/log.ts';
import type { LogEntry } from '../../engine/core/state.ts';
import type { ThemePack, ThemeTerms } from '../../engine/types/theme.ts';

const terms = (id: string): ThemeTerms =>
  (JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack).terms as ThemeTerms;

const ask: LogEntry = { round: 2, turnIndex: 3, actor: 1, kind: 'ask', message: '问天：掷出 2，执行第 2 条指令', diceRoll: 2 };

test('同一面在四套主题下展开成各自的资源词（引擎不再持有主题词）', () => {
  assert.match(logLineText(ask, terms('xianxia2026')), /—— 灵枢 \+1$/);
  assert.match(logLineText(ask, terms('scifi-ai')), /—— 算力 \+1$/);
  assert.match(logLineText(ask, terms('urban-psych')), /—— 异能点 \+1$/);
  assert.match(logLineText(ask, terms('hybrid')), /—— 灵能 \+1$/);
});

test('无 terms / 非 ask / 缺 diceRoll ⇒ 一律退回兜底句（零抛错路径）', () => {
  assert.equal(logLineText(ask), 'R2·T3 座1 ' + ask.message);
  assert.equal(logLineText({ ...ask, kind: 'move' }, terms('scifi-ai')), 'R2·T3 座1 ' + ask.message);
  const noRoll: LogEntry = { round: 1, turnIndex: 0, actor: 0, kind: 'ask', message: 'm' };
  assert.equal(logLineText(noRoll, terms('hybrid')), 'R1·T0 座0 m');
});

test('链式问天（face 14 再掷）也只按 diceRoll 展开，不解析文本', () => {
  const chained: LogEntry = { round: 5, turnIndex: 2, actor: 0, kind: 'ask', message: '链式问天：掷出 18，执行第 18 条指令', diceRoll: 18 };
  assert.match(logLineText(chained, terms('urban-psych')), /—— 获得 1 枚异能点（不超上限）$/);
});
