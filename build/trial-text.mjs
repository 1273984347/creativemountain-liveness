// 试炼题面的唯一文本来源（B77 规格 §6.1）。
//
// ⚠️ 为什么要有这个文件：B22 时代 `text` 与 `pred` 成对手写、当时一致；B26 加难**只换了
//   pred**（其批次记录 §3 的表已是「2 张红色身法」这类新判定），没回头重写题面
//   ⇒ 四套主题印出 9–10/12 条与判定矛盾的题面。实体试炼牌的 IR **只带 text**
//   （build-ir.mjs:138）⇒ 玩家手里的牌写着条件 A、引擎判的是条件 B，且印刷链路查不出来。
//   卡牌早就由 `renderCardText` 从 effects 派生，试炼是全仓最后一处「人抄的真相」。
//
// ⚠️ 为什么不复用 `renderPredicate`：它把谓词渲染成**条件子句**（「手中有什么」），
//   而试炼是**向玩家提要求**（「展示手里 2 张黑色牌」）；且 `has_card_count` 压根不在
//   它的 switch 分支里（落到 default「条件成立」——这正是漂移能藏住的原因之一）。
//   奖励句则**必须**同源：`then` 就是一个效果，直接调 `renderEffect`，两处口径不会分叉。
//
// 用词取证（不是随手定的）：类目名词的**机器口径**是 `theme-render.mjs` 的 `TYPE_CN`
// （位移/攻击/防御/功能），而数据里的「移动」几乎全是**动词**（「移动到第 8 格」「移动骰」），
// 「移动牌」只在被本文件替换掉的手写题面里出现过一次 ⇒ 题面沿用 `TYPE_CN` 那一套，
// 同一类目不留两个词。骰子句**故意不**掺 `terms.deck`：urban 的 deck 是「异能牌」，
// 拼出来是「异能牌骰」。主题感由 `terms.resource/hp/deck` 在奖励句里承担。

import { renderEffect } from './theme-render.mjs';

/**
 * 可派生的判定白名单（规格 §6.3）。
 *
 * 今天四套 48 条判定全落在这里 ⇒ 守卫能钉住「fallback 条目数 == 0」。
 * ⚠️ 加一项必须**同时**加 `renderCondition` 的分支，否则渲染器抛错而不是猜。
 */
export const DERIVABLE_PREDICATES = new Set(['has_card_count', 'dice_is_at_least']);

/** 判定能不能机械派生（`undefined` / 白名单外 ⇒ false，由调用方转成 `fallback: true`）。 */
export function isDerivable(pred) {
  return typeof pred?.kind === 'string' && DERIVABLE_PREDICATES.has(pred.kind);
}

/** 从词表取一个词：缺失即抛错——静默拼出 `undefined` 会一路印到实体牌上。 */
function word(table, key, path) {
  const v = table?.[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`renderTrialText：词表缺 ${path}.${String(key)}（主题包 terms 不完整）`);
  }
  return v;
}

/** 条件句：把判定谓词翻译成对玩家提的要求。 */
function renderCondition(pred, terms) {
  if (pred.kind === 'dice_is_at_least') {
    return `掷 ${String(pred.faces)} 面骰，点数 ≥ ${String(pred.amount)}`;
  }
  // has_card_count：filter 的 color/type 各自进题面，顺序「色在前、类在后」（中文定语的既有读法）
  const filter = pred.filter ?? {};
  const bits = [];
  if (filter.color !== undefined) { bits.push(word(terms.colors, filter.color, 'colors') + '色'); }
  if (filter.type !== undefined) { bits.push(word(terms.types, filter.type, 'types')); }
  // 「手里」二字不能省：场上还有 round 级公开亮牌与对峙亮牌，只说「展示 2 张牌」会读成亮牌区
  return `展示手里 ${String(pred.count)} 张${bits.join('')}牌`;
}

/** 试炼失败的唯一后果口径（真值：gate.ts:204-221 只写 gate_pay_<格>，不退格也不封口）。 */
export const GATE_FALLBACK_CLAUSE = '本关改为付费';
/** 改为付费后仍付不起 ⇒ 判未通过并放行；退格与封口发生在**这一侧**（gate.ts:250-252 / :337-352）。 */
export const GATE_PAY_FAIL_CLAUSE = '仍未付足则判未通过，退 1 格并被封口';

/**
 * 裸后果句（题面括注与卡面页脚共用）。
 *
 * ⚠️ 不写死：出现别的 else op 就照常渲染 —— 12 张今天全是 gate_fallback_pay，
 *   但那是**数据现状**，不是渲染器该替数据做的承诺。
 */
export function renderTrialFailure(elseEffect, terms) {
  if (elseEffect === undefined) { return undefined; }
  if (elseEffect.op === 'gate_fallback_pay') { return GATE_FALLBACK_CLAUSE; }
  return renderEffect(elseEffect, terms);
}

/**
 * 卡面页脚整句（B78 §4 R2）。
 *
 * 病根：B78 前页脚写死「失败则退 1 格并被封口」，而试炼失败分支只写 gate_pay_<格>
 * —— 同一张牌上题面括注（真）与页脚（假）互相矛盾，且页脚不进 text / 不进 IR，
 * 门 ⑤/⑥/⑦ 结构上看不见。现在页脚由本函数派生，规则书小节必须逐字包含同一句。
 */
export function renderTrialFooter() {
  return `${GATE_FALLBACK_CLAUSE}——${GATE_PAY_FAIL_CLAUSE}`;
}

/**
 * 完整题面：`条件句——通过后奖励句（失败后果）。`
 *
 * 白名单外的 `pred` **抛错**——是否降级成手写题面由调用方（生成器）决定并标 `fallback`，
 * 渲染器不替数据猜话。
 */
export function renderTrialText(effect, terms) {
  const pred = effect?.pred;
  if (!isDerivable(pred)) { throw new Error('renderTrialText：判定不在可派生白名单内'); }
  const body = `${renderCondition(pred, terms)}——通过后${renderEffect(effect.then, terms)}`;
  const bare = renderTrialFailure(effect.else, terms);
  const els = bare === undefined ? undefined : '未通过则' + bare;
  return `${body}${els === undefined ? '' : `（${els}）`}。`;
}
