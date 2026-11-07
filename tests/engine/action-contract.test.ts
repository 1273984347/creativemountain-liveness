// tests/engine/action-contract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 契约表的 13 项（真值取自源码文本，与门 ③ 的 unionMembers 同法）。 */
const MEMBERS = ['MOVE', 'PLAY_CARD', 'ABILITY', 'ROLL_WHEEL', 'COMPARE', 'PASS', 'VOTE',
  'CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'CERTIFY_ANSWER'];

test('§6.3 ActionType = 契约表 13 项（复议票入枚举、孤儿 CERTIFY_VALIDATE_QUESTION 移除）', () => {
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  assert.deepEqual(found.slice().sort(), MEMBERS.slice().sort());
});

test('§6.3 CERTIFY_ANSWER 字段贴合唯一真实入口 certifyAnswer(state,actor,target,passed)', () => {
  // 锚定联合成员写法，避免命中原 ActionType 枚举里同名的首处出现
  const line = /readonly type: 'CERTIFY_ANSWER';[^}]*}/.exec(readFileSync('engine/core/action.ts', 'utf8'))?.[0] ?? '';
  assert.match(line, /readonly target: number/);
  assert.match(line, /readonly passed: boolean/);
  assert.doesNotMatch(line, /questionIndex/);
});

test('§7 legal.ts 不再枚举无调用方的 CERTIFY_VALIDATE_QUESTION', () => {
  assert.doesNotMatch(readFileSync('engine/core/legal.ts', 'utf8'), /CERTIFY_VALIDATE_QUESTION/);
});
