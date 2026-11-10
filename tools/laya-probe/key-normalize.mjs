// 历史样本兼容：B70 之前 sim 记录器手拼 `duel_card:<id>`，而 actionKey 的规范形是 `duel:card:<id>`。
// 只在**读侧**归一化，历史 JSONL 不改写（保留原始数据）。
export function normalizeLegacyKey(key) {
  const s = String(key);
  return s.startsWith('duel_card:') ? 'duel:card:' + s.slice('duel_card:'.length) : s;
}
