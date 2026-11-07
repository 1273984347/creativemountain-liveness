// doc-sync 门禁入口（薄壳）。
//
// 用法：`node tools/doc-sync.mjs`
// 退出码：0 = 文档口径与代码真值一致；1 = 有漂移。
//
// 逻辑在 doc-sync-lib.mjs（本文件只负责装配与报告，便于被测试直接 import）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  readSpec, unionMembers, checkFieldNames, checkScaleValues, checkOps,
  checkPredicates, checkGoals, checkExemptSyntax, checkDuplicateRows,
} from './doc-sync-lib.mjs';

const THEME_SRC = readFileSync(resolve('engine/types/theme.ts'), 'utf8');
const OP_NAMES = unionMembers(THEME_SRC, 'OpName');
const PREDICATE_NAMES = unionMembers(THEME_SRC, 'PredicateName');
const GOAL_KINDS = unionMembers(THEME_SRC, 'GoalKind');
const NON_OPS = new Set([...PREDICATE_NAMES, ...GOAL_KINDS]);

const spec = readSpec();

const checks = [
  checkFieldNames(spec),
  checkScaleValues(spec),
  checkOps(spec, OP_NAMES, NON_OPS),
  checkPredicates(spec, PREDICATE_NAMES),
  checkGoals(spec, GOAL_KINDS),
  checkExemptSyntax(spec),
  checkDuplicateRows(spec),
];

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  ${c.title}`);
  if (!c.ok) {
    console.log(`      ${c.detail}`);
  }
}
console.log('');
console.log(`doc-sync: ${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length > 0) {
  console.log(`FAIL：${failed.length} 项口径漂移必须修复（代码是源，文档是派生物）`);
  process.exit(1);
}
console.log('PASS：文档口径与代码真值一致');
