// tests/engine/action-contract.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 契约表的 13 项（真值取自源码文本，与门 ③ 的 unionMembers 同法）。 */
const MEMBERS = ['MOVE', 'PLAY_CARD', 'ABILITY', 'ROLL_WHEEL', 'COMPARE', 'GATE_RESOLVE', 'BARRIER_RESOLVE', 'PASS', 'VOTE',
  'CERTIFY_SIGN', 'CERTIFY_CHALLENGE', 'CERTIFY_ABSTAIN', 'CERTIFY_APPEAL', 'CERTIFY_APPEAL_VOTE', 'CERTIFY_ANSWER', 'CERTIFY_MUTUAL_SIGN'];

test('§6.3 ActionType = 契约表 16 项（复议票入枚举、孤儿 CERTIFY_VALIDATE_QUESTION 移除、B18 关隘与裂隙通道入枚举、B67 双人互验互签入枚举）', () => {
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  assert.deepEqual(found.slice().sort(), MEMBERS.slice().sort());
});

test('§6.3 规格表的 ActionType 成员 == 代码（规格脱节即红）', () => {
  // ⚠️ 此前只有「代码 == 契约表」一条 ⇒ **规格**改了或脱节了**无人报警**。
  //   本条把规格 §6.3 的代码块成员与代码逐条比对 ⇒ 规格与代码再脱节即红。
  // ⚠️ 解析用**行级**定位（切分行后找 §6.3 下的 ts 块）——不用换行符序列，
  //   否则 `core.autocrlf=true` 的克隆里 CRLF 会让匹配失效（E96 同款坑）。
  const spec = readFileSync('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md', 'utf8');
  const lines = spec.split(/\r?\n/);
  const h = lines.findIndex((l) => l.startsWith('### 6.3 '));
  assert.ok(h >= 0, '规格必须含 §6.3 动作模型');
  let tsStart = -1;
  for (let i = h; i < h + 40; i += 1) {
    if ((lines[i] ?? '').trim() === '```ts') { tsStart = i; break; }
  }
  assert.ok(tsStart >= 0, '规格 §6.3 必须含 ts 代码块');
  const specMembers: string[] = [];
  for (let i = tsStart + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '```') { break; }
    const m = /type: '([A-Z_]+)'/.exec(line);
    if (m !== null) { specMembers.push(String(m[1])); }
  }
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const body = /export type ActionType =([\s\S]*?);/.exec(src)?.[1] ?? '';
  const found = [...body.matchAll(/'([A-Z_]+)'/g)].map((m) => String(m[1]));
  assert.deepEqual(specMembers.slice().sort(), found.slice().sort(),
    `规格 §6.3 的 ActionType 成员必须与代码逐条一致（规格 ${specMembers.length} 项 / 代码 ${found.length} 项）`
    + `\n  规格=${JSON.stringify(specMembers)}\n  代码=${JSON.stringify(found)}`);
});
test('§6.3 规格表的**字段形状** == 代码（改字段不改成员名也必须红）', () => {
  // ⚠️ 只比**成员集合**不够：改字段（`questionIndex`↔`target`、`ok`↔`passed`）
  //   而成员名不变 ⇒ 集合相等照样绿 ⇒ 脱节仍无信号。
  //   ⇒ 本条把每个成员的**字段名集合**也逐条比对（两层：成员 + 字段）。
  const spec = readFileSync('docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md', 'utf8');
  const lines = spec.split(/\r?\n/);
  const h = lines.findIndex((l) => l.startsWith('### 6.3 '));
  assert.ok(h >= 0, '规格必须含 §6.3 动作模型');
  let tsStart = -1;
  for (let i = h; i < h + 40; i += 1) {
    if ((lines[i] ?? '').trim() === '```ts') { tsStart = i; break; }
  }
  assert.ok(tsStart >= 0, '规格 §6.3 必须含 ts 代码块');
  const specShape = new Map<string, string>();
  for (let i = tsStart + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '```') { break; }
    const m = /type: '([A-Z_]+)'(.*)/.exec(line);
    if (m === null) { continue; }
    const rest = String(m[2]);
    const fields = [...rest.matchAll(/(\w+)\??:/g)].map((x) => String(x[1]) + (rest.includes(String(x[1]) + '?') ? '?' : ''));
    specShape.set(String(m[1]), fields.slice().sort().join(','));
  }
  const src = readFileSync('engine/core/action.ts', 'utf8');
  const codeShape = new Map<string, string>();
  for (const m of src.matchAll(/type: '([A-Z_]+)'[^}]*?\}/g)) {
    const seg = String(m[0]);
    const body = seg.replace(/type: '[A-Z_]+'/, '');
    const fields = [...body.matchAll(/(\w+)\??:/g)].map((x) => String(x[1]) + (body.includes(String(x[1]) + '?') ? '?' : ''));
    codeShape.set(String(m[1]), fields.slice().sort().join(','));
  }
  const problems: string[] = [];
  for (const [type, codeFields] of codeShape) {
    const specFields = specShape.get(type);
    if (specFields === undefined) {
      problems.push(`${type}：规格 §6.3 缺该成员`);
      continue;
    }
    if (specFields !== codeFields) {
      problems.push(`${type}：规格字段 [${specFields}] vs 代码字段 [${codeFields}]`);
    }
  }
  assert.deepEqual(problems, [], `规格 §6.3 的字段形状必须与代码逐条一致\n  ${problems.join('\n  ')}`);
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
