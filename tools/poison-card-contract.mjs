// B97 力竭可见性增强 · 毒牌层数契约判据。
//
// 为什么需要它：B97 把四套主题的毒牌层数整体上移（1 层牌 → 2 层、2 层牌 → 3 层），
//   这条边界**只存在于数据里**（theme.json 的 amount + text）⇒ 没有任何机制会报红
//   ⇒ 以后有人把数值改回弱档（或只改数值不改文案），力竭可见性会静默退回基线。
//   本判据把「层数下限」与「文案与数值同源」钉成常驻守卫（由门 ② 自动纳入，不新增门禁编号）。
//
// ⚠️ **层数不是单次数值，是持续回合数**（engine/core/statuses.ts：按层扣血后 −1 层）
//   ⇒ 同样「多扣 1 点」，「层数 +1」与「扣血 +1」在总量上完全不同（B97 实测 8.62 vs 4.00 每百局）。
//   ⇒ 改层数前先想清楚「总扣血 = Σ(各回合层数)」。

/** B97 强档下限：任何毒牌的层数不得低于此值（1 层牌已被上移到 2 层）。 */
export const POISON_MIN_LAYERS = 2;

/** B97 强档要求：每套主题至少有一张 ≥ 此层数的毒牌（2 层牌已被上移到 3 层）。 */
export const POISON_STRONG_LAYERS = 3;

/** 每套主题至少应有的毒牌数量（当前：1 层牌 + 2 层牌）。 */
export const POISON_MIN_CARDS = 2;

/**
 * 收集一套主题里所有「施加 poison」的牌。
 *
 * ⚠️ **递归找 poison effect**：1 层牌的效果是 `sequence`（伤害 + 中毒）⇒ poison 嵌在
 *   `effects[0].effects[]` 里 ⇒ 只看一层 effects 会漏掉它（这正是 B97 精测脚本的教训）。
 *
 * @param {any} theme 主题包对象
 * @returns {{id: string, text: string, layers: number}[]}
 */
export function collectPoisonCards(theme) {
  const out = [];
  const cards = Array.isArray(theme?.cards) ? theme.cards : [];
  for (const card of cards) {
    const layers = [];
    const walk = (node) => {
      if (Array.isArray(node)) { for (const v of node) { walk(v); } return; }
      if (node === null || typeof node !== 'object') { return; }
      if (node.op === 'poison' && typeof node.amount === 'number') { layers.push(node.amount); }
      if (Array.isArray(node.effects)) { walk(node.effects); }
    };
    walk(card?.effects);
    if (layers.length === 0) { continue; }
    out.push({ id: String(card?.id ?? '(无 id)'), text: String(card?.text ?? ''), layers: layers.length === 1 ? layers[0] : Math.max(...layers) });
  }
  return out;
}

/**
 * 判据：返回问题清单（空 = 通过）。
 *
 * 四条检查：
 *   ① 毒牌数量 ≥ POISON_MIN_CARDS（防「把毒牌删掉」这种最省事的回退）
 *   ② 每张毒牌层数 ≥ POISON_MIN_LAYERS（防退回弱档）
 *   ③ 每套至少一张 ≥ POISON_STRONG_LAYERS（守住强档核心）
 *   ④ 牌面文案里的「中毒 N 层」必须与层数一致（防只改数值不改文案 ⇒ 牌面与判定脱节）
 *
 * @param {any} theme 主题包对象
 * @returns {{errors: string[], notes: string[]}}
 */
export function checkPoisonCards(theme) {
  const errors = [];
  const notes = [];
  const cards = collectPoisonCards(theme);
  const id = theme?.meta?.id ?? '(未知主题)';
  if (cards.length < POISON_MIN_CARDS) {
    errors.push(`${id}：毒牌只有 ${cards.length} 张，应 ≥ ${POISON_MIN_CARDS} 张（删牌回退必须判红）`);
    return { errors, notes };
  }
  for (const c of cards) {
    if (c.layers < POISON_MIN_LAYERS) {
      errors.push(`${id}/${c.id}：毒牌层数 ${c.layers} < 下限 ${POISON_MIN_LAYERS}（弱档回退必须判红）`);
    }
    const m = /中毒\s*(\d+)\s*层/.exec(c.text);
    if (m === null) {
      errors.push(`${id}/${c.id}：牌面文案未写明「中毒 N 层」⇒ 无法核对文案与数值（文案：${c.text}）`);
    } else if (Number(m[1]) !== c.layers) {
      errors.push(`${id}/${c.id}：牌面文案写「中毒 ${m[1]} 层」而数值是 ${c.layers} 层 ⇒ 文案与判定脱节`);
    }
  }
  const strongest = Math.max(...cards.map((c) => c.layers));
  if (strongest < POISON_STRONG_LAYERS) {
    errors.push(`${id}：最强毒牌只有 ${strongest} 层，应 ≥ ${POISON_STRONG_LAYERS} 层（强档核心丢失必须判红）`);
  }
  notes.push(`${id}：毒牌 ${cards.map((c) => `${c.id}=${c.layers}层`).join('、')}`);
  return { errors, notes };
}
