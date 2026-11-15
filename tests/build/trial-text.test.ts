// B77 题面真值（规格 §6）：试炼题面必须由**判定谓词 + 奖励效果 + 主题词表**派生。
//
// 病灶（B26 加难时只换了 pred、没回头重写 text，B75.2 又把它原样抄进三套派生主题）：
// 现网四套各 9–10/12 条题面与判定矛盾，而实体试炼牌的 IR **只带 text**
// （build-ir.mjs:138）⇒ 玩家手里的牌写着条件 A、引擎判的是条件 B。
// 卡牌早就由 renderCardText 派生，试炼是全仓唯一「人抄的真相」。
//
// 用词取证：移动牌/攻击牌/防御牌/功能牌、红牌/黑牌 在每套 theme.json 里各只出现 1 次，
// 且全都在被删除的手写题面中 ⇒ 沿用这些词，玩家看到的措辞不换血。
// 骰子句**不**掺 terms.deck：urban 的 deck 是「异能牌」，拼出来是「异能牌骰」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { renderTrialText, isDerivable, DERIVABLE_PREDICATES, GATE_FALLBACK_CLAUSE, GATE_PAY_FAIL_CLAUSE, renderTrialFailure, renderTrialFooter } from '../../build/trial-text.mjs';

/** 仙侠基准词表（与 theme.json 的正式 `terms` 同形）。 */
const TERMS = {
  hp: '灵力', deck: '符箓', resource: '灵枢', gate: '关隘',
  types: { motion: '位移', attack: '攻击', defense: '防御', utility: '功能' },
  colors: { red: '红', black: '黑' },
  // B78 T10：immune 奖励的名词位改走 terms.statuses（三叶）。fixture 补叶，断言不变。
  statuses: { poison: '中毒', slow: '减速', silence: '封口' },
};
const cond = (pred: unknown, then: unknown) =>
  ({ op: 'conditional', pred, then, else: { op: 'gate_fallback_pay' } });

test('B77：单色两张 + 抽牌 ⇒ 题面点明颜色与张数（t_sword 那类病灶的正形）', () => {
  const text = renderTrialText(
    cond({ kind: 'has_card_count', filter: { color: 'black' }, count: 2 }, { op: 'draw_cards', count: 1 }), TERMS);
  assert.equal(text, '展示手里 2 张黑色牌——通过后抽 1 张符箓（未通过则本关改为付费）。');
});

test('B77：类型+颜色复合判定 ⇒ 两个维度都进题面，免疫奖励点名状态', () => {
  const text = renderTrialText(
    cond({ kind: 'has_card_count', filter: { type: 'motion', color: 'red' }, count: 2 },
      { op: 'immunity', status: 'silence', amount: 1 }), TERMS);
  assert.equal(text, '展示手里 2 张红色位移牌——通过后免疫封口 1 回合（未通过则本关改为付费）。');
});

test('B77：纯类型判定 ⇒ 只点类型；奖励用主题词表（消除「灵枢」串戏）', () => {
  assert.equal(
    renderTrialText(cond({ kind: 'has_card_count', filter: { type: 'defense' }, count: 2 },
      { op: 'gain_resource', amount: 1 }), TERMS),
    '展示手里 2 张防御牌——通过后获得 1 枚灵枢（未通过则本关改为付费）。');
  assert.equal(
    renderTrialText(cond({ kind: 'has_card_count', filter: { type: 'attack', color: 'black' }, count: 2 },
      { op: 'gain_resource', amount: 1 }),
      { ...TERMS, deck: '指令', hp: '机体完整度', resource: '算力' }),
    '展示手里 2 张黑色攻击牌——通过后获得 1 枚算力（未通过则本关改为付费）。');
});

test('B77：骰子型 ⇒ 面数与门槛都进题面，骰子不掺牌名', () => {
  assert.equal(
    renderTrialText(cond({ kind: 'dice_is_at_least', amount: 6, faces: 20 },
      { op: 'heal', amount: 1 }), TERMS),
    '掷 20 面骰，点数 ≥ 6——通过后恢复 1 点灵力（未通过则本关改为付费）。');
});

test('B77：白名单外的判定不可派生 ⇒ isDerivable 为 false，renderTrialText 抛错而不是猜', () => {
  assert.equal(isDerivable({ kind: 'has_card_count' }), true);
  assert.equal(isDerivable({ kind: 'dice_is_at_least' }), true);
  assert.equal(isDerivable({ kind: 'flag_set' }), false);
  assert.equal(isDerivable(undefined), false);
  assert.throws(() => renderTrialText(cond({ kind: 'flag_set', flag: 'x' }, { op: 'shield', amount: 1 }), TERMS),
    /白名单/);
});

test('B77：白名单就是今天 48 条用到的那两种（扩白名单必须同时补渲染分支）', () => {
  assert.deepEqual([...DERIVABLE_PREDICATES].sort(), ['dice_is_at_least', 'has_card_count']);
});

test('B77：四套主题现网题面 == 派生结果，且 fallback 条目数为 0（钉死，规格 §6.3 第 3 条）', () => {
  let fallback = 0;
  for (const id of ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych']) {
    const t = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8')) as unknown as {
      terms: typeof TERMS;
      trials: { id: string; text: string; fallback?: boolean; effects?: { op: string; pred?: { kind: string } }[] }[];
    };
    assert.ok(t.terms !== undefined, `${id} 缺 terms（题面派生的词表正身，规格 §6.2）`);
    for (const tr of t.trials) {
      const c = (tr.effects ?? []).find((e) => e.op === 'conditional');
      if (tr.fallback === true || !isDerivable(c?.pred)) { fallback += 1; continue; }
      assert.equal(tr.text, renderTrialText(c, t.terms), `${id}/${tr.id} 题面与判定不符`);
    }
  }
  assert.equal(fallback, 0, '今天要恰好 0 条手写题面；真要加强判定，显式改这个数字并写进批次记录');
});

test('B77：四套 terms 的十叶齐备（缺一个叶子就会拼出 undefined）', () => {
  for (const id of ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych']) {
    const t = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8')) as unknown as
      { terms?: { types?: Record<string, string>; colors?: Record<string, string> } & Record<string, unknown> };
    assert.ok(t.terms !== undefined, `${id} 缺 terms`);
    for (const k of ['hp', 'deck', 'resource', 'gate'] as const) {
      assert.equal(typeof t.terms![k], 'string', `${id} terms.${k} 必须是字符串`);
    }
    assert.equal(Object.keys(t.terms!.types ?? {}).length, 4, `${id} terms.types 必须四个`);
    assert.equal(Object.keys(t.terms!.colors ?? {}).length, 2, `${id} terms.colors 必须两个`);
  }
});

// ---- B78 T7：失败后果句抽成导出常量（题面括注 / 卡面页脚 / 规则书三处同源）----
test('B78：后果句是导出常量，括注仍是「未通过则 + 裸句」（题面逐字不变的机制证明）', () => {
  assert.equal(GATE_FALLBACK_CLAUSE, '本关改为付费');
  assert.equal(GATE_PAY_FAIL_CLAUSE, '仍未付足则判未通过，退 1 格并被封口');
  assert.equal(renderTrialFailure({ op: 'gate_fallback_pay' }, TERMS), GATE_FALLBACK_CLAUSE);
  assert.equal(renderTrialFailure(undefined, TERMS), undefined, '没有 else ⇒ 没有后果句');
  assert.equal(renderTrialFooter(), '本关改为付费——' + GATE_PAY_FAIL_CLAUSE);
  // 括注必须仍是「未通过则 + 裸后果」，否则 48 条题面会跟着变（下一跳由 themes 重生成 diff 兜底）
  assert.equal(renderTrialText(
    cond({ kind: 'has_card_count', filter: { color: 'black' }, count: 2 }, { op: 'draw_cards', count: 1 }), TERMS),
    '展示手里 2 张黑色牌——通过后抽 1 张符箓（未通过则本关改为付费）。');
});

test('B78：页脚句不含「退 1 格并被封口」的旧假话（真归属是比牌未胜 / 付费不足放行）', () => {
  assert.equal(renderTrialFooter().includes('失败则退 1 格并被封口'), false);
  // 但「退 1 格并被封口」本身是真规则，必须保留在「仍未付足」这一侧
  assert.ok(renderTrialFooter().includes('退 1 格并被封口'));
});
