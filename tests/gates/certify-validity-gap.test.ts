// L-B80-3 反向钉：§5.3.3「出题合规裁定」是**引擎实现缺口**，不许用删文档条文掩盖。
//
// 病灶（取证 2026-11-23，详见 `docs/批次/B80-句子层三叶与身份称谓-执行记录.md` §14.2）：
//   主规格 `:709` 裁定「孤儿动作 `CERTIFY_VALIDATE_QUESTION` 移除」并已由
//   `action-contract.test.ts:12`/`:98` 钉成契约，但那次裁定**只落了动作枚举一处**——
//   §5.3.3 的规则条文（`:428`–`:436`）、§13.1 的追溯项（`:1445`）、§3 的行动空间（`:377`）
//   三处承诺原封不动。于是规格现在承诺一条没有动作、没有编码、没有 UI 入口的规则。
//
// ⚠️ 本文件钉的是**文档不许消失**，不是钉「引擎不许修好」：
//   B83 若接线实现 §5.3.3，这些句子仍是真话 ⇒ 本文件继续绿，无需改动；
//   B83 若选择降档，则**必须**同批改这三处口径并同步改写本文件 ⇒ 想悄悄删条文会当场红。
//   （同款纪律见 B78 的 R7-5：`删这句 = 把缺口伪装成文档瑕疵`。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SPEC_PATH = 'docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md';

/** 规格按行切分——不用 `\n` 序列匹配，否则 `core.autocrlf=true` 的克隆里 CRLF 会让匹配失效（E96 同款坑）。 */
const specLines = (): string[] => readFileSync(SPEC_PATH, 'utf8').split(/\r?\n/);

/** §5.3.3 小节正文（标题之后到下一个 `####` 之前）。 */
function validitySection(): string {
  const lines = specLines();
  const h = lines.findIndex((l) => l.startsWith('#### 5.3.3 '));
  assert.ok(h >= 0, '前提：规格必须有 §5.3.3 出题合规性检查小节');
  const body: string[] = [];
  for (let i = h + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('#### ')) { break; }
    body.push(line);
  }
  return body.join('\n');
}

test('L-B80-3-1：§5.3.3 的裁定主体句不许被删', () => {
  const t = validitySection();
  assert.ok(t.includes('全场非当事人玩家'),
    '删这句 = 把 L-B80-3 伪装成「文档本来就没错」；裁定主体是「非当事人多数决」，没有它就没有可降档的条文');
});

test('L-B80-3-2：§5.3.3 的两条后果分支必须成对在文', () => {
  const t = validitySection();
  assert.ok(t.includes('认证人须换题'), '缺「不可验证 → 换题」分支（引擎侧对应 `validityDecided` 从未置真）');
  assert.ok(t.includes('拒绝视为答错'), '缺「可验证 → 必须回答、拒绝算答错」分支');
});

test('L-B80-3-3：§13.1 追溯表仍须把出题合规性列为已裁定并指回 §5.3.3', () => {
  const row = specLines().find((l) => l.includes('| 出题合规性 |'));
  assert.ok(row !== undefined,
    '删追溯表这一行 = 规则从验收清单里凭空消失，缺口从此没有对账入口');
  assert.ok(String(row).includes('§5.3.3'), '追溯表必须回指 §5.3.3，否则钉不住条文位置');
});
