// key-normalize.mjs 的类型声明（纯 JS 工具的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 key-normalize.mjs（纯 JS，无类型）。
//   由 `tests/engine/key-normalize.test.ts` 判定（三条口径：历史形 / 规范形 / 其余不动）。

/**
 * 历史样本 key 归一化（**读侧专用**，B70）。
 *
 * B70 之前 sim 记录器手拼 `duel_card:<id>`，而 `actionKey` 的规范形是 `duel:card:<id>`
 * ⇒ 探针比较 P6 前把历史样本的这一种形归一化，使新旧样本可比。
 *
 * ⚠️ **不是**写侧格式：`duel_card:` 从未成为合法输出格式，历史 JSONL 也不改写。
 * 除 `duel_card:` 前缀外一律原样返回（含已是规范形的 `duel:card:<id>`）。
 */
export declare function normalizeLegacyKey(key: string): string;
