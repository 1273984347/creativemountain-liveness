// 历史样本兼容：B70 之前 sim 记录器手拼 `duel_card:<id>`，而 actionKey 的规范形是 `duel:card:<id>`。
// 只在**读侧**归一化，历史 JSONL 不改写（保留原始数据）。
//
// ⚠️ B73：**非字符串一律抛错**（不再 `String(key)`）—— 否则 `undefined` 会被拼成 `'undefined'`、
//   得到一条永不 agree 的怪串，与 `engine/core/action-key.ts` 的「绝不把 undefined 拼成 'undefined'」纪律相左。
export function normalizeLegacyKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError('normalizeLegacyKey：key 必须是字符串，收到 ' + typeof key);
  }
  return key.startsWith('duel_card:') ? 'duel:card:' + key.slice('duel_card:'.length) : key;
}
