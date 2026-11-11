// key-normalize.mjs 的类型声明（纯 JS 工具的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 key-normalize.mjs（纯 JS，无类型）。
//   由 `tests/gates/key-normalize.test.ts`（B73 起；原在 `tests/engine/`） 判定（六条口径：历史形 / 规范形 / 其余不动 / 边界串 / 非字符串抛错 / 与 `actionKey` 逐字符一致）。

/**
 * 历史样本 key 归一化（**读侧专用**，B70）。
 *
 * B70 之前 sim 记录器手拼 `duel_card:<id>`，而 `actionKey` 的规范形是 `duel:card:<id>`
 * ⇒ 探针比较 P6 前把历史样本的这一种形归一化，使新旧样本可比。
 *
 * ⚠️ **不是**写侧格式：`duel_card:` 从未成为合法输出格式，历史 JSONL 也不改写。
 * 除 `duel_card:` 前缀外一律原样返回（含已是规范形的 `duel:card:<id>`）。
 *
 * ⚠️ B73：`key` 必须是字符串；非字符串**抛 TypeError**（不得把 `undefined` 洗成 `'undefined'`）。
 */
export declare function normalizeLegacyKey(key: string): string;
