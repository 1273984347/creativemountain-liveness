// B92 · README「已知限制」段的**手抄读数守卫**。
//
// 起因（实测）：该段有 **5+ 处过期读数** —— 座位极差、位次极差、登顶即胜胜率、
//   B77 六计数器、G-i 的四个达成次数，都停在 B75 / B75.1 / B75.2 那几批重校准之前。
//   根因：**`docs/balance-report.md` 是入库生成物，却不被任何一道门读取**
//   ⇒ 报告重标定后，README 里的手抄数字会**悄悄过期且无人报警**。
//
// 本守卫的判据**不硬编码任何旧值** ⇒ 未来任何新的手抄读数都会被抓住：
//   断言「已知限制」段内**不出现**「数字 + pp / %」形态的读数。
//   数值只由 `docs/balance-report.md` 承载（README 指向它即可）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const README = resolve(ROOT, 'README.md');
const REPORT = resolve(ROOT, 'docs', 'balance-report.md');

/** 取 README 的「已知限制」段（含其下的「动作契约层」小节），到下一个 `## ` 为止。 */
function limitationsSection(src: string): string {
  const start = src.indexOf('## 已知限制（如实登记）');
  assert.ok(start >= 0, 'README 找不到「已知限制」段（判据自身失效？）');
  const rest = src.slice(start);
  const next = rest.indexOf('\n## ');
  return next < 0 ? rest : rest.slice(0, next);
}

test('「已知限制」段不手抄平衡读数（数值只由 balance-report 承载）', () => {
  const section = limitationsSection(readFileSync(README, 'utf8'));
  const hits = [...section.matchAll(/\d+(?:\.\d+)?\s*(?:pp|%)/g)].map((m) => m[0] ?? '');
  assert.deepEqual(
    hits,
    [],
    '已知限制段出现手抄读数（应改为指向 docs/balance-report.md）：' + hits.join(' / ')
  );
});

test('「已知限制」段指向平衡报告（数值有唯一出处）', () => {
  const section = limitationsSection(readFileSync(README, 'utf8'));
  assert.ok(
    section.includes('docs/balance-report.md'),
    '已知限制段未指向 docs/balance-report.md（读者将无处查当前读数）'
  );
});

test('平衡报告本身存在（README 指向的出处不能是空头路径）', () => {
  assert.ok(existsSync(REPORT), 'docs/balance-report.md 不存在：' + REPORT);
});
