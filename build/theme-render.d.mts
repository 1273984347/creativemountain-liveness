// build/theme-render.mjs 的类型声明（tests 引 .mjs 需要，与 build/trial-text.d.mts 同法）。
// ⚠️ 参数刻意写成 unknown：形状由门 ⑤ 负责，不在这里抄第二份类型；渲染器对残缺数据抛错。
export declare function termWord(table: unknown, key: unknown, path: string): string;
export declare function renderPredicate(pred: unknown, terms: unknown): string;
export declare function renderEffect(effect: unknown, terms: unknown): string;
export declare function renderCardText(effect: unknown, terms: unknown): string;
